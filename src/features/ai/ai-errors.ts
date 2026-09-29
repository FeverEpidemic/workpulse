import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";

export type AiServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_INPUT"
  | "CONSENT_REQUIRED"
  | "RETRY_EXHAUSTED"
  | "UNAVAILABLE"
  | "AI_JOB_NOT_APPLICABLE"
  | "AI_SUGGESTION_DISMISSED"
  | "AI_SUGGESTION_APPLIED"
  | "AI_QUESTIONS_CLOSED"
  | "DRAFT_EDITED"
  | "ACHIEVEMENT_CONFIRMED"
  | "ACHIEVEMENT_DISMISSED"
  | "ACHIEVEMENT_EXISTS";

const AI_ERROR_MESSAGE_KEYS: Record<AiServiceErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  UNAUTHENTICATED: "auth.signInRequired",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  STALE_INPUT: "error.staleInput",
  CONSENT_REQUIRED: "error.consentRequired",
  RETRY_EXHAUSTED: "error.aiRetryExhausted",
  UNAVAILABLE: "error.unavailable",
  AI_JOB_NOT_APPLICABLE: "error.aiJobNotApplicable",
  AI_SUGGESTION_DISMISSED: "error.aiSuggestionDismissed",
  AI_SUGGESTION_APPLIED: "error.aiSuggestionApplied",
  AI_QUESTIONS_CLOSED: "error.aiQuestionsClosed",
  DRAFT_EDITED: "error.draftEdited",
  ACHIEVEMENT_CONFIRMED: "error.achievementConfirmed",
  ACHIEVEMENT_DISMISSED: "error.achievementDismissed",
  ACHIEVEMENT_EXISTS: "error.conflict",
};

/** Safe, localized AI error with a correlation ID. The message never carries source text. */
export class AiServiceError extends Error {
  readonly code: AiServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;

  constructor(code: AiServiceErrorCode) {
    super("AI service request could not be completed.");
    this.name = "AiServiceError";
    this.code = code;
    this.messageKey = AI_ERROR_MESSAGE_KEYS[code];
    this.correlationId = randomUUID();
  }
}

export type AiClient = SupabaseClient<Database>;

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);

function isUnauthenticatedAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  return error.status === 401 || error.status === 403
    || (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code));
}

export async function requireAiActorId(client: AiClient): Promise<string> {
  const { data, error } = await client.auth.getUser();
  if (error) {
    if (data?.user) throw new AiServiceError("UNAVAILABLE");
    if (isUnauthenticatedAuthFailure(error)) throw new AiServiceError("UNAUTHENTICATED");
    throw new AiServiceError("UNAVAILABLE");
  }
  if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
  if (data?.user === null) throw new AiServiceError("UNAUTHENTICATED");
  throw new AiServiceError("UNAVAILABLE");
}

export function mapAiDatabaseError(error: { code?: string; message?: string }): AiServiceError {
  switch (error.message) {
    case "AUTH_REQUIRED":
      return new AiServiceError("UNAUTHENTICATED");
    case "ACTIVITY_UNAVAILABLE":
    case "AI_JOB_UNAVAILABLE":
      return new AiServiceError("NOT_FOUND");
    case "CONSENT_REQUIRED":
      return new AiServiceError("CONSENT_REQUIRED");
    case "STALE_INPUT":
      return new AiServiceError("STALE_INPUT");
    case "AI_RETRY_EXHAUSTED":
      return new AiServiceError("RETRY_EXHAUSTED");
    case "STALE_REVISION":
    case "AI_JOB_NOT_RETRYABLE":
    case "IDEMPOTENCY_KEY_REUSED":
    case "ACHIEVEMENT_EXISTS":
      return new AiServiceError("CONFLICT");
    case "AI_JOB_NOT_APPLICABLE":
      return new AiServiceError("AI_JOB_NOT_APPLICABLE");
    case "AI_SUGGESTION_DISMISSED":
      return new AiServiceError("AI_SUGGESTION_DISMISSED");
    case "AI_SUGGESTION_APPLIED":
      return new AiServiceError("AI_SUGGESTION_APPLIED");
    case "AI_QUESTIONS_CLOSED":
      return new AiServiceError("AI_QUESTIONS_CLOSED");
    case "DRAFT_EDITED":
      return new AiServiceError("DRAFT_EDITED");
    case "ACHIEVEMENT_CONFIRMED":
      return new AiServiceError("ACHIEVEMENT_CONFIRMED");
    case "ACHIEVEMENT_DISMISSED":
      return new AiServiceError("ACHIEVEMENT_DISMISSED");
    case "INVALID_AI_ANSWER":
      return new AiServiceError("VALIDATION");
    default:
      break;
  }
  if (error.code === "42501") return new AiServiceError("UNAUTHENTICATED");
  if (error.code === "22023" || error.code === "22P02") return new AiServiceError("VALIDATION");
  return new AiServiceError("UNAVAILABLE");
}

export async function withAiErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    throw new AiServiceError("UNAVAILABLE");
  }
}
