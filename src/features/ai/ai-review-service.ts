import * as z from "zod";

import { AI_JOB_KINDS, AI_JOB_STATUSES, type AiJobKind, type AiJobStatus } from "@/domain/ai/contracts";
import {
  toAnalysisView,
  type AnalysisView,
  type AnalysisViewAchievement,
  type AnalysisViewJob,
  type AnalysisViewReview,
} from "@/domain/ai/analysis-view";
import { validateDetectResult, type DetectResult } from "@/domain/ai/detect-result";
import { buildDetectInput } from "@/domain/ai/minimize";
import {
  AiServiceError,
  mapAiDatabaseError,
  requireAiActorId,
  withAiErrorBoundary,
  type AiClient,
} from "@/features/ai/ai-errors";
import { hasCurrentAiConsent } from "@/features/ai/consent-service";

export interface AnswerQuestionsReceipt {
  activityRevision: number;
  jobId: string | null;
  jobStatus: AiJobStatus | null;
}

export interface ApplySuggestionReceipt {
  achievementId: string;
  achievementRevision: number;
  created: boolean;
}

export interface AnalysisViewPayload {
  activityRevision: number;
  job: AnalysisViewJob | null;
  achievement: AnalysisViewAchievement | null;
  view: AnalysisView;
}

const jobIdSchema = z.object({ jobId: z.uuid() }).strict();

const answersSchema = z.object({
  role: z.string().trim().min(1).optional(),
  scope: z.string().trim().min(1).optional(),
  outcome: z.string().trim().min(1).optional(),
}).strict();
const answerSchema = z.object({
  jobId: z.uuid(),
  expectedRevision: z.number().int().positive(),
  answers: answersSchema,
}).strict()
  .refine((value) => {
    const keys = Object.keys(value.answers);
    return keys.length >= 1 && keys.length <= 3;
  }, { message: "invalid_answer_count" });

const applySchema = z.object({
  jobId: z.uuid(),
  expectedActivityRevision: z.number().int().positive(),
  expectedAchievementRevision: z.number().int().positive().nullable(),
}).strict();

const answerReceiptSchema = z.object({
  activity_revision: z.number().int().positive(),
  job_id: z.uuid().nullable(),
  job_status: z.enum(AI_JOB_STATUSES).nullable(),
}).strict();

const applyReceiptSchema = z.object({
  achievement_id: z.uuid(),
  achievement_revision: z.number().int().positive(),
  created: z.boolean(),
}).strict();

const REVIEW_JOB_COLUMNS = "id, kind, status, input_revision, attempt_count, error_code, result";

const reviewJobRowSchema = z.object({
  id: z.uuid(),
  kind: z.enum(AI_JOB_KINDS),
  status: z.enum(AI_JOB_STATUSES),
  input_revision: z.number().int().positive(),
  attempt_count: z.number().int().min(0).max(3),
  error_code: z.string().nullable(),
  result: z.unknown(),
}).strict();

const reviewSchema = z.object({
  state: z.enum(["open", "dismissed", "applied"]),
  questions_skipped_at: z.string().nullable(),
  answered_at: z.string().nullable(),
  applied_achievement_id: z.uuid().nullable(),
  applied_achievement_revision: z.number().int().positive().nullable(),
}).strict();

const reviewActivityRowSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  role: z.string().nullable(),
  scope: z.string().nullable(),
  outcome: z.string().nullable(),
  raw_text: z.string(),
}).strict();

const reviewAchievementRowSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(["draft", "confirmed", "dismissed"]),
}).strict();

export function createAiReviewService(client: AiClient) {
  return {
    /** Writes 1-3 still-empty fields the job asked about; enqueues one refine job when consent is current. */
    async answerQuestions(input: unknown): Promise<AnswerQuestionsReceipt> {
      return withAiErrorBoundary(async () => {
        const parsed = answerSchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { data, error } = await client.rpc("answer_ai_questions", {
          p_job_id: parsed.data.jobId,
          p_expected_revision: parsed.data.expectedRevision,
          p_answers: parsed.data.answers,
        });
        if (error) throw mapAiDatabaseError(error);
        const row = answerReceiptSchema.safeParse(Array.isArray(data) ? data[0] : null);
        if (!row.success) throw new AiServiceError("UNAVAILABLE");
        return { activityRevision: row.data.activity_revision, jobId: row.data.job_id, jobStatus: row.data.job_status };
      });
    },

    /** Records that follow-up questions were skipped for this job's revision. No consent required. */
    async skipQuestions(input: unknown): Promise<void> {
      return withAiErrorBoundary(async () => {
        const parsed = jobIdSchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { error } = await client.rpc("skip_ai_questions", { p_job_id: parsed.data.jobId });
        if (error) throw mapAiDatabaseError(error);
      });
    },

    /** Suppresses the suggestion for this job's revision. No consent required. */
    async dismissSuggestion(input: unknown): Promise<void> {
      return withAiErrorBoundary(async () => {
        const parsed = jobIdSchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { error } = await client.rpc("dismiss_ai_suggestion", { p_job_id: parsed.data.jobId });
        if (error) throw mapAiDatabaseError(error);
      });
    },

    /** Creates or refreshes a draft Achievement from a succeeded, potential suggestion. Never confirms. */
    async applySuggestion(input: unknown): Promise<ApplySuggestionReceipt> {
      return withAiErrorBoundary(async () => {
        const parsed = applySchema.safeParse(input);
        if (!parsed.success) throw new AiServiceError("VALIDATION");
        await requireAiActorId(client);
        const { data, error } = await client.rpc("apply_ai_suggestion", {
          p_job_id: parsed.data.jobId,
          p_expected_activity_revision: parsed.data.expectedActivityRevision,
          p_expected_achievement_revision: parsed.data.expectedAchievementRevision as unknown as number,
        });
        if (error) throw mapAiDatabaseError(error);
        const row = applyReceiptSchema.safeParse(Array.isArray(data) ? data[0] : null);
        if (!row.success) throw new AiServiceError("UNAVAILABLE");
        return { achievementId: row.data.achievement_id, achievementRevision: row.data.achievement_revision, created: row.data.created };
      });
    },

    /**
     * Assembles the S06/S08 view model: the activity's latest job (re-validated against the
     * current strict validator, never trusting a stored result blindly), its review row, the
     * derived Achievement (if any) with its own apply provenance, and current consent. Never
     * returns raw_text; it is used only internally to re-validate grounding.
     */
    async getAnalysisView(activityId: unknown): Promise<AnalysisViewPayload> {
      return withAiErrorBoundary(async () => {
        const activityIdParsed = z.uuid().safeParse(activityId);
        if (!activityIdParsed.success) throw new AiServiceError("VALIDATION");
        const id = activityIdParsed.data;
        const actorId = await requireAiActorId(client);

        const [activityResult, profileResult, jobResult, achievementResult] = await Promise.all([
          client.from("activities").select("id, revision, role, scope, outcome, raw_text")
            .eq("user_id", actorId).eq("id", id).maybeSingle(),
          client.from("profiles").select("ai_consent_at, ai_consent_version").eq("id", actorId).maybeSingle(),
          client.from("ai_jobs").select(REVIEW_JOB_COLUMNS)
            .eq("user_id", actorId).eq("activity_id", id)
            .order("created_at", { ascending: false }).order("id", { ascending: false })
            .limit(1).maybeSingle(),
          client.from("achievements").select("id, revision, status")
            .eq("user_id", actorId).eq("activity_id", id).maybeSingle(),
        ]);
        if (activityResult.error || profileResult.error || jobResult.error || achievementResult.error) {
          throw new AiServiceError("UNAVAILABLE");
        }
        if (!activityResult.data) throw new AiServiceError("NOT_FOUND");

        const activityRow = reviewActivityRowSchema.safeParse(activityResult.data);
        if (!activityRow.success) throw new AiServiceError("UNAVAILABLE");

        const consent = hasCurrentAiConsent(profileResult.data ?? { ai_consent_at: null, ai_consent_version: null });

        let job: AnalysisViewJob | null = null;
        let review: AnalysisViewReview | null = null;
        if (jobResult.data) {
          const jobRow = reviewJobRowSchema.safeParse(jobResult.data);
          if (!jobRow.success) throw new AiServiceError("UNAVAILABLE");

          let result: DetectResult | null = null;
          if (jobRow.data.status === "succeeded" && jobRow.data.result !== null) {
            const detectInput = buildDetectInput({
              raw_text: activityRow.data.raw_text,
              role: activityRow.data.role,
              scope: activityRow.data.scope,
              outcome: activityRow.data.outcome,
              locale: "en",
            });
            const validation = validateDetectResult(jobRow.data.result, detectInput, { kind: jobRow.data.kind });
            result = validation.ok ? validation.result : null;
          }
          job = {
            id: jobRow.data.id,
            kind: jobRow.data.kind,
            status: jobRow.data.status,
            inputRevision: jobRow.data.input_revision,
            attemptCount: jobRow.data.attempt_count,
            errorCode: jobRow.data.error_code,
            result,
          };

          const { data: reviewData, error: reviewError } = await client
            .from("ai_suggestion_reviews")
            .select("state, questions_skipped_at, answered_at, applied_achievement_id, applied_achievement_revision")
            .eq("user_id", actorId).eq("activity_id", id).eq("activity_revision", jobRow.data.input_revision)
            .maybeSingle();
          if (reviewError) throw new AiServiceError("UNAVAILABLE");
          if (reviewData) {
            const reviewRow = reviewSchema.safeParse(reviewData);
            if (!reviewRow.success) throw new AiServiceError("UNAVAILABLE");
            review = {
              state: reviewRow.data.state,
              questionsSkippedAt: reviewRow.data.questions_skipped_at,
              answeredAt: reviewRow.data.answered_at,
              appliedAchievementId: reviewRow.data.applied_achievement_id,
              appliedAchievementRevision: reviewRow.data.applied_achievement_revision,
            };
          }
        }

        let achievement: AnalysisViewAchievement | null = null;
        if (achievementResult.data) {
          const achievementRow = reviewAchievementRowSchema.safeParse(achievementResult.data);
          if (!achievementRow.success) throw new AiServiceError("UNAVAILABLE");

          const { data: appliedReviewData, error: appliedReviewError } = await client
            .from("ai_suggestion_reviews")
            .select("applied_achievement_revision")
            .eq("user_id", actorId).eq("activity_id", id).eq("applied_achievement_id", achievementRow.data.id)
            .order("activity_revision", { ascending: false })
            .limit(1).maybeSingle();
          if (appliedReviewError) throw new AiServiceError("UNAVAILABLE");
          const appliedRow = z.object({ applied_achievement_revision: z.number().int().positive().nullable() })
            .safeParse(appliedReviewData);
          achievement = {
            id: achievementRow.data.id,
            revision: achievementRow.data.revision,
            status: achievementRow.data.status,
            appliedRevision: appliedRow.success ? appliedRow.data.applied_achievement_revision : null,
          };
        }

        const view = toAnalysisView({
          activity: {
            revision: activityRow.data.revision,
            role: activityRow.data.role,
            scope: activityRow.data.scope,
            outcome: activityRow.data.outcome,
          },
          job,
          review,
          consent,
          derivedAchievement: achievement,
        });

        return { activityRevision: activityRow.data.revision, job, achievement, view };
      });
    },
  };
}

export type { AiJobKind };
