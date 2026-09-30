import { describe, expect, it } from "vitest";

import { applyChange, changeFormData, clearSavedDraft, draftPatch, isDirty, nextBatchRevision, withReceipt } from "@/domain/import/review-edit";
import type { ImportReviewSnapshot, ReviewItemRow } from "@/domain/import/review-view";

const item = (extra: Partial<ReviewItemRow> = {}): ReviewItemRow => ({
  id: "00000000-0000-4000-8000-000000000001", entity_type: "achievement", ordinal: 1, action: "create", target_id: null, confirm_requested: false,
  payload: { title: "T", contribution: null, is_current: false }, source_excerpt: "x", revision: 2, ...extra,
});

describe("T17 review edit helpers", () => {
  it("reports only changed keys and treats blank text as null", () => {
    const payload = { title: "T", contribution: null, is_current: false };
    expect(draftPatch(payload, { title: "T", contribution: "" })).toEqual({});
    expect(draftPatch(payload, { title: "Changed", contribution: "Built", is_current: true })).toEqual({ title: "Changed", contribution: "Built", is_current: true });
    expect(draftPatch(payload, { title: "" })).toEqual({ title: null });
    expect(isDirty(payload, { title: "Changed" })).toBe(true);
    expect(isDirty(payload, undefined)).toBe(false);
  });

  it("mirrors the server rules: target only with map, confirm only with create", () => {
    expect(applyChange(item({ confirm_requested: true }), { action: "skip" }, 3)).toMatchObject({ action: "skip", target_id: null, confirm_requested: false, revision: 3 });
    expect(applyChange(item(), { action: "map", targetId: "t" }, 3)).toMatchObject({ action: "map", target_id: "t", confirm_requested: false });
    expect(applyChange(item({ action: "map", target_id: "t" }), { action: "create" }, 3)).toMatchObject({ action: "create", target_id: null });
    expect(applyChange(item(), { confirm: true, patch: { contribution: "C" } }, 3)).toMatchObject({ confirm_requested: true, payload: { title: "T", contribution: "C" } });
  });

  it("keeps a draft the user typed after a save and drops the saved keys", () => {
    expect(clearSavedDraft({ title: "A", contribution: "typed later" }, { title: "A", contribution: "old" })).toEqual({ contribution: "typed later" });
    expect(clearSavedDraft({ title: "" }, { title: null })).toEqual({});
  });

  it("uses the highest batch revision seen as the commit token, whatever order saves finish", () => {
    expect(nextBatchRevision(5, 7)).toBe(7);
    expect(nextBatchRevision(7, 6)).toBe(7);
    const snapshot = { batch: { revision: 5 }, items: [item()] } as unknown as ImportReviewSnapshot;
    const first = withReceipt(snapshot, item().id, { confirm: true }, { itemRevision: 3, batchRevision: 8 });
    const late = withReceipt(first, item().id, { confirm: false }, { itemRevision: 4, batchRevision: 7 });
    expect(late.batch.revision).toBe(8);
    expect(late.items[0]!.revision).toBe(4);
  });

  it("sends only what changed to the update action", () => {
    const form = changeFormData("i", 4, { action: "map", targetId: "t", confirm: false, patch: { title: "X" } });
    expect([...form.keys()].sort()).toEqual(["action", "confirm_requested", "expected_revision", "item_id", "payload_patch", "target_id"]);
    expect(form.get("expected_revision")).toBe("4");
    expect(form.get("confirm_requested")).toBe("false");
    expect(JSON.parse(String(form.get("payload_patch")))).toEqual({ title: "X" });
    expect([...changeFormData("i", 1, {}).keys()].sort()).toEqual(["expected_revision", "item_id"]);
  });
});
