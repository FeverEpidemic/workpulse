import {
  CV_OVERRIDE_TEXT_MAX,
  CV_PROFILE_OVERRIDE_KEYS,
  CV_PROFILE_OVERRIDE_MAX,
  CV_SUMMARY_MAX,
  CV_TITLE_MAX,
  isValidProfileOverride,
  type CvProfileOverrideKey,
  type CvSectionKey,
  type SaveCvEditsInput,
} from "./contracts.ts";
import { buildCvOutline, type OutlineItemInput } from "./outline.ts";
import { supportsOverride, type ResolvableDocument } from "./resolve.ts";

/**
 * Local text draft of the CV editor. A flat map keyed by "title", "summary", "profile.<key>" and
 * "item.<id>"; an empty string means "no override" (the source value applies).
 */
export type CvDraft = Record<string, string>;

export const TITLE_KEY = "title";
export const SUMMARY_KEY = "summary";
export const profileKey = (key: CvProfileOverrideKey) => `profile.${key}`;
export const itemKey = (id: string) => `item.${id}`;

export interface DraftSourceDocument extends ResolvableDocument {
  title: string;
}
export interface DraftSourceItem {
  id: string;
  override_text: string | null;
  source_snapshot: OutlineItemInput["source_snapshot"];
}

/** The draft that equals the saved CV: what the editor shows before the user types anything. */
export function draftFromSaved(document: DraftSourceDocument, items: readonly DraftSourceItem[]): CvDraft {
  const draft: CvDraft = { [TITLE_KEY]: document.title, [SUMMARY_KEY]: document.summary_override ?? "" };
  const overrides = document.profile_snapshot.display_overrides ?? {};
  for (const key of CV_PROFILE_OVERRIDE_KEYS) draft[profileKey(key)] = overrides[key] ?? "";
  for (const item of items) {
    if (supportsOverride(item.source_snapshot)) draft[itemKey(item.id)] = item.override_text ?? "";
  }
  return draft;
}

const normalized = (value: string | undefined) => (value ?? "").trim();

/** Keys whose trimmed value differs between base and draft. */
export function changedKeys(base: CvDraft, draft: CvDraft): string[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(draft)]);
  return [...keys].filter((key) => normalized(base[key]) !== normalized(draft[key])).sort();
}

export function isDirty(base: CvDraft, draft: CvDraft): boolean {
  return changedKeys(base, draft).length > 0;
}

/** Field-level problems the user can fix before saving; values are never echoed. */
export type DraftProblem = "required" | "too_long" | "invalid";

export function validateDraft(draft: CvDraft): Record<string, DraftProblem> {
  const problems: Record<string, DraftProblem> = {};
  const title = normalized(draft[TITLE_KEY]);
  if (title === "") problems[TITLE_KEY] = "required";
  else if (title.length > CV_TITLE_MAX) problems[TITLE_KEY] = "too_long";
  if (normalized(draft[SUMMARY_KEY]).length > CV_SUMMARY_MAX) problems[SUMMARY_KEY] = "too_long";
  for (const key of CV_PROFILE_OVERRIDE_KEYS) {
    const value = normalized(draft[profileKey(key)]);
    if (value === "") continue;
    if (value.length > CV_PROFILE_OVERRIDE_MAX[key]) problems[profileKey(key)] = "too_long";
    else if (!isValidProfileOverride(key, value)) problems[profileKey(key)] = "invalid";
  }
  for (const [key, value] of Object.entries(draft)) {
    if (key.startsWith("item.") && normalized(value).length > CV_OVERRIDE_TEXT_MAX) problems[key] = "too_long";
  }
  return problems;
}

/** Only the changed fields, in the shape save_cv_edits expects; null when nothing changed. */
export function toSaveInput(base: CvDraft, draft: CvDraft, expectedRevision: number): SaveCvEditsInput | null {
  const keys = changedKeys(base, draft);
  if (keys.length === 0) return null;
  const input: SaveCvEditsInput = { expected_revision: expectedRevision };
  const profile: Partial<Record<CvProfileOverrideKey, string | null>> = {};
  const items: { item_id: string; override_text: string | null }[] = [];
  for (const key of keys) {
    const value = normalized(draft[key]);
    if (key === TITLE_KEY) input.title = value;
    else if (key === SUMMARY_KEY) input.summary_override = value === "" ? null : value;
    else if (key.startsWith("profile.")) profile[key.slice("profile.".length) as CvProfileOverrideKey] = value === "" ? null : value;
    else if (key.startsWith("item.")) items.push({ item_id: key.slice("item.".length), override_text: value === "" ? null : value });
  }
  if (Object.keys(profile).length > 0) input.profile_overrides = profile;
  if (items.length > 0) input.item_overrides = items;
  return input;
}

export type FieldState = "unchanged" | "mine" | "conflict";

export interface ReconcileResult {
  fields: Record<string, FieldState>;
  /** Server values where the user changed nothing, the user's value elsewhere (conflicts keep the user's until resolved). */
  merged: CvDraft;
}

/**
 * Compares the draft the user started from (base), what they typed (draft) and what the server holds now.
 * unchanged: nothing of the user's to keep (the server value applies); mine: only the user changed it;
 * conflict: both changed it differently and the user must choose. Fields removed on the server are dropped.
 */
export function reconcileDraft(input: { base: CvDraft; draft: CvDraft; server: CvDraft }): ReconcileResult {
  const { base, draft, server } = input;
  const fields: Record<string, FieldState> = {};
  const merged: CvDraft = {};
  for (const key of Object.keys(server)) {
    const serverValue = normalized(server[key]);
    const mine = key in draft ? normalized(draft[key]) : serverValue;
    const original = key in base ? normalized(base[key]) : serverValue;
    if (mine === serverValue || mine === original) {
      fields[key] = "unchanged";
      merged[key] = server[key] ?? "";
    } else if (serverValue === original) {
      fields[key] = "mine";
      merged[key] = draft[key] ?? "";
    } else {
      fields[key] = "conflict";
      merged[key] = draft[key] ?? "";
    }
  }
  return { fields, merged };
}

function swap<T>(list: T[], a: number, b: number): void {
  const first = list[a];
  const second = list[b];
  if (first === undefined || second === undefined) return;
  list[a] = second;
  list[b] = first;
}

export interface DraftSync {
  base: CvDraft;
  draft: CvDraft;
  /** Fields where the user and the saved CV both changed; Save stays off until each one is resolved. */
  unresolved: string[];
}

/**
 * Applies a newly loaded saved CV to the local draft without losing what the user typed. Untouched fields
 * take the saved value, edited fields keep the draft, and fields changed on both sides become unresolved.
 */
export function syncDraft(input: { base: CvDraft; draft: CvDraft; unresolved: readonly string[]; saved: CvDraft }): DraftSync {
  const { fields, merged } = reconcileDraft({ base: input.base, draft: input.draft, server: input.saved });
  const fresh = Object.entries(fields).filter(([, state]) => state === "conflict").map(([key]) => key);
  const carried = input.unresolved.filter((key) => key in input.saved && normalized(merged[key]) !== normalized(input.saved[key]));
  return { base: { ...input.saved }, draft: merged, unresolved: [...new Set([...fresh, ...carried])].sort() };
}

/**
 * Fields the user had edited that no longer exist in the saved CV (an item removed elsewhere). syncDraft drops
 * them because there is nothing left to save them to; the editor tells the user instead of losing them silently.
 */
export function droppedEdits(input: { base: CvDraft; draft: CvDraft; saved: CvDraft }): string[] {
  return Object.keys(input.draft)
    .filter((key) => !(key in input.saved) && normalized(input.draft[key]) !== normalized(input.base[key]))
    .sort();
}

/** Resolves one conflicting field: keep the local text or take the saved text. */
export function resolveConflict(sync: DraftSync, key: string, choice: "mine" | "saved", saved: CvDraft): DraftSync {
  return {
    base: sync.base,
    draft: choice === "saved" ? { ...sync.draft, [key]: saved[key] ?? "" } : sync.draft,
    unresolved: sync.unresolved.filter((entry) => entry !== key),
  };
}

export type MoveDirection = "up" | "down";

export interface MoveItemInput extends OutlineItemInput {
  id: string;
}

/**
 * New id order of an item's section after moving it one step among its siblings, or null at the edge.
 * Siblings are the items that render side by side: a child achievement moves only among the achievements
 * of the same parent, a standalone achievement among the standalone ones, other items within their section.
 */
export function computeItemMove(
  items: readonly MoveItemInput[],
  itemId: string,
  direction: MoveDirection,
  sectionOrder: readonly CvSectionKey[],
): { sectionKey: CvSectionKey; itemIds: string[] } | null {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const sectionIds = items
    .filter((candidate) => candidate.section_key === item.section_key)
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
    .map((candidate) => candidate.id);

  let siblings = sectionIds;
  if (item.section_key === "achievements") {
    const outline = buildCvOutline({ sectionOrder, items });
    const parentOf = outline.sections.flatMap((section) => section.entries).find((entry) => entry.children.some((child) => child.id === itemId));
    if (parentOf) siblings = parentOf.children.map((child) => child.id);
    else siblings = outline.sections.find((section) => section.key === "achievements")?.entries.map((entry) => entry.item.id) ?? sectionIds;
  }

  const at = siblings.indexOf(itemId);
  const neighbour = siblings[direction === "up" ? at - 1 : at + 1];
  if (at < 0 || neighbour === undefined) return null;
  const next = [...sectionIds];
  const from = next.indexOf(itemId);
  const to = next.indexOf(neighbour);
  swap(next, from, to);
  return { sectionKey: item.section_key, itemIds: next };
}

/** New section order after moving one section a step, or null at the edge. */
export function computeSectionMove(order: readonly CvSectionKey[], key: CvSectionKey, direction: MoveDirection): CvSectionKey[] | null {
  const at = order.indexOf(key);
  const target = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || target < 0 || target >= order.length) return null;
  const next = [...order];
  swap(next, at, target);
  return next;
}
