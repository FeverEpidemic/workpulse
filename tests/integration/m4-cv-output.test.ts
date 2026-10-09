import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAiConsentService } from "@/features/ai/consent-service";
import { CvServiceError } from "@/features/cv/cv-errors";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { createEvidenceService } from "@/features/evidence/evidence-service";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createImportService } from "@/features/import/import-service";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
import { resolveDocxRenderer } from "@/server/documents/docx-renderer";
import { parseInThread } from "@/server/documents/parse-in-thread";
import { resolvePdfRenderer, type PdfRenderer } from "@/server/export/pdf-renderer";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { SupabaseEvidenceRepository } from "@/server/storage/evidence-repository";
import { resolveMalwareScanner } from "@/server/storage/malware-scanner";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker.ts";
import { runImportWorkerOnce } from "../../workers/import-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway.ts";
import { createSupabaseImportWorkerGateway } from "../../workers/supabase-import-gateway.ts";
import { CV_LINES, cvPdf, PDF_MIME } from "../import-fixtures";
import {
  LONG_TIMEOUT,
  createAccount,
  createAchievement,
  createEducation,
  createExperience,
  createProject,
  createSkill,
  cvFingerprint,
  cvRevision,
  cvView,
  downloadObject,
  drain,
  editBullet,
  exportCount,
  exportInfo,
  expectExportError,
  getAdmin,
  getAdminConfig,
  objectNames,
  pdfOf,
  readyAccount,
  request,
  required,
  select,
  setupHarness,
  sql,
  teardownHarness,
  achievementRow,
  itemFor,
  type Account,
  type Client,
} from "./cv-export-support";

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const norm = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const nullable = <T>(value: T) => value as never;
const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });

let renderer: PdfRenderer;
const aiProbe = new ExplicitTestFakeAIProvider("valid");

/** What every layer says about the saved CV of one account, read through the real services and RPCs. */
async function layersOf(account: Account) {
  const readiness = await account.exports[0]!.getReadiness();
  const rows = await account.cv[0]!.getFreshness();
  const summary = required((await account.clients[0]!.rpc("get_cv_review_summary")).data?.[0], null, "review summary");
  const dashboard = (await createDashboardService(account.clients[0]!).getDashboard()).cvReview;
  return { readiness, rows, summary, dashboard };
}

const blockerKey = (blocker: { code: string; item_id?: string | null }) => (blocker.item_id ? `${blocker.code}:${blocker.item_id}` : blocker.code);

/** Readiness, review (S13), Dashboard and the item states must tell one story; `expected` pins what that story is. */
async function expectLayers(account: Account, label: string, expected: string[]) {
  const layers = await layersOf(account);
  const code = { changed: "ITEM_CHANGED", deleted: "ITEM_DELETED", unconfirmed: "ITEM_UNCONFIRMED" } as const;
  const fromStates = layers.rows.flatMap((row) => {
    if (row.target === "profile") return row.state === "changed" ? ["PROFILE_CHANGED"] : [];
    const blocker = code[row.state as keyof typeof code];
    return blocker ? [`${blocker}:${row.item_id}`] : [];
  });
  const fromReadiness = layers.readiness.blockers.map(blockerKey);
  const reviewBlockers = fromReadiness.filter((key) => key !== "NAME_REQUIRED" && key !== "CONTENT_REQUIRED");
  expect([...reviewBlockers].sort(), `${label}: readiness vs item states`).toEqual([...fromStates].sort());
  expect([...fromReadiness].sort(), `${label}: expected blockers`).toEqual([...expected].sort());
  expect(layers.readiness.ready, `${label}: ready`).toBe(expected.length === 0);
  expect(layers.summary.review_count, `${label}: S13 review count`).toBe(fromStates.length);
  expect(layers.dashboard.reviewCount, `${label}: Dashboard review count`).toBe(fromStates.length);
  expect(layers.dashboard.availableCount, `${label}: Dashboard available count`).toBe(layers.summary.available_count);
  return layers;
}

interface Made {
  id: string;
  hash: string;
  snapshot: string;
  info: ReturnType<typeof exportInfo>;
  text: string;
  pageCount: number;
  bytes: Uint8Array;
}

/** A real export with the real renderer: request, worker, stored object. */
async function exportNow(account: Account): Promise<Made> {
  const requested = await request(account);
  expect(requested.reused).toBe(false);
  expect(await drain(renderer)).toMatchObject({ claimed: 1, succeeded: 1, failed: {}, errored: 0, stale: 0 });
  const info = exportInfo(requested.exportId);
  expect(info).toMatchObject({ status: "succeeded", error_code: null });
  const pdf = await pdfOf(requested.exportId);
  return { id: requested.exportId, hash: sha256(pdf.bytes), snapshot: info.snapshot_hash, info, text: norm(pdf.text), pageCount: pdf.pageCount, bytes: pdf.bytes };
}

/** An export made earlier is the same bytes, the same object and the same snapshot. */
async function expectUntouched(old: Made, label: string) {
  const now = exportInfo(old.id);
  expect(now.snapshot_hash, `${label}: snapshot`).toBe(old.snapshot);
  expect(now.object_key, `${label}: object key`).toBe(old.info.object_key);
  expect(now.cv_revision, `${label}: revision`).toBe(old.info.cv_revision);
  expect(now.status, `${label}: status`).toBe("succeeded");
  expect(sha256(await downloadObject(old.info.object_key!)), `${label}: PDF bytes`).toBe(old.hash);
}

async function pageBoxes(bytes: Uint8Array): Promise<{ width: number; height: number }[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, isOffscreenCanvasSupported: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await task.promise;
    const boxes: { width: number; height: number }[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      boxes.push({ width: page.view[2]! - page.view[0]!, height: page.view[3]! - page.view[1]! });
      page.cleanup();
    }
    return boxes;
  } finally {
    await task.destroy();
  }
}

function expectA4(boxes: { width: number; height: number }[], label: string) {
  expect(boxes.length, `${label}: pages`).toBeGreaterThanOrEqual(1);
  for (const box of boxes) {
    expect(Math.abs(box.width - 595), `${label}: width`).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 842), `${label}: height`).toBeLessThanOrEqual(1);
  }
}

async function saveOverride(account: Account, itemId: string, text: string) {
  await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), item_overrides: [{ item_id: itemId, override_text: text }] });
}

async function resolveItem(account: Account, itemId: string, action: "keep" | "refresh" | "replace") {
  const row = required((await account.cv[0]!.getFreshness()).find((entry) => entry.target === "item" && entry.item_id === itemId), null, "freshness row");
  return account.cv[0]!.resolveFreshness({
    expected_revision: await cvRevision(account),
    resolutions: [{ target: "item", item_id: itemId, source_revision: required(row.live_revision, null, "live revision"), action }],
  });
}

async function resolveProfile(account: Account, action: "keep" | "refresh" | "replace") {
  const row = required((await account.cv[0]!.getFreshness()).find((entry) => entry.target === "profile"), null, "profile row");
  return account.cv[0]!.resolveFreshness({
    expected_revision: await cvRevision(account),
    resolutions: [{ target: "profile", source_revision: required(row.live_revision, null, "profile revision"), action }],
  });
}

async function updateProfile(account: Account, changes: Record<string, string>) {
  const client = account.clients[0]!;
  const profile = await client.from("profiles").select("revision").eq("id", account.id).single();
  const updated = await client.rpc("update_profile", { p_expected_revision: required(profile.data?.revision, profile.error, "profile revision"), p_changes: changes as never });
  expect(updated.error).toBeNull();
}

async function confirmedAgain(account: Account, id: string, title: string, bullet: string) {
  const service = account.achievements[0]!;
  const changes = { title, contribution: `Kontribusi ${title}`, scope: "", outcome: `Hasil ${title}`, cvBullet: bullet, achievedOn: "2026-09-20", metrics: [] };
  await service.saveAchievement({ achievementId: id, expectedRevision: (await achievementRow(account, id)).revision, action: "save_draft", changes, skillNames: [] });
  await service.saveAchievement({ achievementId: id, expectedRevision: (await achievementRow(account, id)).revision, action: "confirm", changes, skillNames: [] });
}

function longBullet(seed: number, minimum = 640): string {
  const words: string[] = [];
  let length = 0;
  for (let index = 0; length < minimum; index += 1) {
    const word = `kegiatan${seed}-${index}`;
    words.push(word);
    length += word.length + 1;
  }
  return `START-${seed} ${words.join(" ")} END-${seed}`;
}

describe("Gate M4: CV output across domains (real Supabase, Storage, ClamAV, Chromium renderer)", () => {
  beforeAll(async () => {
    setupHarness();
    const url = process.env.WORKPULSE_PDF_GOTENBERG_URL;
    if (!url) throw new Error("Set WORKPULSE_PDF_GOTENBERG_URL (docs/verification/T21-pdf-renderer-runbook.md); this suite never falls back to the fake renderer");
    const health = await fetch(`${url.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!health?.ok) throw new Error("The PDF renderer is not reachable: start workpulse-t21-pdf; this suite never falls back to the fake renderer");
    renderer = resolvePdfRenderer({ mode: "gotenberg", baseUrl: url, nodeEnv: "test" });
    if (renderer.kind !== "gotenberg") throw new Error("The M4 suite must use the real Chromium renderer");
  });

  afterAll(async () => teardownHarness());

  it("1. import provenance: an imported experience and Achievement stay intact on the CV and in the export after the batch is purged", async () => {
    const account = await createAccount("import", { displayName: "Rani Impor" });
    const client = account.clients[0]!;
    const admin = getAdmin();
    const adminConfig = getAdminConfig();
    const profile = await client.from("profiles").select("revision").eq("id", account.id).single();
    await createAiConsentService(client).setConsent({ expectedRevision: required(profile.data?.revision, profile.error, "profile revision"), consented: true });
    const imports = createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: account.id });
    const review = createImportReviewService({ client });
    const importGateway = createSupabaseImportWorkerGateway(adminConfig);
    const aiGateway = createSupabaseAiWorkerGateway(adminConfig);
    const importAi = new ExplicitTestFakeAIProvider("valid");
    const scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
    const docx = resolveDocxRenderer({ mode: "fake", nodeEnv: "test", countPdfPages: async () => ({ status: "error", code: "PAGE_COUNT_UNAVAILABLE" }) });

    const bytes = cvPdf(1, [...CV_LINES, "ACH|Menyusun dashboard operasional|WP Labs"]);
    const view = await imports.upload({ idempotencyKey: randomUUID(), filename: encodeURIComponent("cv-m4.pdf"), contentType: PDF_MIME, contentLength: String(bytes.byteLength), body: stream(bytes) });
    const batchId = required(view.batchId, null, "batch id");
    const batch = async () => required((await admin.from("import_batches").select("*").eq("id", batchId).single()).data, null, "batch");
    for (let pass = 0; pass < 20 && (await batch()).status !== "review"; pass += 1) {
      if ((await batch()).stage === "extracting") await runAiWorkerOnce({ database: aiGateway, provider: importAi });
      else await runImportWorkerOnce({ ...importGateway, scanner, renderer: docx, parse: parseInThread });
    }
    expect((await batch()).status).toBe("review");
    const staged = required((await admin.from("import_items").select("*").eq("batch_id", batchId)).data, null, "staged items");
    const target = staged.find((item) => item.entity_type === "achievement" && String((item.payload as Record<string, unknown>).title).startsWith("Menurunkan"))!;
    await review.updateItem({
      item_id: target.id, expected_revision: 1, action: "create", confirm_requested: true,
      payload_patch: { contribution: "Menyusun laporan otomatis", outcome: "Waktu laporan turun dari 5 ke 2 jam", achieved_on: "2021-06-15" },
    });
    expect(await review.validate(batchId)).toEqual([]);
    await review.commit({ batch_id: batchId, expected_revision: (await batch()).revision });

    const experience = required((await client.from("experiences").select("id").eq("organization", "PT Sentinel Nusantara").single()).data, null, "imported experience");
    const education = required((await client.from("education").select("id").eq("institution", "Universitas Contoh").single()).data, null, "imported education");
    const achievement = required((await client.from("achievements").select("*").eq("origin", "import").eq("status", "confirmed").single()).data, null, "imported achievement");
    expect(achievement.experience_id).toBe(experience.id);
    expect(achievement.source_excerpt).toBeTruthy();
    await account.cv[0]!.ensure();
    await select(account, "education", education.id);
    await select(account, "experience", experience.id);
    await select(account, "achievement", achievement.id);
    const importedItem = await itemFor(account, "achievement_id", achievement.id);
    await expectLayers(account, "after selecting imported records", []);
    const before = { fingerprint: cvFingerprint(account.id), revision: await cvRevision(account) };
    const first = await exportNow(account);
    expect(first.text).toContain("PT Sentinel Nusantara");
    expect(first.text).toContain(norm(achievement.cv_bullet!));

    // The batch is purged: staging rows lose their payload, the canonical records and the CV do not change.
    const purged = await admin.rpc("purge_expired_import_batches", { p_limit: 100 });
    expect(purged.error).toBeNull();
    expect(Number(purged.data)).toBeGreaterThanOrEqual(1);
    expect((await batch()).purged_at).not.toBeNull();
    expect(required((await admin.from("import_items").select("payload").eq("batch_id", batchId)).data, null, "purged items").every((item) => item.payload === null)).toBe(true);

    expect(cvFingerprint(account.id)).toBe(before.fingerprint);
    expect(await cvRevision(account)).toBe(before.revision);
    await expectLayers(account, "after purge", []);
    const after = await achievementRow(account, achievement.id);
    expect(after).toMatchObject({ origin: "import", source_excerpt: achievement.source_excerpt, experience_id: experience.id, status: "confirmed" });
    expect((await itemFor(account, "achievement_id", achievement.id)).source_snapshot).toEqual(importedItem.source_snapshot);
    const again = await request(account);
    expect(again).toMatchObject({ exportId: first.id, reused: true });
    await expectUntouched(first, "export made before the purge");

    // A new export of a new revision still carries the imported content.
    await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), title: "CV setelah impor dibersihkan" });
    const second = await exportNow(account);
    expect(second.id).not.toBe(first.id);
    expect(second.text).toContain("PT Sentinel Nusantara");
    expect(second.text).toContain(norm(achievement.cv_bullet!));
    await expectUntouched(first, "first export after a second one");
  }, LONG_TIMEOUT);

  it("2. deleting the source activity of a selected derived Achievement keeps its provenance, the CV item and every earlier export", async () => {
    const account = await createAccount("activity-delete", { displayName: "Dewi Aktivitas" });
    await account.cv[0]!.ensure();
    await select(account, "education", await createEducation(account));
    const client = account.clients[0]!;
    const created = await client.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(), p_raw_text: "Menyusun laporan triwulan dengan tim keuangan", p_occurred_on: "2026-09-20", p_capture_mode: "note",
      p_experience_id: nullable(null), p_project_id: nullable(null), p_role: nullable(null), p_scope: nullable(null), p_outcome: nullable(null),
    });
    const activity = required(created.data?.[0], created.error, "activity");
    const service = account.achievements[0]!;
    const fromActivity = await service.createAchievement({ operationKey: randomUUID(), activityId: activity.activity_id, projectId: null, experienceId: null });
    const changes = { title: "Laporan dari catatan", contribution: "Menyusun laporan triwulan", scope: "", outcome: "Laporan selesai tepat waktu", cvBullet: "Menyusun laporan triwulan bersama tim keuangan", achievedOn: "2026-09-20", metrics: [] };
    const draft = await service.saveAchievement({ achievementId: fromActivity.achievementId, expectedRevision: 1, action: "save_draft", changes, skillNames: [] });
    await service.saveAchievement({ achievementId: fromActivity.achievementId, expectedRevision: draft.revision, action: "confirm", changes, skillNames: [] });
    await select(account, "achievement", fromActivity.achievementId);
    const item = await itemFor(account, "achievement_id", fromActivity.achievementId);
    const sourceBefore = await achievementRow(account, fromActivity.achievementId);
    expect(sourceBefore.source_excerpt).toBeTruthy();
    expect(sourceBefore.source_activity_revision).not.toBeNull();
    await expectLayers(account, "before deleting the activity", []);
    const first = await exportNow(account);
    expect(first.text).toContain("Menyusun laporan triwulan bersama tim keuangan");
    const revision = await cvRevision(account);

    const current = await client.from("activities").select("revision").eq("id", activity.activity_id).single();
    const removed = await client.rpc("delete_activity", { p_activity_id: activity.activity_id, p_expected_revision: required(current.data?.revision, current.error, "activity revision") });
    expect(removed.error).toBeNull();

    const sourceAfter = await achievementRow(account, fromActivity.achievementId);
    expect(sourceAfter).toMatchObject({ status: "confirmed", activity_id: null, source_excerpt: sourceBefore.source_excerpt, source_activity_revision: sourceBefore.source_activity_revision });
    expect((await itemFor(account, "achievement_id", fromActivity.achievementId)).id).toBe(item.id);
    expect(await cvRevision(account)).toBe(revision);
    await expectLayers(account, "after deleting the activity", []);
    expect(await request(account)).toMatchObject({ exportId: first.id, reused: true });
    await expectUntouched(first, "export made before the activity was deleted");
    expect(exportCount(account.id)).toBe(1);
  }, LONG_TIMEOUT);

  it("3. override, source edit, refresh and Replace: the override survives a refresh, Replace swaps it, and the earlier export keeps the override", async () => {
    const ready = await readyAccount("override", { displayName: "Sari Override" });
    const { account, achievement, itemId, bullet } = ready;
    const second = await createAchievement(account, "Hasil Kedua", { cvBullet: "Kalimat kedua tanpa override" });
    await select(account, "achievement", second.id);
    const secondItem = await itemFor(account, "achievement_id", second.id);
    const override = "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”";
    await saveOverride(account, itemId, override);
    await expectLayers(account, "override saved", []);
    const old = await exportNow(account);
    expect(old.text).toContain(norm(override));
    expect(old.text).not.toContain(norm(bullet));
    expect(old.text).toContain("Kalimat kedua tanpa override");

    await editBullet(account, achievement.id, "Sumber pertama versi dua");
    await editBullet(account, second.id, "Sumber kedua versi dua");
    await expectLayers(account, "both sources edited", [`ITEM_CHANGED:${itemId}`, `ITEM_CHANGED:${secondItem.id}`]);
    const fingerprint = cvFingerprint(account.id);
    await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(cvFingerprint(account.id)).toBe(fingerprint);

    // Refresh of every item without manual wording: the item with the override is left alone.
    await resolveItem(account, secondItem.id, "refresh");
    const withOverride = await itemFor(account, "achievement_id", achievement.id);
    expect(withOverride.override_text).toBe(override);
    await expectLayers(account, "after refreshing the item without override", [`ITEM_CHANGED:${itemId}`]);
    await expectExportError(request(account), "EXPORT_BLOCKED");

    // Replace from source: the override goes, the source wording comes.
    await resolveItem(account, itemId, "replace");
    expect((await itemFor(account, "achievement_id", achievement.id)).override_text).toBeNull();
    await expectLayers(account, "after Replace from source", []);
    const fresh = await exportNow(account);
    expect(fresh.id).not.toBe(old.id);
    expect(fresh.text).toContain("Sumber pertama versi dua");
    expect(fresh.text).toContain("Sumber kedua versi dua");
    expect(fresh.text).not.toContain(norm(override));
    await expectUntouched(old, "export made with the override");
    expect(old.text).toContain(norm(override));
    expect(norm((await pdfOf(old.id)).text)).toContain(norm(override));
  }, LONG_TIMEOUT);

  const deletions = [
    { type: "achievement", label: "Achievement" },
    { type: "project", label: "project with a child Achievement" },
    { type: "experience", label: "experience" },
    { type: "education", label: "education" },
    { type: "skill", label: "skill" },
    { type: "certification", label: "certification" },
  ] as const;

  it.each(deletions)("4. deleting a selected $label blocks the export in every layer until its item is removed, and no other record is lost", async ({ type }) => {
    const base = await readyAccount(`delete-${type}`, { displayName: "Budi Hapus" });
    const { account, itemId: baseItemId } = base;
    const client = account.clients[0]!;
    let targetItemId: string;
    let deleted: { error: unknown };
    let removeChildren = false;
    let deletedText: string;
    // The CV item loses its link to a deleted record, so it is looked up before the deletion.
    switch (type) {
      case "achievement": {
        const made = await createAchievement(account, "Dihapus", { cvBullet: "Kalimat yang akan dihapus" });
        await select(account, "achievement", made.id);
        targetItemId = (await itemFor(account, "achievement_id", made.id)).id;
        deletedText = "Kalimat yang akan dihapus";
        deleted = await client.rpc("delete_achievement", { p_achievement_id: made.id, p_expected_revision: (await achievementRow(account, made.id)).revision });
        break;
      }
      case "project": {
        const project = await createProject(account, "Proyek yang dihapus");
        await select(account, "project", project.projectId);
        const child = await createAchievement(account, "Anak proyek", { projectId: project.projectId, cvBullet: "Kalimat anak proyek" });
        await select(account, "achievement", child.id);
        targetItemId = (await itemFor(account, "project_id", project.projectId)).id;
        removeChildren = true;
        deletedText = "Proyek yang dihapus";
        const row = required((await client.from("projects").select("revision").eq("id", project.projectId).single()).data, null, "project row");
        deleted = await client.rpc("delete_project", { p_project_id: project.projectId, p_expected_revision: row.revision });
        break;
      }
      case "experience": {
        const id = await createExperience(account, "PT Dihapus Sentosa");
        await select(account, "experience", id);
        targetItemId = (await itemFor(account, "experience_id", id)).id;
        deletedText = "PT Dihapus Sentosa";
        const row = required((await client.from("experiences").select("revision").eq("id", id).single()).data, null, "experience row");
        deleted = await client.rpc("delete_experience", { p_experience_id: id, p_expected_revision: row.revision });
        break;
      }
      case "education": {
        const id = await createEducation(account, "Institut Dihapus");
        await select(account, "education", id);
        targetItemId = (await itemFor(account, "education_id", id)).id;
        deletedText = "Institut Dihapus";
        const row = required((await client.from("education").select("revision").eq("id", id).single()).data, null, "education row");
        deleted = await client.rpc("delete_education", { p_education_id: id, p_expected_revision: row.revision });
        break;
      }
      case "skill": {
        const id = await createSkill(account, "Keahlian Dihapus");
        await select(account, "skill", id);
        targetItemId = (await cvView(account)).items.find((row) => row.skill_id === id)!.id;
        deletedText = "Keahlian Dihapus";
        const row = required((await client.from("skills").select("revision").eq("id", id).single()).data, null, "skill row");
        deleted = await client.rpc("delete_skill", { p_skill_id: id, p_expected_revision: row.revision });
        break;
      }
      case "certification": {
        const created = await client.rpc("create_certification_idempotent", {
          p_operation_key: randomUUID(), p_name: "Sertifikat Dihapus", p_issuer: nullable(null), p_issued_date: nullable(null),
          p_issued_precision: nullable(null), p_credential_url: nullable(null),
        });
        const id = required(created.data?.[0]?.id, created.error, "certification");
        await select(account, "certification", id);
        targetItemId = (await cvView(account)).items.find((row) => row.certification_id === id)!.id;
        deletedText = "Sertifikat Dihapus";
        const row = required((await client.from("certifications").select("revision").eq("id", id).single()).data, null, "certification row");
        deleted = await client.rpc("delete_certification", { p_certification_id: id, p_expected_revision: row.revision });
        break;
      }
    }
    expect(deleted.error).toBeNull();

    const item = { id: targetItemId };
    const layers = await layersOf(account);
    expect(layers.readiness.ready).toBe(false);
    expect(layers.readiness.blockers).toContainEqual({ code: "ITEM_DELETED", item_id: item.id });
    await expectLayers(account, `${type} deleted`, layers.readiness.blockers.map(blockerKey));
    expect(layers.rows.find((row) => row.target === "item" && row.item_id === item.id)?.state).toBe("deleted");
    const fingerprint = cvFingerprint(account.id);
    const error = await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(error.blockers).toContainEqual({ code: "ITEM_DELETED", item_id: item.id });
    expect(exportCount(account.id)).toBe(0);
    expect(cvFingerprint(account.id)).toBe(fingerprint);
    // The snapshot of the deleted record is still on the item, so the user sees what is being removed.
    expect((await cvView(account)).items.find((row) => row.id === item.id)?.source_snapshot).toBeTruthy();

    // Other records are untouched.
    expect((await client.from("achievements").select("id").eq("id", base.achievement.id)).data).toHaveLength(1);
    expect((await client.from("education").select("id")).data!.length).toBeGreaterThanOrEqual(1);

    await account.cv[0]!.remove({ expected_revision: await cvRevision(account), item_id: item.id, remove_children: removeChildren });
    for (const row of (await cvView(account)).items) expect(row.source_deleted).toBe(false);
    await expectLayers(account, `${type} item removed`, []);
    const made = await exportNow(account);
    expect(made.text).not.toContain(norm(deletedText));
    expect(made.text).toContain("Bullet dasar");
    expect(baseItemId).toBeTruthy();
  }, LONG_TIMEOUT);

  it("5. reopening a confirmed Achievement blocks in every layer; confirming it again unchanged is fresh, with a change it needs review", async () => {
    const { account, achievement, itemId, bullet } = await readyAccount("reopen", { displayName: "Citra Buka Ulang" });
    const service = account.achievements[0]!;
    await service.saveAchievement({
      achievementId: achievement.id, expectedRevision: (await achievementRow(account, achievement.id)).revision, action: "reopen",
      changes: { title: "Hasil Contoh", contribution: "", scope: "", outcome: "", cvBullet: "", achievedOn: "2026-09-20", metrics: [] }, skillNames: [],
    });
    await expectLayers(account, "reopened", [`ITEM_UNCONFIRMED:${itemId}`]);
    const fingerprint = cvFingerprint(account.id);
    const error = await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(error.blockers).toEqual([{ code: "ITEM_UNCONFIRMED", item_id: itemId }]);
    expect(exportCount(account.id)).toBe(0);
    expect(cvFingerprint(account.id)).toBe(fingerprint);

    // Confirmed again with the same displayed fields: the item is fresh (decision 0026) and exports.
    await confirmedAgain(account, achievement.id, "Hasil Contoh", bullet);
    await expectLayers(account, "confirmed again without a change", []);
    const same = await exportNow(account);
    expect(same.text).toContain(norm(bullet));

    // Reopened and confirmed with new wording: the item needs review before the next export.
    await service.saveAchievement({
      achievementId: achievement.id, expectedRevision: (await achievementRow(account, achievement.id)).revision, action: "reopen",
      changes: { title: "Hasil Contoh", contribution: "", scope: "", outcome: "", cvBullet: "", achievedOn: "2026-09-20", metrics: [] }, skillNames: [],
    });
    await confirmedAgain(account, achievement.id, "Hasil Contoh", "Kalimat setelah dikonfirmasi ulang");
    await expectLayers(account, "confirmed again with a change", [`ITEM_CHANGED:${itemId}`]);
    await resolveItem(account, itemId, "refresh");
    await expectLayers(account, "refreshed", []);
    const later = await exportNow(account);
    expect(later.text).toContain("Kalimat setelah dikonfirmasi ulang");
    await expectUntouched(same, "export before the second reopen");
  }, LONG_TIMEOUT);

  it("6. relinking an Achievement to a project after it was selected adds the new parent on refresh and prints the Achievement once", async () => {
    const account = await createAccount("relink", { displayName: "Eka Relink" });
    await account.cv[0]!.ensure();
    await select(account, "education", await createEducation(account));
    const experience = await createExperience(account, "PT Relink Sentosa");
    await select(account, "experience", experience);
    const project = await createProject(account, "Proyek Tujuan Relink");
    const bullet = "Kalimat pencapaian yang dipindahkan antar konteks";
    const achievement = await createAchievement(account, "Pencapaian Pindah", { experienceId: experience, cvBullet: bullet });
    await select(account, "achievement", achievement.id);
    const item = await itemFor(account, "achievement_id", achievement.id);
    await expectLayers(account, "before relink", []);
    const before = await exportNow(account);
    expect(before.text.split(norm(bullet))).toHaveLength(2);
    expect(before.text).not.toContain("Proyek Tujuan Relink");

    const row = await achievementRow(account, achievement.id);
    const relinked = await account.clients[0]!.rpc("relink_achievement_project", { p_achievement_id: achievement.id, p_expected_revision: row.revision, p_project_id: project.projectId });
    expect(relinked.error).toBeNull();
    await expectLayers(account, "after relink", [`ITEM_CHANGED:${item.id}`]);
    await expectExportError(request(account), "EXPORT_BLOCKED");

    const receipt = await resolveItem(account, item.id, "refresh");
    expect(receipt.addedParentItemIds).toHaveLength(1);
    expect((await cvView(account)).items.find((entry) => entry.project_id === project.projectId)?.id).toBe(receipt.addedParentItemIds[0]);
    await expectLayers(account, "after refresh", []);
    const after = await exportNow(account);
    expect(after.text.split(norm(bullet)), "the Achievement is printed exactly once").toHaveLength(2);
    expect(after.text).toContain("Proyek Tujuan Relink");
    expect(after.text.indexOf("Proyek Tujuan Relink")).toBeLessThan(after.text.indexOf(norm(bullet)));
    await expectUntouched(before, "export made before the relink");
  }, LONG_TIMEOUT);

  it("7. evidence of a selected Achievement and project, ready after a real ClamAV scan, never reaches the snapshot or the PDF", async () => {
    const { account, achievement } = await readyAccount("evidence", { displayName: "Fajar Bukti" });
    const admin = getAdmin();
    const adminConfig = getAdminConfig();
    const projectItem = required((await cvView(account)).items.find((entry) => entry.project_id), null, "project item");
    const projectId = required(projectItem.project_id, null, "project id");
    const certification = await account.clients[0]!.rpc("create_certification_idempotent", {
      p_operation_key: randomUUID(), p_name: "Sertifikat Berurl", p_issuer: "Lembaga Uji", p_credential_url: `https://credentials.example.org/${randomUUID()}`,
      p_issued_date: "2025-03-01", p_issued_precision: "month",
    });
    await select(account, "certification", required(certification.data?.[0]?.id, certification.error, "certification"));
    const baselineExport = await exportNow(account);

    const filenameSentinel = `WP-EVIDENCE-FILENAME-${randomUUID()}`;
    const contentSentinel = `WP-EVIDENCE-CONTENT-${randomUUID()}`;
    const evidence = createEvidenceService({ repository: new SupabaseEvidenceRepository(admin), storage: new SupabaseStorageAdapter(admin), resolveActor: async () => ({ id: account.id }) });
    const gateway = createSupabaseEvidenceWorkerGateway(adminConfig);
    const scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
    const bytes = Buffer.from(`%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n% ${contentSentinel}\n%%EOF\n`);
    const keys: string[] = [];
    for (const [kind, parentId, revision] of [
      ["achievement", achievement.id, (await achievementRow(account, achievement.id)).revision],
      ["project", projectId, required((await account.clients[0]!.from("projects").select("revision").eq("id", projectId).single()).data?.revision, null, "project revision")],
    ] as const) {
      const file = await evidence.reserve({ parentKind: kind, parentId, filename: `${filenameSentinel}-${kind}.pdf`, contentType: "application/pdf", expectedBytes: bytes.length, idempotencyKey: randomUUID(), expectedRevision: revision });
      await evidence.upload(file.id, file.revision, "application/pdf", stream(bytes));
      keys.push(file.objectKey);
    }
    for (let pass = 0; pass < 100; pass += 1) {
      const run = await runEvidenceWorkerOnce({ ...gateway, scanner });
      if (!run.scanJobsClaimed && !run.cleanupJobsClaimed) break;
    }
    const ready = required((await account.clients[0]!.from("evidence_files").select("status")).data, null, "evidence rows");
    expect(ready.map((row) => row.status)).toEqual(["ready", "ready"]);

    // Evidence changes nothing the CV shows: still ready, nothing to review, and the same revision still has its export.
    await expectLayers(account, "evidence ready", []);
    expect(await request(account)).toMatchObject({ exportId: baselineExport.id, reused: true });
    await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), title: "CV dengan bukti" });
    const made = await exportNow(account);
    await expectUntouched(baselineExport, "export made before the evidence");
    const snapshotText = sql(`select snapshot::text from public.cv_exports where id = '${made.id}'::uuid`);
    for (const forbidden of [filenameSentinel, contentSentinel, "evidence", "object_key", ...keys]) {
      expect(snapshotText.toLowerCase(), `snapshot carries ${forbidden}`).not.toContain(forbidden.toLowerCase());
      expect(made.text.toLowerCase(), `PDF carries ${forbidden}`).not.toContain(forbidden.toLowerCase());
    }
    expect(made.text).not.toContain("credentials.example.org");
    expect(made.text).not.toMatch(/https?:/i);
    expect(made.text).toContain(norm((await achievementRow(account, achievement.id)).cv_bullet!));
    expect(await objectNames(account.id)).toHaveLength(2);
  }, LONG_TIMEOUT);

  it("8. a profile change blocks until Keep saved wording; the export then carries the saved name, and a second edit asks again", async () => {
    const { account } = await readyAccount("profile", { displayName: "Gita Lama" });
    await updateProfile(account, { display_name: "Gita Baru", headline: "Analis Data" });
    await expectLayers(account, "profile changed", ["PROFILE_CHANGED"]);
    const fingerprint = cvFingerprint(account.id);
    await expectExportError(request(account), "EXPORT_BLOCKED");
    expect(cvFingerprint(account.id)).toBe(fingerprint);

    await resolveProfile(account, "keep");
    await expectLayers(account, "profile kept", []);
    const kept = await exportNow(account);
    expect(kept.text).toContain("Gita Lama");
    expect(kept.text).not.toContain("Gita Baru");

    await updateProfile(account, { display_name: "Gita Kedua" });
    await expectLayers(account, "profile changed again", ["PROFILE_CHANGED"]);
    await expectExportError(request(account), "EXPORT_BLOCKED");
    await resolveProfile(account, "refresh");
    await expectLayers(account, "profile refreshed", []);
    const refreshed = await exportNow(account);
    expect(refreshed.text).toContain("Gita Kedua");
    await expectUntouched(kept, "export made with the kept name");
  }, LONG_TIMEOUT);

  it("9. an edit and a CV save after the request do not reach the export; the CV then shows the export is for an earlier revision", async () => {
    const { account, achievement, bullet } = await readyAccount("inflight", { displayName: "Hana Berjalan" });
    const requested = await request(account);
    const exportRevision = exportInfo(requested.exportId).cv_revision;
    const later = `Sumber diubah sesudah permintaan ${randomUUID().slice(0, 8)}`;
    await editBullet(account, achievement.id, later);
    await account.cv[0]!.saveEdits({ expected_revision: await cvRevision(account), title: "Judul sesudah permintaan" });
    expect(await drain(renderer)).toMatchObject({ claimed: 1, succeeded: 1, failed: {} });
    const info = exportInfo(requested.exportId);
    expect(info.cv_revision).toBe(exportRevision);
    expect(await cvRevision(account)).toBeGreaterThan(exportRevision);
    const pdf = await pdfOf(requested.exportId);
    expect(norm(pdf.text)).toContain(norm(bullet));
    expect(norm(pdf.text)).not.toContain(later);
    expect(norm(pdf.text)).not.toContain("Judul sesudah permintaan");

    const listed = await account.exports[0]!.listExports();
    expect(listed[0]).toMatchObject({ id: requested.exportId, status: "succeeded", cv_revision: exportRevision });
    expect(listed[0]!.cv_revision, "S14 marks this export as an earlier revision").toBeLessThan((await cvView(account)).document.revision);
    await expectLayers(account, "after the in-flight edit", [`ITEM_CHANGED:${(await itemFor(account, "achievement_id", achievement.id)).id}`]);
    await expectExportError(request(account), "EXPORT_BLOCKED");
  }, LONG_TIMEOUT);

  it("10. no AI is used by any CV or export step: no AI job exists for these accounts and an AI worker pass makes zero provider calls", async () => {
    // Scenario 1 is the only account that imported a CV, and extraction is the one AI job this suite is allowed to create.
    const jobs = sql(`select count(*) from public.ai_jobs where user_id in (select id from auth.users where email like 'cve-%@workpulse.test' and email not like 'cve-import-%')`);
    expect(jobs).toBe("0");
    const gateway = createSupabaseAiWorkerGateway(getAdminConfig());
    await runAiWorkerOnce({ database: gateway, provider: aiProbe });
    expect(aiProbe.calls).toHaveLength(0);
    expect(aiProbe.importCalls).toHaveLength(0);
  }, LONG_TIMEOUT);

  it("11. a long Indonesian CV with long bullets exports to several searchable A4 pages with both ends of every bullet", async () => {
    const account = await createAccount("multipage", { displayName: "Indah Panjang" });
    await account.cv[0]!.ensure();
    await account.cv[0]!.updateLayout({ expected_revision: await cvRevision(account), locale: "id" });
    await select(account, "education", await createEducation(account, "Universitas Gadjah Mada"));
    await select(account, "experience", await createExperience(account, "PT Contoh Nusantara"));
    const bullets: string[] = [];
    for (let index = 1; index <= 14; index += 1) {
      const bullet = longBullet(index);
      bullets.push(bullet);
      const made = await createAchievement(account, `Capaian ${index}`, { cvBullet: bullet });
      await select(account, "achievement", made.id);
    }
    const made = await exportNow(account);
    expect(made.pageCount).toBeGreaterThan(1);
    expect(made.pageCount).toBeLessThanOrEqual(20);
    expect(made.pageCount).toBe(made.info.page_count);
    expectA4(await pageBoxes(made.bytes), "long CV");
    expect(made.text).toContain("Pengalaman");
    expect(made.text).toContain("Pendidikan");
    expect(made.text).toContain("Pencapaian");
    expect(made.text).toContain("Indah Panjang");
    for (const bullet of bullets) {
      expect(made.text).toContain(norm(bullet.slice(0, 60)));
      expect(made.text).toContain(norm(bullet.slice(-60)));
    }
    expect(made.text.toLowerCase()).not.toMatch(/evidence|https?:/);
  }, LONG_TIMEOUT);

  it("12. isolation: another account gets the same answer for an owner's id as for a random id, in every CV and export service, RPC and Storage path", async () => {
    const owner = await readyAccount("iso-owner", { displayName: "Joko Pemilik" });
    const stranger = await createAccount("iso-stranger", { displayName: "Kiki Orang Lain" });
    await stranger.cv[0]!.ensure();
    const made = await exportNow(owner.account);
    const other = stranger;
    const randomId = randomUUID();
    const comparable = (error: unknown) => {
      expect(error).toBeInstanceOf(CvServiceError);
      const known = error as CvServiceError;
      expect(known.correlationId).toMatch(/^[0-9a-f-]{36}$/);
      return { code: known.code, messageKey: known.messageKey, blockers: known.blockers };
    };
    const outcome = async (call: () => Promise<unknown>) => call().then(() => ({ ok: true as const }), (caught: unknown) => ({ ok: false as const, error: comparable(caught) }));
    const strangerRevision = await cvRevision(other);

    const calls: { name: string; run: (foreign: boolean) => Promise<unknown> }[] = [
      { name: "select a source", run: (foreign) => other.cv[0]!.select({ expected_revision: strangerRevision, source_type: "achievement", source_id: foreign ? owner.achievement.id : randomId }) },
      { name: "remove an item", run: (foreign) => other.cv[0]!.remove({ expected_revision: strangerRevision, item_id: foreign ? owner.itemId : randomId, remove_children: false }) },
      { name: "save an override", run: (foreign) => other.cv[0]!.saveEdits({ expected_revision: strangerRevision, item_overrides: [{ item_id: foreign ? owner.itemId : randomId, override_text: "x" }] }) },
      { name: "resolve freshness", run: (foreign) => other.cv[0]!.resolveFreshness({ expected_revision: strangerRevision, resolutions: [{ target: "item", item_id: foreign ? owner.itemId : randomId, source_revision: 1, action: "refresh" }] }) },
      { name: "download an export", run: (foreign) => other.exports[0]!.issueDownload({ export_id: foreign ? made.id : randomId }) },
      { name: "download an export inline", run: (foreign) => other.exports[0]!.issueDownload({ export_id: foreign ? made.id : randomId, disposition: "inline" }) },
      { name: "retry an export", run: (foreign) => other.exports[0]!.retryExport({ export_id: foreign ? made.id : randomId }) },
    ];
    for (const call of calls) {
      const foreign = await outcome(() => call.run(true));
      const unknown = await outcome(() => call.run(false));
      expect(foreign.ok, `${call.name}: refused`).toBe(false);
      expect(foreign, `${call.name}: the owner's id answers like a random id`).toEqual(unknown);
    }
    expect(await other.exports[0]!.listExports()).toEqual([]);
    expect(await other.exports[0]!.getExport(made.id)).toBeNull();
    expect(await other.exports[0]!.getExport(randomId)).toBeNull();
    expect(exportInfo(made.id).status).toBe("succeeded");

    // The same through the raw RPCs and the Storage API with the other account's own token.
    const client: Client = other.clients[0]!;
    const rpcs = [
      (id: string) => client.rpc("get_cv_export_download", { p_export_id: id }),
      (id: string) => client.rpc("retry_cv_export", { p_export_id: id }),
    ];
    for (const call of rpcs) {
      const foreign = await call(made.id);
      const unknown = await call(randomId);
      expect(foreign.error?.message).toBeTruthy();
      expect(foreign.error?.message).toBe(unknown.error?.message);
      expect(foreign.error?.code).toBe(unknown.error?.code);
    }
    expect((await client.from("cv_exports").select("id").eq("id", made.id)).data).toEqual([]);
    expect((await client.from("cv_items").select("id").eq("id", owner.itemId)).data).toEqual([]);
    const key = required(made.info.object_key, null, "object key");
    expect((await client.storage.from(PRIVATE_STORAGE_BUCKET).createSignedUrl(key, 60)).data).toBeNull();
    expect((await client.storage.from(PRIVATE_STORAGE_BUCKET).download(key)).data).toBeNull();
    expect((await client.storage.from(PRIVATE_STORAGE_BUCKET).list(`${owner.account.id}/export`)).data ?? []).toEqual([]);
    expect(await cvRevision(other)).toBe(strangerRevision);

    // Orphan reconciliation leaves the object of a live export alone, however old it is.
    sql(`update storage.objects set created_at = now() - interval '3 hours' where bucket_id = '${PRIVATE_STORAGE_BUCKET}' and name = '${key}'`);
    const reconciled = await getAdmin().rpc("reconcile_orphan_export_objects", { p_min_age_seconds: 900, p_limit: 100 });
    expect(reconciled.error).toBeNull();
    expect(sql(`select count(*) from internal.storage_jobs where object_key = '${key}' and kind = 'delete'`)).toBe("0");
    await drain(renderer);
    expect(sha256(await downloadObject(key))).toBe(made.hash);
    expect(await objectNames(owner.account.id)).toHaveLength(1);
  }, LONG_TIMEOUT);
});
