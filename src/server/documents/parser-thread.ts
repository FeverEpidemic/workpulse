// Worker-thread entry for untrusted document parsing. It receives bytes, returns only
// { text, pageCount } (plus rule extraction when asked) or a stable code, and never prints: pdf.js warnings are silenced
// before the library loads so no document content can reach the worker's logs.
import { parentPort, workerData } from "node:worker_threads";

const silent = () => undefined;
console.log = silent;
console.info = silent;
console.warn = silent;
console.error = silent;
console.debug = silent;

type Job = { kind: "pdf" | "docx" | "pdf-pages" | "pdf-export"; bytes: Uint8Array; extract?: boolean };
type Result = {
  status: string; text?: string | null; pageCount?: number | null; code?: string;
  extraction?: unknown; extractionFailed?: boolean;
};

// T26: the rule extractor runs on the final text in this thread, under the same heap limit and timeout. A throw is
// reported as a flag only; the message never leaves the thread.
async function withExtraction(job: Job, result: Result): Promise<Result> {
  if (!job.extract || result.status !== "ok" || typeof result.text !== "string") return result;
  const { extractImportByRules } = await import("../../domain/import/rules-extract.ts");
  try {
    return { ...result, extraction: extractImportByRules(result.text), extractionFailed: false };
  } catch {
    return { ...result, extraction: null, extractionFailed: true };
  }
}

async function run(job: Job): Promise<Result> {
  return withExtraction(job, await read(job));
}

async function read(job: Job): Promise<Result> {
  if (job.kind === "docx") {
    const { OoxmlZipError, readWordDocument } = await import("./ooxml-zip.ts");
    const { extractDocxText } = await import("./docx-text.ts");
    try {
      const { documentXml } = readWordDocument(Buffer.from(job.bytes));
      const text = extractDocxText(documentXml);
      if (text.replace(/\s/g, "") === "") return { status: "error", code: "EMPTY_DOCUMENT" };
      return { status: "ok", text, pageCount: null };
    } catch (error) {
      return { status: "error", code: error instanceof OoxmlZipError && error.code === "TOO_LARGE" ? "FILE_TOO_LARGE" : "CORRUPT_FILE" };
    }
  }
  const { countPdfPages, extractPdfText, readExportPdf } = await import("./pdf-text.ts");
  const result = job.kind === "pdf-pages"
    ? await countPdfPages(job.bytes)
    : job.kind === "pdf-export" ? await readExportPdf(job.bytes) : await extractPdfText(job.bytes);
  return result.status === "ok" && job.kind === "pdf-pages" ? { status: "ok", text: null, pageCount: result.pageCount } : result;
}

run(workerData as Job).then(
  (result) => parentPort?.postMessage(result),
  () => parentPort?.postMessage({ status: "error", code: "CORRUPT_FILE" }),
);
