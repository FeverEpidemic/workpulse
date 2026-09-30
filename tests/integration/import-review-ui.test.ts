import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { toImportReviewView } from "@/domain/import/review-view";
import { createAiConsentService } from "@/features/ai/consent-service";
import { ImportServiceError } from "@/features/import/import-errors";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createImportReviewViewService } from "@/features/import/import-review-view-service";
import { createImportService } from "@/features/import/import-service";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
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
  client: Client;
  imports: ReturnType<typeof createImportService>;
  review: ReturnType<typeof createImportReviewService>;
  views: ReturnType<typeof createImportReviewViewService>;
};

let admin: Client;
let adminConfig: { url: string; secretKey: string };
let importGateway: ReturnType<typeof createSupabaseImportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let scanner: MalwareScanner;
let ownerA: Account;
let ownerB: Account;
const users: string[] = [];
const observed: string[] = [];
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

const renderer = resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages: async () => ({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" }) });

function newClient(): Client {
  return createClient<Database>(adminConfig.url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function createAccount(label: string): Promise<Account> {
  const email = `import-review-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("import-review fixture creation failed");
  users.push(created.data.user.id);
  const client = newClient();
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("import-review fixture sign-in failed");
  const id = created.data.user.id;
  const { data } = await client.from("profiles").select("revision").eq("id", id).single();
  await createAiConsentService(client).setConsent({ expectedRevision: data!.revision, consented: true });
  const { data: profile } = await client.from("profiles").select("revision").eq("id", id).single();
  const done = await client.rpc("complete_onboarding", { p_display_name: `Owner ${label}`, p_locale: "id", p_timezone: "Asia/Jakarta", p_expected_revision: profile!.revision });
  if (done.error) throw new Error("import-review onboarding fixture failed");
  return {
    id, client,
    imports: createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: id }),
    review: createImportReviewService({ client }),
    views: createImportReviewViewService({ client, actorId: id }),
  };
}

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}

async function importPass(overrides: Partial<ImportWorkerOptions> = {}) {
  observed.push(JSON.stringify(await runImportWorkerOnce({ ...importGateway, scanner, renderer, parse: parseInThread, ...overrides })));
}
async function aiPass(provider: AIProvider) {
  observed.push(JSON.stringify(await runAiWorkerOnce({ database: aiGateway, provider })));
}

async function batchRow(id: string) {
  const { data, error } = await admin.from("import_batches").select("*").eq("id", id).single();
  if (error || !data) throw new Error("batch unavailable");
  return data;
}

/** A batch in review built by the real pipeline (upload, ClamAV, parser, fake AI). */
async function reviewBatch(acc: Account): Promise<string> {
  const bytes = cvPdf(1, [...CV_LINES, "Ringkasan tambahan untuk kebutuhan uji integrasi impor CV berbahasa Indonesia."]);
  const view = await acc.imports.upload({
    idempotencyKey: randomUUID(), filename: encodeURIComponent(FILENAME_SENTINEL), contentType: PDF_MIME,
    contentLength: String(bytes.byteLength), body: body(bytes),
  });
  const provider = new ExplicitTestFakeAIProvider("valid");
  for (let pass = 0; pass < 20; pass += 1) {
    const row = await batchRow(view.batchId!);
    if (!["queued", "running"].includes(row.status)) break;
    if (row.stage === "extracting") await aiPass(provider);
    else await importPass();
  }
  if ((await batchRow(view.batchId!)).status !== "review") throw new Error("fixture batch did not reach review");
  return view.batchId!;
}

async function createSkill(acc: Account, name: string) {
  const { data, error } = await acc.client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error("skill fixture failed");
  return row;
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

async function rowCounts(acc: Account) {
  const counts = { experiences: 0, education: 0, certifications: 0, skills: 0, achievements: 0 };
  for (const table of ["experiences", "education", "certifications", "skills", "achievements"] as const) {
    const { count, error } = await acc.client.from(table).select("id", { count: "exact", head: true }).eq("user_id", acc.id);
    if (error) throw new Error("count unavailable");
    counts[table] = count ?? 0;
  }
  return counts;
}

async function failure(promise: Promise<unknown>): Promise<ImportServiceError> {
  try { await promise; } catch (error) {
    expect(error).toBeInstanceOf(ImportServiceError);
    const known = error as ImportServiceError;
    observed.push(JSON.stringify({ code: known.code, message: known.message, itemErrors: known.itemErrors }));
    return known;
  }
  throw new Error("expected a service error");
}

describe("T17 import review read model against local Supabase, Storage and ClamAV", () => {
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
    ownerA = await createAccount("a");
    ownerB = await createAccount("b");
  });

  afterAll(async () => {
    for (const spy of consoleSpies) spy.mockRestore();
    for (const id of users) {
      const { data } = await admin.storage.from(PRIVATE_STORAGE_BUCKET).list(`${id}/import`);
      const names = (data ?? []).map((object) => `${id}/import/${object.name}`);
      if (names.length) await admin.storage.from(PRIVATE_STORAGE_BUCKET).remove(names);
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("1. loads groups, excerpts and revisions; map options are only the owner's records", async () => {
    const skillA = await createSkill(ownerA, "SQL");
    const experienceA = await createExperience(ownerA, "PT Lama Sentosa", "Staf");
    const skillB = await createSkill(ownerB, "SQL");
    const experienceB = await createExperience(ownerB, "B-ONLY-ORG", "Staf B");
    const batchId = await reviewBatch(ownerA);

    const snapshot = await ownerA.views.getReviewView(batchId);
    const view = toImportReviewView(snapshot);
    expect(view.state).toBe("review");
    expect(view.groups.map((group) => group.type)).toEqual(["experience", "education", "certification", "skill", "achievement"]);
    expect(view.groups[0]!.candidates.map((candidate) => candidate.excerpt)).toEqual([
      "EXP|PT Sentinel Nusantara|Analis Data|2019|2022", "EXP|WP Labs|Data Lead|2021|",
    ]);
    expect(view.groups[0]!.candidates.every((candidate) => candidate.revision >= 1 && candidate.action === "create")).toBe(true);
    expect(view.summary.byType.experience.create).toBe(2);
    expect(view.revision).toBe((await batchRow(batchId)).revision);

    // Existing SQL: blocking duplicate from validation with a Map target; the owner's records only.
    const sql = view.groups.find((group) => group.type === "skill")!.candidates.find((candidate) => candidate.fields[0]!.value === "SQL")!;
    expect(sql.duplicate).toMatchObject({ source: "validation", targetId: skillA.id, blocking: true });
    const ids = JSON.stringify(snapshot.targets);
    expect(ids).toContain(skillA.id);
    expect(ids).toContain(experienceA.id);
    expect(ids).not.toContain(skillB.id);
    expect(ids).not.toContain(experienceB.id);
    expect(ids).not.toContain("B-ONLY-ORG");
    expect(view.canCommit).toBe(false);
    expect(view.commitBlockers).toEqual([{ kind: "validation", count: 1 }]);
    await ownerA.review.updateItem({ item_id: sql.id, expected_revision: sql.revision, action: "skip" });
  });

  it("2. persists action, map target, patch and confirm: a fresh read shows the same choices and a higher batch revision", async () => {
    const skillA = await createSkill(ownerA, "Kotlin");
    const batchId = await reviewBatch(ownerA);
    const first = toImportReviewView(await ownerA.views.getReviewView(batchId));
    const candidates = first.groups.flatMap((group) => group.candidates);
    const role = candidates.find((candidate) => candidate.type === "experience")!;
    const achievement = candidates.find((candidate) => candidate.type === "achievement")!;
    const stat = candidates.find((candidate) => candidate.type === "skill" && candidate.fields[0]!.value === "Statistika")!;

    await ownerA.review.updateItem({ item_id: role.id, expected_revision: role.revision, payload_patch: { role_title: "Analis Senior" } });
    await ownerA.review.updateItem({ item_id: stat.id, expected_revision: stat.revision, action: "map", target_id: skillA.id });
    expect(achievement.confirm.canConfirm).toBe(false);
    await ownerA.review.updateItem({
      item_id: achievement.id, expected_revision: achievement.revision, confirm_requested: true,
      payload_patch: { contribution: "Menyusun laporan otomatis", outcome: "Waktu laporan turun", achieved_on: "2021-06-15" },
    });

    const second = toImportReviewView(await ownerA.views.getReviewView(batchId));
    const again = second.groups.flatMap((group) => group.candidates);
    expect(again.find((c) => c.id === role.id)!.fields.find((f) => f.name === "role_title")!.value).toBe("Analis Senior");
    expect(again.find((c) => c.id === stat.id)).toMatchObject({ action: "map", targetId: skillA.id });
    expect(again.find((c) => c.id === achievement.id)).toMatchObject({ confirmRequested: true, confirm: { canConfirm: true, requested: true } });
    expect(second.revision).toBeGreaterThan(first.revision);
    expect(second.summary.confirmedAchievements).toBe(1);
    // The pre-existing SQL skill of owner A is still a validation error until it is mapped or skipped.
    for (const error of second.errorSummary) expect(error.field).toBe("name");
  });

  it("3. two edits on the same revision: the second is STALE and the saved value is not overwritten", async () => {
    const batchId = await reviewBatch(ownerA);
    const view = toImportReviewView(await ownerA.views.getReviewView(batchId));
    const role = view.groups[0]!.candidates[0]!;
    await ownerA.review.updateItem({ item_id: role.id, expected_revision: role.revision, payload_patch: { role_title: "Pertama" } });
    const stale = await failure(ownerA.review.updateItem({ item_id: role.id, expected_revision: role.revision, payload_patch: { role_title: "Kedua" } }));
    expect(stale.code).toBe("STALE");
    const saved = toImportReviewView(await ownerA.views.getReviewView(batchId)).groups[0]!.candidates[0]!;
    expect(saved.fields.find((f) => f.name === "role_title")!.value).toBe("Pertama");
    expect(saved.revision).toBe(role.revision + 1);
  });

  it("4. commit shows the stored result equal to real row counts, is idempotent and leaves a mapped target untouched", async () => {
    const skillA = await createSkill(ownerA, "Scala");
    const batchId = await reviewBatch(ownerA);
    let view = toImportReviewView(await ownerA.views.getReviewView(batchId));
    for (const candidate of view.groups.flatMap((group) => group.candidates)) {
      if (candidate.type === "skill" && candidate.fields[0]!.value === "SQL") {
        await ownerA.review.updateItem({ item_id: candidate.id, expected_revision: candidate.revision, action: "skip" });
      }
      if (candidate.type === "skill" && candidate.fields[0]!.value === "Statistika") {
        await ownerA.review.updateItem({ item_id: candidate.id, expected_revision: candidate.revision, action: "map", target_id: skillA.id });
      }
    }
    view = toImportReviewView(await ownerA.views.getReviewView(batchId));
    expect(view.canCommit).toBe(true);
    const targetBefore = JSON.stringify((await ownerA.client.from("skills").select("*").eq("id", skillA.id).single()).data);
    const before = await rowCounts(ownerA);

    const result = await ownerA.review.commit({ batch_id: batchId, expected_revision: view.revision });
    const after = await rowCounts(ownerA);
    expect(after.experiences - before.experiences).toBe(result.counts.experience.created);
    expect(after.education - before.education).toBe(result.counts.education.created);
    expect(after.certifications - before.certifications).toBe(result.counts.certification.created);
    expect(after.skills - before.skills).toBe(result.counts.skill.created);
    expect(after.achievements - before.achievements).toBe(result.counts.achievement.created);
    expect(result.counts.skill).toEqual({ created: 0, mapped: 1, skipped: 1 });

    const committed = toImportReviewView(await ownerA.views.getReviewView(batchId));
    expect(committed.state).toBe("committed");
    expect(committed.groups).toEqual([]);
    const { batch_id: _batchId, committed_at: _committedAt, ...stored } = result;
    void _batchId; void _committedAt;
    expect(committed.result).toEqual(stored);

    expect(await ownerA.review.commit({ batch_id: batchId, expected_revision: 1 })).toEqual(result);
    expect(await rowCounts(ownerA)).toEqual(after);
    expect(JSON.stringify((await ownerA.client.from("skills").select("*").eq("id", skillA.id).single()).data)).toBe(targetBefore);
  });

  it("5. another account cannot read the view of a batch it does not own", async () => {
    const batchId = await reviewBatch(ownerA);
    const foreign = await failure(ownerB.views.getReviewView(batchId));
    const missing = await failure(ownerB.views.getReviewView(randomUUID()));
    expect(foreign.code).toBe("NOT_FOUND");
    expect(missing.code).toBe("NOT_FOUND");
    expect(foreign.messageKey).toBe(missing.messageKey);
    expect((await failure(ownerB.views.getReviewView("not-a-uuid"))).code).toBe("NOT_FOUND");
  });

  it("6. log hygiene: errors, results and console output never carry CV text or file names", async () => {
    const dump = observed.join("\n");
    expect(dump).not.toContain(CONTENT_SENTINEL);
    expect(dump).not.toContain("FILENAME-SENTINEL");
    expect(dump).not.toContain("Sentinel Nusantara");
  });
});


