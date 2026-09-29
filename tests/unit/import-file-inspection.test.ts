import { describe, expect, it } from "vitest";

import { ImportFileError } from "@/domain/import/contracts";
import { inspectImportBytes } from "@/server/documents/import-file-inspection";
import { OoxmlZipError, readOoxmlPackage } from "@/server/documents/ooxml-zip";

import {
  cvDocx, cvPdf, DOCX_MIME, emptyDocx, encryptedOfficeFile, legacyDocFile, macroDocx, PDF_MIME,
  spreadsheetZip, zipBombDocx,
} from "../import-fixtures";

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof ImportFileError ? error.code : "UNEXPECTED";
  }
}

describe("T15 import upload inspection", () => {
  it("accepts a PDF by signature and a real DOCX package", () => {
    expect(inspectImportBytes(cvPdf())).toBe(PDF_MIME);
    expect(inspectImportBytes(cvDocx())).toBe(DOCX_MIME);
    expect(inspectImportBytes(emptyDocx())).toBe(DOCX_MIME);
  });

  it("rejects empty and oversized input before reading content", () => {
    expect(codeOf(() => inspectImportBytes(Buffer.alloc(0)))).toBe("FILE_EMPTY");
    expect(codeOf(() => inspectImportBytes(Buffer.alloc(10 * 1024 * 1024 + 1, 0x25)))).toBe("FILE_TOO_LARGE");
  });

  it("rejects images, plain text and non-Word ZIP packages as unsupported", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    expect(codeOf(() => inspectImportBytes(png))).toBe("UNSUPPORTED_FORMAT");
    expect(codeOf(() => inspectImportBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9])))).toBe("UNSUPPORTED_FORMAT");
    expect(codeOf(() => inspectImportBytes(Buffer.from("Curriculum vitae in plain text")))).toBe("UNSUPPORTED_FORMAT");
    expect(codeOf(() => inspectImportBytes(spreadsheetZip()))).toBe("UNSUPPORTED_FORMAT");
  });

  it("rejects macro-enabled DOCX packages", () => {
    expect(codeOf(() => inspectImportBytes(macroDocx()))).toBe("UNSUPPORTED_FORMAT");
    const macroContentType = cvDocx(undefined, {
      extra: {
        "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>',
      },
    });
    expect(codeOf(() => inspectImportBytes(macroContentType))).toBe("UNSUPPORTED_FORMAT");
  });

  it("distinguishes password-protected Office files from legacy CFB documents", () => {
    expect(codeOf(() => inspectImportBytes(encryptedOfficeFile()))).toBe("ENCRYPTED_FILE");
    expect(codeOf(() => inspectImportBytes(legacyDocFile()))).toBe("UNSUPPORTED_FORMAT");
  });

  it("treats a truncated DOCX as corrupt and a ZIP bomb as too large", () => {
    const docx = cvDocx();
    expect(codeOf(() => inspectImportBytes(docx.subarray(0, docx.length - 10)))).toBe("CORRUPT_FILE");
    expect(codeOf(() => inspectImportBytes(zipBombDocx()))).toBe("FILE_TOO_LARGE");
  });
});

describe("shared OOXML reader", () => {
  it("returns requested parts and all entry names", () => {
    const pkg = readOoxmlPackage(cvDocx(), ["word/document.xml", "missing.xml"]);
    expect(pkg.names.has("docProps/app.xml")).toBe(true);
    expect(pkg.parts.get("word/document.xml")?.toString("utf8")).toContain("PT Sentinel Nusantara");
    expect(pkg.parts.has("missing.xml")).toBe(false);
  });

  it("rejects an entry whose real size exceeds its declared size without inflating it fully", () => {
    const docx = Buffer.from(cvDocx());
    // Lower the declared uncompressed size of the first central directory entry.
    const central = docx.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    docx.writeUInt32LE(1, central + 24);
    expect(() => readOoxmlPackage(docx, [])).toThrow(OoxmlZipError);
  });
});
