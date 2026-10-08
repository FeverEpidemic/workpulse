// Pure export domain (T21). Relative imports so the worker can use it without the "@/" alias.
import * as z from "zod";

import {
  CV_LOCALES,
  CV_SECTION_KEYS,
  SECTION_FOR_SOURCE_TYPE,
  cvProfileSnapshotSchema,
  cvSourceSnapshotSchema,
  sectionOrderSchema,
} from "./contracts.ts";
import { buildCvPreviewModel, type CvPreviewModel } from "./preview.ts";
import { resolveProfile } from "./resolve.ts";

/** Limits of one export (decision 0027). */
export const CV_EXPORT_MAX_PAGES = 20;
export const CV_EXPORT_MAX_BYTES = 10 * 1024 * 1024;
export const CV_EXPORT_MAX_ATTEMPTS = 3;
export const CV_EXPORT_TTL_HOURS = 24;
export const CV_EXPORT_DOWNLOAD_TTL_SECONDS = 300;

const exportItemSchema = z.strictObject({
  id: z.uuid(),
  section_key: z.enum(CV_SECTION_KEYS),
  position: z.number().int().min(1),
  source_snapshot: cvSourceSnapshotSchema,
  override_text: z.string().nullable(),
});

/**
 * cv-export.v1: the whole saved CV as stored by internal.cv_export_snapshot(), including overrides, section
 * order and template. Strict on purpose: no evidence, raw text, metrics or activity link can ride along.
 */
export const cvExportSnapshotSchema = z
  .strictObject({
    schema_version: z.literal("cv-export.v1"),
    template_key: z.literal("single_column_v1"),
    locale: z.enum(CV_LOCALES),
    title: z.string().min(1),
    cv_id: z.uuid(),
    cv_revision: z.number().int().min(1),
    section_order: sectionOrderSchema,
    profile_snapshot: cvProfileSnapshotSchema,
    summary_override: z.string().nullable(),
    items: z.array(exportItemSchema),
  })
  .superRefine((snapshot, ctx) => {
    const ids = new Set<string>();
    const places = new Set<string>();
    snapshot.items.forEach((item, index) => {
      if (SECTION_FOR_SOURCE_TYPE[item.source_snapshot.source_type] !== item.section_key) {
        ctx.addIssue({ code: "custom", path: ["items", index, "section_key"], message: "section_source_mismatch" });
      }
      const place = `${item.section_key}:${item.position}`;
      if (ids.has(item.id) || places.has(place)) {
        ctx.addIssue({ code: "custom", path: ["items", index], message: "duplicate_item" });
      }
      ids.add(item.id);
      places.add(place);
    });
  });
export type CvExportSnapshot = z.infer<typeof cvExportSnapshotSchema>;

/**
 * The render model of an export, built from the stored snapshot only. It is the same function as the screen
 * preview (T19), so the preview of a saved revision and its PDF cannot drift. Deleted sources never reach an
 * export (they block it), so no entry is marked deleted.
 */
export function buildExportRenderModel(snapshot: CvExportSnapshot): CvPreviewModel {
  return buildCvPreviewModel({
    document: {
      title: snapshot.title,
      locale: snapshot.locale,
      section_order: snapshot.section_order,
      summary_override: snapshot.summary_override,
      profile_snapshot: snapshot.profile_snapshot,
    },
    items: snapshot.items.map((item) => ({ ...item, source_deleted: false })),
  });
}

/** The name printed on the CV: the display override, else the copied profile name; null when blank. */
export function effectiveExportName(snapshot: Pick<CvExportSnapshot, "profile_snapshot">): string | null {
  const name = resolveProfile(snapshot).display_name?.trim() ?? "";
  return name === "" ? null : name;
}

const RELIABLE_NAME_LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
const LETTER = /\p{L}/u;

const collapse = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const squeeze = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "");
const reversed = (value: string) => Array.from(value).reverse().join("");

/**
 * Whether the text extracted from a rendered export shows the effective name (decision 0027, gate review RV1).
 * Latin, Greek and Cyrillic names must appear as written (NFKC, whitespace collapsed). Other scripts may come out of
 * Chromium in visual order (Arabic, Hebrew), as radicals (Han) or lossy (Devanagari): such a name is accepted when it
 * appears forward or reversed, word by word, or else when every rendered section heading (always en/id labels) is in
 * the text, which still proves the PDF carries searchable text.
 */
export function exportTextShowsName(text: string, name: string, headings: readonly string[]): boolean {
  const strict = collapse(name);
  if (strict === "") return false;
  if (collapse(text).includes(strict)) return true;
  const letters = Array.from(name.normalize("NFKC")).filter((char) => LETTER.test(char));
  if (letters.every((char) => RELIABLE_NAME_LETTER.test(char))) return false;

  const haystack = squeeze(text);
  if (haystack === "") return false;
  const whole = squeeze(name);
  if (haystack.includes(whole) || haystack.includes(reversed(whole))) return true;
  const words = collapse(name).split(" ").map(squeeze).filter((word) => word !== "");
  if (words.every((word) => haystack.includes(word) || haystack.includes(reversed(word)))) return true;
  const required = headings.map(squeeze).filter((heading) => heading !== "");
  return required.length > 0 && required.every((heading) => haystack.includes(heading));
}

/** Worker codes that a retry cannot fix (mirrors internal.is_permanent_export_error). */
export function isPermanentExportError(code: string | null | undefined): boolean {
  return code === "EXPORT_SNAPSHOT_INVALID" || code === "EXPORT_TOO_LONG" || code === "ACCOUNT_DELETING";
}

/** A succeeded export is expired when its 24 hours have passed or its object was purged; an unreadable date fails safe. */
export function isExportExpired(
  row: { status: string; expires_at: string | null; purged_at: string | null },
  now: Date,
): boolean {
  if (row.status !== "succeeded") return false;
  if (row.purged_at !== null) return true;
  if (row.expires_at === null) return true;
  const expires = Date.parse(row.expires_at);
  return Number.isNaN(expires) || expires <= now.getTime();
}
