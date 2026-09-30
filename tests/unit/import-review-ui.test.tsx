import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/features/import/actions", () => ({
  cancelImportAction: vi.fn(), retryImportAction: vi.fn(), commitImportAction: vi.fn(), updateImportItemAction: vi.fn(), validateImportAction: vi.fn(),
}));
vi.mock("@/features/ai/actions", () => ({ setAiConsentAction: vi.fn() }));

import type { ImportReviewSnapshot, ReviewItemRow } from "@/domain/import/review-view";
import { ImportReview } from "@/features/import/import-review";
import { ImportReviewCandidate, type CandidateHandlers } from "@/features/import/import-review-candidate";
import { toImportReviewView } from "@/domain/import/review-view";

const BATCH = "8f14e45f-ea5e-4a0b-9c2b-000000000001";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = uuid(900);

let counter = 0;
function item(entity_type: ReviewItemRow["entity_type"], ordinal: number, payload: Record<string, unknown> | null, extra: Partial<ReviewItemRow> = {}): ReviewItemRow {
  counter += 1;
  return { id: uuid(counter), entity_type, ordinal, action: "create", target_id: null, confirm_requested: false, payload, source_excerpt: `EXCERPT ${entity_type} ${ordinal}`, revision: 1, ...extra };
}

function snapshot(items: ReviewItemRow[], extra: Partial<ImportReviewSnapshot> = {}): ImportReviewSnapshot {
  return {
    batch: { id: BATCH, filename: "cv.pdf", status: "review", stage: "done", error_code: null, revision: 5, commit_result: null },
    items, targets: { experience: [], education: [], certification: [], skill: [], achievement: [] }, errors: [],
    profile: { onboarded: true, current: {} }, ...extra,
  };
}

function render(snap: ImportReviewSnapshot, locale: "en" | "id" = "en") {
  return renderToStaticMarkup(<ImportReview locale={locale} snapshot={snap} ownerId={OWNER} defaults={{ locale, timezone: "UTC" }} manualHref="/settings/profile" />);
}

const experience = { organization: "PT Sentinel", role_title: "Analis", kind: "employment", start_date: "2019-01-01", start_precision: "year", end_date: null, end_precision: null, is_current: true, description: null };
const achievement = { title: "Cut report time", contribution: null, outcome: null, cv_bullet: null, achieved_on: null, metrics: [] };

describe("T17 S03 import review screen", () => {
  it("shows groups with counts, excerpts, Create/Map/Skip as radios and a selectable map only for non-profile types", () => {
    counter = 0;
    const html = render(snapshot(
      [item("profile", 1, { headline: "Lead", selected_fields: [] }), item("experience", 1, experience), item("skill", 1, { name: "SQL" })],
      { targets: { experience: [], education: [], certification: [], achievement: [], skill: [{ id: uuid(700), label: "Kotlin", match: null }] } },
    ));
    expect(html).toContain("Review imported data");
    expect(html).toContain("<span>Experience</span><span class=\"import-group-count\">1</span>");
    expect(html).toContain("EXCERPT experience 1");
    expect(html.match(/type="radio"/g)).toHaveLength(2 + 3 + 3); // profile: create/skip; others: create/map/skip
    expect(html).toContain("What should happen to this candidate?");
    expect(html).not.toContain("Confirm all");
    expect(html).not.toContain("Skip all");
    // Profile has no Map radio: its radio group carries only Create new and Skip.
    const profileArticle = html.split("<article").find((chunk) => chunk.includes("EXCERPT profile"))!;
    expect(profileArticle).not.toContain("Map to existing");
  });

  it("highlights a missing required field with text and aria wiring, and lists it in an error summary with a link", () => {
    counter = 0;
    const broken = item("experience", 1, { ...experience, role_title: null });
    const html = render(snapshot([broken], { errors: [{ item_id: broken.id, field: "role_title", code: "REQUIRED" }] }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Fix these before importing");
    expect(html).toContain(`href="#${broken.id}-role_title"`);
    expect(html).toContain(`aria-describedby="${broken.id}-role_title-error"`);
    expect(html).toContain(`id="${broken.id}-role_title-error"`);
    expect(html).toContain("This field is required.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Required");
  });

  it("renders the same review in Indonesian", () => {
    counter = 0;
    const html = render(snapshot([item("experience", 1, experience)]), "id");
    expect(html).toContain("Tinjau data hasil impor");
    expect(html).toContain("Konfirmasi impor");
    expect(html).toContain("Lewati");
    expect(html).toContain("Petakan ke data yang ada");
  });

  it("keeps the confirm checkbox disabled with a visible reason until the achievement fields are saved, and never defaults it on", () => {
    counter = 0;
    const draft = item("achievement", 1, achievement);
    const ready = item("achievement", 2, { ...achievement, contribution: "Built", outcome: "Faster", achieved_on: "2024-05-01" });
    const html = render(snapshot([draft, ready]));
    const [draftHtml, readyHtml] = html.split("<article").filter((chunk) => chunk.includes("Confirm this achievement"));
    expect(draftHtml).toMatch(/type="checkbox"[^>]*disabled/);
    expect(draftHtml).toContain("To confirm, add and save: Contribution, Outcome, Achieved on.");
    const confirmBox = (chunk: string | undefined) => (chunk ?? "").match(/<input type="checkbox"[^>]*aria-describedby="[^"]*-confirm-help"[^>]*\/>/)![0];
    expect(confirmBox(readyHtml)).not.toContain("disabled");
    expect(confirmBox(readyHtml)).not.toContain("checked");
    expect(confirmBox(draftHtml)).not.toContain("checked");
  });

  it("explains every reason the final button is disabled and offers a single primary action", () => {
    counter = 0;
    const broken = item("skill", 1, { name: "" });
    const html = render(snapshot([broken], { errors: [{ item_id: broken.id, field: "name", code: "REQUIRED" }] }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-describedby="import-commit-reasons"[^>]*>Confirm import<\/button>|<button[^>]*aria-describedby="import-commit-reasons"[^>]*disabled[^>]*>Confirm import<\/button>/);
    expect(html).toContain("1 selected candidate(s) need fixing.");
    expect(html.match(/class="button-primary"/g) ?? []).toHaveLength(1);
    const clean = render(snapshot([item("skill", 1, { name: "Go" })]));
    expect(clean).not.toMatch(/<button[^>]*disabled[^>]*>Confirm import/);
    expect(clean).not.toContain("import-commit-reasons");
  });

  it("shows the onboarding section only for a provisional account, never prefilled with the placeholder", () => {
    counter = 0;
    const provisional = snapshot([item("profile", 1, { display_name: "Pending onboarding", headline: "Lead", selected_fields: [] }), item("skill", 1, { name: "Go" })], { profile: { onboarded: false, current: {} } });
    const html = render(provisional);
    expect(html).toContain("Your details");
    expect(html).toContain('id="import-onboarding-name"');
    expect(html).not.toContain('value="Pending onboarding"');
    expect(html).toContain("Enter your name to finish getting started.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Confirm import/);

    counter = 0;
    const named = snapshot([item("profile", 1, { display_name: "Rina Sari", selected_fields: [] })], { profile: { onboarded: false, current: {} } });
    expect(render(named)).toContain('value="Rina Sari"');
    counter = 0;
    expect(render(snapshot([item("skill", 1, { name: "Go" })]))).not.toContain("Your details");
  });

  it("renders committed results from the stored commit result, or no numbers for a legacy batch", () => {
    counter = 0;
    const counts = Object.fromEntries(["profile", "experience", "education", "certification", "skill", "achievement"].map((type) => [type, { created: 0, mapped: 0, skipped: 0 }]));
    counts.experience = { created: 2, mapped: 0, skipped: 0 };
    counts.skill = { created: 1, mapped: 1, skipped: 1 };
    const stored = { schema_version: "import-commit.v1" as const, counts: counts as never, confirmed_achievements: 1, profile_fields_applied: 0, onboarding_completed: true };
    const base = snapshot([]);
    const html = render({ ...base, batch: { ...base.batch, status: "committed", commit_result: stored } });
    expect(html).toContain("Import saved");
    expect(html).toContain("Experience: 2 created · 0 mapped · 0 skipped");
    expect(html).toContain("Skills: 1 created · 1 mapped · 1 skipped");
    expect(html).toContain("Confirmed achievements: 1");
    expect(html).toMatch(/class="button-primary" href="\/dashboard">Open dashboard/);
    const legacy = render({ ...base, batch: { ...base.batch, status: "committed" } });
    expect(legacy).toContain("Your selected records were added to your workspace.");
    expect(legacy).not.toContain("created");
  });

  it("handles empty, failed, cancelled and still-processing batches with the right actions", () => {
    const base = snapshot([]);
    const empty = render(base);
    expect(empty).toContain("Nothing to review");
    expect(empty).toMatch(/class="button-primary" href="\/settings\/profile">Start manually/);
    expect(empty).toContain("Cancel import");
    const failed = render({ ...base, batch: { ...base.batch, status: "failed", error_code: "ENCRYPTED_FILE" } });
    expect(failed).toContain("This file could not be imported");
    expect(failed).toContain("Try another file");
    expect(failed).toContain("Start manually");
    const cancelled = render({ ...base, batch: { ...base.batch, status: "cancelled" } });
    expect(cancelled).toContain("Import cancelled");
    const processing = render({ ...base, batch: { ...base.batch, status: "running" } });
    expect(processing).toContain("Your import is still being prepared");
    expect(processing).toContain('href="/onboarding/import"');
  });

  it("uses a person-friendly, gradient-free layout", () => {
    counter = 0;
    expect(render(snapshot([item("skill", 1, { name: "Go" })]))).not.toMatch(/gradient|sparkle/i);
  });
});

describe("T17 candidate persistence states", () => {
  const noop = vi.fn();
  const handlers: CandidateHandlers = {
    onChange: noop, onInvalid: noop, onSave: noop, onDiscard: noop, onAction: noop, onMap: noop, onConfirm: noop, onReload: noop, onProfileField: noop,
  };
  function candidateHtml(status: "idle" | "saving" | "saved" | "failed" | "conflict", draft?: Record<string, string | null>) {
    counter = 0;
    const row = item("experience", 1, experience);
    const view = toImportReviewView(snapshot([row]));
    const candidate = view.groups[0]!.candidates[0]!;
    return renderToStaticMarkup(
      <ImportReviewCandidate locale="en" candidate={candidate} payload={row.payload} draft={draft} status={status} invalidFields={[]} handlers={handlers} titleText="Analis · PT Sentinel" />,
    );
  }

  it("announces Saving…, Saved and Not saved as text", () => {
    expect(candidateHtml("saving")).toContain("Saving…");
    expect(candidateHtml("saved")).toContain("Saved");
    expect(candidateHtml("failed")).toContain("Not saved");
    expect(candidateHtml("idle")).not.toContain("Saving…");
  });

  it("marks unsaved edits, offers Save and Discard, and keeps the local value", () => {
    const html = candidateHtml("idle", { role_title: "Analis Senior" });
    expect(html).toContain("Unsaved edits");
    expect(html).toContain('value="Analis Senior"');
    expect(html).toContain("Save changes");
    expect(html).toContain("Discard edits");
  });

  it("shows the conflict state with local input, the server value and a Reload action", () => {
    const html = candidateHtml("conflict", { role_title: "Analis Senior" });
    expect(html).toContain("This candidate changed elsewhere");
    expect(html).toContain('value="Analis Senior"');
    expect(html).toContain("Saved on server: Analis");
    expect(html).toContain("Reload latest");
    expect(html).toContain("Changed elsewhere");
  });
});
