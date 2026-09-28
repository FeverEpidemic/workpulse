import * as z from "zod";

import { AI_JOB_KINDS, AI_JOB_STATUSES, type AiJobKind, type AiJobStatus } from "@/domain/ai/contracts";
import {
  AiServiceError,
  mapAiDatabaseError,
  requireAiActorId,
  withAiErrorBoundary,
  type AiClient,
} from "@/features/ai/ai-errors";

export interface AiJobReceipt {
  jobId: string;
  status: AiJobStatus;
  inputRevision: number;
  attemptCount: number;
  errorCode: string | null;
  kind: AiJobKind;
}

export interface AiJobView extends AiJobReceipt {
  activityId: string;
  /** Validated detect.v1 output; applied only through the T14 review action. */
  result: unknown;
  createdAt: string;
  finishedAt: string | null;
}

const receiptSchema = z.object({
  job_id: z.uuid(),
  status: z.enum(AI_JOB_STATUSES),
  input_revision: z.number().int().positive(),
  attempt_count: z.number().int().min(0).max(3),
  error_code: z.string().nullable(),
  kind: z.enum(AI_JOB_KINDS),
}).strict();

const requestSchema = z.object({
  activityId: z.uuid(),
  expectedRevision: z.number().int().positive(),
}).strict();

const retrySchema = z.object({ jobId: z.uuid() }).strict();

// Clients cannot read lease internals (column grants), so select explicit columns only.
const JOB_COLUMNS = "id, activity_id, kind, status, input_revision, attempt_count, error_code, result, created_at, finished_at";

const jobRowSchema = z.object({
  id: z.uuid(),
  activity_id: z.uuid(),
  kind: z.enum(AI_JOB_KINDS),
  status: z.enum(AI_JOB_STATUSES),
  input_revision: z.number().int().positive(),
  attempt_count: z.number().int().min(0).max(3),
  error_code: z.string().nullable(),
  result: z.unknown(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
}).strict();

function toReceipt(data: unknown): AiJobReceipt {
  const parsed = receiptSchema.safeParse(Array.isArray(data) ? data[0] : null);
  if (!parsed.success) throw new AiServiceError("UNAVAILABLE");
  return {
    jobId: parsed.data.job_id,
    status: parsed.data.status,
    inputRevision: parsed.data.input_revision,
    attemptCount: parsed.data.attempt_count,
    errorCode: parsed.data.error_code,
    kind: parsed.data.kind,
  };
}

export function createAiJobService(client: AiClient) {
  return {
    /** Enqueue detection for the owner's activity revision; duplicates return the same job. */
    async requestAnalysis(input: unknown): Promise<AiJobReceipt> {
      return withAiErrorBoundary(async () => {
        const parsed = requestSchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { data, error } = await client.rpc("request_ai_analysis", {
          p_activity_id: parsed.data.activityId,
          p_expected_revision: parsed.data.expectedRevision,
        });
        if (error) throw mapAiDatabaseError(error);
        return toReceipt(data);
      });
    },

    /** Explicit failed -> queued retry of the same revision (max three attempts). */
    async retryJob(input: unknown): Promise<AiJobReceipt> {
      return withAiErrorBoundary(async () => {
        const parsed = retrySchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { data, error } = await client.rpc("retry_ai_job", { p_job_id: parsed.data.jobId });
        if (error) throw mapAiDatabaseError(error);
        return toReceipt(data);
      });
    },

    async getLatestJobForActivity(activityId: string): Promise<AiJobView | null> {
      return withAiErrorBoundary(async () => {
        if (!z.uuid().safeParse(activityId).success) throw new AiServiceError("VALIDATION");
        const actorId = await requireAiActorId(client);
        const { data, error } = await client
          .from("ai_jobs")
          .select(JOB_COLUMNS)
          .eq("user_id", actorId)
          .eq("activity_id", activityId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new AiServiceError("UNAVAILABLE");
        if (!data) return null;
        const row = jobRowSchema.safeParse(data);
        if (!row.success) throw new AiServiceError("UNAVAILABLE");
        return {
          jobId: row.data.id,
          activityId: row.data.activity_id,
          kind: row.data.kind,
          status: row.data.status,
          inputRevision: row.data.input_revision,
          attemptCount: row.data.attempt_count,
          errorCode: row.data.error_code,
          result: row.data.result,
          createdAt: row.data.created_at,
          finishedAt: row.data.finished_at,
        };
      });
    },
  };
}
