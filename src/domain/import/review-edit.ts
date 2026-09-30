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

/** Concurrent saves can finish out of order: the commit token is the highest batch revision seen. */
export function nextBatchRevision(current: number, receiptRevision: number): number {
  return Math.max(current, receiptRevision);
}

export function withReceipt(
  snapshot: ImportReviewSnapshot,
  itemId: string,
  change: ItemChange,
  receipt: { itemRevision: number; batchRevision: number },
): ImportReviewSnapshot {
  return {
    ...snapshot,
    batch: { ...snapshot.batch, revision: nextBatchRevision(snapshot.batch.revision, receipt.batchRevision) },
    items: snapshot.items.map((item) => (item.id === itemId ? applyChange(item, change, receipt.itemRevision) : item)),
  };
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
