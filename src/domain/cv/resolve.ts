import { CV_PROFILE_OVERRIDE_KEYS, type CvProfileOverrideKey, type CvProfileSnapshot, type CvSourceSnapshot } from "./contracts.ts";

export interface ResolvableItem {
  override_text: string | null;
  source_snapshot: CvSourceSnapshot;
}

export interface ResolvableDocument {
  summary_override: string | null;
  profile_snapshot: CvProfileSnapshot;
}

/** Source types whose wording can be replaced by a CV-only override; skill and certification are labels. */
export function supportsOverride(snapshot: CvSourceSnapshot): boolean {
  return snapshot.source_type !== "skill" && snapshot.source_type !== "certification";
}

/** The wording of the source as copied when the item was selected (never the override). */
export function sourceItemText(snapshot: CvSourceSnapshot): string | null {
  switch (snapshot.source_type) {
    case "achievement": return snapshot.cv_bullet;
    case "experience":
    case "project":
    case "education": return snapshot.description;
    default: return null;
  }
}

export function hasOverride(item: Pick<ResolvableItem, "override_text">): boolean {
  return item.override_text !== null;
}

/** The wording shown on the CV: the override when present, otherwise the source wording. */
export function resolveItemText(item: ResolvableItem): string | null {
  return item.override_text ?? sourceItemText(item.source_snapshot);
}

/** Copied profile values with the user's display overrides on top; empty values become null. */
export function resolveProfile(document: Pick<ResolvableDocument, "profile_snapshot">): Record<CvProfileOverrideKey, string | null> {
  const snapshot = document.profile_snapshot;
  const overrides = snapshot.display_overrides ?? {};
  const resolved = {} as Record<CvProfileOverrideKey, string | null>;
  for (const key of CV_PROFILE_OVERRIDE_KEYS) {
    resolved[key] = overrides[key] ?? snapshot[key] ?? null;
  }
  return resolved;
}

export function resolveSummary(document: ResolvableDocument): string | null {
  return document.summary_override ?? document.profile_snapshot.summary ?? null;
}
