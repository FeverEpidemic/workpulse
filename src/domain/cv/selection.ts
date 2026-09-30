import { CV_SECTION_KEYS, type CvSourceSnapshot } from "./contracts.ts";

export type CvParent = { type: "project" | "experience"; id: string };

/**
 * The parent an achievement needs on the CV: its project, otherwise its experience, otherwise none.
 * A project never pulls in its experience, and no other source type has a parent.
 */
export function requiredParent(snapshot: CvSourceSnapshot): CvParent | null {
  if (snapshot.source_type !== "achievement") return null;
  if (snapshot.project_id) return { type: "project", id: snapshot.project_id };
  if (snapshot.experience_id) return { type: "experience", id: snapshot.experience_id };
  return null;
}

/** True when the order is a permutation of the six supported section keys. */
export function isValidSectionOrder(order: unknown): boolean {
  if (!Array.isArray(order) || order.length !== CV_SECTION_KEYS.length) return false;
  const supported = new Set<string>(CV_SECTION_KEYS);
  const seen = new Set<unknown>();
  for (const key of order) {
    if (typeof key !== "string" || !supported.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

/** True when the requested ids are exactly the current ids of the section, without duplicates. */
export function isValidReorder(currentIds: readonly string[], requestedIds: readonly string[]): boolean {
  if (currentIds.length !== requestedIds.length) return false;
  const requested = new Set(requestedIds);
  if (requested.size !== requestedIds.length) return false;
  return currentIds.every((id) => requested.has(id));
}
