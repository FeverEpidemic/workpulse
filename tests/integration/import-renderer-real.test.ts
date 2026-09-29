import { describe, expect, it } from "vitest";

import { resolveDocxRenderer } from "@/server/documents/docx-renderer";
import { parseInThread } from "@/server/documents/parse-in-thread";

import { CV_LINES, cvDocx } from "../import-fixtures";

/**
 * Requires the real Gotenberg/LibreOffice container (docs/verification/T15-renderer-runbook.md).
 * Never falls back to the fake: an unavailable renderer fails this suite loudly.
 */
const baseUrl = process.env.WORKPULSE_GOTENBERG_URL ?? "http://127.0.0.1:13400";

async function countPdfPages(pdf: Uint8Array) {
  const result = await parseInThread("pdf-pages", pdf);
  return result.status === "ok" && result.pageCount !== null
    ? { status: "ok" as const, pageCount: result.pageCount }
    : { status: "error" as const, code: "PAGE_COUNT_UNAVAILABLE" as const };
}

describe("T15 real DOCX renderer (Gotenberg LibreOffice)", () => {
  const renderer = resolveDocxRenderer({ mode: "gotenberg", nodeEnv: "test", baseUrl, countPdfPages });

  it("is configured for the real renderer", async () => {
    expect(renderer.kind).toBe("gotenberg");
    const health = await fetch(new URL("/health", baseUrl)).catch(() => null);
    expect(health?.ok, "Gotenberg must be running; see T15-renderer-runbook.md").toBe(true);
  });

  it("counts pages from rendering, not from docProps/app.xml", async () => {
    expect(await renderer.countPages(cvDocx(CV_LINES, { pages: 2, appPages: 9 }), AbortSignal.timeout(60_000)))
      .toEqual({ status: "ok", pageCount: 2 });
    expect(await renderer.countPages(cvDocx(CV_LINES, { pages: 21, appPages: 1 }), AbortSignal.timeout(60_000)))
      .toEqual({ status: "ok", pageCount: 21 });
  }, 90_000);
});
