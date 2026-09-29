// Shared by the web app and the worker; keep imports relative (no "@/" alias).
import {
  IMPORT_DOCX_MIME,
  IMPORT_MAX_BYTES,
  IMPORT_PDF_MIME,
  ImportFileError,
  type ImportMimeType,
} from "../../domain/import/contracts.ts";
import { OoxmlZipError, readOoxmlPackage, readWordDocument } from "./ooxml-zip.ts";

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ENCRYPTED_PACKAGE_UTF16 = Buffer.from("EncryptedPackage", "utf16le");

/**
 * Upload-time signature check for CV import. Page count and text are NOT read here: that
 * happens in the isolated worker parser after malware screening.
 */
export function inspectImportBytes(bytes: Buffer): ImportMimeType {
  if (bytes.length < 1) throw new ImportFileError("FILE_EMPTY");
  if (bytes.length > IMPORT_MAX_BYTES) throw new ImportFileError("FILE_TOO_LARGE");

  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return IMPORT_PDF_MIME;

  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(CFB_SIGNATURE)) {
    // Password-protected Office files are CFB containers holding an EncryptedPackage stream;
    // any other CFB file (legacy .doc, .xls, ...) is simply unsupported.
    throw new ImportFileError(bytes.includes(ENCRYPTED_PACKAGE_UTF16) ? "ENCRYPTED_FILE" : "UNSUPPORTED_FORMAT");
  }

  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    try {
      readOoxmlPackage(bytes, []);
    } catch (error) {
      if (error instanceof OoxmlZipError && error.code === "TOO_LARGE") throw new ImportFileError("FILE_TOO_LARGE");
      throw new ImportFileError("CORRUPT_FILE");
    }
    let pkg: ReturnType<typeof readWordDocument>;
    try {
      pkg = readWordDocument(bytes);
    } catch {
      // A well-formed ZIP that is not a WordprocessingML package (xlsx, odt, plain zip).
      throw new ImportFileError("UNSUPPORTED_FORMAT");
    }
    if (pkg.names.has("word/vbaProject.bin") || /macroEnabled/i.test(pkg.contentTypesXml)) {
      throw new ImportFileError("UNSUPPORTED_FORMAT");
    }
    return IMPORT_DOCX_MIME;
  }

  throw new ImportFileError("UNSUPPORTED_FORMAT");
}
