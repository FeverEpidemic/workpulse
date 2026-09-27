import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { DetectInput } from "@/domain/ai/minimize";
import { detectResultSchema } from "@/domain/ai/detect-result";
import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { ExplicitTestFakeAIProvider, type FakeAIScenario } from "@/server/ai/fake-provider";
import { OpenAIProvider } from "@/server/ai/openai-provider";
import { UnavailableAIProvider, type AIProvider } from "@/server/ai/provider";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAiWorkerOnce, type AiWorkerSummary } from "../../workers/ai-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { startOpenAIStub, type OpenAIStub } from "./openai-stub";

const execFileAsync = promisify(execFile);
const FAKE_KEY = "sk-test-WP-SENTINEL-KEY";

type Account = {
  id: string;
  client: SupabaseClient<Database>;
  activities: ReturnType<typeof createActivityService>;
  achievements: ReturnType<typeof createAchievementService>;
  jobs: ReturnType<typeof createAiJobService>;
  consent: ReturnType<typeof createAiConsentService>;
};

let admin: SupabaseClient<Database>;
let adminConfig: { url: string; secretKey: string };
let gateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let ownerA: Account;
let ownerB: Account;
let stub: OpenAIStub;
const users: string[] = [];

async function createAccount(label: string): Promise<Account> {
  const pub = getSupabasePublicConfig();
  if (!pub) throw new Error("Local Supabase environment required");
  const email = `ai-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("AI fixture creation failed");
  users.push(created.data.user.id);
  const client = createClient<Database>(pub.url, pub.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("AI fixture sign-in failed");
  return {
    id: created.data.user.id,
    client,
    activities: createActivityService(client),
    achievements: createAchievementService(client),
    jobs: createAiJobService(client),
    consent: createAiConsentService(client),
  };
}

async function profileRevision(account: Account): Promise<number> {
  const { data, error } = await account.client.from("profiles").select("revision").eq("id", account.id).single();
  if (error || !data) throw new Error("profile unavailable");
  return data.revision;
}

async function setConsent(account: Account, consented: boolean) {
  return account.consent.setConsent({ expectedRevision: await profileRevision(account), consented });
}

async function note(account: Account, rawText: string, extra: { role?: string; outcome?: string; captureMode?: "note" | "chat" } = {}) {
  return account.activities.createActivity({
    operationKey: randomUUID(),
    captureMode: extra.captureMode ?? "note",
    rawText,
    occurredOn: "2026-09-20",
    role: extra.role ?? null,
    scope: null,
    outcome: extra.outcome ?? null,
    experienceId: null,
    projectId: null,
  });
}

async function activityRow(account: Account, activityId: string) {
  return (await account.activities.getActivity(activityId)).activity;
}

async function editNote(account: Account, activityId: string, rawText: string) {
  const current = await activityRow(account, activityId);
  return account.activities.updateActivity({
    activityId,
    expectedRevision: current.revision,
    rawText,
    occurredOn: current.occurred_on,
    role: current.role,
    scope: current.scope,
    outcome: current.outcome,
    experienceId: current.experience_id,
    projectId: current.project_id,
  });
}

async function jobRow(jobId: string) {
  const { data, error } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
  if (error || !data) throw new Error("job unavailable");
  return data;
}

function fake(scenario: FakeAIScenario = "valid", onDetect?: (input: DetectInput) => Promise<void> | void) {
  return new ExplicitTestFakeAIProvider(scenario, onDetect);
}

async function drain(provider: AIProvider, providerTimeoutMs?: number): Promise<AiWorkerSummary[]> {
  const summaries: AiWorkerSummary[] = [];
  for (let n = 0; n < 50; n++) {
    const summary = await runAiWorkerOnce({ database: gateway, provider, providerTimeoutMs });
    if (!summary.aiJobsClaimed && !summary.aiExpiredLeases) return summaries;
    summaries.push(summary);
  }
  throw new Error("AI queue did not drain");
}

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiServiceError) return error.code;
    throw error;
  }
  throw new Error("expected AiServiceError");
}

describe("T13 durable AI jobs and consent against local PostgreSQL", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config) throw new Error("Local Supabase environment required");
    adminConfig = config;
    admin = createClient<Database>(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    gateway = createSupabaseAiWorkerGateway(config);
    stub = await startOpenAIStub();
    // Clear any leftover queued jobs from earlier interrupted runs before counting provider calls.
    await drain(new UnavailableAIProvider());
    ownerA = await createAccount("a");
    ownerB = await createAccount("b");
  });

  afterAll(async () => {
    await stub?.close();
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("1. without consent nothing is queued and the manual path still confirms", async () => {
    const activity = await note(ownerA, "Manual only: planned 2 workshops");
    expect(await errorCode(ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("CONSENT_REQUIRED");
    const { count } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", ownerA.id);
    expect(count).toBe(0);
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("not_requested");

    const created = await ownerA.achievements.createAchievement({
      operationKey: randomUUID(), activityId: activity.activityId, projectId: null, experienceId: null,
    });
    const confirmed = await ownerA.achievements.saveAchievement({
      achievementId: created.achievementId, expectedRevision: created.revision, action: "confirm",
      changes: {
        title: "Planned workshops", contribution: "Planned 2 workshops", scope: "", outcome: "Workshops scheduled",
        cvBullet: "Planned 2 workshops that were scheduled", achievedOn: "2026-09-20", metrics: [],
      },
      skillNames: [],
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("2-3. duplicate and concurrent requests share one job; the worker stores a validated result", async () => {
    const consent = await setConsent(ownerA, true);
    expect(consent.aiConsentVersion).toBe("ai-processing-v1");
    const sentinel = `WP-PRIVATE-SENTINEL-${randomUUID()}`;
    const activity = await note(ownerA, `Led migration of 3 reports ${sentinel}`, { role: "Analyst" });

    const receipts = await Promise.all(Array.from({ length: 5 }, () =>
      ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 })));
    expect(new Set(receipts.map((receipt) => receipt.jobId)).size).toBe(1);
    const { count } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("activity_id", activity.activityId);
    expect(count).toBe(1);
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("queued");

    const provider = fake();
    await drain(provider);
    expect(provider.calls).toEqual([
      { locale: "en", raw_text: `Led migration of 3 reports ${sentinel}`, role: "Analyst", scope: null, outcome: null },
    ]);
    const job = await jobRow(receipts[0]!.jobId);
    expect(job.status).toBe("succeeded");
    expect(detectResultSchema.safeParse(job.result).success).toBe(true);
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("done");

    const latest = await ownerA.jobs.getLatestJobForActivity(activity.activityId);
    expect(latest).toMatchObject({ jobId: job.id, status: "succeeded", attemptCount: 1 });
    // A repeated request for the analysed revision returns the finished job instead of a new one.
    expect((await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 })).jobId).toBe(job.id);
  });

  it("4. an edit while queued makes the job stale without calling the provider", async () => {
    const activity = await note(ownerA, "Wrote 4 onboarding guides");
    const first = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    const edited = await editNote(ownerA, activity.activityId, "Wrote 5 onboarding guides");
    expect(edited.revision).toBe(2);
    expect(edited.analysis_state).toBe("not_requested");

    const provider = fake();
    await drain(provider);
    expect(provider.calls).toHaveLength(0);
    expect(await jobRow(first.jobId)).toMatchObject({ status: "failed", error_code: "STALE_INPUT", result: null });
    expect(await errorCode(ownerA.jobs.retryJob({ jobId: first.jobId }))).toBe("STALE_INPUT");
    expect(await errorCode(ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("STALE_INPUT");

    const second = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 2 });
    expect(second.jobId).not.toBe(first.jobId);
    await drain(fake());
    expect((await jobRow(second.jobId)).status).toBe("succeeded");
  });

  it("5. an edit while the provider is running prevents the late result from being stored", async () => {
    const activity = await note(ownerA, "Reduced ticket backlog by 12 items");
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    const provider = fake("valid", async () => {
      await editNote(ownerA, activity.activityId, "Reduced ticket backlog by 15 items");
    });
    const [summary] = await drain(provider);
    expect(summary?.aiFailed).toEqual({ STALE_INPUT: 1 });
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "STALE_INPUT", result: null });
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("not_requested");
  });

  it("6. withdrawn consent stops queued jobs before sending and discards running results", async () => {
    const queued = await note(ownerA, "Mentored 2 interns");
    const queuedJob = await ownerA.jobs.requestAnalysis({ activityId: queued.activityId, expectedRevision: 1 });
    await setConsent(ownerA, false);
    const provider = fake();
    await drain(provider);
    expect(provider.calls).toHaveLength(0);
    expect(await jobRow(queuedJob.jobId)).toMatchObject({ status: "failed", error_code: "CONSENT_REQUIRED" });
    expect(await errorCode(ownerA.jobs.retryJob({ jobId: queuedJob.jobId }))).toBe("CONSENT_REQUIRED");

    await setConsent(ownerA, true);
    const running = await note(ownerA, "Ran 6 customer interviews");
    const runningJob = await ownerA.jobs.requestAnalysis({ activityId: running.activityId, expectedRevision: 1 });
    await drain(fake("valid", async () => {
      await setConsent(ownerA, false);
    }));
    expect(await jobRow(runningJob.jobId)).toMatchObject({ status: "failed", error_code: "CONSENT_WITHDRAWN", result: null });
    await setConsent(ownerA, true);
  });

  it("7. a deleting account is blocked without a provider call", async () => {
    const doomed = await createAccount("deleting");
    await setConsent(doomed, true);
    const activity = await note(doomed, "Closed 7 audits");
    const receipt = await doomed.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    const marked = await admin.from("profiles").update({ deleting_at: new Date().toISOString() }).eq("id", doomed.id);
    expect(marked.error).toBeNull();

    const provider = fake();
    await drain(provider);
    expect(provider.calls).toHaveLength(0);
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "ACCOUNT_DELETING" });
    expect(await errorCode(doomed.jobs.retryJob({ jobId: receipt.jobId }))).toBe("UNAUTHENTICATED");
    expect(await errorCode(doomed.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("UNAUTHENTICATED");
  });

  it("8. retries stop after three attempts", async () => {
    const activity = await note(ownerA, "Prepared 3 budget drafts");
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("unavailable"));
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_PROVIDER_UNAVAILABLE", attempt_count: 1 });
    for (const attempt of [2, 3]) {
      expect((await ownerA.jobs.retryJob({ jobId: receipt.jobId })).status).toBe("queued");
      await drain(fake("malformed"));
      expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_OUTPUT_INVALID", attempt_count: attempt });
    }
    expect(await errorCode(ownerA.jobs.retryJob({ jobId: receipt.jobId }))).toBe("RETRY_EXHAUSTED");
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("failed");
  });

  it.each(["chat_completions", "responses"] as const)("9. the real OpenAI-compatible adapter (%s) maps stub responses through the worker", async (api) => {
    const provider = new OpenAIProvider({ apiKey: FAKE_KEY, model: "gpt-6-luna", baseUrl: stub.baseUrl, api });
    const cases: Array<[Parameters<OpenAIStub["setMode"]>[0], string, number?]> = [
      ["valid", "succeeded"],
      ["rate_limited", "AI_RATE_LIMITED"],
      ["refusal", "AI_REFUSED"],
      ["slow", "AI_PROVIDER_TIMEOUT", 300],
    ];
    for (const [mode, expected, timeoutMs] of cases) {
      stub.setMode(mode, "WP-PRIVATE-SENTINEL-stub");
      const activity = await note(ownerA, `Stub case ${api} ${mode}: shipped 1 release`);
      const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
      await drain(provider, timeoutMs);
      const job = await jobRow(receipt.jobId);
      if (expected === "succeeded") expect(job.status).toBe("succeeded");
      else expect(job).toMatchObject({ status: "failed", error_code: expected });
    }
    stub.setMode("valid");
    const last = stub.requests.at(-1)!;
    expect(last.authorization).toBe(`Bearer ${FAKE_KEY}`);
    expect(last.body).toMatchObject({ model: "gpt-6-luna" });
    if (api === "chat_completions") {
      expect(last.path).toBe("/v1/chat/completions");
      // A compatible (non-OpenAI) endpoint receives no official-only fields.
      expect(last.body).not.toHaveProperty("store");
      const messages = last.body.messages as Array<{ role: string; content: string }>;
      expect(Object.keys(JSON.parse(messages[1]!.content)).sort()).toEqual(["locale", "outcome", "raw_text", "role", "scope"]);
    } else {
      expect(last.path).toBe("/v1/responses");
      expect(last.body).toMatchObject({ store: false });
      expect(Object.keys(JSON.parse(String(last.body.input))).sort()).toEqual(["locale", "outcome", "raw_text", "role", "scope"]);
    }
  });

  it("10. an unavailable provider fails the job and an explicit retry succeeds later", async () => {
    const activity = await note(ownerA, "Documented 9 runbooks");
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(new UnavailableAIProvider());
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    expect((await activityRow(ownerA, activity.activityId)).analysis_state).toBe("failed");
    await ownerA.jobs.retryJob({ jobId: receipt.jobId });
    await drain(fake());
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "succeeded", attempt_count: 2 });
  });

  it("11. another account cannot read, request or retry A's jobs", async () => {
    const activity = await note(ownerA, "Private A work with 4 steps");
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await setConsent(ownerB, true);

    const visible = await ownerB.client.from("ai_jobs").select("id").eq("id", receipt.jobId);
    expect(visible.data).toEqual([]);
    expect(await ownerB.jobs.getLatestJobForActivity(activity.activityId)).toBeNull();
    expect(await errorCode(ownerB.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.jobs.requestAnalysis({ activityId: randomUUID(), expectedRevision: 1 }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.jobs.retryJob({ jobId: receipt.jobId }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.jobs.retryJob({ jobId: randomUUID() }))).toBe("NOT_FOUND");

    const lease = await ownerA.client.from("ai_jobs").select("attempt_token").eq("id", receipt.jobId);
    expect(lease.error).not.toBeNull();
    await drain(fake());
  });

  it("12. the worker process never prints source text or the API key", async () => {
    const sentinel = `WP-PRIVATE-SENTINEL-${randomUUID()}`;
    const activity = await note(ownerA, `Secret project ${sentinel} with 2 launches`);
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    stub.setMode("server_error_leaky", `${sentinel} ${FAKE_KEY}`);

    const { stdout, stderr } = await execFileAsync(process.execPath, ["workers/run.ts", "--once"], {
      env: {
        ...process.env,
        SUPABASE_URL: adminConfig.url,
        SUPABASE_SECRET_KEY: adminConfig.secretKey,
        WORKPULSE_SCANNER_MODE: "unavailable",
        WORKPULSE_AI_MODE: "openai",
        WORKPULSE_OPENAI_API_KEY: FAKE_KEY,
        WORKPULSE_AI_MODEL: "gpt-6-luna",
        WORKPULSE_OPENAI_BASE_URL: stub.baseUrl,
      },
      timeout: 60_000,
    });

    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_PROVIDER_UNAVAILABLE" });
    const output = `${stdout}\n${stderr}`;
    expect(output).toContain("\"aiJobsClaimed\":1");
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain(FAKE_KEY);
    expect(output).not.toContain("Secret project");
    const stored = JSON.stringify(await jobRow(receipt.jobId));
    expect(stored).not.toContain(sentinel);
    expect(stored).not.toContain(FAKE_KEY);
    stub.setMode("valid");
  }, 90_000);

  it("13. deleting the activity removes its jobs and a late worker write is stale", async () => {
    const activity = await note(ownerA, "Consolidated 8 dashboards");
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    const provider = fake("valid", async () => {
      const current = await activityRow(ownerA, activity.activityId);
      await ownerA.activities.deleteActivity({ activityId: activity.activityId, expectedRevision: current.revision });
    });
    const summaries = await drain(provider);
    expect(provider.calls).toHaveLength(1);
    expect(summaries.reduce((total, summary) => total + summary.aiStale, 0)).toBe(1);
    const { data } = await admin.from("ai_jobs").select("id").eq("id", receipt.jobId);
    expect(data).toEqual([]);
  });
});
