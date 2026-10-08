import { execFile } from "node:child_process";
import { existsSync } from "node:fs";

/** `gotenberg` is the real Chromium renderer, `fake` the marked test fake, `unavailable` fails every job (retriable). */
export type ExportRenderer = "gotenberg" | "fake" | "unavailable";

// Worker-only configuration is removed first and only the renderer settings are put back, so nothing leaks from the test
// process into the child by accident.
const CHILD_ONLY_PREFIXES = ["WORKPULSE_AI_", "WORKPULSE_OPENAI_", "WORKPULSE_DOCX_", "WORKPULSE_GOTENBERG_", "WORKPULSE_PDF_", "WORKPULSE_SCANNER_", "WORKPULSE_CLAMD_"];

export const REAL_RENDERER_URL = process.env["WORKPULSE_PDF_GOTENBERG_URL"]?.trim() || "http://127.0.0.1:13401";

function childEnv(renderer: ExportRenderer): NodeJS.ProcessEnv {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (CHILD_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    env[key] = value;
  }
  // The fake renderer is refused outside development and test.
  env["NODE_ENV"] = "test";
  env["WORKPULSE_PDF_RENDERER_MODE"] = renderer;
  if (renderer === "gotenberg") env["WORKPULSE_PDF_GOTENBERG_URL"] = REAL_RENDERER_URL;
  return env as NodeJS.ProcessEnv;
}

type Summary = { exportJobsClaimed?: number; exportSucceeded?: number; exportFailed?: Record<string, number>; pdfRenderer?: string };

function runOnce(renderer: ExportRenderer): Promise<{ summary: Summary; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["workers/run.ts", "--once"], { env: childEnv(renderer), timeout: 150_000 }, (error, stdout, stderr) => {
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      let summary: Summary | null = null;
      try { summary = JSON.parse(line) as Summary; } catch { summary = null; }
      if (summary === null) return reject(new Error(`export worker produced no summary${error ? " (process failed)" : ""}`));
      resolve({ summary, output: stdout + stderr });
    });
  });
}

/** Drains the export queue with the given renderer; returns what was claimed and all worker output (for sentinel checks). */
export async function drainExportWorker(renderer: ExportRenderer): Promise<{ claimed: number; succeeded: number; failed: Record<string, number>; output: string }> {
  let claimed = 0;
  let succeeded = 0;
  let output = "";
  const failed: Record<string, number> = {};
  for (let round = 0; round < 8; round += 1) {
    const { summary, output: text } = await runOnce(renderer);
    output += text;
    const count = summary.exportJobsClaimed ?? 0;
    if (count === 0) break;
    claimed += count;
    succeeded += summary.exportSucceeded ?? 0;
    for (const [code, total] of Object.entries(summary.exportFailed ?? {})) failed[code] = (failed[code] ?? 0) + total;
  }
  return { claimed, succeeded, failed, output };
}

/** Fails the run loudly when the real renderer is not reachable: a run must never pass on a fake by accident. */
export async function requireRealRenderer(): Promise<void> {
  const response = await fetch(`${REAL_RENDERER_URL.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!response?.ok) throw new Error("The PDF renderer is not reachable: start workpulse-t21-pdf (docs/verification/T21-pdf-renderer-runbook.md); this suite never falls back to the fake renderer");
}
