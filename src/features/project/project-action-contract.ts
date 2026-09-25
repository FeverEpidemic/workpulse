import type { MessageKey } from "@/i18n/messages";
import { PartialDateValidationError, parsePartialDateForm } from "@/domain/dates/partial-date";
import { ProjectServiceError } from "@/features/project/project-service";
import type { ActionState, ErrorCode } from "@/server/action-result";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nullableText(formData: FormData, name: string): string | null {
  const value = text(formData, name);
  return value.trim() ? value : null;
}

function checked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on" || formData.get(name) === "true";
}

function revision(formData: FormData): number {
  const value = text(formData, "expected_revision");
  return /^[1-9]\d*$/.test(value) ? Number(value) : 0;
}

export class ProjectFormParseError extends Error {
  constructor(readonly field: string) {
    super("Project form could not be parsed.");
    this.name = "ProjectFormParseError";
  }
}

function partialDate(formData: FormData, prefix: string) {
  try {
    return parsePartialDateForm(formData, prefix);
  } catch (error) {
    if (error instanceof PartialDateValidationError) throw new ProjectFormParseError(error.inputName ?? `${prefix}_date`);
    throw new ProjectFormParseError(`${prefix}_date`);
  }
}

export function projectCreateInputFromForm(formData: FormData) {
  const start = partialDate(formData, "start");
  const end = checked(formData, "is_current") ? { date: null, precision: null } : partialDate(formData, "end");
  return {
    operationKey: text(formData, "operation_key"),
    title: text(formData, "title"),
    description: nullableText(formData, "description"),
    userRole: nullableText(formData, "user_role"),
    outcome: nullableText(formData, "outcome"),
    status: text(formData, "status"),
    experienceId: text(formData, "experience_id") || null,
    startDate: start.date,
    startPrecision: start.precision,
    endDate: end.date,
    endPrecision: end.precision,
    isCurrent: checked(formData, "is_current"),
  };
}

export function projectUpdateInputFromForm(formData: FormData) {
  const start = partialDate(formData, "start");
  const isCurrent = checked(formData, "is_current");
  const end = isCurrent ? { date: null, precision: null } : partialDate(formData, "end");
  return {
    projectId: text(formData, "project_id"),
    expectedRevision: revision(formData),
    title: text(formData, "title"),
    description: nullableText(formData, "description"),
    userRole: nullableText(formData, "user_role"),
    outcome: nullableText(formData, "outcome"),
    status: text(formData, "status"),
    experienceId: text(formData, "experience_id") || null,
    startDate: start.date,
    startPrecision: start.precision,
    endDate: end.date,
    endPrecision: end.precision,
    isCurrent,
  };
}

export function relinkActivityInputFromForm(formData: FormData) {
  const rawRevision = text(formData, "activity_expected_revision");
  return {
    activityId: text(formData, "activity_id"),
    expectedRevision: /^[1-9]\d*$/.test(rawRevision) ? Number(rawRevision) : 0,
    projectId: text(formData, "project_id") || null,
  };
}

export function deleteProjectInputFromForm(formData: FormData) {
  return {
    projectId: text(formData, "project_id"),
    expectedRevision: revision(formData),
  };
}

const actionErrorCodes: Record<ProjectServiceError["code"], ErrorCode> = {
  VALIDATION: "VALIDATION",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_KEY_REUSED: "CONFLICT",
  UNAVAILABLE: "UNAVAILABLE",
};

export function projectActionErrorState(error: ProjectServiceError): ActionState {
  return {
    status: "error",
    error: {
      code: actionErrorCodes[error.code],
      messageKey: error.messageKey,
      correlationId: error.correlationId,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.latestRecord ? { latestRecord: error.latestRecord as unknown as Record<string, unknown> } : {}),
    },
  };
}

export function projectFormErrorState(error: ProjectFormParseError): ActionState {
  const field = error.field === "start_year" || error.field === "start_month" || error.field === "start_day" || error.field === "start_precision"
    ? "start_date"
    : error.field === "end_year" || error.field === "end_month" || error.field === "end_day" || error.field === "end_precision"
      ? "end_date"
      : error.field;
  const fieldErrors: Partial<Record<string, MessageKey>> = { [field]: "validation.partialDate" };
  return {
    status: "error",
    error: {
      code: "VALIDATION",
      messageKey: "error.validation",
      correlationId: crypto.randomUUID(),
      fieldErrors,
    },
  };
}
