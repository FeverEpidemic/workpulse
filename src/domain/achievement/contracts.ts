import type { Database } from "@/server/supabase/database.types";

export const ACHIEVEMENT_FIELD_LIMITS = {
  title: 200,
  contribution: 5_000,
  scope: 5_000,
  outcome: 5_000,
  cvBullet: 2_000,
  sourceExcerpt: 10_000,
  metricLabel: 100,
  metricUnit: 50,
  metricPeriod: 100,
  metrics: 20,
  skills: 20,
} as const;

export const ACHIEVEMENT_LIST_PAGE_SIZE = 30;

export const ACHIEVEMENT_STATUSES = ["draft", "confirmed", "dismissed"] as const;
export type AchievementStatus = (typeof ACHIEVEMENT_STATUSES)[number];

export const ACHIEVEMENT_ORIGINS = ["manual", "activity", "import"] as const;
export type AchievementOrigin = (typeof ACHIEVEMENT_ORIGINS)[number];

export type AchievementDatabaseRow = Database["public"]["Tables"]["achievements"]["Row"];
export type AchievementSkillDatabaseRow = Database["public"]["Tables"]["achievement_skills"]["Row"];

export type AchievementRow = Omit<AchievementDatabaseRow, "status" | "origin" | "metrics"> & {
  status: AchievementStatus;
  origin: AchievementOrigin;
  metrics: AchievementMetric[];
};

export type AchievementMetric = {
  label: string;
  value: number;
  unit: string;
  baseline?: number;
  period?: string;
};

export type AchievementSkill = Pick<Database["public"]["Tables"]["skills"]["Row"], "id" | "name"> & {
  demonstratedCount: number;
};

export interface AchievementListItem {
  achievement: AchievementRow;
  projectTitle: string | null;
  experienceLabel: string | null;
  skills: AchievementSkill[];
}

export interface AchievementListPage {
  items: AchievementListItem[];
  nextCursor: string | null;
}

export interface AchievementRelinkCandidate extends AchievementListItem {
  currentProjectTitle: string | null;
}

export interface AchievementRelinkCandidatePage {
  items: AchievementRelinkCandidate[];
  nextCursor: string | null;
}

export interface AchievementRelinkCandidate extends AchievementListItem {
  currentProjectTitle: string | null;
}

export interface AchievementRelinkCandidatePage {
  items: AchievementRelinkCandidate[];
  nextCursor: string | null;
}

export interface AchievementDetail {
  achievement: AchievementRow;
  activity: {
    id: string;
    raw_text: string;
    revision: number;
    occurred_on: string;
    role: string | null;
    scope: string | null;
    outcome: string | null;
  } | null;
  projectTitle: string | null;
  experienceLabel: string | null;
  skills: AchievementSkill[];
}

export type AchievementProjectOption = { id: string; title: string; experience_id: string | null };
export type AchievementExperienceOption = { id: string; organization: string; role_title: string };

export interface AchievementContextOptions {
  projects: AchievementProjectOption[];
  experiences: AchievementExperienceOption[];
}

export interface AchievementCreateReceipt {
  achievementId: string;
  userId: string;
  revision: 1;
}

export interface AchievementDeleteReceipt {
  deletedAchievementId: string;
  retainedActivity: boolean;
}
