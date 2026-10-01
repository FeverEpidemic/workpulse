import type { CvSectionKey, CvSourceSnapshot } from "./contracts.ts";

export interface OutlineItemInput {
  id: string;
  section_key: CvSectionKey;
  position: number;
  source_deleted: boolean;
  source_snapshot: CvSourceSnapshot;
}

export interface OutlineEntry<T extends OutlineItemInput = OutlineItemInput> {
  item: T;
  deleted: boolean;
  children: T[];
}

export interface OutlineSection<T extends OutlineItemInput = OutlineItemInput> {
  key: CvSectionKey;
  entries: OutlineEntry<T>[];
}

export interface CvOutline<T extends OutlineItemInput = OutlineItemInput> {
  sections: OutlineSection<T>[];
}

function byPosition(a: OutlineItemInput, b: OutlineItemInput): number {
  return a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Pure outline shared by preview (T19) and the export snapshot (T21). Sections follow sectionOrder; an
 * achievement is nested under its selected project, else its selected experience, else it stays in the
 * achievements section. Every achievement appears exactly once. Deleted items keep their place, flagged.
 */
export function buildCvOutline<T extends OutlineItemInput>(input: {
  sectionOrder: readonly CvSectionKey[];
  items: readonly T[];
}): CvOutline<T> {
  const sorted = [...input.items].sort(byPosition);
  const projectBySource = new Map<string, T>();
  const experienceBySource = new Map<string, T>();
  for (const item of sorted) {
    if (item.section_key === "projects") projectBySource.set(item.source_snapshot.source_id, item);
    else if (item.section_key === "experience") experienceBySource.set(item.source_snapshot.source_id, item);
  }

  const childrenByParent = new Map<string, T[]>();
  const standalone: T[] = [];
  for (const item of sorted) {
    if (item.section_key !== "achievements") continue;
    const snapshot = item.source_snapshot;
    const parent =
      snapshot.source_type === "achievement"
        ? (snapshot.project_id ? projectBySource.get(snapshot.project_id) : undefined) ??
          (snapshot.experience_id ? experienceBySource.get(snapshot.experience_id) : undefined)
        : undefined;
    if (!parent) {
      standalone.push(item);
      continue;
    }
    const siblings = childrenByParent.get(parent.id) ?? [];
    siblings.push(item);
    childrenByParent.set(parent.id, siblings);
  }

  const sections = input.sectionOrder.map((key): OutlineSection<T> => {
    const own = key === "achievements" ? standalone : sorted.filter((item) => item.section_key === key);
    return {
      key,
      entries: own.map((item) => ({
        item,
        deleted: item.source_deleted,
        children: key === "projects" || key === "experience" ? (childrenByParent.get(item.id) ?? []) : [],
      })),
    };
  });
  return { sections };
}
