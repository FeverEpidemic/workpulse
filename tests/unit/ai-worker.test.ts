import { describe, expect, it, vi } from "vitest";

import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
import type { AIProvider } from "@/server/ai/provider";

import { runAiWorkerOnce, type AiJobClaim, type AiWorkerDatabase } from "../../workers/ai-worker.ts";

const SENTINEL = "WP-PRIVATE-SENTINEL-worker";
const job: AiJobClaim = {
  id: "0f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f",
  user_id: "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f",
  kind: "detect",
  input_revision: 1,
  attempt_count: 1,
  attempt_token: "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f",
};
const source = { raw_text: `${SENTINEL} migrated 3 reports`, role: null, scope: null, outcome: null, locale: "en", input_revision: 1 };

function harness(overrides: Partial<AiWorkerDatabase> = {}) {
  const database = {
    expireAiJobLeases: vi.fn(async () => 0),
    claimAiJobs: vi.fn(async () => [job]),
    getAiJobInput: vi.fn(async () => source),
    completeAiJob: vi.fn(async () => "succeeded"),
    failAiJob: vi.fn(async () => true),
    ...overrides,
  } satisfies AiWorkerDatabase;
  return database;
}

describe("AI worker", () => {
  it("claims, sends minimized input and stores a validated result", async () => {
    const database = harness();
    const provider = new ExplicitTestFakeAIProvider("valid");

    const summary = await runAiWorkerOnce({ database, provider });

    expect(summary).toEqual({ aiExpiredLeases: 0, aiJobsClaimed: 1, aiSucceeded: 1, aiFailed: {}, aiStale: 0, aiSkipped: 0 });
    expect(provider.calls).toEqual([{ locale: "en", raw_text: source.raw_text, role: null, scope: null, outcome: null }]);
    const stored = vi.mocked(database.completeAiJob).mock.calls[0]?.[2];
    expect(stored?.schema_version).toBe("detect.v1");
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
  });

  it("does not call the provider when the database withholds input", async () => {
    const database = harness({ getAiJobInput: vi.fn(async () => null) });
    const provider = new ExplicitTestFakeAIProvider("valid");

    const summary = await runAiWorkerOnce({ database, provider });

    expect(summary.aiSkipped).toBe(1);
    expect(provider.calls).toHaveLength(0);
    expect(database.completeAiJob).not.toHaveBeenCalled();
  });

  it.each([
    ["refusal", "AI_REFUSED"],
    ["unavailable", "AI_PROVIDER_UNAVAILABLE"],
    ["malformed", "AI_OUTPUT_INVALID"],
    ["ungrounded", "AI_OUTPUT_INVALID"],
  ] as const)("fails the job with a stable code for %s output", async (scenario, code) => {
    const database = harness();
    const summary = await runAiWorkerOnce({ database, provider: new ExplicitTestFakeAIProvider(scenario) });

    expect(database.failAiJob).toHaveBeenCalledWith(job.id, job.attempt_token, code);
    expect(database.completeAiJob).not.toHaveBeenCalled();
    expect(summary.aiFailed).toEqual({ [code]: 1 });
  });

  it("maps a provider timeout to AI_PROVIDER_TIMEOUT", async () => {
    const database = harness();
    const summary = await runAiWorkerOnce({ database, provider: new ExplicitTestFakeAIProvider("slow"), providerTimeoutMs: 20 });
    expect(summary.aiFailed).toEqual({ AI_PROVIDER_TIMEOUT: 1 });
  });

  it("treats a throwing provider as unavailable without leaking the error", async () => {
    const database = harness();
    const provider: AIProvider = {
      kind: "openai",
      detect: vi.fn(async () => { throw new Error(SENTINEL); }),
      extractImport: vi.fn(async () => { throw new Error(SENTINEL); }),
    };
    const summary = await runAiWorkerOnce({ database, provider });
    expect(summary.aiFailed).toEqual({ AI_PROVIDER_UNAVAILABLE: 1 });
    expect(JSON.stringify(summary)).not.toContain(SENTINEL);
  });

  it("counts late completions and lost leases as stale", async () => {
    const lateComplete = harness({ completeAiJob: vi.fn(async () => "stale") });
    expect((await runAiWorkerOnce({ database: lateComplete, provider: new ExplicitTestFakeAIProvider() })).aiStale).toBe(1);

    const lateFail = harness({ failAiJob: vi.fn(async () => false) });
    expect((await runAiWorkerOnce({ database: lateFail, provider: new ExplicitTestFakeAIProvider("refusal") })).aiStale).toBe(1);
  });

  it("records database-side completion failures by code", async () => {
    const database = harness({ completeAiJob: vi.fn(async () => "failed:CONSENT_WITHDRAWN") });
    expect((await runAiWorkerOnce({ database, provider: new ExplicitTestFakeAIProvider() })).aiFailed).toEqual({ CONSENT_WITHDRAWN: 1 });
  });

  it("skips malformed claims without contacting the provider", async () => {
    const database = harness({ claimAiJobs: vi.fn(async () => [{ ...job, attempt_token: "not-a-uuid" }]) });
    const provider = new ExplicitTestFakeAIProvider();
    const summary = await runAiWorkerOnce({ database, provider });
    expect(summary.aiStale).toBe(1);
    expect(database.getAiJobInput).not.toHaveBeenCalled();
    expect(provider.calls).toHaveLength(0);
  });

  it("treats an unknown kind as stale without contacting the provider", async () => {
    const database = harness({ claimAiJobs: vi.fn(async () => [{ ...job, kind: "import" }]) });
    const provider = new ExplicitTestFakeAIProvider();
    const summary = await runAiWorkerOnce({ database, provider });
    expect(summary.aiStale).toBe(1);
    expect(provider.calls).toHaveLength(0);
  });

  it("claims and processes a valid refine job, passing kind to the provider and validator", async () => {
    const refineJob = { ...job, kind: "refine" };
    const database = harness({ claimAiJobs: vi.fn(async () => [refineJob]) });
    const provider = new ExplicitTestFakeAIProvider("valid");
    const detectSpy = vi.spyOn(provider, "detect");

    const summary = await runAiWorkerOnce({ database, provider });

    expect(summary.aiSucceeded).toBe(1);
    expect(detectSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "refine");
    const stored = vi.mocked(database.completeAiJob).mock.calls[0]?.[2];
    expect(stored?.questions).toEqual([]);
  });

  it("rejects a refine job whose result carries questions as AI_OUTPUT_INVALID", async () => {
    const refineJob = { ...job, kind: "refine" };
    const database = harness({ claimAiJobs: vi.fn(async () => [refineJob]) });
    const summary = await runAiWorkerOnce({ database, provider: new ExplicitTestFakeAIProvider("many_questions") });
    expect(summary.aiFailed).toEqual({ AI_OUTPUT_INVALID: 1 });
    expect(database.completeAiJob).not.toHaveBeenCalled();
  });

  it("propagates gateway failures to the caller", async () => {
    const database = harness({ claimAiJobs: vi.fn(async () => { throw new Error("WORKER_BACKEND_UNAVAILABLE"); }) });
    await expect(runAiWorkerOnce({ database, provider: new ExplicitTestFakeAIProvider() })).rejects.toThrow("WORKER_BACKEND_UNAVAILABLE");
  });
});
