// Shared by the web app and the worker; keep imports relative (no "@/" alias).

/** Must equal internal.current_ai_consent_version() in SQL. */
export const AI_CONSENT_VERSION = "ai-processing-v1";
export const AI_MAX_ATTEMPTS = 3;
export const AI_LEASE_SECONDS = 120;
/** Provider calls finish well before the 120 second lease expires. */
export const AI_PROVIDER_TIMEOUT_MS = 90_000;

export const AI_JOB_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const AI_ERROR_CODES = [
  "CONSENT_REQUIRED",
  "CONSENT_WITHDRAWN",
  "STALE_INPUT",
  "ACCOUNT_DELETING",
  "AI_TIMEOUT",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_RATE_LIMITED",
  "AI_CONFIG_INVALID",
  "AI_REFUSED",
  "AI_OUTPUT_INVALID",
  "AI_UNAVAILABLE",
  "AI_RETRY_EXHAUSTED",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export const AI_LOCALES = ["en", "id"] as const;
export type AiLocale = (typeof AI_LOCALES)[number];

export const AI_JOB_KINDS = ["detect", "refine"] as const;
export type AiJobKind = (typeof AI_JOB_KINDS)[number];

/**
 * T14 review errors raised by the ai_suggestion_reviews RPCs (skip/dismiss/answer/apply).
 * Kept separate from AI_ERROR_CODES, which are worker/job outcome codes only.
 */
export const AI_REVIEW_ERROR_CODES = [
  "AI_JOB_NOT_APPLICABLE",
  "AI_SUGGESTION_DISMISSED",
  "AI_SUGGESTION_APPLIED",
  "AI_QUESTIONS_CLOSED",
  "DRAFT_EDITED",
  "ACHIEVEMENT_CONFIRMED",
  "ACHIEVEMENT_DISMISSED",
  "ACHIEVEMENT_EXISTS",
  "INVALID_AI_ANSWER",
] as const;
export type AiReviewErrorCode = (typeof AI_REVIEW_ERROR_CODES)[number];
