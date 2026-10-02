import type {
  CvFreshnessRow,
  CvFreshnessState,
  CvLocale,
  CvProfileLive,
  CvProfileSnapshot,
  CvResolution,
  CvResolutionAction,
  CvSourceSnapshot,
} from "./contracts.ts";
import { buildCvPreviewEntry, type CvPreviewEntry } from "./preview.ts";

/**
 * Pure freshness rules of the master CV (T20). The state itself is computed in SQL
 * (internal.cv_item_state / cv_profile_state); this module only maps a state to the choices the user has and
 * to what changed on screen. It never decides whether a source is fresh.
 */

export type FreshnessTarget = "item" | "profile";

export interface FreshnessEntry {
  state: CvFreshnessState;
  liveRevision: number | null;
  liveSnapshot: CvSourceSnapshot | CvProfileLive | null;
}

export interface FreshnessIndex {
  items: Map<string, FreshnessEntry>;
  profile: FreshnessEntry | null;
}

export function indexFreshness(rows: readonly CvFreshnessRow[]): FreshnessIndex {
  const items = new Map<string, FreshnessEntry>();
  let profile: FreshnessEntry | null = null;
  for (const row of rows) {
    const entry: FreshnessEntry = { state: row.state, liveRevision: row.live_revision, liveSnapshot: row.live_snapshot };
    if (row.target === "profile") profile = entry;
    else items.set(row.item_id, entry);
  }
  return { items, profile };
}

/** Changed, deleted and unconfirmed need the user; kept is an explicit acknowledgement and fresh needs nothing. */
export function needsReview(state: CvFreshnessState): boolean {
  return state === "changed" || state === "deleted" || state === "unconfirmed";
}

/** Items that need review plus a changed profile; the same rule as get_cv_review_summary(). */
export function reviewCount(rows: readonly CvFreshnessRow[]): number {
  return rows.filter((row) => (row.target === "profile" ? row.state === "changed" : needsReview(row.state))).length;
}

/**
 * What a choice means for the user. keep_saved and keep_mine are different buttons over different actions:
 * Keep saved wording acknowledges the change (action keep), Keep my wording refreshes the details of an
 * item whose wording was edited and leaves that wording alone (action refresh).
 */
export type ReviewChoiceId = "refresh" | "keep_saved" | "keep_mine" | "replace";

export interface ReviewChoice {
  id: ReviewChoiceId;
  action: CvResolutionAction;
  primary: boolean;
}

export function availableActions(input: { state: CvFreshnessState; hasOverride: boolean; target: FreshnessTarget }): ReviewChoice[] {
  if (input.state === "changed") {
    return input.hasOverride
      ? [
          { id: "keep_mine", action: "refresh", primary: true },
          { id: "replace", action: "replace", primary: false },
        ]
      : [
          { id: "refresh", action: "refresh", primary: true },
          { id: "keep_saved", action: "keep", primary: false },
        ];
  }
  if (input.state === "kept") return [{ id: "refresh", action: "refresh", primary: false }];
  return [];
}

export function primaryAction(input: { state: CvFreshnessState; hasOverride: boolean; target: FreshnessTarget }): ReviewChoice | null {
  return availableActions(input).find((choice) => choice.primary) ?? null;
}

/** One batch refresh for every changed item without manual wording; the profile is never part of it. */
export function bulkRefreshResolutions(
  rows: readonly CvFreshnessRow[],
  items: readonly { id: string; override_text: string | null }[],
): CvResolution[] {
  const withWording = new Set(items.filter((item) => item.override_text !== null).map((item) => item.id));
  const known = new Set(items.map((item) => item.id));
  const resolutions: CvResolution[] = [];
  for (const row of rows) {
    if (row.target !== "item" || row.state !== "changed") continue;
    if (!known.has(row.item_id) || withWording.has(row.item_id) || row.live_revision === null) continue;
    resolutions.push({ target: "item", item_id: row.item_id, source_revision: row.live_revision, action: "refresh" });
  }
  return resolutions.slice(0, 200);
}

export type DisplayField = "headline" | "subline" | "dates" | "text";

export interface DisplayDiffEntry {
  field: DisplayField;
  saved: string | null;
  live: string | null;
}

export interface ItemDiff {
  fields: DisplayDiffEntry[];
  /** True when only a parent link moved (achievement project/experience, project experience); nothing visible differs. */
  contextChanged: boolean;
}

const DISPLAY_FIELDS: readonly DisplayField[] = ["headline", "subline", "dates", "text"];

function displayEntry(snapshot: CvSourceSnapshot, locale: CvLocale): CvPreviewEntry {
  return buildCvPreviewEntry(
    { id: "", section_key: "achievements", position: 1, source_deleted: false, source_snapshot: snapshot, override_text: null },
    locale,
    false,
  );
}

/** The displayed fields that differ between the saved snapshot and the live one. Dates use the CV locale; content is never translated. */
export function diffDisplayFields(saved: CvSourceSnapshot, live: CvSourceSnapshot, locale: CvLocale): ItemDiff {
  const before = displayEntry(saved, locale);
  const after = displayEntry(live, locale);
  const fields: DisplayDiffEntry[] = [];
  for (const field of DISPLAY_FIELDS) {
    if (before[field] !== after[field]) fields.push({ field, saved: before[field], live: after[field] });
  }
  const parentLinks = (snapshot: CvSourceSnapshot) =>
    snapshot.source_type === "achievement" ? [snapshot.experience_id, snapshot.project_id]
    : snapshot.source_type === "project" ? [snapshot.experience_id]
    : [];
  const contextChanged = JSON.stringify(parentLinks(saved)) !== JSON.stringify(parentLinks(live));
  return { fields, contextChanged };
}

export const PROFILE_DIFF_FIELDS = ["display_name", "headline", "summary", "contact_email", "phone", "location", "website"] as const;
export type ProfileDiffField = (typeof PROFILE_DIFF_FIELDS)[number];

export interface ProfileDiffEntry {
  field: ProfileDiffField;
  saved: string | null;
  live: string | null;
}

/** The seven profile fields that differ; display overrides and the schema marker are not part of the comparison. */
export function diffProfileFields(saved: CvProfileSnapshot, live: CvProfileLive): ProfileDiffEntry[] {
  const entries: ProfileDiffEntry[] = [];
  for (const field of PROFILE_DIFF_FIELDS) {
    const before = saved[field] ?? null;
    const after = live[field] ?? null;
    if (before !== after) entries.push({ field, saved: before, live: after });
  }
  return entries;
}
