import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { createAiUsageService } from "@/features/ai/ai-usage-service";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
import { UnavailableAIProvider, type AIProvider } from "@/server/ai/provider";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { assignAiPlan, usageSql } from "./ai-usage-support";

// Decision 0032: per-account AI units (analysis 20/day 200/month, import 3/day 5/month) and a shared daily
// capacity, charged in the transaction that queues the provider attempt.

type Client = SupabaseClient<Database>;
type Account = {
  id: string;
  client: Client;
  activities: ReturnType<typeof createActivityService>;
  achievements: ReturnType<typeof createAchievementService>;
  jobs: ReturnType<typeof createAiJobService>;
  review: ReturnType<typeof createAiReviewService>;
  usage: ReturnType<typeof createAiUsageService>;
};

const PDF_MIME = "application/pdf";
const ANSWER = "The reports went live a week early.";

let admin: Client;
let gateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
const users: string[] = [];

async function createAccount(label: string, plan: "free" | "unlimited" = "free"): Promise<Account> {
  const pub = getSupabasePublicConfig();
  if (!pub) throw new Error("Local Supabase environment required");
  const email = `ai-usage-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("AI usage fixture creation failed");
  const id = created.data.user.id;
  users.push(id);
  if (plan !== "free") assignAiPlan(id, plan);
  const client = createClient<Database>(pub.url, pub.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("AI usage fixture sign-in failed");
  const consent = createAiConsentService(client);
  const { data } = await client.from("profiles").select("revision").eq("id", id).single();
  await consent.setConsent({ expectedRevision: data!.revision, consented: true });
  return {
    id,
    client,
    activities: createActivityService(client),
    achievements: createAchievementService(client),
    jobs: createAiJobService(client),
    review: createAiReviewService(client),
    usage: createAiUsageService(client),
  };
}

async function note(account: Account, rawText: string) {
  return account.activities.createActivity({
    operationKey: randomUUID(), captureMode: "note", rawText, occurredOn: "2026-10-18",
    role: null, scope: null, outcome: null, experienceId: null, projectId: null,
  });
}

/** Seeds the account's counters directly, so a test starts next to a limit without queuing real jobs. */
function setUnits(userId: string, bucket: "analysis" | "import", window: "day" | "month", units: number): void {
  const start = window === "day" ? "(now() at time zone 'UTC')::date" : "date_trunc('month', now() at time zone 'UTC')::date";
  usageSql(
    `insert into internal.ai_usage (user_id, bucket, window_kind, window_start, units) values ('${userId}', '${bucket}', '${window}', ${start}, ${units}) ` +
    `on conflict (user_id, bucket, window_kind, window_start) do update set units = excluded.units`,
  );
}

function units(userId: string, bucket: "analysis" | "import", window: "day" | "month"): number {
  return Number(usageSql(
    `select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${userId}' and bucket = '${bucket}' and window_kind = '${window}'`,
  ));
}

async function jobCount(userId: string, activityId?: string): Promise<number> {
  let query = admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (activityId) query = query.eq("activity_id", activityId);
  const { count } = await query;
  return count ?? 0;
}

async function drain(provider: AIProvider): Promise<void> {
  for (let n = 0; n < 50; n++) {
    const summary = await runAiWorkerOnce({ database: gateway, provider });
    if (!summary.aiJobsClaimed && !summary.aiExpiredLeases) return;
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

/** The same key always describes the same file, so a second call is a true replay. */
function beginImport(account: Account, key = randomUUID(), name = "cv.pdf") {
  return account.client.rpc("begin_import_batch", {
    p_idempotency_key: key, p_filename: name, p_bytes: 64, p_mime_type: PDF_MIME,
    p_sha256: createHash("sha256").update(key).digest("hex"),
  });
}

function nextUtcMidnight(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

describe("Decision 0032 AI usage limits against local PostgreSQL", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config) throw new Error("Local Supabase environment required");
    admin = createClient<Database>(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    gateway = createSupabaseAiWorkerGateway(config);
  });

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  it("1. the 21st analysis of the day is refused with no job, replays are free, and the manual path still confirms", async () => {
    const owner = await createAccount("daily");
    const first = await note(owner, "Shipped the onboarding checklist to 3 teams.");
    const second = await note(owner, "Wrote the incident review for the billing outage.");
    setUnits(owner.id, "analysis", "day", 19);

    const receipt = await owner.jobs.requestAnalysis({ activityId: first.activityId, expectedRevision: 1 });
    expect(units(owner.id, "analysis", "day")).toBe(20);
    expect(units(owner.id, "analysis", "month")).toBe(1);

    expect(await errorCode(owner.jobs.requestAnalysis({ activityId: second.activityId, expectedRevision: 1 }))).toBe("QUOTA_EXCEEDED");
    expect(await jobCount(owner.id, second.activityId)).toBe(0);
    expect((await owner.activities.getActivity(second.activityId)).activity.analysis_state).toBe("not_requested");
    expect(units(owner.id, "analysis", "day")).toBe(20);

    const replay = await owner.jobs.requestAnalysis({ activityId: first.activityId, expectedRevision: 1 });
    expect(replay.jobId).toBe(receipt.jobId);
    expect(units(owner.id, "analysis", "day")).toBe(20);

    const usage = await owner.usage.getUsage();
    expect(usage.analysis).toMatchObject({ dayUsed: 20, dayLimit: 20, monthLimit: 200, limitReason: "daily" });
    expect(new Date(usage.analysis.resetsAt!).toISOString()).toBe(nextUtcMidnight());
    expect(usage.import).toMatchObject({ dayUsed: 0, dayLimit: 3, monthLimit: 5, limitReason: null, resetsAt: null });

    const view = await owner.review.getAnalysisView(second.activityId);
    expect(view.usage?.limitReason).toBe("daily");

    const created = await owner.achievements.createAchievement({
      operationKey: randomUUID(), activityId: second.activityId, projectId: null, experienceId: null,
    });
    const confirmed = await owner.achievements.saveAchievement({
      achievementId: created.achievementId, expectedRevision: created.revision, action: "confirm",
      changes: {
        title: "Incident review", contribution: "Wrote the incident review", scope: "", outcome: "Review published",
        cvBullet: "Wrote the billing outage incident review", achievedOn: "2026-10-18", metrics: [],
      },
      skillNames: [],
    });
    expect(confirmed.status).toBe("confirmed");
  });

  it("2. concurrent requests at the boundary never overshoot the limit", async () => {
    const owner = await createAccount("race");
    const notes = await Promise.all(Array.from({ length: 6 }, (_, n) => note(owner, `Race note ${n}: closed 2 support tickets.`)));
    setUnits(owner.id, "analysis", "day", 18);

    const results = await Promise.allSettled(notes.map((activity) =>
      owner.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 })));
    const accepted = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(accepted).toHaveLength(2);
    expect(refused.map((result) => (result.reason as AiServiceError).code)).toEqual(Array(4).fill("QUOTA_EXCEEDED"));
    expect(units(owner.id, "analysis", "day")).toBe(20);
    expect(await jobCount(owner.id)).toBe(2);
  });

  it("3. the monthly window blocks even with daily units left and resets on the first of next month", async () => {
    const owner = await createAccount("monthly");
    const activity = await note(owner, "Mentored 2 new analysts through their first close.");
    setUnits(owner.id, "analysis", "month", 200);

    expect(await errorCode(owner.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("QUOTA_EXCEEDED");
    expect(units(owner.id, "analysis", "day")).toBe(0);
    const usage = await owner.usage.getUsage();
    expect(usage.analysis.limitReason).toBe("monthly");
    const now = new Date();
    expect(new Date(usage.analysis.resetsAt!).toISOString())
      .toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
  });

  it("4. an explicit retry is charged; at the limit it is refused and the job stays failed", async () => {
    const owner = await createAccount("retry");
    const activity = await note(owner, "Rebuilt the weekly KPI sheet in 2 days.");
    const job = await owner.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(new UnavailableAIProvider());
    const { data: failed } = await admin.from("ai_jobs").select("status").eq("id", job.jobId).single();
    expect(failed?.status).toBe("failed");

    setUnits(owner.id, "analysis", "day", 20);
    expect(await errorCode(owner.jobs.retryJob({ jobId: job.jobId }))).toBe("QUOTA_EXCEEDED");
    const { data: still } = await admin.from("ai_jobs").select("status").eq("id", job.jobId).single();
    expect(still?.status).toBe("failed");

    setUnits(owner.id, "analysis", "day", 5);
    expect((await owner.jobs.retryJob({ jobId: job.jobId })).status).toBe("queued");
    expect(units(owner.id, "analysis", "day")).toBe(6);
    await drain(new UnavailableAIProvider());
  });

  it("5. answers are saved when the follow-up refine is refused, and no refine job is queued", async () => {
    const owner = await createAccount("refine");
    const activity = await note(owner, "Migrated 3 reports to the new pipeline.");
    const job = await owner.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(new ExplicitTestFakeAIProvider("valid"));
    const view = await owner.review.getAnalysisView(activity.activityId);
    expect(view.view.visibleQuestions.some((question) => question.field === "outcome")).toBe(true);

    setUnits(owner.id, "analysis", "day", 20);
    const answer = await owner.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: ANSWER } });
    expect(answer).toEqual({ activityRevision: 2, jobId: null, jobStatus: null });
    expect((await owner.activities.getActivity(activity.activityId)).activity.outcome).toBe(ANSWER);
    expect(await jobCount(owner.id, activity.activityId)).toBe(1);
    expect(units(owner.id, "analysis", "day")).toBe(20);
  });

  it("6. each new import batch is charged, a replay is not, and the fourth of the day leaves no batch", async () => {
    const owner = await createAccount("import");
    const key = randomUUID();
    const first = await beginImport(owner, key);
    expect(first.error).toBeNull();
    const replay = await beginImport(owner, key);
    expect(replay.error).toBeNull();
    expect((replay.data as Array<{ replayed: boolean }>)[0]?.replayed).toBe(true);
    expect(units(owner.id, "import", "day")).toBe(1);

    expect((await beginImport(owner)).error).toBeNull();
    expect((await beginImport(owner)).error).toBeNull();
    const fourth = await beginImport(owner, randomUUID(), "fourth.pdf");
    expect(fourth.error?.message).toBe("AI_QUOTA_EXCEEDED");
    const { count } = await admin.from("import_batches").select("id", { count: "exact", head: true }).eq("user_id", owner.id);
    expect(count).toBe(3);
    expect((await owner.usage.getUsage()).import).toMatchObject({ dayUsed: 3, monthUsed: 3, limitReason: "daily" });
    expect((await owner.usage.getUsage()).analysis.limitReason).toBeNull();
  });

  it("7. an import retry is charged and refused at the limit without resuming the batch", async () => {
    const owner = await createAccount("import-retry");
    const begun = await beginImport(owner);
    const batchId = (begun.data as Array<{ batch_id: string }>)[0]!.batch_id;
    usageSql(
      `update public.import_batches set status = 'failed', stage = 'screening', error_code = 'SCANNER_UNAVAILABLE', ` +
      `failed_at = now(), expires_at = now() + interval '23 hours' where id = '${batchId}'`,
    );
    setUnits(owner.id, "import", "month", 5);
    const refused = await owner.client.rpc("retry_import_batch", { p_batch_id: batchId });
    expect(refused.error?.message).toBe("AI_QUOTA_EXCEEDED");
    const { data: batch } = await admin.from("import_batches").select("status, retry_count").eq("id", batchId).single();
    expect(batch).toEqual({ status: "failed", retry_count: 0 });
    expect((await owner.usage.getUsage()).import.limitReason).toBe("monthly");
  });

  it("8. the shared capacity refuses free accounts, while unlimited accounts neither stop nor count toward it", async () => {
    const free = await createAccount("capacity-free");
    const unlimited = await createAccount("capacity-unlimited", "unlimited");
    const freeNote = await note(free, "Ran the quarterly access review for 4 systems.");
    const unlimitedNote = await note(unlimited, "Ran the quarterly access review for 5 systems.");
    const before = usageSql("select daily_units from internal.ai_capacity");
    try {
      usageSql("update internal.ai_capacity set daily_units = 0");
      expect(await errorCode(free.jobs.requestAnalysis({ activityId: freeNote.activityId, expectedRevision: 1 }))).toBe("CAPACITY_EXCEEDED");
      expect(units(free.id, "analysis", "day")).toBe(0);
      expect((await free.usage.getUsage()).analysis.limitReason).toBe("capacity");

      const capacityBefore = usageSql("select coalesce(sum(units), 0) from internal.ai_capacity_usage");
      setUnits(unlimited.id, "analysis", "day", 5000);
      await unlimited.jobs.requestAnalysis({ activityId: unlimitedNote.activityId, expectedRevision: 1 });
      expect(usageSql("select coalesce(sum(units), 0) from internal.ai_capacity_usage")).toBe(capacityBefore);
      const unlimitedUsage = await unlimited.usage.getUsage();
      expect(unlimitedUsage.analysis).toMatchObject({ dayLimit: null, monthLimit: null, limitReason: null });
    } finally {
      usageSql(`update internal.ai_capacity set daily_units = ${Number(before)}`);
    }
    expect((await free.jobs.requestAnalysis({ activityId: freeNote.activityId, expectedRevision: 1 })).status).toBe("queued");
    await drain(new UnavailableAIProvider());
  });

  it("9. counters are private to the database and leave with the Auth user", async () => {
    const owner = await createAccount("private");
    setUnits(owner.id, "analysis", "day", 3);
    const direct = await owner.client.schema("internal" as "public").from("ai_usage" as "ai_jobs").select("*");
    expect(direct.data ?? []).toHaveLength(0);
    expect(direct.error).not.toBeNull();
    const anon = createClient<Database>(getSupabasePublicConfig()!.url, getSupabasePublicConfig()!.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    expect((await anon.rpc("get_ai_usage")).error).not.toBeNull();

    expect((await admin.auth.admin.deleteUser(owner.id)).error).toBeNull();
    users.splice(users.indexOf(owner.id), 1);
    expect(units(owner.id, "analysis", "day")).toBe(0);
  });
});
