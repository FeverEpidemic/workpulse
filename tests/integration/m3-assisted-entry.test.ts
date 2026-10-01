import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import type { DetectInput } from "@/domain/ai/minimize";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { AiServiceError } from "@/features/ai/ai-errors";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { ImportServiceError } from "@/features/import/import-errors";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createImportService } from "@/features/import/import-service";
import { ExplicitTestFakeAIProvider, type FakeAIScenario } from "@/server/ai/fake-provider";
import type { AIProvider } from "@/server/ai/provider";
import { resolveAIProvider } from "@/server/ai/resolve-provider";
import { resolveDocxRenderer } from "@/server/documents/docx-renderer";
import { parseInThread } from "@/server/documents/parse-in-thread";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { resolveMalwareScanner, type MalwareScanner } from "@/server/storage/malware-scanner";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { getSupabaseAdminConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";
import { CV_LINES, cvDocx, cvPdf, DOCX_MIME, PDF_MIME } from "../import-fixtures";

/**
 * Gate M3 (Assisted entry): F01 import and F02 assisted capture together, per
 * IMPLEMENTATION_PLAN §5 "lolos bersama malformed file, retry, consent withdrawal,
 * AI unavailable dan stale-result scenarios". Each scenario runs both flows in one
 * account through the real worker gateways, local Supabase, Storage and ClamAV.
 */

const RUN = randomUUID().slice(0, 8);
const NOTE_SENTINEL = `WP-M3-NOTE-SENTINEL-${RUN}`;
const CV_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL"; // first line of CV_LINES
const FILENAME_SENTINEL = `cv-WP-M3-FILENAME-${RUN}.pdf`;

type Client = SupabaseClient<Database>;
type Account = {
  id: string;
  client: Client;
  consent: ReturnType<typeof createAiConsentService>;
  imports: ReturnType<typeof createImportService>;
  importReview: ReturnType<typeof createImportReviewService>;
  activities: ReturnType<typeof createActivityService>;
  achievements: ReturnType<typeof createAchievementService>;
  jobs: ReturnType<typeof createAiJobService>;
  review: ReturnType<typeof createAiReviewService>;
};

let admin: Client;
let adminConfig: { url: string; secretKey: string };
let importGateway: ReturnType<typeof createSupabaseImportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let scanner: MalwareScanner;
const users: string[] = [];
/** Worker summaries and error payloads: must never carry CV text, note text or file names. */
const observed: string[] = [];
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

const renderer = resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages: async () => ({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" }) });

async function createAccount(label: string, options: { onboarded: boolean; consent: boolean }): Promise<Account> {
  const email = `m3-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("m3 fixture creation failed");
  const id = created.data.user.id;
  users.push(id);
  const client = createClient<Database>(adminConfig.url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("m3 fixture sign-in failed");
  const account: Account = {
    id, client,
    consent: createAiConsentService(client),
    imports: createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: id }),
    importReview: createImportReviewService({ client }),
    activities: createActivityService(client),
    achievements: createAchievementService(client),
    jobs: createAiJobService(client),
    review: createAiReviewService(client),
  };
  if (options.consent) await setConsent(account, true);
  if (options.onboarded) {
    const { data } = await client.from("profiles").select("revision").eq("id", id).single();
    const done = await client.rpc("complete_onboarding", {
      p_display_name: `M3 ${label}`, p_locale: "en", p_timezone: "Asia/Jakarta", p_expected_revision: data!.revision,
    });
    if (done.error) throw new Error("m3 onboarding fixture failed");
  }
  return account;
}

async function setConsent(acc: Account, consented: boolean) {
  const { data } = await acc.client.from("profiles").select("revision").eq("id", acc.id).single();
  await acc.consent.setConsent({ expectedRevision: data!.revision, consented });
}

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}

/** A CV unique to this run and label, so no duplicate-hash warning links scenarios. */
function cvFor(label: string, extra: string[] = []) {
  const lines = [...CV_LINES.slice(0, -1), ...extra, `${CV_LINES[CV_LINES.length - 1]} (${label}-${RUN})`];
  return cvPdf(1, lines);
}

function upload(acc: Account, bytes: Uint8Array, mime = PDF_MIME) {
  return acc.imports.upload({
    idempotencyKey: randomUUID(), filename: encodeURIComponent(FILENAME_SENTINEL), contentType: mime,
    contentLength: String(bytes.byteLength), body: body(bytes),
  });
}

async function batchRow(id: string) {
  const { data, error } = await admin.from("import_batches").select("*").eq("id", id).single();
  if (error || !data) throw new Error("batch unavailable");
  return data;
}

async function jobRow(id: string) {
  const { data, error } = await admin.from("ai_jobs").select("*").eq("id", id).single();
  if (error || !data) throw new Error("job unavailable");
  return data;
}

async function stagedCount(batchId: string) {
  const { count } = await admin.from("import_items").select("id", { count: "exact", head: true }).eq("batch_id", batchId);
  return count ?? 0;
}

async function canonicalCount(acc: Account): Promise<number> {
  let total = 0;
  for (const table of ["experiences", "education", "certifications", "skills", "projects", "achievements"] as const) {
    const { count, error } = await acc.client.from(table).select("id", { count: "exact", head: true }).eq("user_id", acc.id);
    if (error) throw new Error("count unavailable");
    total += count ?? 0;
  }
  return total;
}

async function importObjects(userId: string): Promise<string[]> {
  const { data } = await admin.storage.from(PRIVATE_STORAGE_BUCKET).list(`${userId}/import`);
  return (data ?? []).map((object) => object.name);
}

async function importPass() {
  observed.push(JSON.stringify(await runImportWorkerOnce({ ...importGateway, scanner, renderer, parse: parseInThread })));
}

async function aiPass(provider: AIProvider) {
  const summary = await runAiWorkerOnce({ database: aiGateway, provider });
  observed.push(JSON.stringify(summary));
  return summary;
}

/** Run the import worker until the batch waits for the AI step (or leaves the worker stages). */
async function untilExtracting(batchId: string) {
  for (let pass = 0; pass < 20; pass += 1) {
    const row = await batchRow(batchId);
    if (row.stage === "extracting" || !["queued", "running"].includes(row.status)) return row;
    await importPass();
  }
  return batchRow(batchId);
}

/** Drain the shared AI queue (import extraction and detect/refine jobs alike) with one provider. */
async function drainAi(provider: AIProvider) {
  for (let pass = 0; pass < 50; pass += 1) {
    const summary = await aiPass(provider);
    if (!summary.aiJobsClaimed && !summary.aiExpiredLeases) return;
  }
  throw new Error("AI queue did not drain");
}

async function note(acc: Account, text: string, extra: { outcome?: string | null; experienceId?: string | null } = {}) {
  return acc.activities.createActivity({
    operationKey: randomUUID(), captureMode: "note", rawText: `${text} ${NOTE_SENTINEL}`, occurredOn: "2026-09-20",
    role: null, scope: null, outcome: extra.outcome ?? null, experienceId: extra.experienceId ?? null, projectId: null,
  });
}

async function activityRow(acc: Account, id: string) {
  return (await acc.activities.getActivity(id)).activity;
}

async function aiCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiServiceError) {
      observed.push(JSON.stringify({ code: error.code, message: error.message }));
      return error.code;
    }
    throw error;
  }
  throw new Error("expected AiServiceError");
}

async function importCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ImportServiceError) {
      observed.push(JSON.stringify({ code: error.code, message: error.message }));
      return error.code;
    }
    throw error;
  }
  throw new Error("expected ImportServiceError");
}

/** Manual F02→F03 path: a derived draft confirmed by hand, with no AI involvement. */
async function manualConfirm(acc: Account, activityId: string) {
  const created = await acc.achievements.createAchievement({ operationKey: randomUUID(), activityId, projectId: null, experienceId: null });
  return acc.achievements.saveAchievement({
    achievementId: created.achievementId, expectedRevision: 1, action: "confirm",
    changes: { title: "Manual title", contribution: "Manual contribution", scope: "", outcome: "Manual outcome", cvBullet: "", achievedOn: "2026-09-20", metrics: [] },
    skillNames: [],
  });
}

/** Provider calls that belong to this suite (the local AI queue is shared with other suites). */
const ownCalls = (provider: ExplicitTestFakeAIProvider) => ({
  detect: provider.calls.filter((input: DetectInput) => input.raw_text.includes(NOTE_SENTINEL)).length,
  import: provider.importCalls.filter((input) => input.text.includes(CV_SENTINEL)).length,
});

const fake = (scenario: FakeAIScenario = "valid") => new ExplicitTestFakeAIProvider(scenario);

describe("Gate M3: F01 import and F02 assisted capture together", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error("Local Supabase environment required");
    adminConfig = config;
    admin = createClient<Database>(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    importGateway = createSupabaseImportWorkerGateway(config);
    aiGateway = createSupabaseAiWorkerGateway(config);
    scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      consoleSpies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { observed.push(args.map(String).join(" ")); }));
    }
    // Leftover queued AI jobs from interrupted runs of other suites must not consume this suite's passes.
    await drainAi(resolveAIProvider({ mode: "unavailable" }));
  });

  afterAll(async () => {
    for (const spy of consoleSpies) spy.mockRestore();
    for (const id of users) {
      const names = await importObjects(id);
      if (names.length) await admin.storage.from(PRIVATE_STORAGE_BUCKET).remove(names.map((name) => `${id}/import/${name}`));
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("1. journey: a new user imports a CV, onboards through the commit, then captures and confirms an assisted achievement", async () => {
    const user = await createAccount("journey", { onboarded: false, consent: true });
    const view = await upload(user, cvFor("journey"));
    await untilExtracting(view.batchId!);
    const provider = fake("valid");
    await drainAi(provider);
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "review", stage: "done" });

    // F01: explicit review, one achievement confirmed by the user, commit with onboarding.
    const { data: staged } = await admin.from("import_items").select("*").eq("batch_id", view.batchId!);
    const importedAchievement = staged!.find((item) => item.entity_type === "achievement")!;
    const saved = await user.importReview.updateItem({
      item_id: importedAchievement.id, expected_revision: importedAchievement.revision, action: "create", confirm_requested: true,
      payload_patch: { contribution: "Menyusun laporan otomatis", outcome: "Waktu laporan turun dari 5 ke 2 jam", achieved_on: "2021-06-15" },
    });
    const committed = await user.importReview.commit({
      batch_id: view.batchId!, expected_revision: saved.batchRevision,
      onboarding: { display_name: "Rani Import", locale: "id", timezone: "Asia/Jakarta" },
    });
    expect(committed).toMatchObject({ onboarding_completed: true, confirmed_achievements: 1 });
    const { data: experience } = await user.client.from("experiences").select("*").eq("user_id", user.id).eq("organization", "PT Sentinel Nusantara").single();
    const { data: importedRows } = await user.client.from("achievements").select("*").eq("user_id", user.id).eq("origin", "import").order("id");

    // F02: a note linked to the imported experience, analysed, reviewed as draft, confirmed.
    const activity = await note(user, "Migrated 3 reports to the new pipeline.", { outcome: "Reports now refresh daily", experienceId: experience!.id });
    const receipt = await user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drainAi(provider);
    const analysis = await user.review.getAnalysisView(activity.activityId);
    expect(analysis.view).toMatchObject({ state: "suggestion", canApply: true });
    const applied = await user.review.applySuggestion({ jobId: receipt.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null });
    const { data: draft } = await user.client.from("achievements").select("*").eq("id", applied.achievementId).single();
    expect(draft).toMatchObject({ status: "draft", origin: "activity", experience_id: experience!.id });
    const confirmed = await user.achievements.saveAchievement({
      achievementId: applied.achievementId, expectedRevision: applied.achievementRevision, action: "confirm",
      changes: {
        title: draft!.title ?? "", contribution: draft!.contribution ?? "", scope: draft!.scope ?? "", outcome: draft!.outcome ?? "",
        cvBullet: draft!.cv_bullet ?? "", achievedOn: draft!.achieved_on, metrics: (draft!.metrics ?? []) as never,
      },
      skillNames: [],
    });
    expect(confirmed.status).toBe("confirmed");

    // The assisted flow never touched imported rows, and each provider call carried only its own minimized input.
    const { data: importedAfter } = await user.client.from("achievements").select("*").eq("user_id", user.id).eq("origin", "import").order("id");
    expect(importedAfter).toEqual(importedRows);
    expect(ownCalls(provider)).toEqual({ detect: 1, import: 1 });
    expect(Object.keys(provider.importCalls.find((input) => input.text.includes(CV_SENTINEL))!)).toEqual(["text"]);
    const detectInput = provider.calls.find((input) => input.raw_text.includes(NOTE_SENTINEL))!;
    expect(JSON.stringify(detectInput)).not.toContain(CV_SENTINEL);
    expect(JSON.stringify(detectInput)).not.toContain("Rani Import");

    const dashboard = await createDashboardService(user.client).getDashboard();
    expect(dashboard.summary).toMatchObject({ confirmedAchievementCount: 2, hasCareerRecords: true });
  });

  it("2. consent withdrawal stops a queued import extraction and a queued analysis, keeps manual paths, and both recover after allow + retry", async () => {
    const user = await createAccount("withdraw", { onboarded: true, consent: true });
    const before = await canonicalCount(user);
    const view = await upload(user, cvFor("withdraw"));
    expect(await untilExtracting(view.batchId!)).toMatchObject({ status: "running", stage: "extracting" });
    const activity = await note(user, "Prepared the quarterly review deck.");
    const receipt = await user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });

    await setConsent(user, false);
    const provider = fake("valid");
    await drainAi(provider);
    expect(ownCalls(provider)).toEqual({ detect: 0, import: 0 });
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "failed", error_code: "CONSENT_REQUIRED" });
    expect(await stagedCount(view.batchId!)).toBe(0);
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", result: null });
    expect(await user.imports.getView(view.batchId!)).toMatchObject({ state: "failed_retriable", canRetry: false, retryBlockReason: "consent" });
    expect((await user.review.getAnalysisView(activity.activityId)).view).toMatchObject({ state: "failed", canRetry: false });
    expect(await importCode(user.imports.retry(view.batchId!))).toBe("CONSENT_REQUIRED");
    expect(await aiCode(user.jobs.retryJob({ jobId: receipt.jobId }))).toBe("CONSENT_REQUIRED");
    expect(await aiCode(user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 }))).toBe("CONSENT_REQUIRED");

    // Manual paths stay open without consent: capture, derived draft, confirm.
    const manual = await note(user, "Onboarded two new analysts.");
    expect((await activityRow(user, manual.activityId)).analysis_state).toBe("not_requested");
    expect((await manualConfirm(user, activity.activityId)).status).toBe("confirmed");
    expect(await canonicalCount(user)).toBe(before + 1); // only the manual achievement

    await setConsent(user, true);
    expect((await user.imports.retry(view.batchId!)).state).toBe("extracting");
    const second = await note(user, "Automated 4 weekly exports.");
    await user.jobs.requestAnalysis({ activityId: second.activityId, expectedRevision: 1 });
    await drainAi(provider);
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "review", retry_count: 1 });
    expect((await user.review.getAnalysisView(second.activityId)).view.state).toBe("suggestion");
    expect(ownCalls(provider)).toEqual({ detect: 1, import: 1 });
  });

  it("2b. consent withdrawn while a provider call is in flight discards the result, for an import and for an analysis", async () => {
    const user = await createAccount("inflight", { onboarded: true, consent: true });
    const view = await upload(user, cvFor("inflight"));
    await untilExtracting(view.batchId!);
    const importProvider = fake("valid");
    importProvider.onImport = async (input) => { if (input.text.includes(CV_SENTINEL)) await setConsent(user, false); };
    await drainAi(importProvider);
    // The CV text already reached the provider: the batch records CONSENT_WITHDRAWN, not CONSENT_REQUIRED.
    expect(ownCalls(importProvider).import).toBe(1);
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "failed", error_code: "CONSENT_WITHDRAWN" });
    expect(await stagedCount(view.batchId!)).toBe(0);
    expect(await user.imports.getView(view.batchId!)).toMatchObject({
      state: "failed_retriable", errorCode: "CONSENT_WITHDRAWN", canRetry: false, retryBlockReason: "consent",
    });

    await setConsent(user, true);
    const activity = await note(user, "Rewrote the onboarding checklist.");
    const receipt = await user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    const detectProvider = new ExplicitTestFakeAIProvider("valid", async (input) => { if (input.raw_text.includes(NOTE_SENTINEL)) await setConsent(user, false); });
    await drainAi(detectProvider);
    expect(ownCalls(detectProvider).detect).toBe(1);
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "CONSENT_WITHDRAWN", result: null });
    const { count } = await user.client.from("achievements").select("id", { count: "exact", head: true }).eq("activity_id", activity.activityId);
    expect(count).toBe(0);
  });

  it("3. AI unavailable (default worker config) fails both as retriable, keeps manual paths, and explicit retries recover", async () => {
    const user = await createAccount("unavailable", { onboarded: true, consent: true });
    const before = await canonicalCount(user);
    const view = await upload(user, cvFor("unavailable"));
    await untilExtracting(view.batchId!);
    const activity = await note(user, "Closed 12 support tickets.");
    const receipt = await user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });

    // resolveAIProvider without configuration is the production default: unavailable.
    expect(process.env.WORKPULSE_AI_MODE).toBeUndefined();
    await drainAi(resolveAIProvider({ nodeEnv: "production" }));
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    expect(await user.imports.getView(view.batchId!)).toMatchObject({ state: "failed_retriable", canRetry: true, retryBlockReason: null });
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE", attempt_count: 1 });
    expect((await user.review.getAnalysisView(activity.activityId)).view).toMatchObject({ state: "failed", canRetry: true });
    expect(await canonicalCount(user)).toBe(before);

    // Manual paths while AI is down.
    const manual = await note(user, "Documented the escalation runbook.");
    expect((await manualConfirm(user, manual.activityId)).status).toBe("confirmed");

    // Retries are independent: the batch retry counter and the analysis attempt counter move separately.
    expect((await user.imports.retry(view.batchId!)).state).toBe("extracting");
    await user.jobs.retryJob({ jobId: receipt.jobId });
    const provider = fake("valid");
    await drainAi(provider);
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "review", retry_count: 1 });
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "succeeded", attempt_count: 2 });
    expect((await user.review.getAnalysisView(activity.activityId)).view.state).toBe("suggestion");
    expect(ownCalls(provider)).toEqual({ detect: 1, import: 1 });
  });

  it("4. malformed files are rejected without a batch, malformed provider output fails both flows as retriable, and a retry recovers", async () => {
    const user = await createAccount("malformed", { onboarded: true, consent: true });
    const batchesBefore = (await admin.from("import_batches").select("id").eq("user_id", user.id)).data!.length;
    const docx = cvDocx();
    expect(await importCode(upload(user, docx.subarray(0, docx.length - 10), DOCX_MIME))).toBe("CORRUPT_FILE");
    expect(await importCode(upload(user, Buffer.from(`plain text ${CV_SENTINEL}`), PDF_MIME))).toBe("UNSUPPORTED_FORMAT");
    expect((await admin.from("import_batches").select("id").eq("user_id", user.id)).data!.length).toBe(batchesBefore);

    const before = await canonicalCount(user);
    const view = await upload(user, cvFor("malformed"));
    await untilExtracting(view.batchId!);
    const activity = await note(user, "Reduced build time from 9 to 4 minutes.");
    const receipt = await user.jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await drainAi(fake("malformed"));
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "failed", error_code: "AI_OUTPUT_INVALID" });
    expect(await stagedCount(view.batchId!)).toBe(0);
    expect(await jobRow(receipt.jobId)).toMatchObject({ status: "failed", error_code: "AI_OUTPUT_INVALID", result: null });
    expect(await aiCode(user.review.applySuggestion({ jobId: receipt.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null }))).toBe("NOT_FOUND");
    expect(await canonicalCount(user)).toBe(before);

    await user.imports.retry(view.batchId!);
    await user.jobs.retryJob({ jobId: receipt.jobId });
    await drainAi(fake("valid"));
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "review" });
    expect((await user.review.getAnalysisView(activity.activityId)).view.state).toBe("suggestion");
    expect(await canonicalCount(user)).toBe(before); // still nothing canonical without an explicit review action
  });

  it("5. stale results never land: cancel and edit during the same worker pass, a suggestion made stale by linking an imported experience, and a stale commit token", async () => {
    const user = await createAccount("stale", { onboarded: true, consent: true });
    // (a) Import cancelled and note edited while both provider calls run.
    const view = await upload(user, cvFor("stale-a"));
    await untilExtracting(view.batchId!);
    const edited = await note(user, "Planned 2 migration waves.");
    const editedJob = await user.jobs.requestAnalysis({ activityId: edited.activityId, expectedRevision: 1 });
    const provider = new ExplicitTestFakeAIProvider("valid", async (input) => {
      if (!input.raw_text.includes(NOTE_SENTINEL)) return;
      const current = await activityRow(user, edited.activityId);
      await user.activities.updateActivity({
        activityId: edited.activityId, expectedRevision: current.revision, rawText: `Planned 3 migration waves. ${NOTE_SENTINEL}`,
        occurredOn: current.occurred_on, role: current.role, scope: current.scope, outcome: current.outcome,
        experienceId: current.experience_id, projectId: current.project_id,
      });
    });
    provider.onImport = async (input) => { if (input.text.includes(CV_SENTINEL)) await user.imports.cancel(view.batchId!); };
    await drainAi(provider);
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "cancelled" });
    expect(await stagedCount(view.batchId!)).toBe(0);
    expect(await jobRow(editedJob.jobId)).toMatchObject({ status: "failed", error_code: "STALE_INPUT", result: null });
    expect((await user.review.getAnalysisView(edited.activityId)).view.state).toBe("stale");

    // (b) A succeeded suggestion becomes stale when the note is linked to an experience from a later import.
    const analysed = await note(user, "Mentored 3 junior analysts.", { outcome: "Two were promoted" });
    const analysedJob = await user.jobs.requestAnalysis({ activityId: analysed.activityId, expectedRevision: 1 });
    await drainAi(fake("valid"));
    expect((await user.review.getAnalysisView(analysed.activityId)).view.state).toBe("suggestion");

    const second = await upload(user, cvFor("stale-b"));
    await untilExtracting(second.batchId!);
    await drainAi(fake("valid"));
    const revision = (await batchRow(second.batchId!)).revision;
    const { data: staged } = await admin.from("import_items").select("*").eq("batch_id", second.batchId!).eq("entity_type", "skill");
    const saved = await user.importReview.updateItem({ item_id: staged![0]!.id, expected_revision: staged![0]!.revision, action: "skip" });
    // (c) The pre-save batch revision is stale: the commit is refused and nothing is written.
    const beforeCommit = await canonicalCount(user);
    expect(await importCode(user.importReview.commit({ batch_id: second.batchId!, expected_revision: revision }))).toBe("STALE");
    expect(await canonicalCount(user)).toBe(beforeCommit);
    await user.importReview.commit({ batch_id: second.batchId!, expected_revision: saved.batchRevision });

    const { data: experience } = await user.client.from("experiences").select("*").eq("user_id", user.id).eq("organization", "PT Sentinel Nusantara").single();
    const current = await activityRow(user, analysed.activityId);
    await user.activities.updateActivity({
      activityId: analysed.activityId, expectedRevision: current.revision, rawText: current.raw_text, occurredOn: current.occurred_on,
      role: current.role, scope: current.scope, outcome: current.outcome, experienceId: experience!.id, projectId: null,
    });
    expect((await user.review.getAnalysisView(analysed.activityId)).view.state).toBe("stale");
    expect(await aiCode(user.review.applySuggestion({ jobId: analysedJob.jobId, expectedActivityRevision: 1, expectedAchievementRevision: null }))).toBe("STALE_INPUT");
    const { count } = await user.client.from("achievements").select("id", { count: "exact", head: true }).eq("activity_id", analysed.activityId);
    expect(count).toBe(0);

    const fresh = await user.jobs.requestAnalysis({ activityId: analysed.activityId, expectedRevision: current.revision + 1 });
    expect(fresh.jobId).not.toBe(analysedJob.jobId);
    await drainAi(fake("valid"));
    const applied = await user.review.applySuggestion({ jobId: fresh.jobId, expectedActivityRevision: current.revision + 1, expectedAchievementRevision: null });
    const { data: draft } = await user.client.from("achievements").select("status, experience_id").eq("id", applied.achievementId).single();
    expect(draft).toEqual({ status: "draft", experience_id: experience!.id });
  });

  it("6. log hygiene: worker summaries, errors and console output never carry CV text, note text or file names", () => {
    const dump = observed.join("\n");
    expect(observed.length).toBeGreaterThan(0);
    for (const sentinel of [CV_SENTINEL, NOTE_SENTINEL, FILENAME_SENTINEL, "PT Sentinel Nusantara"]) expect(dump).not.toContain(sentinel);
  });
});
