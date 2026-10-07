import { beforeAll, describe, expect, it } from "vitest";

import type { CvLocale } from "@/domain/cv/contracts";
import { exportTextShowsName } from "@/domain/cv/export";
import { CV_LABELS } from "@/domain/cv/labels";
import type { CvPreviewModel } from "@/domain/cv/preview";

import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import {
  CREDENTIAL_URL,
  NON_LATIN_NAMES,
  SENTINEL,
  SWEEP_HEADING_PATTERN,
  SWEEP_SECTIONS,
  SWEEP_TAG_PATTERN,
  graduate,
  nonLatinName,
  ownerA,
  ownerLong,
  sweepModel,
  type PdfFixture,
} from "./fixtures";
import {
  A4,
  MARGIN,
  analyzePdf,
  matchInOrder,
  normalize,
  printedStrings,
  renderModelPdf,
  requireRealRenderer,
  type PdfAnalysis,
} from "./pdf-layout";

const log = (line: string) => process.stdout.write(`PDF-QA ${line}\n`);

beforeAll(async () => {
  await requireRealRenderer();
});

const FIXTURES: PdfFixture[] = [ownerA("en"), ownerA("id"), ownerLong("en"), ownerLong("id"), graduate()];

const analyses = new Map<string, Promise<PdfAnalysis>>();
function analysisOf(fixture: PdfFixture): Promise<PdfAnalysis> {
  let pending = analyses.get(fixture.name);
  if (!pending) {
    pending = renderModelPdf(fixture.model).then(analyzePdf);
    analyses.set(fixture.name, pending);
  }
  return pending;
}

describe("T22 PDF QA: the extracted text matches the model (R10, real Chromium)", () => {
  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s prints every line of the model, in order, and nothing else", async (_name, fixture) => {
    const analysis = await analysisOf(fixture);
    const expected = printedStrings(fixture.model);
    const { placements, leftover } = matchInOrder(analysis, expected);
    const missing = placements.filter((placement) => placement.firstPage === null).map((placement) => placement.expected.slice(0, 60));
    expect(missing, "strings of the model that are not in the PDF text (or not in the model's order)").toEqual([]);
    expect(leftover, "text in the PDF that is not in the model").toBe("");
    log(`extract ${fixture.name}: pages=${analysis.pages.length} strings=${expected.length} chars=${analysis.text.length}`);
  });

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s prints what must be printed and never evidence, links or ids", async (_name, fixture) => {
    const text = (await analysisOf(fixture)).text;
    for (const value of fixture.mustPrint) expect(text, value.slice(0, 50)).toContain(normalize(value));
    for (const value of fixture.mustNotPrint) expect(text, value).not.toContain(value);
    expect(text).not.toMatch(/credential|https?:\/\/credential/i);
    expect(text).not.toMatch(/\b(null|undefined|NaN|Invalid Date)\b/);
    // A UUID (item id, source id) or a storage-looking key is never part of a CV.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(text).not.toMatch(/\/export\/|workpulse-private/);
  });

  it("prints no placeholder for an unknown date and no leftover separator", async () => {
    const text = (await analysisOf(ownerA("id"))).text;
    expect(text).toContain("Komunitas Relawan");
    expect(text).not.toMatch(/Komunitas Relawan\s*[·–-]/);
    expect(text).toContain("2019 – 2020");
    expect(text).toContain("Mar 2023 – Sekarang");
  });

  it("follows the CV language for headings and dates, and keeps the source text untranslated", async () => {
    for (const locale of ["en", "id"] as const) {
      const text = (await analysisOf(ownerA(locale))).text;
      const labels = CV_LABELS[locale];
      for (const heading of [labels.sections.experience, labels.sections.projects, labels.sections.achievements, labels.sections.education, labels.sections.skills, labels.sections.certifications]) {
        expect(text, `${locale} ${heading}`).toContain(heading);
      }
      expect(text).toContain(labels.present);
      // The bullet is Indonesian in both CVs: the CV language never translates it.
      expect(text).toContain("Pengelolaan anggaran");
    }
  });

  it("replaces the source wording with the override and omits the source text", async () => {
    const text = (await analysisOf(ownerA("en"))).text;
    expect(text).toContain("Bullet yang ditulis ulang pengguna.");
    expect(text).not.toContain("Teks sumber yang digantikan");
  });
});

describe("T22 PDF QA: A4, margins and no clipping", () => {
  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s: every page is A4 and every text item is inside the margins", async (_name, fixture) => {
    const analysis = await analysisOf(fixture);
    const offenders: string[] = [];
    for (const page of analysis.pages) {
      expect(Math.abs(page.width - A4.width), `page ${page.number} width`).toBeLessThanOrEqual(1);
      expect(Math.abs(page.height - A4.height), `page ${page.number} height`).toBeLessThanOrEqual(1);
      for (const item of page.items) {
        const inside = item.x >= MARGIN.left - 2 && item.x + item.width <= page.width - MARGIN.right + 2
          && item.y >= MARGIN.bottom - 2 && item.y + item.height <= page.height - MARGIN.top + 2;
        if (!inside) offenders.push(`p${page.number} "${item.str.slice(0, 30)}" x=${item.x.toFixed(1)}..${(item.x + item.width).toFixed(1)} y=${item.y.toFixed(1)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))("%s: nothing is scaled down (name 20 pt, body 10 pt, contact 9 pt)", async (_name, fixture) => {
    const analysis = await analysisOf(fixture);
    const first = analysis.pages[0]!;
    const sizes = first.items.map((item) => item.height);
    // Chromium shrinks the whole page to fit when something is wider than the page: the sizes would drop to about two thirds.
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(19.5);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(20.5);
    for (const page of analysis.pages) {
      for (const item of page.items) expect(item.height, `p${page.number} "${item.str.slice(0, 20)}"`).toBeGreaterThanOrEqual(8.5);
    }
  });

  it("the multipage CV has more than one page and at most twenty", async () => {
    for (const locale of ["en", "id"] as const) {
      const analysis = await analysisOf(ownerLong(locale));
      expect(analysis.pages.length, locale).toBeGreaterThan(1);
      expect(analysis.pages.length, locale).toBeLessThanOrEqual(20);
      log(`multipage ${locale}: pages=${analysis.pages.length} bytes=${analysis.bytes}`);
    }
  });

  it("the start and the end of every long bullet are in the text, in one piece", async () => {
    for (const locale of ["en", "id"] as const) {
      const fixture = ownerLong(locale);
      const analysis = await analysisOf(fixture);
      const { placements } = matchInOrder(analysis, fixture.mustPrint.map(normalize));
      expect(placements.filter((placement) => placement.firstPage === null), locale).toEqual([]);
      for (const bullet of fixture.mustPrint) {
        expect(bullet.length).toBeGreaterThanOrEqual(600);
        expect(analysis.text).toContain(`START-${/START-(\S+)/.exec(bullet)![1]}`);
        expect(analysis.text).toContain(`END-${/END-(\S+)$/.exec(bullet)![1]}`);
      }
    }
  });

  it("a long unbroken word (a website, a URL-like token) does not run off the page", async () => {
    const model: CvPreviewModel = {
      ...sweepModel(1),
      profile: { display_name: "Ani Contoh", headline: "Analis", contact_email: "ani@example.com", phone: null, location: null, website: `https://example.com/${"a".repeat(110)}` },
      sections: [{
        key: "achievements", heading: "Achievements",
        entries: [{ itemId: "u1", type: "achievement", headline: "Hasil", subline: null, dates: null, text: `Token ${"b".repeat(150)} selesai`, deleted: false, hasOverride: false, children: [] }],
      }],
    };
    const analysis = await analyzePdf(await renderModelPdf(model));
    const offenders = analysis.pages.flatMap((page) => page.items.filter((item) => item.x + item.width > page.width - MARGIN.right + 2).map((item) => `p${page.number} "${item.str.slice(0, 20)}" right=${(item.x + item.width).toFixed(1)}`));
    expect(offenders).toEqual([]);
    // The page is not shrunk to fit the token (that would make the whole CV about two thirds of its size) ...
    expect(Math.max(...analysis.pages[0]!.items.map((item) => item.height))).toBeGreaterThanOrEqual(19.5);
    // ... and no character of it is lost: the token wraps at the margin, so only line breaks separate its pieces.
    const joined = analysis.text.replaceAll(" ", "");
    expect(joined).toContain("a".repeat(110));
    expect(joined).toContain("b".repeat(150));
  });
});

describe("T22 PDF QA: page breaks (headings stay with content, entries that fit stay whole)", () => {
  const isHeading = (text: string) => (SWEEP_SECTIONS as readonly string[]).includes(text) || SWEEP_HEADING_PATTERN.test(text);

  it("sweeps 60 fillers through the bottom of the pages without an orphan heading or a split entry", async () => {
    const variants = 60;
    const bottomZone = MARGIN.bottom + 150;
    let orphans = 0;
    let splits = 0;
    let nearBottom = 0;
    let pushedToNextPage = 0;
    let maxEntryHeight = 0;
    const problems: string[] = [];
    const rows: string[] = [];
    for (let lines = 1; lines <= variants; lines += 1) {
      const analysis = await analyzePdf(await renderModelPdf(sweepModel(lines)));
      const info: string[] = [];
      analysis.pages.forEach((page, index) => {
        const last = page.lines.at(-1);
        if (!last) return;
        const heading = isHeading(last.text);
        if (heading) { orphans += 1; problems.push(`n=${lines} page ${page.number} ends with the heading "${last.text}"`); }
        info.push(`p${page.number}:last="${last.text}"@${last.y.toFixed(0)}${heading ? " ORPHAN" : ""}`);
        for (const line of page.lines) if (isHeading(line.text) && line.y < bottomZone) nearBottom += 1;
        const next = analysis.pages[index + 1];
        const nextTop = next?.lines[0];
        // A page that ends early (room for 100+ points) while the next one starts with a heading: the heading was moved on.
        if (nextTop && isHeading(nextTop.text) && last.y > MARGIN.bottom + 100) pushedToNextPage += 1;
      });
      const tags = new Map<string, { pages: Set<number>; top: number; bottom: number }>();
      for (const page of analysis.pages) {
        for (const line of page.lines) {
          const tag = SWEEP_TAG_PATTERN.exec(line.text)?.[1];
          if (!tag) continue;
          const entry = tags.get(tag) ?? { pages: new Set<number>(), top: -Infinity, bottom: Infinity };
          entry.pages.add(page.number);
          entry.top = Math.max(entry.top, line.y + line.size);
          entry.bottom = Math.min(entry.bottom, line.y);
          tags.set(tag, entry);
        }
      }
      for (const [tag, entry] of tags) {
        if (entry.pages.size > 1) { splits += 1; problems.push(`n=${lines} entry ${tag} is on pages ${[...entry.pages].join(",")}`); }
        else maxEntryHeight = Math.max(maxEntryHeight, entry.top - entry.bottom);
      }
      rows.push(`n=${String(lines).padStart(2)} pages=${analysis.pages.length} ${info.join(" ; ")}`);
    }
    log(`sweep variants=${variants} orphanPages=${orphans} splitEntries=${splits} headingsNearBottom=${nearBottom} headingsPushedToNextPage=${pushedToNextPage} maxEntryHeight=${maxEntryHeight.toFixed(1)}pt`);
    for (const row of rows) log(`sweep ${row}`);
    expect(problems).toEqual([]);
    // The sweep must really put headings at the foot of the pages, otherwise a pass would prove nothing.
    expect(nearBottom, "variants that put a heading in the last 150 points of a page").toBeGreaterThanOrEqual(10);
    expect(pushedToNextPage, "variants where a heading was moved to the next page").toBeGreaterThanOrEqual(3);
    // Every entry of the sweep is short enough for one page, so none may be split.
    expect(maxEntryHeight).toBeLessThan(A4.height - MARGIN.top - MARGIN.bottom);
  });

  it("never ends a page of a real multipage CV with a heading, and keeps every long bullet on one page", async () => {
    for (const locale of ["en", "id"] as const) {
      const fixture = ownerLong(locale);
      const analysis = await analysisOf(fixture);
      const headings = new Set<string>(fixture.model.sections.flatMap((section) => [section.heading, ...section.entries.flatMap((entry) => [entry.headline, ...entry.children.map((child) => child.headline)])]).map(normalize));
      for (const page of analysis.pages) {
        const last = page.lines.at(-1);
        expect(last && headings.has(last.text) ? `${locale} page ${page.number} ends with "${last.text}"` : null).toBeNull();
      }
      const { placements } = matchInOrder(analysis, fixture.mustPrint.map(normalize));
      const split = placements.filter((placement) => placement.firstPage !== placement.lastPage).map((placement) => placement.expected.slice(0, 20));
      expect(split, `${locale} bullets that are split across pages although each fits one page`).toEqual([]);
    }
  });

  it("lets the one entry that is longer than a page split, and records it", async () => {
    const fixture = ownerLong("en");
    const analysis = await analysisOf(fixture);
    const { placements } = matchInOrder(analysis, printedStrings(fixture.model));
    const project = placements.find((placement) => placement.expected === "Program Transformasi Digital");
    const lastChild = placements.find((placement) => placement.expected.includes("END-P26"));
    expect(project?.firstPage).not.toBeNull();
    expect(lastChild?.lastPage).not.toBeNull();
    const span = (lastChild?.lastPage ?? 0) - (project?.firstPage ?? 0) + 1;
    log(`long entry: "Program Transformasi Digital" spans ${span} pages (page ${project?.firstPage} to ${lastChild?.lastPage}) of ${analysis.pages.length}`);
    expect(span).toBeGreaterThan(1);
  });
});

describe("T22 PDF QA: Unicode (decision 0027 N4)", () => {
  it("keeps Indonesian text, accents and curved quotes searchable after NFKC", async () => {
    const analysis = await analysisOf(ownerA("id"));
    for (const value of ["Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”", "Ç Ñ ś ñ", "“melengkung”", "Siti Nurhaliza Ç. Ñuñez"]) {
      expect(analysis.text, value).toContain(normalize(value));
    }
  });

  it.each(NON_LATIN_NAMES.map((entry) => [entry.script, entry.name] as const))("a %s name renders and passes the worker's name check", async (script, name) => {
    const fixture = nonLatinName(name);
    const bytes = await renderModelPdf(fixture.model);
    const parsed = await parseInThread("pdf-export", bytes);
    expect(parsed.status).toBe("ok");
    if (parsed.status !== "ok") return;
    const text = parsed.text ?? "";
    const headings = [CV_LABELS.en.sections.education, CV_LABELS.en.sections.achievements];
    expect(exportTextShowsName(text, name, headings), `${script}: the worker accepts the PDF text`).toBe(true);
    const forward = normalize(text).includes(normalize(name));
    log(`unicode ${script}: pages=${parsed.pageCount} forwardMatch=${forward} headingsPrinted=${headings.every((heading) => text.includes(heading))}`);
    // The rest of the CV is still searchable whatever the script of the name is.
    expect(text).toContain("Improved a process by 12 percent.");
  });

  it("the sentinel appears only in the owner's own PDF text (never a link or a credential)", async () => {
    const text = (await analysisOf(ownerA("en"))).text;
    expect(text).toContain(SENTINEL);
    expect(text).not.toContain(CREDENTIAL_URL);
  });

  it.each(["en", "id"] as const)("renders a CV in %s with the real renderer, as a PDF of searchable A4 pages", async (locale: CvLocale) => {
    const analysis = await analysisOf(ownerA(locale));
    expect(analysis.pages.length).toBeGreaterThanOrEqual(1);
    expect(analysis.text.length).toBeGreaterThan(200);
  });
});
