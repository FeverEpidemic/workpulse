import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect } from "vitest";

import { createAchievementService } from "@/features/achievement/achievement-service";
import { CvServiceError } from "@/features/cv/cv-errors";
import { createCvService } from "@/features/cv/cv-service";
import { createCvExportService, type CvExportService } from "@/features/cv/export-service";
import { createProjectService } from "@/features/project/project-service";
import { createPrivateStorageService } from "@/server/storage/private-storage-service";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
import { ExplicitTestFakePdfRenderer, type PdfRenderer, type PdfRenderResult } from "@/server/export/pdf-renderer";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runExportWorkerOnce, type ExportWorkerOptions, type ExportWorkerSummary } from "../../workers/export-worker.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";

export type Client = SupabaseClient<Database>;

export const SENTINEL = `WP-PRIVATE-CV-SENTINEL-${randomUUID()}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
export const RACE_ROUNDS = Number(process.env.WORKPULSE_CV_EXPORT_RACE_ROUNDS ?? 3);
/** Delay before the request is sent, per round (0 = the request goes first). */
export const START_DELAYS_MS = [0, 5, 12, 20, 3, 8, 0, 15];
export const BUCKET = "workpulse-private";
const CONTAINER = process.env.WORKPULSE_TEST_DB_CONTAINER ?? "supabase_db_WorkPulse";
export const LONG_TIMEOUT = 150_000;

let admin: Client;
let adminConfig: NonNullable<ReturnType<typeof getSupabaseAdminConfig>>;
let publicConfig: NonNullable<ReturnType<typeof getSupabasePublicConfig>>;
let gateway: ReturnType<typeof createSupabaseExportWorkerGateway>;
const createdUserIds: string[] = [];
const openedClients: Client[] = [];
export const allSummaries: ExportWorkerSummary[] = [];
export const raceLog: string[] = [];
export const collectedErrors: unknown[] = [];

export const fake: PdfRenderer = new ExplicitTestFakePdfRenderer();

export interface Account {
  id: string;
  label: string;
  name: string;
  clients: Client[];
  cv: ReturnType<typeof createCvService>[];
  achievements: ReturnType<typeof createAchievementService>[];
  exports: CvExportService[];
}

export function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`CV export integration setup failed: ${label}`);
  return value;
}

/** Statements run as the database owner: they move clocks and flags that no API role may touch. */
export function sql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
}

export function exportServiceFor(client: Client, userId: string): CvExportService {
  return createCvExportService({
    supabase: client,
    getStorage: () => createPrivateStorageService(new SupabaseStorageAdapter(admin), async () => ({ id: userId })),
  });
}

/** A real, onboarded account with `clientCount` independent signed-in sessions. */
export async function createAccount(label: string, options: { clientCount?: number; displayName?: string } = {}): Promise<Account> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `cve-${label}-${suffix}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const id = required((await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user?.id, null, `${label} user`);
  createdUserIds.push(id);
  const clients: Client[] = [];
  for (let index = 0; index < (options.clientCount ?? 1); index += 1) {
    const client = createClient<Database>(publicConfig.url, publicConfig.publishableKey, clientOptions);
    const signIn = await client.auth.signInWithPassword({ email, password });
    required(signIn.data.user, signIn.error, `${label} sign-in ${index}`);
    clients.push(client);
    openedClients.push(client);
  }
  const name = options.displayName ?? `Ani ${label}`;
  const profile = await clients[0]!.from("profiles").select("revision").eq("id", id).single();
  const onboarded = await clients[0]!.rpc("complete_onboarding", {
    p_display_name: name, p_expected_revision: required(profile.data?.revision, profile.error, `${label} profile`), p_locale: "en", p_timezone: "Asia/Jakarta",
  });
  required(onboarded.data, onboarded.error, `${label} onboarding`);
  return {
    id, label, name, clients,
    cv: clients.map((client) => createCvService({ supabase: client })),
    achievements: clients.map((client) => createAchievementService(client)),
    exports: clients.map((client) => exportServiceFor(client, id)),
  };
}

const nullable = <T>(value: T) => value as never;

export async function createEducation(account: Account, institution = "Universitas Contoh"): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: institution, p_qualification: "S1", p_field_of_study: nullable("Informatika"),
    p_description: nullable(null), p_start_date: nullable("2019-01-01"), p_start_precision: nullable("year"),
    p_end_date: nullable("2023-01-01"), p_end_precision: nullable("year"), p_is_current: false,
  });
  return required(data?.[0]?.id, error, "education");
}

export async function createExperience(account: Account, organization: string): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_experience_idempotent", {
    p_operation_key: randomUUID(), p_organization: organization, p_role_title: "Analis", p_kind: "employment",
    p_description: nullable(null), p_start_date: nullable("2024-01-01"), p_start_precision: nullable("month"),
    p_end_date: nullable(null), p_end_precision: nullable(null), p_is_current: false,
  });
  return required(data?.[0]?.id, error, `experience ${organization}`);
}

export async function createSkill(account: Account, name: string): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  return required(data?.[0]?.id, error, `skill ${name}`);
}

export async function createProject(account: Account, title: string, experienceId: string | null = null) {
  return createProjectService(account.clients[0]!).createProject({
    operationKey: randomUUID(), title, description: null, userRole: null, outcome: null, status: "completed",
    experienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false,
  });
}

export const CHANGES = (title: string, cvBullet = "") => ({
  title, contribution: `Kontribusi ${title}`, scope: "", outcome: `Hasil ${title}`, cvBullet, achievedOn: "2026-09-20", metrics: [],
});

export async function createAchievement(
  account: Account,
  title: string,
  options: { projectId?: string | null; experienceId?: string | null; confirm?: boolean; cvBullet?: string } = {},
): Promise<{ id: string; revision: number }> {
  const service = account.achievements[0]!;
  const created = await service.createAchievement({
    operationKey: randomUUID(), activityId: null, projectId: options.projectId ?? null, experienceId: options.experienceId ?? null,
  });
  const draft = await service.saveAchievement({
    achievementId: created.achievementId, expectedRevision: 1, action: "save_draft", changes: CHANGES(title, options.cvBullet), skillNames: [],
  });
  if (options.confirm === false) return { id: created.achievementId, revision: draft.revision };
  const confirmed = await service.saveAchievement({
    achievementId: created.achievementId, expectedRevision: draft.revision, action: "confirm", changes: CHANGES(title, options.cvBullet), skillNames: [],
  });
  return { id: created.achievementId, revision: confirmed.revision };
}

export async function achievementRow(account: Account, id: string) {
  return required((await account.clients[0]!.from("achievements").select("*").eq("id", id).single()).data, null, `achievement ${id}`);
}

export async function editBullet(account: Account, id: string, bullet: string): Promise<void> {
  const row = await achievementRow(account, id);
  await account.achievements[0]!.saveAchievement({
    achievementId: id, expectedRevision: row.revision, action: "save_changes",
    changes: { title: row.title ?? "", contribution: row.contribution ?? "", scope: row.scope ?? "", outcome: row.outcome ?? "", cvBullet: bullet, achievedOn: row.achieved_on, metrics: [] },
    skillNames: [],
  });
}

export async function cvView(account: Account) {
  return required(await account.cv[0]!.getCv(), null, "CV view");
}

export async function cvRevision(account: Account): Promise<number> {
  return (await cvView(account)).document.revision;
}

export async function select(account: Account, type: "experience" | "project" | "achievement" | "education" | "skill" | "certification", id: string) {
  return account.cv[0]!.select({ expected_revision: await cvRevision(account), source_type: type, source_id: id });
}

export async function itemFor(account: Account, column: "achievement_id" | "education_id" | "project_id" | "experience_id", sourceId: string) {
  const view = await cvView(account);
  return required(view.items.find((item) => item[column] === sourceId), null, `item for ${sourceId}`);
}

export interface Ready {
  account: Account;
  achievement: { id: string; revision: number };
  itemId: string;
  bullet: string;
}

/** An account whose CV has experience, project, a confirmed achievement and education: ready to export. */
export async function readyAccount(label: string, options: { clientCount?: number; displayName?: string; bullet?: string } = {}): Promise<Ready> {
  const account = await createAccount(label, options);
  await account.cv[0]!.ensure();
  const education = await createEducation(account);
  await select(account, "education", education);
  const experience = await createExperience(account, "PT Contoh");
  await select(account, "experience", experience);
  const project = await createProject(account, "Proyek Contoh", experience);
  await select(account, "project", project.projectId);
  const bullet = options.bullet ?? `Bullet dasar ${randomUUID().slice(0, 8)}`;
  const achievement = await createAchievement(account, "Hasil Contoh", { projectId: project.projectId, experienceId: experience, cvBullet: bullet });
  await select(account, "achievement", achievement.id);
  const item = await itemFor(account, "achievement_id", achievement.id);
  return { account, achievement, itemId: item.id, bullet };
}

export function workerOptions(renderer: PdfRenderer, extra: Partial<ExportWorkerOptions> = {}): ExportWorkerOptions {
  return { ...gateway, renderer, parse: parseInThread, claimLimit: 10, ...extra };
}

/** Runs worker passes until nothing is claimed; returns the sum of the counters. */
export async function drain(renderer: PdfRenderer = fake, extra: Partial<ExportWorkerOptions> = {}) {
  const total = { claimed: 0, succeeded: 0, stale: 0, errored: 0, failed: {} as Record<string, number>, cleanupCompleted: 0, orphansQueued: 0, expired: 0 };
  for (let pass = 0; pass < 6; pass += 1) {
    const summary = await runExportWorkerOnce(workerOptions(renderer, extra));
    allSummaries.push(summary);
    total.claimed += summary.exportJobsClaimed;
    total.succeeded += summary.exportSucceeded;
    total.stale += summary.exportStale;
    total.errored += summary.exportErrored;
    total.cleanupCompleted += summary.exportCleanupCompleted;
    total.orphansQueued += summary.exportOrphansQueued;
    total.expired += summary.exportExpired;
    for (const [code, count] of Object.entries(summary.exportFailed)) total.failed[code] = (total.failed[code] ?? 0) + (count ?? 0);
    if (summary.exportJobsClaimed === 0) break;
  }
  return total;
}

export const failingRenderer = (code: Extract<PdfRenderResult, { status: "error" }>["code"]): PdfRenderer => ({ kind: "fake", async render() { return { status: "error", code }; } });

export interface ExportInfo {
  status: string; error_code: string | null; attempt_count: number; page_count: number | null; byte_size: number | null; object_key: string | null;
  cv_revision: number; attempt_token: string | null; purged_at: string | null; user_id: string; ttl_ok: boolean | null; snapshot_hash: string;
}

export function exportInfo(id: string): ExportInfo {
  return JSON.parse(sql(
    `select row_to_json(x) from (select status, error_code, attempt_count, page_count, byte_size, object_key, cv_revision, attempt_token, purged_at, user_id, ` +
    `(expires_at = finished_at + interval '24 hours') as ttl_ok, md5(snapshot::text) as snapshot_hash from public.cv_exports where id = '${id}'::uuid) x`,
  )) as ExportInfo;
}

export function exportCount(userId: string): number {
  return Number(sql(`select count(*) from public.cv_exports where user_id = '${userId}'::uuid`));
}

export function cvFingerprint(userId: string): string {
  return sql(
    `select md5(coalesce((select string_agg(d::text, '|' order by d.id) from public.cv_documents d where d.user_id = '${userId}'::uuid), '') ` +
    `|| coalesce((select string_agg(i::text, '|' order by i.id) from public.cv_items i where i.user_id = '${userId}'::uuid), ''))`,
  );
}

export async function objectNames(userId: string): Promise<string[]> {
  const { data, error } = await admin.storage.from(BUCKET).list(`${userId}/export`);
  if (error) throw new Error("CV export integration storage listing failed");
  return (data ?? []).map((object) => object.name);
}

export async function downloadObject(key: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error("CV export integration download failed");
  return new Uint8Array(await data.arrayBuffer());
}

/** Text and page count of a stored export, read by the same isolated parser the worker uses. */
export async function pdfOf(exportId: string) {
  const info = exportInfo(exportId);
  const bytes = await downloadObject(required(info.object_key, null, "export object key"));
  expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const parsed = await parseInThread("pdf-export", bytes);
  if (parsed.status !== "ok") throw new Error("CV export integration could not read the PDF");
  return { text: parsed.text ?? "", pageCount: parsed.pageCount ?? 0, bytes };
}

export async function expectExportError(promise: Promise<unknown>, code: string): Promise<CvServiceError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CvServiceError);
  expect((error as CvServiceError).code).toBe(code);
  collectedErrors.push({ code: (error as CvServiceError).code, message: (error as Error).message, blockers: (error as CvServiceError).blockers });
  return error as CvServiceError;
}

export const newKey = () => randomUUID();

export async function request(account: Account, client = 0) {
  const revision = await cvRevision(account);
  return account.exports[client]!.requestExport({ expected_revision: revision, idempotency_key: newKey() });
}

export interface RpcOutcome { code: string | null; message: string | null; details: string | null }

export function outcomeOf(result: PromiseSettledResult<unknown>): RpcOutcome {
  if (result.status === "rejected") return { code: "REJECTED", message: String(result.reason), details: null };
  const error = (result.value as { error: { code?: string; message?: string; details?: string } | null }).error;
  return error ? { code: error.code ?? null, message: error.message ?? null, details: error.details ?? null } : { code: null, message: null, details: null };
}

/** Real concurrent calls must never deadlock; every outcome must be one the contract names. */
export function expectOutcomes(outcomes: RpcOutcome[], allowed: readonly string[]) {
  for (const outcome of outcomes) {
    expect(outcome.code, `unexpected SQLSTATE ${outcome.code}: ${outcome.message}`).not.toBe("40P01");
    expect(outcome.code, `unexpected SQLSTATE ${outcome.code}: ${outcome.message}`).not.toBe("40001");
    if (outcome.message !== null) expect(allowed, `unexpected error ${outcome.message}`).toContain(outcome.message);
  }
}

export function signedUrlTtlSeconds(url: string): number {
  const token = new URL(url).searchParams.get("token") ?? "";
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
  return required(payload.exp, null, "signed url exp") - Math.floor(Date.now() / 1000);
}


export function getAdmin(): Client {
  return admin;
}

export function getAdminConfig() {
  return adminConfig;
}

export function getPublicConfig() {
  return publicConfig;
}

export function getGateway() {
  return gateway;
}

/** Call once before the tests of a file (needs the local Supabase stack and its keys). */
export function setupHarness(): void {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const adminCfg = getSupabaseAdminConfig();
  const config = getSupabasePublicConfig();
  if (!adminCfg || !config) throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
  adminConfig = adminCfg;
  publicConfig = config;
  admin = createClient<Database>(adminCfg.url, adminCfg.secretKey, clientOptions);
  gateway = createSupabaseExportWorkerGateway({ url: adminCfg.url, secretKey: adminCfg.secretKey });
}

/** Signs out every opened session, removes export objects and deletes the accounts (cascading their exports). */
export async function teardownHarness(): Promise<void> {
  await Promise.all(openedClients.map((client) => client.auth.signOut().catch(() => undefined)));
  for (const id of createdUserIds) {
    const names = await objectNames(id).catch(() => []);
    if (names.length > 0) await admin.storage.from(BUCKET).remove(names.map((name) => `${id}/export/${name}`)).catch(() => undefined);
    await admin.auth.admin.deleteUser(id);
  }
  if (raceLog.length > 0) process.stdout.write(`CV-EXPORT-RACE-RESULTS ${JSON.stringify(raceLog)}\n`);
}
