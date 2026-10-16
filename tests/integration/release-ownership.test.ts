import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The route handlers read the session through createSupabaseServerClient. Here it returns the client the test selects,
// so a handler runs against the real database as that account.
const session = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({ createSupabaseServerClient: async () => session.client }));

import { createEvidenceService } from "@/features/evidence/evidence-service";
import { SupabaseEvidenceRepository } from "@/server/storage/evidence-repository";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import type { MalwareScanner } from "@/server/storage/malware-scanner";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway.ts";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker.ts";
import {
  BUCKET,
  getAdmin,
  getAdminConfig,
  registerAgain,
  required,
  rpcAny,
  seedAccount,
  SENTINEL as ACCOUNT_SENTINEL,
  setupHarness,
  signedInClient,
  sql,
  teardownHarness,
  type Account,
  type Client,
  type Seeded,
} from "./account-deletion-support";

// T25 plan sections 1.4 to 1.6: one catalog-driven suite for two accounts. A owns a row in every owner table, an object
// in every storage category and a record for every RPC that takes a record id. B, signed in, tries each of them.
// Reports go to the file named by WORKPULSE_RELEASE_OWNERSHIP_OUT when set, never to stdout.

const SENTINEL_A = `WP-PRIVATE-T25-SENTINEL-${randomUUID()}`;
const SENTINEL_B = `WP-PRIVATE-T25-SENTINEL-${randomUUID()}`;
/** What account B must never receive: everything private to A. */
const SENTINELS = [SENTINEL_A, ACCOUNT_SENTINEL];
const DENIED_CODES = new Set(["42501", "PGRST202", "PGRST301"]);
const LONG = 240_000;

/** Tables whose rows for A are written as the database owner, with the reason; every other table is filled by RPC. */
const WRITTEN_AS_DATABASE_OWNER: Record<string, string> = {
  ai_suggestion_reviews: "a review row exists only after a succeeded job, which needs the AI worker and a provider (ai-review suite)",
  import_batches: "a batch reaches review only after scan, parse and extraction by the import worker (import-staging suite)",
  import_items: "items are written by the import worker (import-staging suite)",
  cv_exports: "a succeeded export needs the export worker and a renderer (cv-export suite)",
};

/**
 * RPC id parameters for which the owner of a record in its fixture state is answered exactly like a stranger, so no
 * owner control can separate "not yours" from "not found". The foreign-versus-random comparison still applies.
 */
const NO_OWNER_CONTROL: Record<string, string> = {
  "apply_ai_suggestion.p_job_id":
    "a queued job reads as AI_JOB_UNAVAILABLE for its owner too; a succeeded job needs the AI worker (ai-review suite, test 13)",
};

/** Tables that cannot hold a row for A at all, with the reason. Empty: every table of T25 has a fixture. */
const NO_FIXTURE_REASON: Record<string, string> = {};

interface LooseQuery extends PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> {
  select(columns?: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  limit(count: number): LooseQuery;
  update(values: Record<string, unknown>): LooseQuery;
  delete(): LooseQuery;
  insert(values: Record<string, unknown>): LooseQuery;
}
const from = (client: Client, name: string) => (client as unknown as { from(table: string): LooseQuery }).from(name);

const noSentinel = (value: unknown, label: string) => {
  const text = JSON.stringify(value) ?? "";
  for (const sentinel of SENTINELS) expect(text.includes(sentinel), `${label} carried a private sentinel`).toBe(false);
};

const scrub = (text: string | null | undefined) =>
  (text ?? "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>");

type Result = { data: unknown; error: { code?: string; message?: string } | null };

/** Null for a refusal (42501) or an empty answer; a description of the leak for anything else. */
function leakOf(result: Result): string | null {
  if (result.error) return result.error.code === "42501" ? null : `unexpected error ${result.error.code ?? "without code"}`;
  const rows = Array.isArray(result.data) ? result.data : result.data === null || result.data === undefined ? [] : [result.data];
  return rows.length === 0 ? null : `${rows.length} row(s) came back`;
}

/** Null when a write by a stranger was refused or touched nothing. A write that returned an error code other than 42501 still counts as refused. */
function writeLeakOf(result: Result): string | null {
  if (result.error) return null;
  return leakOf(result);
}

interface Outcome { code: string | null; message: string; data: string }
function outcome(result: Result): Outcome {
  return {
    code: result.error?.code ?? null,
    message: scrub(result.error?.message),
    data: result.error ? "" : scrub(JSON.stringify(result.data ?? null)),
  };
}

type Kind = "activity" | "achievement" | "project" | "experience" | "education" | "certification" | "skill" | "job" | "batch" | "item" | "export" | "cvItem";
const TABLE_OF: Record<Kind, string> = {
  activity: "activities", achievement: "achievements", project: "projects", experience: "experiences", education: "education",
  certification: "certifications", skill: "skills", job: "ai_jobs", batch: "import_batches", item: "import_items", export: "cv_exports", cvItem: "cv_items",
};

interface Owned {
  account: Account;
  ids: Record<Kind, string>;
  cvId: string;
  cvRevision: number;
  keys: Record<string, string>;
}

const first = (data: unknown): Record<string, unknown> => {
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? {}) as Record<string, unknown>;
};

async function newAccount(label: string): Promise<Account> {
  const account = await registerAgain(`t25-release-${label}-${randomUUID().replaceAll("-", "")}@example.test`);
  const profile = required((await account.client.from("profiles").select("revision").eq("id", account.id).single()).data, null, `${label} profile`);
  const done = await account.client.rpc("complete_onboarding", {
    p_display_name: `T25 ${label}`, p_expected_revision: profile.revision, p_locale: "en", p_timezone: "Asia/Jakarta",
  });
  required(done.data, done.error, `${label} onboarding`);
  return account;
}

function insertBatch(userId: string, sentinel: string, status: string = "review"): string {
  const batchId = randomUUID();
  sql(
    `insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, page_count, extracted_text) ` +
    `values ('${batchId}', '${userId}', gen_random_uuid(), decode(repeat('ab', 32), 'hex'), '${userId}/import/${batchId}', 'cv.pdf', 'application/pdf', 10, repeat('a', 64), '${status}', 'done', 1, '${sentinel} teks')`,
  );
  return batchId;
}

function insertItem(userId: string, batchId: string, sentinel: string): string {
  const itemId = randomUUID();
  sql(
    `insert into public.import_items (id, user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action) ` +
    `values ('${itemId}', '${userId}', '${batchId}', 'experience', 0, '{"organization":"${sentinel}","role_title":"Analis"}'::jsonb, '${sentinel} kutipan', 'create')`,
  );
  return itemId;
}

/** A record for each kind, made through the same RPCs the product uses, plus the rows only a worker writes. */
async function buildOwned(account: Account, label: string, sentinel: string): Promise<Owned> {
  const { client, id: userId } = account;
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const result = await rpcAny(client, name, args);
    if (result.error || result.data === null || result.data === undefined) {
      throw new Error(`T25 fixture ${label} ${name} failed: ${result.error?.code ?? "no data"} ${scrub(result.error?.message)}`);
    }
    return first(result.data);
  };
  const keys: Record<string, string> = {};
  const key = (name: string) => (keys[name] = randomUUID());

  const experience = await rpc("create_experience_idempotent", {
    p_operation_key: key("create_experience_idempotent"), p_organization: `Org ${sentinel}`.slice(0, 120), p_role_title: "Analis", p_description: null,
    p_kind: "employment", p_start_date: "2024-01-01", p_start_precision: "month", p_end_date: null, p_end_precision: null, p_is_current: false,
  });
  const education = await rpc("create_education_idempotent", {
    p_operation_key: key("create_education_idempotent"), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: null, p_description: null,
    p_start_date: "2019-01-01", p_start_precision: "year", p_end_date: "2023-01-01", p_end_precision: "year", p_is_current: false,
  });
  const certification = await rpc("create_certification_idempotent", {
    p_operation_key: key("create_certification_idempotent"), p_name: "Sertifikat Contoh", p_issuer: "Lembaga", p_credential_url: null,
    p_issued_date: "2024-06-01", p_issued_precision: "month",
  });
  const skill = await rpc("create_skill_idempotent", { p_operation_key: key("create_skill_idempotent"), p_name: `Analisis ${label}` });
  const project = await rpc("create_project_idempotent", {
    p_operation_key: key("create_project_idempotent"), p_title: `Proyek ${sentinel}`.slice(0, 120), p_description: null, p_user_role: null, p_outcome: null,
    p_status: "active", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false, p_experience_id: experience["id"],
  });
  const activity = await rpc("create_activity_idempotent", {
    p_operation_key: key("create_activity_idempotent"), p_raw_text: `${sentinel} catatan`, p_occurred_on: "2026-10-01", p_capture_mode: "note",
    p_role: null, p_scope: null, p_outcome: null, p_experience_id: experience["id"], p_project_id: project["project_id"],
  });
  await rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(), p_raw_text: `${sentinel} obrolan`, p_occurred_on: "2026-10-02", p_capture_mode: "chat",
    p_role: null, p_scope: null, p_outcome: null, p_experience_id: null, p_project_id: null,
  });
  const created = await rpc("create_achievement_idempotent", {
    p_operation_key: key("create_achievement_idempotent"), p_activity_id: activity["activity_id"], p_project_id: null, p_experience_id: null,
  });
  const achievementId = String(created["id"] ?? created["achievement_id"]);
  const changes = { title: `Hasil ${sentinel}`.slice(0, 120), contribution: "Kontribusi", scope: "", outcome: "Hasil", cv_bullet: "Butir", achieved_on: "2026-09-20", metrics: [] };
  await rpc("save_achievement", { p_achievement_id: achievementId, p_expected_revision: 1, p_action: "save_draft", p_changes: changes, p_skill_names: [`Analisis ${label}`] });
  const confirmed = await rpc("save_achievement", { p_achievement_id: achievementId, p_expected_revision: 2, p_action: "confirm", p_changes: changes, p_skill_names: [`Analisis ${label}`] });
  expect(confirmed, `${label} achievement confirm`).toBeTruthy();

  await rpc("ensure_cv_document", {});
  const cv = required((await client.from("cv_documents").select("id, revision").eq("user_id", userId).single()).data, null, `${label} cv`);
  await rpc("select_cv_source", { p_expected_revision: cv.revision, p_source_type: "education", p_source_id: education["id"] });
  const afterFirst = required((await client.from("cv_documents").select("id, revision").eq("user_id", userId).single()).data, null, `${label} cv 2`);
  await rpc("select_cv_source", { p_expected_revision: afterFirst.revision, p_source_type: "achievement", p_source_id: achievementId });
  const cvNow = required((await client.from("cv_documents").select("id, revision").eq("user_id", userId).single()).data, null, `${label} cv 3`);
  const item = required((await client.from("cv_items").select("id").eq("user_id", userId).eq("section_key", "education").limit(1).single()).data, null, `${label} cv item`);

  // AI consent and a queued analysis job go through their RPCs; the review row and import rows are written as the owner.
  const profile = required((await client.from("profiles").select("revision").eq("id", userId).single()).data, null, `${label} profile`);
  await rpc("set_ai_consent", { p_expected_revision: profile.revision, p_consented: true });
  const activityRevision = Number(sql(`select revision from public.activities where id = '${String(activity["activity_id"])}'`));
  const job = await rpc("request_ai_analysis", { p_activity_id: activity["activity_id"], p_expected_revision: activityRevision });
  const jobId = String(job["id"] ?? job["job_id"]);
  sql(
    `insert into public.ai_suggestion_reviews (user_id, activity_id, activity_revision, job_id) ` +
    `values ('${userId}', '${String(activity["activity_id"])}', ${activityRevision}, '${jobId}')`,
  );
  const batchId = insertBatch(userId, sentinel);
  const itemId = insertItem(userId, batchId, sentinel);

  return {
    account,
    ids: {
      activity: String(activity["activity_id"]), achievement: achievementId, project: String(project["project_id"]), experience: String(experience["id"]),
      education: String(education["id"]), certification: String(certification["id"]), skill: String(skill["id"]), job: jobId,
      batch: batchId, item: itemId, export: "", cvItem: item.id,
    },
    cvId: cvNow.id,
    cvRevision: cvNow.revision,
    keys,
  };
}

const revisionOf = (kind: Kind, id: string): number => {
  const raw = sql(`select revision from public.${TABLE_OF[kind]} where id = '${id}'`);
  return raw === "" ? 1 : Number(raw);
};

const ownerColumn = (table: string) => (table === "profiles" ? "id" : "user_id");

function fingerprint(table: string, ownerId: string): string {
  return sql(
    `select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) || ':' || count(*) from public.${table} x where ${ownerColumn(table)} = '${ownerId}'::uuid`,
  );
}

interface CatalogTable { name: string; columns: string[] }
function ownerTablesOfPublic(): CatalogTable[] {
  const names = sql(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1`).split("\n").filter(Boolean);
  return names.map((name) => {
    const hasUserId = sql(
      `select count(*) from pg_attribute where attrelid = 'public.${name}'::regclass and attname = 'user_id' and attnum > 0 and not attisdropped`,
    ) === "1";
    expect(hasUserId || name === "profiles", `public.${name} has no user_id column; add its owner column to the ownership suite`).toBe(true);
    const columns = sql(
      `select attname from pg_attribute where attrelid = 'public.${name}'::regclass and attnum > 0 and not attisdropped ` +
      `and has_column_privilege('authenticated', attrelid, attnum, 'SELECT') order by attnum`,
    ).split("\n").filter(Boolean);
    return { name, columns };
  });
}

interface FunctionInfo { name: string; args: { name: string; type: string }[] }
function publicFunctions(where: string): FunctionInfo[] {
  const raw = sql(
    `select coalesce(json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid))), '[]'::json) ` +
    `from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and ${where}`,
  );
  return (JSON.parse(raw) as { name: string; args: string }[]).map((entry) => ({
    name: entry.name,
    args: entry.args === "" ? [] : entry.args.split(", ").map((part) => {
      const space = part.indexOf(" ");
      return { name: part.slice(0, space), type: part.slice(space + 1) };
    }),
  }));
}

function dummyFor(type: string): unknown {
  if (type === "uuid") return randomUUID();
  if (type === "uuid[]") return [randomUUID()];
  if (type === "integer" || type === "bigint" || type === "smallint") return 1;
  if (type === "boolean") return false;
  if (type === "text") return "x";
  if (type === "jsonb" || type === "json") return {};
  if (type === "date") return "2026-10-01";
  if (type === "timestamp with time zone") return new Date().toISOString();
  return null;
}

const dummyArgs = (info: FunctionInfo): Record<string, unknown> =>
  Object.fromEntries(info.args.map((arg) => [arg.name, dummyFor(arg.type)]));

interface RpcCase {
  rpc: string;
  param: string;
  kind: Kind;
  /** Builds the full argument object with `target` in the param under test and `revision` as the target's revision. */
  build: (target: string, revision: number, ctx: Ctx, who: Who) => Record<string, unknown>;
  /** Without a control, the owner's own call would change data or cannot differ from a random id. */
  control: boolean;
}

interface Ctx { a: Owned; b: Owned; bCvRevision: number }

/** Whose id sits in the parameter under test: a record of A, an id nobody owns, or a record of B itself. */
type Who = "foreign" | "random" | "own";

const nothing = { p_description: null, p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null };
const changes = (field: string) => ({ [field]: `Baru ${randomUUID().slice(0, 8)}` });

const CASES: RpcCase[] = [
  { rpc: "answer_ai_questions", param: "p_job_id", kind: "job", control: true, build: (t, r) => ({ p_job_id: t, p_expected_revision: r, p_answers: { outcome: "Hasil" } }) },
  { rpc: "apply_ai_suggestion", param: "p_job_id", kind: "job", control: true, build: (t) => ({ p_job_id: t, p_expected_activity_revision: 1, p_expected_achievement_revision: 1 }) },
  { rpc: "cancel_import_batch", param: "p_batch_id", kind: "batch", control: false, build: (t) => ({ p_batch_id: t }) },
  { rpc: "commit_import_batch", param: "p_batch_id", kind: "batch", control: true, build: (t, r) => ({ p_batch_id: t, p_expected_revision: r, p_onboarding: null }) },
  { rpc: "create_achievement_idempotent", param: "p_activity_id", kind: "activity", control: true, build: (t) => ({ p_operation_key: randomUUID(), p_activity_id: t, p_project_id: null, p_experience_id: null }) },
  { rpc: "create_achievement_idempotent", param: "p_project_id", kind: "project", control: true, build: (t) => ({ p_operation_key: randomUUID(), p_activity_id: null, p_project_id: t, p_experience_id: null }) },
  { rpc: "create_achievement_idempotent", param: "p_experience_id", kind: "experience", control: true, build: (t) => ({ p_operation_key: randomUUID(), p_activity_id: null, p_project_id: null, p_experience_id: t }) },
  { rpc: "create_activity_idempotent", param: "p_project_id", kind: "project", control: true, build: (t, _r, c, who) => ({
      p_operation_key: randomUUID(), p_raw_text: "Catatan", p_occurred_on: "2026-10-01", p_capture_mode: "note", p_role: null, p_scope: null, p_outcome: null,
      // A project carries its Experience, so the call names it too: A's for A's project, B's own for B's own.
      p_experience_id: who === "own" ? c.b.ids.experience : who === "foreign" ? c.a.ids.experience : randomUUID(), p_project_id: t,
    }) },
  { rpc: "create_activity_idempotent", param: "p_experience_id", kind: "experience", control: true, build: (t) => ({ p_operation_key: randomUUID(), p_raw_text: "Catatan", p_occurred_on: "2026-10-01", p_capture_mode: "note", p_role: null, p_scope: null, p_outcome: null, p_experience_id: t, p_project_id: null }) },
  { rpc: "create_project_idempotent", param: "p_experience_id", kind: "experience", control: true, build: (t) => ({ p_operation_key: randomUUID(), p_title: "Proyek", p_description: null, p_user_role: null, p_outcome: null, p_status: "active", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false, p_experience_id: t }) },
  ...(["achievement", "activity", "certification", "education", "experience", "project", "skill"] as const).map((kind): RpcCase => ({
    rpc: `delete_${kind}`, param: `p_${kind}_id`, kind, control: true, build: (t, r) => ({ [`p_${kind}_id`]: t, p_expected_revision: r }),
  })),
  { rpc: "dismiss_ai_suggestion", param: "p_job_id", kind: "job", control: true, build: (t) => ({ p_job_id: t }) },
  { rpc: "filter_achievements", param: "p_skill_id", kind: "skill", control: true, build: (t) => ({ p_skill_id: t, p_missing_ready_evidence: false }) },
  { rpc: "get_cv_export_download", param: "p_export_id", kind: "export", control: true, build: (t) => ({ p_export_id: t }) },
  { rpc: "relink_achievement_project", param: "p_achievement_id", kind: "achievement", control: true, build: (t, r) => ({ p_achievement_id: t, p_expected_revision: r, p_project_id: null }) },
  { rpc: "relink_achievement_project", param: "p_project_id", kind: "project", control: true, build: (t, _r, c) => ({ p_achievement_id: c.b.ids.achievement, p_expected_revision: revisionOf("achievement", c.b.ids.achievement), p_project_id: t }) },
  { rpc: "relink_activity_project", param: "p_activity_id", kind: "activity", control: true, build: (t, r) => ({ p_activity_id: t, p_expected_revision: r, p_project_id: null }) },
  { rpc: "relink_activity_project", param: "p_project_id", kind: "project", control: true, build: (t, _r, c) => ({ p_activity_id: c.b.ids.activity, p_expected_revision: revisionOf("activity", c.b.ids.activity), p_project_id: t }) },
  { rpc: "remove_cv_item", param: "p_item_id", kind: "cvItem", control: true, build: (t, _r, c) => ({ p_expected_revision: c.bCvRevision, p_item_id: t, p_remove_children: false }) },
  { rpc: "reorder_cv_section", param: "p_item_ids", kind: "cvItem", control: true, build: (t, _r, c) => ({ p_expected_revision: c.bCvRevision, p_section_key: "education", p_item_ids: [t] }) },
  { rpc: "request_ai_analysis", param: "p_activity_id", kind: "activity", control: true, build: (t, r) => ({ p_activity_id: t, p_expected_revision: r }) },
  { rpc: "retry_ai_job", param: "p_job_id", kind: "job", control: true, build: (t) => ({ p_job_id: t }) },
  { rpc: "retry_cv_export", param: "p_export_id", kind: "export", control: true, build: (t) => ({ p_export_id: t }) },
  { rpc: "retry_import_batch", param: "p_batch_id", kind: "batch", control: true, build: (t) => ({ p_batch_id: t }) },
  {
    rpc: "save_achievement", param: "p_achievement_id", kind: "achievement", control: true,
    build: (t, r) => ({
      p_achievement_id: t, p_expected_revision: r, p_action: "save_draft", p_skill_names: [],
      p_changes: { title: "Baru", contribution: "Kontribusi", scope: "", outcome: "Hasil", cv_bullet: "", achieved_on: "2026-09-20", metrics: [] },
    }),
  },
  ...(["experience", "project", "achievement", "education", "certification", "skill"] as const).map((kind): RpcCase => ({
    rpc: "select_cv_source", param: "p_source_id", kind, control: true,
    build: (t, _r, c) => ({ p_expected_revision: c.bCvRevision, p_source_type: kind, p_source_id: t }),
  })),
  { rpc: "skip_ai_questions", param: "p_job_id", kind: "job", control: true, build: (t) => ({ p_job_id: t }) },
  { rpc: "update_activity", param: "p_activity_id", kind: "activity", control: true, build: (t, r) => ({ p_activity_id: t, p_expected_revision: r, p_changes: { raw_text: `Baru ${randomUUID().slice(0, 8)}`, occurred_on: "2026-10-01", role: null, scope: null, outcome: null, experience_id: null, project_id: null } }) },
  { rpc: "update_certification", param: "p_certification_id", kind: "certification", control: true, build: (t, r) => ({ p_certification_id: t, p_expected_revision: r, p_changes: changes("name") }) },
  { rpc: "update_education", param: "p_education_id", kind: "education", control: true, build: (t, r) => ({ p_education_id: t, p_expected_revision: r, p_changes: changes("institution") }) },
  { rpc: "update_experience", param: "p_experience_id", kind: "experience", control: true, build: (t, r) => ({ p_experience_id: t, p_expected_revision: r, p_changes: changes("organization") }) },
  { rpc: "update_project", param: "p_project_id", kind: "project", control: true, build: (t, r) => ({ p_project_id: t, p_expected_revision: r, p_changes: changes("title") }) },
  { rpc: "update_skill", param: "p_skill_id", kind: "skill", control: true, build: (t, r) => ({ p_skill_id: t, p_expected_revision: r, p_changes: changes("name") }) },
  { rpc: "update_import_item", param: "p_item_id", kind: "item", control: true, build: (t, r) => ({ p_item_id: t, p_expected_revision: r, p_action: "skip", p_target_id: null, p_payload_patch: {}, p_confirm_requested: false }) },
  { rpc: "update_import_item", param: "p_target_id", kind: "experience", control: true, build: (t, _r, c) => ({ p_item_id: c.b.ids.item, p_expected_revision: revisionOf("item", c.b.ids.item), p_action: "map", p_target_id: t, p_payload_patch: {}, p_confirm_requested: false }) },
  { rpc: "validate_import_batch", param: "p_batch_id", kind: "batch", control: true, build: (t) => ({ p_batch_id: t }) },
];

/** Operation and idempotency keys: a second account replaying the key must get its own record, never the first one's. */
const REPLAY_RPCS: Record<string, (key: string) => Record<string, unknown>> = {
  create_experience_idempotent: (key) => ({ p_operation_key: key, p_organization: "Org Replay", p_role_title: "Peran", p_description: null, p_kind: "employment", p_start_date: "2024-01-01", p_start_precision: "month", p_end_date: null, p_end_precision: null, p_is_current: false }),
  create_education_idempotent: (key) => ({ p_operation_key: key, p_institution: "Kampus Replay", p_qualification: "S1", p_field_of_study: null, p_description: null, p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false }),
  create_certification_idempotent: (key) => ({ p_operation_key: key, p_name: "Sertifikat Replay", p_issuer: "Lembaga", p_credential_url: null, p_issued_date: null, p_issued_precision: null }),
  create_skill_idempotent: (key) => ({ p_operation_key: key, p_name: "Replay Skill" }),
  create_project_idempotent: (key) => ({ p_operation_key: key, p_title: "Proyek Replay", p_description: null, p_user_role: null, p_outcome: null, p_status: "active", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false, p_experience_id: null }),
  create_activity_idempotent: (key) => ({ p_operation_key: key, p_raw_text: "Catatan replay", p_occurred_on: "2026-10-01", p_capture_mode: "note", p_role: null, p_scope: null, p_outcome: null, p_experience_id: null, p_project_id: null }),
};

const report: Record<string, unknown> = {};

// The checks above are only worth something if they can fail. These run the same functions on answers that a broken
// database would give, without touching the database.
describe("T25 ownership checks can fail", () => {
  const A = randomUUID();
  it("reports rows returned to a stranger, an unexpected error and a write that took effect", () => {
    expect(leakOf({ data: [{ user_id: A }], error: null })).toMatch(/1 row/);
    expect(leakOf({ data: [], error: null })).toBeNull();
    expect(leakOf({ data: null, error: { code: "42501" } })).toBeNull();
    expect(leakOf({ data: null, error: { code: "XX000" } })).toMatch(/unexpected error/);
    expect(writeLeakOf({ data: [{ id: A }], error: null })).toMatch(/1 row/);
    expect(writeLeakOf({ data: [], error: null })).toBeNull();
  });

  it("tells a foreign answer that differs from a random one", () => {
    const refused = outcome({ data: null, error: { code: "P0001", message: `AI_JOB_UNAVAILABLE ${randomUUID()}` } });
    const conflict = outcome({ data: null, error: { code: "P0001", message: "REVISION_CONFLICT" } });
    expect(refused).toEqual(outcome({ data: null, error: { code: "P0001", message: `AI_JOB_UNAVAILABLE ${randomUUID()}` } }));
    expect(refused).not.toEqual(conflict);
    expect(outcome({ data: [{ id: A }], error: null })).not.toEqual(outcome({ data: [], error: null }));
  });

  it("fails on a private sentinel in what a stranger received", () => {
    expect(() => noSentinel([{ note: `x ${SENTINEL_A} y` }], "response")).toThrow();
    expect(() => noSentinel([{ note: SENTINEL_B }], "response")).not.toThrow();
  });
});

describe("T25 release isolation: two accounts, every table, RPC, storage path and route", () => {
  let a: Owned;
  let b: Owned;
  let seeded: Seeded;
  let bClient: Client;
  let exportId = "";
  let readyEvidence = { id: "", objectKey: "" };
  const aTables: string[] = [];
  const responsesOfB: unknown[] = [];

  beforeAll(async () => {
    setupHarness();
    const accountA = await newAccount("a");
    const accountB = await newAccount("b");
    // Objects in the three storage categories, a succeeded export, an uploading evidence row and a review batch for A.
    seeded = await seedAccount(accountA);
    exportId = seeded.exportId;
    a = await buildOwned(accountA, "a", SENTINEL_A);
    a.ids.export = exportId;
    // A ready file of A's project through the real path: reserve, upload, malware scan (clean fake scanner).
    const adminConfig = getAdminConfig();
    const evidence = createEvidenceService({
      repository: new SupabaseEvidenceRepository(getAdmin() as never),
      storage: new SupabaseStorageAdapter(getAdmin() as never),
      resolveActor: async () => ({ id: accountA.id }),
    });
    const bytes = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
    const reserved = await evidence.reserve({
      parentKind: "project", parentId: a.ids.project, filename: "bukti.pdf", contentType: "application/pdf", expectedBytes: bytes.length,
      idempotencyKey: randomUUID(), expectedRevision: revisionOf("project", a.ids.project),
    });
    await evidence.upload(reserved.id, reserved.revision, "application/pdf", new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }));
    const scanner = { scan: async () => ({ status: "clean" }) } as unknown as MalwareScanner;
    const gateway = createSupabaseEvidenceWorkerGateway({ url: adminConfig.url, secretKey: adminConfig.secretKey });
    for (let pass = 0; pass < 20; pass += 1) {
      await runEvidenceWorkerOnce({ ...gateway, scanner });
      if (sql(`select status from public.evidence_files where id = '${reserved.id}'`) === "ready") break;
    }
    expect(sql(`select status from public.evidence_files where id = '${reserved.id}'`), "A's evidence reached ready").toBe("ready");
    readyEvidence = { id: reserved.id, objectKey: reserved.objectKey };
    b = await buildOwned(accountB, "b", SENTINEL_B);
    // A queued export of B's own: the owner control of the export RPCs needs a record of B that is not A's.
    const bExport = randomUUID();
    sql(
      `insert into public.cv_exports (id, user_id, cv_id, cv_revision, snapshot, status, idempotency_key) ` +
      `values ('${bExport}', '${accountB.id}', '${b.cvId}', ${b.cvRevision}, '{"title":"b"}'::jsonb, 'queued', 't25-b-${bExport}')`,
    );
    b.ids.export = bExport;
    bClient = accountB.client;
  }, LONG);

  afterAll(async () => {
    const out = process.env["WORKPULSE_RELEASE_OWNERSHIP_OUT"];
    if (out) writeFileSync(out, JSON.stringify(report, null, 2));
    await teardownHarness();
  }, LONG);

  it("has a fixture for every public table of the catalog, or a written reason", () => {
    const tables = ownerTablesOfPublic();
    expect(tables.length).toBeGreaterThanOrEqual(18);
    const missing: string[] = [];
    for (const table of tables) {
      const rows = Number(sql(`select count(*) from public.${table.name} where ${ownerColumn(table.name)} = '${a.account.id}'::uuid`));
      if (rows > 0) aTables.push(table.name);
      else if (!(table.name in NO_FIXTURE_REASON)) missing.push(table.name);
    }
    expect(missing, "tables without a row for account A and without a reason").toEqual([]);
    for (const table of Object.keys(WRITTEN_AS_DATABASE_OWNER)) expect(tables.map((entry) => entry.name)).toContain(table);
    report["tables"] = { count: tables.length, withFixture: aTables.length, writtenAsDatabaseOwner: WRITTEN_AS_DATABASE_OWNER };
  }, LONG);

  it("keeps every owner table closed to the other account: select, update, delete and insert", async () => {
    const tables = ownerTablesOfPublic();
    const perTable: Record<string, unknown> = {};
    for (const table of tables) {
      const owner = ownerColumn(table.name);
      const before = fingerprint(table.name, a.account.id);
      const select = table.columns.join(",");
      const entry: Record<string, string> = {};

      // Control: the owner reads the row, so an empty answer for B is not an empty fixture.
      if (select !== "" && table.columns.includes(owner)) {
        const own = await from(a.account.client, table.name).select(select).eq(owner, a.account.id);
        expect(own.error, `${table.name}: owner read`).toBeNull();
        expect((own.data as unknown[]).length, `${table.name}: owner sees own rows`).toBeGreaterThan(0);
        entry["ownerRead"] = "rows";
      } else {
        entry["ownerRead"] = "no direct SELECT of the owner column for authenticated";
      }

      if (select === "") {
        const denied = await from(bClient, table.name).select(owner).eq(owner, a.account.id);
        expect(denied.error?.code, `${table.name}: no column privilege`).toBe("42501");
        entry["select"] = "permission denied";
      } else {
        const filtered = await from(bClient, table.name).select(select).eq(owner, a.account.id);
        expect(leakOf(filtered), `${table.name}: B reads rows of A`).toBeNull();
        entry["select"] = filtered.error ? "permission denied" : "zero rows";
        const unfiltered = await from(bClient, table.name).select(select).limit(1000);
        if (!unfiltered.error) {
          responsesOfB.push(unfiltered.data);
          const rows = unfiltered.data as Record<string, unknown>[];
          if (table.columns.includes(owner)) expect(rows.some((row) => row[owner] === a.account.id), `${table.name}: unfiltered read`).toBe(false);
        }
      }

      const update = await from(bClient, table.name).update({ created_at: "2000-01-01T00:00:00Z" }).eq(owner, a.account.id).select(owner);
      expect(leakOf(update), `${table.name}: B updated rows of A`).toBeNull();
      entry["update"] = update.error ? "permission denied" : "zero rows";

      const remove = await from(bClient, table.name).delete().eq(owner, a.account.id).select(owner);
      expect(leakOf(remove), `${table.name}: B deleted rows of A`).toBeNull();
      entry["delete"] = remove.error ? "permission denied" : "zero rows";

      const insert = await from(bClient, table.name).insert({ [owner]: a.account.id }).select(owner);
      expect(insert.error, `${table.name}: B inserted a row for A`).not.toBeNull();
      entry["insert"] = insert.error?.code ?? "error";

      expect(fingerprint(table.name, a.account.id), `${table.name}: rows of A changed`).toBe(before);
      perTable[table.name] = entry;
    }
    report["tableChecks"] = perTable;
  }, LONG);

  it("answers a foreign record id exactly like a random id in every RPC that takes one", async () => {
    // The catalog decides what must be covered: every function B may execute with a uuid parameter that names a record.
    const executable = publicFunctions(`has_function_privilege('authenticated', p.oid, 'execute')`);
    const wanted = executable.flatMap((fn) => fn.args
      .filter((arg) => (arg.type === "uuid" || arg.type === "uuid[]") && !["p_operation_key", "p_idempotency_key"].includes(arg.name))
      .map((arg) => `${fn.name}.${arg.name}`));
    const covered = new Set(CASES.map((entry) => `${entry.rpc}.${entry.param}`));
    expect(wanted.filter((entry) => !covered.has(entry)), "RPC id parameters without a case").toEqual([]);
    expect([...covered].filter((entry) => !wanted.includes(entry)), "cases for parameters that no longer exist").toEqual([]);

    const ctx: Ctx = { a, b, bCvRevision: Number(sql(`select revision from public.cv_documents where user_id = '${b.account.id}'`)) };
    const beforeA = aTables.map((table) => fingerprint(table, a.account.id));
    const rows: Record<string, unknown>[] = [];
    const uncontrolled: string[] = [];
    for (const entry of CASES) {
      const aId = a.ids[entry.kind];
      const revision = revisionOf(entry.kind, aId);
      const foreign = await rpcAny(bClient, entry.rpc, entry.build(aId, revision, ctx, "foreign"));
      const random = await rpcAny(bClient, entry.rpc, entry.build(randomUUID(), revision, ctx, "random"));
      responsesOfB.push(foreign.data, foreign.error, random.data, random.error);
      const label = `${entry.rpc}.${entry.param}`;
      expect(outcome(foreign), `${label}: foreign id differs from random id`).toEqual(outcome(random));
      let control = "none";
      if (entry.control) {
        // Account B calls the same RPC with its own record and a stale revision (never a real one, so nothing is
        // destroyed). The answer must differ from "not found", so the foreign answer above is the ownership check and
        // not one validation failure for every id.
        const bOwn = b.ids[entry.kind];
        const stale = await rpcAny(
          bClient, entry.rpc,
          entry.build(bOwn, revisionOf(entry.kind, bOwn) + 1000, { ...ctx, bCvRevision: ctx.bCvRevision + 1000 }, "own"),
        );
        if (JSON.stringify(outcome(stale)) === JSON.stringify(outcome(random))) { uncontrolled.push(label); report[`uncontrolled ${label}`] = { random: outcome(random), stale: outcome(stale) }; }
        control = outcome(stale).code ?? "ok";
      }
      rows.push({ rpc: entry.rpc, param: entry.param, answer: outcome(random).code ?? "ok", control });
    }
    expect(aTables.map((table) => fingerprint(table, a.account.id)), "rows of A changed").toEqual(beforeA);
    expect(uncontrolled.filter((label) => !(label in NO_OWNER_CONTROL)), "owner control cannot tell the owner from a stranger").toEqual([]);
    report["rpcIdChecks"] = rows;
    report["rpcWithoutOwnerControl"] = uncontrolled.map((label) => ({ label, reason: NO_OWNER_CONTROL[label] }));
  }, LONG);

  it("never returns another account's record for a replayed operation key", async () => {
    const covered = new Set(Object.keys(REPLAY_RPCS));
    const withKey = publicFunctions(`has_function_privilege('authenticated', p.oid, 'execute') and pg_get_function_identity_arguments(p.oid) like 'p_operation_key uuid%'`)
      .map((fn) => fn.name).filter((name) => name !== "create_achievement_idempotent");
    expect(withKey.filter((name) => !covered.has(name)), "operation key RPCs without a replay case").toEqual([]);

    for (const [rpc, args] of Object.entries(REPLAY_RPCS)) {
      const key = a.keys[rpc];
      expect(key, `${rpc}: key of A`).toBeTruthy();
      const replay = await rpcAny(bClient, rpc, args(key!));
      responsesOfB.push(replay.data, replay.error);
      const row = first(replay.data);
      const id = String(row["id"] ?? row["project_id"] ?? row["activity_id"] ?? "");
      if (replay.error === null) {
        // B received a record, and it is B's: not the record A made with the same key.
        expect(id, `${rpc}: replay returned a record`).not.toBe("");
        const table = rpc.replace("create_", "").replace("_idempotent", "");
        const tableName = { experience: "experiences", education: "education", certification: "certifications", skill: "skills", project: "projects", activity: "activities" }[table]!;
        expect(sql(`select user_id from public.${tableName} where id = '${id}'`), `${rpc}: owner of the replayed record`).toBe(b.account.id);
      } else {
        expect(JSON.stringify(replay.error)).not.toContain(a.account.id);
      }
    }
    report["replay"] = Object.keys(REPLAY_RPCS);
  }, LONG);

  it("refuses worker RPCs to authenticated and anon, and every RPC to anon", async () => {
    const anon = signedInClient();
    const workerOnly = publicFunctions(`has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')`);
    expect(workerOnly.length, "worker RPCs found in the catalog").toBeGreaterThanOrEqual(50);
    const codes: Record<string, number> = {};
    for (const fn of workerOnly) {
      for (const [who, client] of [["authenticated", bClient], ["anon", anon]] as const) {
        const result = await rpcAny(client, fn.name, dummyArgs(fn));
        expect(result.error, `${fn.name} as ${who}`).not.toBeNull();
        expect(DENIED_CODES.has(result.error?.code ?? ""), `${fn.name} as ${who}: ${result.error?.code}`).toBe(true);
        codes[result.error!.code!] = (codes[result.error!.code!] ?? 0) + 1;
      }
    }
    const everything = publicFunctions("true");
    for (const fn of everything) {
      const result = await rpcAny(anon, fn.name, dummyArgs(fn));
      expect(result.error, `${fn.name} as anon`).not.toBeNull();
      expect(DENIED_CODES.has(result.error?.code ?? ""), `${fn.name} as anon: ${result.error?.code}`).toBe(true);
    }
    report["workerRpcs"] = { count: workerOnly.length, codes, publicFunctionsDeniedToAnon: everything.length };
  }, LONG);

  it("keeps A's objects closed in every storage category", async () => {
    const keys = [seeded.evidenceKey, readyEvidence.objectKey, seeded.importKey, seeded.exportKey, seeded.orphanKey];
    const anon = signedInClient();
    const digest = async (key: string) => {
      const { data, error } = await getAdmin().storage.from(BUCKET).download(key);
      expect(error).toBeNull();
      return createHash("sha256").update(Buffer.from(await data!.arrayBuffer())).digest("hex");
    };
    const before = await Promise.all(keys.map(digest));
    const countBefore = Number(sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${a.account.id}/')`));
    const results: Record<string, string[]> = {};
    for (const [who, client] of [["authenticated", bClient], ["anon", anon]] as const) {
      const storage = client.storage.from(BUCKET);
      for (const key of keys) {
        const signed = await storage.createSignedUrl(key, 60);
        expect(signed.error, `${who}: signed URL for ${key.split("/")[1]}`).not.toBeNull();
        expect(signed.data, `${who}: signed URL data`).toBeNull();
        const download = await storage.download(key);
        expect(download.error, `${who}: download ${key.split("/")[1]}`).not.toBeNull();
        const overwrite = await storage.upload(key, new TextEncoder().encode("overwrite"), { upsert: true, contentType: "application/pdf" });
        expect(overwrite.error, `${who}: overwrite ${key.split("/")[1]}`).not.toBeNull();
        const removed = await storage.remove([key]);
        expect(removed.error !== null || (removed.data ?? []).length === 0, `${who}: remove ${key.split("/")[1]}`).toBe(true);
      }
      const fresh = await storage.upload(`${a.account.id}/evidence/${randomUUID()}`, new TextEncoder().encode("new"), { contentType: "application/pdf" });
      expect(fresh.error, `${who}: upload into the prefix of A`).not.toBeNull();
      const listing = await storage.list(a.account.id);
      expect(listing.error !== null || (listing.data ?? []).length === 0, `${who}: list the prefix of A`).toBe(true);
      results[who] = ["signedUrl", "download", "overwrite", "remove", "upload", "list"];
    }
    expect(await Promise.all(keys.map(digest)), "objects of A changed").toEqual(before);
    expect(Number(sql(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${a.account.id}/')`))).toBe(countBefore);
    report["storage"] = { objects: keys.length, categories: ["evidence", "import", "export", "orphan"], results };
  }, LONG);

  it("serves the owner's routes to the owner and a foreign id exactly like a random id", async () => {
    const evidenceId = readyEvidence.id;
    const origin = process.env["WORKPULSE_SITE_URL"] ?? "http://localhost:3000";
    const evidenceRoute = await import("@/app/api/evidence/[id]/download/route");
    const exportRoute = await import("@/app/api/cv/exports/[id]/route");
    const importRoute = await import("@/app/api/imports/[id]/route");
    const call = async (as: Account, handler: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>, id: string, init: RequestInit = {}) => {
      session.client = as.client;
      const response = await handler(new Request(`http://127.0.0.1/api/x/${id}`, init), { params: Promise.resolve({ id }) });
      const body = (await response.json()) as Record<string, unknown>;
      return { status: response.status, code: body["code"] ?? null, message: scrub(String(body["message"] ?? "")), body };
    };
    const rows: Record<string, unknown>[] = [];
    const routes = [
      { name: "/api/evidence/[id]/download", handler: evidenceRoute.POST, id: evidenceId, init: { method: "POST", headers: { origin } } as RequestInit },
      { name: "/api/cv/exports/[id]", handler: exportRoute.GET, id: exportId, init: {} as RequestInit },
      { name: "/api/imports/[id]", handler: importRoute.GET, id: a.ids.batch, init: {} as RequestInit },
    ];
    for (const route of routes) {
      const foreign = await call(b.account, route.handler, route.id, route.init);
      const random = await call(b.account, route.handler, randomUUID(), route.init);
      const owner = await call(a.account, route.handler, route.id, route.init);
      responsesOfB.push(foreign.body, random.body);
      expect({ status: foreign.status, code: foreign.code, message: foreign.message }, `${route.name}: foreign id differs from random id`)
        .toEqual({ status: random.status, code: random.code, message: random.message });
      expect(foreign.status, `${route.name}: a stranger is refused`).toBeGreaterThanOrEqual(400);
      expect({ status: owner.status, code: owner.code }, `${route.name}: the owner is answered differently`).not.toEqual({ status: random.status, code: random.code });
      rows.push({ route: route.name, stranger: foreign.status, random: random.status, owner: owner.status });
    }
    report["routes"] = rows;
  }, LONG);

  it("never put a private sentinel in anything account B received", () => {
    noSentinel(responsesOfB, "responses to account B");
    expect(responsesOfB.length).toBeGreaterThan(0);
  });
});
