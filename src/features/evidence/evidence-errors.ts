import { randomUUID } from "node:crypto";

export type EvidenceErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION"
  | "FILE_TOO_LARGE"
  | "FILE_SIZE_MISMATCH"
  | "FILE_TYPE_INVALID"
  | "RESERVATION_EXPIRED"
  | "EVIDENCE_NOT_FOUND"
  | "EVIDENCE_SLOT_LIMIT"
  | "EVIDENCE_QUOTA_EXCEEDED"
  | "IDEMPOTENCY_CONFLICT"
  | "CONFLICT"
  | "UPLOAD_INCOMPLETE"
  | "STORAGE_OBJECT_CONFLICT"
  | "PROVIDER_UNAVAILABLE";

const httpStatusByCode: Record<EvidenceErrorCode, number> = {
  AUTH_REQUIRED: 401,
  VALIDATION: 400,
  FILE_TOO_LARGE: 413,
  FILE_SIZE_MISMATCH: 422,
  FILE_TYPE_INVALID: 422,
  RESERVATION_EXPIRED: 410,
  EVIDENCE_NOT_FOUND: 404,
  EVIDENCE_SLOT_LIMIT: 409,
  EVIDENCE_QUOTA_EXCEEDED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CONFLICT: 409,
  UPLOAD_INCOMPLETE: 400,
  STORAGE_OBJECT_CONFLICT: 409,
  PROVIDER_UNAVAILABLE: 503,
};

export class EvidenceError extends Error {
  readonly correlationId: string;
  readonly status: number;

  constructor(readonly code: EvidenceErrorCode, correlationId = randomUUID()) {
    super("Evidence request could not be completed");
    this.name = "EvidenceError";
    this.correlationId = correlationId;
    this.status = httpStatusByCode[code];
  }
}

export type EvidenceRepositoryErrorCode =
  | "STALE_REVISION"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RESERVATION_EXPIRED"
  | "AUTH_REQUIRED"
  | "EVIDENCE_SLOT_LIMIT"
  | "EVIDENCE_QUOTA_EXCEEDED"
  | "INVALID_EVIDENCE_SIZE"
  | "EVIDENCE_MIME_MISMATCH"
  | "INVALID_EVIDENCE_HASH"
  | "EVIDENCE_STATE_CONFLICT"
  | "EVIDENCE_MOVE_STATE_CONFLICT"
  | "EVIDENCE_STORAGE_CONFLICT"
  | "PROVIDER_UNAVAILABLE";

export class EvidenceRepositoryError extends Error {
  constructor(readonly code: EvidenceRepositoryErrorCode) {
    super("Evidence repository operation could not be completed");
    this.name = "EvidenceRepositoryError";
  }
}

export function toEvidenceError(error: unknown): EvidenceError {
  if (error instanceof EvidenceError) return error;
  if (!(error instanceof EvidenceRepositoryError)) return new EvidenceError("PROVIDER_UNAVAILABLE");

  switch (error.code) {
    case "AUTH_REQUIRED":
      return new EvidenceError("AUTH_REQUIRED");
    case "RESERVATION_EXPIRED":
      return new EvidenceError("RESERVATION_EXPIRED");
    case "EVIDENCE_SLOT_LIMIT":
      return new EvidenceError("EVIDENCE_SLOT_LIMIT");
    case "EVIDENCE_QUOTA_EXCEEDED":
      return new EvidenceError("EVIDENCE_QUOTA_EXCEEDED");
    case "IDEMPOTENCY_KEY_REUSED":
      return new EvidenceError("IDEMPOTENCY_CONFLICT");
    case "STALE_REVISION":
    case "EVIDENCE_STATE_CONFLICT":
    case "EVIDENCE_MOVE_STATE_CONFLICT":
      return new EvidenceError("CONFLICT");
    case "INVALID_EVIDENCE_SIZE":
      return new EvidenceError("FILE_SIZE_MISMATCH");
    case "EVIDENCE_MIME_MISMATCH":
      return new EvidenceError("FILE_TYPE_INVALID");
    case "EVIDENCE_STORAGE_CONFLICT":
      return new EvidenceError("STORAGE_OBJECT_CONFLICT");
    case "INVALID_EVIDENCE_HASH":
    case "PROVIDER_UNAVAILABLE":
      return new EvidenceError("PROVIDER_UNAVAILABLE");
  }
}

export function evidenceErrorMessage(code: EvidenceErrorCode, locale: "en" | "id"): string {
  const messages: Record<EvidenceErrorCode, { en: string; id: string }> = {
    AUTH_REQUIRED: { en: "Sign in to continue.", id: "Masuk untuk melanjutkan." },
    VALIDATION: { en: "Check the submitted details and try again.", id: "Periksa detail yang dikirim, lalu coba lagi." },
    FILE_TOO_LARGE: { en: "The file is larger than the 10 MiB limit.", id: "Ukuran file melebihi batas 10 MiB." },
    FILE_SIZE_MISMATCH: { en: "The uploaded file size did not match the reservation.", id: "Ukuran file yang diunggah tidak sesuai dengan reservasi." },
    FILE_TYPE_INVALID: { en: "The file content does not match a supported file type.", id: "Isi file tidak cocok dengan jenis file yang didukung." },
    RESERVATION_EXPIRED: { en: "This upload reservation has expired. Start a new upload.", id: "Reservasi unggahan ini sudah kedaluwarsa. Mulai unggahan baru." },
    EVIDENCE_NOT_FOUND: { en: "This evidence file is unavailable.", id: "File bukti ini tidak tersedia." },
    EVIDENCE_SLOT_LIMIT: { en: "This record already has the maximum number of evidence files.", id: "Catatan ini sudah memiliki jumlah file bukti maksimum." },
    EVIDENCE_QUOTA_EXCEEDED: { en: "This upload would exceed your evidence storage limit.", id: "Unggahan ini akan melewati batas penyimpanan bukti." },
    IDEMPOTENCY_CONFLICT: { en: "This request key was already used with different details.", id: "Kunci permintaan ini sudah digunakan dengan detail berbeda." },
    CONFLICT: { en: "This evidence changed. Reload its latest status and try again.", id: "Data bukti ini berubah. Muat ulang status terbaru, lalu coba lagi." },
    UPLOAD_INCOMPLETE: { en: "The upload did not finish. Retry with the same reservation.", id: "Unggahan belum selesai. Coba lagi dengan reservasi yang sama." },
    STORAGE_OBJECT_CONFLICT: { en: "A different file already occupies this upload reservation.", id: "File lain sudah menggunakan reservasi unggahan ini." },
    PROVIDER_UNAVAILABLE: { en: "Evidence storage is temporarily unavailable.", id: "Penyimpanan bukti sedang tidak tersedia." },
  };
  return messages[code][locale];
}
