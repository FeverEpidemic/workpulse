import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import type { ActivityRow } from "@/domain/activity/contracts";
import type { AchievementListItem, AchievementRow } from "@/domain/achievement/contracts";
import { decodeActivityCursor, encodeActivityCursor, type ActivityCursor } from "@/domain/activity/activity-cursor";
import { decodeProjectCursor, encodeProjectCursor, type ProjectCursor } from "@/domain/project/project-cursor";
import {
  PROJECT_LIST_PAGE_SIZE,
  PROJECT_RELINK_PAGE_SIZE,
  type ProjectActivitySummary,
  type ProjectCreateReceipt,
  type ProjectDeleteReceipt,
  type ProjectDetail,
  type ProjectExperienceSummary,
  type ProjectListItem,
  type ProjectRelinkCandidate,
  type ProjectRelinkCandidatePage,
} from "@/domain/project/contracts";
import type { ProjectRow } from "@/domain/database-types";
import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";
import {
  deleteProjectSchema,
  projectCreateSchema,
  projectListFilterSchema,
  projectUpdateSchema,
  relinkActivitySchema,
  type DeleteProjectInput,
  type ProjectCreateInput,
  type ProjectListFilters,
  type ProjectUpdateInput,
  type RelinkActivityInput,
} from "@/features/project/schemas";

export type ProjectServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAVAILABLE";

const PROJECT_ERROR_MESSAGE_KEYS: Record<ProjectServiceErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  UNAUTHENTICATED: "auth.signInRequired",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  IDEMPOTENCY_KEY_REUSED: "error.operationKeyReused",
  UNAVAILABLE: "error.unavailable",
};

const INVALID_SESSION_AUTH_CODES = new Set([
  "bad_jwt",
  "invalid_jwt",
  "no_authorization",
  "session_expired",
  "session_not_found",
]);

interface DatabaseErrorShape {
  code?: string;
  message?: string;
}

type ProjectClient = SupabaseClient<Database>;
type CreateProjectRpcArgs = Database["public"]["Functions"]["create_project_idempotent"]["Args"];
type NullableCreateProjectRpcArgs = Omit<
  CreateProjectRpcArgs,
  "p_description" | "p_user_role" | "p_outcome" | "p_start_date" | "p_start_precision" | "p_end_date" | "p_end_precision" | "p_experience_id"
> & {
  p_description: string | null;
  p_user_role: string | null;
  p_outcome: string | null;
  p_start_date: string | null;
  p_start_precision: string | null;
  p_end_date: string | null;
  p_end_precision: string | null;
  p_experience_id: string | null;
};

function withNullableCreateProjectArgs(args: NullableCreateProjectRpcArgs): CreateProjectRpcArgs {
  return args as CreateProjectRpcArgs;
}

type ProjectServiceErrorDetails = {
  fieldErrors?: Partial<Record<string, MessageKey>>;
  latestRecord?: ProjectRow | ActivityRow;
};

export class ProjectServiceError extends Error {
  readonly code: ProjectServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;
  readonly fieldErrors?: Partial<Record<string, MessageKey>>;
  readonly latestRecord?: ProjectRow | ActivityRow;

  constructor(code: ProjectServiceErrorCode, details: ProjectServiceErrorDetails = {}) {
    super("Project service request could not be completed.");
    this.name = "ProjectServiceError";
    this.code = code;
    this.messageKey = PROJECT_ERROR_MESSAGE_KEYS[code];
    this.correlationId = randomUUID();
    this.fieldErrors = details.fieldErrors;
    this.latestRecord = details.latestRecord;
  }
}

export interface ProjectListPage {
  items: ProjectListItem[];
  nextCursor: string | null;
}

function fieldMessage(path: string[], issueMessage: string): MessageKey {
  if (issueMessage === "required") return "validation.required";
  if (issueMessage === "range") return "validation.dateRange";
  if (issueMessage === "partial_date" || issueMessage === "current_end") return "validation.partialDate";
  if (path[0] === "title" || path[0] === "description" || path[0] === "userRole" || path[0] === "outcome") return "error.validation";
  return "error.validation";
}

function formFieldName(field: string): string {
  const names: Record<string, string> = {
    operationKey: "operation_key",
    expectedRevision: "expected_revision",
    projectId: "project_id",
    experienceId: "experience_id",
    userRole: "user_role",
    startDate: "start_date",
    endDate: "end_date",
    isCurrent: "is_current",
  };
  return names[field] ?? field;
}

function validationError(error: z.ZodError): ProjectServiceError {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    const field = formFieldName(path[0] ?? "form");
    fieldErrors[field] = fieldMessage(path, issue.message);
  }
  return new ProjectServiceError("VALIDATION", { fieldErrors });
}

function isUnauthenticatedAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  return error.status === 401 || error.status === 403 ||
    (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code));
}

async function withProjectErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ProjectServiceError) throw error;
    throw new ProjectServiceError("UNAVAILABLE");
  }
}

function mapDatabaseError(error: DatabaseErrorShape): ProjectServiceError {
  if (error.message === "AUTH_REQUIRED" || error.code === "42501") return new ProjectServiceError("UNAUTHENTICATED");
  if (error.message === "IDEMPOTENCY_KEY_REUSED") return new ProjectServiceError("IDEMPOTENCY_KEY_REUSED");
  if (["PROJECT_UNAVAILABLE", "ACTIVITY_UNAVAILABLE"].includes(error.message ?? "")) return new ProjectServiceError("NOT_FOUND");
  if (["STALE_REVISION", "ACTIVITY_CONTEXT_CHANGED"].includes(error.message ?? "")) return new ProjectServiceError("CONFLICT");
  if (
    ["22023", "22008", "22P02", "23503", "23514"].includes(error.code ?? "") ||
    ["INVALID_PROJECT_INPUT", "INVALID_ACTIVITY_INPUT", "INVALID_OPERATION_KEY"].includes(error.message ?? "")
  ) return new ProjectServiceError("VALIDATION");
  return new ProjectServiceError("UNAVAILABLE");
}

export function normalizeProjectInput<T extends ProjectCreateInput | ProjectUpdateInput>(value: T): T {
  const isCurrent = value.status === "completed" ? false : value.isCurrent;
  if (!isCurrent && isCurrent === value.isCurrent) return value;
  return {
    ...value,
    isCurrent,
    endDate: isCurrent ? null : value.endDate,
    endPrecision: isCurrent ? null : value.endPrecision,
  } as T;
}

function projectChanges(value: ProjectCreateInput | ProjectUpdateInput): Database["public"]["Functions"]["update_project"]["Args"]["p_changes"] {
  return {
    experience_id: value.experienceId,
    title: value.title,
    description: value.description,
    user_role: value.userRole,
    outcome: value.outcome,
    status: value.status,
    start_date: value.startDate,
    start_precision: value.startPrecision,
    end_date: value.endDate,
    end_precision: value.endPrecision,
    is_current: value.isCurrent,
  };
}

export function createProjectService(client: ProjectClient) {
  async function requireActorId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (data?.user) throw new ProjectServiceError("UNAVAILABLE");
      if (isUnauthenticatedAuthFailure(error)) throw new ProjectServiceError("UNAUTHENTICATED");
      throw new ProjectServiceError("UNAVAILABLE");
    }
    if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
    if (data?.user === null) throw new ProjectServiceError("UNAUTHENTICATED");
    throw new ProjectServiceError("UNAVAILABLE");
  }

  async function readOwnProject(actorId: string, projectId: string): Promise<ProjectRow | null> {
    const { data, error } = await client
      .from("projects")
      .select("*")
      .eq("user_id", actorId)
      .eq("id", projectId)
      .maybeSingle();
    if (error) throw new ProjectServiceError("UNAVAILABLE");
    return data as ProjectRow | null;
  }

  async function readOwnActivity(actorId: string, activityId: string): Promise<ActivityRow | null> {
    const { data, error } = await client
      .from("activities")
      .select("*")
      .eq("user_id", actorId)
      .eq("id", activityId)
      .maybeSingle();
    if (error) throw new ProjectServiceError("UNAVAILABLE");
    return data as ActivityRow | null;
  }

  async function listExperienceLabels(actorId: string, ids: string[]): Promise<Map<string, ProjectExperienceSummary>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await client
      .from("experiences")
      .select("id, organization, role_title")
      .eq("user_id", actorId)
      .in("id", ids);
    if (error) throw new ProjectServiceError("UNAVAILABLE");
    return new Map((data ?? []).map((row) => [row.id, row as ProjectExperienceSummary]));
  }

  async function linkedActivityCounts(actorId: string, projectIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (projectIds.length === 0) return counts;
    const { data, error } = await client
      .from("activities")
      .select("project_id")
      .eq("user_id", actorId)
      .in("project_id", projectIds);
    if (error) throw new ProjectServiceError("UNAVAILABLE");
    for (const row of data ?? []) {
      if (row.project_id) counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
    }
    return counts;
  }

  async function enrichAchievements(actorId: string, rows: AchievementRow[]): Promise<AchievementListItem[]> {
    const projectIds = [...new Set(rows.flatMap((row) => row.project_id ? [row.project_id] : []))];
    const experienceIds = [...new Set(rows.flatMap((row) => row.experience_id ? [row.experience_id] : []))];
    const [{ data: projects, error: projectError }, { data: experiences, error: experienceError }] = await Promise.all([
      projectIds.length ? client.from("projects").select("id, title").eq("user_id", actorId).in("id", projectIds) : Promise.resolve({ data: [], error: null }),
      experienceIds.length ? client.from("experiences").select("id, organization, role_title").eq("user_id", actorId).in("id", experienceIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (projectError || experienceError) throw new ProjectServiceError("UNAVAILABLE");
    const links = rows.length
      ? await client.from("achievement_skills").select("achievement_id, skill_id").eq("user_id", actorId).in("achievement_id", rows.map((row) => row.id))
      : { data: [], error: null };
    if (links.error) throw new ProjectServiceError("UNAVAILABLE");
    const skillIds = [...new Set((links.data ?? []).map((link) => link.skill_id))];
    const skillRows = skillIds.length
      ? await client.from("skills").select("id, name").eq("user_id", actorId).in("id", skillIds)
      : { data: [], error: null };
    if (skillRows.error) throw new ProjectServiceError("UNAVAILABLE");
    const names = new Map((skillRows.data ?? []).map((row) => [row.id, row.name]));
    const projectTitles = new Map((projects ?? []).map((row) => [row.id, row.title]));
    const experienceLabels = new Map((experiences ?? []).map((row) => [row.id, `${row.organization} · ${row.role_title}`]));
    const skillsByAchievement = new Map<string, { id: string; name: string; demonstratedCount: number }[]>();
    for (const link of links.data ?? []) {
      const name = names.get(link.skill_id);
      if (!name) continue;
      const list = skillsByAchievement.get(link.achievement_id) ?? [];
      list.push({ id: link.skill_id, name, demonstratedCount: 0 });
      skillsByAchievement.set(link.achievement_id, list);
    }
    return rows.map((achievement) => ({
      achievement,
      projectTitle: achievement.project_id ? projectTitles.get(achievement.project_id) ?? null : null,
      experienceLabel: achievement.experience_id ? experienceLabels.get(achievement.experience_id) ?? null : null,
      skills: skillsByAchievement.get(achievement.id) ?? [],
    }));
  }

  return {
    async listExperienceOptions(): Promise<ProjectExperienceSummary[]> {
      return withProjectErrorBoundary(async () => {
        const actorId = await requireActorId();
        const { data, error } = await client
          .from("experiences")
          .select("id, organization, role_title")
          .eq("user_id", actorId)
          .order("organization", { ascending: true })
          .order("role_title", { ascending: true })
          .order("id", { ascending: true });
        if (error) throw new ProjectServiceError("UNAVAILABLE");
        return (data ?? []) as ProjectExperienceSummary[];
      });
    },

    async createProject(input: unknown): Promise<ProjectCreateReceipt> {
      return withProjectErrorBoundary(async () => {
        const parsed = projectCreateSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value = normalizeProjectInput(parsed.data);
        const { data, error } = await client.rpc("create_project_idempotent", withNullableCreateProjectArgs({
          p_operation_key: value.operationKey,
          p_title: value.title,
          p_description: value.description,
          p_user_role: value.userRole,
          p_outcome: value.outcome,
          p_status: value.status,
          p_start_date: value.startDate,
          p_start_precision: value.startPrecision,
          p_end_date: value.endDate,
          p_end_precision: value.endPrecision,
          p_is_current: value.isCurrent,
          p_experience_id: value.experienceId,
        }));
        if (error) throw mapDatabaseError(error);
        const receipt = z.object({ project_id: z.uuid(), user_id: z.uuid(), revision: z.literal(1) }).strict().safeParse(data?.[0]);
        if (!receipt.success || receipt.data.user_id !== actorId) throw new ProjectServiceError("UNAVAILABLE");
        return Object.freeze({
          projectId: receipt.data.project_id,
          userId: receipt.data.user_id,
          revision: receipt.data.revision,
        });
      });
    },

    async updateProject(input: unknown): Promise<ProjectRow> {
      return withProjectErrorBoundary(async () => {
        const parsed = projectUpdateSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value = normalizeProjectInput(parsed.data);
        const { data, error } = await client.rpc("update_project", {
          p_project_id: value.projectId,
          p_expected_revision: value.expectedRevision,
          p_changes: projectChanges(value),
        });
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latestRecord = await readOwnProject(actorId, value.projectId);
            if (!latestRecord) throw new ProjectServiceError("NOT_FOUND");
            throw new ProjectServiceError("CONFLICT", { latestRecord });
          }
          throw mapped;
        }
        const project = data?.[0] as ProjectRow | undefined;
        if (!project || project.user_id !== actorId) throw new ProjectServiceError("NOT_FOUND");
        return project;
      });
    },

    async listProjects(filters: unknown = {}): Promise<ProjectListPage> {
      return withProjectErrorBoundary(async () => {
        const parsed = projectListFilterSchema.safeParse(filters);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: ProjectListFilters = parsed.data;
        let query = value.outcomeMissing
          ? client.rpc("filter_projects", { p_outcome_missing: true }).select("*").eq("user_id", actorId)
          : client.from("projects").select("*").eq("user_id", actorId);
        query = query.order("updated_at", { ascending: false }).order("id", { ascending: false });
        if (value.status) query = query.eq("status", value.status);
        if (value.cursor) {
          let cursor: ProjectCursor;
          try {
            cursor = decodeProjectCursor(value.cursor);
          } catch {
            throw new ProjectServiceError("VALIDATION", { fieldErrors: { cursor: "error.validation" } });
          }
          query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
        }
        const { data, error } = await query.limit(PROJECT_LIST_PAGE_SIZE + 1);
        if (error) throw new ProjectServiceError("UNAVAILABLE");
        const rows = (data ?? []) as ProjectRow[];
        const pageRows = rows.slice(0, PROJECT_LIST_PAGE_SIZE);
        const experienceLabels = await listExperienceLabels(actorId, [...new Set(pageRows.flatMap((row) => row.experience_id ? [row.experience_id] : []))]);
        const activityCounts = await linkedActivityCounts(actorId, pageRows.map((row) => row.id));
        const items = pageRows.map((project) => ({
          project,
          experience: project.experience_id ? experienceLabels.get(project.experience_id) ?? null : null,
          linkedActivityCount: activityCounts.get(project.id) ?? 0,
        }));
        const last = pageRows.at(-1);
        const nextCursor = rows.length > PROJECT_LIST_PAGE_SIZE && last
          ? encodeProjectCursor({ updatedAt: last.updated_at, id: last.id })
          : null;
        return { items, nextCursor };
      });
    },

    async getProject(projectId: unknown): Promise<ProjectDetail> {
      return withProjectErrorBoundary(async () => {
        const parsedId = z.uuid().safeParse(projectId);
        if (!parsedId.success) throw new ProjectServiceError("NOT_FOUND");
        const actorId = await requireActorId();
        const project = await readOwnProject(actorId, parsedId.data);
        if (!project) throw new ProjectServiceError("NOT_FOUND");
        const experienceLabels = project.experience_id
          ? await listExperienceLabels(actorId, [project.experience_id])
          : new Map<string, ProjectExperienceSummary>();
        const { data, error } = await client
          .from("activities")
          .select("id, occurred_on, capture_mode, role, scope, outcome, experience_id, project_id, revision, raw_text")
          .eq("user_id", actorId)
          .eq("project_id", project.id)
          .order("occurred_on", { ascending: false })
          .order("id", { ascending: false });
        if (error) throw new ProjectServiceError("UNAVAILABLE");
        const activities = (data ?? []) as ProjectActivitySummary[];
        const { data: achievementRows, error: achievementError } = await client
          .from("achievements")
          .select("*")
          .eq("user_id", actorId)
          .eq("project_id", project.id)
          .order("achieved_on", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false });
        if (achievementError) throw new ProjectServiceError("UNAVAILABLE");
        const achievements = await enrichAchievements(actorId, (achievementRows ?? []) as AchievementRow[]);
        return {
          project,
          experience: project.experience_id ? experienceLabels.get(project.experience_id) ?? null : null,
          activities,
          achievements,
          dependencyCount: activities.length,
        };
      });
    },

    async listRelinkCandidates(projectId: unknown, filters: unknown = {}): Promise<ProjectRelinkCandidatePage> {
      return withProjectErrorBoundary(async () => {
        const parsedId = z.uuid().safeParse(projectId);
        if (!parsedId.success) throw new ProjectServiceError("NOT_FOUND");
        const actorId = await requireActorId();
        const project = await readOwnProject(actorId, parsedId.data);
        if (!project) throw new ProjectServiceError("NOT_FOUND");
        const parsedFilters = z.object({ cursor: z.string().trim().min(1).max(256).nullable().optional() }).strict().safeParse(filters);
        if (!parsedFilters.success) throw validationError(parsedFilters.error);
        let query = client
          .from("activities")
          .select("id, occurred_on, capture_mode, role, scope, outcome, experience_id, project_id, revision, raw_text")
          .eq("user_id", actorId)
          .or(`project_id.is.null,project_id.neq.${parsedId.data}`)
          .order("occurred_on", { ascending: false })
          .order("id", { ascending: false });
        if (parsedFilters.data.cursor) {
          let cursor: ActivityCursor;
          try {
            cursor = decodeActivityCursor(parsedFilters.data.cursor);
          } catch {
            throw new ProjectServiceError("VALIDATION", { fieldErrors: { cursor: "error.validation" } });
          }
          query = query.or(`occurred_on.lt.${cursor.occurredOn},and(occurred_on.eq.${cursor.occurredOn},id.lt.${cursor.id})`);
        }
        const { data, error } = await query.limit(PROJECT_RELINK_PAGE_SIZE + 1);
        if (error) throw new ProjectServiceError("UNAVAILABLE");
        const rows = (data ?? []) as ProjectActivitySummary[];
        const pageRows = rows.slice(0, PROJECT_RELINK_PAGE_SIZE);
        const otherProjectIds = [...new Set(pageRows.flatMap((row) => row.project_id && row.project_id !== project.id ? [row.project_id] : []))];
        const { data: projectRows, error: projectError } = otherProjectIds.length === 0
          ? { data: [], error: null }
          : await client.from("projects").select("id, title").eq("user_id", actorId).in("id", otherProjectIds);
        if (projectError) throw new ProjectServiceError("UNAVAILABLE");
        const titles = new Map((projectRows ?? []).map((row) => [row.id, row.title]));
        const items = pageRows.map((row) => ({ ...row, currentProjectTitle: row.project_id ? titles.get(row.project_id) ?? null : null }));
        const last = pageRows.at(-1);
        const nextCursor = rows.length > PROJECT_RELINK_PAGE_SIZE && last
          ? encodeActivityCursor({ occurredOn: last.occurred_on, id: last.id })
          : null;
        return { items, nextCursor };
      });
    },

    async relinkActivity(input: unknown): Promise<ActivityRow> {
      return withProjectErrorBoundary(async () => {
        const parsed = relinkActivitySchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: RelinkActivityInput = parsed.data;
        const { data, error } = await client.rpc("relink_activity_project", {
          p_activity_id: value.activityId,
          p_expected_revision: value.expectedRevision,
          p_project_id: value.projectId,
        } as Database["public"]["Functions"]["relink_activity_project"]["Args"]);
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latestRecord = await readOwnActivity(actorId, value.activityId);
            if (!latestRecord) throw new ProjectServiceError("NOT_FOUND");
            throw new ProjectServiceError("CONFLICT", { latestRecord });
          }
          throw mapped;
        }
        const activity = data?.[0] as ActivityRow | undefined;
        if (!activity || activity.user_id !== actorId) throw new ProjectServiceError("NOT_FOUND");
        return activity;
      });
    },

    async deleteProject(input: unknown): Promise<ProjectDeleteReceipt> {
      return withProjectErrorBoundary(async () => {
        const parsed = deleteProjectSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: DeleteProjectInput = parsed.data;
        const { data, error } = await client.rpc("delete_project", {
          p_project_id: value.projectId,
          p_expected_revision: value.expectedRevision,
        });
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latestRecord = await readOwnProject(actorId, value.projectId);
            if (!latestRecord) throw new ProjectServiceError("NOT_FOUND");
            throw new ProjectServiceError("CONFLICT", { latestRecord });
          }
          throw mapped;
        }
        const receipt = z.object({
          deleted_project_id: z.uuid(),
          released_activity_count: z.number().int().nonnegative(),
          released_achievement_count: z.number().int().nonnegative(),
        }).strict().safeParse(data?.[0]);
        if (!receipt.success || receipt.data.deleted_project_id !== value.projectId) throw new ProjectServiceError("NOT_FOUND");
        return Object.freeze({
          deletedProjectId: receipt.data.deleted_project_id,
          releasedActivityCount: receipt.data.released_activity_count,
          releasedAchievementCount: receipt.data.released_achievement_count,
        });
      });
    },
  };
}
