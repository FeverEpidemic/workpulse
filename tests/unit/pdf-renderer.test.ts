import { describe, expect, it } from "vitest";

import { CV_EXPORT_MAX_BYTES } from "@/domain/cv/export";
import { cvExportSnapshotSchema, buildExportRenderModel } from "@/domain/cv/export";
import { renderCvPrintHtml } from "@/server/export/cv-print-template";
import {
  ExplicitTestFakePdfRenderer,
  GotenbergPdfRenderer,
  UnavailablePdfRenderer,
  resolvePdfRenderer,
  type PdfRenderer,
  type PdfRenderResult,
} from "@/server/export/pdf-renderer";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";

import { exportSnapshotFrom, richCvFixture } from "./cv-fixtures";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const signal = () => new AbortController().signal;

type FetchCall = { url: string; init: RequestInit };

function fetchReturning(response: Response | (() => Promise<Response>), calls: FetchCall[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return typeof response === "function" ? response() : response;
  }) as typeof fetch;
}

const fetchWaitingForAbort: typeof fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof fetch;

describe("T21 PdfRenderer resolution", () => {
  it("defaults to unavailable and fails closed on configuration errors", async () => {
    expect(resolvePdfRenderer({ nodeEnv: "production" }).kind).toBe("unavailable");
    expect(resolvePdfRenderer({ mode: "gotenberg", baseUrl: "", nodeEnv: "production" }).kind).toBe("unavailable");
    expect(resolvePdfRenderer({ mode: "nonsense", nodeEnv: "production" }).kind).toBe("unavailable");
    for (const baseUrl of ["ftp://127.0.0.1:13401", "http://user:pw@127.0.0.1:13401", "http://127.0.0.1:13401/?x=1", "http://127.0.0.1:13401/#h", "http://example.com:13401", "not a url"]) {
      expect(resolvePdfRenderer({ mode: "gotenberg", baseUrl, nodeEnv: "production" }).kind).toBe("unavailable");
    }
    for (const timeoutMs of [999, 90_001, 1.5, Number.NaN, 0]) {
      expect(resolvePdfRenderer({ mode: "gotenberg", baseUrl: "http://127.0.0.1:13401", timeoutMs, nodeEnv: "production" }).kind).toBe("unavailable");
    }
    const unavailable: PdfRenderer = new UnavailablePdfRenderer();
    expect(await unavailable.render("<html></html>", signal())).toEqual({ status: "error", code: "RENDERER_UNAVAILABLE" });
  });

  it("accepts loopback, dotless and https hosts for the real renderer", () => {
    for (const baseUrl of ["http://127.0.0.1:13401", "http://localhost:13401", "http://pdf-renderer:3000", "https://pdf.example.com"]) {
      expect(resolvePdfRenderer({ mode: "gotenberg", baseUrl, nodeEnv: "production" }).kind).toBe("gotenberg");
    }
  });

  it("refuses the fake outside development and test", () => {
    for (const nodeEnv of ["production", "staging"]) {
      expect(() => resolvePdfRenderer({ mode: "fake", nodeEnv })).toThrow("FAKE_RENDERER_NOT_ALLOWED_IN_PRODUCTION");
    }
    // A worker process without NODE_ENV is not a development process either.
    const env = process.env as Record<string, string | undefined>;
    const saved = env.NODE_ENV;
    delete env.NODE_ENV;
    try {
      expect(() => resolvePdfRenderer({ mode: "fake" })).toThrow("FAKE_RENDERER_NOT_ALLOWED_IN_PRODUCTION");
    } finally {
      env.NODE_ENV = saved;
    }
    expect(resolvePdfRenderer({ mode: "fake", nodeEnv: "test" }).kind).toBe("fake");
    expect(resolvePdfRenderer({ mode: "fake", nodeEnv: "development" }).kind).toBe("fake");
  });
});

describe("T21 Gotenberg PDF renderer", () => {
  const options = { baseUrl: "http://127.0.0.1:13401/" };

  it("posts one index.html part and the A4 fields to the Chromium HTML route", async () => {
    const calls: FetchCall[] = [];
    const renderer = new GotenbergPdfRenderer({ ...options, fetch: fetchReturning(new Response(PDF, { status: 200 }), calls) });
    const result = await renderer.render("<html><body>WP-HTML</body></html>", signal());
    expect(result).toEqual({ status: "ok", pdf: expect.any(Uint8Array) });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://127.0.0.1:13401/forms/chromium/convert/html");
    expect(calls[0]!.init.method).toBe("POST");
    const form = calls[0]!.init.body as FormData;
    const entries = [...form.entries()];
    const files = entries.filter(([, value]) => typeof value !== "string");
    expect(files).toHaveLength(1);
    expect(files[0]![0]).toBe("files");
    const file = files[0]![1] as File;
    expect(file.name).toBe("index.html");
    expect(file.type).toBe("text/html");
    expect(await file.text()).toBe("<html><body>WP-HTML</body></html>");
    const fields = Object.fromEntries(entries.filter(([, value]) => typeof value === "string"));
    expect(fields).toEqual({ paperWidth: "8.27", paperHeight: "11.7", preferCssPageSize: "true", printBackground: "false" });
  });

  it("maps a non-OK response and a network failure to RENDERER_UNAVAILABLE", async () => {
    const down = new GotenbergPdfRenderer({ ...options, fetch: fetchReturning(new Response("boom WP-SECRET", { status: 503 })) });
    expect(await down.render("<html></html>", signal())).toEqual({ status: "error", code: "RENDERER_UNAVAILABLE" });
    const broken = new GotenbergPdfRenderer({ ...options, fetch: (async () => { throw new TypeError("connect ECONNREFUSED"); }) as typeof fetch });
    expect(await broken.render("<html></html>", signal())).toEqual({ status: "error", code: "RENDERER_UNAVAILABLE" });
  });

  it("maps its own timeout and a caller abort to RENDERER_TIMEOUT", async () => {
    const slow = new GotenbergPdfRenderer({ ...options, timeoutMs: 20, fetch: fetchWaitingForAbort });
    expect(await slow.render("<html></html>", signal())).toEqual({ status: "error", code: "RENDERER_TIMEOUT" });
    const controller = new AbortController();
    const patient = new GotenbergPdfRenderer({ ...options, timeoutMs: 30_000, fetch: fetchWaitingForAbort });
    const pending = patient.render("<html></html>", controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: "error", code: "RENDERER_TIMEOUT" });
  });

  it("rejects a body that is not a PDF, is empty or exceeds the size limit as EXPORT_RENDER_INVALID", async () => {
    const make = (body: BodyInit | null, maxResponseBytes?: number) =>
      new GotenbergPdfRenderer({ ...options, maxResponseBytes, fetch: fetchReturning(new Response(body, { status: 200 })) });
    const invalid: PdfRenderResult = { status: "error", code: "EXPORT_RENDER_INVALID" };
    expect(await make("<html>not a pdf</html>").render("<html></html>", signal())).toEqual(invalid);
    expect(await make("").render("<html></html>", signal())).toEqual(invalid);
    expect(await make(null).render("<html></html>", signal())).toEqual(invalid);
    expect(await make(new Uint8Array([0x25, 0x50, 0x44, 0x46])).render("<html></html>", signal())).toEqual(invalid);
    const big = new Uint8Array(2048);
    big.set(PDF);
    expect(await make(big, 1024).render("<html></html>", signal())).toEqual(invalid);
    expect(await make(big, 4096).render("<html></html>", signal())).toEqual({ status: "ok", pdf: expect.any(Uint8Array) });
  });

  it("limits the response to 10 MiB by default", () => {
    expect(CV_EXPORT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe("T21 explicit test fake PDF renderer", () => {
  const fake: PdfRenderer = new ExplicitTestFakePdfRenderer();
  const html = () => {
    const { document, items } = richCvFixture("id");
    return renderCvPrintHtml(buildExportRenderModel(cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items))));
  };

  it("produces an A4 PDF whose text passes the isolated parser", async () => {
    const rendered = await fake.render(html(), signal());
    expect(rendered.status).toBe("ok");
    if (rendered.status !== "ok") return;
    expect(Buffer.from(rendered.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(Buffer.from(rendered.pdf).toString("latin1")).toContain("/MediaBox [0 0 595 842]");
    const parsed = await parseInThread("pdf", rendered.pdf);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    expect(parsed.pageCount).toBe(1);
    expect(parsed.text).toContain("Siti Nurhaliza Ç. Ñuñez");
    expect(parsed.text).toContain("Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”");
    expect(parsed.text).toContain("Pengalaman");
    expect(parsed.text).not.toContain("<");
  });

  it("paginates a long document into several pages", async () => {
    const body = Array.from({ length: 160 }, (_, n) => `<p>Baris ${n + 1} dengan teks yang cukup panjang untuk uji halaman</p>`).join("");
    const rendered = await fake.render(`<html><body>${body}</body></html>`, signal());
    expect(rendered.status).toBe("ok");
    if (rendered.status !== "ok") return;
    const pages = await parseInThread("pdf-pages", rendered.pdf);
    expect(pages.status === "ok" && pages.pageCount).toBeGreaterThan(1);
  });

  it("decodes entities and drops the style block and tags", async () => {
    const rendered = await fake.render(
      "<html><head><style>.x{color:red}</style><title>T</title></head><body><h1>A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;</h1></body></html>", signal());
    expect(rendered.status).toBe("ok");
    if (rendered.status !== "ok") return;
    const raw = Buffer.from(rendered.pdf).toString("latin1");
    expect(raw).toContain("A & B <c> \"d\" 'e'");
    expect(raw).not.toContain("color:red");
  });
});
