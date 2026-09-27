import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import {
  ACHIEVEMENT_LIST_PAGE_SIZE,
  type AchievementCreateReceipt,
  type AchievementDetail,
  type AchievementContextOptions,
  type AchievementListItem,
  type AchievementListPage,
  type AchievementMetric,
  type AchievementRelinkCandidatePage,
  type AchievementRow,
  type AchievementSkill,
} from "@/domain/achievement/contracts";
import { decodeAchievementCursor, encodeAchievementCursor, type AchievementCursor } from "@/domain/achievement/achievement-cursor";
import type { MessageKey } from "@/i18n/messages";
import type { Database, Json } from "@/server/supabase/database.types";
import {
  achievementChangesSchema,
  achievementCreateSchema,
  achievementDeleteSchema,
  achievementListFilterSchema,
  achievementSaveSchema,
  achievementUpdateContextSchema,
  type AchievementChanges,
} from "@/features/achievement/schemas";

export type AchievementServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAVAILABLE";

const ERROR_KEYS: Record<AchievementServiceErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  UNAUTHENTICATED: "auth.signInRequired",
  NOT_FOUND: "error.notFound",
  CONFLICT: "error.conflict",
  IDEMPOTENCY_KEY_REUSED: "error.operationKeyReused",
  UNAVAILABLE: "error.unavailable",
};

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);

type DatabaseErrorShape = { code?: string; message?: string };
type AchievementClient = SupabaseClient<Database>;
type AchievementDatabaseRow = Database["public"]["Tables"]["achievements"]["Row"];
type AchievementSkillLink = Database["public"]["Tables"]["achievement_skills"]["Row"];
type AchievementActivitySummary = AchievementDetail["activity"];

type AchievementServiceErrorDetails = {
  fieldErrors?: Partial<Record<string, MessageKey>>;
  latestRecord?: AchievementRow;
};

export class AchievementServiceError extends Error {
  readonly code: AchievementServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;
  readonly fieldErrors?: Partial<Record<string, MessageKey>>;
  readonly latestRecord?: AchievementRow;

  constructor(code: AchievementServiceErrorCode, details: AchievementServiceErrorDetails = {}) {
    super("Achievement service request could not be completed.");
    this.name = "AchievementServiceError";
    this.code = code;
    this.messageKey = ERROR_KEYS[code];
    this.correlationId = randomUUID();
    this.fieldErrors = details.fieldErrors;
    this.latestRecord = details.latestRecord;
  }
}

function mapRow(row: AchievementDatabaseRow): AchievementRow {
  const metrics = Array.isArray(row.metrics) ? row.metrics as unknown as AchievementMetric[] : [];
  return { ...row, status: row.status as AchievementRow["status"], origin: row.origin as AchievementRow["origin"], metrics };
}

function validationError(error: z.ZodError): AchievementServiceError {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0] ?? "form")] = "error.validation";
  return new AchievementServiceError("VALIDATION", { fieldErrors });
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
    if (error instanceof AchievementServiceError) throw error;
    throw new AchievementServiceError("UNAVAILABLE");
  }
}

function mapDatabaseError(error: DatabaseErrorShape): AchievementServiceError {
  if (error.message === "AUTH_REQUIRED" || error.code === "42501") return new AchievementServiceError("UNAUTHENTICATED");
  if (error.message === "IDEMPOTENCY_KEY_REUSED") return new AchievementServiceError("IDEMPOTENCY_KEY_REUSED");
  if (["ACHIEVEMENT_UNAVAILABLE", "ACTIVITY_UNAVAILABLE"].includes(error.message ?? "")) return new AchievementServiceError("NOT_FOUND");
  if (["STALE_REVISION", "ACHIEVEMENT_EXISTS", "INVALID_ACHIEVEMENT_TRANSITION", "ACTIVITY_CONTEXT_CHANGED"].includes(error.message ?? "")) return new AchievementServiceError("CONFLICT");
  if (error.message === "REQUIRED_CONFIRM_FIELDS") return new AchievementServiceError("VALIDATION", { fieldErrors: { title: "validation.required", contribution: "validation.required", outcome: "validation.required", achievedOn: "validation.required", cvBullet: "validation.required" } });
  if (error.message === "CV_BULLET_TOO_LONG") return new AchievementServiceError("VALIDATION", { fieldErrors: { cvBullet: "error.validation" } });
  if (["DUPLICATE_SKILL", "TOO_MANY_SKILLS", "INVALID_SKILL_INPUT"].includes(error.message ?? "")) return new AchievementServiceError("VALIDATION", { fieldErrors: { skillNames: "error.validation" } });
  if ((error.code ?? "").startsWith("22") || ["23503", "23505", "23514"].includes(error.code ?? "")) return new AchievementServiceError("VALIDATION");
  return new AchievementServiceError("UNAVAILABLE");
}

function nullableRpcArg<T>(value: T | null): T {
  return value as T;
}

function toChanges(value: AchievementChanges): Json {
  return {
    title: value.title,
    contribution: value.contribution,
    scope: value.scope,
    outcome: value.outcome,
    cv_bullet: value.cvBullet,
    achieved_on: value.achievedOn,
    metrics: value.metrics as unknown as Json,
  };
}

export function createAchievementService(client: AchievementClient) {
  async function requireActorId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (data?.user) throw new AchievementServiceError("UNAVAILABLE");
      if (isUnauthenticatedAuthFailure(error)) throw new AchievementServiceError("UNAUTHENTICATED");
      throw new AchievementServiceError("UNAVAILABLE");
    }
    if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
    if (data?.user === null) throw new AchievementServiceError("UNAUTHENTICATED");
    throw new AchievementServiceError("UNAVAILABLE");
  }

  async function readOwnAchievement(actorId: string, id: string): Promise<AchievementRow | null> {
    const { data, error } = await client.from("achievements").select("*").eq("user_id", actorId).eq("id", id).maybeSingle();
    if (error) throw new AchievementServiceError("UNAVAILABLE");
    return data ? mapRow(data) : null;
  }

  async function loadSkills(actorId: string, achievementIds: string[]): Promise<Map<string, AchievementSkill[]>> {
    const result = new Map<string, AchievementSkill[]>();
    if (achievementIds.length === 0) return result;
    const { data: links, error: linkError } = await client
      .from("achievement_skills")
      .select("achievement_id, skill_id")
      .eq("user_id", actorId)
      .in("achievement_id", achievementIds);
    if (linkError) throw new AchievementServiceError("UNAVAILABLE");
    const typedLinks = (links ?? []) as Pick<AchievementSkillLink, "achievement_id" | "skill_id">[];
    const skillIds = [...new Set(typedLinks.map((link) => link.skill_id))];
    const { data: skillRows, error: skillError } = skillIds.length === 0
      ? { data: [], error: null }
      : await client.from("skills").select("id, name").eq("user_id", actorId).in("id", skillIds);
    if (skillError) throw new AchievementServiceError("UNAVAILABLE");
    const { data: confirmedRows, error: confirmedError } = await client
      .from("achievements")
      .select("id")
      .eq("user_id", actorId)
      .eq("status", "confirmed");
    if (confirmedError) throw new AchievementServiceError("UNAVAILABLE");
    const confirmedIds = new Set((confirmedRows ?? []).map((row) => row.id));
    const countBySkill = new Map<string, number>();
    if (confirmedIds.size > 0) {
      const { data: confirmedLinks, error: confirmedLinkError } = await client
        .from("achievement_skills")
        .select("achievement_id, skill_id")
        .eq("user_id", actorId)
        .in("achievement_id", [...confirmedIds]);
      if (confirmedLinkError) throw new AchievementServiceError("UNAVAILABLE");
      for (const link of confirmedLinks ?? []) {
        if (confirmedIds.has(link.achievement_id)) countBySkill.set(link.skill_id, (countBySkill.get(link.skill_id) ?? 0) + 1);
      }
    }
    const names = new Map((skillRows ?? []).map((row) => [row.id, row.name]));
    for (const link of typedLinks) {
      const list = result.get(link.achievement_id) ?? [];
      const name = names.get(link.skill_id);
      if (name) list.push({ id: link.skill_id, name, demonstratedCount: countBySkill.get(link.skill_id) ?? 0 });
      result.set(link.achievement_id, list);
    }
    return result;
  }

  async function enrichList(actorId: string, rows: AchievementRow[]): Promise<AchievementListItem[]> {
    const projectIds = [...new Set(rows.flatMap((row) => row.project_id ? [row.project_id] : []))];
    const experienceIds = [...new Set(rows.flatMap((row) => row.experience_id ? [row.experience_id] : []))];
    const [{ data: projects, error: projectError }, { data: experiences, error: experienceError }, skills] = await Promise.all([
      projectIds.length ? client.from("projects").select("id, title").eq("user_id", actorId).in("id", projectIds) : Promise.resolve({ data: [], error: null }),
      experienceIds.length ? client.from("experiences").select("id, organization, role_title").eq("user_id", actorId).in("id", experienceIds) : Promise.resolve({ data: [], error: null }),
      loadSkills(actorId, rows.map((row) => row.id)),
    ]);
    if (projectError || experienceError) throw new AchievementServiceError("UNAVAILABLE");
    const projectTitles = new Map((projects ?? []).map((row) => [row.id, row.title]));
    const experienceLabels = new Map((experiences ?? []).map((row) => [row.id, `${row.organization} · ${row.role_title}`]));
    return rows.map((achievement) => ({
      achievement,
      projectTitle: achievement.project_id ? projectTitles.get(achievement.project_id) ?? null : null,
      experienceLabel: achievement.experience_id ? experienceLabels.get(achievement.experience_id) ?? null : null,
      skills: skills.get(achievement.id) ?? [],
    }));
  }

  return {
    async listContextOptions(): Promise<AchievementContextOptions> {
      return withBoundary(async () => {
        const actorId = await requireActorId();
        const [{ data: projects, error: projectError }, { data: experiences, error: experienceError }] = await Promise.all([
          client.from("projects").select("id, title, experience_id").eq("user_id", actorId).order("title", { ascending: true }).order("id", { ascending: true }),
          client.from("experiences").select("id, organization, role_title").eq("user_id", actorId).order("organization", { ascending: true }).order("role_title", { ascending: true }).order("id", { ascending: true }),
        ]);
        if (projectError || experienceError) throw new AchievementServiceError("UNAVAILABLE");
        return {
          projects: (projects ?? []) as AchievementContextOptions["projects"],
          experiences: (experiences ?? []) as AchievementContextOptions["experiences"],
        };
      });
    },

    async createAchievement(input: unknown): Promise<AchievementCreateReceipt> {
      return withBoundary(async () => {
        const parsed = achievementCreateSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const { data, error } = await client.rpc("create_achievement_idempotent", {
          p_operation_key: parsed.data.operationKey,
          p_activity_id: nullableRpcArg(parsed.data.activityId),
          p_project_id: nullableRpcArg(parsed.data.projectId),
          p_experience_id: nullableRpcArg(parsed.data.experienceId),
        });
        if (error) throw mapDatabaseError(error);
        const receipt = z.object({ achievement_id: z.uuid(), user_id: z.uuid(), revision: z.literal(1) }).strict().safeParse(data?.[0]);
        if (!receipt.success || receipt.data.user_id !== actorId) throw new AchievementServiceError("UNAVAILABLE");
        return Object.freeze({ achievementId: receipt.data.achievement_id, userId: receipt.data.user_id, revision: 1 as const });
      });
    },

    async saveAchievement(input: unknown): Promise<AchievementRow> {
      return withBoundary(async () => {
        const parsed = achievementSaveSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const { data, error } = await client.rpc("save_achievement", {
          p_achievement_id: parsed.data.achievementId,
          p_expected_revision: parsed.data.expectedRevision,
          p_action: parsed.data.action,
          p_changes: toChanges(parsed.data.changes),
          p_skill_names: parsed.data.skillNames as unknown as Json,
        });
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latest = await readOwnAchievement(actorId, parsed.data.achievementId);
            if (!latest) throw new AchievementServiceError("NOT_FOUND");
            throw new AchievementServiceError("CONFLICT", { latestRecord: latest });
          }
          throw mapped;
        }
        const row = data?.[0];
        if (!row || row.user_id !== actorId) throw new AchievementServiceError("NOT_FOUND");
        return mapRow(row);
      });
    },

    async relinkAchievement(input: unknown): Promise<AchievementRow> {
      return withBoundary(async () => {
        const parsed = achievementUpdateContextSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const { data, error } = await client.rpc("relink_achievement_project", {
          p_achievement_id: parsed.data.achievementId,
          p_expected_revision: parsed.data.expectedRevision,
          p_project_id: nullableRpcArg(parsed.data.projectId),
        });
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latest = await readOwnAchievement(actorId, parsed.data.achievementId);
            if (!latest) throw new AchievementServiceError("NOT_FOUND");
            throw new AchievementServiceError("CONFLICT", { latestRecord: latest });
          }
          throw mapped;
        }
        const row = data?.[0];
        if (!row || row.user_id !== actorId) throw new AchievementServiceError("NOT_FOUND");
        return mapRow(row);
      });
    },

    async deleteAchievement(input: unknown): Promise<{ deletedAchievementId: string; retainedActivity: boolean }> {
      return withBoundary(async () => {
        const parsed = achievementDeleteSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const { data, error } = await client.rpc("delete_achievement", {
          p_achievement_id: parsed.data.achievementId,
          p_expected_revision: parsed.data.expectedRevision,
        });
        if (error) throw mapDatabaseError(error);
        const receipt = z.object({ deleted_achievement_id: z.uuid(), retained_activity: z.boolean() }).strict().safeParse(data?.[0]);
        if (!receipt.success) throw new AchievementServiceError("NOT_FOUND");
        return { deletedAchievementId: receipt.data.deleted_achievement_id, retainedActivity: receipt.data.retained_activity };
      });
    },

    async listAchievements(filters: unknown = {}): Promise<AchievementListPage> {
      return withBoundary(async () => {
        const parsed = achievementListFilterSchema.safeParse(filters);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        let query = parsed.data.skillId || parsed.data.missingEvidence
          ? client.rpc("filter_achievements", {
            p_skill_id: parsed.data.skillId,
            p_missing_ready_evidence: parsed.data.missingEvidence ?? false,
          }).select("*").eq("user_id", actorId)
          : client.from("achievements").select("*").eq("user_id", actorId);
        query = query.order("achieved_on", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false });
        if (parsed.data.status) query = query.eq("status", parsed.data.status);
        if (parsed.data.projectId) query = query.eq("project_id", parsed.data.projectId);
        if (parsed.data.cursor) {
          let cursor: AchievementCursor;
          try { cursor = decodeAchievementCursor(parsed.data.cursor); } catch { throw new AchievementServiceError("VALIDATION", { fieldErrors: { cursor: "error.validation" } }); }
          query = cursor.bucket === "dated"
            ? query.or(`achieved_on.lt.${cursor.achievedOn},and(achieved_on.eq.${cursor.achievedOn},id.lt.${cursor.id}),achieved_on.is.null`)
            : query.or(`and(achieved_on.is.null,id.lt.${cursor.id})`);
        }
        const { data, error } = await query.limit(ACHIEVEMENT_LIST_PAGE_SIZE + 1);
        if (error) throw new AchievementServiceError("UNAVAILABLE");
        const rows = (data ?? []).map(mapRow);
        const pageRows = rows.slice(0, ACHIEVEMENT_LIST_PAGE_SIZE);
        const last = pageRows.at(-1);
        return {
          items: await enrichList(actorId, pageRows),
          nextCursor: rows.length > ACHIEVEMENT_LIST_PAGE_SIZE && last ? encodeAchievementCursor({ achievedOn: last.achieved_on, id: last.id }) : null,
        };
      });
    },

    async listRelinkCandidates(projectId: unknown, filters: unknown = {}): Promise<AchievementRelinkCandidatePage> {
      return withBoundary(async () => {
        const parsedId = z.uuid().safeParse(projectId);
        if (!parsedId.success) throw new AchievementServiceError("NOT_FOUND");
        const actorId = await requireActorId();
        const { data: targetProject, error: projectError } = await client
          .from("projects")
          .select("id")
          .eq("user_id", actorId)
          .eq("id", parsedId.data)
          .maybeSingle();
        if (projectError) throw new AchievementServiceError("UNAVAILABLE");
        if (!targetProject) throw new AchievementServiceError("NOT_FOUND");
        const parsedFilters = z.object({ cursor: z.string().trim().min(1).max(256).nullable().optional() }).strict().safeParse(filters);
        if (!parsedFilters.success) throw validationError(parsedFilters.error);

        let query = client.from("achievements").select("*").eq("user_id", actorId)
          .or(`project_id.is.null,project_id.neq.${parsedId.data}`)
          .order("achieved_on", { ascending: false, nullsFirst: false })
          .order("id", { ascending: false });
        if (parsedFilters.data.cursor) {
          let cursor: AchievementCursor;
          try {
            cursor = decodeAchievementCursor(parsedFilters.data.cursor);
          } catch {
            throw new AchievementServiceError("VALIDATION", { fieldErrors: { cursor: "error.validation" } });
          }
          query = cursor.bucket === "dated"
            ? query.or(`achieved_on.lt.${cursor.achievedOn},and(achieved_on.eq.${cursor.achievedOn},id.lt.${cursor.id}),achieved_on.is.null`)
            : query.or(`and(achieved_on.is.null,id.lt.${cursor.id})`);
        }
        const { data, error } = await query.limit(ACHIEVEMENT_LIST_PAGE_SIZE + 1);
        if (error) throw new AchievementServiceError("UNAVAILABLE");
        const rows = (data ?? []).map(mapRow);
        const pageRows = rows.slice(0, ACHIEVEMENT_LIST_PAGE_SIZE);
        const items = (await enrichList(actorId, pageRows)).map((item) => ({
          ...item,
          currentProjectTitle: item.projectTitle,
        }));
        const last = pageRows.at(-1);
        return {
          items,
          nextCursor: rows.length > ACHIEVEMENT_LIST_PAGE_SIZE && last ? encodeAchievementCursor({ achievedOn: last.achieved_on, id: last.id }) : null,
        };
      });
    },

    async getAchievement(achievementId: unknown): Promise<AchievementDetail> {
      return withBoundary(async () => {
        const parsedId = z.uuid().safeParse(achievementId);
        if (!parsedId.success) throw new AchievementServiceError("NOT_FOUND");
        const actorId = await requireActorId();
        const achievement = await readOwnAchievement(actorId, parsedId.data);
        if (!achievement) throw new AchievementServiceError("NOT_FOUND");
        const [activityResult, projectResult, experienceResult, skills] = await Promise.all([
          achievement.activity_id
            ? client.from("activities").select("id, raw_text, revision, occurred_on, role, scope, outcome").eq("user_id", actorId).eq("id", achievement.activity_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          achievement.project_id
            ? client.from("projects").select("id, title").eq("user_id", actorId).eq("id", achievement.project_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          achievement.experience_id
            ? client.from("experiences").select("id, organization, role_title").eq("user_id", actorId).eq("id", achievement.experience_id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          loadSkills(actorId, [achievement.id]),
        ]);
        if (activityResult.error || projectResult.error || experienceResult.error) throw new AchievementServiceError("UNAVAILABLE");
        return {
          achievement,
          activity: (activityResult.data ?? null) as AchievementActivitySummary,
          projectTitle: projectResult.data?.title ?? null,
          experienceLabel: experienceResult.data ? `${experienceResult.data.organization} · ${experienceResult.data.role_title}` : null,
          skills: skills.get(achievement.id) ?? [],
        };
      });
    },
  };
}
