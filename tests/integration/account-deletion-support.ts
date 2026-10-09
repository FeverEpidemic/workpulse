import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createAccountDeletionService } from "@/features/account/deletion-service";
import { createAuthAdapter } from "@/server/auth/adapter";
import { verifyAccountPassword } from "@/server/auth/reauthenticate";
import { ExplicitTestFakeDocxRenderer } from "@/server/documents/docx-renderer";
import { ExplicitTestFakePdfRenderer } from "@/server/export/pdf-renderer";
import type { MalwareScanner } from "@/server/storage/malware-scanner";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runAccountDeletionWorkerOnce, type AccountDeletionWorkerOptions, type AccountDeletionWorkerSummary } from "../../workers/account-deletion-worker.ts";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker.ts";
import { runExportWorkerOnce } from "../../workers/export-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseAccountDeletionWorkerGateway } from "../../workers/supabase-account-deletion-gateway.ts";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";

export type Client = SupabaseClient<Database>;

export const BUCKET = "workpulse-private";
export const SENTINEL = `WP-PRIVATE-ACCOUNT-SENTINEL-${randomUUID()}`;
const CONTAINER = process.env.WORKPULSE_TEST_DB_CONTAINER ?? "supabase_db_WorkPulse";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\nwp-account-deletion-test\n");

let admin: Client;
let adminConfig: NonNullable<ReturnType<typeof getSupabaseAdminConfig>>;
let publicConfig: NonNullable<ReturnType<typeof getSupabasePublicConfig>>;
let deletionGateway: ReturnType<typeof createSupabaseAccountDeletionWorkerGateway>;
const createdUserIds: string[] = [];
const openedClients: Client[] = [];
const uploadedKeys: string[] = [];

/** Statements run as the database owner: they seed rows and move clocks that no API role may touch. */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
}

export function setupHarness(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const adminCfg = getSupabaseAdminConfig();
  const config = getSupabasePublicConfig();
  if (!adminCfg || !config) throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
  adminConfig = adminCfg;
  publicConfig = config;
  admin = createClient<Database>(adminCfg.url, adminCfg.secretKey, clientOptions);
  deletionGateway = createSupabaseAccountDeletionWorkerGateway({ url: adminCfg.url, secretKey: adminCfg.secretKey });
}

export const getAdmin = () => admin;
export const getPublicConfig = () => publicConfig;
export const getAdminConfig = () => adminConfig;
export const getDeletionGateway = () => deletionGateway;

export interface Account {
  id: string;
  email: string;
  password: string;
  client: Client;
}

export function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`Account deletion integration setup failed: ${label}`);
  return value;
}

/** A real, onboarded account with one signed-in session. */
export async function createAccount(label: string): Promise<Account> {
  const email = `acd-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const id = required((await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user?.id, null, `${label} user`);
  createdUserIds.push(id);
  const client = signedInClient();
  required((await client.auth.signInWithPassword({ email, password })).data.user, null, `${label} sign-in`);
  const profile = await client.from("profiles").select("revision").eq("id", id).single();
  const onboarded = await client.rpc("complete_onboarding", {
    p_display_name: `Ani ${label}`, p_expected_revision: required(profile.data?.revision, profile.error, `${label} profile`), p_locale: "en", p_timezone: "Asia/Jakarta",
  });
  required(onboarded.data, onboarded.error, `${label} onboarding`);
  return { id, email, password, client };
}

export function signedInClient(): Client {
  const client = createClient<Database>(publicConfig.url, publicConfig.publishableKey, clientOptions);
  openedClients.push(client);
  return client;
}

export async function signIn(account: Pick<Account, "email" | "password">) {
  const client = signedInClient();
  const result = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  return { client, ...result };
}

export async function putObject(key: string): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).upload(key, PDF_BYTES, { contentType: "application/pdf", upsert: false });
  if (error) throw new Error("Account deletion integration could not store a test object");
  uploadedKeys.push(key);
}

export function objectCount(userId: string): number {
  return Number(sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${userId}/')`));
}

export interface Seeded {
  evidenceKey: string;
  importKey: string;
  exportKey: string;
  orphanKey: string;
  exportId: string;
  batchId: string;
}

/**
 * Rows in every owner table and objects in all three categories plus one orphan with no row. The private sentinel is in
 * the raw activity text, the CV title and the evidence file name.
 */
export async function seedAccount(account: Account): Promise<Seeded> {
  const { id, client } = account;
  const activityId = randomUUID();
  const evidenceId = randomUUID();
  const batchId = randomUUID();
  const exportId = randomUUID();
  const exportObject = randomUUID();
  const orphanId = randomUUID();
  const education = required((await client.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: "Informatika" as never,
    p_description: null as never, p_start_date: "2019-01-01" as never, p_start_precision: "year" as never,
    p_end_date: "2023-01-01" as never, p_end_precision: "year" as never, p_is_current: false,
  })).data?.[0]?.id, null, "education");
  required((await client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: `Skill ${SENTINEL}`.slice(0, 60) })).data, null, "skill");
  required((await client.rpc("ensure_cv_document")).data, null, "cv");
  const cv = required((await client.from("cv_documents").select("id, revision").eq("user_id", id).single()).data, null, "cv row");
  required((await client.rpc("select_cv_source", { p_expected_revision: cv.revision, p_source_type: "education", p_source_id: education })).data, null, "cv item");

  sql(`insert into public.activities (id, user_id, raw_text, occurred_on, capture_mode) values ('${activityId}', '${id}', '${SENTINEL} aktivitas', current_date, 'note')`);
  sql(
    `insert into public.evidence_files (id, user_id, activity_id, object_key, original_name, mime_type, bytes, status, reserved_until, parent_revision, idempotency_key, payload_hash) ` +
    `values ('${evidenceId}', '${id}', '${activityId}', '${id}/evidence/${evidenceId}', '${SENTINEL}.pdf', 'application/pdf', 10, 'uploading', now() + interval '1 hour', 1, gen_random_uuid(), decode(repeat('ab', 32), 'hex'))`,
  );
  sql(
    `insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, page_count, extracted_text) ` +
    `values ('${batchId}', '${id}', gen_random_uuid(), decode(repeat('ab', 32), 'hex'), '${id}/import/${batchId}', 'cv.pdf', 'application/pdf', 10, repeat('a', 64), 'review', 'done', 1, '${SENTINEL} teks')`,
  );
  sql(
    `insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key, attempt_count, attempt_token, finished_at, object_key, page_count, byte_size, expires_at) ` +
    `values ('${exportId}', '${id}', '${cv.id}', ${cv.revision + 0}, '{"title":"${SENTINEL}"}'::jsonb, 'succeeded', 'acd-${exportId}', 1, gen_random_uuid(), now(), ` +
    `'${id}/export/${exportObject}', 1, 100, now() + interval '24 hours')`,
  );
  const keys = {
    evidenceKey: `${id}/evidence/${evidenceId}`,
    importKey: `${id}/import/${batchId}`,
    exportKey: `${id}/export/${exportObject}`,
    orphanKey: `${id}/evidence/${orphanId}`,
  };
  for (const key of Object.values(keys)) await putObject(key);
  return { ...keys, exportId, batchId };
}

/** Every table with a `user_id` column outside the receipt queues, from the catalog so a new table is counted too. */
export function ownerTables(): string[] {
  const rows = sql(
    `select table_schema || '.' || table_name from information_schema.columns where column_name = 'user_id' and table_schema in ('public', 'internal') ` +
    `and table_name not in ('storage_jobs', 'account_deletions') order by 1`,
  );
  return rows.split("\n").filter((line) => line !== "");
}

export function rowsLeft(userId: string): Record<string, number> {
  const left: Record<string, number> = {};
  for (const table of ownerTables()) {
    const count = Number(sql(`select count(*) from ${table} where user_id = '${userId}'::uuid`));
    if (count > 0) left[table] = count;
  }
  return left;
}

/** How many rows of the public tables contain the sentinel as text. */
export function sentinelHits(): number {
  let hits = 0;
  for (const table of ownerTables().filter((name) => name.startsWith("public.")).concat("public.profiles")) {
    hits += Number(sql(`select count(*) from ${table} t where position('${SENTINEL}' in t::text) > 0`));
  }
  return hits;
}

export interface Receipt {
  status: string;
  attempt_count: number;
  has_token: boolean;
  last_error_code: string | null;
  requested_at: string | null;
  objects_enqueued_at: string | null;
  rows_purged_at: string | null;
  auth_deleted_at: string | null;
  completed_at: string | null;
  seconds: number | null;
}

export function receipt(userId: string): Receipt | null {
  const raw = sql(
    `select row_to_json(x) from (select status, attempt_count, (attempt_token is not null) as has_token, last_error_code, requested_at, objects_enqueued_at, ` +
    `rows_purged_at, auth_deleted_at, completed_at, extract(epoch from (completed_at - requested_at))::float8 as seconds ` +
    `from internal.account_deletions where user_id = '${userId}'::uuid) x`,
  );
  return raw === "" ? null : (JSON.parse(raw) as Receipt);
}

export function authUserExists(userId: string): boolean {
  return Number(sql(`select count(*) from auth.users where id = '${userId}'::uuid`)) > 0;
}

export function profileExists(userId: string): boolean {
  return Number(sql(`select count(*) from public.profiles where id = '${userId}'::uuid`)) > 0;
}

export function storageJobs(userId: string): { total: number; open: number } {
  const [total, open] = sql(
    `select count(*) || ',' || count(*) filter (where status in ('queued', 'running', 'failed')) from internal.storage_jobs where user_id = '${userId}'::uuid`,
  ).split(",").map(Number);
  return { total: total ?? 0, open: open ?? 0 };
}

/** Ages the lease so the next pass claims the receipt again, like a worker that died. */
export function expireLease(userId: string): void {
  sql(`update internal.account_deletions set lease_expires_at = now() - interval '1 second' where user_id = '${userId}'::uuid and status = 'running'`);
}

const cleanScanner: MalwareScanner = { scan: async () => ({ status: "clean" }) } as MalwareScanner;

export interface Passes {
  deletion: AccountDeletionWorkerSummary[];
}

/** One round of every pass that matters for deletion: the deletion pass itself, then evidence, import and export cleanup. */
export async function runPasses(extra: Partial<AccountDeletionWorkerOptions> = {}): Promise<AccountDeletionWorkerSummary> {
  const config = { url: adminConfig.url, secretKey: adminConfig.secretKey };
  const summary = await runAccountDeletionWorkerOnce({ ...deletionGateway, ...extra });
  await runEvidenceWorkerOnce({ ...createSupabaseEvidenceWorkerGateway(config), scanner: cleanScanner });
  await runImportWorkerOnce({
    ...createSupabaseImportWorkerGateway(config), scanner: cleanScanner, renderer: new ExplicitTestFakeDocxRenderer(), parse: parseInThread,
  });
  await runExportWorkerOnce({ ...createSupabaseExportWorkerGateway(config), renderer: new ExplicitTestFakePdfRenderer(), parse: parseInThread });
  return summary;
}

/** Runs rounds until the receipt of the user is completed (at most `max`); returns the number of rounds. */
export async function runUntilCompleted(userId: string, max = 12): Promise<number> {
  for (let round = 1; round <= max; round += 1) {
    await runPasses();
    if (receipt(userId)?.status === "completed") return round;
  }
  return max;
}

/** Deletes the account through the real service: password check, receipt, ban, global sign-out. */
export async function deleteThroughService(account: Account) {
  const service = createAccountDeletionService({
    client: account.client,
    admin,
    auth: createAuthAdapter(account.client),
    verifyPassword: (input) => verifyAccountPassword(input),
  });
  return service.deleteAccount({ password: account.password, confirmation: account.email });
}

export async function teardownHarness(): Promise<void> {
  await Promise.all(openedClients.map((client) => client.auth.signOut().catch(() => undefined)));
  if (uploadedKeys.length > 0) await admin.storage.from(BUCKET).remove(uploadedKeys).catch(() => undefined);
  // Accounts a test did not delete go through the real deletion path: a plain user delete fails on populated accounts.
  for (const id of createdUserIds) {
    if (profileExists(id) && receipt(id) === null) await admin.rpc("begin_account_deletion", { p_user_id: id });
  }
  for (const id of createdUserIds) {
    if (receipt(id) !== null) await runUntilCompleted(id, 8);
  }
  for (const id of createdUserIds) {
    await admin.auth.admin.deleteUser(id).catch(() => undefined);
    sql(`delete from internal.account_deletions where user_id = '${id}'::uuid`);
  }
}
