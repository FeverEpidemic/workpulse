import * as z from "zod";

import { IMPORT_ENTITY_TYPES, type ImportEntityType } from "./contracts.ts";

export const IMPORT_ITEM_ACTIONS = ["create", "map", "skip"] as const;
export type ImportItemAction = (typeof IMPORT_ITEM_ACTIONS)[number];

/** Per-field validation codes; must match internal.import_item_errors(). */
export const IMPORT_FIELD_ERROR_CODES = [
  "REQUIRED",
  "INVALID",
  "TOO_LONG",
  "DATE_RANGE",
  "DUPLICATE",
  "TARGET_UNAVAILABLE",
  "INVALID_ACTION",
] as const;
export type ImportFieldErrorCode = (typeof IMPORT_FIELD_ERROR_CODES)[number];

/** Codes raised by update_import_item / validate_import_batch / commit_import_batch. */
export const IMPORT_COMMIT_REQUEST_ERROR_CODES = [
  "IMPORT_ITEM_INVALID",
  "IMPORT_NOT_COMMITTABLE",
  "IMPORT_NOT_REVIEWABLE",
  "IMPORT_TARGET_INVALID",
  "INVALID_IMPORT_ITEM_INPUT",
  "ONBOARDING_REQUIRED",
  "INVALID_DISPLAY_NAME",
  "INVALID_LOCALE",
  "INVALID_TIMEZONE",
  "STALE_REVISION",
  "IMPORT_NOT_FOUND",
] as const;

/** Editable payload keys per entity type; must match the allowlist in public.update_import_item(). */
export const IMPORT_PATCH_FIELDS = {
  experience: ["organization", "role_title", "kind", "description", "start_date", "start_precision", "end_date", "end_precision", "is_current"],
  education: ["institution", "qualification", "field_of_study", "description", "start_date", "start_precision", "end_date", "end_precision", "is_current"],
  certification: ["name", "issuer", "issued_date", "issued_precision", "credential_url"],
  skill: ["name"],
  achievement: ["title", "contribution", "outcome", "cv_bullet", "achieved_on", "metrics", "experience_item_id"],
  profile: ["headline", "summary", "contact_email", "phone", "location", "website", "selected_fields", "display_name"],
} as const satisfies Record<ImportEntityType, readonly string[]>;

/** Profile columns an import may write; the name is only ever set through onboarding. */
export const IMPORT_PROFILE_SELECTABLE_FIELDS = ["headline", "summary", "contact_email", "phone", "location", "website"] as const;

export const updateImportItemInput = z.strictObject({
  item_id: z.uuid(),
  expected_revision: z.number().int().min(1),
  action: z.enum(IMPORT_ITEM_ACTIONS).optional(),
  target_id: z.uuid().nullable().optional(),
  payload_patch: z.record(z.string(), z.union([z.string(), z.boolean(), z.null(), z.array(z.unknown())])).optional(),
  confirm_requested: z.boolean().optional(),
});
export type UpdateImportItemInput = z.infer<typeof updateImportItemInput>;

export const onboardingInput = z.strictObject({
  display_name: z.string().trim().min(1).max(80),
  locale: z.enum(["en", "id"]),
  timezone: z.string().trim().min(1).max(100),
});

export const commitImportInput = z.strictObject({
  batch_id: z.uuid(),
  expected_revision: z.number().int().min(1),
  onboarding: onboardingInput.optional(),
});
export type CommitImportInput = z.infer<typeof commitImportInput>;

const counts = z.strictObject({
  created: z.number().int().min(0),
  mapped: z.number().int().min(0),
  skipped: z.number().int().min(0),
});

export const commitResultSchema = z.strictObject({
  schema_version: z.literal("import-commit.v1"),
  counts: z.strictObject(Object.fromEntries(IMPORT_ENTITY_TYPES.map((type) => [type, counts])) as Record<ImportEntityType, typeof counts>),
  confirmed_achievements: z.number().int().min(0),
  profile_fields_applied: z.number().int().min(0),
  onboarding_completed: z.boolean(),
  batch_id: z.uuid(),
  committed_at: z.string().min(1),
});
export type ImportCommitResult = z.infer<typeof commitResultSchema>;

export const importItemErrorSchema = z.strictObject({
  item_id: z.uuid(),
  field: z.string().regex(/^[a-z_]{1,40}$/),
  code: z.enum(IMPORT_FIELD_ERROR_CODES),
  existing_id: z.uuid().optional(),
});
export type ImportItemError = z.infer<typeof importItemErrorSchema>;

/** Validation rows as returned by validate_import_batch (nullable existing_id becomes absent). */
export function toItemErrors(rows: unknown): ImportItemError[] | null {
  if (!Array.isArray(rows)) return null;
  const parsed: ImportItemError[] = [];
  for (const row of rows) {
    const candidate = row && typeof row === "object"
      ? Object.fromEntries(Object.entries(row).filter(([key, value]) => !(key === "existing_id" && value === null)))
      : row;
    const item = importItemErrorSchema.safeParse(candidate);
    if (!item.success) return null;
    parsed.push(item.data);
  }
  return parsed;
}

/** The IMPORT_ITEM_INVALID detail carries item ids, fields and codes only; anything else is rejected. */
export function parseItemErrorsDetail(detail: string | null | undefined): ImportItemError[] | null {
  if (typeof detail !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(detail);
  } catch {
    return null;
  }
  return toItemErrors(json);
}
