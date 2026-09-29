import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAiConsentService } from "@/features/ai/consent-service";
import { ImportServiceError } from "@/features/import/import-errors";
import { createImportService } from "@/features/import/import-service";
import { ExplicitTestFakeAIProvider, type FakeAIScenario } from "@/server/ai/fake-provider";
import { UnavailableAIProvider, type AIProvider } from "@/server/ai/provider";
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
import {
  CV_LINES, cvDocx, cvPdf, DOCX_MIME, eicarDocx, emptyDocx, encryptedOfficeFile, macroDocx, PDF_MIME, pdfFixture,
} from "../import-fixtures";

const CONTENT_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";
const FILENAME_SENTINEL = `cv-WP-FILENAME-SENTINEL-${randomUUID()}.pdf`;
const KEY_SENTINEL = "sk-test-WP-SENTINEL-KEY";

type Client = SupabaseClient<Database>;
type Account = { id: string; client: Client; service: ReturnType<typeof createImportService>; consent: ReturnType<typeof createAiConsentService> };

let admin: Client;
let adminConfig: { url: string; secretKey: string };
let importGateway: ReturnType<typeof createSupabaseImportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let scanner: MalwareScanner;
let ownerA: Account;
let ownerB: Account;
const users: string[] = [];
/** Everything the suite could print or return besides owner views: checked for sentinels at the end. */
const observed: string[] = [];

const renderer = resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages: async () => ({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" }) });

async function createAccount(label: string): Promise<Account> {
  const email = `import-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("import fixture creation failed");
  users.push(created.data.user.id);
  const client = createClient<Database>(adminConfig.url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("import fixture sign-in failed");
  const id = created.data.user.id;
  return {
    id, client, consent: createAiConsentService(client),
    service: createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: id }),
  };
}

async function setConsent(acc: Account, consented: boolean) {
  const { data } = await acc.client.from("profiles").select("revision").eq("id", acc.id).single();
  await acc.consent.setConsent({ expectedRevision: data!.revision, consented });
}

function body(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
}

function upload(acc: Account, bytes: Uint8Array, mime = PDF_MIME, options: { key?: string; name?: string; length?: number } = {}) {
  return acc.service.upload({
    idempotencyKey: options.key ?? randomUUID(),
    filename: encodeURIComponent(options.name ?? FILENAME_SENTINEL),
    contentType: mime,
    contentLength: String(options.length ?? bytes.byteLength),
    body: body(bytes),
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

async function importObjects(userId: string): Promise<string[]> {
  const { data } = await admin.storage.from(PRIVATE_STORAGE_BUCKET).list(`${userId}/import`);
  return (data ?? []).map((object) => object.name);
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

/** Drive the pipeline until the batch leaves the worker stages (other queued jobs may be claimed first). */
async function drive(batchId: string, provider: AIProvider = new ExplicitTestFakeAIProvider("valid"), overrides: Partial<ImportWorkerOptions> = {}) {
  for (let pass = 0; pass < 20; pass += 1) {
    const row = await batchRow(batchId);
    if (!["queued", "running"].includes(row.status) || row.stage === "uploading") return row;
    if (row.stage === "extracting") await aiPass(provider);
    else await importPass(overrides);
  }
  return batchRow(batchId);
}

async function expectCode(promise: Promise<unknown>, code: ImportServiceError["code"]) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImportServiceError);
    expect((error as ImportServiceError).code).toBe(code);
    observed.push(JSON.stringify({ code: (error as ImportServiceError).code, message: (error as Error).message }));
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("T15 import staging against local Supabase, Storage and ClamAV", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) throw new Error("Local Supabase environment required");
    adminConfig = config;
    admin = createClient<Database>(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    importGateway = createSupabaseImportWorkerGateway(config);
    aiGateway = createSupabaseAiWorkerGateway(config);
    scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
    ownerA = await createAccount("a");
    ownerB = await createAccount("b");
    await setConsent(ownerA, true);
    await setConsent(ownerB, true);
  });

  afterAll(async () => {
    for (const id of users) {
      const names = await importObjects(id);
      if (names.length) await admin.storage.from(PRIVATE_STORAGE_BUCKET).remove(names.map((name) => `${id}/import/${name}`));
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("1. PDF: upload -> scan -> parse -> AI -> review, without writing canonical records", async () => {
    const before = await canonicalCount(ownerA);
    const view = await upload(ownerA, cvPdf(2));
    expect(view).toMatchObject({ state: "waiting", polling: true, canCancel: true });
    const row = await drive(view.batchId!);
    expect(row).toMatchObject({ status: "review", stage: "done", page_count: 2, mime_type: PDF_MIME });
    const staged = await items(view.batchId!);
    expect(staged.map((item) => item.entity_type).sort()).toEqual(
      ["achievement", "certification", "education", "experience", "experience", "skill", "skill"],
    );
    for (const item of staged) expect(row.extracted_text).toContain(item.source_excerpt!);
    const achievement = staged.find((item) => item.entity_type === "achievement")!;
    expect(achievement.payload).toMatchObject({ status: "draft" });
    expect((achievement.payload as Record<string, unknown>).experience_item_id)
      .toBe(staged.find((item) => item.entity_type === "experience" && (item.payload as { organization: string }).organization === "PT Sentinel Nusantara")!.id);
    expect(await canonicalCount(ownerA)).toBe(before);
    const final = await ownerA.service.getView(view.batchId!);
    expect(final).toMatchObject({ state: "review_ready", total: 7, polling: false });
    expect(JSON.stringify(final)).not.toContain(CONTENT_SENTINEL);
  });

  it("2. DOCX: page count comes from the renderer, not document metadata", async () => {
    const view = await upload(ownerA, cvDocx(CV_LINES, { pages: 3, appPages: 1 }), DOCX_MIME, { name: "cv.docx" });
    const row = await drive(view.batchId!);
    expect(row).toMatchObject({ status: "review", page_count: 3 });
    const large = await upload(ownerA, cvDocx(CV_LINES, { pages: 21, appPages: 1 }), DOCX_MIME, { name: "long.docx" });
    expect(await drive(large.batchId!)).toMatchObject({ status: "failed", error_code: "TOO_MANY_PAGES" });
  });

  it("3. rejects invalid uploads before any batch or object exists", async () => {
    const beforeBatches = (await admin.from("import_batches").select("id").eq("user_id", ownerB.id)).data!.length;
    const beforeObjects = (await importObjects(ownerB.id)).length;
    await expectCode(upload(ownerB, new Uint8Array(0)), "FILE_EMPTY");
    await expectCode(upload(ownerB, cvPdf(), PDF_MIME, { length: 10 * 1024 * 1024 + 1 }), "FILE_TOO_LARGE");
    await expectCode(upload(ownerB, cvPdf(), PDF_MIME, { length: cvPdf().byteLength + 5 }), "UPLOAD_INCOMPLETE");
    await expectCode(upload(ownerB, cvPdf(), DOCX_MIME), "FILE_TYPE_MISMATCH");
    await expectCode(upload(ownerB, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"), "UNSUPPORTED_FORMAT");
    await expectCode(upload(ownerB, Buffer.from("plain text cv"), PDF_MIME), "UNSUPPORTED_FORMAT");
    await expectCode(upload(ownerB, encryptedOfficeFile(), DOCX_MIME), "ENCRYPTED_FILE");
    await expectCode(upload(ownerB, macroDocx(), DOCX_MIME), "UNSUPPORTED_FORMAT");
    const docx = cvDocx();
    await expectCode(upload(ownerB, docx.subarray(0, docx.length - 10), DOCX_MIME), "CORRUPT_FILE");
    expect((await admin.from("import_batches").select("id").eq("user_id", ownerB.id)).data!.length).toBe(beforeBatches);
    expect((await importObjects(ownerB.id)).length).toBe(beforeObjects);
  });

  it("4. file-level parse failures are permanent, purge-eligible and never retriable", async () => {
    const cases: Array<[Uint8Array, string, string]> = [
      [pdfFixture([CV_LINES], { encrypt: true }), PDF_MIME, "ENCRYPTED_FILE"],
      [pdfFixture([[], []], { imageOnly: true }), PDF_MIME, "SCANNED_PDF"],
      [cvPdf(21), PDF_MIME, "TOO_MANY_PAGES"],
      [emptyDocx(), DOCX_MIME, "EMPTY_DOCUMENT"],
    ];
    for (const [bytes, mime, code] of cases) {
      const view = await upload(ownerA, bytes, mime, { name: `case-${code}` });
      expect(await drive(view.batchId!)).toMatchObject({ status: "failed", error_code: code });
      const failed = await ownerA.service.getView(view.batchId!);
      expect(failed).toMatchObject({ state: "failed_permanent", canRetry: false, errorCode: code });
      await expectCode(ownerA.service.retry(view.batchId!), "NOT_RETRIABLE");
    }
  });

  it("5. malware never reaches the parser and the object is physically deleted", async () => {
    const view = await upload(ownerA, eicarDocx(), DOCX_MIME, { name: "eicar.docx" });
    const row = await drive(view.batchId!);
    expect(row).toMatchObject({ status: "failed", error_code: "MALWARE_DETECTED", extracted_text: null, page_count: null });
    await importPass(); // purge enqueues the delete, cleanup removes the object
    await importPass();
    expect(await batchRow(view.batchId!)).toMatchObject({ file_key: null });
    expect(await importObjects(ownerA.id)).not.toContain(view.batchId);
  });

  it("5b. scanner outage retries, then fails retriable; a retry with the real scanner succeeds", async () => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: "outage.pdf" });
    const unavailable = resolveMalwareScanner({ mode: "unavailable" });
    const past = () => new Date(Date.now() - 3_600_000); // backoff lands in the past so the next pass reclaims
    for (let pass = 0; pass < 6 && (await batchRow(view.batchId!)).status !== "failed"; pass += 1) {
      await importPass({ scanner: unavailable, now: past });
    }
    expect(await batchRow(view.batchId!)).toMatchObject({ status: "failed", error_code: "SCANNER_UNAVAILABLE", extracted_text: null });
    expect(await ownerA.service.getView(view.batchId!)).toMatchObject({ state: "failed_retriable", canRetry: true });
    expect(await ownerA.service.retry(view.batchId!)).toMatchObject({ state: "waiting" });
    expect(await drive(view.batchId!)).toMatchObject({ status: "review", retry_count: 1 });
  });

  it("6. consent: none before upload, withdrawn before extraction, then retry", async () => {
    await setConsent(ownerB, false);
    const objects = (await importObjects(ownerB.id)).length;
    await expectCode(upload(ownerB, cvPdf(), PDF_MIME), "CONSENT_REQUIRED");
    expect((await importObjects(ownerB.id)).length).toBe(objects);
    await setConsent(ownerB, true);

    const view = await upload(ownerB, cvPdf(), PDF_MIME, { name: "consent.pdf" });
    await setConsent(ownerB, false);
    const provider = new ExplicitTestFakeAIProvider("valid");
    expect(await drive(view.batchId!, provider)).toMatchObject({ status: "failed", error_code: "CONSENT_REQUIRED", stage: "extracting" });
    expect(provider.importCalls).toHaveLength(0);
    expect(await ownerB.service.getView(view.batchId!)).toMatchObject({ canRetry: false, retryBlockReason: "consent" });
    await expectCode(ownerB.service.retry(view.batchId!), "CONSENT_REQUIRED");
    await setConsent(ownerB, true);
    expect((await ownerB.service.retry(view.batchId!)).state).toBe("extracting");
    expect(await drive(view.batchId!, provider)).toMatchObject({ status: "review" });
    expect(provider.importCalls).toHaveLength(1);
    expect(Object.keys(provider.importCalls[0]!)).toEqual(["text"]);
  });

  it.each([
    ["import_ungrounded", "review_ready"],
    ["import_numbers", "review_ready"],
    ["import_partial", "review_ready"],
    ["import_empty", "review_empty"],
  ] as const)("7. grounding scenario %s", async (scenario, state) => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: `${scenario}.pdf` });
    await drive(view.batchId!, new ExplicitTestFakeAIProvider(scenario as FakeAIScenario));
    expect((await ownerA.service.getView(view.batchId!)).state).toBe(state);
    const staged = await items(view.batchId!);
    const errors = staged.flatMap((item) => item.validation_errors as Array<{ field: string; code: string }>);
    if (scenario === "import_ungrounded") {
      expect(staged.some((item) => JSON.stringify(item.payload).includes("Invented Corp"))).toBe(false);
      expect(errors).toContainEqual({ field: "organization", code: "UNGROUNDED" });
      const job = (await admin.from("ai_jobs").select("result").eq("import_batch_id", view.batchId!).single()).data!;
      expect((job.result as { dropped_ungrounded: number }).dropped_ungrounded).toBe(1);
    }
    if (scenario === "import_numbers") expect(errors).toContainEqual({ field: "title", code: "UNGROUNDED" });
    if (scenario === "import_partial") expect(errors).toContainEqual({ field: "role_title", code: "REQUIRED" });
    if (scenario === "import_empty") expect(staged).toHaveLength(0);
  });

  it("7b. malformed output fails the batch as a retriable AI_OUTPUT_INVALID", async () => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: "malformed.pdf" });
    expect(await drive(view.batchId!, new ExplicitTestFakeAIProvider("malformed"))).toMatchObject({ status: "failed", error_code: "AI_OUTPUT_INVALID" });
    expect(await items(view.batchId!)).toHaveLength(0);
    expect((await ownerA.service.getView(view.batchId!)).state).toBe("failed_retriable");
  });

  it("8. idempotent upload: parallel replays, conflicting bytes, and a replay after the object exists", async () => {
    const key = randomUUID();
    const bytes = cvPdf(1, [...CV_LINES, "idempotent"]);
    const views = await Promise.all([1, 2, 3].map(() => upload(ownerA, bytes, PDF_MIME, { key, name: "same.pdf" })));
    expect(new Set(views.map((view) => view.batchId)).size).toBe(1);
    expect((await admin.from("import_batches").select("id").eq("user_id", ownerA.id).eq("idempotency_key", key)).data).toHaveLength(1);
    await expectCode(upload(ownerA, cvPdf(1, [...CV_LINES, "different"]), PDF_MIME, { key, name: "same.pdf" }), "CONFLICT");

    // Lost response: the batch and object exist but finalize never ran.
    const lostKey = randomUUID();
    const lostBytes = cvPdf(1, [...CV_LINES, "lost response"]);
    const { data: begun } = await ownerA.client.rpc("begin_import_batch", {
      p_idempotency_key: lostKey, p_filename: "lost.pdf", p_bytes: lostBytes.byteLength, p_mime_type: PDF_MIME,
      p_sha256: createHash("sha256").update(lostBytes).digest("hex"),
    });
    const receipt = (begun as Array<{ batch_id: string; file_key: string }>)[0]!;
    await new SupabaseStorageAdapter(admin).uploadObject(receipt.file_key, lostBytes, {
      contentType: PDF_MIME, metadata: { sha256: createHash("sha256").update(lostBytes).digest("hex") },
    });
    const replay = await upload(ownerA, lostBytes, PDF_MIME, { key: lostKey, name: "lost.pdf" });
    expect(replay).toMatchObject({ batchId: receipt.batch_id, state: "waiting" });
    // Leave no queued work for later scenarios.
    for (const id of [views[0]!.batchId!, receipt.batch_id]) await ownerA.service.cancel(id);
  });

  it("9. duplicate-hash warning is per account and never blocks", async () => {
    const bytes = cvPdf(1, [...CV_LINES, "duplicate check"]);
    const first = await upload(ownerA, bytes, PDF_MIME, { name: "dup.pdf" });
    expect(first.duplicate).toBeNull();
    const second = await upload(ownerA, bytes, PDF_MIME, { name: "dup-again.pdf" });
    expect(second.batchId).not.toBe(first.batchId);
    expect(second.duplicate).not.toBeNull();
    const other = await upload(ownerB, bytes, PDF_MIME, { name: "dup.pdf" });
    expect(other.duplicate).toBeNull();
    await ownerA.service.cancel(first.batchId!);
    await ownerA.service.cancel(second.batchId!);
    await ownerB.service.cancel(other.batchId!);
  });

  it("10. cancel while queued, during parsing, and during AI; late completions write nothing", async () => {
    const queued = await upload(ownerA, cvPdf(), PDF_MIME, { name: "cancel-queued.pdf" });
    expect((await ownerA.service.cancel(queued.batchId!)).state).toBe("cancelled");
    expect((await ownerA.service.cancel(queued.batchId!)).state).toBe("cancelled");
    await importPass();
    expect(await batchRow(queued.batchId!)).toMatchObject({ status: "cancelled", extracted_text: null });

    const parsing = await upload(ownerA, cvPdf(), PDF_MIME, { name: "cancel-parsing.pdf" });
    let cancelledDuringParse = false;
    for (let pass = 0; pass < 20 && !cancelledDuringParse; pass += 1) {
      await importPass({
        onScanned: async (job) => {
          if (job.batch_id !== parsing.batchId) return;
          await ownerA.service.cancel(parsing.batchId!);
          cancelledDuringParse = true;
        },
      });
    }
    expect(cancelledDuringParse).toBe(true);
    expect(await batchRow(parsing.batchId!)).toMatchObject({ status: "cancelled", extracted_text: null, page_count: null });

    const extracting = await upload(ownerA, cvPdf(), PDF_MIME, { name: "cancel-ai.pdf" });
    const provider = new ExplicitTestFakeAIProvider("valid");
    provider.onImport = async () => { await ownerA.service.cancel(extracting.batchId!); };
    await drive(extracting.batchId!, provider);
    expect(await batchRow(extracting.batchId!)).toMatchObject({ status: "cancelled" });
    expect(await items(extracting.batchId!)).toHaveLength(0);
    const encrypted = await upload(ownerA, pdfFixture([CV_LINES], { encrypt: true }), PDF_MIME, { name: "enc.pdf" });
    expect(await drive(encrypted.batchId!)).toMatchObject({ status: "failed", error_code: "ENCRYPTED_FILE" });
    await expectCode(ownerA.service.cancel(encrypted.batchId!), "NOT_CANCELLABLE");
  });

  it("11. retry on the same batch: parallel retries enqueue one job, and the limit is enforced", async () => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: "retry.pdf" });
    expect(await drive(view.batchId!, new UnavailableAIProvider())).toMatchObject({ status: "failed", error_code: "AI_UNAVAILABLE" });
    const results = await Promise.allSettled([1, 2, 3].map(() => ownerA.service.retry(view.batchId!)));
    expect(results.filter((result) => result.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const jobs = (await admin.from("ai_jobs").select("id, status").eq("import_batch_id", view.batchId!)).data!;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe("queued");
    expect((await batchRow(view.batchId!)).retry_count).toBe(1);
    expect(await drive(view.batchId!, new UnavailableAIProvider())).toMatchObject({ status: "failed" });
    await ownerA.service.retry(view.batchId!);
    expect(await drive(view.batchId!, new UnavailableAIProvider())).toMatchObject({ status: "failed" });
    // Three AI attempts are used up: the same batch cannot be retried again.
    await expectCode(ownerA.service.retry(view.batchId!), "RETRY_EXHAUSTED");
    expect(await ownerA.service.getView(view.batchId!)).toMatchObject({ state: "failed_retriable" });
  });

  it("12. terminal retention purges text, items and the object while keeping minimal metadata", async () => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: "purge.pdf" });
    await drive(view.batchId!);
    expect(await items(view.batchId!)).not.toHaveLength(0);
    expect(await importObjects(ownerA.id)).toContain(view.batchId);
    await ownerA.service.cancel(view.batchId!);
    await importPass();
    await importPass();
    const row = await batchRow(view.batchId!);
    expect(row).toMatchObject({ status: "cancelled", extracted_text: null, file_key: null });
    expect(row.purged_at).not.toBeNull();
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await items(view.batchId!)).toHaveLength(0);
    expect(await importObjects(ownerA.id)).not.toContain(view.batchId);
  });

  it("13. two-account isolation for views, actions, items and private columns", async () => {
    const view = await upload(ownerA, cvPdf(), PDF_MIME, { name: "isolation.pdf" });
    await drive(view.batchId!);
    await expectCode(ownerB.service.getView(view.batchId!), "NOT_FOUND");
    await expectCode(ownerB.service.cancel(view.batchId!), "NOT_FOUND");
    await expectCode(ownerB.service.retry(view.batchId!), "NOT_FOUND");
    expect((await ownerB.client.from("import_items").select("id").eq("batch_id", view.batchId!)).data).toEqual([]);
    expect((await ownerB.client.from("import_batches").select("id").eq("id", view.batchId!)).data).toEqual([]);
    expect((await ownerA.client.from("import_batches").select("extracted_text").eq("id", view.batchId!)).error).not.toBeNull();
    expect((await ownerA.client.from("import_batches").select("file_key").eq("id", view.batchId!)).error).not.toBeNull();
  });

  it("14. log hygiene: summaries and errors never carry CV text, file names or keys", () => {
    const joined = observed.join("\n");
    expect(observed.length).toBeGreaterThan(10);
    expect(joined).not.toContain(CONTENT_SENTINEL);
    expect(joined).not.toContain(FILENAME_SENTINEL);
    expect(joined).not.toContain(KEY_SENTINEL);
    expect(joined).not.toContain("PT Sentinel Nusantara");
  });
});
