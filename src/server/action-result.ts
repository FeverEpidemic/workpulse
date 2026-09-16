import type { MessageKey } from "@/i18n/messages";

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "CONFLICT"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAVAILABLE";

export interface ActionError {
  code: ErrorCode;
  messageKey: MessageKey;
  fieldErrors?: Partial<Record<string, MessageKey>>;
  correlationId: string;
  latestRecord?: Record<string, unknown>;
}

export type ActionState =
  | { status: "idle" }
  | { status: "success"; messageKey?: MessageKey; correlationId: string; data?: unknown }
  | { status: "error"; error: ActionError };

export const IDLE_ACTION_STATE: ActionState = { status: "idle" };

export function actionSuccess(messageKey?: MessageKey, data?: unknown): ActionState {
  return { status: "success", messageKey, correlationId: crypto.randomUUID(), data };
}

export function actionFailure(
  code: ErrorCode,
  messageKey: MessageKey,
  details: Omit<Partial<ActionError>, "code" | "messageKey" | "correlationId"> = {},
): ActionState {
  return {
    status: "error",
    error: { code, messageKey, correlationId: crypto.randomUUID(), ...details },
  };
}
