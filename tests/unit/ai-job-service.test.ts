import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiConsentService, hasCurrentAiConsent } from "@/features/ai/consent-service";
import type { Database } from "@/server/supabase/database.types";

const USER_ID = "3f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const ACTIVITY_ID = "4f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const JOB_ID = "5f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function client(rpcResult: { data: unknown; error: unknown }, user: unknown = { id: USER_ID }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const getUser = vi.fn().mockResolvedValue({ data: { user }, error: null });
  return { rpc, value: { auth: { getUser }, rpc } as unknown as SupabaseClient<Database> };
}

async function codeOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiServiceError);
    const aiError = error as AiServiceError;
    expect(aiError.correlationId).toMatch(UUID);
    expect(aiError.message).not.toMatch(/SENTINEL/);
    return { code: aiError.code, messageKey: aiError.messageKey };
  }
  throw new Error("expected rejection");
}

describe("AI job service", () => {
  it("returns the job receipt from request_ai_analysis", async () => {
    const { rpc, value } = client({
      data: [{ job_id: JOB_ID, status: "queued", input_revision: 2, attempt_count: 0, error_code: null }],
      error: null,
    });
    await expect(createAiJobService(value).requestAnalysis({ activityId: ACTIVITY_ID, expectedRevision: 2 })).resolves.toEqual({
      jobId: JOB_ID,
      status: "queued",
      inputRevision: 2,
      attemptCount: 0,
      errorCode: null,
    });
    expect(rpc).toHaveBeenCalledWith("request_ai_analysis", { p_activity_id: ACTIVITY_ID, p_expected_revision: 2 });
  });

  it.each([
    ["CONSENT_REQUIRED", "P0001", "CONSENT_REQUIRED", "error.consentRequired"],
    ["STALE_INPUT", "P0001", "STALE_INPUT", "error.staleInput"],
    ["ACTIVITY_UNAVAILABLE", "P0001", "NOT_FOUND", "error.notFound"],
    ["AI_JOB_UNAVAILABLE", "P0001", "NOT_FOUND", "error.notFound"],
    ["AI_RETRY_EXHAUSTED", "P0001", "RETRY_EXHAUSTED", "error.aiRetryExhausted"],
    ["AI_JOB_NOT_RETRYABLE", "P0001", "CONFLICT", "error.conflict"],
    ["IDEMPOTENCY_KEY_REUSED", "22023", "CONFLICT", "error.conflict"],
    ["AUTH_REQUIRED", "42501", "UNAUTHENTICATED", "auth.signInRequired"],
    ["INVALID_AI_REQUEST", "22023", "VALIDATION", "error.validation"],
    ["WP-PRIVATE-SENTINEL", "XX000", "UNAVAILABLE", "error.unavailable"],
  ])("maps database %s to %s", async (message, code, expected, messageKey) => {
    const { value } = client({ data: null, error: { code, message } });
    expect(await codeOf(createAiJobService(value).retryJob({ jobId: JOB_ID }))).toEqual({ code: expected, messageKey });
  });

  it("rejects invalid input before calling the database", async () => {
    const { rpc, value } = client({ data: null, error: null });
    expect((await codeOf(createAiJobService(value).requestAnalysis({ activityId: "x", expectedRevision: 0 }))).code).toBe("VALIDATION");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a missing session to UNAUTHENTICATED", async () => {
    const { value } = client({ data: null, error: null }, null);
    expect((await codeOf(createAiJobService(value).requestAnalysis({ activityId: ACTIVITY_ID, expectedRevision: 1 }))).code)
      .toBe("UNAUTHENTICATED");
  });

  it("treats a malformed receipt as unavailable", async () => {
    const { value } = client({ data: [{ job_id: "nope" }], error: null });
    expect((await codeOf(createAiJobService(value).requestAnalysis({ activityId: ACTIVITY_ID, expectedRevision: 1 }))).code)
      .toBe("UNAVAILABLE");
  });
});

describe("AI consent service", () => {
  it("grants the current version", async () => {
    const { rpc, value } = client({
      data: [{ revision: 4, ai_consent_at: "2026-09-27T01:00:00Z", ai_consent_version: "ai-processing-v1" }],
      error: null,
    });
    await expect(createAiConsentService(value).setConsent({ expectedRevision: 3, consented: true })).resolves.toEqual({
      revision: 4,
      aiConsentAt: "2026-09-27T01:00:00Z",
      aiConsentVersion: "ai-processing-v1",
    });
    expect(rpc).toHaveBeenCalledWith("set_ai_consent", { p_expected_revision: 3, p_consented: true });
  });

  it("maps a stale profile revision to CONFLICT", async () => {
    const { value } = client({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    expect((await codeOf(createAiConsentService(value).setConsent({ expectedRevision: 1, consented: false }))).code).toBe("CONFLICT");
  });

  it("refuses an inconsistent database answer", async () => {
    const { value } = client({ data: [{ revision: 2, ai_consent_at: null, ai_consent_version: null }], error: null });
    expect((await codeOf(createAiConsentService(value).setConsent({ expectedRevision: 1, consented: true }))).code).toBe("UNAVAILABLE");
  });

  it("recognizes only the current consent version", () => {
    expect(hasCurrentAiConsent({ ai_consent_at: "2026-09-27T01:00:00Z", ai_consent_version: "ai-processing-v1" })).toBe(true);
    expect(hasCurrentAiConsent({ ai_consent_at: "2026-09-27T01:00:00Z", ai_consent_version: "ai-processing-v0" })).toBe(false);
    expect(hasCurrentAiConsent({ ai_consent_at: null, ai_consent_version: null })).toBe(false);
  });
});
