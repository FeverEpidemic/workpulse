import { CV_SECTION_KEYS, type CvSectionKey, type CvSourceType } from "@/domain/cv/contracts";

import type { CvSelectionPool } from "./cv-service";

/** One record the user may add to the CV, reduced to what the list shows. */
export interface PoolOption {
  sourceType: CvSourceType;
  sourceId: string;
  label: string;
  detail: string | null;
  selected: boolean;
}

export type PoolBySection = Record<CvSectionKey, PoolOption[]>;

const join = (...parts: (string | null | undefined)[]) => parts.map((part) => part?.trim()).filter(Boolean).join(" · ");

/** Flattens the selection pool for the client; only display text crosses to the browser. */
export function toPoolOptions(pool: CvSelectionPool): PoolBySection {
  return {
    experience: pool.experience.map(({ row, selected }) => ({
      sourceType: "experience", sourceId: row.id, label: join(row.role_title, row.organization), detail: null, selected,
    })),
    projects: pool.projects.map(({ row, selected }) => ({
      sourceType: "project", sourceId: row.id, label: row.title, detail: null, selected,
    })),
    achievements: pool.achievements.map(({ row, selected }) => ({
      sourceType: "achievement", sourceId: row.id, label: row.title ?? "", detail: row.cv_bullet ?? null, selected,
    })),
    education: pool.education.map(({ row, selected }) => ({
      sourceType: "education", sourceId: row.id, label: join(row.qualification, row.field_of_study, row.institution), detail: null, selected,
    })),
    skills: pool.skills.map(({ row, selected }) => ({
      sourceType: "skill", sourceId: row.id, label: row.name, detail: null, selected,
    })),
    certifications: pool.certifications.map(({ row, selected }) => ({
      sourceType: "certification", sourceId: row.id, label: join(row.name, row.issuer), detail: null, selected,
    })),
  };
}

export const EMPTY_POOL: PoolBySection = Object.fromEntries(CV_SECTION_KEYS.map((key) => [key, []])) as unknown as PoolBySection;

/** A highlight from the URL counts only when it names an unselected record in the caller's own pool. */
export function resolveHighlight(pool: PoolBySection, value: string | null | undefined): string | null {
  if (!value) return null;
  const match = pool.achievements.find((option) => option.sourceId === value);
  return match && !match.selected ? match.sourceId : null;
}
