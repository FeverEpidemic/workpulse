import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCvExportService } from "@/features/cv/export-service";
import { CvServiceError } from "@/features/cv/cv-errors";
import { ProjectServiceError, createProjectService } from "@/features/project/project-service";
import { ExplicitTestFakeDocxRenderer } from "@/server/documents/docx-renderer";
import type { AIProvider } from "@/server/ai/provider";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runExportWorkerOnce } from "../../workers/export-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";

import {
  SENTINEL,
  authUserExists,
  createAccount,
  deleteThroughService,
  expireLease,
  getAdmin,
  getAdminConfig,
  getDeletionGateway,
  getPublicConfig,
  objectCount,
  profileExists,
  receipt,
  registerAgain,
  required,
  rpcAny,
  rowsLeft,
  runPasses,
  runUntilCompleted,
  seedAccount,
  seedQueuedWork,
  sentinelHits,
  signIn,
  setupHarness,
  sql,
  storageJobs,
  teardownHarness,
} from "./account-deletion-support";

const LONG = 150_000;
const durations: number[] = [];

beforeAll(() => setupHarness());
afterAll(async () => {
  await teardownHarness();
  if (durations.length > 0) process.stdout.write(`ACCOUNT-DELETION-DURATION-SECONDS ${JSON.stringify(durations)}\n`);
});

describe("T23 account deletion: full path with real Auth, Storage and workers", () => {
  it("deletes rows, objects and the Auth user, keeps the queue, and leaves another account untouched", async () => {
    const a = await createAccount("full-a");
    const b = await createAccount("full-b");
    await seedAccount(a);
    await seedAccount(b);
    const bRowsBefore = rowsLeft(b.id);
    const bObjectsBefore = objectCount(b.id);
    expect(Object.keys(rowsLeft(a.id)).length).toBeGreaterThanOrEqual(8);
    expect(objectCount(a.id)).toBe(4);

    const result = await deleteThroughService(a);
    expect(result).toEqual({ revokeDeferred: false });
    expect(receipt(a.id)).toMatchObject({ status: "queued", attempt_count: 0 });
    expect(sql(`select deleting_at is not null from public.profiles where id = '${a.id}'`)).toBe("t");

    const rounds = await runUntilCompleted(a.id);
    expect(rounds).toBeLessThan(12);

    const done = receipt(a.id)!;
    expect(done.status).toBe("completed");
    expect(done.requested_at).not.toBeNull();
    expect(done.objects_enqueued_at).not.toBeNull();
    expect(done.rows_purged_at).not.toBeNull();
    expect(done.auth_deleted_at).not.toBeNull();
    expect(done.completed_at).not.toBeNull();
    expect(done.last_error_code).toBeNull();
    durations.push(Math.round((done.seconds ?? 0) * 10) / 10);
    expect(done.seconds ?? Number.POSITIVE_INFINITY).toBeLessThan(24 * 3600);

    expect(rowsLeft(a.id)).toEqual({});
    expect(profileExists(a.id)).toBe(false);
    expect(authUserExists(a.id)).toBe(false);
    expect(objectCount(a.id)).toBe(0);
    expect(storageJobs(a.id)).toMatchObject({ open: 0 });
    expect(storageJobs(a.id).total).toBeGreaterThanOrEqual(4);

    // The private sentinel of account A is gone from every public table; account B still holds its own.
    expect(sentinelHits()).toBeGreaterThan(0);
    expect(sql(`select count(*) from public.activities where user_id = '${a.id}' and raw_text like '%${SENTINEL}%'`)).toBe("0");
    expect(sql(`select count(*) from public.evidence_files where user_id = '${a.id}'`)).toBe("0");

    // Account B: rows, objects and its own sentinel survive; its sessions still work.
    expect(rowsLeft(b.id)).toEqual(bRowsBefore);
    expect(objectCount(b.id)).toBe(bObjectsBefore);
    expect(sql(`select count(*) from public.activities where user_id = '${b.id}' and raw_text like '%${SENTINEL}%'`)).toBe("1");
    expect((await b.client.auth.getUser()).data.user?.id).toBe(b.id);
  }, LONG);

  it("never marks a receipt completed while an object or an open cleanup job is left", async () => {
    const a = await createAccount("hold");
    const seeded = await seedAccount(a);
    await deleteThroughService(a);
    // One pass purges and queues cleanup, but the cleanup passes have not yet removed every object.
    await getDeletionGateway().database.verifyAccountPurges(100);
    expect(receipt(a.id)?.status).toBe("queued");
    await runPasses();
    const during = receipt(a.id)!;
    if (objectCount(a.id) > 0 || storageJobs(a.id).open > 0) expect(during.status).not.toBe("completed");
    await runUntilCompleted(a.id);
    expect(receipt(a.id)?.status).toBe("completed");
    expect(objectCount(a.id)).toBe(0);
    expect(seeded.orphanKey).toContain(a.id);
  }, LONG);
});

describe("T23 account deletion: a restarted worker loses nothing", () => {
  async function crashAt(step: "claimed" | "purged" | "auth_deleted", label: string) {
    const account = await createAccount(label);
    await seedAccount(account);
    await deleteThroughService(account);

    let oldToken = "";
    const crashed = await runPasses({
      onStep: (reached, job) => {
        oldToken = job.attempt_token;
        if (reached === step) throw new Error("simulated crash");
      },
    });
    expect(crashed.accountDeletionsErrored).toBe(1);
    expect(receipt(account.id)).toMatchObject({ status: "running", has_token: true });
    expect(receipt(account.id)?.auth_deleted_at).toBeNull();

    // While the lease is alive nobody else may take the job.
    const parallel = await getDeletionGateway().database.claimAccountDeletionJobs(5);
    expect(parallel.filter((job) => job.user_id === account.id)).toHaveLength(0);

    expireLease(account.id);
    const rounds = await runUntilCompleted(account.id);
    expect(rounds).toBeLessThan(12);
    expect(receipt(account.id)).toMatchObject({ status: "completed" });
    expect(rowsLeft(account.id)).toEqual({});
    expect(authUserExists(account.id)).toBe(false);
    expect(objectCount(account.id)).toBe(0);

    // The token of the crashed attempt can no longer finish or retry anything.
    expect(await getDeletionGateway().database.markAccountAuthDeleted(account.id, oldToken)).toBe(false);
    expect(await getDeletionGateway().database.retryAccountDeletionJob({
      userId: account.id, attemptToken: oldToken, errorCode: "AUTH_DELETE_FAILED", nextAttemptAt: new Date().toISOString(),
    })).toBe(false);
    return receipt(account.id)!;
  }

  it("resumes after a crash right after the claim", async () => {
    const done = await crashAt("claimed", "crash-claim");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
  }, LONG);

  it("resumes after a crash right after the purge: the second purge is a no-op", async () => {
    const done = await crashAt("purged", "crash-purge");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
  }, LONG);

  it("resumes after a crash right after the Auth user was deleted: a 404 counts as done", async () => {
    const done = await crashAt("auth_deleted", "crash-auth");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
    expect(done.auth_deleted_at).not.toBeNull();
  }, LONG);
});

describe("T23 account deletion: the Auth admin adapter", () => {
  it("treats a user that does not exist as not_found and rejects a malformed id", async () => {
    const { auth } = getDeletionGateway();
    await expect(auth.deleteUser("5f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f")).resolves.toBe("not_found");
    await expect(auth.deleteUser("not-a-uuid")).rejects.toMatchObject({ code: "WORKER_AUTH_UNAVAILABLE" });
    expect(getAdmin()).toBeDefined();
  });
});

const DELETING = ["ACCOUNT_DELETING", "AUTH_REQUIRED"];

function expectDenied(result: { error: { code?: string; message?: string } | null }, label: string) {
  expect(result.error?.code, `${label}: code`).toBe("42501");
  expect(DELETING, `${label}: message`).toContain(result.error?.message);
}

describe("T23 guard: a deleting account cannot write or download through any RPC, even with a live session", () => {
  it("rejects user RPCs of every domain with 42501, the same code the services map to UNAUTHENTICATED", async () => {
    const g = await createAccount("guard");
    const seeded = await seedAccount(g);
    const skill = required((await g.client.from("skills").select("id, revision").eq("user_id", g.id).limit(1).single()).data, null, "skill");

    // Mark the account deleting without revoking the session, to prove the database refuses on its own.
    const begun = await getAdmin().rpc("begin_account_deletion", { p_user_id: g.id });
    expect(begun.error).toBeNull();
    // Starting the deletion bumped the profile revision; use the current one so the refusal comes from the guard.
    const profile = required((await getAdmin().from("profiles").select("revision").eq("id", g.id).single()).data, null, "profile");

    const calls: [string, string, Record<string, unknown>][] = [
      ["profile", "update_profile", { p_expected_revision: profile.revision, p_changes: { headline: "x" } }],
      ["foundation create", "create_education_idempotent", { p_operation_key: randomUUID(), p_institution: "Inst", p_qualification: "S1", p_field_of_study: null, p_description: null, p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false }],
      ["foundation update", "update_skill", { p_skill_id: skill.id, p_expected_revision: skill.revision, p_changes: { name: "Baru" } }],
      ["foundation delete", "delete_skill", { p_skill_id: skill.id, p_expected_revision: skill.revision }],
      ["activity", "create_activity_idempotent", { p_operation_key: randomUUID(), p_raw_text: "Teks", p_occurred_on: "2026-10-01", p_capture_mode: "note", p_role: null, p_scope: null, p_outcome: null, p_experience_id: null, p_project_id: null }],
      ["project", "create_project_idempotent", { p_operation_key: randomUUID(), p_title: "Proyek", p_description: null, p_user_role: null, p_outcome: null, p_status: "ongoing", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false, p_experience_id: null }],
      ["achievement", "create_achievement_idempotent", { p_operation_key: randomUUID(), p_activity_id: seeded.activityId, p_project_id: null, p_experience_id: null }],
      ["import start", "begin_import_batch", { p_idempotency_key: randomUUID(), p_filename: "cv.pdf", p_bytes: 10, p_mime_type: "application/pdf", p_sha256: "a".repeat(64) }],
      ["AI request", "request_ai_analysis", { p_activity_id: seeded.activityId, p_expected_revision: 1 }],
      ["AI consent", "set_ai_consent", { p_expected_revision: profile.revision, p_consented: true }],
      ["CV select", "select_cv_source", { p_expected_revision: seeded.cvRevision, p_source_type: "skill", p_source_id: skill.id }],
      ["CV save", "save_cv_edits", { p_expected_revision: seeded.cvRevision, p_edits: { item_overrides: [] } }],
      ["export request", "request_cv_export", { p_expected_revision: seeded.cvRevision, p_idempotency_key: randomUUID() }],
      ["export retry", "retry_cv_export", { p_export_id: seeded.exportId }],
      ["export download", "get_cv_export_download", { p_export_id: seeded.exportId }],
      ["deletion preview", "get_account_deletion_preview", {}],
    ];
    for (const [label, name, args] of calls) expectDenied(await rpcAny(g.client, name, args), label);

    // The same code reaches the services, which map it to UNAUTHENTICATED.
    await expect(createProjectService(g.client).createProject({
      operationKey: randomUUID(), title: "Proyek", description: null, userRole: null, outcome: null, status: "completed",
      experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false,
    })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const exports = createCvExportService({ supabase: g.client, getStorage: () => { throw new Error("storage must not be built"); } });
    await expect(exports.requestExport({ expected_revision: seeded.cvRevision, idempotency_key: randomUUID() })).rejects.toBeInstanceOf(CvServiceError);
    await expect(exports.requestExport({ expected_revision: seeded.cvRevision, idempotency_key: randomUUID() })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(exports.retryExport({ export_id: seeded.exportId })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(ProjectServiceError).toBeDefined();

    // Evidence download goes through the service role RPC; it refuses a deleting owner too.
    const evidence = sql(`select id from public.evidence_files where user_id = '${g.id}' limit 1`);
    const download = await getAdmin().rpc("get_evidence_file", { p_user_id: g.id, p_evidence_id: evidence });
    expect(download.error !== null || (Array.isArray(download.data) ? download.data.length === 0 : download.data === null)).toBe(true);

    // Nothing was written by the refused calls.
    expect(sql(`select count(*) from public.education where user_id = '${g.id}' and institution = 'Inst'`)).toBe("0");
    expect(sql(`select count(*) from public.projects where user_id = '${g.id}'`)).toBe("0");
    expect(sql(`select count(*) from public.cv_exports where user_id = '${g.id}'`)).toBe("1");
  }, LONG);
});

describe("T23 sessions: deletion revokes access at once", () => {
  it("signs the account out everywhere, refuses a refresh and a new sign-in, and still blocks writes with an old access token", async () => {
    const account = await createAccount("sessions");
    await seedAccount(account);
    const second = await signIn(account);
    const secondSession = required(second.data.session, second.error, "second session");
    expect((await second.client.auth.getUser()).data.user?.id).toBe(account.id);

    await deleteThroughService(account);

    // Both browsers lose access on their next request.
    expect((await account.client.auth.getUser()).error).not.toBeNull();
    expect((await second.client.auth.getUser()).error).not.toBeNull();

    // The refresh token of the other browser is rejected.
    const refreshing = createClient(getPublicConfig().url, getPublicConfig().publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const refreshed = await refreshing.auth.refreshSession({ refresh_token: secondSession.refresh_token });
    expect(refreshed.error).not.toBeNull();
    expect(refreshed.data.session).toBeNull();

    // Signing in again is refused with the generic credentials error shape (the ban is checked before the password).
    const again = await signIn(account);
    expect(again.data.session).toBeNull();
    expect(again.error?.code).toBe("user_banned");

    // A JWT that was already issued still verifies until it expires (jwt_expiry is 3600). Writes still fail in the database.
    const stale = createClient(getPublicConfig().url, getPublicConfig().publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${secondSession.access_token}` } },
    });
    expectDenied(await rpcAny(stale, "update_skill", {
      p_skill_id: sql(`select id from public.skills where user_id = '${account.id}' limit 1`) || randomUUID(), p_expected_revision: 1, p_changes: { name: "Baru" },
    }), "stale token write");
  }, LONG);
});

describe("T23 jobs: nothing queued for a deleting account reaches a provider, parser, renderer or storage upload", () => {
  it("fails or skips the queued AI, import and export work without calling any adapter", async () => {
    const account = await createAccount("jobs");
    const seeded = await seedAccount(account);
    const queued = await seedQueuedWork(account, seeded);
    expect((await getAdmin().rpc("begin_account_deletion", { p_user_id: account.id })).error).toBeNull();

    const config = { url: getAdminConfig().url, secretKey: getAdminConfig().secretKey };
    const calls = { provider: 0, scan: 0, parse: 0, render: 0, upload: 0 };

    const provider: AIProvider = {
      kind: "fake",
      async detect() { calls.provider += 1; return { status: "error", code: "AI_UNAVAILABLE" }; },
      async extractImport() { calls.provider += 1; return { status: "error", code: "AI_UNAVAILABLE" }; },
    };
    await runAiWorkerOnce({ database: createSupabaseAiWorkerGateway(config), provider });

    const importGateway = createSupabaseImportWorkerGateway(config);
    await runImportWorkerOnce({
      ...importGateway,
      scanner: { scan: async () => { calls.scan += 1; return { status: "clean" }; } } as never,
      renderer: new ExplicitTestFakeDocxRenderer(),
      parse: async (...args) => { calls.parse += 1; return parseInThread(...args); },
    });

    const exportGateway = createSupabaseExportWorkerGateway(config);
    await runExportWorkerOnce({
      database: exportGateway.database,
      storage: { ...exportGateway.storage, uploadObject: async () => { calls.upload += 1; } },
      renderer: { kind: "fake", async render() { calls.render += 1; return { status: "error", code: "RENDERER_UNAVAILABLE" }; } },
      parse: async (...args) => { calls.parse += 1; return parseInThread(...args); },
    });

    expect(calls).toEqual({ provider: 0, scan: 0, parse: 0, render: 0, upload: 0 });
    expect(sql(`select status || ',' || coalesce(error_code, '') from public.cv_exports where id = '${queued.queuedExportId}'`)).toBe("failed,ACCOUNT_DELETING");
    expect(sql(`select status from public.ai_jobs where id = '${queued.aiJobId}'`)).not.toBe("succeeded");
    expect(sql(`select status from internal.import_jobs where id = '${queued.importJobId}'`)).not.toBe("succeeded");

    // The deletion itself still finishes.
    await runUntilCompleted(account.id);
    expect(receipt(account.id)?.status).toBe("completed");
    expect(rowsLeft(account.id)).toEqual({});
  }, LONG);
});

describe("T23 isolation and re-registration", () => {
  it("lets a deleted email register again as a new, empty account, and B cannot start A's deletion", async () => {
    const a = await createAccount("reuse-a");
    const b = await createAccount("reuse-b");
    await seedAccount(a);
    await seedAccount(b);

    // B has no way to start A's deletion: the RPC is service-role only and the service takes the user from B's session.
    const direct = await rpcAny(b.client, "begin_account_deletion", { p_user_id: a.id });
    expect(direct.error?.code).toBe("42501");
    expect(sql(`select deleting_at is null from public.profiles where id = '${a.id}'`)).toBe("t");
    expect(receipt(a.id)).toBeNull();

    await deleteThroughService(a);
    await runUntilCompleted(a.id);
    expect(receipt(a.id)?.status).toBe("completed");
    expect(sql(`select deleting_at is null from public.profiles where id = '${b.id}'`)).toBe("t");

    const fresh = await registerAgain(a.email);
    expect(fresh.id).not.toBe(a.id);
    const profileRow = required((await fresh.client.from("profiles").select("id, onboarding_completed_at, deleting_at").eq("id", fresh.id).single()).data, null, "new profile");
    expect(profileRow).toMatchObject({ onboarding_completed_at: null, deleting_at: null });
    expect(rowsLeft(fresh.id)).toEqual({});
    expect(sql(`select count(*) from public.activities where user_id = '${fresh.id}'`)).toBe("0");
    expect(sql(`select count(*) from public.cv_documents where user_id = '${fresh.id}'`)).toBe("0");
  }, LONG);
});

describe("T23 cleanup reconciliation and backlog", () => {
  it("requeues a failed cleanup job for a key of the deleted account, reports the backlog, and finishes", async () => {
    const account = await createAccount("recon");
    const seeded = await seedAccount(account);
    // A cleanup job for the evidence object that failed earlier and was never retried.
    sql(`select internal.enqueue_storage_delete('${account.id}'::uuid, '${seeded.evidenceKey}')`);
    sql(
      `update internal.storage_jobs set status = 'failed', attempt_count = 3, attempt_token = gen_random_uuid(), lease_expires_at = null, ` +
      `finished_at = now(), error_code = 'STORAGE_UNAVAILABLE' where user_id = '${account.id}'::uuid and object_key = '${seeded.evidenceKey}'`,
    );

    const before = await getAdmin().rpc("get_account_deletion_backlog");
    const pendingBefore = (before.data as { pending: number; overdue: number }[])[0]!;
    await deleteThroughService(account);
    const during = (await getAdmin().rpc("get_account_deletion_backlog")).data as { pending: number; overdue: number }[];
    expect(during[0]!.pending).toBe(pendingBefore.pending + 1);

    // After the purge alone, the failed job is back in the queue.
    await getDeletionGateway().database.claimAccountDeletionJobs(5).then(async (jobs) => {
      const job = jobs.find((candidate) => candidate.user_id === account.id)!;
      await getDeletionGateway().database.purgeAccountData(account.id, job.attempt_token);
    });
    expect(sql(`select status from internal.storage_jobs where object_key = '${seeded.evidenceKey}'`)).toBe("queued");
    expect(receipt(account.id)?.status).toBe("running");
    expect(await getDeletionGateway().database.verifyAccountPurges(100)).toBeGreaterThanOrEqual(0);
    expect(receipt(account.id)?.status).not.toBe("completed");

    // Overdue is counted from the request time.
    sql(`update internal.account_deletions set requested_at = now() - interval '25 hours' where user_id = '${account.id}'::uuid`);
    const overdue = (await getAdmin().rpc("get_account_deletion_backlog")).data as { pending: number; overdue: number }[];
    expect(overdue[0]!.overdue).toBeGreaterThanOrEqual(pendingBefore.overdue + 1);

    expireLease(account.id);
    await runUntilCompleted(account.id);
    expect(receipt(account.id)?.status).toBe("completed");
    expect(objectCount(account.id)).toBe(0);
    const after = (await getAdmin().rpc("get_account_deletion_backlog")).data as { pending: number; overdue: number }[];
    expect(after[0]!.pending).toBe(pendingBefore.pending);
  }, LONG);
});