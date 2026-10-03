import { randomUUID } from "node:crypto";

import { parseChildItemsDetail } from "@/domain/cv/contracts";
import type { MessageKey } from "@/i18n/messages";

export type CvServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ONBOARDING_REQUIRED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_INELIGIBLE"
  | "SOURCE_DUPLICATE"
  | "CHILD_ITEMS_EXIST"
  | "REORDER_INVALID"
  | "OVERRIDE_UNSUPPORTED"
  | "SOURCE_CHANGED"
  | "RESOLUTION_INVALID"
  | "UNAVAILABLE";

export const CV_ERROR_MESSAGE_KEYS: Record<CvServiceErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  UNAUTHENTICATED: "auth.signInRequired",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  ONBOARDING_REQUIRED: "cv.error.onboardingRequired",
  SOURCE_NOT_FOUND: "cv.error.sourceNotFound",
  SOURCE_INELIGIBLE: "cv.error.sourceIneligible",
  SOURCE_DUPLICATE: "cv.error.sourceDuplicate",
  CHILD_ITEMS_EXIST: "cv.error.childItemsExist",
  REORDER_INVALID: "cv.error.reorderInvalid",
  OVERRIDE_UNSUPPORTED: "cv.error.overrideUnsupported",
  SOURCE_CHANGED: "cv.error.sourceChanged",
  RESOLUTION_INVALID: "cv.error.resolutionInvalid",
  UNAVAILABLE: "error.unavailable",
};

/** Safe, localized CV error with a correlation ID. Never carries source text, only codes and item ids. */
export class CvServiceError extends Error {
  readonly code: CvServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;
  /** Child item ids for CHILD_ITEMS_EXIST; empty otherwise. */
  readonly childItemIds: string[];

  constructor(code: CvServiceErrorCode, options: { correlationId?: string; childItemIds?: string[] } = {}) {
    super("CV request could not be completed.");
    this.name = "CvServiceError";
    this.code = code;
    this.messageKey = CV_ERROR_MESSAGE_KEYS[code];
    this.correlationId = options.correlationId ?? randomUUID();
    this.childItemIds = options.childItemIds ?? [];
  }
}

/** Database errors carry stable codes only; another account's source or item is indistinguishable from none. */
export function mapCvDatabaseError(
  error: { code?: string; message?: string; details?: string | null },
  correlationId: string,
): CvServiceError {
  const make = (code: CvServiceErrorCode) => new CvServiceError(code, { correlationId });
  switch (error.message) {
    case "AUTH_REQUIRED": return make("UNAUTHENTICATED");
    case "ONBOARDING_REQUIRED": return make("ONBOARDING_REQUIRED");
    case "INVALID_CV_INPUT": return make("VALIDATION");
    case "CV_NOT_FOUND":
    case "CV_ITEM_NOT_FOUND": return make("NOT_FOUND");
    case "STALE_REVISION": return make("CONFLICT");
    case "CV_SOURCE_NOT_FOUND": return make("SOURCE_NOT_FOUND");
    case "CV_SOURCE_INELIGIBLE": return make("SOURCE_INELIGIBLE");
    case "CV_SOURCE_DUPLICATE": return make("SOURCE_DUPLICATE");
    case "CV_REORDER_INVALID": return make("REORDER_INVALID");
    case "CV_OVERRIDE_UNSUPPORTED": return make("OVERRIDE_UNSUPPORTED");
    case "CV_SOURCE_CHANGED": return make("SOURCE_CHANGED");
    case "CV_RESOLUTION_INVALID": return make("RESOLUTION_INVALID");
    case "CV_CHILD_ITEMS_EXIST":
      return new CvServiceError("CHILD_ITEMS_EXIST", { correlationId, childItemIds: parseChildItemsDetail(error.details) ?? [] });
    default: break;
  }
  if (error.code === "42501") return make("UNAUTHENTICATED");
  if (error.code === "22023" || error.code === "22P02") return make("VALIDATION");
  return make("UNAVAILABLE");
}

export function toCvServiceError(error: unknown, correlationId: string): CvServiceError {
  return error instanceof CvServiceError ? error : new CvServiceError("UNAVAILABLE", { correlationId });
}
