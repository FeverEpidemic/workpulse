// Shared by the web app and tests; keep imports relative (no "@/" alias).
import {
  IMPORT_ENTITY_TYPES,
  type ImportEntityType,
  type ImportStatus,
} from "./contracts.ts";
import type {
  ImportFieldErrorCode,
  ImportItemAction,
  ImportItemError,
  StoredImportCommitResult,
} from "./commit-contracts.ts";

export type ReviewTargetType = Exclude<ImportEntityType, "profile">;

export const REVIEW_GROUP_ORDER = IMPORT_ENTITY_TYPES;

export const REVIEW_PROFILE_FIELDS = ["headline", "summary", "contact_email", "phone", "location", "website"] as const;
export type ReviewProfileFieldName = (typeof REVIEW_PROFILE_FIELDS)[number];

export const ONBOARDING_PLACEHOLDER_NAME = "pending onboarding";
export const ONBOARDING_NAME_MAX = 80;
export const ONBOARDING_TIMEZONE_MAX = 100;

export type ReviewItemRow = {
  id: string;
  entity_type: ImportEntityType;
  ordinal: number;
  action: ImportItemAction;
  target_id: string | null;
  confirm_requested: boolean;
  payload: Record<string, unknown> | null;
  source_excerpt: string | null;
  revision: number;
};

/** A record the user already owns. `match` is the normalized duplicate key (see duplicateKey). */
export type ReviewTargetInput = { id: string; label: string; match: string | null };
export type ReviewTargetOption = { id: string; label: string };
export type ReviewTargets = Record<ReviewTargetType, ReviewTargetInput[]>;

export type ReviewBatch = {
  id: string;
  filename: string;
  status: ImportStatus;
  stage: string;
  error_code: string | null;
  revision: number;
  commit_result: StoredImportCommitResult | null;
};

export type ImportReviewSnapshot = {
  batch: ReviewBatch;
  items: ReviewItemRow[];
  targets: ReviewTargets;
  errors: ImportItemError[];
  profile: { onboarded: boolean; current: Partial<Record<ReviewProfileFieldName, string | null>> };
};

export type OnboardingDraft = { display_name: string; locale: string; timezone: string };

export type ReviewLocalState = {
  unsavedItemIds?: readonly string[];
  savingItemIds?: readonly string[];
  onboarding?: OnboardingDraft | null;
};

type FieldKind = "text" | "textarea" | "select" | "date" | "exact_date" | "checkbox" | "url";

type FieldSpec = {
  name: string;
  kind: FieldKind;
  required?: boolean;
  /** Required only while the user asks to confirm the achievement. */
  confirmRequired?: boolean;
  maxLength?: number;
  precisionName?: string;
  options?: readonly string[];
};

export const EXPERIENCE_KINDS = ["employment", "internship", "volunteer"] as const;

const INTERVAL_TAIL: FieldSpec[] = [
  { name: "start_date", kind: "date", precisionName: "start_precision" },
  { name: "end_date", kind: "date", precisionName: "end_precision" },
  { name: "is_current", kind: "checkbox" },
  { name: "description", kind: "textarea", maxLength: 5000 },
];

const FIELD_LAYOUT: Record<ReviewTargetType, readonly FieldSpec[]> = {
  experience: [
    { name: "organization", kind: "text", required: true, maxLength: 200 },
    { name: "role_title", kind: "text", required: true, maxLength: 200 },
    { name: "kind", kind: "select", required: true, options: EXPERIENCE_KINDS },
    ...INTERVAL_TAIL,
  ],
  education: [
    { name: "institution", kind: "text", required: true, maxLength: 200 },
    { name: "qualification", kind: "text", required: true, maxLength: 200 },
    { name: "field_of_study", kind: "text", maxLength: 200 },
    ...INTERVAL_TAIL,
  ],
  certification: [
    { name: "name", kind: "text", required: true, maxLength: 200 },
    { name: "issuer", kind: "text", maxLength: 200 },
    { name: "issued_date", kind: "date", precisionName: "issued_precision" },
    { name: "credential_url", kind: "url", maxLength: 2048 },
  ],
  skill: [{ name: "name", kind: "text", required: true, maxLength: 100 }],
  achievement: [
    { name: "title", kind: "text", confirmRequired: true, maxLength: 200 },
    { name: "contribution", kind: "textarea", confirmRequired: true, maxLength: 5000 },
    { name: "outcome", kind: "textarea", confirmRequired: true, maxLength: 5000 },
    { name: "cv_bullet", kind: "textarea", maxLength: 2000 },
    { name: "achieved_on", kind: "exact_date", confirmRequired: true },
  ],
};

export const REQUIRED_FIELDS: Record<ReviewTargetType, readonly string[]> = {
  experience: ["organization", "role_title", "kind"],
  education: ["institution", "qualification"],
  certification: ["name"],
  skill: ["name"],
  achievement: [],
};

export const ACHIEVEMENT_CONFIRM_FIELDS = ["title", "contribution", "outcome", "achieved_on"] as const;

export type ReviewField = {
  name: string;
  kind: FieldKind;
  required: boolean;
  missing: boolean;
  value: string | boolean | null;
  precisionName?: string;
  precision: string | null;
  maxLength?: number;
  options?: readonly string[];
  errors: ImportFieldErrorCode[];
};

export type ReviewProfileField = {
  name: ReviewProfileFieldName;
  value: string | null;
  current: string | null;
  selected: boolean;
  errors: ImportFieldErrorCode[];
};

export type ReviewDuplicate = {
  source: "validation" | "heuristic";
  targetId: string | null;
  label: string | null;
  blocking: boolean;
};

export type ReviewConfirm = { applicable: boolean; canConfirm: boolean; missing: string[]; requested: boolean };

export type ReviewCandidate = {
  id: string;
  type: ImportEntityType;
  ordinal: number;
  revision: number;
  action: ImportItemAction;
  targetId: string | null;
  confirmRequested: boolean;
  excerpt: string | null;
  fields: ReviewField[];
  profileFields: ReviewProfileField[] | null;
  errors: { field: string; code: ImportFieldErrorCode; existingId?: string }[];
  duplicate: ReviewDuplicate | null;
  confirm: ReviewConfirm;
  canMap: boolean;
  mapOptions: ReviewTargetOption[];
  unsaved: boolean;
  saving: boolean;
};

export type ReviewGroup = { type: ImportEntityType; candidates: ReviewCandidate[]; hasErrors: boolean };

export type ReviewActionCounts = { create: number; map: number; skip: number };

export type ReviewSummary = {
  total: number;
  byType: Record<ImportEntityType, ReviewActionCounts>;
  confirmedAchievements: number;
  draftAchievements: number;
};

export type CommitBlocker = { kind: "validation" | "unsaved" | "saving" | "onboarding"; count: number };

export type OnboardingErrorCode = "REQUIRED" | "TOO_LONG" | "INVALID";
export type OnboardingState = {
  required: boolean;
  errors: Partial<Record<keyof OnboardingDraft, OnboardingErrorCode>>;
};

export type ReviewViewState = "review" | "review_empty" | "committed" | "processing" | "failed" | "cancelled";

export type ImportReviewView = {
  state: ReviewViewState;
  batchId: string;
  filename: string;
  revision: number;
  errorCode: string | null;
  groups: ReviewGroup[];
  summary: ReviewSummary;
  errorSummary: { itemId: string; type: ImportEntityType; ordinal: number; field: string; code: ImportFieldErrorCode }[];
  commitBlockers: CommitBlocker[];
  warnings: "nothing_selected"[];
  canCommit: boolean;
  onboarding: OnboardingState;
  result: StoredImportCommitResult | null;
};

/** Lower-case, trimmed, whitespace-collapsed text; anything that is not a string counts as blank. */
export function normalizeDuplicateText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/**
 * Normalized key of a candidate or an owned record for the non-blocking "possible duplicate" hint.
 * Exact match after normalization only; there is no fuzzy matching in v0.1.
 */
export function duplicateKey(type: ImportEntityType, fields: Record<string, unknown>): string | null {
  const text = (name: string) => normalizeDuplicateText(fields[name]);
  switch (type) {
    case "experience": return text("organization") && text("role_title") ? `${text("organization")}\u0000${text("role_title")}` : null;
    case "education": return text("institution") && text("qualification") ? `${text("institution")}\u0000${text("qualification")}` : null;
    case "certification": return text("name") ? `${text("name")}\u0000${text("issuer")}` : null;
    case "achievement": return text("title") || null;
    default: return null;
  }
}

function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/** Fields an achievement needs before the user may confirm it (saved values only). */
export function canConfirmAchievement(payload: Record<string, unknown> | null): { ok: boolean; missing: string[] } {
  const missing = ACHIEVEMENT_CONFIRM_FIELDS.filter((name) => blank(payload?.[name]));
  return { ok: missing.length === 0, missing };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function buildFields(type: ReviewTargetType, payload: Record<string, unknown>, confirmRequested: boolean, errors: ReviewCandidate["errors"]): ReviewField[] {
  return FIELD_LAYOUT[type].map((spec) => {
    const raw = payload[spec.name];
    const value = spec.kind === "checkbox" ? raw === true : stringOrNull(raw);
    const required = Boolean(spec.required) || (Boolean(spec.confirmRequired) && confirmRequested);
    return {
      name: spec.name,
      kind: spec.kind,
      required,
      missing: required && spec.kind !== "checkbox" && blank(raw),
      value,
      ...(spec.precisionName ? { precisionName: spec.precisionName } : {}),
      precision: spec.precisionName ? stringOrNull(payload[spec.precisionName]) : null,
      ...(spec.maxLength ? { maxLength: spec.maxLength } : {}),
      ...(spec.options ? { options: spec.options } : {}),
      errors: errors.filter((error) => error.field === spec.name).map((error) => error.code),
    };
  });
}

function buildProfileFields(payload: Record<string, unknown>, current: ImportReviewSnapshot["profile"]["current"], errors: ReviewCandidate["errors"]): ReviewProfileField[] {
  const selected = Array.isArray(payload.selected_fields) ? payload.selected_fields : [];
  return REVIEW_PROFILE_FIELDS.map((name) => ({
    name,
    value: stringOrNull(payload[name]),
    current: current[name] ?? null,
    selected: selected.includes(name),
    errors: errors.filter((error) => error.field === name).map((error) => error.code),
  }));
}

function validateOnboarding(draft: OnboardingDraft | null | undefined): OnboardingState["errors"] {
  const errors: OnboardingState["errors"] = {};
  const name = (draft?.display_name ?? "").trim();
  if (name === "" || name.toLowerCase() === ONBOARDING_PLACEHOLDER_NAME) errors.display_name = "REQUIRED";
  else if (name.length > ONBOARDING_NAME_MAX) errors.display_name = "TOO_LONG";
  const timezone = (draft?.timezone ?? "").trim();
  if (timezone === "") errors.timezone = "REQUIRED";
  else if (timezone.length > ONBOARDING_TIMEZONE_MAX) errors.timezone = "TOO_LONG";
  if (draft && draft.locale !== "en" && draft.locale !== "id") errors.locale = "INVALID";
  return errors;
}

function emptyCounts(): ReviewActionCounts {
  return { create: 0, map: 0, skip: 0 };
}

/** Pure S03 view model: every choice, error and blocker comes from saved server state plus local UI flags. */
export function toImportReviewView(snapshot: ImportReviewSnapshot, local: ReviewLocalState = {}): ImportReviewView {
  const { batch } = snapshot;
  const unsaved = new Set(local.unsavedItemIds ?? []);
  const saving = new Set(local.savingItemIds ?? []);
  const byType = Object.fromEntries(IMPORT_ENTITY_TYPES.map((type) => [type, emptyCounts()])) as Record<ImportEntityType, ReviewActionCounts>;

  let state: ReviewViewState;
  switch (batch.status) {
    case "queued":
    case "running": state = "processing"; break;
    case "review": state = snapshot.items.length > 0 ? "review" : "review_empty"; break;
    case "committed": state = "committed"; break;
    case "failed": state = "failed"; break;
    case "cancelled": state = "cancelled"; break;
  }

  const summary: ReviewSummary = { total: snapshot.items.length, byType, confirmedAchievements: 0, draftAchievements: 0 };
  const base = {
    batchId: batch.id, filename: batch.filename, revision: batch.revision, errorCode: batch.status === "failed" ? batch.error_code : null,
    result: batch.status === "committed" ? batch.commit_result : null,
  };
  if (state !== "review") {
    return {
      ...base, state, groups: [], summary, errorSummary: [], commitBlockers: [], warnings: [], canCommit: false,
      onboarding: { required: false, errors: {} },
    };
  }

  const known = new Map(snapshot.items.map((item) => [item.id, item]));
  const errorsByItem = new Map<string, ReviewCandidate["errors"]>();
  const errorSummary: ImportReviewView["errorSummary"] = [];
  const existingByItem = new Map<string, string | undefined>();
  for (const error of snapshot.errors) {
    const owner = known.get(error.item_id);
    if (!owner || owner.action === "skip") continue;
    const list = errorsByItem.get(owner.id) ?? [];
    list.push({ field: error.field, code: error.code, ...(error.existing_id ? { existingId: error.existing_id } : {}) });
    errorsByItem.set(owner.id, list);
    errorSummary.push({ itemId: owner.id, type: owner.entity_type, ordinal: owner.ordinal, field: error.field, code: error.code });
    if (error.code === "DUPLICATE") existingByItem.set(owner.id, error.existing_id);
  }
  errorSummary.sort((a, b) => REVIEW_GROUP_ORDER.indexOf(a.type) - REVIEW_GROUP_ORDER.indexOf(b.type) || a.ordinal - b.ordinal);

  const groups: ReviewGroup[] = [];
  for (const type of REVIEW_GROUP_ORDER) {
    const rows = snapshot.items.filter((item) => item.entity_type === type).sort((a, b) => a.ordinal - b.ordinal);
    if (rows.length === 0) continue;
    const candidates = rows.map((row): ReviewCandidate => {
      const payload = row.payload ?? {};
      const errors = errorsByItem.get(row.id) ?? [];
      const isTarget = type !== "profile";
      const targets = isTarget ? snapshot.targets[type as ReviewTargetType] : [];
      const isCreate = row.action === "create";

      let duplicate: ReviewDuplicate | null = null;
      if (isCreate) {
        if (errors.some((error) => error.code === "DUPLICATE")) {
          const existing = existingByItem.get(row.id) ?? null;
          duplicate = { source: "validation", targetId: existing, label: targets.find((target) => target.id === existing)?.label ?? null, blocking: true };
        } else if (isTarget) {
          const key = duplicateKey(type, payload);
          const match = key === null ? undefined : targets.find((target) => target.match === key);
          if (match) duplicate = { source: "heuristic", targetId: match.id, label: match.label, blocking: false };
        }
      }

      const confirmApplicable = type === "achievement" && isCreate;
      const check = confirmApplicable ? canConfirmAchievement(row.payload) : { ok: false, missing: [] as string[] };
      byType[type][row.action] += 1;
      if (confirmApplicable) {
        if (row.confirm_requested) summary.confirmedAchievements += 1;
        else summary.draftAchievements += 1;
      }

      return {
        id: row.id, type, ordinal: row.ordinal, revision: row.revision, action: row.action, targetId: row.target_id,
        confirmRequested: row.confirm_requested, excerpt: row.source_excerpt,
        fields: isTarget ? buildFields(type as ReviewTargetType, payload, row.confirm_requested && isCreate, errors) : [],
        profileFields: isTarget ? null : buildProfileFields(payload, snapshot.profile.current, errors),
        errors, duplicate,
        confirm: { applicable: confirmApplicable, canConfirm: confirmApplicable && check.ok, missing: check.missing, requested: confirmApplicable && row.confirm_requested },
        canMap: isTarget,
        mapOptions: targets.map((target) => ({ id: target.id, label: target.label })),
        unsaved: unsaved.has(row.id), saving: saving.has(row.id),
      };
    });
    groups.push({ type, candidates, hasErrors: candidates.some((candidate) => candidate.errors.length > 0) });
  }

  const onboarding: OnboardingState = snapshot.profile.onboarded
    ? { required: false, errors: {} }
    : { required: true, errors: validateOnboarding(local.onboarding) };
  const onboardingErrors = Object.keys(onboarding.errors).length;

  const commitBlockers: CommitBlocker[] = [];
  if (errorSummary.length > 0) commitBlockers.push({ kind: "validation", count: errorSummary.length });
  const unsavedCount = snapshot.items.filter((item) => unsaved.has(item.id)).length;
  const savingCount = snapshot.items.filter((item) => saving.has(item.id)).length;
  if (unsavedCount > 0) commitBlockers.push({ kind: "unsaved", count: unsavedCount });
  if (savingCount > 0) commitBlockers.push({ kind: "saving", count: savingCount });
  if (onboardingErrors > 0) commitBlockers.push({ kind: "onboarding", count: onboardingErrors });

  return {
    ...base, state, groups, summary, errorSummary, commitBlockers,
    warnings: snapshot.items.every((item) => item.action === "skip") ? ["nothing_selected"] : [],
    canCommit: commitBlockers.length === 0,
    onboarding,
  };
}
