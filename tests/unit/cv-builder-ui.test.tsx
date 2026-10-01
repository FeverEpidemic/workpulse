import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/cv/actions", () => ({
  removeCvItemAction: vi.fn(), reorderCvSectionAction: vi.fn(), saveCvEditsAction: vi.fn(), selectCvSourceAction: vi.fn(), updateCvLayoutAction: vi.fn(),
}));

import { buildCvPreviewModel } from "@/domain/cv/preview";
import { CvBuilder } from "@/features/cv/cv-builder";
import { CvConflictPanel, CvRemoveDialog } from "@/features/cv/cv-panels";
import { CvPreview } from "@/features/cv/cv-preview";
import { EMPTY_POOL, resolveHighlight, toPoolOptions, type PoolBySection } from "@/features/cv/cv-view";

import { documentRow, graduateItems, uuid } from "./cv-fixtures";

const pool = (over: Partial<PoolBySection> = {}): PoolBySection => ({
  ...EMPTY_POOL,
  education: [{ sourceType: "education", sourceId: uuid(201), label: "S1 · Informatika · Universitas Contoh", detail: null, selected: true }],
  projects: [{ sourceType: "project", sourceId: uuid(101), label: "Skripsi Sistem Antrian", detail: null, selected: true }],
  achievements: [
    { sourceType: "achievement", sourceId: uuid(301), label: "Title 301", detail: "Bullet 301", selected: true },
    { sourceType: "achievement", sourceId: uuid(302), label: "Title 302", detail: "Bullet 302", selected: true },
    { sourceType: "achievement", sourceId: uuid(303), label: "Belum ditambahkan", detail: "Bullet 303", selected: false },
  ],
  skills: [{ sourceType: "skill", sourceId: uuid(401), label: "SQL", detail: null, selected: true }],
  ...over,
});

function render(props: Partial<React.ComponentProps<typeof CvBuilder>> = {}) {
  return renderToStaticMarkup(
    <CvBuilder locale="en" document={documentRow()} items={graduateItems()} pool={pool()} highlightId={null} {...props} />,
  );
}

describe("T19 S13 CV builder", () => {
  it("shows an empty CV with an explanation, an available list per section and nothing added automatically", () => {
    const html = render({ items: [], pool: { ...EMPTY_POOL, skills: [{ sourceType: "skill", sourceId: uuid(401), label: "SQL", detail: null, selected: false }] } });
    expect(html).toContain("Your CV is empty");
    expect(html).toContain("Nothing is added automatically");
    expect(html).toContain("Available to add (1)");
    expect(html).toContain('aria-label="Add SQL to CV"');
    expect(html).not.toContain("Add all");
    expect(html).toContain("Add records to see your CV here.");
    expect(html).toContain("All changes saved");
    expect(html.match(/data-testid="cv-item"/g)).toBeNull();
  });

  it("lists selected items, nests the child achievement under its project once and offers only unadded records as Add", () => {
    const html = render();
    const items = [...html.matchAll(/data-item-id="([^"]+)"/g)].map((match) => match[1]);
    expect(items).toEqual([uuid(2), uuid(3), uuid(4), uuid(1), uuid(5)]);
    expect(items.filter((id) => id === uuid(3))).toHaveLength(1);
    expect(html).toContain('aria-label="Add Belum ditambahkan to CV"');
    expect(html).toContain('aria-label="Title 301 is already on the CV"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain("Draf saja");
  });

  it("labels every move control with the item or section name and disables the edges", () => {
    const html = render();
    expect(html).toContain('aria-label="Move Skripsi Sistem Antrian up"');
    expect(html).toContain('aria-label="Move Skripsi Sistem Antrian down"');
    expect(html).toContain('aria-label="Move Experience section up"');
    expect(html).toContain('aria-label="Move Certifications section down"');
    const firstUp = html.match(/<button[^>]*id="cv-move-00000000-0000-4000-8000-000000000002-up"[^>]*>/)?.[0] ?? "";
    expect(firstUp).toContain("disabled");
    const sectionUp = html.match(/<button[^>]*id="cv-section-move-experience-up"[^>]*>/)?.[0] ?? "";
    expect(sectionUp).toContain("disabled");
    const sectionDown = html.match(/<button[^>]*id="cv-section-move-experience-down"[^>]*>/)?.[0] ?? "";
    expect(sectionDown).not.toContain("disabled");
  });

  it("offers wording edits for wording items but not for skills or certifications", () => {
    const html = render();
    expect(html).toContain('aria-label="Edit wording for Skripsi Sistem Antrian"');
    expect(html).toContain('aria-label="Edit wording for Title 302"');
    expect(html).not.toContain('aria-label="Edit wording for SQL"');
  });

  it("marks manual wording and a deleted source with text badges", () => {
    const items = graduateItems();
    items[3] = { ...items[3]!, override_text: "Custom", source_deleted: true, achievement_id: null };
    const html = render({ items });
    expect(html).toContain("Manual wording");
    expect(html).toContain("Source deleted");
    expect(html).toContain("The record was deleted. The CV keeps the copy saved when you added it.");
  });

  it("shows the Suggested badge, marks the row current and opens the list for a highlighted achievement", () => {
    const html = render({ highlightId: uuid(303) });
    expect(html).toContain("Suggested");
    expect(html).toContain('aria-current="true"');
    const details = html.match(/<details[^>]*class="cv-pool"[^>]*>/g) ?? [];
    expect(details.some((tag) => tag.includes(" open"))).toBe(true);
  });

  it("keeps the interface language separate from the CV language", () => {
    const html = render({ locale: "en", document: documentRow({ locale: "id" }) });
    expect(html).toContain("CV settings");
    expect(html).toContain('lang="id"');
    expect(html).toContain("Pendidikan");
    expect(html).toContain("Skripsi Sistem Antrian");
    expect(html).toContain('<option value="id" selected="">Bahasa Indonesia</option>');
  });

  it("renders the saved preview only and disables Save while nothing changed", () => {
    const html = render({ document: documentRow({ title: "CV Ani", summary_override: "Ringkasan tersimpan" }) });
    expect(html).toContain("Ringkasan tersimpan");
    expect(html).not.toContain("Unsaved changes are not shown");
    const save = html.match(/<button[^>]*>Save changes<\/button>/)?.[0] ?? "";
    expect(save).toContain("disabled");
  });
});

describe("T19 CV preview, panels and view helpers", () => {
  it("tells the user that unsaved edits are not in the preview", () => {
    const model = buildCvPreviewModel({ document: documentRow(), items: graduateItems() });
    const dirty = renderToStaticMarkup(<CvPreview model={model} locale="en" dirty />);
    const clean = renderToStaticMarkup(<CvPreview model={model} locale="en" dirty={false} />);
    expect(dirty).toContain("Unsaved changes are not shown until you save.");
    expect(clean).not.toContain("Unsaved changes are not shown");
    expect(dirty).toContain("Bullet 301");
  });

  it("asks before removing a parent and names each child achievement from client state", () => {
    const html = renderToStaticMarkup(
      <CvRemoveDialog locale="en" open name="Skripsi Sistem Antrian" childNames={["Title 301", "Title 305"]} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />,
    );
    expect(html).toContain("Remove Skripsi Sistem Antrian?");
    expect(html).toContain("<li>Title 301</li>");
    expect(html).toContain("Remove parent and its achievements");
    expect(html).toContain("Cancel");
  });

  it("presents each conflicting field with both versions and a Keep mine / Use saved choice", () => {
    const html = renderToStaticMarkup(
      <CvConflictPanel locale="en" headingRef={{ current: null }} onResolve={() => undefined} fields={[{ key: "summary", label: "Summary", mine: "My text", saved: "Their text" }]} />,
    );
    expect(html).toContain("This CV changed somewhere else");
    expect(html).toContain("My text");
    expect(html).toContain("Their text");
    expect(html).toContain("Keep mine");
    expect(html).toContain("Use saved");
  });

  it("accepts a highlight only for an unselected achievement in the caller's own pool", () => {
    const options = pool();
    expect(resolveHighlight(options, uuid(303))).toBe(uuid(303));
    expect(resolveHighlight(options, uuid(301))).toBeNull();
    expect(resolveHighlight(options, uuid(999))).toBeNull();
    expect(resolveHighlight(options, null)).toBeNull();
    expect(resolveHighlight(options, "not-a-uuid")).toBeNull();
  });

  it("reduces pool rows to display text", () => {
    const options = toPoolOptions({
      experience: [{ row: { id: uuid(1), role_title: "Analis", organization: "PT Magang" } as never, selected: false }],
      projects: [], achievements: [{ row: { id: uuid(2), title: "Hasil", cv_bullet: "Bullet", achieved_on: null, experience_id: null, project_id: null, revision: 1 }, selected: true }],
      education: [], skills: [], certifications: [],
    });
    expect(options.experience[0]).toMatchObject({ sourceType: "experience", label: "Analis · PT Magang", selected: false });
    expect(options.achievements[0]).toMatchObject({ sourceType: "achievement", label: "Hasil", detail: "Bullet", selected: true });
    expect(JSON.stringify(options)).not.toContain("user_id");
  });
});
