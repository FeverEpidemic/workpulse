// Shared by the web app and the worker; keep imports relative (no "@/" alias).
import * as z from "zod";

import { numbersIn } from "../ai/detect-result.ts";
import type { ImportEntityType } from "./contracts.ts";

export const IMPORT_SCHEMA_VERSION = "import.v1";

export const IMPORT_LIMITS = {
  perType: 60,
  excerpt: 1_000,
  short: 200,
  long: 2_000,
  cvBullet: 500,
  url: 500,
  metrics: 5,
  metricLabel: 100,
  metricUnit: 50,
  ref: 40,
} as const;

const PLACEHOLDER_NAMES = new Set(["pending onboarding"]);

// Raw provider output. Lengths are generous here; per-field limits are applied below so
// one long field never discards the whole extraction.
const str = z.string().max(20_000);
const nullableStr = str.nullable();
const partialDate = z.object({
  year: z.number().int().min(1900).max(2100),
  month: z.number().int().min(1).max(12).nullable(),
  day: z.number().int().min(1).max(31).nullable(),
}).strict().nullable();

const rawSchema = z.object({
  schema_version: z.literal(IMPORT_SCHEMA_VERSION),
  profile: z.object({
    display_name: nullableStr, headline: nullableStr, summary: nullableStr, contact_email: nullableStr,
    phone: nullableStr, location: nullableStr, website: nullableStr, excerpt: str,
  }).strict().nullable(),
  experiences: z.array(z.object({
    ref: z.string().max(IMPORT_LIMITS.ref), organization: nullableStr, role_title: nullableStr,
    kind: z.enum(["employment", "internship", "volunteer"]).nullable(), description: nullableStr,
    start: partialDate, end: partialDate, is_current: z.boolean(), excerpt: str,
  }).strict()).max(200),
  education: z.array(z.object({
    institution: nullableStr, qualification: nullableStr, field_of_study: nullableStr, description: nullableStr,
    start: partialDate, end: partialDate, is_current: z.boolean(), excerpt: str,
  }).strict()).max(200),
  certifications: z.array(z.object({
    name: nullableStr, issuer: nullableStr, issued: partialDate, credential_url: nullableStr, excerpt: str,
  }).strict()).max(200),
  skills: z.array(z.object({ name: nullableStr, excerpt: str }).strict()).max(400),
  achievements: z.array(z.object({
    title: nullableStr, contribution: nullableStr, outcome: nullableStr, achieved_on: partialDate,
    experience_ref: z.string().max(IMPORT_LIMITS.ref).nullable(), cv_bullet: nullableStr,
    metrics: z.array(z.object({
      label: str, value: z.number().finite(), unit: str, baseline: z.number().finite().nullable(),
    }).strict()).max(20),
    excerpt: str,
  }).strict()).max(200),
}).strict();

export type RawImportResult = z.infer<typeof rawSchema>;
type RawDate = z.infer<typeof partialDate>;

export type ValidationError = { field: string; code: "REQUIRED" | "UNGROUNDED" | "TOO_LONG" | "INVALID" | "DATE_RANGE" };

export type StagedItem = {
  entity_type: ImportEntityType;
  ref?: string;
  payload: Record<string, unknown>;
  source_excerpt: string;
  validation_errors: ValidationError[];
};

export type ImportSummary = {
  schema_version: typeof IMPORT_SCHEMA_VERSION;
  counts: Record<ImportEntityType, number>;
  dropped_ungrounded: number;
};

export type ImportValidation =
  | { ok: true; items: StagedItem[]; summary: ImportSummary }
  | { ok: false };

/** Case-, width- and whitespace-insensitive comparison form. */
export function normalizeForGrounding(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

const MONTHS: Array<string[]> = [
  ["jan", "january", "januari"], ["feb", "february", "februari", "pebruari"], ["mar", "march", "maret"],
  ["apr", "april"], ["may", "mei"], ["jun", "june", "juni"], ["jul", "july", "juli"],
  ["aug", "august", "agu", "agt", "agustus"], ["sep", "sept", "september"],
  ["oct", "october", "okt", "oktober"], ["nov", "november", "nop", "nopember"],
  ["dec", "december", "des", "desember"],
];

function monthGrounded(month: number, year: number, excerpt: string): boolean {
  const names = MONTHS[month - 1]!;
  const words = excerpt.toLocaleLowerCase("en").split(/[^a-z]+/);
  if (names.some((name) => words.includes(name))) return true;
  const mm = String(month).padStart(2, "0");
  return new RegExp(`(^|\\D)(${mm}|${month})\\s*[/.-]\\s*${year}(\\D|$)`).test(excerpt)
    || new RegExp(`(^|\\D)${year}\\s*[/.-]\\s*(${mm}|${month})(\\D|$)`).test(excerpt);
}

type GroundedDate = { date: string; precision: "year" | "month" | "day" } | null;

/** Never more precise than the excerpt: an ungrounded month/day is dropped, an ungrounded year drops the date. */
function groundDate(value: RawDate, excerpt: string): GroundedDate {
  if (!value) return null;
  if (!new RegExp(`(^|\\D)${value.year}(\\D|$)`).test(excerpt)) return null;
  if (value.month === null || !monthGrounded(value.month, value.year, excerpt)) {
    return { date: `${value.year}-01-01`, precision: "year" };
  }
  const mm = String(value.month).padStart(2, "0");
  if (value.day !== null && new RegExp(`(^|\\D)0?${value.day}(\\D|$)`).test(excerpt)) {
    const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
    if (date.getUTCMonth() === value.month - 1) return { date: `${value.year}-${mm}-${String(value.day).padStart(2, "0")}`, precision: "day" };
  }
  return { date: `${value.year}-${mm}-01`, precision: "month" };
}

function latestPossible(date: GroundedDate): number | null {
  if (!date) return null;
  const [year, month] = date.date.split("-").map(Number) as [number, number];
  if (date.precision === "year") return Date.UTC(year + 1, 0, 1) - 1;
  if (date.precision === "month") return Date.UTC(year, month, 1) - 1;
  return Date.parse(`${date.date}T00:00:00Z`);
}

function earliestPossible(date: GroundedDate): number | null {
  return date ? Date.parse(`${date.date}T00:00:00Z`) : null;
}

class ItemBuilder {
  readonly errors: ValidationError[] = [];
  readonly payload: Record<string, unknown> = {};
  readonly excerpt: string;
  private readonly excerptKey: string;
  private readonly excerptNumbers: Set<number>;

  // No TypeScript parameter properties: the worker runs under Node type stripping.
  constructor(excerpt: string) {
    this.excerpt = excerpt;
    this.excerptKey = normalizeForGrounding(excerpt);
    this.excerptNumbers = numbersIn(excerpt);
  }

  private clean(field: string, value: string | null, max: number): string | null {
    const trimmed = value?.trim() ?? "";
    if (trimmed === "") return null;
    if (trimmed.length > max) {
      this.errors.push({ field, code: "TOO_LONG" });
      return null;
    }
    return trimmed;
  }

  /** A fact that must appear verbatim (normalized) in the excerpt, e.g. an employer. */
  grounded(field: string, value: string | null, max: number, required = false): void {
    const cleaned = this.clean(field, value, max);
    if (cleaned !== null && !this.excerptKey.includes(normalizeForGrounding(cleaned))) {
      this.errors.push({ field, code: "UNGROUNDED" });
      this.payload[field] = null;
      return;
    }
    if (cleaned === null && required) this.errors.push({ field, code: "REQUIRED" });
    this.payload[field] = cleaned;
  }

  /** Reworded text is allowed, but every number in it must appear in the excerpt. */
  worded(field: string, value: string | null, max: number, required = false): void {
    const cleaned = this.clean(field, value, max);
    if (cleaned !== null && [...numbersIn(cleaned)].some((n) => !this.excerptNumbers.has(n))) {
      this.errors.push({ field, code: "UNGROUNDED" });
      this.payload[field] = null;
      return;
    }
    if (cleaned === null && required) this.errors.push({ field, code: "REQUIRED" });
    this.payload[field] = cleaned;
  }

  url(field: string, value: string | null): void {
    const cleaned = this.clean(field, value, IMPORT_LIMITS.url);
    if (cleaned !== null && (!/^https?:\/\/[^/?#\s]+([/?#]\S*)?$/i.test(cleaned) || !this.excerptKey.includes(normalizeForGrounding(cleaned).replace(/^https?:\/\//, "")))) {
      this.errors.push({ field, code: /^https?:\/\//i.test(cleaned) ? "UNGROUNDED" : "INVALID" });
      this.payload[field] = null;
      return;
    }
    this.payload[field] = cleaned;
  }

  interval(start: RawDate, end: RawDate, isCurrent: boolean): void {
    const from = groundDate(start, this.excerpt);
    let to = groundDate(end, this.excerpt);
    if (isCurrent && to) {
      this.errors.push({ field: "end_date", code: "DATE_RANGE" });
      to = null;
    }
    const earliestStart = earliestPossible(from);
    const latestEnd = latestPossible(to);
    if (earliestStart !== null && latestEnd !== null && latestEnd < earliestStart) {
      this.errors.push({ field: "end_date", code: "DATE_RANGE" });
    }
    Object.assign(this.payload, {
      start_date: from?.date ?? null, start_precision: from?.precision ?? null,
      end_date: to?.date ?? null, end_precision: to?.precision ?? null, is_current: isCurrent,
    });
  }

  item(entity_type: ImportEntityType, ref?: string): StagedItem {
    return { entity_type, ...(ref ? { ref } : {}), payload: this.payload, source_excerpt: this.excerpt.trim(), validation_errors: this.errors };
  }
}

/**
 * Validate provider output against the extracted text. Schema failure rejects everything
 * (AI_OUTPUT_INVALID). A candidate whose excerpt is not in the text is dropped; key facts
 * missing from its own excerpt are cleared and flagged; numbers must come from the excerpt;
 * dates are never more precise than the excerpt. Achievements are always draft.
 */
export function validateImportResult(raw: unknown, text: string): ImportValidation {
  const parsed = rawSchema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const result = parsed.data;
  const source = normalizeForGrounding(text);
  let dropped = 0;
  const items: StagedItem[] = [];
  const counts: Record<ImportEntityType, number> = {
    profile: 0, experience: 0, education: 0, certification: 0, skill: 0, achievement: 0,
  };

  const accept = (excerpt: string): ItemBuilder | null => {
    const trimmed = excerpt.trim();
    if (trimmed === "" || trimmed.length > IMPORT_LIMITS.excerpt || !source.includes(normalizeForGrounding(trimmed))) {
      dropped += 1;
      return null;
    }
    return new ItemBuilder(trimmed);
  };
  const push = (item: StagedItem) => {
    if (counts[item.entity_type] >= IMPORT_LIMITS.perType) return;
    counts[item.entity_type] += 1;
    items.push(item);
  };

  if (result.profile) {
    const b = accept(result.profile.excerpt);
    if (b) {
      const name = result.profile.display_name?.trim() ?? null;
      b.grounded("display_name", name && PLACEHOLDER_NAMES.has(name.toLowerCase()) ? null : name, IMPORT_LIMITS.short);
      b.worded("headline", result.profile.headline, IMPORT_LIMITS.short);
      b.worded("summary", result.profile.summary, IMPORT_LIMITS.long);
      b.grounded("contact_email", result.profile.contact_email, IMPORT_LIMITS.short);
      b.grounded("phone", result.profile.phone, IMPORT_LIMITS.short);
      b.grounded("location", result.profile.location, IMPORT_LIMITS.short);
      b.url("website", result.profile.website);
      push(b.item("profile"));
    }
  }

  const experienceRefs = new Set<string>();
  for (const experience of result.experiences) {
    const b = accept(experience.excerpt);
    if (!b) continue;
    b.grounded("organization", experience.organization, IMPORT_LIMITS.short, true);
    b.grounded("role_title", experience.role_title, IMPORT_LIMITS.short, true);
    b.payload.kind = experience.kind;
    if (experience.kind === null) b.errors.push({ field: "kind", code: "REQUIRED" });
    b.worded("description", experience.description, IMPORT_LIMITS.long);
    b.interval(experience.start, experience.end, experience.is_current);
    const ref = /^[A-Za-z0-9_-]{1,40}$/.test(experience.ref) && !experienceRefs.has(experience.ref) ? experience.ref : undefined;
    if (ref) experienceRefs.add(ref);
    push(b.item("experience", ref));
  }

  for (const education of result.education) {
    const b = accept(education.excerpt);
    if (!b) continue;
    b.grounded("institution", education.institution, IMPORT_LIMITS.short, true);
    b.grounded("qualification", education.qualification, IMPORT_LIMITS.short, true);
    b.grounded("field_of_study", education.field_of_study, IMPORT_LIMITS.short);
    b.worded("description", education.description, IMPORT_LIMITS.long);
    b.interval(education.start, education.end, education.is_current);
    push(b.item("education"));
  }

  for (const certification of result.certifications) {
    const b = accept(certification.excerpt);
    if (!b) continue;
    b.grounded("name", certification.name, IMPORT_LIMITS.short, true);
    b.grounded("issuer", certification.issuer, IMPORT_LIMITS.short);
    const issued = groundDate(certification.issued, b.excerpt);
    b.payload.issued_date = issued?.date ?? null;
    b.payload.issued_precision = issued?.precision ?? null;
    b.url("credential_url", certification.credential_url);
    push(b.item("certification"));
  }

  const skillNames = new Set<string>();
  for (const skill of result.skills) {
    const b = accept(skill.excerpt);
    if (!b) continue;
    b.grounded("name", skill.name, 100, true);
    const key = typeof b.payload.name === "string" ? normalizeForGrounding(b.payload.name) : null;
    if (key !== null) {
      if (skillNames.has(key)) continue;
      skillNames.add(key);
    }
    push(b.item("skill"));
  }

  for (const achievement of result.achievements) {
    const b = accept(achievement.excerpt);
    if (!b) continue;
    b.payload.status = "draft";
    b.worded("title", achievement.title, IMPORT_LIMITS.short, true);
    b.worded("contribution", achievement.contribution, IMPORT_LIMITS.long, true);
    b.worded("outcome", achievement.outcome, IMPORT_LIMITS.long, true);
    b.worded("cv_bullet", achievement.cv_bullet, IMPORT_LIMITS.cvBullet, true);
    // Achievement dates are exact in the canonical table; only a day-precise, grounded date is kept.
    const achieved = groundDate(achievement.achieved_on, b.excerpt);
    b.payload.achieved_on = achieved?.precision === "day" ? achieved.date : null;
    if (b.payload.achieved_on === null) b.errors.push({ field: "achieved_on", code: "REQUIRED" });
    const numbers = numbersIn(b.excerpt);
    const metrics = achievement.metrics.slice(0, IMPORT_LIMITS.metrics).filter((metric) =>
      metric.label.trim() !== "" && metric.label.length <= IMPORT_LIMITS.metricLabel
      && metric.unit.trim() !== "" && metric.unit.length <= IMPORT_LIMITS.metricUnit
      && numbers.has(metric.value) && (metric.baseline === null || numbers.has(metric.baseline)));
    if (metrics.length !== achievement.metrics.length) b.errors.push({ field: "metrics", code: "UNGROUNDED" });
    b.payload.metrics = metrics.map((metric) => ({
      label: metric.label.trim(), value: metric.value, unit: metric.unit.trim(),
      ...(metric.baseline === null ? {} : { baseline: metric.baseline }),
    }));
    b.payload.experience_ref = achievement.experience_ref !== null && experienceRefs.has(achievement.experience_ref)
      ? achievement.experience_ref
      : null;
    if (b.payload.experience_ref === null) delete b.payload.experience_ref;
    push(b.item("achievement"));
  }

  return { ok: true, items, summary: { schema_version: IMPORT_SCHEMA_VERSION, counts, dropped_ungrounded: dropped } };
}

const jsonNullableString = { type: ["string", "null"] };
const jsonDate = {
  anyOf: [
    {
      type: "object", additionalProperties: false, required: ["year", "month", "day"],
      properties: { year: { type: "integer" }, month: { type: ["integer", "null"] }, day: { type: ["integer", "null"] } },
    },
    { type: "null" },
  ],
};

function jsonObject(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

/** Strict JSON Schema for Structured Outputs; grounding is enforced by validateImportResult. */
export const importResultJsonSchema = jsonObject({
  schema_version: { type: "string", enum: [IMPORT_SCHEMA_VERSION] },
  profile: {
    anyOf: [
      jsonObject({
        display_name: jsonNullableString, headline: jsonNullableString, summary: jsonNullableString,
        contact_email: jsonNullableString, phone: jsonNullableString, location: jsonNullableString,
        website: jsonNullableString, excerpt: { type: "string" },
      }),
      { type: "null" },
    ],
  },
  experiences: {
    type: "array",
    items: jsonObject({
      ref: { type: "string" }, organization: jsonNullableString, role_title: jsonNullableString,
      kind: { type: ["string", "null"], enum: ["employment", "internship", "volunteer", null] },
      description: jsonNullableString, start: jsonDate, end: jsonDate, is_current: { type: "boolean" },
      excerpt: { type: "string" },
    }),
  },
  education: {
    type: "array",
    items: jsonObject({
      institution: jsonNullableString, qualification: jsonNullableString, field_of_study: jsonNullableString,
      description: jsonNullableString, start: jsonDate, end: jsonDate, is_current: { type: "boolean" },
      excerpt: { type: "string" },
    }),
  },
  certifications: {
    type: "array",
    items: jsonObject({
      name: jsonNullableString, issuer: jsonNullableString, issued: jsonDate, credential_url: jsonNullableString,
      excerpt: { type: "string" },
    }),
  },
  skills: { type: "array", items: jsonObject({ name: jsonNullableString, excerpt: { type: "string" } }) },
  achievements: {
    type: "array",
    items: jsonObject({
      title: jsonNullableString, contribution: jsonNullableString, outcome: jsonNullableString,
      achieved_on: jsonDate, experience_ref: jsonNullableString, cv_bullet: jsonNullableString,
      metrics: {
        type: "array",
        items: jsonObject({
          label: { type: "string" }, value: { type: "number" }, unit: { type: "string" },
          baseline: { type: ["number", "null"] },
        }),
      },
      excerpt: { type: "string" },
    }),
  },
});
