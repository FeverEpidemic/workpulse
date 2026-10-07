import * as z from "zod";

/** Section keys in the default order; must match internal.cv_section_keys(). */
export const CV_SECTION_KEYS = ["experience", "projects", "achievements", "education", "skills", "certifications"] as const;
export type CvSectionKey = (typeof CV_SECTION_KEYS)[number];

/** Source types accepted by select_cv_source(). */
export const CV_SOURCE_TYPES = ["experience", "project", "achievement", "education", "skill", "certification"] as const;
export type CvSourceType = (typeof CV_SOURCE_TYPES)[number];

/** An achievement is always stored in "achievements"; placement under a parent is a render rule. */
export const SECTION_FOR_SOURCE_TYPE = {
  experience: "experience",
  project: "projects",
  achievement: "achievements",
  education: "education",
  skill: "skills",
  certification: "certifications",
} as const satisfies Record<CvSourceType, CvSectionKey>;

export const CV_LOCALES = ["en", "id"] as const;
export type CvLocale = (typeof CV_LOCALES)[number];

/** Messages raised by the T18 RPCs (and their guard triggers). */
export const CV_ERROR_CODES = [
  "AUTH_REQUIRED",
  "ONBOARDING_REQUIRED",
  "INVALID_CV_INPUT",
  "CV_NOT_FOUND",
  "STALE_REVISION",
  "CV_SOURCE_NOT_FOUND",
  "CV_SOURCE_INELIGIBLE",
  "CV_SOURCE_DUPLICATE",
  "CV_ITEM_NOT_FOUND",
  "CV_CHILD_ITEMS_EXIST",
  "CV_REORDER_INVALID",
  "CV_ITEM_IMMUTABLE",
  "CV_OVERRIDE_UNSUPPORTED",
  "CV_SOURCE_CHANGED",
  "CV_RESOLUTION_INVALID",
  "IDEMPOTENCY_KEY_REUSED",
  "CV_EXPORT_BLOCKED",
  "CV_EXPORT_IN_PROGRESS",
  "CV_EXPORT_NOT_FOUND",
  "CV_EXPORT_NOT_RETRYABLE",
  "CV_EXPORT_NOT_READY",
  "CV_EXPORT_EXPIRED",
  "CV_EXPORT_IMMUTABLE",
] as const;
export type CvErrorCode = (typeof CV_ERROR_CODES)[number];

const nullableText = z.string().nullable();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const head = { schema_version: z.literal("cv-source.v1"), source_id: z.uuid() } as const;

/**
 * Display fields copied by internal.cv_source_snapshot() (schema cv-source.v1). Strict on purpose:
 * raw_text, source_excerpt, contribution, scope, metrics, activity ids and evidence never belong here.
 */
export const cvSourceSnapshotSchema = z.discriminatedUnion("source_type", [
  z.strictObject({
    ...head, source_type: z.literal("experience"),
    organization: z.string(), role_title: z.string(), kind: z.string(), description: nullableText,
    start_date: isoDate, start_precision: nullableText, end_date: isoDate, end_precision: nullableText, is_current: z.boolean(),
  }),
  z.strictObject({
    ...head, source_type: z.literal("project"),
    title: z.string(), description: nullableText, user_role: nullableText, outcome: nullableText, status: z.string(),
    start_date: isoDate, start_precision: nullableText, end_date: isoDate, end_precision: nullableText, is_current: z.boolean(),
    experience_id: z.uuid().nullable(),
  }),
  z.strictObject({
    ...head, source_type: z.literal("achievement"),
    title: z.string(), cv_bullet: z.string(), achieved_on: isoDate, experience_id: z.uuid().nullable(), project_id: z.uuid().nullable(),
  }),
  z.strictObject({
    ...head, source_type: z.literal("education"),
    institution: z.string(), qualification: z.string(), field_of_study: nullableText, description: nullableText,
    start_date: isoDate, start_precision: nullableText, end_date: isoDate, end_precision: nullableText, is_current: z.boolean(),
  }),
  z.strictObject({ ...head, source_type: z.literal("skill"), name: z.string() }),
  z.strictObject({
    ...head, source_type: z.literal("certification"),
    name: z.string(), issuer: nullableText, issued_date: isoDate, issued_precision: nullableText, credential_url: nullableText,
  }),
]);
export type CvSourceSnapshot = z.infer<typeof cvSourceSnapshotSchema>;

const sectionKey = z.enum(CV_SECTION_KEYS);
const revision = z.number().int().min(1);

/** A section_order is a permutation of the six keys. */
export const sectionOrderSchema = z
  .array(sectionKey)
  .length(CV_SECTION_KEYS.length)
  .refine((order) => new Set(order).size === CV_SECTION_KEYS.length, { message: "duplicate_section" });

/** Keys of the optional display overrides kept beside the copied profile source (decision 0025). */
export const CV_PROFILE_OVERRIDE_KEYS = ["display_name", "headline", "contact_email", "phone", "location", "website"] as const;
export type CvProfileOverrideKey = (typeof CV_PROFILE_OVERRIDE_KEYS)[number];

/** Same limits as the canonical profile columns (T03); website must be http(s). */
export const CV_PROFILE_OVERRIDE_MAX = {
  display_name: 80,
  headline: 120,
  contact_email: 320,
  phone: 40,
  location: 120,
  website: 2048,
} as const satisfies Record<CvProfileOverrideKey, number>;
export const CV_TITLE_MAX = 120;
export const CV_SUMMARY_MAX = 5000;
export const CV_OVERRIDE_TEXT_MAX = 2000;

const EMAIL_PATTERN = /^[A-Za-z0-9_+'-]+([.][A-Za-z0-9_+'-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const WEBSITE_PATTERN = /^https?:\/\/[^/?#\s]+([/?#]\S*)?$/i;

/** Validates one non-empty, already trimmed display override value. */
export function isValidProfileOverride(key: CvProfileOverrideKey, value: string): boolean {
  if (value === "" || value !== value.trim() || value.length > CV_PROFILE_OVERRIDE_MAX[key]) return false;
  if (key === "contact_email") return EMAIL_PATTERN.test(value);
  if (key === "website") return WEBSITE_PATTERN.test(value);
  return true;
}

const profileOverrideValues = z.strictObject({
  display_name: z.string(),
  headline: z.string(),
  contact_email: z.string(),
  phone: z.string(),
  location: z.string(),
  website: z.string(),
}).partial().refine(
  (value) => Object.entries(value).every(([key, text]) => typeof text === "string" && isValidProfileOverride(key as CvProfileOverrideKey, text)),
  { message: "invalid_profile_override" },
);

/** The copied profile source (cv-profile.v1) plus optional display overrides. Unknown keys are rejected. */
export const cvProfileSnapshotSchema = z.strictObject({
  schema_version: z.literal("cv-profile.v1").optional(),
  display_name: z.string().nullish(),
  headline: z.string().nullish(),
  summary: z.string().nullish(),
  contact_email: z.string().nullish(),
  phone: z.string().nullish(),
  location: z.string().nullish(),
  website: z.string().nullish(),
  display_overrides: profileOverrideValues.optional(),
});
export type CvProfileSnapshot = z.infer<typeof cvProfileSnapshotSchema>;

export const cvDocumentRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  locale: z.enum(CV_LOCALES),
  template_key: z.literal("single_column_v1"),
  summary_override: z.string().nullable(),
  profile_snapshot: cvProfileSnapshotSchema,
  profile_source_revision: revision,
  profile_ack_revision: revision.nullable(),
  section_order: sectionOrderSchema,
  created_at: z.string(),
  updated_at: z.string(),
  revision,
});
export type CvDocumentRow = z.infer<typeof cvDocumentRowSchema>;

export const cvItemRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  cv_id: z.uuid(),
  section_key: sectionKey,
  position: z.number().int().min(1),
  experience_id: z.uuid().nullable(),
  project_id: z.uuid().nullable(),
  achievement_id: z.uuid().nullable(),
  education_id: z.uuid().nullable(),
  skill_id: z.uuid().nullable(),
  certification_id: z.uuid().nullable(),
  source_snapshot: cvSourceSnapshotSchema,
  source_revision: revision,
  override_text: z.string().nullable(),
  acknowledged_revision: revision.nullable(),
  source_deleted: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  revision,
});
export type CvItemRow = z.infer<typeof cvItemRowSchema>;

export const selectCvSourceInput = z.strictObject({
  expected_revision: revision,
  source_type: z.enum(CV_SOURCE_TYPES),
  source_id: z.uuid(),
});
export type SelectCvSourceInput = z.infer<typeof selectCvSourceInput>;

export const removeCvItemInput = z.strictObject({
  expected_revision: revision,
  item_id: z.uuid(),
  remove_children: z.boolean(),
});
export type RemoveCvItemInput = z.infer<typeof removeCvItemInput>;

export const reorderCvSectionInput = z.strictObject({
  expected_revision: revision,
  section_key: sectionKey,
  item_ids: z.array(z.uuid()).refine((ids) => new Set(ids).size === ids.length, { message: "duplicate_item" }),
});
export type ReorderCvSectionInput = z.infer<typeof reorderCvSectionInput>;

export const updateCvLayoutInput = z
  .strictObject({
    expected_revision: revision,
    locale: z.enum(CV_LOCALES).optional(),
    section_order: sectionOrderSchema.optional(),
  })
  .refine((value) => value.locale !== undefined || value.section_order !== undefined, { message: "empty_layout" });
export type UpdateCvLayoutInput = z.infer<typeof updateCvLayoutInput>;

const editText = (max: number) => z.string().max(max);

/**
 * Text edits saved together by save_cv_edits. A null (or blank) summary, profile value or override clears it;
 * the title cannot be cleared. At least one edit is required.
 */
export const saveCvEditsInput = z
  .strictObject({
    expected_revision: revision,
    title: z.string().trim().min(1).max(CV_TITLE_MAX).optional(),
    summary_override: editText(CV_SUMMARY_MAX).nullable().optional(),
    profile_overrides: z
      .strictObject({
        display_name: editText(CV_PROFILE_OVERRIDE_MAX.display_name).nullable(),
        headline: editText(CV_PROFILE_OVERRIDE_MAX.headline).nullable(),
        contact_email: editText(CV_PROFILE_OVERRIDE_MAX.contact_email).nullable(),
        phone: editText(CV_PROFILE_OVERRIDE_MAX.phone).nullable(),
        location: editText(CV_PROFILE_OVERRIDE_MAX.location).nullable(),
        website: editText(CV_PROFILE_OVERRIDE_MAX.website).nullable(),
      })
      .partial()
      .superRefine((value, ctx) => {
        for (const [key, text] of Object.entries(value)) {
          const trimmed = typeof text === "string" ? text.trim() : "";
          if (trimmed !== "" && !isValidProfileOverride(key as CvProfileOverrideKey, trimmed)) {
            ctx.addIssue({ code: "custom", path: [key], message: "invalid_profile_override" });
          }
        }
      })
      .optional(),
    item_overrides: z
      .array(z.strictObject({ item_id: z.uuid(), override_text: editText(CV_OVERRIDE_TEXT_MAX).nullable() }))
      .max(200)
      .refine((items) => new Set(items.map((item) => item.item_id)).size === items.length, { message: "duplicate_item" })
      .optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined || value.summary_override !== undefined ||
      value.profile_overrides !== undefined || value.item_overrides !== undefined,
    { message: "empty_edits" },
  );
export type SaveCvEditsInput = z.infer<typeof saveCvEditsInput>;

/** Freshness of an item or of the CV profile, computed by internal.cv_item_state / cv_profile_state (T20). */
export const CV_FRESHNESS_STATES = ["fresh", "changed", "kept", "deleted", "unconfirmed"] as const;
export type CvFreshnessState = (typeof CV_FRESHNESS_STATES)[number];

/** keep = Keep saved wording, refresh = copy the live display fields, replace = refresh and drop the override. */
export const CV_RESOLUTION_ACTIONS = ["keep", "refresh", "replace"] as const;
export type CvResolutionAction = (typeof CV_RESOLUTION_ACTIONS)[number];

/** The seven source fields of the CV profile (cv-profile.v1), read live. Overrides never appear here. */
export const cvProfileLiveSchema = z.strictObject({
  display_name: nullableText,
  headline: nullableText,
  summary: nullableText,
  contact_email: nullableText,
  phone: nullableText,
  location: nullableText,
  website: nullableText,
});
export type CvProfileLive = z.infer<typeof cvProfileLiveSchema>;

const itemFreshnessRow = z.strictObject({
  target: z.literal("item"),
  item_id: z.uuid(),
  state: z.enum(CV_FRESHNESS_STATES),
  live_revision: revision.nullable(),
  live_snapshot: cvSourceSnapshotSchema.nullable(),
});
const profileFreshnessRow = z.strictObject({
  target: z.literal("profile"),
  item_id: z.null(),
  state: z.enum(["fresh", "changed", "kept"]),
  live_revision: revision,
  live_snapshot: cvProfileLiveSchema.nullable(),
});

/** One row of get_cv_freshness(); a live snapshot is present exactly for changed and kept rows. */
export const cvFreshnessRowSchema = z.discriminatedUnion("target", [itemFreshnessRow, profileFreshnessRow]).refine(
  (row) => (row.state === "changed" || row.state === "kept") === (row.live_snapshot !== null),
  { message: "live_snapshot_state_mismatch" },
);
export type CvFreshnessRow = z.infer<typeof cvFreshnessRowSchema>;

export const cvReviewSummarySchema = z.strictObject({
  has_cv: z.boolean(),
  review_count: z.number().int().min(0),
  available_count: z.number().int().min(0),
});
export type CvReviewSummary = z.infer<typeof cvReviewSummarySchema>;

const resolutionAction = z.enum(CV_RESOLUTION_ACTIONS);
const itemResolution = z.strictObject({
  target: z.literal("item"),
  item_id: z.uuid(),
  source_revision: revision,
  action: resolutionAction,
});
const profileResolution = z.strictObject({
  target: z.literal("profile"),
  source_revision: revision,
  action: resolutionAction,
});
export type CvResolution = z.infer<typeof itemResolution> | z.infer<typeof profileResolution>;

/** Batch accepted by resolve_cv_freshness: 1-200 resolutions, at most one per item and one for the profile. */
export const resolveCvFreshnessInput = z
  .strictObject({
    expected_revision: revision,
    resolutions: z.array(z.discriminatedUnion("target", [itemResolution, profileResolution])).min(1).max(200),
  })
  .refine(
    (value) => {
      const ids = value.resolutions.flatMap((resolution) => (resolution.target === "item" ? [resolution.item_id] : []));
      const profiles = value.resolutions.filter((resolution) => resolution.target === "profile").length;
      return new Set(ids).size === ids.length && profiles <= 1;
    },
    { message: "duplicate_resolution" },
  );
export type ResolveCvFreshnessInput = z.infer<typeof resolveCvFreshnessInput>;

/** The CV_CHILD_ITEMS_EXIST detail is a JSON array of item ids; anything else is rejected. */
export function parseChildItemsDetail(detail: string | null | undefined): string[] | null {
  if (typeof detail !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(detail);
  } catch {
    return null;
  }
  const parsed = z.array(z.uuid()).safeParse(json);
  return parsed.success ? parsed.data : null;
}

// T21 export contracts ---------------------------------------------------------------------------------------------

/** Codes of internal.cv_export_blockers() plus CV_NOT_FOUND for an account that has no CV yet. */
export const CV_EXPORT_BLOCKER_CODES = [
  "CV_NOT_FOUND",
  "NAME_REQUIRED",
  "CONTENT_REQUIRED",
  "ITEM_CHANGED",
  "ITEM_DELETED",
  "ITEM_UNCONFIRMED",
  "PROFILE_CHANGED",
] as const;
export type CvExportBlockerCode = (typeof CV_EXPORT_BLOCKER_CODES)[number];

export const CV_EXPORT_STATUSES = ["queued", "running", "succeeded", "failed"] as const;
export type CvExportStatus = (typeof CV_EXPORT_STATUSES)[number];

/** The only error codes a worker may store on an export (fail_cv_export allowlist); never CV text. */
export const CV_EXPORT_ERROR_CODES = [
  "EXPORT_TIMEOUT",
  "RENDERER_UNAVAILABLE",
  "RENDERER_TIMEOUT",
  "EXPORT_RENDER_INVALID",
  "EXPORT_TOO_LONG",
  "EXPORT_SNAPSHOT_INVALID",
  "STORAGE_UNAVAILABLE",
  "ACCOUNT_DELETING",
] as const;
export type CvExportErrorCode = (typeof CV_EXPORT_ERROR_CODES)[number];

/** One blocker: a code and, for item blockers, the caller's own item id. */
export const cvExportBlockerSchema = z.strictObject({
  code: z.enum(CV_EXPORT_BLOCKER_CODES),
  item_id: z.uuid().optional(),
});
export type CvExportBlocker = z.infer<typeof cvExportBlockerSchema>;

/** One row of get_cv_export_readiness(): ready exactly when a CV exists and nothing blocks it. */
export const cvExportReadinessSchema = z
  .strictObject({
    has_cv: z.boolean(),
    cv_revision: revision.nullable(),
    ready: z.boolean(),
    blockers: z.array(cvExportBlockerSchema),
  })
  .refine((row) => row.ready === (row.has_cv && row.blockers.length === 0), { message: "ready_blockers_mismatch" });
export type CvExportReadiness = z.infer<typeof cvExportReadinessSchema>;

const CV_EXPORT_MAX_BYTES_LIMIT = 10 * 1024 * 1024;

/**
 * Columns of cv_exports that may reach a client. The snapshot, the attempt token, the lease and the object key
 * stay on the server; strict on purpose.
 */
export const cvExportRowSchema = z
  .strictObject({
    id: z.uuid(),
    cv_id: z.uuid(),
    cv_revision: revision,
    status: z.enum(CV_EXPORT_STATUSES),
    error_code: z.enum(CV_EXPORT_ERROR_CODES).nullable(),
    attempt_count: z.number().int().min(0).max(3),
    page_count: z.number().int().min(1).max(20).nullable(),
    byte_size: z.number().int().min(1).max(CV_EXPORT_MAX_BYTES_LIMIT).nullable(),
    started_at: z.string().nullable(),
    finished_at: z.string().nullable(),
    expires_at: z.string().nullable(),
    purged_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    revision,
  })
  .refine((row) => (row.status === "failed") === (row.error_code !== null), { message: "error_code_state_mismatch" });
export type CvExportRow = z.infer<typeof cvExportRowSchema>;

export const CV_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

export const requestCvExportInput = z.strictObject({
  expected_revision: revision,
  idempotency_key: z.string().trim().regex(CV_IDEMPOTENCY_KEY_PATTERN),
});
export type RequestCvExportInput = z.infer<typeof requestCvExportInput>;

export const retryCvExportInput = z.strictObject({ export_id: z.uuid() });
export type RetryCvExportInput = z.infer<typeof retryCvExportInput>;

/** `attachment` saves the file under a generic name; `inline` lets S14 read the PDF pages itself (T22). */
export const CV_EXPORT_DISPOSITIONS = ["attachment", "inline"] as const;
export type CvExportDisposition = (typeof CV_EXPORT_DISPOSITIONS)[number];

export const downloadCvExportInput = z.strictObject({
  export_id: z.uuid(),
  disposition: z.enum(CV_EXPORT_DISPOSITIONS).default("attachment"),
});
export type DownloadCvExportInput = z.infer<typeof downloadCvExportInput>;

/** The CV_EXPORT_BLOCKED detail is {"blockers":[{code,item_id?}]}; anything else is rejected (no text can leak). */
export function parseExportBlockersDetail(detail: string | null | undefined): CvExportBlocker[] | null {
  if (typeof detail !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(detail);
  } catch {
    return null;
  }
  const parsed = z.strictObject({ blockers: z.array(cvExportBlockerSchema) }).safeParse(json);
  return parsed.success ? parsed.data.blockers : null;
}