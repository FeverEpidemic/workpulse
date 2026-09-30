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

export const cvDocumentRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  title: z.string(),
  locale: z.enum(CV_LOCALES),
  template_key: z.literal("single_column_v1"),
  summary_override: z.string().nullable(),
  profile_snapshot: z.record(z.string(), z.unknown()),
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
