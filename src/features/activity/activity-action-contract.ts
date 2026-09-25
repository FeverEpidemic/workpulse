import type { MessageKey } from "@/i18n/messages";
import { ActivityServiceError } from "@/features/activity/activity-service";
import type { ActivityCaptureMode, ActivityRow } from "@/domain/activity/contracts";
import type { ActionState, ErrorCode } from "@/server/action-result";

function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** HTML form submission encodes textarea line feeds as CRLF; restore the textarea value. */
function rawTextareaText(formData: FormData): string {
  return formText(formData, "raw_text").replace(/\r\n?/gu, "\n");
}

function nullableFormText(formData: FormData, name: string, captureMode: string): string | null {
  return captureMode === "form" ? formText(formData, name) : null;
}

export function activityCreateInputFromForm(formData: FormData) {
  const captureMode = formText(formData, "capture_mode");
  return {
    operationKey: formText(formData, "operation_key"),
    captureMode,
    rawText: rawTextareaText(formData),
    occurredOn: formText(formData, "occurred_on"),
    role: nullableFormText(formData, "role", captureMode),
    scope: nullableFormText(formData, "scope", captureMode),
    outcome: nullableFormText(formData, "outcome", captureMode),
    experienceId: formText(formData, "experience_id") || null,
    projectId: formText(formData, "project_id") || null,
  };
}

type ActivityStructuredFields = Pick<ActivityRow, "role" | "scope" | "outcome">;

export function activityUpdateInputFromForm(
  formData: FormData,
  captureMode: ActivityCaptureMode,
  currentActivity: ActivityStructuredFields,
) {
  const rawExpectedRevision = formText(formData, "expected_revision");
  const expectedRevision = /^[1-9]\d*$/.test(rawExpectedRevision) ? Number(rawExpectedRevision) : 0;
  const structuredFields = captureMode === "form"
    ? {
        role: nullableFormText(formData, "role", captureMode),
        scope: nullableFormText(formData, "scope", captureMode),
        outcome: nullableFormText(formData, "outcome", captureMode),
      }
    : {
        role: currentActivity.role,
        scope: currentActivity.scope,
        outcome: currentActivity.outcome,
      };
  return {
    activityId: formText(formData, "activity_id"),
    expectedRevision,
    rawText: rawTextareaText(formData),
    occurredOn: formText(formData, "occurred_on"),
    ...structuredFields,
    experienceId: formText(formData, "experience_id") || null,
    projectId: formText(formData, "project_id") || null,
  };
}

export function activityDeleteInputFromForm(formData: FormData) {
  const rawRevision = formText(formData, "expected_revision");
  return {
    activityId: formText(formData, "activity_id"),
    expectedRevision: /^[1-9]\d*$/.test(rawRevision) ? Number(rawRevision) : 0,
  };
}

const activityFieldNames: Record<string, string> = {
  operationKey: "operation_key",
  captureMode: "capture_mode",
  rawText: "raw_text",
  occurredOn: "occurred_on",
  experienceId: "experience_id",
  projectId: "project_id",
  activityId: "activity_id",
  expectedRevision: "expected_revision",
};

const actionErrorCodes: Record<ActivityServiceError["code"], ErrorCode> = {
  VALIDATION: "VALIDATION",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_KEY_REUSED: "CONFLICT",
  UNAVAILABLE: "UNAVAILABLE",
};

export function activityActionErrorState(error: ActivityServiceError): ActionState {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const [field, messageKey] of Object.entries(error.fieldErrors ?? {})) {
    if (messageKey) fieldErrors[activityFieldNames[field] ?? field] = messageKey;
  }

  return {
    status: "error",
    error: {
      code: actionErrorCodes[error.code],
      messageKey: error.messageKey,
      correlationId: error.correlationId,
      ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {}),
      ...(error.latestRecord
        ? { latestRecord: error.latestRecord as unknown as Record<string, unknown> }
        : {}),
    },
  };
}

export function isActivityCaptureMode(value: string): value is ActivityCaptureMode {
  return value === "note" || value === "form" || value === "chat";
}
