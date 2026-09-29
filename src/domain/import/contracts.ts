// Shared by the web app and the worker; keep imports relative (no "@/" alias).

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_PAGES = 20;
/** Extracted text above this is not sent to the AI provider (IMPORT_TEXT_TOO_LONG). */
export const IMPORT_MAX_TEXT_CHARS = 60_000;
/** A text layer with fewer non-whitespace characters is treated as a scan (no OCR in v0.1). */
export const IMPORT_MIN_TEXT_CHARS = 200;
export const IMPORT_PARSE_TIMEOUT_MS = 30_000;
export const IMPORT_SCAN_MAX_ATTEMPTS = 5;
export const IMPORT_MAX_RETRIES = 3;

export const IMPORT_PDF_MIME = "application/pdf";
export const IMPORT_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const IMPORT_MIME_TYPES = [IMPORT_PDF_MIME, IMPORT_DOCX_MIME] as const;
export type ImportMimeType = (typeof IMPORT_MIME_TYPES)[number];

export const IMPORT_STATUSES = ["queued", "running", "review", "committed", "failed", "cancelled"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_STAGES = ["uploading", "screening", "parsing", "extracting", "done"] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

export const IMPORT_ENTITY_TYPES = ["profile", "experience", "education", "certification", "skill", "achievement"] as const;
export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

/** File-level failures a retry cannot fix; must match internal.is_permanent_import_error(). */
export const IMPORT_PERMANENT_ERROR_CODES = [
  "FILE_EMPTY",
  "FILE_TOO_LARGE",
  "FILE_TYPE_MISMATCH",
  "UNSUPPORTED_FORMAT",
  "ENCRYPTED_FILE",
  "SCANNED_PDF",
  "CORRUPT_FILE",
  "EMPTY_DOCUMENT",
  "TOO_MANY_PAGES",
  "IMPORT_TEXT_TOO_LONG",
  "PARSER_TIMEOUT",
  "MALWARE_DETECTED",
  "UPLOAD_INCOMPLETE",
  "ACCOUNT_DELETING",
  "INVALID_IMPORT_JOB",
] as const;

export const IMPORT_TRANSIENT_ERROR_CODES = [
  "SCANNER_UNAVAILABLE",
  "STORAGE_UNAVAILABLE",
  "PAGE_COUNT_UNAVAILABLE",
  "IMPORT_WORKER_TIMEOUT",
  "CONSENT_REQUIRED",
  "CONSENT_WITHDRAWN",
  "AI_TIMEOUT",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_CONFIG_INVALID",
  "AI_REFUSED",
  "AI_OUTPUT_INVALID",
  "AI_UNAVAILABLE",
] as const;

/** Codes raised by the import RPCs and web boundary (not stored on the batch). */
export const IMPORT_REQUEST_ERROR_CODES = [
  "IMPORT_NOT_FOUND",
  "IMPORT_NOT_RETRIABLE",
  "IMPORT_NOT_CANCELLABLE",
  "IMPORT_RETRY_EXHAUSTED",
  "IMPORT_EXPIRED",
  "IMPORT_CANCELLED",
  "IDEMPOTENCY_KEY_REUSED",
] as const;

export type ImportFileErrorCode = (typeof IMPORT_PERMANENT_ERROR_CODES)[number];
export type ImportBatchErrorCode = ImportFileErrorCode | (typeof IMPORT_TRANSIENT_ERROR_CODES)[number];

export function isPermanentImportError(code: string | null | undefined): boolean {
  return typeof code === "string" && (IMPORT_PERMANENT_ERROR_CODES as readonly string[]).includes(code);
}

/** A stable file-level failure raised by inspection or parsing; never carries file content. */
export class ImportFileError extends Error {
  readonly code: ImportFileErrorCode;
  constructor(code: ImportFileErrorCode) {
    super("Import file did not pass validation");
    this.code = code;
    this.name = "ImportFileError";
  }
}
