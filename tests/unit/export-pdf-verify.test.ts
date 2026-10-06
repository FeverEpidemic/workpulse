import { describe, expect, it } from "vitest";

import { ExplicitTestFakePdfRenderer, type PdfRenderer } from "@/server/export/pdf-renderer";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";

const fake: PdfRenderer = new ExplicitTestFakePdfRenderer();
const signal = () => new AbortController().signal;

async function pdfOf(html: string): Promise<Uint8Array> {
  const rendered = await fake.render(html, signal());
  if (rendered.status !== "ok") throw new Error("fake renderer failed");
  return rendered.pdf;
}

describe("T21 export PDF verification kind (pdf-export)", () => {
  it("returns the text of a short CV that the import kind rejects as scanned", async () => {
    const pdf = await pdfOf("<h1>Ani</h1><p>Analis</p>");
    const imported = await parseInThread("pdf", pdf);
    expect(imported).toEqual({ status: "error", code: "SCANNED_PDF" });
    const verified = await parseInThread("pdf-export", pdf);
    expect(verified.status).toBe("ok");
    if (verified.status !== "ok") return;
    expect(verified.pageCount).toBe(1);
    expect(verified.text).toContain("Ani");
    expect(verified.text).toContain("Analis");
  });

  it("reports the page count of an over-long PDF without extracting its text", async () => {
    const body = Array.from({ length: 1100 }, (_, n) => `<p>Baris ${n}</p>`).join("");
    const pdf = await pdfOf(`<h1>Ani</h1>${body}`);
    const verified = await parseInThread("pdf-export", pdf);
    expect(verified.status).toBe("ok");
    if (verified.status !== "ok") return;
    expect(verified.pageCount).toBeGreaterThan(20);
    expect(verified.text).toBe("");
  });

  it("rejects bytes that are not a PDF", async () => {
    expect(await parseInThread("pdf-export", new TextEncoder().encode("<html>nope</html>"))).toEqual({ status: "error", code: "CORRUPT_FILE" });
  });

  it("leaves the import kinds unchanged", async () => {
    const pdf = await pdfOf(`<h1>Ani</h1><p>${"Pengelolaan anggaran. ".repeat(20)}</p>`);
    const imported = await parseInThread("pdf", pdf);
    expect(imported.status).toBe("ok");
    const pages = await parseInThread("pdf-pages", pdf);
    expect(pages).toEqual({ status: "ok", text: null, pageCount: 1 });
  });
});
