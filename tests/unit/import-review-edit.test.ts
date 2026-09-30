import { describe, expect, it } from "vitest";

import {
  applyChange,
  beginSave,
  changeFormData,
  clearSavedDraft,
  commitToken,
  draftPatch,
  isDirty,
  resetRevisionTracker,
  settleSave,
  startRevisionTracker,
  withReceipt,
} from "@/domain/import/review-edit";
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

  it("applies a receipt to the item only; the batch revision is not taken from a receipt", () => {
    const snapshot = { batch: { revision: 5 }, items: [item()] } as unknown as ImportReviewSnapshot;
    const next = withReceipt(snapshot, item().id, { confirm: true }, { itemRevision: 3, batchRevision: 8 });
    expect(next.batch.revision).toBe(5);
    expect(next.items[0]!.revision).toBe(3);
  });

  it("advances the commit token only by this tab's own saves", () => {
    let tracker = startRevisionTracker(5);
    const save = beginSave(tracker);
    tracker = save.tracker;
    const settled = settleSave(tracker, save.generation, 6);
    expect(settled.outOfSync).toBe(false);
    expect(commitToken(settled.tracker)).toBe(6);
  });

  it("reports a batch changed elsewhere instead of adopting the receipt revision (RV1)", () => {
    // Another tab saved once (5 -> 6) before this tab's save (6 -> 7).
    let tracker = startRevisionTracker(5);
    const save = beginSave(tracker);
    tracker = save.tracker;
    const settled = settleSave(tracker, save.generation, 7);
    expect(settled.outOfSync).toBe(true);
    expect(commitToken(settled.tracker)).toBe(6);
  });

  it("does not report a conflict when this tab's own saves finish out of order", () => {
    let tracker = startRevisionTracker(5);
    const a = beginSave(tracker);
    const b = beginSave(a.tracker);
    tracker = b.tracker;
    const first = settleSave(tracker, b.generation, 7);
    expect(first.outOfSync).toBe(false);
    const second = settleSave(first.tracker, a.generation, 6);
    expect(second.outOfSync).toBe(false);
    expect(commitToken(second.tracker)).toBe(7);
  });

  it("detects a foreign change once concurrent own saves settle, and failed saves do not count", () => {
    let tracker = startRevisionTracker(5);
    const a = beginSave(tracker);
    const b = beginSave(a.tracker);
    tracker = b.tracker;
    const failed = settleSave(tracker, a.generation, null);
    expect(failed.outOfSync).toBe(false);
    const done = settleSave(failed.tracker, b.generation, 7);
    expect(done.outOfSync).toBe(true);
    expect(commitToken(done.tracker)).toBe(6);
  });

  it("ignores saves started before a reload and restarts from the reloaded revision", () => {
    let tracker = startRevisionTracker(5);
    const old = beginSave(tracker);
    tracker = resetRevisionTracker(old.tracker, 9);
    const late = settleSave(tracker, old.generation, 10);
    expect(late.outOfSync).toBe(false);
    expect(commitToken(late.tracker)).toBe(9);
    expect(late.tracker.inFlight).toBe(0);
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
