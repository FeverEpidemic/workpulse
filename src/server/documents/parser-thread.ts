// Worker-thread entry for untrusted document parsing. It receives bytes, returns only
// { text, pageCount } or a stable code, and never prints: pdf.js warnings are silenced
// before the library loads so no document content can reach the worker's logs.
import { parentPort, workerData } from "node:worker_threads";

const silent = () => undefined;
console.log = silent;
console.info = silent;
console.warn = silent;
console.error = silent;
console.debug = silent;

type Job = { kind: "pdf" | "docx" | "pdf-pages"; bytes: Uint8Array };

async function run(job: Job) {
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
  const { countPdfPages, extractPdfText } = await import("./pdf-text.ts");
  const result = job.kind === "pdf-pages" ? await countPdfPages(job.bytes) : await extractPdfText(job.bytes);
  return result.status === "ok" && job.kind === "pdf-pages" ? { status: "ok", text: null, pageCount: result.pageCount } : result;
}

run(workerData as Job).then(
  (result) => parentPort?.postMessage(result),
  () => parentPort?.postMessage({ status: "error", code: "CORRUPT_FILE" }),
);
