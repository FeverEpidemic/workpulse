import { describe, expect, it } from "vitest";
import { inspectEvidenceBytes, readBoundedBody } from "@/features/evidence/file-inspection";
import { docxFixture, DOCX_MIME, zipFixture } from "../evidence-fixtures";

describe("evidence file safety", () => {
  it("accepts a bounded DOCX package but rejects generic ZIP and traversal entries", () => {
    expect(inspectEvidenceBytes(docxFixture())).toBe(DOCX_MIME);
    expect(() => inspectEvidenceBytes(zipFixture({ "text.txt": "not a document" }))).toThrow();
    expect(() => inspectEvidenceBytes(docxFixture({ "../escape": "invalid" }))).toThrow();
  });
  it("rejects damaged ZIP payloads and excessive uncompressed data", () => {
    const corrupt = docxFixture(); corrupt[80] = corrupt[80]! ^ 0xff;
    expect(() => inspectEvidenceBytes(corrupt)).toThrow();
    expect(() => inspectEvidenceBytes(docxFixture({ "large.txt": "x".repeat(51 * 1024 * 1024) }))).toThrow();
  });
  it("rejects oversize and mismatched streams before accepting bytes", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(11)); c.close(); } });
    await expect(readBoundedBody(stream, 10)).rejects.toMatchObject({ code: "FILE_SIZE_MISMATCH" });
    await expect(readBoundedBody(null, 10 * 1024 * 1024 + 1)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
  it("bounds an upload that never finishes", async () => {
    const stream = new ReadableStream<Uint8Array>();
    await expect(readBoundedBody(stream, 1, 20)).rejects.toMatchObject({ code: "FILE_SIZE_MISMATCH" });
  });
});
