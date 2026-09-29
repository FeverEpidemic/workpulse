import { createHash } from "node:crypto";

import type { EvidenceMimeType } from "@/features/evidence/contracts";
import { OoxmlZipError, readWordDocument } from "@/server/documents/ooxml-zip";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export class EvidenceFileValidationError extends Error {
  constructor(readonly code: "FILE_TOO_LARGE" | "FILE_SIZE_MISMATCH" | "FILE_TYPE_INVALID") {
    super("Evidence file did not pass content validation");
    this.name = "EvidenceFileValidationError";
  }
}

// The bounded ZIP/OOXML reader is shared with CV import (src/server/documents/ooxml-zip.ts).
function validateDocx(bytes: Buffer): void {
  try {
    readWordDocument(bytes);
  } catch (error) {
    if (error instanceof OoxmlZipError && error.code === "TOO_LARGE") throw new EvidenceFileValidationError("FILE_TOO_LARGE");
    throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  }
}

export function inspectEvidenceBytes(bytes: Buffer): EvidenceMimeType {
  if (bytes.length < 1) throw new EvidenceFileValidationError("FILE_SIZE_MISMATCH");
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";

  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(pngSignature) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0
  ) {
    return "image/png";
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    return "image/jpeg";
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    validateDocx(bytes);
    return DOCX_MIME;
  }
  throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readBoundedBody(
  stream: ReadableStream<Uint8Array> | null,
  expectedBytes: number,
  timeoutMs = 300_000,
): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > 10 * 1024 * 1024) {
    throw new EvidenceFileValidationError("FILE_TOO_LARGE");
  }
  if (!stream) throw new EvidenceFileValidationError("FILE_SIZE_MISMATCH");
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new EvidenceFileValidationError("FILE_SIZE_MISMATCH"));
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
      if (value.byteLength > expectedBytes - total) {
        await reader.cancel().catch(() => undefined);
        throw new EvidenceFileValidationError(
          expectedBytes < 10 * 1024 * 1024 ? "FILE_SIZE_MISMATCH" : "FILE_TOO_LARGE",
        );
      }
      total += value.byteLength;
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof EvidenceFileValidationError) throw error;
    throw new EvidenceFileValidationError("FILE_SIZE_MISMATCH");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  if (total !== expectedBytes) throw new EvidenceFileValidationError("FILE_SIZE_MISMATCH");
  return Buffer.concat(chunks, total);
}
