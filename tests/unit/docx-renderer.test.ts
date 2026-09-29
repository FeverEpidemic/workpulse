import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  ExplicitTestFakeDocxRenderer,
  GotenbergDocxRenderer,
  resolveDocxRenderer,
  UnavailableDocxRenderer,
} from "@/server/documents/docx-renderer";

import { cvDocx, cvPdf, CV_LINES } from "../import-fixtures";

const countPdfPages = async () => ({ status: "ok" as const, pageCount: 3 });
let server: Server | null = null;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = null;
});

async function serve(handler: (request: IncomingMessage, body: Buffer) => { status: number; body?: Buffer; delayMs?: number }) {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const reply = handler(request, Buffer.concat(chunks));
      setTimeout(() => {
        response.writeHead(reply.status, { "content-type": "application/pdf" });
        response.end(reply.body ?? Buffer.alloc(0));
      }, reply.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("T15 DOCX page renderer", () => {
  it("defaults to unavailable and refuses the fake in production", async () => {
    expect(resolveDocxRenderer({ mode: undefined, nodeEnv: "production", countPdfPages })).toBeInstanceOf(UnavailableDocxRenderer);
    expect(await new UnavailableDocxRenderer().countPages()).toEqual({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" });
    expect(() => resolveDocxRenderer({ mode: "fake", nodeEnv: "production", countPdfPages })).toThrow("FAKE_RENDERER_NOT_ALLOWED_IN_PRODUCTION");
    expect(resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages })).toBeInstanceOf(ExplicitTestFakeDocxRenderer);
  });

  it("fails closed on an unsafe or incomplete Gotenberg configuration", () => {
    for (const baseUrl of ["", "ftp://127.0.0.1:13400", "http://user:pw@127.0.0.1:13400", "http://example.com:3000", "https://x.test/?q=1"]) {
      expect(resolveDocxRenderer({ mode: "gotenberg", nodeEnv: "production", baseUrl, countPdfPages })).toBeInstanceOf(UnavailableDocxRenderer);
    }
    expect(resolveDocxRenderer({ mode: "gotenberg", baseUrl: "http://127.0.0.1:13400", timeoutMs: 10, countPdfPages }))
      .toBeInstanceOf(UnavailableDocxRenderer);
    expect(resolveDocxRenderer({ mode: "gotenberg", baseUrl: "http://127.0.0.1:13400", countPdfPages })).toBeInstanceOf(GotenbergDocxRenderer);
  });

  it("fake counts explicit page breaks, not docProps metadata", async () => {
    const renderer = new ExplicitTestFakeDocxRenderer();
    expect(await renderer.countPages(cvDocx(CV_LINES, { pages: 21, appPages: 1 }))).toEqual({ status: "ok", pageCount: 21 });
    expect(await renderer.countPages(cvDocx(CV_LINES, { pages: 1, appPages: 40 }))).toEqual({ status: "ok", pageCount: 1 });
  });

  it("posts only the DOCX bytes under a generic name and counts the returned PDF", async () => {
    let received = "";
    const baseUrl = await serve((request, body) => {
      received = `${request.method} ${request.url} ${body.toString("latin1")}`;
      return { status: 200, body: cvPdf(3) };
    });
    const renderer = new GotenbergDocxRenderer({ baseUrl, countPdfPages });
    expect(await renderer.countPages(cvDocx(), AbortSignal.timeout(5_000))).toEqual({ status: "ok", pageCount: 3 });
    expect(received).toContain("POST /forms/libreoffice/convert");
    expect(received).toContain('filename="document.docx"');
    expect(received).not.toContain("WP-FILENAME-SENTINEL");
  });

  it("maps renderer errors, timeouts, oversized and non-PDF responses to PAGE_COUNT_UNAVAILABLE", async () => {
    const unavailable = { status: "error", code: "PAGE_COUNT_UNAVAILABLE" };
    let baseUrl = await serve(() => ({ status: 500 }));
    expect(await new GotenbergDocxRenderer({ baseUrl, countPdfPages }).countPages(cvDocx(), AbortSignal.timeout(5_000))).toEqual(unavailable);
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    baseUrl = await serve(() => ({ status: 200, body: Buffer.from("<html>not a pdf</html>") }));
    expect(await new GotenbergDocxRenderer({ baseUrl, countPdfPages }).countPages(cvDocx(), AbortSignal.timeout(5_000))).toEqual(unavailable);
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    baseUrl = await serve(() => ({ status: 200, body: Buffer.concat([cvPdf(1), Buffer.alloc(2048)]) }));
    expect(await new GotenbergDocxRenderer({ baseUrl, countPdfPages, maxResponseBytes: 1024 }).countPages(cvDocx(), AbortSignal.timeout(5_000)))
      .toEqual(unavailable);
    await new Promise<void>((resolve) => server!.close(() => resolve()));

    baseUrl = await serve(() => ({ status: 200, body: cvPdf(1), delayMs: 2_000 }));
    expect(await new GotenbergDocxRenderer({ baseUrl, countPdfPages, timeoutMs: 200 }).countPages(cvDocx(), AbortSignal.timeout(5_000)))
      .toEqual(unavailable);

    expect(await new GotenbergDocxRenderer({ baseUrl: "http://127.0.0.1:1", countPdfPages }).countPages(cvDocx(), AbortSignal.timeout(5_000)))
      .toEqual(unavailable);
  });
});
