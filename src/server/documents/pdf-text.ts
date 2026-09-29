// Loaded only inside the isolated parser thread (parser-thread.ts); never in the web app.
import { IMPORT_MAX_PAGES, IMPORT_MIN_TEXT_CHARS, type ImportFileErrorCode } from "../../domain/import/contracts.ts";
import { normalizeExtractedText } from "./docx-text.ts";

export type PdfParseResult =
  | { status: "ok"; text: string; pageCount: number }
  | { status: "error"; code: ImportFileErrorCode };

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs;
}

type TextItem = { str?: unknown; hasEOL?: unknown };

function errorCode(error: unknown): ImportFileErrorCode {
  const name = error instanceof Error ? error.name : "";
  if (name === "PasswordException") return "ENCRYPTED_FILE";
  return "CORRUPT_FILE";
}

async function openTask(bytes: Uint8Array) {
  const { getDocument, VerbosityLevel } = await loadPdfJs();
  return getDocument({
    data: bytes,
    // Untrusted input: no font loading, no XFA, no network, stop on parse errors.
    // (pdf.js v6 no longer compiles code with eval, so there is no isEvalSupported switch.)
    enableXfa: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: true,
    verbosity: VerbosityLevel.ERRORS,
  });
}

/** Page count only (used for the PDF rendered from a DOCX by the isolated renderer). */
export async function countPdfPages(bytes: Uint8Array): Promise<PdfParseResult> {
  let task: Awaited<ReturnType<typeof openTask>> | null = null;
  try {
    task = await openTask(bytes);
    const document = await task.promise;
    return { status: "ok", text: "", pageCount: document.numPages };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}

/** Text of a text-based PDF. Encrypted -> ENCRYPTED_FILE, no text layer -> SCANNED_PDF. */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfParseResult> {
  let task: Awaited<ReturnType<typeof openTask>> | null = null;
  try {
    task = await openTask(bytes);
    const document = await task.promise;
    const pageCount = document.numPages;
    if (!Number.isInteger(pageCount) || pageCount < 1) return { status: "error", code: "CORRUPT_FILE" };
    if (pageCount > IMPORT_MAX_PAGES) return { status: "error", code: "TOO_MANY_PAGES" };
    const pages: string[] = [];
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items as TextItem[]) {
        if (typeof item.str === "string") text += item.str;
        if (item.hasEOL === true) text += "\n";
      }
      pages.push(text);
      page.cleanup();
    }
    const text = normalizeExtractedText(pages.join("\n\n"));
    if (text.replace(/\s/g, "").length < IMPORT_MIN_TEXT_CHARS) return { status: "error", code: "SCANNED_PDF" };
    return { status: "ok", text, pageCount };
  } catch (error) {
    return { status: "error", code: errorCode(error) };
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}
