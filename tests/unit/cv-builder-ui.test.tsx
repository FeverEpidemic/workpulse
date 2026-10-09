import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/cv/actions", () => ({
  removeCvItemAction: vi.fn(), reorderCvSectionAction: vi.fn(), resolveCvFreshnessAction: vi.fn(), saveCvEditsAction: vi.fn(), selectCvSourceAction: vi.fn(), updateCvLayoutAction: vi.fn(),
}));

import type { CvFreshnessRow } from "@/domain/cv/contracts";
import { buildCvPreviewModel } from "@/domain/cv/preview";
import { CvBuilder } from "@/features/cv/cv-builder";
import { CvConflictPanel, CvProfileEditor, CvRemoveDialog } from "@/features/cv/cv-panels";
import { CvReviewPanel, CvReviewSummary } from "@/features/cv/cv-review";
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
    // An added child achievement says where it is on the CV; a standalone one does not need to.
    expect(html.match(/data-testid="cv-pool-placement"/g)).toHaveLength(1);
    expect(html).toContain("On the CV under Skripsi Sistem Antrian");
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

describe("T20 S13 freshness review", () => {
  const achievementLive = (title: string, bullet: string) => ({
    schema_version: "cv-source.v1" as const, source_type: "achievement" as const, source_id: uuid(301), title, cv_bullet: bullet,
    achieved_on: "2023-05-10", experience_id: null, project_id: uuid(101),
  });
  const rows = (): CvFreshnessRow[] => [
    { target: "item", item_id: uuid(1), state: "changed", live_revision: 4, live_snapshot: { ...({ schema_version: "cv-source.v1", source_type: "education", source_id: uuid(201), institution: "Kampus Baru", qualification: "S1", field_of_study: "Informatika", description: null, start_date: "2019-01-01", start_precision: "year", end_date: "2023-01-01", end_precision: "year", is_current: false } as const) } },
    { target: "item", item_id: uuid(2), state: "fresh", live_revision: 1, live_snapshot: null },
    { target: "item", item_id: uuid(3), state: "kept", live_revision: 5, live_snapshot: achievementLive("Title 301", "Bullet baru") },
    { target: "item", item_id: uuid(4), state: "unconfirmed", live_revision: 2, live_snapshot: null },
    { target: "item", item_id: uuid(5), state: "deleted", live_revision: null, live_snapshot: null },
    { target: "profile", item_id: null, state: "changed", live_revision: 6, live_snapshot: { display_name: "Ani Baru", headline: "Graduate", summary: "Source summary", contact_email: "ani@example.com", phone: null, location: null, website: null } },
  ];

  it("renders a text badge, a review button and a summary for every item that needs review, and nothing for fresh ones", () => {
    const html = render({ freshness: rows(), items: graduateItems().map((item, index) => (index === 4 ? { ...item, source_deleted: true } : item)) });
    expect(html).toContain("Source changed");
    expect(html).toContain("Saved wording kept");
    expect(html).toContain("Source unconfirmed");
    expect(html).toContain('id="cv-review"');
    // The profile, the changed, the unconfirmed and the deleted item need review; the kept and fresh ones do not.
    expect(html).toContain("4 items need review");
    expect(html).toContain('aria-label="Review change for S1, Informatika"');
    expect(html).toContain('href="#cv-profile-heading"');
    expect(html).toContain(`href="#cv-item-${uuid(1)}"`);
    const secondItem = html.match(new RegExp(`<li[^>]*data-item-id="${uuid(2)}"[^>]*>`))?.[0] ?? "";
    expect(secondItem).toContain('data-freshness="fresh"');
    expect(html).not.toContain(`cv-review-open-${uuid(2)}`);
  });

  it("offers the bulk refresh only when a changed item has no manual wording", () => {
    expect(render({ freshness: rows() })).toContain("Refresh all items without manual wording");
    const withWording = graduateItems().map((item) => (item.id === uuid(1) ? { ...item, override_text: "Teks saya" } : item));
    expect(render({ freshness: rows(), items: withWording })).not.toContain("Refresh all items without manual wording");
    expect(render({ freshness: [] })).not.toContain('id="cv-review"');
    expect(render({ freshness: [{ target: "item", item_id: uuid(1), state: "kept", live_revision: 3, live_snapshot: achievementLive("T", "B") }] })).not.toContain('id="cv-review"');
  });

  it("keeps every review panel closed until the user opens one, and the preview shows the saved CV only", () => {
    const html = render({ freshness: rows() });
    expect(html).not.toContain('data-testid="cv-review-panel"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Bullet 301");
    expect(html).not.toContain("Bullet baru");
  });

  it("gives the achievement pool a stable anchor for the dashboard link", () => {
    expect(render()).toContain('id="cv-pool-achievements"');
  });

  const panel = (over: Partial<React.ComponentProps<typeof CvReviewPanel>> = {}) =>
    renderToStaticMarkup(
      <CvReviewPanel
        locale="en" id="cv-review-x" name="Title 301" kind="item" state="changed" hasOverride={false} overrideText={null}
        rows={[{ label: "Description", saved: "Bullet lama", live: "Bullet baru" }]} contextChanged={false}
        choices={[{ id: "refresh", action: "refresh", primary: true }, { id: "keep_saved", action: "keep", primary: false }]}
        blocked={false} busy={false} achievementId={null} onChoose={() => undefined} {...over}
      />,
    );

  it("compares the saved and current version and labels the two primary choices for an item without wording", () => {
    const html = panel();
    expect(html).toContain("Saved on CV");
    expect(html).toContain("Current source");
    expect(html).toContain("Bullet lama");
    expect(html).toContain("Bullet baru");
    expect(html).toContain('aria-label="Refresh Title 301 from source"');
    expect(html).toContain('aria-label="Keep saved wording for Title 301"');
    expect(html).toContain("Refresh from source");
    expect(html).toContain("Keep saved wording");
    expect(html).not.toContain("Replace from source");
  });

  it("shows the user's own wording and offers Keep my wording first and Replace from source second", () => {
    const html = panel({
      hasOverride: true, overrideText: "Kalimat saya",
      choices: [{ id: "keep_mine", action: "refresh", primary: true }, { id: "replace", action: "replace", primary: false }],
    });
    expect(html).toContain("Your wording");
    expect(html).toContain("Kalimat saya");
    expect(html.indexOf("Keep my wording")).toBeLessThan(html.indexOf("Replace from source"));
    expect(html).toContain("Your own wording stays on the CV");
    const primary = html.match(/<button[^>]*>Keep my wording<\/button>/)?.[0] ?? "";
    expect(primary).toContain("button-primary");
  });

  it("disables the actions with a visible reason while unsaved wording exists", () => {
    const html = panel({ blocked: true });
    expect(html).toContain("Save or discard your wording first.");
    expect(html.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(html).toContain('aria-describedby="cv-review-x-reason"');
    expect(panel({ blocked: false })).not.toContain("Save or discard your wording first.");
    expect(panel({ busy: true }).match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it("explains a deleted source without offering a refresh and links an unconfirmed achievement to its detail page", () => {
    const deleted = panel({ state: "deleted", choices: [], rows: [] });
    expect(deleted).toContain("The record was deleted, so there is nothing to refresh.");
    expect(deleted).not.toContain("<button");
    const unconfirmed = panel({ state: "unconfirmed", choices: [], rows: [], achievementId: uuid(301) });
    expect(unconfirmed).toContain(`href="/achievements/${uuid(301)}"`);
    expect(unconfirmed).toContain("Open achievement");
    expect(unconfirmed).not.toContain("<button");
  });

  it("notes a moved parent link when nothing visible differs, and shows a kept state without choices that overwrite", () => {
    expect(panel({ rows: [], contextChanged: true })).toContain("The project or experience this record belongs to changed.");
    const kept = panel({ state: "kept", choices: [{ id: "refresh", action: "refresh", primary: false }] });
    expect(kept).toContain("You kept the saved wording for the current version");
    expect(kept).not.toContain("Replace from source");
    expect(kept).not.toContain("button-primary");
  });

  it("localizes the review text in Indonesian", () => {
    const html = panel({ locale: "id" });
    expect(html).toContain("Tersimpan di CV");
    expect(html).toContain("Sumber terbaru");
    expect(html).toContain("Perbarui dari sumber");
  });

  it("renders the summary with a count heading, per-entry links and the bulk action", () => {
    const html = renderToStaticMarkup(
      <CvReviewSummary
        locale="en" busy={false} bulkCount={2} onBulk={() => undefined}
        entries={[{ kind: "profile", itemId: null, state: "changed", name: "Profile" }, { kind: "item", itemId: uuid(1), state: "deleted", name: "S1" }]}
      />,
    );
    expect(html).toContain("2 items need review");
    expect(html).toContain('href="#cv-profile-heading"');
    expect(html).toContain(`href="#cv-item-${uuid(1)}"`);
    expect(html).toContain("Source deleted");
    expect(html).toContain("Refresh all items without manual wording");
    const one = renderToStaticMarkup(<CvReviewSummary locale="en" busy={false} bulkCount={0} onBulk={() => undefined} entries={[{ kind: "profile", itemId: null, state: "changed", name: "Profile" }]} />);
    expect(one).toContain("1 item needs review");
    expect(one).not.toContain("Refresh all items");
  });

  it("reviews the profile with the seven source fields and replaces overrides only by explicit choice", () => {
    const html = renderToStaticMarkup(
      <CvProfileEditor
        locale="en" draft={{}} sourceValues={{}} problems={{}} onDraftChange={() => undefined}
        review={{
          state: "changed", open: true, blocked: false, busy: false, hasOverride: true,
          rows: [{ label: "Name", saved: "Ani Contoh", live: "Ani Baru" }],
          choices: [{ id: "keep_mine", action: "refresh", primary: true }, { id: "replace", action: "replace", primary: false }],
          onToggle: () => undefined, onChoose: () => undefined,
        }}
      />,
    );
    expect(html).toContain("Source changed");
    expect(html).toContain('id="cv-review-open-profile"');
    expect(html).toContain("Ani Baru");
    expect(html).toContain("Keep my wording");
    expect(html).toContain("Replace from source");
    const closed = renderToStaticMarkup(<CvProfileEditor locale="en" draft={{}} sourceValues={{}} problems={{}} onDraftChange={() => undefined} review={null} />);
    expect(closed).not.toContain("cv-review-open-profile");
  });
});

describe("Gate M4: the scrollable preview column", () => {
  it("is a labelled, focusable region so that a keyboard user can scroll it (WCAG 2.1.1)", () => {
    const column = render().match(/<div class="cv-preview-column"[^>]*>/)?.[0] ?? "";
    expect(column).toContain('role="region"');
    expect(column).toContain('aria-label="Preview"');
    expect(column).toContain('tabindex="0"');
  });
});
