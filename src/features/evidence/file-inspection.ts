import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import type { EvidenceMimeType } from "@/features/evidence/contracts";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCX_MAX_ENTRIES = 2_000;
const DOCX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

export class EvidenceFileValidationError extends Error {
  constructor(readonly code: "FILE_TOO_LARGE" | "FILE_SIZE_MISMATCH" | "FILE_TYPE_INVALID") {
    super("Evidence file did not pass content validation");
    this.name = "EvidenceFileValidationError";
  }
}

function readU16(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  return bytes.readUInt16LE(offset);
}

function readU32(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  return bytes.readUInt32LE(offset);
}

function decodeZipName(value: Buffer, utf8: boolean): string {
  try {
    if (!utf8 && value.some((byte) => byte > 0x7f)) throw new Error("non-ascii name");
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  }
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localOffset: number;
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimumOffset = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_EOCD) {
      const commentLength = readU16(bytes, offset + 20);
      if (offset + 22 + commentLength === bytes.length) return offset;
    }
  }
  throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
}

function hasZip64Extra(extra: Buffer): boolean {
  for (let offset = 0; offset + 4 <= extra.length;) {
    const kind = extra.readUInt16LE(offset);
    const size = extra.readUInt16LE(offset + 2);
    if (offset + 4 + size > extra.length) return true;
    if (kind === 0x0001) return true;
    offset += 4 + size;
  }
  return false;
}

function readDocxParts(bytes: Buffer): Map<string, Buffer> {
  if (bytes.length < 22) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  const endOffset = findEndOfCentralDirectory(bytes);
  const diskNumber = readU16(bytes, endOffset + 4);
  const centralDiskNumber = readU16(bytes, endOffset + 6);
  const entriesOnDisk = readU16(bytes, endOffset + 8);
  const entryCount = readU16(bytes, endOffset + 10);
  const centralSize = readU32(bytes, endOffset + 12);
  const centralOffset = readU32(bytes, endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDiskNumber !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount < 3 ||
    entryCount > DOCX_MAX_ENTRIES ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let declaredUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, offset) !== ZIP_CENTRAL) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    const flags = readU16(bytes, offset + 8);
    const method = readU16(bytes, offset + 10);
    const crc = readU32(bytes, offset + 16);
    const compressedBytes = readU32(bytes, offset + 20);
    const uncompressedBytes = readU32(bytes, offset + 24);
    const nameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const diskStart = readU16(bytes, offset + 34);
    const localOffset = readU32(bytes, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    const extraStart = nameEnd;
    const extraEnd = extraStart + extraLength;
    const entryEnd = extraEnd + commentLength;

    if (
      nameLength === 0 ||
      entryEnd > endOffset ||
      diskStart !== 0 ||
      compressedBytes === 0xffffffff ||
      uncompressedBytes === 0xffffffff ||
      (flags & 0x0001) !== 0 ||
      (flags & 0x0040) !== 0 ||
      (method !== 0 && method !== 8) ||
      hasZip64Extra(bytes.subarray(extraStart, extraEnd))
    ) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }

    const nameBytes = bytes.subarray(nameStart, nameEnd);
    const name = decodeZipName(nameBytes, (flags & 0x0800) !== 0);
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      /^[a-zA-Z]:/.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".")
    ) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
    if (!name.endsWith("/")) {
      if (names.has(name)) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
      names.add(name);
      entries.push({ name, flags, method, crc, compressedBytes, uncompressedBytes, localOffset });
      declaredUncompressedBytes += uncompressedBytes;
      if (declaredUncompressedBytes > DOCX_MAX_UNCOMPRESSED_BYTES) {
        throw new EvidenceFileValidationError("FILE_TOO_LARGE");
      }
    }
    offset = entryEnd;
  }

  if (offset !== endOffset) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  const ranges: Array<{ start: number; end: number }> = [];
  const parts = new Map<string, Buffer>();
  let totalUncompressedBytes = 0;

  for (const entry of entries) {
    const localOffset = entry.localOffset;
    if (
      localOffset + 30 > centralOffset ||
      readU32(bytes, localOffset) !== ZIP_LOCAL ||
      readU16(bytes, localOffset + 6) !== entry.flags ||
      readU16(bytes, localOffset + 8) !== entry.method
    ) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedBytes;
    const centralName = bytes.subarray(centralOffset + 46, centralOffset + 46 + 0);
    void centralName;
    if (dataEnd > centralOffset || dataEnd < dataStart) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
    const storedName = decodeZipName(bytes.subarray(localNameStart, localNameStart + localNameLength), (entry.flags & 0x0800) !== 0);
    if (storedName !== entry.name) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    ranges.push({ start: localOffset, end: dataEnd });

    const compressed = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      if (entry.method === 0) {
        content = Buffer.from(compressed);
      } else {
        const remaining = DOCX_MAX_UNCOMPRESSED_BYTES - totalUncompressedBytes;
        content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(remaining, entry.uncompressedBytes + 1)) });
      }
    } catch {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
    totalUncompressedBytes += content.length;
    if (
      content.length !== entry.uncompressedBytes ||
      totalUncompressedBytes > DOCX_MAX_UNCOMPRESSED_BYTES ||
      crc32(content) !== entry.crc
    ) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
    if (["[Content_Types].xml", "_rels/.rels", "word/document.xml"].includes(entry.name)) {
      parts.set(entry.name, content);
    }
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
    }
  }
  return parts;
}

function validateDocx(bytes: Buffer): void {
  const parts = readDocxParts(bytes);
  const contentTypes = parts.get("[Content_Types].xml");
  const relationships = parts.get("_rels/.rels");
  const document = parts.get("word/document.xml");
  if (!contentTypes || !relationships || !document) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let contentTypesXml: string;
  let relationshipsXml: string;
  let documentXml: string;
  try {
    contentTypesXml = decoder.decode(contentTypes);
    relationshipsXml = decoder.decode(relationships);
    documentXml = decoder.decode(document);
  } catch {
    throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
  }

  if (
    !/<Types\b/.test(contentTypesXml) ||
    !/http:\/\/schemas\.openxmlformats\.org\/package\/2006\/content-types/.test(contentTypesXml) ||
    !/<Override\b(?=[^>]*\bPartName=["']\/word\/document\.xml["'])(?=[^>]*\bContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["'])[^>]*\/?\s*>/s.test(contentTypesXml) ||
    !/<Relationships\b/.test(relationshipsXml) ||
    !/http:\/\/schemas\.openxmlformats\.org\/package\/2006\/relationships/.test(relationshipsXml) ||
    !/<Relationship\b(?=[^>]*\bType=["'][^"']*\/officeDocument["'])(?=[^>]*\bTarget=["']word\/document\.xml["'])[^>]*\/?\s*>/s.test(relationshipsXml) ||
    !/<(?:[a-zA-Z0-9_]+:)?document\b/.test(documentXml) ||
    !/http:\/\/schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main/.test(documentXml)
  ) {
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
