// Shared by the web app and tests; keep imports relative (no "@/" alias).
import type { ImportItemAction } from "./commit-contracts.ts";
import type { ImportReviewSnapshot, ReviewItemRow } from "./review-view.ts";

export type FieldValue = string | boolean | null;
/** Unsaved edits of one candidate, keyed by payload key (a date edit sets both the date and its precision). */
export type FieldDraft = Record<string, FieldValue>;

/** One review choice as sent to update_import_item; omitted members are left unchanged by the server. */
export type ItemChange = {
  action?: ImportItemAction;
  targetId?: string | null;
  confirm?: boolean;
  patch?: Record<string, FieldValue | unknown[]>;
};

function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/** Only the keys whose edited value differs from the saved payload. */
export function draftPatch(payload: Record<string, unknown> | null, draft: FieldDraft | undefined): FieldDraft {
  const patch: FieldDraft = {};
  for (const [key, raw] of Object.entries(draft ?? {})) {
    const value = raw === "" ? null : raw;
    const saved = payload?.[key];
    const savedValue = key === "is_current" ? saved === true : saved;
    if (!sameValue(savedValue, value)) patch[key] = value;
  }
  return patch;
}

export function isDirty(payload: Record<string, unknown> | null, draft: FieldDraft | undefined): boolean {
  return Object.keys(draftPatch(payload, draft)).length > 0;
}

/**
 * The saved row after a successful update, mirroring update_import_item: a target only lives with the
 * `map` action and a confirm request only with `create`. The revision comes from the server receipt.
 */
export function applyChange(item: ReviewItemRow, change: ItemChange, itemRevision: number): ReviewItemRow {
  const action = change.action ?? item.action;
  return {
    ...item,
    action,
    target_id: action === "map" ? (change.targetId ?? item.target_id) : null,
    confirm_requested: action === "create" ? (change.confirm ?? item.confirm_requested) : false,
    payload: change.patch ? { ...(item.payload ?? {}), ...change.patch } : item.payload,
    revision: itemRevision,
  };
}

/** Drop the draft keys a save has just persisted; keep everything the user typed since. */
export function clearSavedDraft(draft: FieldDraft | undefined, saved: Record<string, unknown> | undefined): FieldDraft {
  const rest: FieldDraft = {};
  for (const [key, raw] of Object.entries(draft ?? {})) {
    const value = raw === "" ? null : raw;
    if (!saved || !Object.hasOwn(saved, key) || !sameValue(saved[key], value)) rest[key] = raw;
  }
  return rest;
}

/**
 * The saved item after a successful update. The batch revision is deliberately left alone: a receipt's
 * batch revision may include changes made in another tab, so the commit token comes from the tracker below.
 */
export function withReceipt(
  snapshot: ImportReviewSnapshot,
  itemId: string,
  change: ItemChange,
  receipt: { itemRevision: number; batchRevision: number },
): ImportReviewSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => (item.id === itemId ? applyChange(item, change, receipt.itemRevision) : item)),
  };
}

/**
 * Commit token bookkeeping. Every update_import_item raises the batch revision by exactly one, so the
 * token is the revision this tab last loaded plus its own successful saves. A receipt above that (once
 * this tab's saves have settled) means the batch changed elsewhere: the tab must reload before it may
 * commit, and the token is never raised to a revision whose choices this tab has not shown.
 */
export type RevisionTracker = { generation: number; base: number; ownSaves: number; inFlight: number; highest: number };

export function startRevisionTracker(base: number): RevisionTracker {
  return { generation: 0, base, ownSaves: 0, inFlight: 0, highest: base };
}

/** After a reload: saves started before it no longer count. */
export function resetRevisionTracker(tracker: RevisionTracker, base: number): RevisionTracker {
  return { generation: tracker.generation + 1, base, ownSaves: 0, inFlight: 0, highest: base };
}

export function beginSave(tracker: RevisionTracker): { tracker: RevisionTracker; generation: number } {
  return { tracker: { ...tracker, inFlight: tracker.inFlight + 1 }, generation: tracker.generation };
}

/** `receiptRevision` is the batch revision of a successful save, or null for a failed one. */
export function settleSave(
  tracker: RevisionTracker,
  generation: number,
  receiptRevision: number | null,
): { tracker: RevisionTracker; outOfSync: boolean } {
  if (generation !== tracker.generation) return { tracker, outOfSync: false };
  const next: RevisionTracker = {
    ...tracker,
    inFlight: Math.max(0, tracker.inFlight - 1),
    ownSaves: tracker.ownSaves + (receiptRevision === null ? 0 : 1),
    highest: receiptRevision === null ? tracker.highest : Math.max(tracker.highest, receiptRevision),
  };
  return { tracker: next, outOfSync: next.inFlight === 0 && next.highest > commitToken(next) };
}

export function commitToken(tracker: RevisionTracker): number {
  return tracker.base + tracker.ownSaves;
}

export type ItemSaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";

/** Form-data for the update action: only the members that change something. */
export function changeFormData(itemId: string, expectedRevision: number, change: ItemChange): FormData {
  const form = new FormData();
  form.set("item_id", itemId);
  form.set("expected_revision", String(expectedRevision));
  if (change.action !== undefined) form.set("action", change.action);
  if (change.targetId) form.set("target_id", change.targetId);
  if (change.confirm !== undefined) form.set("confirm_requested", String(change.confirm));
  if (change.patch && Object.keys(change.patch).length > 0) form.set("payload_patch", JSON.stringify(change.patch));
  return form;
}
