// Worker-side print template (T21). Pure; relative imports only (no "@/" alias).
import { CV_PROFILE_OVERRIDE_KEYS } from "../../domain/cv/contracts.ts";
import type { CvPreviewEntry, CvPreviewModel } from "../../domain/cv/preview.ts";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for element content and attributes; control characters (except tab and newline) are dropped. */
function esc(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

// single_column_v1: A4, neutral black and grey, Noto Sans (installed in the renderer image), no external resource.
// Nothing here can load anything: no @font-face, no url(), no @import.
const STYLE = `
@page { size: A4; margin: 16mm 18mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'Noto Sans', sans-serif; font-size: 10pt; line-height: 1.45; color: #111111; margin: 0; overflow-wrap: anywhere; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 2pt; }
h2 { font-size: 11pt; font-weight: 700; margin: 12pt 0 6pt; padding-bottom: 2pt; border-bottom: 0.5pt solid #888888; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 10pt; font-weight: 700; margin: 0; break-after: avoid; page-break-after: avoid; }
p { margin: 0; white-space: pre-line; }
ul { list-style: none; margin: 0; padding: 0; }
.headline { font-size: 11pt; color: #333333; margin: 0 0 2pt; }
.contact { font-size: 9pt; color: #444444; margin: 0 0 8pt; }
.summary { margin: 0 0 8pt; }
.entry { margin: 0 0 7pt; break-inside: avoid; page-break-inside: avoid; }
.entry-meta { font-size: 9pt; color: #444444; }
.entry-text { margin-top: 2pt; }
.children { list-style: disc outside; margin: 3pt 0 0; padding-left: 12pt; }
.child { margin: 0 0 3pt; break-inside: avoid; page-break-inside: avoid; }
.entry-flow { break-inside: auto; page-break-inside: auto; }
.entry-flow > .entry-meta, .entry-flow > .entry-text { break-after: avoid; page-break-after: avoid; }
`.trim();

// An entry is kept on one page, but one that cannot fit a page would be moved whole to the next page, leaving the
// page before it empty (T22 review RV1). Such an entry is marked `entry-flow`: it may break between its children,
// while each child, and the head with its first child, stays together. The estimate is a lower bound for ordinary
// text (the 493 pt column holds about 95-100 characters of 10 pt Noto Sans, the estimate assumes 120), so a marked
// entry really is taller than the page and an entry that fits is never allowed to split.
const TEXT_AREA_HEIGHT_PT = 841.89 - 2 * 16 * (72 / 25.4);
const CHARS_PER_LINE_UPPER = 120;
const BODY_LINE_PT = 10 * 1.45;
const META_LINE_PT = 9 * 1.45;

/** Lines a text needs at least; `preLine` keeps its line breaks (white-space: pre-line), otherwise they collapse. */
function minLines(text: string, preLine: boolean): number {
  const parts = preLine ? text.split("\n") : [text.replace(/\s+/g, " ")];
  return parts.reduce((sum, part) => sum + Math.max(1, Math.ceil(part.trim().length / CHARS_PER_LINE_UPPER)), 0);
}

/** The least height in points an entry (with its children) can take when printed; deleted entries take none. */
export function minEntryHeightPt(entry: CvPreviewEntry): number {
  if (entry.deleted) return 0;
  const meta = [entry.subline, entry.dates].filter((part): part is string => Boolean(part)).join(" · ");
  let height = minLines(entry.headline, false) * BODY_LINE_PT;
  if (meta) height += minLines(meta, true) * META_LINE_PT;
  if (entry.text) height += 2 + minLines(entry.text, true) * BODY_LINE_PT;
  const children = entry.children.filter((child) => !child.deleted);
  if (children.length > 0) height += 3 + children.reduce((sum, child) => sum + minEntryHeightPt(child) + 3, 0);
  return height;
}

/** True when an entry cannot fit one page, so it must flow across pages instead of moving whole. */
export function entryFlowsAcrossPages(entry: CvPreviewEntry): boolean {
  return minEntryHeightPt(entry) > TEXT_AREA_HEIGHT_PT;
}

function renderEntry(entry: CvPreviewEntry, nested: boolean): string {
  if (entry.deleted) return "";
  const meta = [entry.subline, entry.dates].filter((part): part is string => Boolean(part)).join(" · ");
  const children = entry.children.map((child) => renderEntry(child, true)).filter((html) => html !== "");
  const className = nested ? "child" : entryFlowsAcrossPages(entry) ? "entry entry-flow" : "entry";
  return [
    `<li class="${className}">`,
    `<h3 class="entry-title">${esc(entry.headline)}</h3>`,
    meta ? `<p class="entry-meta">${esc(meta)}</p>` : "",
    entry.text ? `<p class="entry-text">${esc(entry.text)}</p>` : "",
    children.length > 0 ? `<ul class="children">${children.join("")}</ul>` : "",
    "</li>",
  ].join("");
}

/**
 * The HTML print document of a CV render model (the same model as the screen preview). Everything is escaped;
 * no script, link, image or other resource is emitted, a website prints as text, and evidence has no place in
 * the model, so none can appear. Entries of deleted sources are never printed.
 */
export function renderCvPrintHtml(model: CvPreviewModel): string {
  const contact = CV_PROFILE_OVERRIDE_KEYS
    .filter((key) => key !== "display_name" && key !== "headline")
    .map((key) => model.profile[key])
    .filter((value): value is string => Boolean(value));
  const header = [
    model.profile.display_name ? `<h1>${esc(model.profile.display_name)}</h1>` : "",
    model.profile.headline ? `<p class="headline">${esc(model.profile.headline)}</p>` : "",
    contact.length > 0 ? `<p class="contact">${esc(contact.join(" · "))}</p>` : "",
  ].join("");
  const sections = model.sections
    .map((section) => ({ section, entries: section.entries.map((entry) => renderEntry(entry, false)).filter((html) => html !== "") }))
    .filter(({ entries }) => entries.length > 0)
    .map(({ section, entries }) => `<section class="cv-section"><h2>${esc(section.heading)}</h2><ul>${entries.join("")}</ul></section>`);
  return [
    "<!doctype html>",
    `<html lang="${esc(model.locale)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${esc(model.title)}</title>`,
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    header ? `<header>${header}</header>` : "",
    model.summary ? `<p class="summary">${esc(model.summary)}</p>` : "",
    ...sections,
    "</body>",
    "</html>",
  ].filter((part) => part !== "").join("\n");
}
