import { describe, expect, it } from "vitest";

import { parseInThread } from "@/server/documents/parse-in-thread";

import { CV_LINES, cvDocx, cvPdf, emptyDocx, pdfFixture, zipBombDocx } from "../import-fixtures";

describe("T15 isolated parser thread", () => {
  it("extracts text and page count from a text PDF", async () => {
    const result = await parseInThread("pdf", cvPdf(2));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("EXP|PT Sentinel Nusantara|Analis Data|2019|2022");
    expect(result.text).toContain("WP-PRIVATE-IMPORT-SENTINEL");
  });

  it("rejects more than 20 pages without reading their text", async () => {
    expect(await parseInThread("pdf", cvPdf(21))).toEqual({ status: "error", code: "TOO_MANY_PAGES" });
  });

  it("reports password-protected, scanned and corrupt PDFs with stable codes", async () => {
    expect(await parseInThread("pdf", pdfFixture([CV_LINES], { encrypt: true }))).toEqual({ status: "error", code: "ENCRYPTED_FILE" });
    expect(await parseInThread("pdf", pdfFixture([[], []], { imageOnly: true }))).toEqual({ status: "error", code: "SCANNED_PDF" });
    expect(await parseInThread("pdf", cvPdf().subarray(0, 40))).toEqual({ status: "error", code: "CORRUPT_FILE" });
  });

  it("counts pages of a rendered PDF", async () => {
    expect(await parseInThread("pdf-pages", cvPdf(3))).toEqual({ status: "ok", text: null, pageCount: 3 });
  });

  it("extracts DOCX text without trusting its page metadata", async () => {
    const result = await parseInThread("docx", cvDocx(CV_LINES, { appPages: 1, pages: 21 }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.pageCount).toBeNull();
    expect(result.text).toContain("SKILL|Statistika");
  });

  it("reports empty and oversized DOCX packages", async () => {
    expect(await parseInThread("docx", emptyDocx())).toEqual({ status: "error", code: "EMPTY_DOCUMENT" });
    expect(await parseInThread("docx", zipBombDocx())).toEqual({ status: "error", code: "FILE_TOO_LARGE" });
  });

  it("terminates a thread that does not answer before the timeout", async () => {
    const started = Date.now();
    const result = await parseInThread("pdf", cvPdf(), {
      timeoutMs: 500,
      entry: new URL("./fixtures/parser-hang-thread.ts", import.meta.url),
    });
    expect(result).toEqual({ status: "error", code: "PARSER_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("survives a thread that exhausts its heap limit", async () => {
    const result = await parseInThread("pdf", cvPdf(), {
      timeoutMs: 20_000,
      maxOldGenerationSizeMb: 32,
      entry: new URL("./fixtures/parser-oom-thread.ts", import.meta.url),
    });
    expect(result).toEqual({ status: "error", code: "CORRUPT_FILE" });
    // The test process itself is still alive and can parse normally afterwards.
    expect((await parseInThread("pdf-pages", cvPdf(1))).status).toBe("ok");
  }, 30_000);
});
