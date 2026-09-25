import { randomUUID } from "node:crypto";

import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import * as z from "zod";

import {
  ACTIVITY_LIST_PAGE_SIZE,
  type ActivityDeleteReceipt,
  type ActivityCreateReceipt,
  type ActivityListItem,
  type ActivityRow,
  type ChatMessageRow,
} from "@/domain/activity/contracts";
import type { AchievementRow } from "@/domain/achievement/contracts";
import { decodeActivityCursor, encodeActivityCursor } from "@/domain/activity/activity-cursor";
import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";
import {
  activityCreateSchema,
  activityDeleteSchema,
  activityListFilterSchema,
  activityUpdateSchema,
  type ActivityCreateInput,
  type ActivityListFilters,
  type ActivityUpdateInput,
} from "@/features/activity/schemas";

export type ActivityServiceErrorCode =
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "UNAVAILABLE";

const ACTIVITY_ERROR_MESSAGE_KEYS: Record<ActivityServiceErrorCode, MessageKey> = {
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

const activityCreateReceiptRpcSchema = z.object({
  activity_id: z.uuid(),
  user_id: z.uuid(),
  revision: z.literal(1),
  occurred_on: z.iso.date(),
  capture_mode: z.enum(["note", "form", "chat"]),
}).strict();

type ActivityServiceErrorDetails = {
  fieldErrors?: Partial<Record<string, MessageKey>>;
  latestRecord?: ActivityRow;
};

export class ActivityServiceError extends Error {
  readonly code: ActivityServiceErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;
  readonly fieldErrors?: Partial<Record<string, MessageKey>>;
  readonly latestRecord?: ActivityRow;

  constructor(code: ActivityServiceErrorCode);
  constructor(code: "CONFLICT", details: { latestRecord: ActivityRow });
  constructor(
    code: Exclude<ActivityServiceErrorCode, "CONFLICT">,
    details: { fieldErrors?: Partial<Record<string, MessageKey>> },
  );
  constructor(
    code: ActivityServiceErrorCode,
    details: ActivityServiceErrorDetails = {},
  ) {
    super("Activity service request could not be completed.");
    this.name = "ActivityServiceError";
    this.code = code;
    this.messageKey = ACTIVITY_ERROR_MESSAGE_KEYS[code];
    this.correlationId = randomUUID();
    this.fieldErrors = details.fieldErrors;
    this.latestRecord = code === "CONFLICT" ? details.latestRecord : undefined;
  }
}

interface DatabaseErrorShape {
  code?: string;
  message?: string;
}

type ActivityClient = SupabaseClient<Database>;
type CreateActivityRpcArgs = Database["public"]["Functions"]["create_activity_idempotent"]["Args"];
type NullableCreateActivityRpcArgs = Omit<
  CreateActivityRpcArgs,
  "p_role" | "p_scope" | "p_outcome" | "p_experience_id" | "p_project_id"
> & {
  p_role: CreateActivityRpcArgs["p_role"] | null;
  p_scope: CreateActivityRpcArgs["p_scope"] | null;
  p_outcome: CreateActivityRpcArgs["p_outcome"] | null;
  p_experience_id: CreateActivityRpcArgs["p_experience_id"] | null;
  p_project_id: CreateActivityRpcArgs["p_project_id"] | null;
};

function withNullableCreateActivityArgs(args: NullableCreateActivityRpcArgs): CreateActivityRpcArgs {
  return args as CreateActivityRpcArgs;
}

export interface ActivityListPage {
  items: ActivityListItem[];
  nextCursor: string | null;
}

export interface ActivityDetail {
  activity: ActivityRow;
  chatMessages: ChatMessageRow[];
  achievement: AchievementRow | null;
}

function validationError(error: z.ZodError): ActivityServiceError {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] = "error.validation";
  }
  return new ActivityServiceError("VALIDATION", { fieldErrors });
}

function isUnauthenticatedAuthFailure(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return false;
  if (isAuthSessionMissingError(error)) return true;
  if (!isAuthError(error)) return false;
  return error.status === 401 || error.status === 403 ||
    (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code));
}

async function withActivityErrorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ActivityServiceError) throw error;
    throw new ActivityServiceError("UNAVAILABLE");
  }
}

function mapDatabaseError(error: DatabaseErrorShape): ActivityServiceError {
  if (error.message === "AUTH_REQUIRED" || error.code === "42501") {
    return new ActivityServiceError("UNAUTHENTICATED");
  }
  if (error.message === "IDEMPOTENCY_KEY_REUSED") {
    return new ActivityServiceError("IDEMPOTENCY_KEY_REUSED");
  }
  if (error.message === "ACTIVITY_UNAVAILABLE") {
    return new ActivityServiceError("NOT_FOUND");
  }
  if (error.message === "STALE_REVISION" || error.message === "ACTIVITY_CONTEXT_CHANGED") {
    return new ActivityServiceError("CONFLICT");
  }
  if (
    error.code === "22023" || error.code === "22008" || error.code === "22P02" ||
    error.code === "23503" || error.code === "23514"
  ) {
    return new ActivityServiceError("VALIDATION");
  }
  return new ActivityServiceError("UNAVAILABLE");
}

export function createActivityService(client: ActivityClient) {
  async function requireActorId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) {
      if (data?.user) throw new ActivityServiceError("UNAVAILABLE");
      if (isUnauthenticatedAuthFailure(error)) throw new ActivityServiceError("UNAUTHENTICATED");
      throw new ActivityServiceError("UNAVAILABLE");
    }
    if (data?.user && z.uuid().safeParse(data.user.id).success) return data.user.id;
    if (data?.user === null) throw new ActivityServiceError("UNAUTHENTICATED");
    throw new ActivityServiceError("UNAVAILABLE");
  }

  async function readOwnActivity(actorId: string, activityId: string): Promise<ActivityRow | null> {
    const { data, error } = await client
      .from("activities")
      .select("*")
      .eq("id", activityId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (error) throw new ActivityServiceError("UNAVAILABLE");
    return data as ActivityRow | null;
  }

  return {
    async createActivity(input: unknown): Promise<ActivityCreateReceipt> {
      return withActivityErrorBoundary(async () => {
        const parsed = activityCreateSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: ActivityCreateInput = parsed.data;
        const { data, error } = await client.rpc("create_activity_idempotent", withNullableCreateActivityArgs({
          p_operation_key: value.operationKey,
          p_raw_text: value.rawText,
          p_occurred_on: value.occurredOn,
          p_capture_mode: value.captureMode,
          p_role: value.role,
          p_scope: value.scope,
          p_outcome: value.outcome,
          p_experience_id: value.experienceId,
          p_project_id: value.projectId,
        }));
        if (error) throw mapDatabaseError(error);
        if (!data || data.length !== 1) throw new ActivityServiceError("UNAVAILABLE");

        const receiptResult = activityCreateReceiptRpcSchema.safeParse(data[0]);
        if (!receiptResult.success || receiptResult.data.user_id !== actorId) {
          throw new ActivityServiceError("UNAVAILABLE");
        }

        const receipt: ActivityCreateReceipt = Object.freeze({
          activityId: receiptResult.data.activity_id,
          userId: receiptResult.data.user_id,
          revision: receiptResult.data.revision,
          occurredOn: receiptResult.data.occurred_on,
          captureMode: receiptResult.data.capture_mode,
        });
        return receipt;
      });
    },

    async updateActivity(input: unknown): Promise<ActivityRow> {
      return withActivityErrorBoundary(async () => {
        const parsed = activityUpdateSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: ActivityUpdateInput = parsed.data;
        const { data, error } = await client.rpc("update_activity", {
          p_activity_id: value.activityId,
          p_expected_revision: value.expectedRevision,
          p_changes: {
            raw_text: value.rawText,
            occurred_on: value.occurredOn,
            role: value.role,
            scope: value.scope,
            outcome: value.outcome,
            experience_id: value.experienceId,
            project_id: value.projectId,
          },
        });

        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latestRecord = await readOwnActivity(actorId, value.activityId);
            if (!latestRecord) throw new ActivityServiceError("NOT_FOUND");
            throw new ActivityServiceError("CONFLICT", { latestRecord });
          }
          throw mapped;
        }

        const activity = data?.[0] as ActivityRow | undefined;
        if (!activity || activity.user_id !== actorId) throw new ActivityServiceError("NOT_FOUND");
        return activity;
      });
    },

    async listActivities(filters: unknown = {}): Promise<ActivityListPage> {
      return withActivityErrorBoundary(async () => {
        const parsed = activityListFilterSchema.safeParse(filters);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const value: ActivityListFilters = parsed.data;
        let query = client
          .from("activities")
          .select("*")
          .eq("user_id", actorId)
          .order("occurred_on", { ascending: false })
          .order("id", { ascending: false });

        if (value.from) query = query.gte("occurred_on", value.from);
        if (value.to) query = query.lte("occurred_on", value.to);
        if (value.projectId) query = query.eq("project_id", value.projectId);
        if (value.cursor) {
          const cursor = decodeActivityCursor(value.cursor);
          query = query.or(
            `occurred_on.lt.${cursor.occurredOn},and(occurred_on.eq.${cursor.occurredOn},id.lt.${cursor.id})`,
          );
        }

        const { data, error } = await query.limit(ACTIVITY_LIST_PAGE_SIZE + 1);
        if (error) throw new ActivityServiceError("UNAVAILABLE");
        const rows = (data ?? []) as ActivityRow[];
        const items = rows.slice(0, ACTIVITY_LIST_PAGE_SIZE) as ActivityListItem[];
        const last = items.at(-1);
        const nextCursor = rows.length > ACTIVITY_LIST_PAGE_SIZE && last
          ? encodeActivityCursor({ occurredOn: last.occurred_on, id: last.id })
          : null;
        return { items, nextCursor };
      });
    },

    async getActivity(activityId: unknown): Promise<ActivityDetail> {
      return withActivityErrorBoundary(async () => {
        const parsedId = z.uuid().safeParse(activityId);
        if (!parsedId.success) throw validationError(parsedId.error);
        const actorId = await requireActorId();
        const activity = await readOwnActivity(actorId, parsedId.data);
        if (!activity) throw new ActivityServiceError("NOT_FOUND");

        const [{ data: chatData, error: chatError }, { data: achievementData, error: achievementError }] = await Promise.all([
          client
          .from("chat_messages")
          .select("*")
          .eq("user_id", actorId)
          .eq("activity_id", activity.id)
          .order("sequence_no", { ascending: true }),
          client
            .from("achievements")
            .select("*")
            .eq("user_id", actorId)
            .eq("activity_id", activity.id)
            .maybeSingle(),
        ]);
        if (chatError || achievementError) throw new ActivityServiceError("UNAVAILABLE");
        const achievement = achievementData
          ? {
              ...achievementData,
              status: achievementData.status as AchievementRow["status"],
              origin: achievementData.origin as AchievementRow["origin"],
              metrics: Array.isArray(achievementData.metrics) ? achievementData.metrics as unknown as AchievementRow["metrics"] : [],
            }
          : null;
        return { activity, chatMessages: (chatData ?? []) as ChatMessageRow[], achievement };
      });
    },

    async deleteActivity(input: unknown): Promise<ActivityDeleteReceipt> {
      return withActivityErrorBoundary(async () => {
        const parsed = activityDeleteSchema.safeParse(input);
        if (!parsed.success) throw validationError(parsed.error);
        const actorId = await requireActorId();
        const { data, error } = await client.rpc("delete_activity", {
          p_activity_id: parsed.data.activityId,
          p_expected_revision: parsed.data.expectedRevision,
        });
        if (error) {
          const mapped = mapDatabaseError(error);
          if (mapped.code === "CONFLICT") {
            const latestRecord = await readOwnActivity(actorId, parsed.data.activityId);
            if (!latestRecord) throw new ActivityServiceError("NOT_FOUND");
            throw new ActivityServiceError("CONFLICT", { latestRecord });
          }
          throw mapped;
        }
        const receipt = z.object({
          deleted_activity_id: z.uuid(),
          retained_achievement_count: z.number().int().nonnegative(),
          retained_chat_count: z.number().int().nonnegative(),
        }).strict().safeParse(data?.[0]);
        if (!receipt.success || receipt.data.deleted_activity_id !== parsed.data.activityId) throw new ActivityServiceError("NOT_FOUND");
        return {
          deletedActivityId: receipt.data.deleted_activity_id,
          retainedAchievementCount: receipt.data.retained_achievement_count,
          retainedChatCount: receipt.data.retained_chat_count,
        };
      });
    },
  };
}
