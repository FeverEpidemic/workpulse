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
