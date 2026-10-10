import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createAiConsentService } from "@/features/ai/consent-service";
import { createAiJobService } from "@/features/ai/ai-job-service";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { createImportReviewService } from "@/features/import/import-review-service";
import { createProjectService } from "@/features/project/project-service";
import { ExplicitTestFakeAIProvider } from "@/server/ai/fake-provider";
import { ExplicitTestFakePdfRenderer, type PdfRenderer, type PdfRenderResult } from "@/server/export/pdf-renderer";
import type { Database } from "@/server/supabase/database.types";

import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { runAiWorkerOnce } from "../../workers/ai-worker.ts";
import { runExportWorkerOnce } from "../../workers/export-worker.ts";
import { createSupabaseAiWorkerGateway } from "../../workers/supabase-ai-gateway.ts";
import { createSupabaseExportWorkerGateway } from "../../workers/supabase-export-gateway.ts";
import {
  createAccount, deleteThroughService, getAdmin, getAdminConfig, getPublicConfig, profileExists, receipt, required,
  runUntilCompleted, setupHarness, sql, teardownHarness, type Account,
} from "./account-deletion-support";

const SENTINEL = `WP-PRIVATE-T24-SENTINEL-${randomUUID()}`;
const LONG = 240_000;
const FAKE_ANSWER = "Weekly prep dropped from 5 to 2 hours";
const nullable = <T,>(value: T) => value as never;

interface Ev { n: string; p: Record<string, unknown> }

function events(userId: string): Ev[] {
  return JSON.parse(sql(
    `select coalesce(json_agg(json_build_object('n', event_name, 'p', properties) order by id), '[]'::json) ` +
    `from internal.product_events where user_id = '${userId}'::uuid`,
  )) as Ev[];
}
const count = (userId: string, name?: string) => events(userId).filter((event) => name === undefined || event.n === name).length;
const last = (userId: string, name: string) => events(userId).filter((event) => event.n === name).at(-1)?.p;
const participantRows = (userId: string) => Number(sql(`select count(1) from internal.pilot_participants where user_id = '${userId}'::uuid`));

function renderer(code: Extract<PdfRenderResult, { status: "error" }>["code"]): PdfRenderer {
  return { kind: "fake", async render() { return { status: "error", code }; } };
}

let a: Account;
let b: Account;
let exportGateway: ReturnType<typeof createSupabaseExportWorkerGateway>;
let aiGateway: ReturnType<typeof createSupabaseAiWorkerGateway>;
let activities: ReturnType<typeof createActivityService>;
let achievements: ReturnType<typeof createAchievementService>;
let projects: ReturnType<typeof createProjectService>;

async function drainExport(r: PdfRenderer) {
  for (let pass = 0; pass < 6; pass += 1) {
    const summary = await runExportWorkerOnce({ ...exportGateway, renderer: r, parse: parseInThread, claimLimit: 10 });
    if (summary.exportJobsClaimed === 0) return;
  }
}

async function cvRevision(account: Account): Promise<number> {
  const result = await account.client.from("cv_documents").select("revision").single();
  return required(result.data?.revision, result.error, "cv revision");
}

async function requestExport(account: Account) {
  const result = await account.client.rpc("request_cv_export", { p_expected_revision: await cvRevision(account), p_idempotency_key: randomUUID() });
  return required(result.data?.[0], result.error, "export request");
}

async function readyCv(account: Account, institution: string): Promise<void> {
  const ensured = await account.client.rpc("ensure_cv_document");
  required(ensured.data?.[0], ensured.error, "ensure cv");
  const education = await account.client.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: institution, p_qualification: "S1", p_field_of_study: nullable("Informatika"),
    p_description: nullable(null), p_start_date: nullable("2019-01-01"), p_start_precision: nullable("year"),
    p_end_date: nullable("2023-01-01"), p_end_precision: nullable("year"), p_is_current: false,
  });
  const educationId = required(education.data?.[0]?.id, education.error, "education");
  const selected = await account.client.rpc("select_cv_source", { p_expected_revision: await cvRevision(account), p_source_type: "education", p_source_id: educationId });
  required(selected.data?.[0], selected.error, "select education");
}

describe("T24 product events across the real write paths", () => {
  beforeAll(async () => {
    setupHarness();
    const config = getAdminConfig();
    exportGateway = createSupabaseExportWorkerGateway({ url: config.url, secretKey: config.secretKey });
    aiGateway = createSupabaseAiWorkerGateway({ url: config.url, secretKey: config.secretKey });
    a = await createAccount("t24-events-a");
    b = await createAccount("t24-events-b");
    const zone = await getAdmin().from("profiles").update({ timezone: "UTC" }).eq("id", b.id);
    if (zone.error) throw new Error("T24 integration setup failed: timezone");
    activities = createActivityService(a.client);
    achievements = createAchievementService(a.client);
    projects = createProjectService(a.client);
  }, LONG);

  afterAll(async () => {
    await teardownHarness();
  }, LONG);

  it("records activity_saved for Note, Form and Chat, once per save, and nothing for retries or edits", async () => {
    const base = { occurredOn: "2026-09-20", role: null, scope: null, outcome: null, experienceId: null, projectId: null };
    const noteKey = randomUUID();
    const note = await activities.createActivity({ ...base, operationKey: noteKey, captureMode: "note", rawText: `${SENTINEL} catatan privat` });
    expect(events(a.id)).toEqual([{ n: "activity_saved", p: { capture_mode: "note" } }]);

    await activities.createActivity({ ...base, operationKey: noteKey, captureMode: "note", rawText: `${SENTINEL} catatan privat` });
    expect(count(a.id, "activity_saved")).toBe(1);

    await activities.createActivity({ ...base, operationKey: randomUUID(), captureMode: "form", rawText: `${SENTINEL} formulir`, role: "Analis" });
    await activities.createActivity({ ...base, operationKey: randomUUID(), captureMode: "chat", rawText: `${SENTINEL} obrolan` });
    expect(events(a.id).map((event) => event.p.capture_mode)).toEqual(["note", "form", "chat"]);

    await activities.updateActivity({
      activityId: note.activityId, expectedRevision: note.revision, rawText: `${SENTINEL} diedit`, occurredOn: "2026-09-20",
      role: null, scope: null, outcome: null, experienceId: null, projectId: null,
    });
    expect(count(a.id)).toBe(3);
  }, LONG);

  it("records career_record_created for foundation, project and achievement records, and not for skills or edits", async () => {
    const before = count(a.id, "career_record_created");
    const experience = await a.client.rpc("create_experience_idempotent", {
      p_operation_key: randomUUID(), p_organization: `${SENTINEL} Org`, p_role_title: "Analis", p_kind: "employment",
      p_description: nullable(null), p_start_date: nullable("2024-01-01"), p_start_precision: nullable("month"),
      p_end_date: nullable(null), p_end_precision: nullable(null), p_is_current: true,
    });
    required(experience.data?.[0]?.id, experience.error, "experience");
    expect(last(a.id, "career_record_created")).toEqual({ record_type: "experience" });
    const certification = await a.client.rpc("create_certification_idempotent", {
      p_operation_key: randomUUID(), p_name: "Sertifikat", p_issuer: nullable(null), p_credential_url: nullable(null),
      p_issued_date: nullable(null), p_issued_precision: nullable(null),
    });
    required(certification.data?.[0]?.id, certification.error, "certification");
    expect(last(a.id, "career_record_created")).toEqual({ record_type: "certification" });
    const skill = await a.client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: "SQL" });
    required(skill.data?.[0]?.id, skill.error, "skill");
    expect(count(a.id, "career_record_created") - before).toBe(2);

    const project = await projects.createProject({
      operationKey: randomUUID(), title: `${SENTINEL} Proyek`, description: null, userRole: null, outcome: null, status: "planned",
      experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false,
    });
    expect(last(a.id, "career_record_created")).toEqual({ record_type: "project" });
    const afterProject = count(a.id, "career_record_created");
    await projects.updateProject({
      projectId: project.projectId, expectedRevision: project.revision, title: `${SENTINEL} Proyek diedit`, description: null,
      userRole: null, outcome: null, status: "planned", experienceId: null, startDate: null, startPrecision: null,
      endDate: null, endPrecision: null, isCurrent: false,
    });
    expect(count(a.id, "career_record_created")).toBe(afterProject);

    const draft = await achievements.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: null, experienceId: null });
    expect(last(a.id, "career_record_created")).toEqual({ record_type: "achievement", origin: "manual" });
    expect(count(a.id, "achievement_confirmed")).toBe(0);

    const changes = { title: `${SENTINEL} Capaian`, contribution: "Menyusun laporan", scope: "", outcome: "Waktu turun", cvBullet: "", achievedOn: "2026-09-21", metrics: [] };
    const stale = await achievements.saveAchievement({
      achievementId: draft.achievementId, expectedRevision: 99, action: "confirm", changes, skillNames: [],
    }).then(() => "saved", (error: unknown) => (error as { code?: string }).code ?? "error");
    expect(stale).not.toBe("saved");
    expect(count(a.id, "achievement_confirmed")).toBe(0);

    const saved = await achievements.saveAchievement({
      achievementId: draft.achievementId, expectedRevision: draft.revision, action: "save_draft", changes, skillNames: [],
    });
    expect(count(a.id, "achievement_confirmed")).toBe(0);
    const confirmed = await achievements.saveAchievement({
      achievementId: draft.achievementId, expectedRevision: saved.revision, action: "confirm", changes, skillNames: [],
    });
    expect(last(a.id, "achievement_confirmed")).toEqual({ origin: "manual" });
    expect(count(a.id, "achievement_confirmed")).toBe(1);
    await achievements.saveAchievement({
      achievementId: draft.achievementId, expectedRevision: confirmed.revision, action: "save_changes",
      changes: { ...changes, title: `${SENTINEL} Capaian diedit`, cvBullet: confirmed.cv_bullet ?? "" }, skillNames: [],
    });
    expect(count(a.id, "achievement_confirmed")).toBe(1);
  }, LONG);

  it("records an achievement created by applying an AI suggestion, and no AI event", async () => {
    const profile = await a.client.from("profiles").select("revision").eq("id", a.id).single();
    const consent = createAiConsentService(a.client);
    await consent.setConsent({ expectedRevision: required(profile.data?.revision, profile.error, "profile revision"), consented: true });
    const activity = await activities.createActivity({
      operationKey: randomUUID(), captureMode: "note", rawText: `Migrasi laporan ke pipeline baru. ${SENTINEL}`, occurredOn: "2026-09-22",
      role: null, scope: null, outcome: FAKE_ANSWER, experienceId: null, projectId: null,
    });
    const savedBefore = count(a.id, "activity_saved");
    const createdBefore = count(a.id, "career_record_created");
    const jobs = createAiJobService(a.client);
    const review = createAiReviewService(a.client);
    const request = await jobs.requestAnalysis({ activityId: activity.activityId, expectedRevision: 1 });
    expect(request.kind).toBe("detect");
    for (let pass = 0; pass < 20; pass += 1) {
      const summary = await runAiWorkerOnce({ database: aiGateway, provider: new ExplicitTestFakeAIProvider("valid") });
      if (!summary.aiJobsClaimed && !summary.aiExpiredLeases) break;
    }
    const view = await review.getAnalysisView(activity.activityId);
    expect(view.view.state).toBe("suggestion");
    expect(count(a.id, "activity_saved")).toBe(savedBefore);
    expect(count(a.id, "career_record_created")).toBe(createdBefore);

    const applied = await review.applySuggestion({
      jobId: required(view.job?.id, null, "job id"), expectedActivityRevision: 1, expectedAchievementRevision: null,
    });
    expect(applied.created).toBe(true);
    expect(last(a.id, "career_record_created")).toEqual({ record_type: "achievement", origin: "activity" });
    expect(count(a.id, "career_record_created")).toBe(createdBefore + 1);
    expect(events(a.id).every((event) => ["activity_saved", "career_record_created", "achievement_confirmed", "import_committed", "cv_export_finished"].includes(event.n))).toBe(true);
  }, LONG);

  it("records import_committed and the records an import creates, once, and nothing when the commit rolls back", async () => {
    const stage = (label: string, items: { type: string; ordinal: number; payload: unknown; action?: string; target?: string; confirm?: boolean }[]) => {
      const batchId = randomUUID();
      sql(
        `insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, page_count, extracted_text) ` +
        `values ('${batchId}', '${a.id}', gen_random_uuid(), decode(repeat('00', 32), 'hex'), '${a.id}/import/${batchId}', 'cv-${SENTINEL}.pdf', ` +
        `'application/pdf', 1000, md5('${batchId}') || md5('${label}'), 'review', 'done', 2, '${SENTINEL} teks ekstraksi')`,
      );
      for (const item of items) {
        sql(
          `insert into public.import_items (user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action, target_id, confirm_requested) ` +
          `values ('${a.id}', '${batchId}', '${item.type}', ${item.ordinal}, '${JSON.stringify(item.payload)}'::jsonb, 'x', ` +
          `'${item.action ?? "create"}', ${item.target ? `'${item.target}'` : "null"}, ${item.confirm ? "true" : "false"})`,
        );
      }
      return batchId;
    };
    const revisionOf = (batchId: string) => Number(sql(`select revision from public.import_batches where id = '${batchId}'::uuid`));
    const existingExperience = sql(`select id from public.experiences where user_id = '${a.id}'::uuid order by created_at limit 1`);
    const importReview = createImportReviewService({ client: a.client });

    const bad = stage("bad", [
      { type: "experience", ordinal: 0, payload: { organization: "Valid Org", role_title: "Valid Role", kind: "employment" } },
      { type: "experience", ordinal: 1, payload: { organization: "Bad Org", role_title: null, kind: "employment" } },
    ]);
    const beforeBad = count(a.id);
    await expect(importReview.commit({ batch_id: bad, expected_revision: revisionOf(bad) })).rejects.toBeTruthy();
    expect(count(a.id)).toBe(beforeBad);

    const good = stage("good", [
      { type: "profile", ordinal: 0, payload: { headline: "Headline Impor", selected_fields: ["headline"] } },
      { type: "experience", ordinal: 0, payload: { organization: "Org Impor", role_title: "Analis", kind: "employment" } },
      { type: "experience", ordinal: 1, payload: { organization: "Diabaikan", role_title: "Diabaikan" }, action: "map", target: existingExperience },
      { type: "education", ordinal: 0, payload: { institution: "Univ Impor", qualification: "S1" } },
      { type: "education", ordinal: 1, payload: { institution: "Lewat", qualification: "S1" }, action: "skip" },
      { type: "skill", ordinal: 0, payload: { name: "Python" } },
      {
        type: "achievement", ordinal: 0, confirm: true,
        payload: { status: "draft", title: `${SENTINEL} Capaian Impor`, contribution: "Menyusun laporan", outcome: "Waktu turun", achieved_on: "2025-06-15", cv_bullet: null, metrics: [] },
      },
    ]);
    const before = { career: count(a.id, "career_record_created"), confirmed: count(a.id, "achievement_confirmed"), committed: count(a.id, "import_committed") };
    const result = await importReview.commit({ batch_id: good, expected_revision: revisionOf(good) });
    expect(result.batch_id).toBe(good);
    expect(last(a.id, "import_committed")).toEqual({ created: 3, mapped: 1, skipped: 1, confirmed_achievements: 1 });
    expect(count(a.id, "import_committed")).toBe(before.committed + 1);
    expect(count(a.id, "career_record_created")).toBe(before.career + 3);
    expect(count(a.id, "achievement_confirmed")).toBe(before.confirmed + 1);
    expect(last(a.id, "achievement_confirmed")).toEqual({ origin: "import" });

    await importReview.commit({ batch_id: good, expected_revision: revisionOf(good) });
    expect(count(a.id, "import_committed")).toBe(before.committed + 1);
    expect(count(a.id, "career_record_created")).toBe(before.career + 3);
  }, LONG);

  it("records cv_export_finished per terminal transition with the real worker: success, failure, retry success", async () => {
    await readyCv(a, "Universitas Eksport");
    const titled = await a.client.rpc("save_cv_edits", { p_expected_revision: await cvRevision(a), p_edits: { title: `${SENTINEL} CV` } });
    required(titled.data, titled.error, "cv title");
    expect(count(a.id, "cv_export_finished")).toBe(0);

    const first = await requestExport(a);
    expect(count(a.id, "cv_export_finished")).toBe(0);
    await drainExport(new ExplicitTestFakePdfRenderer());
    expect(count(a.id, "cv_export_finished")).toBe(1);
    expect(last(a.id, "cv_export_finished")).toMatchObject({ outcome: "succeeded", error_code: null, attempt: 1 });
    expect(typeof last(a.id, "cv_export_finished")?.page_count).toBe("number");
    expect(first.status).toBe("queued");

    // A succeeded, unexpired export of the same CV revision is reused, so the CV changes before the second request.
    const retitled = await a.client.rpc("save_cv_edits", { p_expected_revision: await cvRevision(a), p_edits: { title: `${SENTINEL} CV dua` } });
    required(retitled.data, retitled.error, "cv retitle");
    const second = await requestExport(a);
    expect(second.reused).toBe(false);
    await drainExport(renderer("RENDERER_UNAVAILABLE"));
    expect(last(a.id, "cv_export_finished")).toEqual({ outcome: "failed", error_code: "RENDERER_UNAVAILABLE", attempt: 1, page_count: null });
    expect(count(a.id, "cv_export_finished")).toBe(2);

    const retry = await a.client.rpc("retry_cv_export", { p_export_id: second.export_id });
    required(retry.data?.[0], retry.error, "retry export");
    expect(count(a.id, "cv_export_finished")).toBe(2);
    await drainExport(new ExplicitTestFakePdfRenderer());
    expect(count(a.id, "cv_export_finished")).toBe(3);
    expect(last(a.id, "cv_export_finished")).toMatchObject({ outcome: "succeeded", error_code: null, attempt: 2 });

    // Owner B has only an activity and an export.
    const bActivities = createActivityService(b.client);
    await bActivities.createActivity({
      operationKey: randomUUID(), captureMode: "note", rawText: `${SENTINEL} milik B`, occurredOn: "2026-09-20",
      role: null, scope: null, outcome: null, experienceId: null, projectId: null,
    });
    await readyCv(b, "Universitas B");
    await requestExport(b);
    await drainExport(new ExplicitTestFakePdfRenderer());
    expect(events(b.id).map((event) => event.n)).toEqual(["activity_saved", "career_record_created", "cv_export_finished"]);
  }, LONG);

  it("keeps the event and cohort tables away from API roles", async () => {
    const config = getPublicConfig();
    const anon = createClient<Database>(config.url, config.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const client of [a.client, anon]) {
      const metrics = await client.rpc("get_pilot_metrics");
      expect(metrics.error).not.toBeNull();
      expect(metrics.data).toBeNull();
      const enroll = await client.rpc("set_pilot_participant", { p_user_id: a.id, p_consent_version: "pilot-v1", p_enrolled: true });
      expect(enroll.error).not.toBeNull();
      const internalTable = await client.schema("internal" as never).from("product_events" as never).select("*");
      expect(internalTable.error).not.toBeNull();
      expect(internalTable.data ?? []).toEqual([]);
      const publicTable = await client.from("product_events" as never).select("*");
      expect(publicTable.error).not.toBeNull();
    }
    expect(participantRows(a.id)).toBe(0);
  }, LONG);

  it("reports only enrolled accounts, with honest counts, and never counts the fixture accounts", async () => {
    const admin = getAdmin();
    const asOf = new Date(Date.now() + 29 * 86_400_000).toISOString();
    const empty = await admin.rpc("get_pilot_metrics", { p_as_of: asOf });
    expect(empty.error).toBeNull();
    expect(empty.data?.map((row) => [row.measure, row.cohort_size, row.eligible, row.rate])).toEqual([
      ["activation", 0, 0, null], ["value_completion", 0, 0, null], ["return_capture", 0, 0, null], ["export_reliability", 0, 0, null],
    ]);

    const enrolled = await admin.rpc("set_pilot_participant", { p_user_id: a.id, p_consent_version: "pilot-v1", p_enrolled: true });
    required(enrolled.data?.[0], enrolled.error, "enroll A");
    // Move two saves into different local weeks so the return capture window can be met.
    sql(
      `update internal.product_events set local_date = date '2026-09-01' where id = ` +
      `(select id from internal.product_events where user_id = '${a.id}'::uuid and event_name = 'activity_saved' order by id limit 1)`,
    );
    sql(
      `update internal.product_events set local_date = date '2026-09-15' where id = ` +
      `(select id from internal.product_events where user_id = '${a.id}'::uuid and event_name = 'activity_saved' order by id desc limit 1)`,
    );

    const report = await admin.rpc("get_pilot_metrics", { p_as_of: asOf });
    expect(report.error).toBeNull();
    const byMeasure = Object.fromEntries((report.data ?? []).map((row) => [row.measure, row]));
    expect(byMeasure.activation).toMatchObject({ cohort_size: 1, eligible: 1, achieved: 1, pending: 0, rate: 1, target: 0.6 });
    expect(byMeasure.value_completion).toMatchObject({ eligible: 1, achieved: 1, pending: 0, rate: 1, target: 0.4 });
    expect(byMeasure.return_capture).toMatchObject({ eligible: 1, achieved: 1, pending: 0, rate: 1, target: 0.3 });
    // A: success, failure, retry success = 2 of 3. B finished an export too but is not enrolled.
    expect(byMeasure.export_reliability).toMatchObject({ cohort_size: 1, eligible: 3, achieved: 2, pending: 0, rate: 0.6667, target: 0.98 });
    expect(count(b.id, "cv_export_finished")).toBe(1);

    const now = await admin.rpc("get_pilot_metrics");
    expect(now.error).toBeNull();
    expect(now.data?.find((row) => row.measure === "activation")).toMatchObject({ cohort_size: 1, eligible: 0, pending: 1, rate: null });

    const refused = await admin.rpc("set_pilot_participant", { p_user_id: b.id, p_consent_version: "Pilot V1", p_enrolled: true });
    expect(refused.error?.message).toBe("INVALID_PILOT_PARTICIPANT");
    expect(participantRows(b.id)).toBe(0);
  }, LONG);

  it("keeps private text, file names, ids and emails out of every event column and out of the report", async () => {
    const owned = Number(sql(
      `select (select count(1) from public.activities where raw_text like '%${SENTINEL}%') + ` +
      `(select count(1) from public.projects where title like '%${SENTINEL}%') + ` +
      `(select count(1) from public.achievements where title like '%${SENTINEL}%') + ` +
      `(select count(1) from public.import_batches where filename like '%${SENTINEL}%') + ` +
      `(select count(1) from public.cv_documents where title like '%${SENTINEL}%')`,
    ));
    expect(owned).toBeGreaterThanOrEqual(5);
    const leaks = Number(sql(
      `select count(1) from internal.product_events e where e::text ilike '%${SENTINEL}%' or e::text ilike '%WP-PRIVATE%' ` +
      `or e::text ilike '%@workpulse.test%' or e.properties::text ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'`,
    ));
    expect(leaks).toBe(0);
    const report = await getAdmin().rpc("get_pilot_metrics");
    expect(JSON.stringify(report.data)).not.toContain(SENTINEL);
    const names = new Set(events(a.id).concat(events(b.id)).map((event) => event.n));
    for (const name of names) {
      expect(["activity_saved", "career_record_created", "achievement_confirmed", "import_committed", "cv_export_finished"]).toContain(name);
    }
  }, LONG);

  it("removes the events and the participant row with the account through the T23 deletion path, and keeps other accounts", async () => {
    const bEvents = events(b.id);
    expect(count(a.id)).toBeGreaterThan(0);
    expect(participantRows(a.id)).toBe(1);

    await deleteThroughService(a);
    const rounds = await runUntilCompleted(a.id, 12);
    expect(receipt(a.id)?.status).toBe("completed");
    expect(rounds).toBeLessThanOrEqual(12);
    expect(profileExists(a.id)).toBe(false);

    expect(count(a.id)).toBe(0);
    expect(participantRows(a.id)).toBe(0);
    expect(events(b.id)).toEqual(bEvents);
    expect(count(b.id, "cv_export_finished")).toBe(1);
  }, LONG);
});
