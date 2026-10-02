import type { CvFreshnessRow, CvFreshnessState, CvResolution, CvSectionKey } from "@/domain/cv/contracts";
import type { DraftProblem } from "@/domain/cv/draft";
import { needsReview, type FreshnessEntry, type ReviewChoice, type ReviewChoiceId } from "@/domain/cv/freshness";
import type { MessageKey } from "@/i18n/messages";
import type { ActionState } from "@/server/action-result";

/**
 * Pure state rules of the S13 editor, kept out of the component so they are unit tested without a DOM.
 * The component only wires them to React state and the server actions.
 */

export type SaveStatus = "saved" | "unsaved" | "saving" | "conflict";

export interface SaveStateInput {
  saving: boolean;
  busy: boolean;
  dirty: boolean;
  /** A save was rejected as stale and the reloaded CV is on screen. */
  conflict: boolean;
  unresolved: readonly string[];
  problems: Readonly<Record<string, DraftProblem>>;
}

export interface SaveState {
  status: SaveStatus;
  canSave: boolean;
  showConflict: boolean;
}

/** Save stays off while nothing changed, a field is invalid, a conflict is unresolved, or a request runs. */
export function deriveSaveState(input: SaveStateInput): SaveState {
  const unresolved = input.unresolved.length > 0;
  const status: SaveStatus = input.saving ? "saving" : unresolved ? "conflict" : input.dirty ? "unsaved" : "saved";
  const canSave = input.dirty && Object.keys(input.problems).length === 0 && !unresolved && !input.saving && !input.busy;
  // The panel stays while a rejected save still needs the user, and disappears once they edit again.
  return { status, canSave, showConflict: unresolved || (input.conflict && input.dirty) };
}

/** True for the stale-revision answer that reloads the CV instead of showing an error. */
export function isStaleConflict(state: ActionState): boolean {
  return state.status === "error" && state.error.code === "CONFLICT" && state.error.messageKey === "error.conflict";
}

/** The element id of the input that edits a draft field. */
export function fieldElementId(key: string): string {
  if (key === "title") return "cv-title";
  if (key === "summary") return "cv-summary";
  if (key.startsWith("profile.")) return `cv-${key.slice("profile.".length)}`;
  return `cv-wording-input-${key.slice("item.".length)}`;
}

/** The first invalid field to focus on Save, and the item whose wording editor must open for it. */
export function firstInvalidField(problems: Readonly<Record<string, DraftProblem>>): { elementId: string; openItemId: string | null } | null {
  const key = Object.keys(problems)[0];
  if (!key) return null;
  return { elementId: fieldElementId(key), openItemId: key.startsWith("item.") ? key.slice("item.".length) : null };
}

/** 1-based position announced after a move one step up or down within a group of the given size. */
export function announcedPosition(index: number, direction: "up" | "down"): number {
  return index + (direction === "up" ? 0 : 2);
}

/** A section's "Available to add" list opens on first load when the section is empty or holds the suggestion. */
export function initialPoolOpen(
  sections: readonly CvSectionKey[],
  selectedCount: (key: CvSectionKey) => number,
  hasSuggestion: (key: CvSectionKey) => boolean,
): Record<CvSectionKey, boolean> {
  return Object.fromEntries(sections.map((key) => [key, selectedCount(key) === 0 || hasSuggestion(key)])) as Record<CvSectionKey, boolean>;
}

interface PlacedEntry {
  headline: string;
  children: readonly { row: { source_snapshot: { source_type: string; source_id: string } } }[];
}

/**
 * Selected achievements that render under a project or experience entry, keyed by achievement id, with the
 * parent's headline. The Achievements pool says where such an "Added" record is instead of looking missing.
 */
export function achievementPlacements(sections: Readonly<Record<CvSectionKey, readonly PlacedEntry[]>>): Record<string, string> {
  const placements: Record<string, string> = {};
  for (const key of ["experience", "projects"] as const) {
    for (const entry of sections[key]) {
      for (const child of entry.children) {
        const snapshot = child.row.source_snapshot;
        if (snapshot.source_type === "achievement") placements[snapshot.source_id] = entry.headline;
      }
    }
  }
  return placements;
}

/** Correlation id for a failure that never reached the server, so the error state always carries one. */
export function clientCorrelationId(): string {
  return crypto.randomUUID();
}

/** True for the answer that reloads the CV because a record changed again while it was being reviewed. */
export function isSourceChangedConflict(state: ActionState): boolean {
  return state.status === "error" && state.error.code === "CONFLICT" && state.error.messageKey === "cv.error.sourceChanged";
}

/** A text badge for every state that needs attention or was acknowledged; fresh shows nothing. Never colour alone. */
export function stateBadge(state: CvFreshnessState): { messageKey: MessageKey; variant: "warning" | "neutral" } | null {
  switch (state) {
    case "changed": return { messageKey: "cv.badge.sourceChanged", variant: "warning" };
    case "kept": return { messageKey: "cv.badge.keptWording", variant: "neutral" };
    case "deleted": return { messageKey: "cv.badge.sourceDeleted", variant: "warning" };
    case "unconfirmed": return { messageKey: "cv.badge.sourceUnconfirmed", variant: "warning" };
    default: return null;
  }
}

export interface ReviewTarget {
  kind: "item" | "profile";
  itemId: string | null;
  state: CvFreshnessState;
}

/** What the summary lists: a changed profile first (it sits at the top of the page), then items that need review. */
export function reviewTargets(rows: readonly CvFreshnessRow[]): ReviewTarget[] {
  const targets: ReviewTarget[] = [];
  const profile = rows.find((row) => row.target === "profile");
  if (profile && profile.state === "changed") targets.push({ kind: "profile", itemId: null, state: profile.state });
  for (const row of rows) {
    if (row.target === "item" && needsReview(row.state)) targets.push({ kind: "item", itemId: row.item_id, state: row.state });
  }
  return targets;
}

export function reviewSummaryKey(count: number): MessageKey {
  return count === 1 ? "cv.review.summaryOne" : "cv.review.summaryOther";
}

/**
 * Review actions stay off while the wording of the same target holds unsaved text (decision 0026, point 11),
 * so a resolution never reloads over something the user is still typing.
 */
export function isReviewBlocked(target: { kind: "item" | "profile"; itemId: string | null }, dirtyKeys: readonly string[]): boolean {
  if (target.kind === "item") return dirtyKeys.includes(`item.${target.itemId}`);
  return dirtyKeys.some((key) => key === "summary" || key.startsWith("profile."));
}

/** One resolution for the live revision the user is looking at; null when the live revision is not known. */
export function singleResolution(
  target: { kind: "item" | "profile"; itemId: string | null },
  entry: Pick<FreshnessEntry, "liveRevision">,
  choice: ReviewChoice,
): CvResolution | null {
  if (entry.liveRevision === null) return null;
  if (target.kind === "profile") return { target: "profile", source_revision: entry.liveRevision, action: choice.action };
  if (target.itemId === null) return null;
  return { target: "item", item_id: target.itemId, source_revision: entry.liveRevision, action: choice.action };
}

export function choiceKeys(id: ReviewChoiceId): { label: MessageKey; aria: MessageKey; announce: MessageKey } {
  switch (id) {
    case "refresh": return { label: "cv.action.refreshFromSource", aria: "cv.aria.refreshFromSource", announce: "cv.announce.refreshed" };
    case "keep_saved": return { label: "cv.action.keepSaved", aria: "cv.aria.keepSaved", announce: "cv.announce.keptSaved" };
    case "keep_mine": return { label: "cv.action.keepMine", aria: "cv.aria.keepMine", announce: "cv.announce.keptMine" };
    case "replace": return { label: "cv.action.replaceFromSource", aria: "cv.aria.replaceFromSource", announce: "cv.announce.replaced" };
  }
}

/** Element ids to try, in order, once the reloaded CV is on screen after a resolution. */
export function reviewFocusCandidates(target: { kind: "item" | "profile"; itemId: string | null }, sectionKey: CvSectionKey | null): string[] {
  if (target.kind === "profile") return ["cv-review-open-profile", "cv-review-heading", "cv-profile-heading"];
  return [`cv-review-open-${target.itemId}`, "cv-review-heading", `cv-section-heading-${sectionKey}`];
}

/** After a bulk refresh the summary may be gone; focus then falls back to the first panel of the page. */
export const BULK_FOCUS_CANDIDATES = ["cv-review-heading", "cv-settings-heading"] as const;
