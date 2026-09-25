import type { ActivityRow } from "@/domain/activity/contracts";
import type { AchievementListItem } from "@/domain/achievement/contracts";
import type { ExperienceRow, ProjectRow } from "@/domain/database-types";

export const PROJECT_FIELD_LIMITS = {
  title: 200,
  description: 5_000,
  userRole: 200,
  outcome: 5_000,
} as const;

export const PROJECT_LIST_PAGE_SIZE = 30;
export const PROJECT_RELINK_PAGE_SIZE = 30;

export const PROJECT_STATUSES = ["planned", "active", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type ProjectExperienceSummary = Pick<ExperienceRow, "id" | "organization" | "role_title">;

export type ProjectActivitySummary = Pick<
  ActivityRow,
  | "id"
  | "occurred_on"
  | "capture_mode"
  | "role"
  | "scope"
  | "outcome"
  | "experience_id"
  | "project_id"
  | "revision"
  | "raw_text"
>;

export interface ProjectListItem {
  project: ProjectRow;
  experience: ProjectExperienceSummary | null;
  linkedActivityCount: number;
}

export interface ProjectDetail {
  project: ProjectRow;
  experience: ProjectExperienceSummary | null;
  activities: ProjectActivitySummary[];
  achievements: AchievementListItem[];
  dependencyCount: number;
}

export interface ProjectRelinkCandidate extends ProjectActivitySummary {
  currentProjectTitle: string | null;
}

export interface ProjectRelinkCandidatePage {
  items: ProjectRelinkCandidate[];
  nextCursor: string | null;
}

export interface ProjectCreateReceipt {
  projectId: string;
  userId: string;
  revision: 1;
}

export interface ProjectDeleteReceipt {
  deletedProjectId: string;
  releasedActivityCount: number;
  releasedAchievementCount: number;
}
