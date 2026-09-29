// Worker-only; keep imports relative (no "@/" alias).
import { OoxmlZipError, readWordDocument } from "./ooxml-zip.ts";

export type DocxRendererMode = "gotenberg" | "fake" | "unavailable";

export type PageCountResult =
  | { status: "ok"; pageCount: number }
  | { status: "error"; code: "PAGE_COUNT_UNAVAILABLE" | "CORRUPT_FILE" };

/**
 * Counts DOCX pages by rendering the document in an isolated process. DOCX metadata
 * (docProps/app.xml) is never trusted; any renderer failure is PAGE_COUNT_UNAVAILABLE.
 */
export interface DocxPageRenderer {
  readonly kind: DocxRendererMode;
  countPages(docx: Uint8Array, signal: AbortSignal): Promise<PageCountResult>;
}

export const DOCX_RENDER_MAX_RESPONSE_BYTES = 50 * 1024 * 1024;
export const DOCX_RENDER_DEFAULT_TIMEOUT_MS = 30_000;

export class UnavailableDocxRenderer implements DocxPageRenderer {
  readonly kind = "unavailable" as const;
  async countPages(): Promise<PageCountResult> {
    return { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
  }
}

/**
 * Development/test only (refused in production): one page plus one per explicit
 * `<w:br w:type="page"/>`. Never used as evidence that real pagination was verified.
 */
export class ExplicitTestFakeDocxRenderer implements DocxPageRenderer {
  readonly kind = "fake" as const;
  async countPages(docx: Uint8Array): Promise<PageCountResult> {
    try {
      const { documentXml } = readWordDocument(Buffer.from(docx));
      const breaks = documentXml.match(/<(?:[A-Za-z0-9_]+:)?br\b[^>]*\btype=["']page["'][^>]*\/?>/g)?.length ?? 0;
      return { status: "ok", pageCount: 1 + breaks };
    } catch (error) {
      return { status: "error", code: error instanceof OoxmlZipError ? "CORRUPT_FILE" : "PAGE_COUNT_UNAVAILABLE" };
    }
  }
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export type GotenbergRendererOptions = {
  baseUrl: string;
  timeoutMs?: number;
  /** Counts pages of the rendered PDF, normally in the isolated parser thread. */
  countPdfPages: (pdf: Uint8Array) => Promise<PageCountResult>;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
};

/**
 * Gotenberg LibreOffice route in a separate container. Only the DOCX bytes are sent,
 * under a generic part name; the user's filename never leaves the web request.
 */
export class GotenbergDocxRenderer implements DocxPageRenderer {
  readonly kind = "gotenberg" as const;
  private readonly options: GotenbergRendererOptions;
  private readonly endpoint: string;

  constructor(options: GotenbergRendererOptions) {
    this.options = options;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/forms/libreoffice/convert`;
  }

  async countPages(docx: Uint8Array, signal: AbortSignal): Promise<PageCountResult> {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(docx)], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }), "document.docx");
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DOCX_RENDER_DEFAULT_TIMEOUT_MS);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch {
      return { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
    }
    const pdf = await readLimited(response, this.options.maxResponseBytes ?? DOCX_RENDER_MAX_RESPONSE_BYTES);
    if (!pdf || pdf.byteLength < 5 || Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      return { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
    }
    const counted = await this.options.countPdfPages(pdf);
    return counted.status === "ok" ? counted : { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
  }
}

function isAllowedBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || !url.hostname.includes("."));
  } catch {
    return false;
  }
}

export type DocxRendererOptions = {
  mode?: string;
  nodeEnv?: string;
  baseUrl?: string;
  timeoutMs?: number;
  countPdfPages: (pdf: Uint8Array) => Promise<PageCountResult>;
  fetch?: typeof fetch;
};

/** Default unavailable; fake refused outside development/test; bad config fails closed. */
export function resolveDocxRenderer(options: DocxRendererOptions): DocxPageRenderer {
  const mode = options.mode ?? process.env.WORKPULSE_DOCX_RENDERER_MODE ?? "unavailable";
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (mode === "fake") {
    if (nodeEnv !== "development" && nodeEnv !== "test") throw new Error("FAKE_RENDERER_NOT_ALLOWED_IN_PRODUCTION");
    return new ExplicitTestFakeDocxRenderer();
  }
  if (mode === "gotenberg") {
    const baseUrl = (options.baseUrl ?? process.env.WORKPULSE_GOTENBERG_URL ?? "").trim();
    const rawTimeout = options.timeoutMs ?? Number(process.env.WORKPULSE_DOCX_RENDER_TIMEOUT_MS ?? DOCX_RENDER_DEFAULT_TIMEOUT_MS);
    if (!isAllowedBaseUrl(baseUrl) || !Number.isInteger(rawTimeout) || rawTimeout < 1_000 || rawTimeout > 90_000) {
      return new UnavailableDocxRenderer();
    }
    return new GotenbergDocxRenderer({ baseUrl, timeoutMs: rawTimeout, countPdfPages: options.countPdfPages, fetch: options.fetch });
  }
  return new UnavailableDocxRenderer();
}
