import { crc32, deflateRawSync } from "node:zlib";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export function zipFixture(parts: Record<string, string>): Buffer {
  const files: Buffer[] = []; const entries: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const filename = Buffer.from(name); const content = Buffer.from(text); const compressed = deflateRawSync(content);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(content), 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(content.length, 22); header.writeUInt16LE(filename.length, 26);
    files.push(header, filename, compressed);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(content), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(content.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    entries.push(central, filename); offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(entries); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(parts).length, 8); end.writeUInt16LE(Object.keys(parts).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, directory, end]);
}
export function docxFixture(extra: Record<string, string> = {}): Buffer {
  return zipFixture({
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Fixture</w:t></w:r></w:p></w:body></w:document>',
    ...extra,
  });
}
