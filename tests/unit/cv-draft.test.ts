import { describe, expect, it } from "vitest";

import { isValidSectionOrder } from "@/domain/cv/selection";
import {
  changedKeys, computeItemMove, computeSectionMove, draftFromSaved, isDirty, itemKey, profileKey, reconcileDraft, toSaveInput, validateDraft,
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
