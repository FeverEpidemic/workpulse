import type { CvSectionKey } from "@/domain/cv/contracts";
import type { DraftProblem } from "@/domain/cv/draft";
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
