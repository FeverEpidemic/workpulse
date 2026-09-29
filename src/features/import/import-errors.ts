import { randomUUID } from "node:crypto";

import type { MessageKey } from "@/i18n/messages";

export type ImportServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONSENT_REQUIRED"
  | "UNAVAILABLE"
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_TYPE_MISMATCH"
  | "UNSUPPORTED_FORMAT"
  | "ENCRYPTED_FILE"
  | "CORRUPT_FILE"
  | "UPLOAD_INCOMPLETE"
  | "NOT_RETRIABLE"
  | "NOT_CANCELLABLE"
  | "RETRY_EXHAUSTED"
  | "EXPIRED";

const MESSAGE_KEYS: Record<ImportServiceErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  UNAUTHENTICATED: "auth.signInRequired",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  CONSENT_REQUIRED: "import.error.consentRequired",
  UNAVAILABLE: "error.unavailable",
  FILE_EMPTY: "import.failed.FILE_EMPTY",
  FILE_TOO_LARGE: "import.failed.FILE_TOO_LARGE",
  FILE_TYPE_MISMATCH: "import.failed.FILE_TYPE_MISMATCH",
  UNSUPPORTED_FORMAT: "import.failed.UNSUPPORTED_FORMAT",
  ENCRYPTED_FILE: "import.failed.ENCRYPTED_FILE",
  CORRUPT_FILE: "import.failed.CORRUPT_FILE",
  UPLOAD_INCOMPLETE: "import.failed.UPLOAD_INCOMPLETE",
  NOT_RETRIABLE: "import.error.notRetriable",
  NOT_CANCELLABLE: "import.error.notCancellable",
  RETRY_EXHAUSTED: "import.retry.exhausted",
  EXPIRED: "import.retry.expired",
};

const HTTP_STATUS: Record<ImportServiceErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  CONSENT_REQUIRED: 409,
  UNAVAILABLE: 503,
  FILE_EMPTY: 422,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_MISMATCH: 422,
  UNSUPPORTED_FORMAT: 422,
  ENCRYPTED_FILE: 422,
  CORRUPT_FILE: 422,
  UPLOAD_INCOMPLETE: 400,
  NOT_RETRIABLE: 409,
  NOT_CANCELLABLE: 409,
  RETRY_EXHAUSTED: 409,
  EXPIRED: 409,
};

/** Safe, localized import error with a correlation ID. Never carries file names or content. */
export class ImportServiceError extends Error {
  readonly code: ImportServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly status: number;
  readonly correlationId: string;

  constructor(code: ImportServiceErrorCode) {
    super("Import request could not be completed.");
    this.name = "ImportServiceError";
    this.code = code;
    this.messageKey = MESSAGE_KEYS[code];
    this.status = HTTP_STATUS[code];
    this.correlationId = randomUUID();
  }
}

/** Database errors carry stable codes only; another account's batch is indistinguishable from none. */
export function mapImportDatabaseError(error: { code?: string; message?: string }): ImportServiceError {
  switch (error.message) {
    case "AUTH_REQUIRED": return new ImportServiceError("UNAUTHENTICATED");
    case "CONSENT_REQUIRED": return new ImportServiceError("CONSENT_REQUIRED");
    case "IMPORT_NOT_FOUND": return new ImportServiceError("NOT_FOUND");
    case "IDEMPOTENCY_KEY_REUSED": return new ImportServiceError("CONFLICT");
    case "IMPORT_NOT_RETRIABLE": return new ImportServiceError("NOT_RETRIABLE");
    case "IMPORT_NOT_CANCELLABLE": return new ImportServiceError("NOT_CANCELLABLE");
    case "IMPORT_RETRY_EXHAUSTED": return new ImportServiceError("RETRY_EXHAUSTED");
    case "IMPORT_EXPIRED": return new ImportServiceError("EXPIRED");
    case "INVALID_IMPORT_UPLOAD": return new ImportServiceError("VALIDATION");
    default: break;
  }
  if (error.code === "42501") return new ImportServiceError("UNAUTHENTICATED");
  if (error.code === "22023" || error.code === "22P02") return new ImportServiceError("VALIDATION");
  return new ImportServiceError("UNAVAILABLE");
}

export function toImportServiceError(error: unknown): ImportServiceError {
  return error instanceof ImportServiceError ? error : new ImportServiceError("UNAVAILABLE");
}
