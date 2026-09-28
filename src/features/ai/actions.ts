"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";

const consentFormSchema = z.object({
  consent: z.enum(["allow", "withdraw"]),
  expected_revision: z.coerce.number().int().positive(),
}).strict();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function revalidateAnalysisPaths(activityId: string, achievementId?: string): void {
  revalidatePath(`/activity/${activityId}`);
  revalidatePath("/achievements");
  if (achievementId) revalidatePath(`/achievements/${achievementId}`);
}

function mapAiErrorCode(code: AiServiceError["code"]): ErrorCode {
  switch (code) {
    case "VALIDATION": return "VALIDATION";
    case "UNAUTHENTICATED": return "UNAUTHENTICATED";
    case "NOT_FOUND": return "NOT_FOUND";
    case "UNAVAILABLE": return "UNAVAILABLE";
    default: return "CONFLICT";
  }
}

/** Shared failure path for every AI review action: an AiServiceError maps to the generic ActionState envelope; anything else is UNAVAILABLE. */
function aiActionFailure(error: unknown): ActionState {
  if (!(error instanceof AiServiceError)) return actionFailure("UNAVAILABLE", "error.unavailable");
  return actionFailure(mapAiErrorCode(error.code), error.messageKey);
}

/** S12 AI processing consent: grant the current version or withdraw for future requests. */
export async function setAiConsentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = consentFormSchema.safeParse({
    consent: text(formData, "consent"),
    expected_revision: text(formData, "expected_revision"),
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");

  try {
    const client = await createSupabaseServerClient();
    const consented = parsed.data.consent === "allow";
    const state = await createAiConsentService(client).setConsent({
      expectedRevision: parsed.data.expected_revision,
      consented,
    });
    revalidatePath("/settings/profile");
    return actionSuccess(consented ? "ai.consent.allowed" : "ai.consent.withdrawn", state);
  } catch (error) {
    if (!(error instanceof AiServiceError)) return actionFailure("UNAVAILABLE", "error.unavailable");
    switch (error.code) {
      case "UNAUTHENTICATED":
        return actionFailure("UNAUTHENTICATED", error.messageKey);
      case "CONFLICT":
        return actionFailure("CONFLICT", "ai.consent.conflict");
      case "VALIDATION":
        return actionFailure("VALIDATION", error.messageKey);
      default:
        return actionFailure("UNAVAILABLE", "error.unavailable");
    }
  }
}

const requestAnalysisFormSchema = z.object({
  activity_id: z.uuid(),
  expected_revision: z.coerce.number().int().positive(),
}).strict();

/** S06 "Analyze with AI": enqueue detect for the current activity revision. */
export async function requestAnalysisAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = requestAnalysisFormSchema.safeParse({
    activity_id: text(formData, "activity_id"),
    expected_revision: text(formData, "expected_revision"),
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createAiJobService(client).requestAnalysis({
      activityId: parsed.data.activity_id, expectedRevision: parsed.data.expected_revision,
    });
    revalidateAnalysisPaths(parsed.data.activity_id);
    return actionSuccess("ai.analysis.requested", receipt);
  } catch (error) {
    return aiActionFailure(error);
  }
}

const retryFormSchema = z.object({ activity_id: z.uuid(), job_id: z.uuid() }).strict();

/** S06 "Retry": explicit failed -> queued retry of the same job. */
export async function retryAnalysisAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = retryFormSchema.safeParse({ activity_id: text(formData, "activity_id"), job_id: text(formData, "job_id") });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const client = await createSupabaseServerClient();
    const receipt = await createAiJobService(client).retryJob({ jobId: parsed.data.job_id });
    revalidateAnalysisPaths(parsed.data.activity_id);
    return actionSuccess("ai.analysis.retried", receipt);
  } catch (error) {
    return aiActionFailure(error);
  }
}

const answerFormSchema = z.object({
  activity_id: z.uuid(),
  job_id: z.uuid(),
  expected_revision: z.coerce.number().int().positive(),
  answer_role: z.string().optional(),
  answer_scope: z.string().optional(),
  answer_outcome: z.string().optional(),
}).strict();

/** S08 "Answer": submit 1-3 follow-up answers for the fields the job asked about. */
export async function answerQuestionsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = answerFormSchema.safeParse({
    activity_id: text(formData, "activity_id"),
    job_id: text(formData, "job_id"),
    expected_revision: text(formData, "expected_revision"),
    answer_role: formData.has("answer_role") ? text(formData, "answer_role") : undefined,
    answer_scope: formData.has("answer_scope") ? text(formData, "answer_scope") : undefined,
    answer_outcome: formData.has("answer_outcome") ? text(formData, "answer_outcome") : undefined,
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");

  const answers: Record<string, string> = {};
  if (parsed.data.answer_role?.trim()) answers.role = parsed.data.answer_role;
  if (parsed.data.answer_scope?.trim()) answers.scope = parsed.data.answer_scope;
  if (parsed.data.answer_outcome?.trim()) answers.outcome = parsed.data.answer_outcome;
  if (Object.keys(answers).length === 0) return actionFailure("VALIDATION", "error.validation");

  try {
    const client = await createSupabaseServerClient();
    const receipt = await createAiReviewService(client).answerQuestions({
      jobId: parsed.data.job_id, expectedRevision: parsed.data.expected_revision, answers,
    });
    revalidateAnalysisPaths(parsed.data.activity_id);
    return actionSuccess("ai.review.answered", receipt);
  } catch (error) {
    return aiActionFailure(error);
  }
}

const jobActionFormSchema = z.object({ activity_id: z.uuid(), job_id: z.uuid() }).strict();

/** S08 "Skip questions": record that follow-up questions were skipped for this revision. */
export async function skipQuestionsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = jobActionFormSchema.safeParse({ activity_id: text(formData, "activity_id"), job_id: text(formData, "job_id") });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const client = await createSupabaseServerClient();
    await createAiReviewService(client).skipQuestions({ jobId: parsed.data.job_id });
    revalidateAnalysisPaths(parsed.data.activity_id);
    return actionSuccess("ai.review.questionsSkipped");
  } catch (error) {
    return aiActionFailure(error);
  }
}

/** S06 "Dismiss suggestion": suppress the suggestion for this job's revision. */
export async function dismissSuggestionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = jobActionFormSchema.safeParse({ activity_id: text(formData, "activity_id"), job_id: text(formData, "job_id") });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const client = await createSupabaseServerClient();
    await createAiReviewService(client).dismissSuggestion({ jobId: parsed.data.job_id });
    revalidateAnalysisPaths(parsed.data.activity_id);
    return actionSuccess("ai.review.dismissed");
  } catch (error) {
    return aiActionFailure(error);
  }
}

const applyFormSchema = z.object({
  activity_id: z.uuid(),
  job_id: z.uuid(),
  expected_activity_revision: z.coerce.number().int().positive(),
  expected_achievement_revision: z.string().optional(),
}).strict();

/** S06 "Review as draft": create or refresh a draft Achievement from a succeeded suggestion. */
export async function applySuggestionAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = applyFormSchema.safeParse({
    activity_id: text(formData, "activity_id"),
    job_id: text(formData, "job_id"),
    expected_activity_revision: text(formData, "expected_activity_revision"),
    expected_achievement_revision: formData.has("expected_achievement_revision")
      ? text(formData, "expected_achievement_revision") : undefined,
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  const rawRevision = parsed.data.expected_achievement_revision?.trim();
  const expectedAchievementRevision = rawRevision ? Number(rawRevision) : null;
  if (expectedAchievementRevision !== null && (!Number.isInteger(expectedAchievementRevision) || expectedAchievementRevision < 1)) {
    return actionFailure("VALIDATION", "error.validation");
  }

  try {
    const client = await createSupabaseServerClient();
    const receipt = await createAiReviewService(client).applySuggestion({
      jobId: parsed.data.job_id,
      expectedActivityRevision: parsed.data.expected_activity_revision,
      expectedAchievementRevision,
    });
    revalidateAnalysisPaths(parsed.data.activity_id, receipt.achievementId);
    return actionSuccess("ai.review.applied", receipt);
  } catch (error) {
    return aiActionFailure(error);
  }
}
