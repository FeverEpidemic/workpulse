import type { CvLocale, CvProfileOverrideKey, CvSectionKey, CvSourceSnapshot } from "./contracts.ts";
import { CV_LABELS, formatCvDateRange, formatCvPartialDate } from "./labels.ts";
import { buildCvOutline, type OutlineItemInput } from "./outline.ts";
import { hasOverride, resolveItemText, resolveProfile, resolveSummary, type ResolvableDocument } from "./resolve.ts";

export interface PreviewItemInput extends OutlineItemInput {
  override_text: string | null;
}

export interface PreviewDocumentInput extends ResolvableDocument {
  title: string;
  locale: CvLocale;
  section_order: readonly CvSectionKey[];
}

export interface CvPreviewEntry {
  itemId: string;
  type: CvSourceSnapshot["source_type"];
  headline: string;
  subline: string | null;
  dates: string | null;
  text: string | null;
  deleted: boolean;
  hasOverride: boolean;
  children: CvPreviewEntry[];
}

export interface CvPreviewSection {
  key: CvSectionKey;
  heading: string;
  entries: CvPreviewEntry[];
}

export interface CvPreviewModel {
  title: string;
  locale: CvLocale;
  profile: Record<CvProfileOverrideKey, string | null>;
  summary: string | null;
  sections: CvPreviewSection[];
}

function joinParts(...parts: (string | null | undefined)[]): string | null {
  const present = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(", ") : null;
}

/** One display entry (headline, dates, effective text) for a CV item; shared by the editor rows and the preview. */
export function buildCvPreviewEntry(item: PreviewItemInput, locale: CvLocale, deleted: boolean): CvPreviewEntry {
  const snapshot = item.source_snapshot;
  const base = { itemId: item.id, type: snapshot.source_type, deleted, hasOverride: hasOverride(item), text: resolveItemText(item), children: [] };
  switch (snapshot.source_type) {
    case "experience":
      return { ...base, headline: snapshot.role_title, subline: snapshot.organization, dates: formatCvDateRange(snapshot, locale) };
    case "project":
      return { ...base, headline: snapshot.title, subline: snapshot.user_role, dates: formatCvDateRange(snapshot, locale) };
    case "achievement":
      return { ...base, headline: snapshot.title, subline: null, dates: formatCvPartialDate(snapshot.achieved_on, "day", locale) };
    case "education":
      return {
        ...base, headline: joinParts(snapshot.qualification, snapshot.field_of_study) ?? snapshot.institution,
        subline: snapshot.institution, dates: formatCvDateRange(snapshot, locale),
      };
    case "skill":
      return { ...base, headline: snapshot.name, subline: null, dates: null };
    case "certification":
      return { ...base, headline: snapshot.name, subline: snapshot.issuer, dates: formatCvPartialDate(snapshot.issued_date, snapshot.issued_precision, locale) };
  }
}

/**
 * Pure render model of a saved CV (screen preview in T19; the export snapshot in T21/T22 reuses it).
 * Sections follow section_order, empty sections are omitted, and each achievement appears exactly once.
 */
export function buildCvPreviewModel(input: { document: PreviewDocumentInput; items: readonly PreviewItemInput[] }): CvPreviewModel {
  const { document } = input;
  const locale = document.locale;
  const outline = buildCvOutline({ sectionOrder: document.section_order, items: input.items });
  const sections: CvPreviewSection[] = [];
  for (const section of outline.sections) {
    if (section.entries.length === 0) continue;
    sections.push({
      key: section.key,
      heading: CV_LABELS[locale].sections[section.key],
      entries: section.entries.map((entry) => ({
        ...buildCvPreviewEntry(entry.item, locale, entry.deleted),
        children: entry.children.map((child) => buildCvPreviewEntry(child, locale, child.source_deleted)),
      })),
    });
  }
  return { title: document.title, locale, profile: resolveProfile(document), summary: resolveSummary(document), sections };
}
