import { describe, expect, it } from "vitest";

import { isValidSectionOrder } from "@/domain/cv/selection";
import {
  changedKeys, computeItemMove, computeSectionMove, draftFromSaved, droppedEdits, isDirty, itemKey, profileKey, reconcileDraft, resolveConflict, syncDraft, toSaveInput, validateDraft,
} from "@/domain/cv/draft";

import { ORDER, achievementSnapshot, documentRow, graduateItems, itemRow, uuid } from "./cv-fixtures";

describe("T19 CV draft", () => {
  const saved = () => draftFromSaved(documentRow(), graduateItems());

  it("starts equal to the saved CV and only override-capable items get a field", () => {
    const draft = saved();
    expect(draft.title).toBe("Master CV");
    expect(draft[itemKey(uuid(1))]).toBe("");
    expect(itemKey(uuid(5)) in draft).toBe(false);
    expect(isDirty(draft, { ...draft })).toBe(false);
  });

  it("diffs by trimmed value and builds a minimal save input", () => {
    const base = saved();
    const draft = { ...base, title: " CV Ani ", summary: "Ringkasan", [profileKey("headline")]: "Analyst", [itemKey(uuid(3))]: "Custom", [itemKey(uuid(1))]: "  " };
    expect(changedKeys(base, draft)).toEqual(["item.00000000-0000-4000-8000-000000000003", "profile.headline", "summary", "title"]);
    expect(toSaveInput(base, draft, 4)).toEqual({
      expected_revision: 4, title: "CV Ani", summary_override: "Ringkasan",
      profile_overrides: { headline: "Analyst" }, item_overrides: [{ item_id: uuid(3), override_text: "Custom" }],
    });
    expect(toSaveInput(base, { ...base }, 4)).toBeNull();
  });

  it("sends null to clear an existing override", () => {
    const document = documentRow({ summary_override: "Old" });
    const base = draftFromSaved(document, graduateItems());
    expect(toSaveInput(base, { ...base, summary: "" }, 2)).toEqual({ expected_revision: 2, summary_override: null });
  });

  it("reports field problems without echoing values", () => {
    const draft = { ...saved(), title: " ", [profileKey("website")]: "ftp://x", [profileKey("contact_email")]: "nope", summary: "s".repeat(5001) };
    expect(validateDraft(draft)).toEqual({ title: "required", "profile.website": "invalid", "profile.contact_email": "invalid", summary: "too_long" });
    expect(validateDraft(saved())).toEqual({});
  });

  it("reconciles unchanged, mine and conflicting fields", () => {
    const base = { ...saved(), title: "A", summary: "A", [itemKey(uuid(1))]: "A", [itemKey(uuid(2))]: "A" };
    const draft = { ...base, title: "mine", summary: "mine", [itemKey(uuid(1))]: "mine" };
    const server = { ...base, title: "theirs", summary: "A", [itemKey(uuid(2))]: "theirs" };
    const result = reconcileDraft({ base, draft, server });
    expect(result.fields.title).toBe("conflict");
    expect(result.fields.summary).toBe("mine");
    expect(result.fields[itemKey(uuid(1))]).toBe("mine");
    expect(result.fields[itemKey(uuid(2))]).toBe("unchanged");
    expect(result.merged.title).toBe("mine");
    expect(result.merged[itemKey(uuid(2))]).toBe("theirs");
  });

  it("treats identical edits and removed server fields correctly", () => {
    const base = { ...saved(), summary: "A" };
    const draft = { ...base, summary: "same", [itemKey(uuid(9))]: "orphan" };
    const server = { ...base, summary: "same" };
    const result = reconcileDraft({ base, draft, server });
    expect(result.fields.summary).toBe("unchanged");
    expect(itemKey(uuid(9)) in result.merged).toBe(false);
  });

  describe("moves", () => {
    it("swaps neighbours in a section and stops at the edges", () => {
      const items = [
        itemRow(uuid(10), "skills", 1, graduateItems()[4]!.source_snapshot),
        itemRow(uuid(11), "skills", 2, graduateItems()[4]!.source_snapshot),
        itemRow(uuid(12), "skills", 3, graduateItems()[4]!.source_snapshot),
      ];
      expect(computeItemMove(items, uuid(11), "up", ORDER)).toEqual({ sectionKey: "skills", itemIds: [uuid(11), uuid(10), uuid(12)] });
      expect(computeItemMove(items, uuid(11), "down", ORDER)?.itemIds).toEqual([uuid(10), uuid(12), uuid(11)]);
      expect(computeItemMove(items, uuid(10), "up", ORDER)).toBeNull();
      expect(computeItemMove(items, uuid(12), "down", ORDER)).toBeNull();
      expect(computeItemMove(items, uuid(99), "down", ORDER)).toBeNull();
    });

    it("moves a child achievement only among the siblings of its parent", () => {
      const project = uuid(101);
      const items = [
        itemRow(uuid(2), "projects", 1, graduateItems()[1]!.source_snapshot),
        itemRow(uuid(20), "achievements", 1, achievementSnapshot(uuid(501))),
        itemRow(uuid(21), "achievements", 2, achievementSnapshot(uuid(502), { project_id: project })),
        itemRow(uuid(22), "achievements", 3, achievementSnapshot(uuid(503))),
        itemRow(uuid(23), "achievements", 4, achievementSnapshot(uuid(504), { project_id: project })),
      ];
      expect(computeItemMove(items, uuid(23), "up", ORDER)?.itemIds).toEqual([uuid(20), uuid(23), uuid(22), uuid(21)]);
      expect(computeItemMove(items, uuid(21), "up", ORDER)).toBeNull();
      expect(computeItemMove(items, uuid(22), "up", ORDER)?.itemIds).toEqual([uuid(22), uuid(21), uuid(20), uuid(23)]);
      expect(computeItemMove(items, uuid(22), "down", ORDER)).toBeNull();
    });

    it("moves sections while keeping a valid permutation", () => {
      const down = computeSectionMove(ORDER, "experience", "down");
      expect(down?.slice(0, 2)).toEqual(["projects", "experience"]);
      expect(isValidSectionOrder(down)).toBe(true);
      expect(computeSectionMove(ORDER, "experience", "up")).toBeNull();
      expect(computeSectionMove(ORDER, "certifications", "down")).toBeNull();
    });
  });
});

describe("T19 CV draft sync", () => {
  it("adopts saved values for untouched fields and keeps the user's edits", () => {
    const base = { ...draftFromSaved(documentRow(), graduateItems()) };
    const draft = { ...base, summary: "mine" };
    const saved = { ...base, title: "Saved title", [itemKey(uuid(1))]: "theirs" };
    const sync = syncDraft({ base, draft, unresolved: [], saved });
    expect(sync.draft.title).toBe("Saved title");
    expect(sync.draft.summary).toBe("mine");
    expect(sync.draft[itemKey(uuid(1))]).toBe("theirs");
    expect(sync.unresolved).toEqual([]);
    expect(sync.base).toEqual(saved);
  });

  it("keeps conflicting text, marks it unresolved, and carries the mark across further syncs", () => {
    const base = draftFromSaved(documentRow(), graduateItems());
    const draft = { ...base, title: "mine" };
    const saved = { ...base, title: "theirs" };
    const first = syncDraft({ base, draft, unresolved: [], saved });
    expect(first.draft.title).toBe("mine");
    expect(first.unresolved).toEqual(["title"]);
    const second = syncDraft({ ...first, saved });
    expect(second.unresolved).toEqual(["title"]);
    expect(isDirty(second.base, second.draft)).toBe(true);
  });

  it("resolves a conflict either way", () => {
    const base = draftFromSaved(documentRow(), graduateItems());
    const saved = { ...base, title: "theirs" };
    const sync = syncDraft({ base, draft: { ...base, title: "mine" }, unresolved: [], saved });
    const kept = resolveConflict(sync, "title", "mine", saved);
    expect(kept).toMatchObject({ draft: { title: "mine" }, unresolved: [] });
    const used = resolveConflict(sync, "title", "saved", saved);
    expect(used).toMatchObject({ draft: { title: "theirs" }, unresolved: [] });
    expect(isDirty(used.base, used.draft)).toBe(false);
  });

  it("clears the mark once the draft equals the saved value", () => {
    const base = draftFromSaved(documentRow(), graduateItems());
    const saved = { ...base, title: "same" };
    const next = syncDraft({ base, draft: { ...base, title: "same" }, unresolved: ["title"], saved });
    expect(next.unresolved).toEqual([]);
  });

  it("reports edited wording of items that disappeared from the saved CV instead of dropping it silently", () => {
    const base = draftFromSaved(documentRow(), graduateItems());
    const draft = { ...base, [itemKey(uuid(3))]: "Typed text", [itemKey(uuid(4))]: "Also typed" };
    // Items 3 (edited) and 1 (untouched) were removed elsewhere; only the edited one is reported.
    const saved = { ...base };
    delete saved[itemKey(uuid(3))];
    delete saved[itemKey(uuid(1))];
    expect(droppedEdits({ base, draft, saved })).toEqual([itemKey(uuid(3))]);
    expect(droppedEdits({ base, draft: base, saved })).toEqual([]);
    expect(itemKey(uuid(3)) in syncDraft({ base, draft, unresolved: [], saved }).draft).toBe(false);
  });
});
