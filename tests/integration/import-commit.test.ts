import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAiConsentService } from "@/features/ai/consent-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { ImportServiceError } from "@/features/import/import-errors";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createImportService } from "@/features/import/import-service";
import { createTimelineService } from "@/features/timeline/timeline-service";
import { ExplicitTestFakeAIProvider, type FakeAIScenario } from "@/server/ai/fake-provider";
import type { AIProvider } from "@/server/ai/provider";
import { resolveDocxRenderer } from "@/server/documents/docx-renderer";
import { parseInThread } from "@/server/documents/parse-in-thread";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { resolveMalwareScanner, type MalwareScanner } from "@/server/storage/malware-scanner";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { getSupabaseAdminConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runImportWorkerOnce, type ImportWorkerOptions } from "../../workers/import-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";
import { CV_LINES, cvPdf, PDF_MIME } from "../import-fixtures";

const CONTENT_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";
const FILENAME_SENTINEL = `cv-WP-FILENAME-SENTINEL-${randomUUID()}.pdf`;

type Client = SupabaseClient<Database>;
type Account = {
  id: string;
  email: string;
  password: string;
  client: Client;
  imports: ReturnType<typeof createImportService>;
  review: ReturnType<typeof createImportReviewService>;
};

let admin: Client;
let adminConfig: { url: string; secretKey: string };
let importGateway: ReturnType<typeof createSupabaseImportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let scanner: MalwareScanner;
let ownerA: Account;
let ownerB: Account;
const users: string[] = [];
/** Everything the suite could print or return besides owner rows: checked for sentinels at the end. */
const observed: string[] = [];
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

const renderer = resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages: async () => ({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" }) });

function newClient(): Client {
  return createClient<Database>(adminConfig.url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function accountFor(id: string, email: string, password: string): Promise<Account> {
  const client = newClient();
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("import-commit fixture sign-in failed");
  return {
    id, email, password, client,
    imports: createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: id }),
    review: createImportReviewService({ client }),
  };
}

/** Another session of the same owner: a separate connection for race scenarios. */
async function secondSession(acc: Account): Promise<Account> {
  return accountFor(acc.id, acc.email, acc.password);
}

async function createAccount(label: string, options: { onboarded: boolean }): Promise<Account> {
  const email = `import-commit-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("import-commit fixture creation failed");
  users.push(created.data.user.id);
  const account = await accountFor(created.data.user.id, email, password);
  const { data } = await account.client.from("profiles").select("revision").eq("id", account.id).single();
  const consent = await createAiConsentService(account.client).setConsent({ expectedRevision: data!.revision, consented: true });
  void consent;
  if (options.onboarded) {
    const { data: profile } = await account.client.from("profiles").select("revision").eq("id", account.id).single();
    const done = await account.client.rpc("complete_onboarding", {
      p_display_name: `Owner ${label}`, p_locale: "id", p_timezone: "Asia/Jakarta", p_expected_revision: profile!.revision,
    });
    if (done.error) throw new Error("import-commit onboarding fixture failed");
  }
  return account;
}

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}

async function upload(acc: Account, bytes: Uint8Array) {
  return acc.imports.upload({
    idempotencyKey: randomUUID(), filename: encodeURIComponent(FILENAME_SENTINEL), contentType: PDF_MIME,
    contentLength: String(bytes.byteLength), body: body(bytes),
  });
}

async function importPass(overrides: Partial<ImportWorkerOptions> = {}) {
  const summary = await runImportWorkerOnce({ ...importGateway, scanner, renderer, parse: parseInThread, ...overrides });
  observed.push(JSON.stringify(summary));
  return summary;
}

async function aiPass(provider: AIProvider) {
  const summary = await runAiWorkerOnce({ database: aiGateway, provider });
  observed.push(JSON.stringify(summary));
  return summary;
}

async function batchRow(id: string) {
  const { data, error } = await admin.from("import_batches").select("*").eq("id", id).single();
  if (error || !data) throw new Error("batch unavailable");
  return data;
}

async function items(id: string) {
  const { data, error } = await admin.from("import_items").select("*").eq("batch_id", id).order("entity_type").order("ordinal");
  if (error) throw new Error("items unavailable");
  return data ?? [];
}

type Item = Awaited<ReturnType<typeof items>>[number];
const payloadOf = (item: Item) => item.payload as Record<string, unknown>;

async function drive(batchId: string, provider: AIProvider = new ExplicitTestFakeAIProvider("valid")) {
  for (let pass = 0; pass < 20; pass += 1) {
    const row = await batchRow(batchId);
    if (!["queued", "running"].includes(row.status) || row.stage === "uploading") return row;
    if (row.stage === "extracting") await aiPass(provider);
    else await importPass();
  }
  return batchRow(batchId);
}

/** A batch in review built by the real pipeline (upload, ClamAV, parser, fake AI). */
async function reviewBatch(acc: Account, custom: string[] | null = null, scenario: FakeAIScenario = "valid"): Promise<string> {
  // The parser needs at least 200 readable characters, so custom candidate lines are padded with prose.
  const filler = [CV_LINES[CV_LINES.length - 1]!, "Ringkasan tambahan untuk kebutuhan uji integrasi impor CV berbahasa Indonesia.", "Kemampuan komunikasi lintas tim dan pelaporan berkala kepada pemangku kepentingan."];
  const lines = custom ? [CV_LINES[0]!, ...custom, ...filler] : [...CV_LINES, ...filler];
  const view = await upload(acc, cvPdf(1, lines));
  const row = await drive(view.batchId!, new ExplicitTestFakeAIProvider(scenario));
  if (row.status !== "review") throw new Error(`fixture batch did not reach review: ${row.status} ${row.error_code ?? ""}`);
  return view.batchId!;
}

async function canonicalCount(acc: Account): Promise<number> {
  let total = 0;
  for (const table of ["experiences", "education", "certifications", "skills", "projects", "activities", "achievements"] as const) {
    const { count, error } = await acc.client.from(table).select("id", { count: "exact", head: true }).eq("user_id", acc.id);
    if (error) throw new Error("count unavailable");
    total += count ?? 0;
  }
  return total;
}

async function profileState(acc: Account) {
  const { data, error } = await acc.client.from("profiles").select("*").eq("id", acc.id).single();
  if (error || !data) throw new Error("profile unavailable");
  return data;
}

async function createExperience(acc: Account, organization: string, roleTitle: string) {
  const { data, error } = await acc.client.rpc("create_experience_idempotent", {
    p_operation_key: randomUUID(), p_organization: organization, p_role_title: roleTitle, p_description: null as never, p_kind: "employment",
    p_start_date: null as never, p_start_precision: null as never, p_end_date: null as never, p_end_precision: null as never, p_is_current: false,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error("experience fixture failed");
  return row;
}

async function createSkill(acc: Account, name: string) {
  const { data, error } = await acc.client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error("skill fixture failed");
  return row;
}

async function importObjects(userId: string): Promise<string[]> {
  const { data } = await admin.storage.from(PRIVATE_STORAGE_BUCKET).list(`${userId}/import`);
  return (data ?? []).map((object) => object.name);
}

function record(value: unknown) {
  observed.push(typeof value === "string" ? value : JSON.stringify(value));
}

async function failure(promise: Promise<unknown>): Promise<ImportServiceError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportServiceError);
    const known = error as ImportServiceError;
    record({ code: known.code, message: known.message, itemErrors: known.itemErrors });
    return known;
  }
  throw new Error("expected a service error");
}

const outcomeCode = (result: PromiseSettledResult<unknown>) =>
  result.status === "fulfilled" ? "ok" : (result.reason instanceof ImportServiceError ? result.reason.code : "UNEXPECTED");

describe("T16 import commit against local Supabase, Storage and ClamAV", () => {
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
      consoleSpies.push(vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { record(args.map(String).join(" ")); }));
    }
    ownerA = await createAccount("a", { onboarded: true });
    ownerB = await createAccount("b", { onboarded: true });
  });

  afterAll(async () => {
    for (const spy of consoleSpies) spy.mockRestore();
    for (const id of users) {
      const names = await importObjects(id);
      if (names.length) await admin.storage.from(PRIVATE_STORAGE_BUCKET).remove(names.map((name) => `${id}/import/${name}`));
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("1. Indonesian CV with overlapping employment: edit, map, confirm once, then commit atomically and idempotently", async () => {
    const existingSkill = await createSkill(ownerA, "SQL");
    const lines = [...CV_LINES, "ACH|Menyusun dashboard operasional|WP Labs"];
    const view = await upload(ownerA, cvPdf(1, lines));
    expect((await drive(view.batchId!)).status).toBe("review");
    const batchId = view.batchId!;
    const staged = await items(batchId);
    const experience = (organization: string) => staged.find((item) => item.entity_type === "experience" && payloadOf(item).organization === organization)!;
    const skill = (name: string) => staged.find((item) => item.entity_type === "skill" && payloadOf(item).name === name)!;
    const achievements = staged.filter((item) => item.entity_type === "achievement");
    expect(achievements).toHaveLength(2);
    const confirmTarget = achievements.find((item) => String(payloadOf(item).title).startsWith("Menurunkan"))!;
    const draftTarget = achievements.find((item) => String(payloadOf(item).title).startsWith("Menyusun"))!;

    await ownerA.review.updateItem({ item_id: experience("PT Sentinel Nusantara").id, expected_revision: 1, payload_patch: { role_title: "Analis Data Senior" } });
    await ownerA.review.updateItem({ item_id: skill("SQL").id, expected_revision: 1, action: "map", target_id: existingSkill.id });
    await ownerA.review.updateItem({
      item_id: confirmTarget.id, expected_revision: 1, action: "create", confirm_requested: true,
      payload_patch: { contribution: "Menyusun laporan otomatis", outcome: "Waktu laporan turun dari 5 ke 2 jam", achieved_on: "2021-06-15" },
    });
    // Persisted review choices survive a fresh read.
    const reread = (await items(batchId)).find((item) => item.id === skill("SQL").id)!;
    expect(reread).toMatchObject({ action: "map", target_id: existingSkill.id });
    expect(await ownerA.review.validate(batchId)).toEqual([]);

    const before = await canonicalCount(ownerA);
    const revision = (await batchRow(batchId)).revision;
    const result = await ownerA.review.commit({ batch_id: batchId, expected_revision: revision });
    record(result);
    expect(result.counts).toMatchObject({
      experience: { created: 2, mapped: 0, skipped: 0 }, education: { created: 1, mapped: 0, skipped: 0 },
      certification: { created: 1, mapped: 0, skipped: 0 }, skill: { created: 1, mapped: 1, skipped: 0 },
      achievement: { created: 2, mapped: 0, skipped: 0 },
    });
    expect(result).toMatchObject({ confirmed_achievements: 1, onboarding_completed: false, profile_fields_applied: 0 });
    // 2 experiences + 1 education + 1 certification + 1 skill + 2 achievements.
    expect(await canonicalCount(ownerA)).toBe(before + 7);

    const { data: experiences } = await ownerA.client.from("experiences").select("*").eq("user_id", ownerA.id).in("organization", ["PT Sentinel Nusantara", "WP Labs"]);
    const sentinel = experiences!.find((row) => row.organization === "PT Sentinel Nusantara")!;
    const labs = experiences!.find((row) => row.organization === "WP Labs")!;
    expect(sentinel).toMatchObject({ role_title: "Analis Data Senior", start_precision: "year", end_precision: "year", is_current: false });
    expect(labs).toMatchObject({ role_title: "Data Lead", start_precision: "year", end_date: null, end_precision: null, is_current: true });
    expect(new Date(labs.start_date!).getTime()).toBeLessThan(new Date(sentinel.end_date!).getTime());

    const { data: created } = await ownerA.client.from("achievements").select("*").eq("user_id", ownerA.id).eq("origin", "import");
    const confirmed = created!.find((row) => row.status === "confirmed")!;
    const draft = created!.find((row) => row.status === "draft")!;
    expect(created).toHaveLength(2);
    expect(confirmed).toMatchObject({ experience_id: sentinel.id, achieved_on: "2021-06-15", source_activity_revision: null, activity_id: null });
    expect(confirmed.cv_bullet).toBe("Menyusun laporan otomatis. Waktu laporan turun dari 5 ke 2 jam");
    expect(confirmed.source_excerpt).toBe(confirmTarget.source_excerpt);
    expect(draft).toMatchObject({ experience_id: labs.id, cv_bullet: null });
    const { data: skills } = await ownerA.client.from("skills").select("id, name").eq("user_id", ownerA.id);
    expect(skills!.filter((row) => row.name.toLowerCase() === "sql")).toHaveLength(1);
    expect(skills!.some((row) => row.name === "Statistika")).toBe(true);
    void draftTarget;

    const dashboard = await createDashboardService(ownerA.client).getDashboard();
    expect(dashboard.summary).toMatchObject({ confirmedAchievementCount: 1, hasCareerRecords: true });
    const timeline = await createTimelineService(ownerA.client).getTimeline({ type: "", project: "" });
    const titles = timeline.groups.flatMap((group) => group.events.map((event) => event.title));
    expect(titles).toEqual(expect.arrayContaining(["Analis Data Senior", "Data Lead", "S1 Statistika"]));
    expect(titles).toContain(confirmed.title);
    expect(titles).not.toContain(draft.title);

    const again = await ownerA.review.commit({ batch_id: batchId, expected_revision: 1 });
    expect(again).toEqual(result);
    expect(await canonicalCount(ownerA)).toBe(before + 7);
    expect(await batchRow(batchId)).toMatchObject({ status: "committed" });
  });

  it("2. three parallel commits from three sessions create one set of rows and return one result", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Paralel Nusantara|Analis|2020|2021", "SKILL|Rust", "ACH|Membangun layanan paralel|Paralel Nusantara"]);
    const sessions = await Promise.all([1, 2, 3].map(() => secondSession(ownerA)));
    const before = await canonicalCount(ownerA);
    const revision = (await batchRow(batchId)).revision;
    const settled = await Promise.allSettled(sessions.map((session) => session.review.commit({ batch_id: batchId, expected_revision: revision })));
    expect(settled.map(outcomeCode)).toEqual(["ok", "ok", "ok"]);
    const results = settled.map((entry) => (entry as PromiseFulfilledResult<unknown>).value);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    record(results[0]);
    expect(await canonicalCount(ownerA)).toBe(before + 3);
  });

  it("3. one invalid selected item rolls everything back; fixing it lets the commit succeed", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Rollback Nusantara|Analis|2018|2019", "SKILL|Elixir"], "import_partial");
    const staged = await items(batchId);
    const before = { count: await canonicalCount(ownerA), profile: await profileState(ownerA) };
    const revision = (await batchRow(batchId)).revision;
    const error = await failure(ownerA.review.commit({ batch_id: batchId, expected_revision: revision }));
    expect(error.code).toBe("ITEM_INVALID");
    const experienceItem = staged.find((item) => item.entity_type === "experience")!;
    expect(error.itemErrors).toContainEqual({ item_id: experienceItem.id, field: "role_title", code: "REQUIRED" });
    expect(await canonicalCount(ownerA)).toBe(before.count);
    const profile = await profileState(ownerA);
    expect({ revision: profile.revision, onboarding: profile.onboarding_completed_at }).toEqual({ revision: before.profile.revision, onboarding: before.profile.onboarding_completed_at });
    expect(await batchRow(batchId)).toMatchObject({ status: "review", committed_at: null, commit_result: null });
    expect((await items(batchId)).every((item) => item.committed_id === null)).toBe(true);
    expect(await ownerA.review.validate(batchId)).toEqual(error.itemErrors);

    const skipped = await ownerA.review.updateItem({ item_id: experienceItem.id, expected_revision: experienceItem.revision, payload_patch: { role_title: "Analis Tambahan" } });
    const result = await ownerA.review.commit({ batch_id: batchId, expected_revision: skipped.batchRevision });
    expect(result.counts.experience.created).toBe(1);
    expect(await canonicalCount(ownerA)).toBe(before.count + 2);
  });

  it("4. map reuses only the owner's rows, never changes them, and a deleted target blocks the commit", async () => {
    const foreign = await createSkill(ownerB, "B Private Skill");
    const mine = await createExperience(ownerA, "PT Lama Sentosa", "Staf");
    const batchId = await reviewBatch(ownerA, ["EXP|Target Nusantara|Analis|2016|2017", "SKILL|Kotlin"]);
    const staged = await items(batchId);
    const skillItem = staged.find((item) => item.entity_type === "skill")!;
    const experienceItem = staged.find((item) => item.entity_type === "experience")!;
    expect((await failure(ownerA.review.updateItem({ item_id: skillItem.id, expected_revision: 1, action: "map", target_id: foreign.id }))).code).toBe("TARGET_INVALID");
    expect((await failure(ownerA.review.updateItem({ item_id: skillItem.id, expected_revision: 1, action: "map", target_id: randomUUID() }))).code).toBe("TARGET_INVALID");
    expect((await failure(ownerA.review.updateItem({ item_id: skillItem.id, expected_revision: 1, action: "map", target_id: mine.id }))).code).toBe("TARGET_INVALID");

    const mapped = await ownerA.review.updateItem({ item_id: experienceItem.id, expected_revision: 1, action: "map", target_id: mine.id });
    await ownerA.client.rpc("delete_experience", { p_experience_id: mine.id, p_expected_revision: mine.revision });
    const before = await canonicalCount(ownerA);
    const blocked = await failure(ownerA.review.commit({ batch_id: batchId, expected_revision: mapped.batchRevision }));
    expect(blocked.code).toBe("ITEM_INVALID");
    expect(blocked.itemErrors).toContainEqual({ item_id: experienceItem.id, field: "target_id", code: "TARGET_UNAVAILABLE" });
    expect(await canonicalCount(ownerA)).toBe(before);

    const target = await createExperience(ownerA, "PT Target Tetap", "Staf");
    const remapped = await ownerA.review.updateItem({ item_id: experienceItem.id, expected_revision: mapped.itemRevision, action: "map", target_id: target.id });
    const result = await ownerA.review.commit({ batch_id: batchId, expected_revision: remapped.batchRevision });
    expect(result.counts.experience).toEqual({ created: 0, mapped: 1, skipped: 0 });
    const { data: after } = await ownerA.client.from("experiences").select("*").eq("id", target.id).single();
    expect(after).toEqual(target);
  });

  it("5. a new user completes onboarding through the commit, and only with a real name", async () => {
    const fresh = await createAccount("new", { onboarded: false });
    const batchId = await reviewBatch(fresh, ["EXP|Onboarding Nusantara|Analis|2020|2021"]);
    const revision = (await batchRow(batchId)).revision;
    expect((await failure(fresh.review.commit({ batch_id: batchId, expected_revision: revision }))).code).toBe("ONBOARDING_REQUIRED");
    expect((await failure(fresh.review.commit({
      batch_id: batchId, expected_revision: revision, onboarding: { display_name: "Pending Onboarding", locale: "id", timezone: "Asia/Jakarta" },
    }))).code).toBe("ONBOARDING_INVALID");
    expect((await profileState(fresh)).onboarding_completed_at).toBeNull();
    expect(await canonicalCount(fresh)).toBe(0);

    const result = await fresh.review.commit({
      batch_id: batchId, expected_revision: revision, onboarding: { display_name: "Dewi Nyata", locale: "id", timezone: "Asia/Jakarta" },
    });
    expect(result.onboarding_completed).toBe(true);
    const { data: profile } = await fresh.client.from("profiles").select("display_name, locale, timezone, onboarding_completed_at").eq("id", fresh.id).single();
    // The workspace guard redirects to onboarding only while onboarding_completed_at is empty.
    expect(profile).toMatchObject({ display_name: "Dewi Nyata", locale: "id", timezone: "Asia/Jakarta" });
    expect(profile!.onboarding_completed_at).not.toBeNull();
    expect(await canonicalCount(fresh)).toBe(1);
  });

  it("6a. commit racing an item update serialises: one wins, the other gets a clear conflict", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Balapan Satu|Analis|2015|2016", "SKILL|Scala"]);
    const experienceItem = (await items(batchId)).find((item) => item.entity_type === "experience")!;
    const revision = (await batchRow(batchId)).revision;
    const [committer, editor] = await Promise.all([secondSession(ownerA), secondSession(ownerA)]);
    const before = await canonicalCount(ownerA);
    const settled = await Promise.allSettled([
      committer.review.commit({ batch_id: batchId, expected_revision: revision }),
      editor.review.updateItem({ item_id: experienceItem.id, expected_revision: 1, action: "skip" }),
    ]);
    const codes = settled.map(outcomeCode);
    const allowed = [["ok", "NOT_REVIEWABLE"], ["STALE", "ok"]];
    expect(allowed).toContainEqual(codes);
    const after = await canonicalCount(ownerA);
    expect(after).toBe(codes[0] === "ok" ? before + 2 : before);
  });

  it("6b. commit racing a cancel serialises without leaving rows behind a cancelled batch", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Balapan Dua|Analis|2014|2015", "SKILL|Haskell"]);
    const revision = (await batchRow(batchId)).revision;
    const [committer, canceller] = await Promise.all([secondSession(ownerA), secondSession(ownerA)]);
    const before = await canonicalCount(ownerA);
    const settled = await Promise.allSettled([
      committer.review.commit({ batch_id: batchId, expected_revision: revision }),
      canceller.imports.cancel(batchId),
    ]);
    const codes = settled.map(outcomeCode);
    expect([["ok", "NOT_CANCELLABLE"], ["NOT_COMMITTABLE", "ok"]]).toContainEqual(codes);
    const row = await batchRow(batchId);
    expect(row.status).toBe(codes[0] === "ok" ? "committed" : "cancelled");
    expect(await canonicalCount(ownerA)).toBe(codes[0] === "ok" ? before + 2 : before);
  });

  it("6c. commit racing a delete of its map target leaves no orphan and no deadlock", async () => {
    const target = await createExperience(ownerA, "PT Balapan Tiga", "Staf");
    const batchId = await reviewBatch(ownerA, ["EXP|Balapan Tiga|Analis|2013|2014", "ACH|Membangun sistem balapan|Balapan Tiga"]);
    const staged = await items(batchId);
    const experienceItem = staged.find((item) => item.entity_type === "experience")!;
    const mapped = await ownerA.review.updateItem({ item_id: experienceItem.id, expected_revision: 1, action: "map", target_id: target.id });
    const [committer, deleter] = await Promise.all([secondSession(ownerA), secondSession(ownerA)]);
    const settled = await Promise.allSettled([
      committer.review.commit({ batch_id: batchId, expected_revision: mapped.batchRevision }),
      (async () => {
        const { error } = await deleter.client.rpc("delete_experience", { p_experience_id: target.id, p_expected_revision: target.revision });
        if (error) throw new ImportServiceError("UNAVAILABLE");
      })(),
    ]);
    const codes = settled.map(outcomeCode);
    expect([["ok", "ok"], ["ITEM_INVALID", "ok"]]).toContainEqual(codes);
    expect((await ownerA.client.from("experiences").select("id").eq("id", target.id)).data).toEqual([]);
    const { data: dangling } = await ownerA.client.from("achievements").select("id, experience_id").eq("user_id", ownerA.id).eq("origin", "import").eq("experience_id", target.id);
    expect(dangling).toEqual([]);
  });

  it("7. after commit the purge clears staged text but keeps mappings, and the achievement keeps its excerpt", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Retensi Nusantara|Analis|2012|2013", "ACH|Menyusun arsip retensi|Retensi Nusantara"]);
    const revision = (await batchRow(batchId)).revision;
    const result = await ownerA.review.commit({ batch_id: batchId, expected_revision: revision });
    expect(result.counts.achievement.created).toBe(1);
    const committedRows = (await items(batchId)).filter((item) => item.committed_id !== null);
    const achievementItem = committedRows.find((item) => item.entity_type === "achievement")!;
    const excerpt = achievementItem.source_excerpt!;
    expect(await importObjects(ownerA.id)).toContain(batchId);
    for (let pass = 0; pass < 3; pass += 1) await importPass();
    const row = await batchRow(batchId);
    expect(row).toMatchObject({ status: "committed", extracted_text: null, file_key: null });
    expect(row.purged_at).not.toBeNull();
    expect(row.commit_result).not.toBeNull();
    const after = await items(batchId);
    expect(after.every((item) => item.payload === null && item.source_excerpt === null && item.purged_at !== null)).toBe(true);
    expect(after.filter((item) => item.committed_id !== null).map((item) => item.committed_id).sort())
      .toEqual(committedRows.map((item) => item.committed_id).sort());
    expect(await importObjects(ownerA.id)).not.toContain(batchId);
    const { data: achievement } = await ownerA.client.from("achievements").select("source_excerpt, origin").eq("id", achievementItem.committed_id!).single();
    expect(achievement).toEqual({ source_excerpt: excerpt, origin: "import" });
    // A repeated commit after the purge still answers with the first result.
    expect(await ownerA.review.commit({ batch_id: batchId, expected_revision: 1 })).toEqual(result);
  });

  it("8. another account cannot update, validate or commit a batch, and clients cannot write import tables", async () => {
    const batchId = await reviewBatch(ownerA, ["EXP|Isolasi Nusantara|Analis|2011|2012"]);
    const staged = await items(batchId);
    const revision = (await batchRow(batchId)).revision;
    expect((await failure(ownerB.review.commit({ batch_id: batchId, expected_revision: revision }))).code).toBe("NOT_FOUND");
    expect((await failure(ownerB.review.validate(batchId))).code).toBe("NOT_FOUND");
    expect((await failure(ownerB.review.updateItem({ item_id: staged[0]!.id, expected_revision: 1, action: "skip" }))).code).toBe("NOT_FOUND");
    expect((await ownerA.client.from("import_items").update({ action: "skip" }).eq("id", staged[0]!.id)).error).not.toBeNull();
    expect((await ownerA.client.from("import_batches").update({ status: "committed" }).eq("id", batchId)).error).not.toBeNull();
    expect((await ownerA.client.from("import_items").insert({ user_id: ownerA.id, batch_id: batchId, entity_type: "skill", ordinal: 99 })).error).not.toBeNull();
    expect((await ownerA.client.from("import_items").delete().eq("id", staged[0]!.id)).error).not.toBeNull();
    expect(await items(batchId)).toHaveLength(staged.length);
    // The owner's own view of the result is readable but not writable.
    await ownerA.imports.cancel(batchId);
  });

  it("9. log hygiene: errors, details, results and console output never carry CV text or file names", () => {
    const joined = observed.join("\n");
    expect(observed.length).toBeGreaterThan(10);
    expect(joined).not.toContain(CONTENT_SENTINEL);
    expect(joined).not.toContain(FILENAME_SENTINEL);
    expect(joined).not.toContain("PT Sentinel Nusantara");
    expect(joined).not.toContain("Menurunkan waktu laporan");
    expect(joined).not.toMatch(/cv-WP-FILENAME/);
  });
});
