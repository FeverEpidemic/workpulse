import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { ImportServiceError } from "@/features/import/import-errors";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createImportService } from "@/features/import/import-service";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
import type { AIProvider } from "@/server/ai/provider";
import { resolveDocxRenderer } from "@/server/documents/docx-renderer";
import { resolvePdfRenderer, type PdfRenderer } from "@/server/export/pdf-renderer";
import { resolveMalwareScanner, type MalwareScanner } from "@/server/storage/malware-scanner";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runAccountDeletionWorkerOnce } from "../../workers/account-deletion-worker.ts";
import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker.ts";
import { runExportWorkerOnce } from "../../workers/export-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";
import { CV_LINES, cvDocx, DOCX_MIME, eicarDocx } from "../import-fixtures";
import {
  BUCKET, createAccount, deleteThroughService, expireLease, getAdmin, getAdminConfig, getDeletionGateway, objectCount,
  profileExists, receipt, required, rowsLeft, runUntilCompleted, setupHarness, sql, teardownHarness, type Account,
} from "./account-deletion-support";
import { assignAiPlan } from "./ai-usage-support";

// Gate M5 (docs/verification/M5-gate-review-plan.md, Fase 4): pilot readiness across T23 deletion, T24 events, decision
// 0032 usage limits and T26 rule extraction, with real Storage, ClamAV, Gotenberg (DOCX page counts) and the real PDF
// renderer. Only the AI provider is the marked test fake; the pilot runs with AI unavailable.
const LONG = 300_000;
const SENTINEL = `WP-M5-PRIVATE-${randomUUID()}`;
const DOCX_RENDERER_URL = process.env.WORKPULSE_GOTENBERG_URL ?? "http://127.0.0.1:13400";
const PDF_RENDERER_URL = process.env.WORKPULSE_PDF_GOTENBERG_URL ?? "http://127.0.0.1:13401";
const nul = null as never;

/** Synthetic Indonesian CV the rule parser reads into education and skills only, so a commit needs no review edits. */
const rulesCv = (marker: string) => cvDocx([
  `Dewi Rekaan ${marker}`,
  "Pendidikan",
  "S1, Teknik Industri, Universitas Rekaan Jaya",
  "2015 - 2019",
  "Keahlian",
  "• Excel • SQL",
]);

/** Records every text the provider receives, so a test can prove an account's text never left. */
class CountingProvider implements AIProvider {
  readonly kind = "fake" as const;
  readonly texts: string[] = [];
  private readonly inner = new ExplicitTestFakeAIProvider("valid");
  detect(...args: Parameters<AIProvider["detect"]>) {
    this.texts.push(JSON.stringify(args[0]));
    return this.inner.detect(...args);
  }
  extractImport(...args: Parameters<AIProvider["extractImport"]>) {
    this.texts.push(args[0].text);
    return this.inner.extractImport(...args);
  }
}

let scanner: MalwareScanner;
let pdf: PdfRenderer;
let importGateway: ReturnType<typeof createSupabaseImportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let exportGateway: ReturnType<typeof createSupabaseExportWorkerGateway>;
let evidenceGateway: ReturnType<typeof createSupabaseEvidenceWorkerGateway>;
const provider = new CountingProvider();
const docx = resolveDocxRenderer({
  mode: "gotenberg", nodeEnv: "test", baseUrl: DOCX_RENDERER_URL,
  countPdfPages: async (bytes: Uint8Array) => {
    const result = await parseInThread("pdf-pages", bytes);
    return result.status === "ok" && result.pageCount !== null
      ? { status: "ok" as const, pageCount: result.pageCount }
      : { status: "error" as const, code: "PAGE_COUNT_UNAVAILABLE" as const };
  },
});

const importService = (account: Account) => createImportService({
  client: account.client, admin: getAdmin(), storage: new SupabaseStorageAdapter(getAdmin()), actorId: account.id,
});

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}

async function upload(account: Account, bytes: Uint8Array, mode: "ai" | "rules") {
  return importService(account).upload({
    idempotencyKey: randomUUID(), filename: encodeURIComponent(`cv-${SENTINEL}.docx`), contentType: DOCX_MIME,
    contentLength: String(bytes.byteLength), extractionMode: mode, body: body(bytes),
  });
}

const batch = (id: string) => JSON.parse(sql(`select row_to_json(b) from (select status, stage, extraction_mode, error_code, purged_at, extracted_text, committed_at from public.import_batches where id = '${id}'::uuid) b`)) as {
  status: string; stage: string; extraction_mode: string; error_code: string | null; purged_at: string | null; extracted_text: string | null; committed_at: string | null;
};
const n = (statement: string) => Number(sql(statement));
/** Units charged today, all buckets (each charge also counts once in the month row). */
const usage = (userId: string) => n(`select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${userId}'::uuid and window_kind = 'day'`);
const usageRows = (userId: string) => n(`select count(*) from internal.ai_usage where user_id = '${userId}'::uuid`);

/** Drives the import pipeline (real ClamAV and Gotenberg, fake AI) until the batch leaves the worker stages. */
async function drive(batchId: string) {
  for (let pass = 0; pass < 25; pass += 1) {
    const row = batch(batchId);
    if (!["queued", "running"].includes(row.status) || row.stage === "uploading") return row;
    if (row.stage === "extracting") await runAiWorkerOnce({ database: aiGateway, provider });
    else await runImportWorkerOnce({ ...importGateway, scanner, renderer: docx, parse: parseInThread, claimLimit: 10 });
  }
  return batch(batchId);
}

/** Skips every item the commit validation rejects, then commits. */
async function commitAll(account: Account, batchId: string) {
  const review = createImportReviewService({ client: account.client });
  for (const error of await review.validate(batchId)) {
    const revision = n(`select revision from public.import_items where id = '${error.item_id}'::uuid`);
    await review.updateItem({ item_id: error.item_id, expected_revision: revision, action: "skip" });
  }
  return review.commit({ batch_id: batchId, expected_revision: n(`select revision from public.import_batches where id = '${batchId}'::uuid`) });
}

async function cvRevision(account: Account) {
  const result = await account.client.from("cv_documents").select("revision").single();
  return required(result.data?.revision, result.error, "cv revision");
}

async function readyCv(account: Account) {
  required((await account.client.rpc("ensure_cv_document")).data, null, "ensure cv");
  const education = await account.client.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Rekaan", p_qualification: "S1", p_field_of_study: nul,
    p_description: nul, p_start_date: nul, p_start_precision: nul, p_end_date: nul, p_end_precision: nul, p_is_current: false,
  });
  const educationId = required(education.data?.[0]?.id, education.error, "education");
  required((await account.client.rpc("select_cv_source", { p_expected_revision: await cvRevision(account), p_source_type: "education", p_source_id: educationId })).data, null, "select");
}

async function requestExport(account: Account): Promise<string> {
  const result = await account.client.rpc("request_cv_export", { p_expected_revision: await cvRevision(account), p_idempotency_key: randomUUID() });
  return required(result.data?.[0]?.export_id, result.error, "export request");
}

async function drainExport(exportId: string, renderer: PdfRenderer) {
  for (let pass = 0; pass < 10; pass += 1) {
    if (!["queued", "running"].includes(sql(`select status from public.cv_exports where id = '${exportId}'::uuid`))) break;
    await runExportWorkerOnce({ ...exportGateway, renderer, parse: parseInThread, claimLimit: 10 });
  }
  return sql(`select status from public.cv_exports where id = '${exportId}'::uuid`);
}

async function note(account: Account, text: string) {
  return createActivityService(account.client).createActivity({
    operationKey: randomUUID(), captureMode: "note", rawText: text, occurredOn: "2026-10-20",
    role: null, scope: null, outcome: null, experienceId: null, projectId: null,
  });
}

async function setConsent(account: Account, consented: boolean) {
  const profile = await account.client.from("profiles").select("revision").eq("id", account.id).single();
  await createAiConsentService(account.client).setConsent({ expectedRevision: required(profile.data?.revision, profile.error, "revision"), consented });
}

async function confirmAchievement(account: Account) {
  const service = createAchievementService(account.client);
  const draft = await service.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: null, experienceId: null });
  await service.saveAchievement({
    achievementId: draft.achievementId, expectedRevision: draft.revision, action: "confirm", skillNames: [],
    changes: { title: "Laporan stok harian", contribution: "Menyusun laporan", scope: "", outcome: "Laporan siap tiap pagi", cvBullet: "", achievedOn: "2026-10-15", metrics: [] },
  });
}

type Metric = { measure: string; cohort_size: number; eligible: number; achieved: number; pending: number };
async function metrics(asOf: string): Promise<Record<string, Metric>> {
  const report = await getAdmin().rpc("get_pilot_metrics", { p_as_of: asOf });
  expect(report.error).toBeNull();
  return Object.fromEntries((report.data ?? []).map((row) => [row.measure, row as Metric]));
}

function health(): Record<string, number> {
  return Object.fromEntries(sql("select metric || '=' || value from public.get_operational_health()").split("\n").filter(Boolean)
    .map((row) => { const [key, value] = row.split("="); return [key!, Number(value)]; }));
}

function opsCheck(thresholds: Record<string, number>): number {
  const names: Record<string, string> = {
    account_deletion_overdue: "WORKPULSE_ALERT_DELETION_OVERDUE", storage_cleanup_failed: "WORKPULSE_ALERT_CLEANUP_FAILED",
    storage_cleanup_overdue: "WORKPULSE_ALERT_CLEANUP_OVERDUE", import_purge_overdue: "WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE",
    export_purge_overdue: "WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE", evidence_stuck: "WORKPULSE_ALERT_EVIDENCE_STUCK",
    jobs_failed_24h: "WORKPULSE_ALERT_JOBS_FAILED_24H", jobs_expired_lease: "WORKPULSE_ALERT_JOBS_EXPIRED_LEASE",
  };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [metric, value] of Object.entries(thresholds)) env[names[metric]!] = String(value);
  try {
    execFileSync(process.execPath, ["workers/ops-check.ts"], { env, stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

let p1: Account;
let p2: Account;
let p3: Account;
let p4: Account;
let outsider: Account;
let limited: Account;
let rulesBatchOfLimited = "";

describe("Gate M5 pilot readiness across deletion, events, AI limits and rule extraction", () => {
  beforeAll(async () => {
    setupHarness();
    const config = getAdminConfig();
    importGateway = createSupabaseImportWorkerGateway(config);
    aiGateway = createSupabaseAiWorkerGateway(config);
    exportGateway = createSupabaseExportWorkerGateway(config);
    evidenceGateway = createSupabaseEvidenceWorkerGateway(config);
    scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
    pdf = resolvePdfRenderer({ mode: "gotenberg", baseUrl: PDF_RENDERER_URL, nodeEnv: "test" });
    expect(docx.kind).toBe("gotenberg");
    expect(pdf.kind).toBe("gotenberg");
    for (const url of [DOCX_RENDERER_URL, PDF_RENDERER_URL]) {
      expect((await fetch(new URL("/health", url)).catch(() => null))?.ok, `${url} must be the real renderer`).toBe(true);
    }
  }, LONG);

  afterAll(async () => {
    await teardownHarness();
  }, LONG);

  it("1. pilot metrics: four enrolled accounts with different patterns and one outsider give exact numerators and denominators", async () => {
    [p1, p2, p3, p4, outsider] = await Promise.all([
      createAccount("m5-p1"), createAccount("m5-p2"), createAccount("m5-p3"), createAccount("m5-p4"), createAccount("m5-outsider"),
    ]);

    // p1: activated by a rules import within 24 hours, nothing else.
    const view = await upload(p1, rulesCv("p1"), "rules");
    expect(await drive(view.batchId!)).toMatchObject({ status: "review", extraction_mode: "rules" });
    const committed = await commitAll(p1, view.batchId!);
    expect(committed.batch_id).toBe(view.batchId);
    const p1Events = sql(`select string_agg(event_name, ',' order by id) from internal.product_events where user_id = '${p1.id}'::uuid`);
    expect(p1Events).toContain("import_committed");
    expect(p1Events).not.toContain("activity_saved");
    expect(n(`select count(*) from internal.product_events where user_id = '${p1.id}'::uuid and event_name = 'import_committed' and (properties->>'created')::int > 0`)).toBe(1);

    // p2: manual record, confirmed achievement and a successful export with the real renderer within 7 days.
    await readyCv(p2);
    await confirmAchievement(p2);
    expect(await drainExport(await requestExport(p2), pdf)).toBe("succeeded");

    // p3: activity in two distinct weeks within 28 days, and one export that fails terminally.
    await note(p3, `${SENTINEL} minggu pertama`);
    await note(p3, `${SENTINEL} minggu kedua`);
    sql(
      `update internal.product_events set local_date = local_date + 10, occurred_at = occurred_at + interval '10 days' where id = ` +
      `(select id from internal.product_events where user_id = '${p3.id}'::uuid and event_name = 'activity_saved' order by id desc limit 1)`,
    );
    await readyCv(p3);
    const failing: PdfRenderer = { kind: "fake", async render() { return { status: "error", code: "RENDERER_UNAVAILABLE" }; } };
    expect(await drainExport(await requestExport(p3), failing)).toBe("failed");

    // outsider: activated and exported, never enrolled. p4 does nothing.
    await note(outsider, `${SENTINEL} di luar kohort`);
    await readyCv(outsider);
    expect(await drainExport(await requestExport(outsider), pdf)).toBe("succeeded");

    const asOf = new Date(Date.now() + 29 * 86_400_000).toISOString();
    const before = await metrics(asOf);
    for (const account of [p1, p2, p3, p4]) {
      const enrolled = await getAdmin().rpc("set_pilot_participant", { p_user_id: account.id, p_consent_version: "pilot-v1", p_enrolled: true });
      required(enrolled.data?.[0], enrolled.error, "enroll");
    }
    const after = await metrics(asOf);
    const delta = (measure: string, field: keyof Metric) => Number(after[measure]![field]) - Number(before[measure]![field]);
    expect([delta("activation", "cohort_size"), delta("activation", "eligible"), delta("activation", "achieved")]).toEqual([4, 4, 3]);
    expect([delta("value_completion", "eligible"), delta("value_completion", "achieved")]).toEqual([3, 1]);
    expect([delta("return_capture", "eligible"), delta("return_capture", "achieved")]).toEqual([3, 1]);
    expect([delta("export_reliability", "eligible"), delta("export_reliability", "achieved")]).toEqual([2, 1]);
    expect(n(`select count(*) from internal.pilot_participants where user_id = '${outsider.id}'::uuid`)).toBe(0);
    expect(n(`select count(*) from internal.product_events where user_id = '${outsider.id}'::uuid and event_name = 'cv_export_finished'`)).toBe(1);
  }, LONG);

  it("2. rules imports past the daily import limit cost no unit; an ai import at the limit is refused and the manual path stays", async () => {
    limited = await createAccount("m5-limited");
    assignAiPlan(limited.id, "free");
    const rulesBatches: string[] = [];
    for (const marker of ["r1", "r2", "r3", "r4"]) rulesBatches.push((await upload(limited, rulesCv(marker), "rules")).batchId!);
    rulesBatchOfLimited = rulesBatches[0]!;
    expect(await drive(rulesBatchOfLimited)).toMatchObject({ status: "review" });
    expect(usageRows(limited.id)).toBe(0);
    expect(n(`select count(*) from public.ai_jobs where user_id = '${limited.id}'::uuid`)).toBe(0);

    await setConsent(limited, true);
    for (const marker of ["a1", "a2", "a3"]) await upload(limited, cvDocx([...CV_LINES, marker]), "ai");
    expect(n(`select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${limited.id}'::uuid and bucket = 'import' and window_kind = 'day'`)).toBe(3);
    const batchesBefore = n(`select count(*) from public.import_batches where user_id = '${limited.id}'::uuid`);
    const refused = await upload(limited, cvDocx([...CV_LINES, "a4"]), "ai").then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(ImportServiceError);
    expect((refused as ImportServiceError).code).toBe("QUOTA_EXCEEDED");
    expect(n(`select count(*) from public.import_batches where user_id = '${limited.id}'::uuid`)).toBe(batchesBefore);
    expect(n(`select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${limited.id}'::uuid and bucket = 'import' and window_kind = 'day'`)).toBe(3);

    const afterLimit = await upload(limited, rulesCv("r5"), "rules");
    expect(batch(afterLimit.batchId!).extraction_mode).toBe("rules");
    expect(n(`select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${limited.id}'::uuid and bucket = 'import' and window_kind = 'day'`)).toBe(3);
    const manual = await note(limited, `${SENTINEL} tetap bisa manual`);
    expect(manual.activityId).toMatch(/^[0-9a-f-]{36}$/);
    const own = await limited.client.rpc("get_ai_usage");
    expect(own.error).toBeNull();
    expect(JSON.stringify(own.data)).toContain("daily");
  }, LONG);

  it("3–4. deletion while every kind of job is active: late workers write nothing, the purge survives a crash, new tables are emptied, other accounts stay", async () => {
    const owner = await createAccount("m5-deleting");
    const bystander = await createAccount("m5-bystander");
    assignAiPlan(owner.id, "free");
    await setConsent(owner, true);
    await setConsent(bystander, true);
    const bystanderActivity = await note(bystander, `${SENTINEL} milik bystander`);
    await createAiJobService(bystander.client).requestAnalysis({ activityId: bystanderActivity.activityId, expectedRevision: 1 });

    // Rules batch queued, AI batch running with a held lease, analysis queued, export running, evidence scanning, a reservation.
    const aiBatch = (await upload(owner, cvDocx([...CV_LINES, SENTINEL]), "ai")).batchId!;
    for (let pass = 0; pass < 10 && batch(aiBatch).stage !== "extracting"; pass += 1) {
      await runImportWorkerOnce({ ...importGateway, scanner, renderer: docx, parse: parseInThread, claimLimit: 10 });
    }
    expect(batch(aiBatch).stage).toBe("extracting");
    // Uploaded after the import pass, so it is still waiting when the deletion starts.
    const queuedRules = (await upload(owner, rulesCv("hapus"), "rules")).batchId!;
    expect(batch(queuedRules)).toMatchObject({ status: "queued", extraction_mode: "rules" });
    const aiImportJob = sql(`select id from public.ai_jobs where import_batch_id = '${aiBatch}'::uuid`);
    const aiToken = randomUUID();
    sql(`update public.ai_jobs set status = 'running', attempt_token = '${aiToken}', attempt_count = attempt_count + 1, started_at = now(), lease_expires_at = now() + interval '120 seconds' where id = '${aiImportJob}'::uuid`);

    const activity = await note(owner, `${SENTINEL} catatan pemilik`);
    await createAiJobService(owner.client).requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    await readyCv(owner);
    const exportId = await requestExport(owner);
    const exportToken = randomUUID();
    sql(`update public.cv_exports set status = 'running', attempt_token = '${exportToken}', attempt_count = 1, started_at = now(), lease_expires_at = now() + interval '120 seconds' where id = '${exportId}'::uuid`);

    const scanningId = randomUUID();
    const reservedId = randomUUID();
    const pdfBytes = new TextEncoder().encode("%PDF-1.4\nwp-m5\n");
    const scanningKey = `${owner.id}/evidence/${scanningId}`;
    const stored = await getAdmin().storage.from(BUCKET).upload(scanningKey, pdfBytes, { contentType: "application/pdf", upsert: false });
    expect(stored.error).toBeNull();
    // Same order as finalize: reserved row, scan job, then the row moves to scanning. The second row stays a live reservation.
    const scanJobId = randomUUID();
    sql(
      `begin; ` +
      `insert into public.evidence_files (id, user_id, activity_id, object_key, original_name, mime_type, bytes, status, reserved_until, parent_revision, idempotency_key, payload_hash) values ` +
      `('${scanningId}', '${owner.id}', '${activity.activityId}', '${scanningKey}', 'bukti-${SENTINEL}.pdf', 'application/pdf', ${pdfBytes.byteLength}, 'uploading', now() + interval '15 minutes', 1, gen_random_uuid(), decode(repeat('ab', 32), 'hex')), ` +
      `('${reservedId}', '${owner.id}', '${activity.activityId}', '${owner.id}/evidence/${reservedId}', 'cadangan.pdf', 'application/pdf', 10, 'uploading', now() + interval '15 minutes', 1, gen_random_uuid(), decode(repeat('cd', 32), 'hex')); ` +
      `insert into internal.evidence_scan_jobs (id, user_id, evidence_id, object_key, expected_bytes, mime_type, sha256) ` +
      `values ('${scanJobId}', '${owner.id}', '${scanningId}', '${scanningKey}', ${pdfBytes.byteLength}, 'application/pdf', repeat('a', 64)); ` +
      `update public.evidence_files set status = 'scanning', reserved_until = null, actual_bytes = bytes, sha256 = repeat('a', 64), scan_job_id = '${scanJobId}' where id = '${scanningId}'; ` +
      `commit;`,
    );
    expect(sql(`select status from public.evidence_files where id = '${scanningId}'::uuid`)).toBe("scanning");
    expect(usage(owner.id)).toBeGreaterThan(0);
    expect(n(`select count(*) from internal.product_events where user_id = '${owner.id}'::uuid`)).toBeGreaterThan(0);
    const bystanderBefore = { usage: usage(bystander.id), events: n(`select count(*) from internal.product_events where user_id = '${bystander.id}'::uuid`), rows: rowsLeft(bystander.id) };
    const healthBefore = health();

    await deleteThroughService(owner);
    const frozen = sql(`select count(*) || '|' || (select count(*) from public.import_items where user_id = '${owner.id}'::uuid) || '|' || (select count(*) from public.achievements where user_id = '${owner.id}'::uuid) from public.ai_jobs where user_id = '${owner.id}'::uuid and status = 'succeeded'`);

    // Late workers: the held leases cannot complete, and fresh passes claim nothing of the account.
    const late = (promise: Promise<unknown>) => promise.then(String, () => "rejected");
    expect(await late(aiGateway.completeImportAiJob(aiImportJob, aiToken, { profile: null } as never, [] as never))).toMatch(/^(stale|failed|rejected)/);
    expect(await late(exportGateway.database.completeCvExport({ exportId, attemptToken: exportToken, objectKey: `${owner.id}/exports/${randomUUID()}.pdf`, pageCount: 1, byteSize: 10 }))).not.toBe("succeeded");
    const textsBefore = provider.texts.length;
    await runAiWorkerOnce({ database: aiGateway, provider });
    await runImportWorkerOnce({ ...importGateway, scanner, renderer: docx, parse: parseInThread, claimLimit: 10 });
    await runEvidenceWorkerOnce({ ...evidenceGateway, scanner });
    expect(provider.texts.slice(textsBefore).some((text) => text.includes(SENTINEL) && text.includes("pemilik")), "no owner text reaches the provider").toBe(false);
    expect(sql(`select count(*) || '|' || (select count(*) from public.import_items where user_id = '${owner.id}'::uuid) || '|' || (select count(*) from public.achievements where user_id = '${owner.id}'::uuid) from public.ai_jobs where user_id = '${owner.id}'::uuid and status = 'succeeded'`)).toBe(frozen);
    expect(sql(`select status from public.cv_exports where id = '${exportId}'::uuid`)).not.toBe("succeeded");

    // A worker that dies in the middle of the purge: its lease is aged and the next pass finishes the job.
    await runAccountDeletionWorkerOnce(getDeletionGateway());
    expireLease(owner.id);
    await runUntilCompleted(owner.id, 12);
    expect(receipt(owner.id)?.status).toBe("completed");
    expect(rowsLeft(owner.id)).toEqual({});
    expect(objectCount(owner.id)).toBe(0);
    expect(profileExists(owner.id)).toBe(false);
    expect(n(`select count(*) from auth.users where id = '${owner.id}'::uuid`)).toBe(0);
    for (const table of ["ai_usage", "ai_plan_assignments", "product_events", "pilot_participants"]) {
      expect(n(`select count(*) from internal.${table} where user_id = '${owner.id}'::uuid`), `internal.${table}`).toBe(0);
    }
    expect(n(`select count(*) from internal.storage_jobs where user_id = '${owner.id}'::uuid and status in ('queued', 'running', 'failed')`)).toBe(0);
    const healthAfter = health();
    expect(healthAfter["account_deletion_overdue"]).toBeLessThanOrEqual(healthBefore["account_deletion_overdue"]!);
    expect(healthAfter["storage_cleanup_failed"]).toBeLessThanOrEqual(healthBefore["storage_cleanup_failed"]!);

    // Scenario 4: the bystander keeps every row, unit and event; the shared capacity has no account column and no negative value.
    expect({ usage: usage(bystander.id), events: n(`select count(*) from internal.product_events where user_id = '${bystander.id}'::uuid`), rows: rowsLeft(bystander.id) }).toEqual(bystanderBefore);
    expect(n(`select count(*) from information_schema.columns where table_schema = 'internal' and table_name = 'ai_capacity_usage' and column_name = 'user_id'`)).toBe(0);
    expect(n(`select count(*) from internal.ai_capacity_usage where units < 0`)).toBe(0);
  }, LONG);

  it("5. committed, cancelled and terminally failed batches of both modes lose file and text after 24 hours; imported records stay", async () => {
    const owner = await createAccount("m5-retention");
    const committedRules = (await upload(owner, rulesCv("simpan"), "rules")).batchId!;
    expect(await drive(committedRules)).toMatchObject({ status: "review" });
    await commitAll(owner, committedRules);
    const cancelled = (await upload(owner, rulesCv("batal"), "rules")).batchId!;
    expect(await drive(cancelled)).toMatchObject({ status: "review" });
    await importService(owner).cancel(cancelled);
    const infected = (await upload(owner, eicarDocx(), "rules")).batchId!;
    expect(await drive(infected)).toMatchObject({ status: "failed", error_code: "MALWARE_DETECTED" });
    await setConsent(owner, true);
    const committedAi = (await upload(owner, cvDocx(CV_LINES), "ai")).batchId!;
    expect(await drive(committedAi)).toMatchObject({ status: "review" });
    await commitAll(owner, committedAi);
    const imported = n(`select (select count(*) from public.education where user_id = '${owner.id}'::uuid) + (select count(*) from public.skills where user_id = '${owner.id}'::uuid) + (select count(*) from public.experiences where user_id = '${owner.id}'::uuid)`);
    expect(imported).toBeGreaterThan(0);

    const batches = [committedRules, cancelled, infected, committedAi];
    sql(
      `update public.import_batches set committed_at = committed_at - interval '25 hours', cancelled_at = cancelled_at - interval '25 hours', ` +
      `failed_at = failed_at - interval '25 hours' where user_id = '${owner.id}'::uuid`,
    );
    for (let pass = 0; pass < 12; pass += 1) {
      await runImportWorkerOnce({ ...importGateway, scanner, renderer: docx, parse: parseInThread, claimLimit: 10 });
      if (batches.every((id) => batch(id).purged_at !== null) && n(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${owner.id}/import/')`) === 0) break;
    }
    for (const id of batches) {
      expect(batch(id).purged_at, `batch ${id} purged`).not.toBeNull();
      expect(batch(id).extracted_text).toBeNull();
      // Committed batches keep item rows as provenance with the staged text removed; the others lose their items.
      expect(n(`select count(*) from public.import_items where batch_id = '${id}'::uuid and (payload is not null or source_excerpt is not null)`)).toBe(0);
    }
    for (const id of [cancelled, infected]) expect(n(`select count(*) from public.import_items where batch_id = '${id}'::uuid`)).toBe(0);
    expect(n(`select count(*) from public.import_items where batch_id in ('${committedRules}', '${committedAi}') and purged_at is not null and committed_id is not null`)).toBeGreaterThan(0);
    expect(n(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${owner.id}/import/')`)).toBe(0);
    expect(n(`select (select count(*) from public.education where user_id = '${owner.id}'::uuid) + (select count(*) from public.skills where user_id = '${owner.id}'::uuid) + (select count(*) from public.experiences where user_id = '${owner.id}'::uuid)`)).toBe(imported);
  }, LONG);

  it("6. consent withdrawn while an analysis is queued: no text leaves, the charged unit stays (decision 0032), a rules import still works", async () => {
    const owner = await createAccount("m5-withdraw");
    await setConsent(owner, true);
    const marker = `${SENTINEL}-tarik`;
    const activity = await note(owner, marker);
    await createAiJobService(owner.client).requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    expect(usage(owner.id)).toBe(1);
    await setConsent(owner, false);
    for (let pass = 0; pass < 6 && sql(`select status from public.ai_jobs where user_id = '${owner.id}'::uuid`) !== "failed"; pass += 1) {
      await runAiWorkerOnce({ database: aiGateway, provider });
    }
    expect(sql(`select status || ':' || coalesce(error_code, '') from public.ai_jobs where user_id = '${owner.id}'::uuid`)).toMatch(/^failed:CONSENT/);
    expect(provider.texts.some((text) => text.includes(marker))).toBe(false);
    expect(usage(owner.id)).toBe(1);
    const view = await upload(owner, rulesCv("tarik"), "rules");
    expect(await drive(view.batchId!)).toMatchObject({ status: "review", extraction_mode: "rules" });
    expect(usage(owner.id)).toBe(1);
  }, LONG);

  it("7. another account gets the same answer for A's usage, rules batch, retry and item as for a random id", async () => {
    const own = await outsider.client.rpc("get_ai_usage");
    expect(own.error).toBeNull();
    expect(JSON.stringify(own.data)).not.toContain(limited.id);
    const itemId = sql(`select id from public.import_items where batch_id = '${rulesBatchOfLimited}'::uuid order by id limit 1`);
    const random = randomUUID();
    const service = importService(outsider);
    const codeOf = (promise: Promise<unknown>) => promise.then(() => "ok", (error: unknown) => (error as ImportServiceError).code ?? "error");
    for (const action of ["getView", "cancel", "retry"] as const) {
      expect(await codeOf(service[action](rulesBatchOfLimited)), action).toBe(await codeOf(service[action](random)));
    }
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const call = outsider.client.rpc as unknown as (fn: string, a: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
      const { error } = await call.call(outsider.client, name, args);
      return `${error?.code ?? ""}|${error?.message ?? ""}`;
    };
    expect(await rpc("retry_import_batch", { p_batch_id: rulesBatchOfLimited })).toBe(await rpc("retry_import_batch", { p_batch_id: random }));
    expect(await rpc("validate_import_batch", { p_batch_id: rulesBatchOfLimited })).toBe(await rpc("validate_import_batch", { p_batch_id: random }));
    expect(await rpc("update_import_item", { p_item_id: itemId, p_expected_revision: 1, p_action: "skip", p_target_id: null, p_payload_patch: null, p_confirm_requested: null }))
      .toBe(await rpc("update_import_item", { p_item_id: random, p_expected_revision: 1, p_action: "skip", p_target_id: null, p_payload_patch: null, p_confirm_requested: null }));
    expect(batch(rulesBatchOfLimited).status).toBe("review");
  }, LONG);

  it("8. a rules job with an expired lease and a failed cleanup raise ops:check to exit 2; once resolved it exits 0", async () => {
    const owner = await createAccount("m5-health");
    const batchId = (await upload(owner, rulesCv("sehat"), "rules")).batchId!;
    const thresholds = health();
    expect(opsCheck(thresholds)).toBe(0);
    const before = health();

    sql(`update internal.import_jobs set status = 'running', attempt_token = gen_random_uuid(), attempt_count = 1, lease_expires_at = now() - interval '11 minutes' where batch_id = '${batchId}'::uuid`);
    const cleanupId = randomUUID();
    sql(`insert into internal.storage_jobs (id, user_id, bucket_id, object_key, status, error_code, attempt_count, attempt_token, finished_at) values ('${cleanupId}', '${owner.id}', '${BUCKET}', '${owner.id}/evidence/${randomUUID()}', 'failed', 'STORAGE_UNAVAILABLE', 1, gen_random_uuid(), now())`);
    const raised = health();
    expect(raised["jobs_expired_lease"]! - before["jobs_expired_lease"]!).toBe(1);
    expect(raised["storage_cleanup_failed"]! - before["storage_cleanup_failed"]!).toBe(1);
    expect(opsCheck(thresholds)).toBe(2);

    sql(`update internal.import_jobs set status = 'queued', attempt_token = null, lease_expires_at = null where batch_id = '${batchId}'::uuid`);
    sql(`delete from internal.storage_jobs where id = '${cleanupId}'::uuid`);
    expect(await drive(batchId)).toMatchObject({ status: "review" });
    expect(opsCheck(thresholds)).toBe(0);
  }, LONG);
});
