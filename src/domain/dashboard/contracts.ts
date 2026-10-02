import type { ActivityRow } from "@/domain/activity/contracts";
import type { ProjectRow } from "@/domain/database-types";

export const DASHBOARD_RECENT_LIMIT = 5;
export const DASHBOARD_SKILL_LIMIT = 12;

export interface DashboardSummary {
  confirmedAchievementCount: number;
  activeProjectCount: number;
  demonstratedSkillCount: number;
  missingEvidenceCount: number;
  completedMissingOutcomeCount: number;
  hasCareerRecords: boolean;
}

export interface DashboardSkill {
  id: string;
  name: string;
  confirmedAchievementCount: number;
}

/** Two separate CV checks (PRD R03): items that need review, and confirmed achievements not on the CV. */
export interface DashboardCvReview {
  hasCv: boolean;
  reviewCount: number;
  availableCount: number;
}

export interface DashboardData {
  summary: DashboardSummary;
  cvReview: DashboardCvReview;
  recentActivities: Pick<ActivityRow, "id" | "raw_text" | "occurred_on">[];
  activeProjects: Pick<ProjectRow, "id" | "title" | "updated_at">[];
  skills: DashboardSkill[];
}
