import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CvServiceError } from "@/features/cv/cv-errors";
import { createCvExportService } from "@/features/cv/export-service";
import { ExplicitTestFakeDocxRenderer } from "@/server/documents/docx-renderer";
import { ExplicitTestFakePdfRenderer } from "@/server/export/pdf-renderer";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runExportWorkerOnce } from "../../workers/export-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";

import {
  createAccount,
  getAdminConfig,
  putObject,
  required,
  rpcAny,
  seedAccount,
  setupHarness,
  sql,
  teardownHarness,
  type Account,
  type Seeded,
} from "./account-deletion-support";

const LONG = 150_000;

beforeAll(() => setupHarness());
afterAll(async () => teardownHarness());

const config = () => ({ url: getAdminConfig().url, secretKey: getAdminConfig().secretKey });
const cleanScanner = { scan: async () => ({ status: "clean" as const }) } as never;

/** Moves clocks back without letting the guard and touch triggers reset them. */
function age(statement: string): void {
  sql(`begin; set local session_replication_role = replica; ${statement}; commit`);
}

async function importPass() {
  return runImportWorkerOnce({
    ...createSupabaseImportWorkerGateway(config()), scanner: cleanScanner, renderer: new ExplicitTestFakeDocxRenderer(), parse: parseInThread,
  });
}

async function exportPass() {
  return runExportWorkerOnce({ ...createSupabaseExportWorkerGateway(config()), renderer: new ExplicitTestFakePdfRenderer(), parse: parseInThread });
}

const objectExists = (key: string) => Number(sql(`select count(*) from storage.objects where bucket_id = 'workpulse-private' and name = '${key}'`)) > 0;

describe("T23 retention: abandoned import reviews", () => {
  it("cancels an idle review, leaves an active one, and the purge then removes the file and text", async () => {
    const account = await createAccount("review");
    const seeded = await seedAccount(account);

    // A second review batch with a recently edited item.
    const activeBatch = randomUUID();
    const activeKey = `${account.id}/import/${activeBatch}`;
    sql(
      `insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, page_count, extracted_text) ` +
      `values ('${activeBatch}', '${account.id}', gen_random_uuid(), decode(repeat('ab', 32), 'hex'), '${activeKey}', 'active.pdf', 'application/pdf', 10, repeat('b', 64), 'review', 'done', 1, 'teks aktif')`,
    );
    sql(
      `insert into public.import_items (user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action) ` +
      `values ('${account.id}', '${activeBatch}', 'skill', 0, '{"name":"SQL"}'::jsonb, 'SQL', 'create')`,
    );
    await putObject(activeKey);

    age(`update public.import_batches set updated_at = now() - interval '31 days' where id in ('${seeded.batchId}', '${activeBatch}')`);
    age(`update public.import_items set updated_at = now() - interval '1 day' where batch_id = '${activeBatch}'`);
    expect(objectExists(seeded.importKey)).toBe(true);

    const first = await importPass();
    expect(first.importReviewsExpired).toBeGreaterThanOrEqual(1);
    expect(first.importPurged).toBeGreaterThanOrEqual(1);

    expect(sql(`select status || ',' || (cancelled_at is not null) || ',' || (expires_at is not null) || ',' || (purged_at is not null) from public.import_batches where id = '${seeded.batchId}'`))
      .toBe("cancelled,true,true,true");
    expect(sql(`select (extracted_text is null) || ',' || (file_key is null) from public.import_batches where id = '${seeded.batchId}'`)).toBe("true,true");
    expect(sql(`select status from public.import_batches where id = '${activeBatch}'`)).toBe("review");
    expect(sql(`select extracted_text from public.import_batches where id = '${activeBatch}'`)).toBe("teks aktif");

    // The queued delete job is picked up by the next passes and the object disappears.
    for (let pass = 0; pass < 5 && objectExists(seeded.importKey); pass += 1) await importPass();
    expect(objectExists(seeded.importKey)).toBe(false);
    expect(objectExists(activeKey)).toBe(true);
  }, LONG);
});

describe("T23 retention: export snapshots and retry", () => {
  async function failedExport(account: Account, seeded: Seeded, revision: number, finishedAgo = "1 hour"): Promise<string> {
    const id = randomUUID();
    sql(
      `insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, error_code) ` +
      `values ('${id}', '${account.id}', '${seeded.cvId}', ${revision}, '{"title":"private"}'::jsonb, 'failed', 'ret-${id}', 1, gen_random_uuid(), now() - interval '${finishedAgo}', 'EXPORT_TIMEOUT')`,
    );
    return id;
  }

  it("empties the snapshot of an expired and an old failed export, keeps their history, and refuses their retry", async () => {
    const account = await createAccount("snapshots");
    const seeded = await seedAccount(account);
    const oldFailed = await failedExport(account, seeded, seeded.cvRevision, "25 hours");
    const freshFailed = await failedExport(account, seeded, seeded.cvRevision, "1 hour");
    sql(`update public.cv_exports set expires_at = now() - interval '1 hour' where id = '${seeded.exportId}'`);

    const summary = await exportPass();
    expect(summary.exportExpired).toBeGreaterThanOrEqual(1);
    expect(summary.exportSnapshotsRedacted).toBeGreaterThanOrEqual(1);

    const state = (id: string) => sql(`select (snapshot = '{}'::jsonb) || ',' || (snapshot_purged_at is not null) || ',' || status from public.cv_exports where id = '${id}'`);
    expect(state(seeded.exportId)).toBe("true,true,succeeded");
    expect(state(oldFailed)).toBe("true,true,failed");
    expect(state(freshFailed)).toBe("false,false,failed");
    expect(sql(`select count(*) from public.cv_exports where user_id = '${account.id}' and snapshot::text like '%${"private"}%' and snapshot_purged_at is not null`)).toBe("0");

    // The history stays readable through the service, with the new column.
    const exports = createCvExportService({ supabase: account.client, getStorage: () => { throw new Error("storage must not be built"); } });
    const history = await exports.listExports();
    const purged = history.find((row) => row.id === oldFailed);
    expect(purged).toMatchObject({ status: "failed", error_code: "EXPORT_TIMEOUT", cv_revision: seeded.cvRevision });
    expect(purged?.snapshot_purged_at).not.toBeNull();
    expect(history.find((row) => row.id === freshFailed)?.snapshot_purged_at).toBeNull();

    // A retry of an emptied snapshot is refused with the stable code.
    const refused = await exports.retryExport({ export_id: oldFailed }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(CvServiceError);
    expect((refused as CvServiceError).code).toBe("EXPORT_RETRY_UNAVAILABLE");

    // The same snapshot is still immutable for every other change (database owner session).
    expect(() => sql(`update public.cv_exports set snapshot = '{"x":1}'::jsonb where id = '${freshFailed}'`)).toThrow();
  }, LONG);

  it("refuses a retry after the CV changed or while it is blocked, and accepts one for an unchanged, ready CV", async () => {
    const account = await createAccount("retry");
    const seeded = await seedAccount(account);
    const exports = createCvExportService({ supabase: account.client, getStorage: () => { throw new Error("storage must not be built"); } });
    const outcome = async (id: string) => exports.retryExport({ export_id: id }).then(() => "ok", (error: unknown) => (error as CvServiceError).code);

    // The CV changes: an export bound to the old revision can no longer be retried.
    const older = await failedExport(account, seeded, seeded.cvRevision);
    const skill = required((await account.client.from("skills").select("id").eq("user_id", account.id).limit(1).single()).data, null, "skill");
    const selected = await rpcAny(account.client, "select_cv_source", { p_expected_revision: seeded.cvRevision, p_source_type: "skill", p_source_id: skill.id });
    expect(selected.error).toBeNull();
    expect(await outcome(older)).toBe("EXPORT_RETRY_UNAVAILABLE");
    expect(sql(`select status from public.cv_exports where id = '${older}'`)).toBe("failed");

    // A blocked CV (no name for the export) refuses the retry of an export of the current revision.
    const revision = Number(sql(`select revision from public.cv_documents where id = '${seeded.cvId}'`));
    const current = await failedExport(account, seeded, revision);
    sql(`update public.cv_documents set profile_snapshot = profile_snapshot - 'display_name' - 'display_overrides' where id = '${seeded.cvId}'`);
    expect(await outcome(current)).toBe("EXPORT_RETRY_UNAVAILABLE");
    expect(sql(`select status from public.cv_exports where id = '${current}'`)).toBe("failed");

    // Once the owner keeps the saved profile and the CV is ready again, the retry is accepted and keeps the same snapshot.
    sql(`update public.cv_documents set profile_snapshot = profile_snapshot || '{"display_overrides":{"display_name":"Nama Tampil"}}'::jsonb where id = '${seeded.cvId}'`);
    const profileRevision = Number(sql(`select revision from public.profiles where id = '${account.id}'`));
    const kept = await rpcAny(account.client, "resolve_cv_freshness", {
      p_expected_revision: Number(sql(`select revision from public.cv_documents where id = '${seeded.cvId}'`)),
      p_resolutions: [{ target: "profile", source_revision: profileRevision, action: "keep" }],
    });
    expect(kept.error).toBeNull();
    const readiness = await exports.getReadiness();
    const nowRevision = Number(sql(`select revision from public.cv_documents where id = '${seeded.cvId}'`));
    expect(readiness.blockers).toEqual([]);
    expect(readiness.ready).toBe(true);
    const ready = await failedExport(account, seeded, nowRevision);
    const before = sql(`select md5(snapshot::text) from public.cv_exports where id = '${ready}'`);
    expect(await outcome(ready)).toBe("ok");
    expect(sql(`select status from public.cv_exports where id = '${ready}'`)).toBe("queued");
    expect(sql(`select md5(snapshot::text) from public.cv_exports where id = '${ready}'`)).toBe(before);
  }, LONG);
});
