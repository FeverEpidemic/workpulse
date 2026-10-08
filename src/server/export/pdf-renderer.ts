// Worker-only; keep imports relative (no "@/" alias).
import { CV_EXPORT_MAX_BYTES } from "../../domain/cv/export.ts";

export type PdfRendererMode = "gotenberg" | "fake" | "unavailable";

export type PdfRenderErrorCode = "RENDERER_UNAVAILABLE" | "RENDERER_TIMEOUT" | "EXPORT_RENDER_INVALID";

export type PdfRenderResult =
  | { status: "ok"; pdf: Uint8Array }
  | { status: "error"; code: PdfRenderErrorCode };

/**
 * Turns the CV print document (HTML) into PDF bytes in an isolated process. Page count, size and text of the
 * result are verified by the worker; the renderer only reports a stable code, never a body or a message.
 */
export interface PdfRenderer {
  readonly kind: PdfRendererMode;
  render(html: string, signal: AbortSignal): Promise<PdfRenderResult>;
}

export const PDF_RENDER_DEFAULT_TIMEOUT_MS = 60_000;

export class UnavailablePdfRenderer implements PdfRenderer {
  readonly kind = "unavailable" as const;
  async render(): Promise<PdfRenderResult> {
    return { status: "error", code: "RENDERER_UNAVAILABLE" };
  }
}

// --- Explicit test fake -----------------------------------------------------------------------------------------------

const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
};

function toWinAnsi(char: string): number {
  const mapped = WIN_ANSI[char];
  if (mapped !== undefined) return mapped;
  const code = char.codePointAt(0) ?? 0x3f;
  return code >= 0x20 && code <= 0xff && !(code >= 0x7f && code <= 0x9f) ? code : 0x3f;
}

function pdfString(line: string): Buffer {
  const bytes: number[] = [0x28];
  for (const char of line) {
    const byte = toWinAnsi(char);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) bytes.push(0x5c);
    bytes.push(byte);
  }
  bytes.push(0x29);
  return Buffer.from(bytes);
}

function htmlToLines(html: string): string[] {
  const body = html
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|h1|h2|h3|li|header|section|ul|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const lines: string[] = [];
  for (const raw of body.split("\n")) {
    const text = raw.replace(/[ \t]+/g, " ").trim();
    if (text === "") continue;
    let rest = text;
    while (rest.length > 95) {
      const cut = rest.lastIndexOf(" ", 95);
      const at = cut > 40 ? cut : 95;
      lines.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    lines.push(rest);
  }
  return lines;
}

const FAKE_LINES_PER_PAGE = 52;

/**
 * Development and test only (refused in production): a minimal A4 PDF with Helvetica text, one page per 52 lines.
 * It extracts the text of the print document, so the pipeline can be exercised without Chromium; it never proves
 * real layout, fonts or page breaks.
 */
export class ExplicitTestFakePdfRenderer implements PdfRenderer {
  readonly kind = "fake" as const;

  async render(html: string): Promise<PdfRenderResult> {
    const lines = htmlToLines(html);
    const pages: string[][] = [];
    for (let at = 0; at < Math.max(lines.length, 1); at += FAKE_LINES_PER_PAGE) pages.push(lines.slice(at, at + FAKE_LINES_PER_PAGE));
    // Objects: 1 catalog, 2 pages, 3 font, then (page, content) pairs.
    const objects: Buffer[] = [];
    const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
    objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
    objects.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
    objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
    pages.forEach((pageLines, index) => {
      objects.push(Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
      ));
      const parts: Buffer[] = [Buffer.from("BT /F1 10 Tf 14 TL 50 800 Td\n")];
      for (const line of pageLines) parts.push(pdfString(line), Buffer.from(" Tj T*\n"));
      parts.push(Buffer.from("ET"));
      const stream = Buffer.concat(parts);
      objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]));
    });
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
    const offsets: number[] = [];
    let size = chunks[0]!.length;
    objects.forEach((object, index) => {
      offsets.push(size);
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
      chunks.push(chunk);
      size += chunk.length;
    });
    const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)].join("");
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
    return { status: "ok", pdf: new Uint8Array(Buffer.concat(chunks)) };
  }
}

// --- Gotenberg (Chromium) -----------------------------------------------------------------------------------------------

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

export type GotenbergPdfRendererOptions = {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  maxResponseBytes?: number;
};

/**
 * Gotenberg Chromium route in a separate container (docs/verification/T21-pdf-renderer-runbook.md). Only the
 * print document is sent, as one generic part named index.html; the response is capped and must be a PDF.
 */
export class GotenbergPdfRenderer implements PdfRenderer {
  readonly kind = "gotenberg" as const;
  private readonly options: GotenbergPdfRendererOptions;
  private readonly endpoint: string;

  constructor(options: GotenbergPdfRendererOptions) {
    this.options = options;
    this.endpoint = `${options.baseUrl.replace(/\/+$/, "")}/forms/chromium/convert/html`;
  }

  async render(html: string, signal: AbortSignal): Promise<PdfRenderResult> {
    const form = new FormData();
    form.append("files", new Blob([html], { type: "text/html" }), "index.html");
    form.append("paperWidth", "8.27");
    form.append("paperHeight", "11.7");
    form.append("preferCssPageSize", "true");
    form.append("printBackground", "false");
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? PDF_RENDER_DEFAULT_TIMEOUT_MS);
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.endpoint, { method: "POST", body: form, signal: combined });
    } catch {
      return { status: "error", code: combined.aborted ? "RENDERER_TIMEOUT" : "RENDERER_UNAVAILABLE" };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", code: combined.aborted ? "RENDERER_TIMEOUT" : "RENDERER_UNAVAILABLE" };
    }
    const pdf = await readLimited(response, this.options.maxResponseBytes ?? CV_EXPORT_MAX_BYTES);
    if (!pdf) return { status: "error", code: combined.aborted ? "RENDERER_TIMEOUT" : "EXPORT_RENDER_INVALID" };
    if (pdf.byteLength < 5 || Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      return { status: "error", code: "EXPORT_RENDER_INVALID" };
    }
    return { status: "ok", pdf };
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

export type PdfRendererOptions = {
  mode?: string;
  nodeEnv?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Default unavailable; fake refused outside development/test; bad configuration fails closed. */
export function resolvePdfRenderer(options: PdfRendererOptions = {}): PdfRenderer {
  const mode = options.mode ?? process.env.WORKPULSE_PDF_RENDERER_MODE ?? "unavailable";
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (mode === "fake") {
    if (nodeEnv !== "development" && nodeEnv !== "test") throw new Error("FAKE_RENDERER_NOT_ALLOWED_IN_PRODUCTION");
    return new ExplicitTestFakePdfRenderer();
  }
  if (mode === "gotenberg") {
    const baseUrl = (options.baseUrl ?? process.env.WORKPULSE_PDF_GOTENBERG_URL ?? "").trim();
    const rawTimeout = options.timeoutMs ?? Number(process.env.WORKPULSE_PDF_RENDER_TIMEOUT_MS ?? PDF_RENDER_DEFAULT_TIMEOUT_MS);
    if (!isAllowedBaseUrl(baseUrl) || !Number.isInteger(rawTimeout) || rawTimeout < 1_000 || rawTimeout > 90_000) {
      return new UnavailablePdfRenderer();
    }
    return new GotenbergPdfRenderer({ baseUrl, timeoutMs: rawTimeout, fetch: options.fetch });
  }
  return new UnavailablePdfRenderer();
}
