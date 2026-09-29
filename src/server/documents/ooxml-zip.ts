// Shared by the web app and the worker; keep imports relative (no "@/" alias).
import { inflateRawSync } from "node:zlib";

/** Bounded ZIP/OOXML reader moved from the T10 evidence inspector; behavior is unchanged. */
export const OOXML_MAX_ENTRIES = 2_000;
export const OOXML_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;

/** INVALID = not a well-formed, unencrypted, non-overlapping ZIP; TOO_LARGE = uncompressed limit. */
export class OoxmlZipError extends Error {
  readonly code: "INVALID" | "TOO_LARGE";
  constructor(code: "INVALID" | "TOO_LARGE") {
    super("OOXML package did not pass validation");
    this.code = code;
    this.name = "OoxmlZipError";
  }
}

function readU16(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new OoxmlZipError("INVALID");
  return bytes.readUInt16LE(offset);
}

function readU32(bytes: Buffer, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new OoxmlZipError("INVALID");
  return bytes.readUInt32LE(offset);
}

function decodeZipName(value: Buffer, utf8: boolean): string {
  try {
    if (!utf8 && value.some((byte) => byte > 0x7f)) throw new Error("non-ascii name");
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new OoxmlZipError("INVALID");
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
  throw new OoxmlZipError("INVALID");
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

export type OoxmlPackage = {
  /** Every file entry name in the archive. */
  names: Set<string>;
  /** Decompressed content of the requested parts that exist. */
  parts: Map<string, Buffer>;
};

/**
 * Validate the whole archive (every entry inflated, CRC-checked, bounded) and return the
 * requested parts. The total uncompressed output is capped before allocation per entry.
 */
export function readOoxmlPackage(bytes: Buffer, wanted: readonly string[]): OoxmlPackage {
  if (bytes.length < 22) throw new OoxmlZipError("INVALID");
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
    entryCount > OOXML_MAX_ENTRIES ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new OoxmlZipError("INVALID");
  }

  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let offset = centralOffset;
  let declaredUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, offset) !== ZIP_CENTRAL) throw new OoxmlZipError("INVALID");
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
      throw new OoxmlZipError("INVALID");
    }

    const name = decodeZipName(bytes.subarray(nameStart, nameEnd), (flags & 0x0800) !== 0);
    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.includes("\0") ||
      /^[a-zA-Z]:/.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".")
    ) {
      throw new OoxmlZipError("INVALID");
    }
    if (!name.endsWith("/")) {
      if (names.has(name)) throw new OoxmlZipError("INVALID");
      names.add(name);
      entries.push({ name, flags, method, crc, compressedBytes, uncompressedBytes, localOffset });
      declaredUncompressedBytes += uncompressedBytes;
      if (declaredUncompressedBytes > OOXML_MAX_UNCOMPRESSED_BYTES) {
        throw new OoxmlZipError("TOO_LARGE");
      }
    }
    offset = entryEnd;
  }

  if (offset !== endOffset) throw new OoxmlZipError("INVALID");
  const wantedNames = new Set(wanted);
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
      throw new OoxmlZipError("INVALID");
    }
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const localNameStart = localOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + entry.compressedBytes;
    if (dataEnd > centralOffset || dataEnd < dataStart) {
      throw new OoxmlZipError("INVALID");
    }
    const storedName = decodeZipName(bytes.subarray(localNameStart, localNameStart + localNameLength), (entry.flags & 0x0800) !== 0);
    if (storedName !== entry.name) throw new OoxmlZipError("INVALID");
    ranges.push({ start: localOffset, end: dataEnd });

    const compressed = bytes.subarray(dataStart, dataEnd);
    let content: Buffer;
    try {
      if (entry.method === 0) {
        content = Buffer.from(compressed);
      } else {
        const remaining = OOXML_MAX_UNCOMPRESSED_BYTES - totalUncompressedBytes;
        content = inflateRawSync(compressed, { maxOutputLength: Math.max(1, Math.min(remaining, entry.uncompressedBytes + 1)) });
      }
    } catch {
      throw new OoxmlZipError("INVALID");
    }
    totalUncompressedBytes += content.length;
    if (
      content.length !== entry.uncompressedBytes ||
      totalUncompressedBytes > OOXML_MAX_UNCOMPRESSED_BYTES ||
      crc32(content) !== entry.crc
    ) {
      throw new OoxmlZipError("INVALID");
    }
    if (wantedNames.has(entry.name)) parts.set(entry.name, content);
  }

  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new OoxmlZipError("INVALID");
    }
  }
  return { names, parts };
}

export const WORD_DOCUMENT_PARTS = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"] as const;

/** Decoded core parts of a WordprocessingML package, or INVALID when it is not one. */
export function readWordDocument(bytes: Buffer, extraParts: readonly string[] = []): {
  names: Set<string>;
  contentTypesXml: string;
  documentXml: string;
} {
  const { names, parts } = readOoxmlPackage(bytes, [...WORD_DOCUMENT_PARTS, ...extraParts]);
  const contentTypes = parts.get("[Content_Types].xml");
  const relationships = parts.get("_rels/.rels");
  const document = parts.get("word/document.xml");
  if (!contentTypes || !relationships || !document) throw new OoxmlZipError("INVALID");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let contentTypesXml: string;
  let relationshipsXml: string;
  let documentXml: string;
  try {
    contentTypesXml = decoder.decode(contentTypes);
    relationshipsXml = decoder.decode(relationships);
    documentXml = decoder.decode(document);
  } catch {
    throw new OoxmlZipError("INVALID");
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
    throw new OoxmlZipError("INVALID");
  }
  return { names, contentTypesXml, documentXml };
}
