import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import { cvReviewSummarySchema } from "@/domain/cv/contracts";
import {
  DASHBOARD_RECENT_LIMIT,
  DASHBOARD_SKILL_LIMIT,
  type DashboardData,
  type DashboardSummary,
} from "@/domain/dashboard/contracts";
import type { ActivityRow } from "@/domain/activity/contracts";
import type { ProjectRow } from "@/domain/database-types";
import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";

export type DashboardServiceErrorCode = "UNAUTHENTICATED" | "UNAVAILABLE";

const ERROR_KEYS: Record<DashboardServiceErrorCode, MessageKey> = {
  UNAUTHENTICATED: "auth.signInRequired",
  UNAVAILABLE: "error.unavailable",
};

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);
type DashboardClient = SupabaseClient<Database>;

const summaryRowSchema = z.object({
  confirmed_achievement_count: z.number().int().nonnegative(),
  active_project_count: z.number().int().nonnegative(),
  demonstrated_skill_count: z.number().int().nonnegative(),
  missing_evidence_count: z.number().int().nonnegative(),
  completed_missing_outcome_count: z.number().int().nonnegative(),
  has_career_records: z.boolean(),
}).strict();

const skillRowSchema = z.object({
  skill_id: z.uuid(),
  name: z.string().min(1),
  confirmed_achievement_count: z.number().int().positive(),
}).strict();

const recentActivitySchema = z.object({
  id: z.uuid(),
  raw_text: z.string(),
  occurred_on: z.iso.date(),
}).strict();

const activeProjectSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  updated_at: z.iso.datetime({ offset: true }),
}).strict();

export class DashboardServiceError extends Error {
  readonly code: DashboardServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;

  constructor(code: DashboardServiceErrorCode) {
    super("Dashboard service request could not be completed.");
    this.name = "DashboardServiceError";
    this.code = code;
    this.messageKey = ERROR_KEYS[code];
    this.correlationId = randomUUID();
  }
}

function isUnauthenticatedAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  return error.status === 401 || error.status === 403 || (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code));
}

async function withBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DashboardServiceError) throw error;
    throw new DashboardServiceError("UNAVAILABLE");
  }
}

function mapSummary(row: z.infer<typeof summaryRowSchema>): DashboardSummary {
  return {
    confirmedAchievementCount: row.confirmed_achievement_count,
    activeProjectCount: row.active_project_count,
    demonstratedSkillCount: row.demonstrated_skill_count,
    missingEvidenceCount: row.missing_evidence_count,
    completedMissingOutcomeCount: row.completed_missing_outcome_count,
    hasCareerRecords: row.has_career_records,
  };
}

export function createDashboardService(client: DashboardClient) {
  async function requireActorId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (data?.user) throw new DashboardServiceError("UNAVAILABLE");
      if (isUnauthenticatedAuthFailure(error)) throw new DashboardServiceError("UNAUTHENTICATED");
      throw new DashboardServiceError("UNAVAILABLE");
    }
    if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
    if (data?.user === null) throw new DashboardServiceError("UNAUTHENTICATED");
    throw new DashboardServiceError("UNAVAILABLE");
  }

  return {
    async getDashboard(): Promise<DashboardData> {
      return withBoundary(async () => {
        const actorId = await requireActorId();
        const [summaryResult, cvReviewResult, skillsResult, activityResult, projectResult] = await Promise.all([
          client.rpc("get_dashboard_summary"),
          client.rpc("get_cv_review_summary"),
          client.rpc("list_demonstrated_skills", { p_limit: DASHBOARD_SKILL_LIMIT }),
          client.from("activities")
            .select("id, raw_text, occurred_on")
            .eq("user_id", actorId)
            .order("occurred_on", { ascending: false })
            .order("id", { ascending: false })
            .limit(DASHBOARD_RECENT_LIMIT),
          client.from("projects")
            .select("id, title, updated_at")
            .eq("user_id", actorId)
            .eq("status", "active")
            .order("updated_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(DASHBOARD_RECENT_LIMIT),
        ]);

        if (summaryResult.error || cvReviewResult.error || skillsResult.error || activityResult.error || projectResult.error) {
          throw new DashboardServiceError("UNAVAILABLE");
        }

        const summaryRows = z.array(summaryRowSchema).safeParse(summaryResult.data);
        if (!summaryRows.success || summaryRows.data.length > 1) throw new DashboardServiceError("UNAVAILABLE");
        if (summaryRows.data.length === 0) throw new DashboardServiceError("UNAUTHENTICATED");
        const summaryRow = summaryRows.data[0];
        if (!summaryRow) throw new DashboardServiceError("UNAVAILABLE");
        const cvReviewRows = z.array(cvReviewSummarySchema).safeParse(cvReviewResult.data);
        if (!cvReviewRows.success || cvReviewRows.data.length > 1) throw new DashboardServiceError("UNAVAILABLE");
        const cvReviewRow = cvReviewRows.data[0];
        if (!cvReviewRow) throw new DashboardServiceError("UNAUTHENTICATED");
        const skills = z.array(skillRowSchema).safeParse(skillsResult.data);
        const activities = z.array(recentActivitySchema).safeParse(activityResult.data ?? []);
        const projects = z.array(activeProjectSchema).safeParse(projectResult.data ?? []);
        if (!skills.success || !activities.success || !projects.success) throw new DashboardServiceError("UNAVAILABLE");

        return {
          summary: mapSummary(summaryRow),
          cvReview: { hasCv: cvReviewRow.has_cv, reviewCount: cvReviewRow.review_count, availableCount: cvReviewRow.available_count },
          recentActivities: activities.data as Pick<ActivityRow, "id" | "raw_text" | "occurred_on">[],
          activeProjects: projects.data as Pick<ProjectRow, "id" | "title" | "updated_at">[],
          skills: skills.data.map((skill) => ({
            id: skill.skill_id,
            name: skill.name,
            confirmedAchievementCount: skill.confirmed_achievement_count,
          })),
        };
      });
    },
  };
}
