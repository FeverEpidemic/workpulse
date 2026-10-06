import { describe, expect, it } from "vitest";

import { CV_LABELS } from "@/domain/cv/labels";
import { buildCvPreviewModel, type CvPreviewEntry, type CvPreviewModel } from "@/domain/cv/preview";
import { buildExportRenderModel, cvExportSnapshotSchema } from "@/domain/cv/export";
import { renderCvPrintHtml } from "@/server/export/cv-print-template";

import {
  achievementSnapshot, documentRow, exportSnapshotFrom, itemRow, richCvFixture, skillSnapshot, uuid,
} from "./cv-fixtures";

function modelFor(locale: "en" | "id") {
  const { document, items } = richCvFixture(locale);
  return buildExportRenderModel(cvExportSnapshotSchema.parse(exportSnapshotFrom(document, items)));
}

function allEntries(model: CvPreviewModel): CvPreviewEntry[] {
  return model.sections.flatMap((section) => section.entries.flatMap((entry) => [entry, ...entry.children]));
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("T21 single-column print template", () => {
  it("renders a complete A4 print document with the CV language and no resource", () => {
    const html = renderCvPrintHtml(modelFor("id"));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="id">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("style-src 'unsafe-inline'");
    expect(renderCvPrintHtml(modelFor("en"))).toContain('<html lang="en">');
  });

  it("carries no script, link, image, frame, form, anchor or external reference", () => {
    const html = renderCvPrintHtml(modelFor("id"));
    expect(html).not.toMatch(/<\s*(script|link|img|iframe|object|embed|form|a|base|svg|video|audio|source|input|button)\b/i);
    expect(html).not.toMatch(/\b(href|src|srcset|action|formaction|poster)\s*=/i);
    expect(html).not.toMatch(/url\s*\(/i);
    expect(html).not.toMatch(/@import|@font-face/i);
    expect(html).not.toMatch(/http-equiv="refresh"/i);
    // A website is plain text on the CV, never a link.
    expect(html).toContain("https://siti.example.com");
  });

  it("escapes every value in every field", () => {
    const payload = `<script>alert("x")</script> & 'q' "d"`;
    const escaped = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39; &quot;d&quot;";
    const document = documentRow({
      title: payload, summary_override: payload,
      profile_snapshot: {
        display_name: payload, headline: payload, summary: null, contact_email: null, phone: payload, location: payload, website: null,
      },
    });
    const items = [
      itemRow(uuid(1), "achievements", 1, achievementSnapshot(uuid(301), { title: payload, cv_bullet: payload })),
      itemRow(uuid(2), "skills", 1, skillSnapshot(uuid(401), payload)),
    ];
    const html = renderCvPrintHtml(buildCvPreviewModel({ document, items }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain(payload);
    // title, name, headline, summary, phone, location, achievement title, bullet, skill name
    expect(count(html, escaped)).toBeGreaterThanOrEqual(9);
  });

  it("uses the section headings of the CV language", () => {
    const html = renderCvPrintHtml(modelFor("id"));
    for (const heading of Object.values(CV_LABELS.id.sections)) expect(html).toContain(`<h2>${heading}</h2>`);
    expect(renderCvPrintHtml(modelFor("en"))).toContain(`<h2>${CV_LABELS.en.sections.education}</h2>`);
    expect(renderCvPrintHtml(modelFor("en"))).not.toContain(`<h2>${CV_LABELS.id.sections.education}</h2>`);
  });

  it("prints the name, headline, contact line and summary once and in order", () => {
    const html = renderCvPrintHtml(modelFor("id"));
    expect(count(html, "<h1>")).toBe(1);
    expect(html).toContain("<h1>Siti Nurhaliza Ç. Ñuñez</h1>");
    expect(html).toContain("Analis Data Senior");
    expect(html).toContain("siti@example.com · Jakarta · https://siti.example.com");
    expect(html).toContain("Ringkasan buatan sendiri");
    expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf("Analis Data Senior"));
    expect(html.indexOf("Analis Data Senior")).toBeLessThan(html.indexOf("Ringkasan buatan sendiri"));
    expect(html.indexOf("Ringkasan buatan sendiri")).toBeLessThan(html.indexOf("<h2>"));
  });

  it("prints every entry and every nested achievement exactly once, with the effective wording", () => {
    const model = modelFor("id");
    const html = renderCvPrintHtml(model);
    const entries = allEntries(model);
    expect(entries).toHaveLength(7);
    expect(count(html, 'class="entry-title"')).toBe(entries.length);
    for (const entry of entries) expect(count(html, `<h3 class="entry-title">${entry.headline}</h3>`)).toBe(1);
    expect(html).toContain("Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”");
    expect(html).toContain("Bullet yang ditulis ulang");
    expect(html).not.toContain("Bullet 302");
  });

  it("nests the project achievement under its project", () => {
    const html = renderCvPrintHtml(modelFor("en"));
    const project = html.indexOf("Skripsi Sistem Antrian");
    const child = html.indexOf("Title 301");
    const nextSection = html.indexOf("<h2>Achievements</h2>");
    expect(project).toBeGreaterThan(-1);
    expect(child).toBeGreaterThan(project);
    expect(child).toBeLessThan(nextSection);
  });

  it("omits entries whose source was deleted and never prints a field outside the model", () => {
    const { document, items } = richCvFixture("en");
    const deleted = items.map((item) => (item.id === uuid(4) ? { ...item, source_deleted: true, achievement_id: null } : item));
    const html = renderCvPrintHtml(buildCvPreviewModel({ document, items: deleted }));
    expect(html).not.toContain("Bullet yang ditulis ulang");
    expect(html).not.toContain("Title 302");
    expect(html).toContain("Title 301");
  });

  it("never prints a credential link, an item id or a source id", () => {
    const { document, items } = richCvFixture("en");
    const withLink = items.map((item) => item.id === uuid(7)
      ? { ...item, source_snapshot: { ...item.source_snapshot, credential_url: "https://example.com/WP-CREDENTIAL" } as typeof item.source_snapshot }
      : item);
    const html = renderCvPrintHtml(buildCvPreviewModel({ document, items: withLink }));
    expect(html).not.toContain("WP-CREDENTIAL");
    expect(html).not.toContain(uuid(1));
    expect(html).not.toContain(uuid(301));
    expect(html).not.toContain("evidence");
  });

  it("leaves out empty parts instead of printing empty tags", () => {
    const document = documentRow({
      summary_override: null,
      profile_snapshot: { display_name: "Ani", headline: null, summary: null, contact_email: null, phone: null, location: null, website: null },
    });
    const html = renderCvPrintHtml(buildCvPreviewModel({ document, items: [itemRow(uuid(1), "skills", 1, skillSnapshot(uuid(401)))] }));
    expect(html).not.toContain('class="headline"');
    expect(html).not.toContain('class="contact"');
    expect(html).not.toContain('class="summary"');
    expect(html).not.toContain('class="entry-meta"');
    expect(html).not.toContain('class="entry-text"');
    expect(html).not.toMatch(/<(p|h1|h2|h3|li|ul|section)[^>]*>\s*<\/\1>/);
  });

  it("prints no name block when the model has no name", () => {
    const document = documentRow({ profile_snapshot: { display_name: null, headline: null, summary: null } });
    const html = renderCvPrintHtml(buildCvPreviewModel({ document, items: [] }));
    expect(html).not.toContain("<h1>");
  });

  it("sets the A4 page, the font stack and the break rules", () => {
    const html = renderCvPrintHtml(modelFor("en"));
    expect(html).toContain("@page { size: A4; margin: 16mm 18mm; }");
    expect(html).toContain("font-family: 'Noto Sans', sans-serif");
    expect(html).toMatch(/h2\s*\{[^}]*break-after:\s*avoid/);
    expect(html).toMatch(/\.entry\s*\{[^}]*break-inside:\s*avoid/);
    expect(html).toMatch(/\.child\s*\{[^}]*break-inside:\s*avoid/);
    expect(html).toContain("white-space: pre-line");
  });

  it("is deterministic", () => {
    expect(renderCvPrintHtml(modelFor("id"))).toBe(renderCvPrintHtml(modelFor("id")));
  });
});
