import { describe, expect, it } from "vitest";

import { validateImportResult } from "@/domain/import/extract-result";
import { parseInThread } from "@/server/documents/parse-in-thread";

import { CV_LINES, cvDocx, cvPdf, emptyDocx, pdfFixture, RULES_CV_PDF_LINES, rulesCvPdf, zipBombDocx } from "../import-fixtures";

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

  it("T26: runs the rules extractor on the final text inside the thread only when asked", async () => {
    const pdf = rulesCvPdf();
    const result = await parseInThread("pdf", pdf, { extract: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.extractionFailed).toBe(false);
    const extraction = result.extraction as { experiences: Array<{ role_title: string }>; skills: Array<{ name: string }> };
    expect(extraction.experiences.map((item) => item.role_title)).toEqual(["Senior Data Analyst"]);
    expect(extraction.skills.map((item) => item.name)).toEqual(["SQL", "Python"]);
    expect(validateImportResult(result.extraction, result.text ?? "").ok).toBe(true);

    const plain = await parseInThread("pdf", pdf);
    expect(plain).toEqual({ status: "ok", text: result.text, pageCount: 1 });
    const docx = await parseInThread("docx", cvDocx(RULES_CV_PDF_LINES), { extract: true });
    expect(docx.status === "ok" && (docx.extraction as { skills: unknown[] }).skills.length).toBe(2);
  });

  it("T26: extraction shares the thread timeout", async () => {
    expect(await parseInThread("pdf", rulesCvPdf(), { extract: true, timeoutMs: 1 })).toEqual({ status: "error", code: "PARSER_TIMEOUT" });
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
