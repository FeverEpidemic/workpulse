import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import type { Database } from "@/server/supabase/database.types";

const USER_ID = "3f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const ACTIVITY_ID = "4f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const JOB_ID = "5f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const ACHIEVEMENT_ID = "6f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function rpcClient(rpcResult: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  return { rpc, value: { auth: { getUser }, rpc } as unknown as SupabaseClient<Database> };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiServiceError);
    const aiError = error as AiServiceError;
    expect(aiError.correlationId).toMatch(UUID);
    return { code: aiError.code, messageKey: aiError.messageKey };
  }
  throw new Error("expected rejection");
}

describe("AI review service — answerQuestions", () => {
  it("returns the receipt on success", async () => {
    const { rpc, value } = rpcClient({
      data: [{ activity_revision: 2, job_id: JOB_ID, job_status: "queued" }],
      error: null,
    });
    await expect(createAiReviewService(value).answerQuestions({
      jobId: JOB_ID, expectedRevision: 1, answers: { outcome: "Cut costs by 12 percent" },
    })).resolves.toEqual({ activityRevision: 2, jobId: JOB_ID, jobStatus: "queued" });
    expect(rpc).toHaveBeenCalledWith("answer_ai_questions", {
      p_job_id: JOB_ID, p_expected_revision: 1, p_answers: { outcome: "Cut costs by 12 percent" },
    });
  });

  it("returns a null job when consent is not current", async () => {
    const { value } = rpcClient({ data: [{ activity_revision: 2, job_id: null, job_status: null }], error: null });
    await expect(createAiReviewService(value).answerQuestions({
      jobId: JOB_ID, expectedRevision: 1, answers: { role: "Tech lead" },
    })).resolves.toEqual({ activityRevision: 2, jobId: null, jobStatus: null });
  });

  it.each([
    ["AI_JOB_UNAVAILABLE", "P0001", "NOT_FOUND"],
    ["AI_JOB_NOT_APPLICABLE", "P0001", "AI_JOB_NOT_APPLICABLE"],
    ["STALE_INPUT", "P0001", "STALE_INPUT"],
    ["AI_QUESTIONS_CLOSED", "P0001", "AI_QUESTIONS_CLOSED"],
    ["INVALID_AI_ANSWER", "22023", "VALIDATION"],
    ["IDEMPOTENCY_KEY_REUSED", "22023", "CONFLICT"],
    ["CONSENT_REQUIRED", "P0001", "CONSENT_REQUIRED"],
  ] as const)("maps database %s to %s", async (message, code, expected) => {
    const { value } = rpcClient({ data: null, error: { code, message } });
    expect((await codeOf(createAiReviewService(value).answerQuestions({
      jobId: JOB_ID, expectedRevision: 1, answers: { role: "x" },
    }))).code).toBe(expected);
  });

  it("rejects invalid input before calling the database", async () => {
    const { rpc, value } = rpcClient({ data: null, error: null });
    expect((await codeOf(createAiReviewService(value).answerQuestions({ jobId: JOB_ID, expectedRevision: 1, answers: {} }))).code)
      .toBe("VALIDATION");
    expect((await codeOf(createAiReviewService(value).answerQuestions({
      jobId: JOB_ID, expectedRevision: 1, answers: { role: "a", scope: "b", outcome: "c", extra: "d" },
    }))).code).toBe("VALIDATION");
    expect((await codeOf(createAiReviewService(value).answerQuestions({
      jobId: JOB_ID, expectedRevision: 1, answers: { role: "   " },
    }))).code).toBe("VALIDATION");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("AI review service — skipQuestions / dismissSuggestion", () => {
  it("skipQuestions calls the RPC with the job id and resolves on success", async () => {
    const { rpc, value } = rpcClient({ data: null, error: null });
    await expect(createAiReviewService(value).skipQuestions({ jobId: JOB_ID })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("skip_ai_questions", { p_job_id: JOB_ID });
  });

  it("dismissSuggestion maps AI_SUGGESTION_APPLIED", async () => {
    const { value } = rpcClient({ data: null, error: { code: "P0001", message: "AI_SUGGESTION_APPLIED" } });
    expect((await codeOf(createAiReviewService(value).dismissSuggestion({ jobId: JOB_ID }))).code).toBe("AI_SUGGESTION_APPLIED");
  });

  it("rejects a non-UUID job id before calling the database", async () => {
    const { rpc, value } = rpcClient({ data: null, error: null });
    expect((await codeOf(createAiReviewService(value).skipQuestions({ jobId: "not-a-uuid" }))).code).toBe("VALIDATION");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("AI review service — applySuggestion", () => {
  it("returns the receipt for a create", async () => {
    const { rpc, value } = rpcClient({
      data: [{ achievement_id: ACHIEVEMENT_ID, achievement_revision: 1, created: true }],
      error: null,
    });
    await expect(createAiReviewService(value).applySuggestion({
      jobId: JOB_ID, expectedActivityRevision: 1, expectedAchievementRevision: null,
    })).resolves.toEqual({ achievementId: ACHIEVEMENT_ID, achievementRevision: 1, created: true });
    expect(rpc).toHaveBeenCalledWith("apply_ai_suggestion", {
      p_job_id: JOB_ID, p_expected_activity_revision: 1, p_expected_achievement_revision: null,
    });
  });

  it.each([
    ["ACHIEVEMENT_CONFIRMED", "P0001", "ACHIEVEMENT_CONFIRMED"],
    ["ACHIEVEMENT_DISMISSED", "P0001", "ACHIEVEMENT_DISMISSED"],
    ["DRAFT_EDITED", "P0001", "DRAFT_EDITED"],
    ["AI_SUGGESTION_DISMISSED", "P0001", "AI_SUGGESTION_DISMISSED"],
    ["ACHIEVEMENT_EXISTS", "P0001", "CONFLICT"],
    ["STALE_REVISION", "P0001", "CONFLICT"],
  ] as const)("maps database %s to %s", async (message, code, expected) => {
    const { value } = rpcClient({ data: null, error: { code, message } });
    expect((await codeOf(createAiReviewService(value).applySuggestion({
      jobId: JOB_ID, expectedActivityRevision: 1, expectedAchievementRevision: 1,
    }))).code).toBe(expected);
  });
});

describe("AI review service — getAnalysisView", () => {
  function analysisClient(overrides: {
    activity?: unknown; profile?: unknown; job?: unknown; achievement?: unknown; review?: unknown;
  } = {}) {
    const activity = overrides.activity === undefined
      ? { id: ACTIVITY_ID, revision: 1, role: null, scope: null, outcome: null, raw_text: "Migrated 3 reports" }
      : overrides.activity;
    const profile = overrides.profile === undefined ? { ai_consent_at: "2026-09-27T00:00:00Z", ai_consent_version: "ai-processing-v1" } : overrides.profile;
    const job = overrides.job === undefined ? null : overrides.job;
    const achievement = overrides.achievement === undefined ? null : overrides.achievement;
    const review = overrides.review === undefined ? null : overrides.review;

    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    const from = vi.fn((table: string) => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => {
          if (table === "activities") return { data: activity, error: null };
          if (table === "profiles") return { data: profile, error: null };
          if (table === "ai_jobs") return { data: job, error: null };
          if (table === "achievements") return { data: achievement, error: null };
          if (table === "ai_suggestion_reviews") return { data: review, error: null };
          throw new Error(`unexpected table ${table}`);
        }),
      };
      return chain;
    });
    return { value: { auth: { getUser }, from } as unknown as SupabaseClient<Database> };
  }

  it("returns state none when there is no job", async () => {
    const { value } = analysisClient();
    const result = await createAiReviewService(value).getAnalysisView(ACTIVITY_ID);
    expect(result.view.state).toBe("none");
    expect(result.job).toBeNull();
    expect(result.achievement).toBeNull();
  });

  it("throws NOT_FOUND when the activity does not belong to the caller", async () => {
    const { value } = analysisClient({ activity: null });
    expect((await codeOf(createAiReviewService(value).getAnalysisView(ACTIVITY_ID))).code).toBe("NOT_FOUND");
  });

  it("re-validates a stored succeeded result and surfaces it as a suggestion", async () => {
    const { value } = analysisClient({
      job: {
        id: JOB_ID, kind: "detect", status: "succeeded", input_revision: 1, attempt_count: 1, error_code: null,
        result: {
          schema_version: "detect.v1", potential: true,
          suggestion: {
            title: "Migrated 3 reports", contribution: "Led the migration", outcome: "Reduced manual steps",
            role: null, scope: null, cv_bullet: "Migrated 3 reports", metrics: [], skills: [],
          },
          questions: [],
        },
      },
    });
    const result = await createAiReviewService(value).getAnalysisView(ACTIVITY_ID);
    expect(result.view.state).toBe("suggestion");
    expect(result.job?.result?.suggestion?.title).toBe("Migrated 3 reports");
    expect(result.view.canApply).toBe(true);
  });

  it("treats a stored result with a fabricated number as invalid (AI_OUTPUT_INVALID equivalent: failed state)", async () => {
    const { value } = analysisClient({
      job: {
        id: JOB_ID, kind: "detect", status: "succeeded", input_revision: 1, attempt_count: 1, error_code: null,
        result: {
          schema_version: "detect.v1", potential: true,
          suggestion: {
            title: "Migrated 40 reports", contribution: "Led the migration", outcome: "Reduced manual steps",
            role: null, scope: null, cv_bullet: "Migrated 40 reports", metrics: [], skills: [],
          },
          questions: [],
        },
      },
    });
    const result = await createAiReviewService(value).getAnalysisView(ACTIVITY_ID);
    expect(result.job?.result).toBeNull();
    expect(result.view.state).toBe("failed");
  });

  it("rejects a non-UUID activity id before calling the database", async () => {
    const { value } = analysisClient();
    expect((await codeOf(createAiReviewService(value).getAnalysisView("not-a-uuid"))).code).toBe("VALIDATION");
  });
});
