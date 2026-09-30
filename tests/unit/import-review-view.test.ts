import { describe, expect, it } from "vitest";

import {
  canConfirmAchievement,
  duplicateKey,
  normalizeDuplicateText,
  toImportReviewView,
  type ImportReviewSnapshot,
  type ReviewItemRow,
} from "@/domain/import/review-view";

const BATCH_ID = "8f14e45f-ea5e-4a0b-9c2b-000000000001";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let counter = 0;
function item(entity_type: ReviewItemRow["entity_type"], ordinal: number, payload: Record<string, unknown> | null, extra: Partial<ReviewItemRow> = {}): ReviewItemRow {
  counter += 1;
  return {
    id: uuid(counter), entity_type, ordinal, action: "create", target_id: null, confirm_requested: false,
    payload, source_excerpt: `excerpt ${entity_type} ${ordinal}`, revision: 1, ...extra,
  };
}

function snapshot(items: ReviewItemRow[], extra: Partial<ImportReviewSnapshot> = {}): ImportReviewSnapshot {
  return {
    batch: { id: BATCH_ID, filename: "cv.pdf", status: "review", stage: "done", error_code: null, revision: 5, commit_result: null },
    items,
    targets: { experience: [], education: [], certification: [], skill: [], achievement: [] },
    errors: [],
    profile: { onboarded: true, current: {} },
    ...extra,
  };
}

const experiencePayload = { organization: "PT Sentinel", role_title: "Analis", kind: "employment", start_date: "2019-01-01", start_precision: "year", end_date: null, end_precision: null, is_current: true };
const achievementPayload = { title: "Cut report time", contribution: null, outcome: null, cv_bullet: null, achieved_on: null, metrics: [] };

describe("T17 import review view model", () => {
  it("groups candidates in fixed order, omits empty groups and orders by ordinal", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([
      item("skill", 2, { name: "Python" }),
      item("achievement", 1, achievementPayload),
      item("experience", 2, { ...experiencePayload, organization: "B" }),
      item("experience", 1, { ...experiencePayload, organization: "A" }),
      item("skill", 1, { name: "SQL" }),
    ]));
    expect(view.state).toBe("review");
    expect(view.groups.map((group) => group.type)).toEqual(["experience", "skill", "achievement"]);
    expect(view.groups[0]!.candidates.map((candidate) => candidate.ordinal)).toEqual([1, 2]);
    expect(view.groups[1]!.candidates.map((candidate) => candidate.ordinal)).toEqual([1, 2]);
  });

  it("marks required fields per type and reports the missing ones without inventing values", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([
      item("experience", 1, { ...experiencePayload, role_title: null }),
      item("education", 1, { institution: "Universitas Contoh", qualification: "  " }),
      item("certification", 1, { name: null, issuer: null }),
      item("skill", 1, { name: "" }),
    ]));
    const field = (type: string, name: string) => view.groups.find((group) => group.type === type)!.candidates[0]!.fields.find((f) => f.name === name)!;
    expect(field("experience", "role_title")).toMatchObject({ required: true, missing: true, value: null });
    expect(field("experience", "organization")).toMatchObject({ required: true, missing: false });
    expect(field("education", "qualification")).toMatchObject({ required: true, missing: true });
    expect(field("certification", "name")).toMatchObject({ required: true, missing: true });
    expect(field("skill", "name")).toMatchObject({ required: true, missing: true });
    expect(field("experience", "description")).toMatchObject({ required: false, missing: false });
  });

  it("maps validation errors to fields, ignores unknown items and never blocks on skipped candidates", () => {
    counter = 0;
    const blocked = item("experience", 1, { ...experiencePayload, role_title: null });
    const skipped = item("experience", 2, { ...experiencePayload, role_title: null }, { action: "skip" });
    const view = toImportReviewView(snapshot([blocked, skipped], {
      errors: [
        { item_id: blocked.id, field: "role_title", code: "REQUIRED" },
        { item_id: skipped.id, field: "role_title", code: "REQUIRED" },
        { item_id: uuid(9999), field: "role_title", code: "REQUIRED" },
      ],
    }));
    const [first, second] = view.groups[0]!.candidates;
    expect(first!.fields.find((f) => f.name === "role_title")!.errors).toEqual(["REQUIRED"]);
    expect(first!.errors).toEqual([{ field: "role_title", code: "REQUIRED" }]);
    expect(second!.errors).toEqual([]);
    expect(view.errorSummary).toEqual([{ itemId: blocked.id, type: "experience", ordinal: 1, field: "role_title", code: "REQUIRED" }]);
    expect(view.commitBlockers).toEqual([{ kind: "validation", count: 1 }]);
    expect(view.canCommit).toBe(false);
    expect(view.groups[0]!.hasErrors).toBe(true);
  });

  it("covers achievement confirmation: all four fields must be saved and the reason lists what is missing", () => {
    expect(canConfirmAchievement({ title: "T", contribution: "C", outcome: "O", achieved_on: "2024-05-01" })).toEqual({ ok: true, missing: [] });
    expect(canConfirmAchievement({ title: " ", contribution: "C", outcome: "", achieved_on: null })).toEqual({ ok: false, missing: ["title", "outcome", "achieved_on"] });
    expect(canConfirmAchievement({})).toEqual({ ok: false, missing: ["title", "contribution", "outcome", "achieved_on"] });
    counter = 0;
    const view = toImportReviewView(snapshot([
      item("achievement", 1, achievementPayload),
      item("achievement", 2, { ...achievementPayload, contribution: "Built", outcome: "Faster", achieved_on: "2024-05-01" }, { confirm_requested: true }),
      item("achievement", 3, achievementPayload, { action: "skip" }),
    ]));
    const [draft, ready, skipped] = view.groups[0]!.candidates;
    expect(draft!.confirm).toEqual({ applicable: true, canConfirm: false, missing: ["contribution", "outcome", "achieved_on"], requested: false });
    expect(ready!.confirm).toEqual({ applicable: true, canConfirm: true, missing: [], requested: true });
    expect(skipped!.confirm.applicable).toBe(false);
    expect(view.summary.confirmedAchievements).toBe(1);
    expect(view.summary.draftAchievements).toBe(1);
  });

  it("marks confirm-only achievement fields as required only while confirmation is requested", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([
      item("achievement", 1, achievementPayload),
      item("achievement", 2, achievementPayload, { confirm_requested: true }),
    ]));
    const [draft, confirming] = view.groups[0]!.candidates;
    expect(draft!.fields.find((f) => f.name === "contribution")).toMatchObject({ required: false, missing: false });
    expect(confirming!.fields.find((f) => f.name === "contribution")).toMatchObject({ required: true, missing: true });
    expect(confirming!.fields.find((f) => f.name === "achieved_on")).toMatchObject({ required: true, missing: true });
  });

  it("detects duplicates: skill from validation, others by normalized key, never for map or skip", () => {
    counter = 0;
    const skill = item("skill", 1, { name: "SQL" });
    const experience = item("experience", 1, { ...experiencePayload, organization: "  PT   sentinel ", role_title: "ANALIS" });
    const mapped = item("experience", 2, experiencePayload, { action: "map", target_id: uuid(500) });
    const skippedDuplicate = item("education", 1, { institution: "UI", qualification: "S1" }, { action: "skip" });
    const education = item("education", 2, { institution: "ui", qualification: "s1" });
    const certification = item("certification", 1, { name: "AWS", issuer: null });
    const achievement = item("achievement", 1, { ...achievementPayload, title: "cut REPORT time" });
    const view = toImportReviewView(snapshot([skill, experience, mapped, skippedDuplicate, education, certification, achievement], {
      targets: {
        experience: [{ id: uuid(500), label: "Analis · PT Sentinel", match: duplicateKey("experience", experiencePayload) }],
        education: [{ id: uuid(501), label: "S1 · UI", match: duplicateKey("education", { institution: "UI", qualification: "S1" }) }],
        certification: [{ id: uuid(502), label: "AWS", match: duplicateKey("certification", { name: "aws", issuer: "" }) }],
        skill: [{ id: uuid(503), label: "SQL", match: null }],
        achievement: [{ id: uuid(504), label: "Cut report time", match: duplicateKey("achievement", { title: "Cut report time" }) }],
      },
      errors: [{ item_id: skill.id, field: "name", code: "DUPLICATE", existing_id: uuid(503) }],
    }));
    const byId = new Map(view.groups.flatMap((group) => group.candidates).map((candidate) => [candidate.id, candidate]));
    expect(byId.get(skill.id)!.duplicate).toEqual({ source: "validation", targetId: uuid(503), label: "SQL", blocking: true });
    expect(byId.get(experience.id)!.duplicate).toEqual({ source: "heuristic", targetId: uuid(500), label: "Analis · PT Sentinel", blocking: false });
    expect(byId.get(education.id)!.duplicate).toMatchObject({ targetId: uuid(501), blocking: false });
    expect(byId.get(certification.id)!.duplicate).toMatchObject({ targetId: uuid(502) });
    expect(byId.get(achievement.id)!.duplicate).toMatchObject({ targetId: uuid(504) });
    expect(byId.get(mapped.id)!.duplicate).toBeNull();
    expect(byId.get(skippedDuplicate.id)!.duplicate).toBeNull();
    // A same-batch skill duplicate has no existing id: still reported as an error, offering no map target.
    expect(normalizeDuplicateText("  A   b ")).toBe("a b");
    expect(duplicateKey("experience", { organization: "x", role_title: null })).toBeNull();
  });

  it("exposes map options only for non-profile types and keeps profile out of Map", () => {
    counter = 0;
    const view = toImportReviewView(snapshot(
      [item("profile", 1, { headline: "Analyst", selected_fields: ["headline"] }), item("skill", 1, { name: "Go" })],
      { targets: { experience: [], education: [], certification: [], achievement: [], skill: [{ id: uuid(600), label: "SQL", match: null }] } },
    ));
    const profile = view.groups.find((group) => group.type === "profile")!.candidates[0]!;
    const skill = view.groups.find((group) => group.type === "skill")!.candidates[0]!;
    expect(profile.canMap).toBe(false);
    expect(profile.mapOptions).toEqual([]);
    expect(skill.canMap).toBe(true);
    expect(skill.mapOptions).toEqual([{ id: uuid(600), label: "SQL" }]);
  });

  it("lists profile fields with selection state and the current value, never selecting the display name", () => {
    counter = 0;
    const view = toImportReviewView(snapshot(
      [item("profile", 1, { display_name: "Rina Sari", headline: "Data Lead", summary: null, selected_fields: ["headline"] })],
      { profile: { onboarded: true, current: { headline: "Old headline", summary: null } } },
    ));
    const profile = view.groups[0]!.candidates[0]!;
    expect(profile.profileFields!.map((f) => f.name)).toEqual(["headline", "summary", "contact_email", "phone", "location", "website"]);
    expect(profile.profileFields![0]).toMatchObject({ name: "headline", selected: true, value: "Data Lead", current: "Old headline" });
    expect(profile.profileFields![1]).toMatchObject({ name: "summary", selected: false, value: null });
    expect(profile.profileFields!.some((f) => (f.name as string) === "display_name")).toBe(false);
  });

  it("summarizes choices per type", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([
      item("experience", 1, experiencePayload),
      item("experience", 2, experiencePayload, { action: "map", target_id: uuid(1) }),
      item("experience", 3, experiencePayload, { action: "skip" }),
      item("skill", 1, { name: "A" }),
      item("skill", 2, { name: "B" }, { action: "skip" }),
    ]));
    expect(view.summary.byType.experience).toEqual({ create: 1, map: 1, skip: 1 });
    expect(view.summary.byType.skill).toEqual({ create: 1, map: 0, skip: 1 });
    expect(view.summary.byType.education).toEqual({ create: 0, map: 0, skip: 0 });
    expect(view.summary.total).toBe(5);
  });

  it("blocks the final button for unsaved edits, saves in flight and invalid onboarding", () => {
    counter = 0;
    const a = item("skill", 1, { name: "A" });
    const clean = toImportReviewView(snapshot([a]));
    expect(clean.canCommit).toBe(true);
    expect(clean.commitBlockers).toEqual([]);
    expect(clean.onboarding.required).toBe(false);

    const busy = toImportReviewView(snapshot([a]), { unsavedItemIds: [a.id], savingItemIds: [a.id] });
    expect(busy.commitBlockers).toEqual([{ kind: "unsaved", count: 1 }, { kind: "saving", count: 1 }]);
    expect(busy.canCommit).toBe(false);

    const provisional = snapshot([a], { profile: { onboarded: false, current: {} } });
    const bad = toImportReviewView(provisional, { onboarding: { display_name: "Pending onboarding", locale: "id", timezone: "" } });
    expect(bad.onboarding).toEqual({ required: true, errors: { display_name: "REQUIRED", timezone: "REQUIRED" } });
    expect(bad.commitBlockers).toEqual([{ kind: "onboarding", count: 2 }]);
    expect(toImportReviewView(provisional, { onboarding: { display_name: "x".repeat(81), locale: "id", timezone: "Asia/Jakarta" } }).onboarding.errors)
      .toEqual({ display_name: "TOO_LONG" });
    const ok = toImportReviewView(provisional, { onboarding: { display_name: "Rina", locale: "id", timezone: "Asia/Jakarta" } });
    expect(ok.canCommit).toBe(true);
  });

  it("warns, without blocking, when every candidate is skipped", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([item("skill", 1, { name: "A" }, { action: "skip" })]));
    expect(view.warnings).toEqual(["nothing_selected"]);
    expect(view.canCommit).toBe(true);
  });

  it("derives every batch state from saved server state", () => {
    counter = 0;
    const one = item("skill", 1, { name: "A" });
    const batch = (status: string, extra: Record<string, unknown> = {}) =>
      snapshot([one], { batch: { ...snapshot([]).batch, status: status as never, ...extra } });
    expect(toImportReviewView(snapshot([])).state).toBe("review_empty");
    expect(toImportReviewView(batch("queued")).state).toBe("processing");
    expect(toImportReviewView(batch("running")).state).toBe("processing");
    expect(toImportReviewView(batch("failed", { error_code: "AI_UNAVAILABLE" })).state).toBe("failed");
    expect(toImportReviewView(batch("cancelled")).state).toBe("cancelled");
    const stored = {
      schema_version: "import-commit.v1" as const,
      counts: { profile: { created: 0, mapped: 0, skipped: 0 }, experience: { created: 2, mapped: 0, skipped: 0 }, education: { created: 0, mapped: 0, skipped: 0 }, certification: { created: 0, mapped: 0, skipped: 0 }, skill: { created: 1, mapped: 1, skipped: 1 }, achievement: { created: 1, mapped: 0, skipped: 0 } },
      confirmed_achievements: 1, profile_fields_applied: 0, onboarding_completed: true,
    };
    const committed = toImportReviewView(batch("committed", { commit_result: stored }));
    expect(committed.state).toBe("committed");
    expect(committed.result).toEqual(stored);
    expect(committed.groups).toEqual([]);
    expect(toImportReviewView(batch("committed")).result).toBeNull();
  });

  it("adds no text beyond the payload and excerpt of the batch", () => {
    counter = 0;
    const view = toImportReviewView(snapshot([item("skill", 1, { name: "SQL", secret_extra: "LEAK" })]));
    expect(JSON.stringify(view)).not.toContain("LEAK");
  });
});

