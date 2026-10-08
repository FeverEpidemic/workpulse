// Worker-only; keep imports relative (no "@/" alias).
import { Worker } from "node:worker_threads";

import { IMPORT_PARSE_TIMEOUT_MS, IMPORT_PERMANENT_ERROR_CODES, type ImportFileErrorCode } from "../../domain/import/contracts.ts";

// "pdf-export" (T21) reads the PDF an export renderer produced: no import limits, text only up to the export page limit.
export type ParseKind = "pdf" | "docx" | "pdf-pages" | "pdf-export";

export type ParseResult =
  | { status: "ok"; text: string | null; pageCount: number | null }
  | { status: "error"; code: ImportFileErrorCode };

export type ParseOptions = {
  timeoutMs?: number;
  maxOldGenerationSizeMb?: number;
  /** Test seam only: an alternative thread entry. */
  entry?: URL;
};

export const PARSER_THREAD_ENTRY = new URL("./parser-thread.ts", import.meta.url);

function isResult(value: unknown): value is ParseResult {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (row.status === "error") {
    return typeof row.code === "string" && (IMPORT_PERMANENT_ERROR_CODES as readonly string[]).includes(row.code);
  }
  return row.status === "ok"
    && (row.text === null || typeof row.text === "string")
    && (row.pageCount === null || (typeof row.pageCount === "number" && Number.isInteger(row.pageCount) && row.pageCount >= 1));
}

/**
 * Parse untrusted bytes in a separate thread with a heap limit, no inherited environment,
 * discarded stdio, and a hard timeout that terminates the thread (PARSER_TIMEOUT). A crash
 * or heap exhaustion becomes CORRUPT_FILE; the calling worker process keeps running.
 */
export function parseInThread(kind: ParseKind, bytes: Uint8Array, options: ParseOptions = {}): Promise<ParseResult> {
  const timeoutMs = options.timeoutMs ?? IMPORT_PARSE_TIMEOUT_MS;
  const copy = new Uint8Array(bytes);
  return new Promise<ParseResult>((resolve) => {
    let settled = false;
    const worker = new Worker(options.entry ?? PARSER_THREAD_ENTRY, {
      workerData: { kind, bytes: copy },
      transferList: [copy.buffer],
      env: {},
      stdout: true,
      stderr: true,
      resourceLimits: {
        maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 256,
        maxYoungGenerationSizeMb: 32,
        codeRangeSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    const finish = (result: ParseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate().catch(() => undefined);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: "error", code: "PARSER_TIMEOUT" }), timeoutMs);
    worker.once("message", (message: unknown) => {
      finish(isResult(message) ? message : { status: "error", code: "CORRUPT_FILE" });
    });
    worker.once("error", () => finish({ status: "error", code: "CORRUPT_FILE" }));
    worker.once("exit", () => finish({ status: "error", code: "CORRUPT_FILE" }));
  });
}
