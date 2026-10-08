import { createHash } from "node:crypto";

import type { CvPreviewModel } from "@/domain/cv/preview";
import { renderCvPrintHtml } from "@/server/export/cv-print-template";
import { GotenbergPdfRenderer } from "@/server/export/pdf-renderer";

/** The page and its margins as the template sets them: A4, `@page { margin: 16mm 18mm }`. */
export const A4 = { width: 595, height: 842 } as const;
export const MM = 72 / 25.4;
export const MARGIN = { top: 16 * MM, bottom: 16 * MM, left: 18 * MM, right: 18 * MM } as const;

export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLine {
  y: number;
  x: number;
  right: number;
  text: string;
  size: number;
}

export interface PdfPage {
  number: number;
  width: number;
  height: number;
  items: PdfItem[];
  /** Lines of the page, top to bottom. */
  lines: PdfLine[];
  /** The text of the page in reading order (NFKC, whitespace collapsed). */
  text: string;
}

export interface PdfAnalysis {
  bytes: number;
  pages: PdfPage[];
  /** All pages in reading order (NFKC, whitespace collapsed). */
  text: string;
}

export const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

function rendererUrl(): string {
  const url = process.env["WORKPULSE_PDF_GOTENBERG_URL"]?.trim();
  if (!url) {
    throw new Error("Set WORKPULSE_PDF_GOTENBERG_URL (the workpulse-t21-pdf container, docs/verification/T21-pdf-renderer-runbook.md); this suite never uses the fake renderer");
  }
  return url;
}

let checked: Promise<void> | null = null;

/** Fails loudly when the real renderer is not reachable; there is no fallback. */
export function requireRealRenderer(): Promise<void> {
  checked ??= (async () => {
    const base = rendererUrl().replace(/\/+$/, "");
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!response?.ok) throw new Error(`The PDF renderer is not reachable at ${base}: start workpulse-t21-pdf; this suite never falls back to the fake renderer`);
  })();
  return checked;
}

const rendered = new Map<string, Promise<Uint8Array>>();

/** The PDF bytes of a CV render model, from the real Chromium renderer (cached per document). */
export function renderModelPdf(model: CvPreviewModel): Promise<Uint8Array> {
  return renderHtmlPdf(renderCvPrintHtml(model));
}

export function renderHtmlPdf(html: string): Promise<Uint8Array> {
  const key = createHash("sha256").update(html).digest("hex");
  let pending = rendered.get(key);
  if (!pending) {
    pending = (async () => {
      await requireRealRenderer();
      const result = await new GotenbergPdfRenderer({ baseUrl: rendererUrl(), timeoutMs: 60_000 }).render(html, AbortSignal.timeout(90_000));
      if (result.status !== "ok") throw new Error(`The real renderer did not produce a PDF (${result.code})`);
      return result.pdf;
    })();
    rendered.set(key, pending);
  }
  return pending;
}

type TextItem = { str: string; transform: number[]; width: number; height: number };

/** Text of every page with its position, read by pdf.js (legacy build, no canvas needed for text). */
export async function analyzePdf(bytes: Uint8Array): Promise<PdfAnalysis> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await task.promise;
    const pages: PdfPage[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const view = page.view;
      const content = await page.getTextContent();
      const items: PdfItem[] = (content.items as TextItem[])
        .filter((item) => typeof item.str === "string" && item.str.trim() !== "")
        .map((item) => ({ str: item.str, x: item.transform[4]!, y: item.transform[5]!, width: item.width, height: item.height }));
      const lines = groupLines(items);
      pages.push({
        number, width: view[2]! - view[0]!, height: view[3]! - view[1]!, items, lines,
        text: normalize(lines.map((line) => line.text).join(" ")),
      });
    }
    return { bytes: bytes.byteLength, pages, text: normalize(pages.map((page) => page.text).join(" ")) };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Items on one baseline (within one point) form a line; a gap wider than a fifth of the font size is a space. */
function groupLines(items: readonly PdfItem[]): PdfLine[] {
  const groups: PdfItem[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const group = groups.find((candidate) => Math.abs(candidate[0]!.y - item.y) <= 1);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups
    .map((group) => {
      const ordered = [...group].sort((a, b) => a.x - b.x);
      let text = "";
      let previous: PdfItem | null = null;
      for (const item of ordered) {
        if (previous && item.x - (previous.x + previous.width) > previous.height * 0.2 && !/\s$/u.test(text) && !/^\s/u.test(item.str)) text += " ";
        text += item.str;
        previous = item;
      }
      const first = ordered[0]!;
      const last = ordered.at(-1)!;
      return { y: first.y, x: first.x, right: last.x + last.width, text: normalize(text), size: Math.max(...ordered.map((item) => item.height)) };
    })
    .sort((a, b) => b.y - a.y);
}

/** Every printed string of a render model, in print order (mirrors the template without reading its HTML). */
export function printedStrings(model: CvPreviewModel): string[] {
  const out: string[] = [];
  const contact = (["contact_email", "phone", "location", "website"] as const).map((key) => model.profile[key]).filter((value): value is string => Boolean(value));
  if (model.profile.display_name) out.push(model.profile.display_name);
  if (model.profile.headline) out.push(model.profile.headline);
  if (contact.length > 0) out.push(contact.join(" · "));
  if (model.summary) out.push(model.summary);
  const entry = (item: CvPreviewModel["sections"][number]["entries"][number]): boolean => {
    if (item.deleted) return false;
    out.push(item.headline);
    const meta = [item.subline, item.dates].filter((part): part is string => Boolean(part)).join(" · ");
    if (meta) out.push(meta);
    if (item.text) out.push(item.text);
    for (const child of item.children) entry(child);
    return true;
  };
  for (const section of model.sections) {
    const printable = section.entries.filter((candidate) => !candidate.deleted);
    if (printable.length === 0) continue;
    out.push(section.heading);
    for (const candidate of printable) entry(candidate);
  }
  return out.map(normalize).filter((value) => value !== "");
}

/** Height of the text area of a page: A4 minus the top and bottom `@page` margins. */
export const CONTENT_HEIGHT = A4.height - MARGIN.top - MARGIN.bottom;

const unmarked = (text: string): string => text.replace(/^[•◦▪‣]\s*/u, "");

type LineAt = { page: PdfPage; index: number };

function findLine(analysis: PdfAnalysis, test: (text: string) => boolean): LineAt | null {
  for (const page of analysis.pages) {
    const index = page.lines.findIndex((line) => test(unmarked(line.text)));
    if (index >= 0) return { page, index };
  }
  return null;
}

/**
 * The printed height of a block from the line that is exactly `headline` to the line that holds `END-<endTag>`, added up
 * over every page it covers (the top of its first line to the foot of its last line on each page). Null if not found.
 */
export function blockExtent(analysis: PdfAnalysis, headline: string, endTag: string): { height: number; firstPage: number; lastPage: number } | null {
  const start = findLine(analysis, (text) => text === normalize(headline));
  const end = findLine(analysis, (text) => new RegExp(`(^|\\s)END-${endTag}$`).test(text));
  if (!start || !end || end.page.number < start.page.number) return null;
  let height = 0;
  for (let number = start.page.number; number <= end.page.number; number += 1) {
    const page = analysis.pages[number - 1]!;
    const from = number === start.page.number ? start.index : 0;
    const to = number === end.page.number ? end.index : page.lines.length - 1;
    const top = page.lines[from]!;
    height += top.y + top.size - page.lines[to]!.y;
  }
  return { height, firstPage: start.page.number, lastPage: end.page.number };
}

/** The empty room at the foot of every page that is followed by another page (last line to the bottom margin). */
export function bottomGaps(analysis: PdfAnalysis): { page: number; empty: number }[] {
  return analysis.pages.slice(0, -1).map((page) => ({ page: page.number, empty: (page.lines.at(-1)?.y ?? A4.height - MARGIN.top) - MARGIN.bottom }));
}

export interface Placement {
  expected: string;
  /** 1-based page of the first and last character of the string, or null when it was not found. */
  firstPage: number | null;
  lastPage: number | null;
}

/**
 * Finds the strings, in order, in the text of the pages (a string may wrap and may straddle a page break).
 * Returns the placements and the text left over between and around them (what is in the PDF but not in the model).
 */
export function matchInOrder(analysis: PdfAnalysis, expected: readonly string[]): { placements: Placement[]; leftover: string } {
  // One flat text with the page of every character, so strings can straddle pages.
  let flat = "";
  const pageAt: number[] = [];
  for (const page of analysis.pages) {
    if (flat !== "") {
      flat += " ";
      pageAt.push(page.number);
    }
    flat += page.text;
    for (let index = 0; index < page.text.length; index += 1) pageAt.push(page.number);
  }
  const placements: Placement[] = [];
  const gaps: string[] = [];
  let cursor = 0;
  for (const text of expected) {
    const at = flat.indexOf(text, cursor);
    if (at < 0) {
      placements.push({ expected: text, firstPage: null, lastPage: null });
      continue;
    }
    gaps.push(flat.slice(cursor, at));
    placements.push({ expected: text, firstPage: pageAt[at] ?? null, lastPage: pageAt[at + text.length - 1] ?? null });
    cursor = at + text.length;
  }
  gaps.push(flat.slice(cursor));
  // Bullet markers of the child lists are text too; they are not part of the model.
  return { placements, leftover: normalize(gaps.join(" ").replace(/[•◦▪‣]/gu, " ")) };
}
