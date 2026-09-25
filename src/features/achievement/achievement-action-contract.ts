import type { MessageKey } from "@/i18n/messages";
import { AchievementServiceError } from "@/features/achievement/achievement-service";
import { isAchievementAction } from "@/domain/achievement/transition";
import type { ActionState, ErrorCode } from "@/server/action-result";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function nullableId(formData: FormData, name: string): string | null {
  const value = text(formData, name).trim();
  return value || null;
}

function revision(formData: FormData): number {
  const value = text(formData, "expected_revision");
  return /^[1-9]\d*$/.test(value) ? Number(value) : 0;
}

function jsonValue(formData: FormData, name: string, fallback: unknown): unknown {
  const value = text(formData, name);
  if (!value.trim()) return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function optionalText(formData: FormData, name: string): string {
  return text(formData, name);
}

function metricsFromForm(formData: FormData): unknown[] {
  const rows = new Map<number, Record<string, string>>();
  formData.forEach((value, name) => {
    const match = /^metric_(\d+)_(label|value|unit|baseline|period)$/.exec(name);
    if (!match || typeof value !== "string") return;
    const index = Number(match[1]);
    const row = rows.get(index) ?? {};
    row[match[2] ?? ""] = value;
    rows.set(index, row);
  });
  return [...rows.entries()].sort(([left], [right]) => left - right).map(([, row]) => {
    const rawValue = row["value"] ?? "";
    const value = rawValue.trim() && Number.isFinite(Number(rawValue)) ? Number(rawValue) : rawValue;
    const rawBaseline = row["baseline"]?.trim() ?? "";
    const baseline = rawBaseline && Number.isFinite(Number(rawBaseline)) ? Number(rawBaseline) : rawBaseline;
    return {
      label: row["label"] ?? "",
      value,
      unit: row["unit"] ?? "",
      ...(rawBaseline ? { baseline } : {}),
      ...(row["period"]?.trim() ? { period: row["period"] } : {}),
    };
  });
}

export function achievementCreateInputFromForm(formData: FormData) {
  return {
    operationKey: text(formData, "operation_key"),
    activityId: nullableId(formData, "activity_id"),
    projectId: nullableId(formData, "project_id"),
    experienceId: nullableId(formData, "experience_id"),
  };
}

export function achievementSaveInputFromForm(formData: FormData) {
  const skillValue = jsonValue(formData, "skill_names", []);
  const skillNames = Array.isArray(skillValue)
    ? skillValue
    : text(formData, "skill_names").split(",").map((value) => value.trim()).filter(Boolean);
  return {
    achievementId: text(formData, "achievement_id"),
    expectedRevision: revision(formData),
    action: text(formData, "achievement_action"),
    changes: {
      title: optionalText(formData, "title"),
      contribution: optionalText(formData, "contribution"),
      scope: optionalText(formData, "scope"),
      outcome: optionalText(formData, "outcome"),
      cvBullet: optionalText(formData, "cv_bullet"),
      achievedOn: text(formData, "achieved_on") || null,
      metrics: metricsFromForm(formData),
    },
    skillNames,
  };
}

export function achievementRelinkInputFromForm(formData: FormData) {
  return {
    achievementId: text(formData, "achievement_id"),
    expectedRevision: revision(formData),
    projectId: nullableId(formData, "project_id"),
  };
}

export function achievementDeleteInputFromForm(formData: FormData) {
  return {
    achievementId: text(formData, "achievement_id"),
    expectedRevision: revision(formData),
  };
}

const actionErrorCodes: Record<AchievementServiceError["code"], ErrorCode> = {
  VALIDATION: "VALIDATION",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  IDEMPOTENCY_KEY_REUSED: "CONFLICT",
  UNAVAILABLE: "UNAVAILABLE",
};

const fieldNames: Record<string, string> = {
  operationKey: "operation_key",
  activityId: "activity_id",
  projectId: "project_id",
  experienceId: "experience_id",
  achievementId: "achievement_id",
  expectedRevision: "expected_revision",
  cvBullet: "cv_bullet",
  achievedOn: "achieved_on",
  skillNames: "skill_names",
  metrics: "metrics_json",
};

export function achievementActionErrorState(error: AchievementServiceError, retryAction?: unknown): ActionState {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const [field, messageKey] of Object.entries(error.fieldErrors ?? {})) {
    fieldErrors[fieldNames[field] ?? field] = messageKey;
  }
  return {
    status: "error",
    error: {
      code: actionErrorCodes[error.code],
      messageKey: error.messageKey,
      correlationId: error.correlationId,
      ...(Object.keys(fieldErrors).length ? { fieldErrors } : {}),
      ...(error.latestRecord ? { latestRecord: error.latestRecord as unknown as Record<string, unknown> } : {}),
      ...(error.code === "CONFLICT" && isAchievementAction(retryAction) ? { retryAction } : {}),
    },
  };
}
