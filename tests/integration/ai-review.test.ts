import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { DetectInput } from "@/domain/ai/minimize";
import { AiServiceError } from "@/features/ai/ai-errors";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { ExplicitTestFakeAIProvider, type FakeAIScenario } from "@/server/ai/fake-provider";
import { UnavailableAIProvider, type AIProvider } from "@/server/ai/provider";
import { getSupabaseAdminConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAiWorkerOnce, type AiWorkerSummary } from "../../workers/ai-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";

const SENTINEL = "WP-PRIVATE-SENTINEL-review";
const FAKE_ANSWER = "Weekly prep dropped from 5 to 2 hours";

type Account = {
  id: string;
  client: SupabaseClient<Database>;
  activities: ReturnType<typeof createActivityService>;
  achievements: ReturnType<typeof createAchievementService>;
  jobs: ReturnType<typeof createAiJobService>;
  review: ReturnType<typeof createAiReviewService>;
  consent: ReturnType<typeof createAiConsentService>;
};

let admin: SupabaseClient<Database>;
let adminConfig: { url: string; secretKey: string };
let gateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let ownerA: Account;
let ownerB: Account;
const users: string[] = [];

function account(client: SupabaseClient<Database>, id: string): Account {
  return {
    id,
    client,
    activities: createActivityService(client),
    achievements: createAchievementService(client),
    jobs: createAiJobService(client),
    review: createAiReviewService(client),
    consent: createAiConsentService(client),
  };
}

async function createAccount(label: string): Promise<Account> {
  const email = `review-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("review fixture creation failed");
  users.push(created.data.user.id);
  const pub = { url: adminConfig.url, publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! };
  const client = createClient<Database>(pub.url, pub.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("review fixture sign-in failed");
  return account(client, created.data.user.id);
}

async function profileRevision(acc: Account): Promise<number> {
  const { data, error } = await acc.client.from("profiles").select("revision").eq("id", acc.id).single();
  if (error || !data) throw new Error("profile unavailable");
  return data.revision;
}

async function setConsent(acc: Account, consented: boolean) {
  return acc.consent.setConsent({ expectedRevision: await profileRevision(acc), consented });
}

async function note(acc: Account, rawText: string, extra: { role?: string; outcome?: string; scope?: string; captureMode?: "note" | "chat" } = {}) {
  return acc.activities.createActivity({
    operationKey: randomUUID(), captureMode: extra.captureMode ?? "note", rawText, occurredOn: "2026-09-20",
    role: extra.role ?? null, scope: extra.scope ?? null, outcome: extra.outcome ?? null,
    experienceId: null, projectId: null,
  });
}

async function activityRow(acc: Account, activityId: string) {
  return (await acc.activities.getActivity(activityId)).activity;
}

async function editNote(acc: Account, activityId: string, rawText: string) {
  const current = await activityRow(acc, activityId);
  return acc.activities.updateActivity({
    activityId, expectedRevision: current.revision, rawText, occurredOn: current.occurred_on,
    role: current.role, scope: current.scope, outcome: current.outcome,
    experienceId: current.experience_id, projectId: current.project_id,
  });
}

async function jobRow(jobId: string) {
  const { data, error } = await admin.from("ai_jobs").select("*").eq("id", jobId).single();
  if (error || !data) throw new Error("job unavailable");
  return data;
}

async function achievementRow(acc: Account, id: string) {
  const { data, error } = await acc.client.from("achievements").select("*").eq("id", id).single();
  if (error || !data) throw new Error("achievement unavailable");
  return data;
}

type AchievementMetric = { label: string; value: number; unit: string; baseline?: number; period?: string };

/**
 * Full changes payload preserving a row's current content (achievementChangesSchema requires
 * all keys, and its nullableText fields take a string — "" transforms to null — never a
 * literal null input).
 */
function confirmChanges(row: { title: string | null; contribution: string | null; scope: string | null; outcome: string | null; cv_bullet: string | null; achieved_on: string | null; metrics: unknown }) {
  return {
    title: row.title ?? "", contribution: row.contribution ?? "", scope: row.scope ?? "", outcome: row.outcome ?? "",
    cvBullet: row.cv_bullet ?? "", achievedOn: row.achieved_on,
    metrics: (row.metrics ?? []) as AchievementMetric[],
  };
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

/** Stringifies every observable surface of an operation's outcome and asserts no sentinel appears. */
async function assertNoLeak(sentinels: string[], run: () => Promise<unknown>): Promise<void> {
  let dump: string;
  try {
    dump = JSON.stringify(await run());
  } catch (error) {
    dump = error instanceof AiServiceError
      ? JSON.stringify({ code: error.code, messageKey: error.messageKey, message: error.message })
      : String(error);
  }
  for (const sentinel of sentinels) expect(dump).not.toContain(sentinel);
}

describe("T14 detection, refinement and review against local PostgreSQL", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config) throw new Error("Local Supabase environment required");
    adminConfig = config;
    admin = createClient<Database>(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    gateway = createSupabaseAiWorkerGateway(config);
    // Clear any leftover queued jobs from earlier interrupted runs before counting provider calls.
    await drain(new UnavailableAIProvider());
    ownerA = await createAccount("a");
    ownerB = await createAccount("b");
  });

  afterAll(async () => {
    for (const id of users) await admin.auth.admin.deleteUser(id);
  });

  // 1. Main flow: save -> analyze -> succeeded -> review as draft -> confirm via T09 -------

  let mainActivityId: string;
  let mainJobId: string;
  let mainAchievementId: string;

  it("1. main flow: request, succeed, apply creates zero achievements until reviewed, confirm via T09", async () => {
    await setConsent(ownerA, true);
    const activity = await note(ownerA, "Migrated 3 reports to the new pipeline. " + SENTINEL, { outcome: FAKE_ANSWER });
    mainActivityId = activity.activityId;

    const before = await ownerA.review.getAnalysisView(mainActivityId);
    expect(before.view.state).toBe("none");

    const receipt = await ownerA.jobs.requestAnalysis({ activityId: mainActivityId, expectedRevision: 1 });
    expect(receipt.kind).toBe("detect");
    await drain(fake("valid"));

    const { count: beforeApply } = await ownerA.client.from("achievements").select("id", { count: "exact", head: true }).eq("activity_id", mainActivityId);
    expect(beforeApply).toBe(0);

    const view = await ownerA.review.getAnalysisView(mainActivityId);
    expect(view.view.state).toBe("suggestion");
    expect(view.job?.result?.suggestion?.title).toBeTruthy();
    mainJobId = view.job!.id;

    const applied = await ownerA.review.applySuggestion({
      jobId: mainJobId, expectedActivityRevision: 1, expectedAchievementRevision: null,
    });
    expect(applied.created).toBe(true);
    mainAchievementId = applied.achievementId;
    const draft = await achievementRow(ownerA, mainAchievementId);
    expect(draft.status).toBe("draft");
    expect(draft.origin).toBe("activity");

    const confirmed = await ownerA.achievements.saveAchievement({
      achievementId: mainAchievementId, expectedRevision: applied.achievementRevision, action: "confirm",
      changes: confirmChanges(draft), skillNames: [],
    });
    expect(confirmed.status).toBe("confirmed");
  });

  // 2. No auto-apply / no auto-confirm -------------------------------------------------------

  it("2. a succeeded job with no review action creates or changes no achievement", async () => {
    const activity = await note(ownerA, "Routine standup update, nothing notable. " + SENTINEL);
    await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    const { count } = await ownerA.client.from("achievements").select("id", { count: "exact", head: true }).eq("activity_id", activity.activityId);
    expect(count).toBe(0);
  });

  // 3. Consent declined; withdraw after success ---------------------------------------------

  it("3. consent declined blocks request; manual path unaffected; apply blocked after withdrawal", async () => {
    try {
      await setConsent(ownerA, false);
      const activity = await note(ownerA, "Third activity without consent. " + SENTINEL);
      expect(await errorCode(ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("CONSENT_REQUIRED");
      const manual = await ownerA.achievements.createAchievement({ operationKey: randomUUID(), activityId: activity.activityId, projectId: null, experienceId: null });
      const manualConfirmed = await ownerA.achievements.saveAchievement({
        achievementId: manual.achievementId, expectedRevision: 1, action: "confirm",
        changes: {
          title: "Manual title", contribution: "Manual contribution", scope: "", outcome: "Manual outcome",
          cvBullet: "", achievedOn: "2026-09-20", metrics: [],
        },
        skillNames: [],
      });
      expect(manualConfirmed.status).toBe("confirmed");

      await setConsent(ownerA, true);
      const activity2 = await note(ownerA, "Fourth activity, consent then withdrawn. " + SENTINEL);
      const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity2.activityId, expectedRevision: 1 });
      await drain(fake("valid"));
      await setConsent(ownerA, false);
      expect(await errorCode(ownerA.review.applySuggestion({ jobId: receipt.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
        .toBe("CONSENT_REQUIRED");
    } finally {
      await setConsent(ownerA, true);
    }
  });

  // 4. Outage then retry with fake -----------------------------------------------------------

  it("4. AI_UNAVAILABLE fails the job with retry and manual path still visible; retry with fake succeeds", async () => {
    const activity = await note(ownerA, "Fifth activity, outage scenario. " + SENTINEL);
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(new UnavailableAIProvider());
    const failedView = await ownerA.review.getAnalysisView(activity.activityId);
    expect(failedView.view.state).toBe("failed");
    expect(failedView.view.canRetry).toBe(true);

    await ownerA.jobs.retryJob({ jobId: receipt.jobId });
    await drain(fake("valid"));
    const succeeded = await ownerA.review.getAnalysisView(activity.activityId);
    expect(succeeded.view.state).toBe("suggestion");
  });

  // 5. Malformed, ungrounded, fabricated_text, many_questions -> AI_OUTPUT_INVALID -----------

  it.each(["malformed", "ungrounded", "fabricated_text", "many_questions"] as const)(
    "5. %s output fails the job as AI_OUTPUT_INVALID",
    async (scenario) => {
      const activity = await note(ownerA, `Sixth activity ${scenario}. ` + SENTINEL);
      await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
      await drain(fake(scenario));
      const row = await activityRow(ownerA, activity.activityId);
      expect(row.analysis_state).toBe("failed");
      const view = await ownerA.review.getAnalysisView(activity.activityId);
      expect(view.job?.errorCode).toBe("AI_OUTPUT_INVALID");
    },
  );

  // 6. Edit while queued and while running -> STALE_INPUT; apply on old job rejected ---------

  it("6. an edit while queued and while running makes the job stale; apply on the stale (failed) job is rejected; apply after a later edit on an already-succeeded job is also rejected", async () => {
    const activity = await note(ownerA, "Seventh activity, edited while queued. " + SENTINEL);
    const queuedJob = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await editNote(ownerA, activity.activityId, "Seventh activity edited before claim. " + SENTINEL);
    await drain(fake("valid"));
    expect((await jobRow(queuedJob.jobId)).error_code).toBe("STALE_INPUT");
    // A failed (never succeeded) job is AI_JOB_UNAVAILABLE for apply, not STALE_INPUT: apply's
    // own STALE_INPUT check only applies to a job that DID succeed at a revision that has since moved on.
    expect(await errorCode(ownerA.review.applySuggestion({ jobId: queuedJob.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
      .toBe("NOT_FOUND");

    const successThenEdited = await note(ownerA, "Seventh-b activity, edited after success. " + SENTINEL);
    const succeededJob = await ownerA.jobs.requestAnalysis({ activityId: successThenEdited.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    await editNote(ownerA, successThenEdited.activityId, "Seventh-b activity edited after the job succeeded. " + SENTINEL);
    expect(await errorCode(ownerA.review.applySuggestion({ jobId: succeededJob.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
      .toBe("STALE_INPUT");

    const activity2 = await note(ownerA, "Eighth activity, edited while running. " + SENTINEL);
    const runningJob = await ownerA.jobs.requestAnalysis({ activityId: activity2.activityId, expectedRevision: 1 });
    await drain(fake("valid", async () => { await editNote(ownerA, activity2.activityId, "Eighth activity edited mid-run. " + SENTINEL); }));
    expect((await jobRow(runningJob.jobId)).error_code).toBe("STALE_INPUT");
  });

  // 7. Retry exhausted; parallel retry ---------------------------------------------------------

  it("7. retry stops after three attempts; parallel retries do not create a second job", async () => {
    const activity = await note(ownerA, "Ninth activity, retry exhaustion. " + SENTINEL);
    const receipt = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(new UnavailableAIProvider());
    await ownerA.jobs.retryJob({ jobId: receipt.jobId });
    await drain(new UnavailableAIProvider());
    await ownerA.jobs.retryJob({ jobId: receipt.jobId });
    await drain(new UnavailableAIProvider());
    expect((await jobRow(receipt.jobId)).attempt_count).toBe(3);
    expect(await errorCode(ownerA.jobs.retryJob({ jobId: receipt.jobId }))).toBe("RETRY_EXHAUSTED");

    // Parallel retry: only one of three concurrent calls wins the row lock while status is
    // still 'failed'; the others see it already 'queued' and are rejected, never creating a
    // second job or double-incrementing the attempt count.
    const activity2 = await note(ownerA, "Tenth activity, parallel retry. " + SENTINEL);
    const receipt2 = await ownerA.jobs.requestAnalysis({ activityId: activity2.activityId, expectedRevision: 1 });
    await drain(new UnavailableAIProvider());
    const results = await Promise.allSettled([1, 2, 3].map(() => ownerA.jobs.retryJob({ jobId: receipt2.jobId })));
    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    // retry_ai_job only flips status back to queued; attempt_count still increments at claim time.
    expect((await jobRow(receipt2.jobId)).attempt_count).toBe(1);
    const { count } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("activity_id", activity2.activityId);
    expect(count).toBe(1);
  });

  // 8. Parallel requests x5, detect vs refine same revision ----------------------------------

  it("8. five parallel requests share one job; a refine request for the same revision returns it too", async () => {
    const activity = await note(ownerA, "Eleventh activity, parallel requests. " + SENTINEL, { outcome: FAKE_ANSWER });
    const results = await Promise.all(Array.from({ length: 5 }, () => ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 })));
    const ids = new Set(results.map((r) => r.jobId));
    expect(ids.size).toBe(1);
    const { count } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("activity_id", activity.activityId);
    expect(count).toBe(1);
  });

  // 9. Answer (note & chat), replay, refine success without questions; payload 5 keys --------

  let answerActivityId: string;
  let answerRefineJobId: string;

  it("9. answering questions bumps revision once, writes fields, and enqueues a refine job; note mode", async () => {
    const activity = await note(ownerA, "Twelfth activity, answers via note. " + SENTINEL);
    answerActivityId = activity.activityId;
    const job = await ownerA.jobs.requestAnalysis({ activityId: answerActivityId, expectedRevision: 1 });
    await drain(fake("valid"));
    const view = await ownerA.review.getAnalysisView(answerActivityId);
    expect(view.view.visibleQuestions.some((q) => q.field === "outcome")).toBe(true);

    const answer1 = await ownerA.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: FAKE_ANSWER } });
    expect(answer1.activityRevision).toBe(2);
    expect(answer1.jobStatus).toBe("queued");
    answerRefineJobId = answer1.jobId!;
    expect((await jobRow(answerRefineJobId)).kind).toBe("refine");

    const replay = await Promise.all([1, 2, 3].map(() =>
      ownerA.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: FAKE_ANSWER } })));
    for (const result of replay) expect(result.activityRevision).toBe(2);
    expect((await activityRow(ownerA, answerActivityId)).revision).toBe(2);

    let capturedPayload: DetectInput | undefined;
    await drain(fake("valid", (input) => { capturedPayload = input; }));
    expect(Object.keys(capturedPayload!).sort()).toEqual(["locale", "outcome", "raw_text", "role", "scope"]);
    const refined = await ownerA.review.getAnalysisView(answerActivityId);
    expect(refined.job?.kind).toBe("refine");
    expect(refined.job?.result?.questions).toEqual([]);
  });

  it("9b. chat mode appends an assistant/user pair for the answered field", async () => {
    // createActivity with captureMode "chat" already inserts the first user message (sequence 1).
    const activity = await note(ownerA, "Thirteenth activity, chat mode. " + SENTINEL, { captureMode: "chat" });
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    await ownerA.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: FAKE_ANSWER } });
    const { data: messages } = await ownerA.client.from("chat_messages").select("*").eq("activity_id", activity.activityId).order("sequence_no");
    expect(messages).toHaveLength(3);
    expect(messages?.[1]?.role).toBe("assistant");
    expect(messages?.[2]?.role).toBe("user");
    expect(messages?.[2]?.content).toBe(FAKE_ANSWER);
  });

  // 10. Dismiss then request/retry stays suppressed; edit -> new suggestion ------------------

  it("10. dismiss suppresses the suggestion across request/retry; editing the note allows a new suggestion", async () => {
    const activity = await note(ownerA, "Fourteenth activity, dismiss flow. " + SENTINEL);
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    await ownerA.review.dismissSuggestion({ jobId: job.jobId });
    const suppressed = await ownerA.review.getAnalysisView(activity.activityId);
    expect(suppressed.view.state).toBe("suppressed");
    expect(await errorCode(ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
      .toBe("AI_SUGGESTION_DISMISSED");

    const dup = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    expect(dup.jobId).toBe(job.jobId);
    const stillSuppressed = await ownerA.review.getAnalysisView(activity.activityId);
    expect(stillSuppressed.view.state).toBe("suppressed");

    await editNote(ownerA, activity.activityId, "Fourteenth activity, edited after dismiss. " + SENTINEL);
    const newJob = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 2 });
    expect(newJob.jobId).not.toBe(job.jobId);
    await drain(fake("valid"));
    const fresh = await ownerA.review.getAnalysisView(activity.activityId);
    expect(fresh.view.state).toBe("suggestion");
  });

  // 11. Protection of confirmed/dismissed/edited draft; untouched draft updated; parallel apply x3

  let protectActivityId: string;
  let protectAchievementId: string;

  it("11a. apply is rejected on a confirmed achievement without changing the row", async () => {
    const activity = await note(ownerA, "Fifteenth activity, confirmed protection. " + SENTINEL);
    protectActivityId = activity.activityId;
    const job = await ownerA.jobs.requestAnalysis({ activityId: protectActivityId, expectedRevision: 1 });
    await drain(fake("valid"));
    const applied = await ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null });
    protectAchievementId = applied.achievementId;
    const draft = await achievementRow(ownerA, protectAchievementId);
    const confirmed = await ownerA.achievements.saveAchievement({
      achievementId: protectAchievementId, expectedRevision: applied.achievementRevision, action: "confirm",
      changes: confirmChanges(draft), skillNames: [],
    });
    const before = await achievementRow(ownerA, protectAchievementId);
    expect(await errorCode(ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: confirmed.revision })))
      .toBe("ACHIEVEMENT_CONFIRMED");
    const after = await achievementRow(ownerA, protectAchievementId);
    expect(after).toEqual(before);
  });

  it("11b. apply is rejected on a manually edited draft, but updates an untouched one from a newer suggestion", async () => {
    const activity = await note(ownerA, "Sixteenth activity, draft protection. " + SENTINEL);
    const job1 = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    const applied1 = await ownerA.review.applySuggestion({ jobId: job1.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null });

    // Untouched draft: edit the note (new revision), request+succeed a new suggestion, apply again.
    await editNote(ownerA, activity.activityId, "Sixteenth activity, edited for refresh. " + SENTINEL);
    const job2 = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 2 });
    await drain(fake("valid"));
    const applied2 = await ownerA.review.applySuggestion({
      jobId: job2.jobId, expectedActivityRevision: 2, expectedAchievementRevision: applied1.achievementRevision,
    });
    expect(applied2.created).toBe(false);
    expect(applied2.achievementId).toBe(applied1.achievementId);
    const refreshed = await achievementRow(ownerA, applied2.achievementId);
    expect(refreshed.source_activity_revision).toBe(2);

    // Now edit the draft manually (via T09 save_achievement), then try to apply a further suggestion.
    const edited = await ownerA.achievements.saveAchievement({
      achievementId: applied2.achievementId, expectedRevision: applied2.achievementRevision, action: "save_draft",
      changes: { ...confirmChanges(refreshed), title: "Manually rewritten title" }, skillNames: [],
    });
    await editNote(ownerA, activity.activityId, "Sixteenth activity, edited again. " + SENTINEL);
    const job3 = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 3 });
    await drain(fake("valid"));
    expect(await errorCode(ownerA.review.applySuggestion({
      jobId: job3.jobId, expectedActivityRevision: 3, expectedAchievementRevision: edited.revision,
    }))).toBe("DRAFT_EDITED");
    const untouched = await achievementRow(ownerA, applied2.achievementId);
    expect(untouched.title).toBe("Manually rewritten title");
  });

  it("11c. parallel apply for the same job creates exactly one achievement", async () => {
    const activity = await note(ownerA, "Seventeenth activity, parallel apply. " + SENTINEL);
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));
    const results = await Promise.all([1, 2, 3].map(() =>
      ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })));
    const ids = new Set(results.map((r) => r.achievementId));
    expect(ids.size).toBe(1);
    const { count } = await ownerA.client.from("achievements").select("id", { count: "exact", head: true }).eq("activity_id", activity.activityId);
    expect(count).toBe(1);
  });

  it("11d. answer racing apply on the same job never deadlocks (consistent lock order)", async () => {
    for (let round = 0; round < 8; round += 1) {
      const activity = await note(ownerA, `Race activity ${round}, answer versus apply. ` + SENTINEL);
      const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
      await drain(fake("valid"));
      const results = await Promise.allSettled([
        ownerA.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: FAKE_ANSWER } }),
        ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null }),
      ]);
      expect(results.some((r) => r.status === "fulfilled")).toBe(true);
      for (const result of results) {
        if (result.status === "fulfilled") continue;
        // A deadlock (40P01) would surface as UNAVAILABLE; losing the race must be a defined conflict.
        expect(result.reason).toBeInstanceOf(AiServiceError);
        expect((result.reason as AiServiceError).code).not.toBe("UNAVAILABLE");
      }
    }
  });

  // 12. Nonpotential --------------------------------------------------------------------------

  it("12. a nonpotential result leaves the activity as a normal log entry with no apply available", async () => {
    const activity = await note(ownerA, "Eighteenth activity, routine. " + SENTINEL);
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("no_potential"));
    const view = await ownerA.review.getAnalysisView(activity.activityId);
    expect(view.view.state).toBe("no_potential");
    expect(view.view.canApply).toBe(false);
    expect(await errorCode(ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
      .toBe("AI_JOB_NOT_APPLICABLE");
  });

  // 13. Isolation between accounts --------------------------------------------------------------

  it("13. account B cannot answer, skip, dismiss, apply, or read A's analysis", async () => {
    const activity = await note(ownerA, "Nineteenth activity, isolation. " + SENTINEL);
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drain(fake("valid"));

    expect(await errorCode(ownerB.review.getAnalysisView(activity.activityId))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: "x" } }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.review.skipQuestions({ jobId: job.jobId }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.review.dismissSuggestion({ jobId: job.jobId }))).toBe("NOT_FOUND");
    expect(await errorCode(ownerB.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null })))
      .toBe("NOT_FOUND");
  });

  // Log hygiene --------------------------------------------------------------------------------

  it("14. no source text, answers, or key material leaks through worker summaries, service receipts or error messages", async () => {
    const activity = await note(ownerA, "Twentieth activity, log hygiene. " + SENTINEL);
    const job = await ownerA.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });

    await assertNoLeak([SENTINEL, "sk-test-WP-SENTINEL-KEY"], async () => {
      const summaries = await drain(fake("valid"));
      return summaries;
    });
    await assertNoLeak([SENTINEL], () => ownerA.review.getAnalysisView(activity.activityId));
    await assertNoLeak([SENTINEL, FAKE_ANSWER], () =>
      ownerA.review.answerQuestions({ jobId: job.jobId, expectedRevision: 1, answers: { outcome: FAKE_ANSWER } }));
    await assertNoLeak([SENTINEL], () => ownerA.review.applySuggestion({ jobId: job.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null }));
    // Error paths, including a malformed-result failure and a cross-account NOT_FOUND.
    await assertNoLeak([SENTINEL], () => ownerB.review.getAnalysisView(activity.activityId));
    const badActivity = await note(ownerA, "Twenty-first activity, malformed. " + SENTINEL);
    const badJob = await ownerA.jobs.requestAnalysis({ activityId: badActivity.activityId, expectedRevision: 1 });
    await assertNoLeak([SENTINEL], () => drain(fake("malformed")));
    await assertNoLeak([SENTINEL], () => ownerA.review.applySuggestion({ jobId: badJob.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null }));
  });
});
