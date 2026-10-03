import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { indexFreshness } from "@/domain/cv/freshness";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { CvServiceError } from "@/features/cv/cv-errors";
import { createCvService } from "@/features/cv/cv-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { createProjectService } from "@/features/project/project-service";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

type Client = SupabaseClient<Database>;

const SENTINEL = `WP-PRIVATE-CV-SENTINEL-${randomUUID()}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const RACE_ROUNDS = 3;

let admin: Client;
let publicConfig: NonNullable<ReturnType<typeof getSupabasePublicConfig>>;
const createdUserIds: string[] = [];
const openedClients: Client[] = [];

interface Account {
  id: string;
  clients: Client[];
  cv: ReturnType<typeof createCvService>[];
  achievements: ReturnType<typeof createAchievementService>[];
}

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`CV freshness integration setup failed: ${label}`);
  return value;
}

/** A real, onboarded account with `clientCount` independent signed-in sessions. */
async function createAccount(label: string, options: { clientCount?: number; onboard?: boolean } = {}): Promise<Account> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `cvf-${label}-${suffix}@workpulse.test`;
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
  if (options.onboard !== false) {
    const profile = await clients[0]!.from("profiles").select("revision").eq("id", id).single();
    const onboarded = await clients[0]!.rpc("complete_onboarding", {
      p_display_name: `Ani ${label}`,
      p_expected_revision: required(profile.data?.revision, profile.error, `${label} profile`),
      p_locale: "en",
      p_timezone: "Asia/Jakarta",
    });
    required(onboarded.data, onboarded.error, `${label} onboarding`);
  }
  return {
    id,
    clients,
    cv: clients.map((client) => createCvService({ supabase: client })),
    achievements: clients.map((client) => createAchievementService(client)),
  };
}

const nullable = <T>(value: T) => value as never;

async function createSkill(account: Account, name: string): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  return required(data?.[0]?.id, error, `skill ${name}`);
}

async function createExperience(account: Account, organization: string): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_experience_idempotent", {
    p_operation_key: randomUUID(), p_organization: organization, p_role_title: "Analis", p_kind: "employment",
    p_description: nullable(null), p_start_date: nullable("2024-01-01"), p_start_precision: nullable("month"),
    p_end_date: nullable(null), p_end_precision: nullable(null), p_is_current: false,
  });
  return required(data?.[0]?.id, error, `experience ${organization}`);
}

async function createEducation(account: Account): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: nullable("Informatika"),
    p_description: nullable(null), p_start_date: nullable("2019-01-01"), p_start_precision: nullable("year"),
    p_end_date: nullable("2023-01-01"), p_end_precision: nullable("year"), p_is_current: false,
  });
  return required(data?.[0]?.id, error, "education");
}

async function createCertification(account: Account): Promise<string> {
  const { data, error } = await account.clients[0]!.rpc("create_certification_idempotent", {
    p_operation_key: randomUUID(), p_name: "Sertifikat Tanpa Tanggal", p_issuer: nullable(null), p_issued_date: nullable(null),
    p_issued_precision: nullable(null), p_credential_url: nullable(null),
  });
  return required(data?.[0]?.id, error, "certification");
}

async function createProject(account: Account, title: string, experienceId: string | null = null) {
  return createProjectService(account.clients[0]!).createProject({
    operationKey: randomUUID(), title, description: null, userRole: null, outcome: null, status: "completed",
    experienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false,
  });
}

async function createActivity(account: Account, rawText: string): Promise<{ id: string; revision: number }> {
  const { data, error } = await account.clients[0]!.rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(), p_raw_text: rawText, p_occurred_on: "2026-09-20", p_capture_mode: "note",
    p_experience_id: nullable(null), p_project_id: nullable(null), p_role: nullable(null), p_scope: nullable(null), p_outcome: nullable(null),
  });
  const row = required(data?.[0], error, "activity");
  return { id: row.activity_id, revision: row.revision };
}

const CHANGES = (title: string, cvBullet = "") => ({
  title, contribution: `Kontribusi ${title}`, scope: "", outcome: `Hasil ${title}`, cvBullet, achievedOn: "2026-09-20", metrics: [],
});

async function createAchievement(
  account: Account,
  title: string,
  options: { projectId?: string | null; experienceId?: string | null; activityId?: string | null; confirm?: boolean; cvBullet?: string } = {},
): Promise<{ id: string; revision: number }> {
  const service = account.achievements[0]!;
  const created = await service.createAchievement({
    operationKey: randomUUID(), activityId: options.activityId ?? null, projectId: options.projectId ?? null, experienceId: options.experienceId ?? null,
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

async function achievementRow(account: Account, id: string) {
  return required((await account.clients[0]!.from("achievements").select("*").eq("id", id).single()).data, null, `achievement ${id}`);
}

/** An edit of a confirmed achievement that changes its CV bullet (a displayed field). */
async function editBullet(account: Account, id: string, bullet: string, client = 0): Promise<void> {
  const row = await achievementRow(account, id);
  await account.achievements[client]!.saveAchievement({
    achievementId: id, expectedRevision: row.revision, action: "save_changes",
    changes: {
      title: row.title ?? "", contribution: row.contribution ?? "", scope: row.scope ?? "", outcome: row.outcome ?? "",
      cvBullet: bullet, achievedOn: row.achieved_on, metrics: [],
    },
    skillNames: [],
  });
}

async function revisionOf(account: Account, table: "experiences" | "projects" | "education" | "skills" | "certifications", id: string): Promise<number> {
  const { data, error } = await account.clients[0]!.from(table).select("revision").eq("id", id).single();
  return required(data?.revision, error, `${table} revision`);
}

async function cvView(account: Account) {
  return required(await account.cv[0]!.getCv(), null, "CV view");
}

async function freshness(account: Account) {
  return indexFreshness(await account.cv[0]!.getFreshness());
}

async function stateOf(account: Account, itemId: string) {
  return (await freshness(account)).items.get(itemId)?.state;
}

async function itemFor(account: Account, column: "experience_id" | "project_id" | "achievement_id" | "education_id" | "skill_id" | "certification_id", sourceId: string) {
  const view = await cvView(account);
  return required(view.items.find((item) => item[column] === sourceId), null, `item for ${sourceId}`);
}

async function select(account: Account, type: "experience" | "project" | "achievement" | "education" | "skill" | "certification", id: string) {
  const revision = (await cvView(account)).document.revision;
  return account.cv[0]!.select({ expected_revision: revision, source_type: type, source_id: id });
}

async function resolve(account: Account, resolutions: unknown[], client = 0) {
  const revision = (await cvView(account)).document.revision;
  return account.cv[client]!.resolveFreshness({ expected_revision: revision, resolutions });
}

async function liveResolution(account: Account, itemId: string, action: "keep" | "refresh" | "replace") {
  const entry = required((await freshness(account)).items.get(itemId), null, `freshness of ${itemId}`);
  return { target: "item", item_id: itemId, source_revision: required(entry.liveRevision, null, "live revision"), action };
}

async function expectCvError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CvServiceError);
  expect((error as CvServiceError).code).toBe(code);
  return error as CvServiceError;
}

async function cvFingerprint(account: Account): Promise<string> {
  const view = await cvView(account);
  return JSON.stringify([view.document, view.items]);
}

interface RpcOutcome { code: string | null; message: string | null }

function outcomeOf(result: PromiseSettledResult<unknown>): RpcOutcome {
  if (result.status === "rejected") return { code: "REJECTED", message: String(result.reason) };
  const error = (result.value as { error: { code?: string; message?: string } | null }).error;
  return error ? { code: error.code ?? null, message: error.message ?? null } : { code: null, message: null };
}

/** Real concurrent calls must never deadlock; every outcome must be one the contract names. */
function expectOutcomes(outcomes: RpcOutcome[], allowed: readonly string[]) {
  for (const outcome of outcomes) {
    expect(outcome.code, `unexpected SQLSTATE ${outcome.code}: ${outcome.message}`).not.toBe("40P01");
    expect(outcome.code, `unexpected SQLSTATE ${outcome.code}: ${outcome.message}`).not.toBe("40001");
    if (outcome.message !== null) expect(allowed, `unexpected error ${outcome.message}`).toContain(outcome.message);
  }
}

describe("local CV freshness and source deletion integration", () => {
  beforeAll(() => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    const config = getSupabasePublicConfig();
    if (!adminConfig || !config) throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
    publicConfig = config;
    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, clientOptions);
  });

  afterAll(async () => {
    await Promise.all(openedClients.map((client) => client.auth.signOut().catch(() => undefined)));
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  });

  it("edits a selected achievement after manual wording, refreshes without losing the override, keeps per revision, then reports the deletion", async () => {
    const account = await createAccount("release", { clientCount: 2 });
    await account.cv[0]!.ensure();
    const project = await createProject(account, "Skripsi Sistem Antrian");
    const achievement = await createAchievement(account, `Antrian ${SENTINEL}`, { projectId: project.projectId });
    await select(account, "achievement", achievement.id);
    const item = await itemFor(account, "achievement_id", achievement.id);
    await account.cv[0]!.saveEdits({
      expected_revision: (await cvView(account)).document.revision,
      item_overrides: [{ item_id: item.id, override_text: `Wording saya ${SENTINEL}` }],
    });
    expect(await stateOf(account, item.id)).toBe("fresh");
    const before = await cvFingerprint(account);

    await editBullet(account, achievement.id, "Kalimat sumber versi dua");
    expect(await stateOf(account, item.id)).toBe("changed");
    expect(await cvFingerprint(account)).toBe(before);

    // Refresh keeps the override and copies the new snapshot.
    const refreshed = await resolve(account, [await liveResolution(account, item.id, "refresh")]);
    expect(refreshed.addedParentItemIds).toEqual([]);
    let current = await itemFor(account, "achievement_id", achievement.id);
    expect(current.override_text).toBe(`Wording saya ${SENTINEL}`);
    expect(current.source_snapshot).toMatchObject({ cv_bullet: "Kalimat sumber versi dua" });
    expect(current.acknowledged_revision).toBeNull();
    expect(await stateOf(account, item.id)).toBe("fresh");

    // A second edit asks again; Keep records only that exact live revision.
    await editBullet(account, achievement.id, "Kalimat sumber versi tiga");
    expect(await stateOf(account, item.id)).toBe("changed");
    const keepResolution = await liveResolution(account, item.id, "keep");
    await resolve(account, [keepResolution]);
    current = await itemFor(account, "achievement_id", achievement.id);
    expect(current.acknowledged_revision).toBe(keepResolution.source_revision);
    expect(current.source_snapshot).toMatchObject({ cv_bullet: "Kalimat sumber versi dua" });
    expect(current.override_text).toBe(`Wording saya ${SENTINEL}`);
    expect(await stateOf(account, item.id)).toBe("kept");

    // A third edit invalidates the acknowledgement without touching the CV.
    const kept = await cvFingerprint(account);
    await editBullet(account, achievement.id, "Kalimat sumber versi empat");
    expect(await stateOf(account, item.id)).toBe("changed");
    expect(await cvFingerprint(account)).toBe(kept);

    // A stale review (the source moved after it was read) is rejected without a write.
    await editBullet(account, achievement.id, "Kalimat sumber versi lima");
    const staleRevision = (await cvView(account)).document.revision;
    const stale = { ...keepResolution, source_revision: keepResolution.source_revision };
    await expectCvError(account.cv[0]!.resolveFreshness({ expected_revision: staleRevision, resolutions: [stale] }), "SOURCE_CHANGED");
    await expectCvError(account.cv[0]!.resolveFreshness({ expected_revision: staleRevision - 1, resolutions: [await liveResolution(account, item.id, "refresh")] }), "CONFLICT");

    // Deleting the source keeps snapshot and wording and moves the CV revision in the same transaction.
    const revisionBeforeDelete = (await cvView(account)).document.revision;
    const sourceRevision = (await achievementRow(account, achievement.id)).revision;
    const deleted = await account.clients[1]!.rpc("delete_achievement", { p_achievement_id: achievement.id, p_expected_revision: sourceRevision });
    expect(deleted.error).toBeNull();
    const afterDelete = await cvView(account);
    expect(afterDelete.document.revision).toBe(revisionBeforeDelete + 1);
    const deletedItem = afterDelete.items.find((row) => row.id === item.id)!;
    expect(deletedItem).toMatchObject({ source_deleted: true, achievement_id: null, override_text: `Wording saya ${SENTINEL}` });
    expect(deletedItem.source_snapshot).toMatchObject({ cv_bullet: "Kalimat sumber versi dua" });
    expect(await stateOf(account, item.id)).toBe("deleted");
    await expectCvError(resolve(account, [{ target: "item", item_id: item.id, source_revision: 1, action: "refresh" }]), "RESOLUTION_INVALID");

    // Replace is the only way to drop the wording: use a fresh achievement.
    const second = await createAchievement(account, "Hasil kedua", { projectId: project.projectId });
    await select(account, "achievement", second.id);
    const secondItem = await itemFor(account, "achievement_id", second.id);
    await expectCvError(resolve(account, [{ target: "item", item_id: secondItem.id, source_revision: 1, action: "replace" }]), "RESOLUTION_INVALID");
    await account.cv[0]!.saveEdits({
      expected_revision: (await cvView(account)).document.revision,
      item_overrides: [{ item_id: secondItem.id, override_text: "Wording kedua" }],
    });
    await editBullet(account, second.id, "Sumber kedua berubah");
    await resolve(account, [await liveResolution(account, secondItem.id, "replace")]);
    const replaced = await itemFor(account, "achievement_id", second.id);
    expect(replaced.override_text).toBeNull();
    expect(replaced.source_snapshot).toMatchObject({ cv_bullet: "Sumber kedua berubah" });
  });

  it("marks each of the six source types changed without writing the CV, then refreshes them in one batch", async () => {
    const account = await createAccount("six");
    await account.cv[0]!.ensure();
    const experience = await createExperience(account, "PT Contoh");
    const project = await createProject(account, "Proyek Contoh", experience);
    const achievement = await createAchievement(account, "Hasil Contoh", { projectId: project.projectId, experienceId: experience });
    const education = await createEducation(account);
    const skill = await createSkill(account, "SQL");
    const certification = await createCertification(account);
    for (const [type, id] of [
      ["experience", experience], ["project", project.projectId], ["achievement", achievement.id],
      ["education", education], ["skill", skill], ["certification", certification],
    ] as const) {
      const view = await cvView(account);
      if (view.items.some((row) => [row.experience_id, row.project_id, row.achievement_id, row.education_id, row.skill_id, row.certification_id].includes(id))) continue;
      await select(account, type, id);
    }
    const view = await cvView(account);
    expect(view.items).toHaveLength(6);
    const states = (await freshness(account)).items;
    expect([...states.values()].map((entry) => entry.state)).toEqual(Array(6).fill("fresh"));
    const before = await cvFingerprint(account);
    const client = account.clients[0]!;

    expect((await client.rpc("update_experience", { p_experience_id: experience, p_expected_revision: await revisionOf(account, "experiences", experience), p_changes: { role_title: "Lead Engineer" } })).error).toBeNull();
    expect((await client.rpc("update_project", { p_project_id: project.projectId, p_expected_revision: await revisionOf(account, "projects", project.projectId), p_changes: { title: "Proyek Contoh Baru" } })).error).toBeNull();
    await editBullet(account, achievement.id, "Kalimat sumber baru");
    expect((await client.rpc("update_education", { p_education_id: education, p_expected_revision: await revisionOf(account, "education", education), p_changes: { institution: "Kampus Baru" } })).error).toBeNull();
    expect((await client.rpc("update_skill", { p_skill_id: skill, p_expected_revision: await revisionOf(account, "skills", skill), p_changes: { name: "PostgreSQL" } })).error).toBeNull();
    expect((await client.rpc("update_certification", { p_certification_id: certification, p_expected_revision: await revisionOf(account, "certifications", certification), p_changes: { name: "Sertifikat Baru" } })).error).toBeNull();

    expect(await cvFingerprint(account)).toBe(before);
    const changed = (await freshness(account)).items;
    expect([...changed.values()].map((entry) => entry.state)).toEqual(Array(6).fill("changed"));
    for (const entry of changed.values()) expect(entry.liveSnapshot).not.toBeNull();

    const revisionBefore = (await cvView(account)).document.revision;
    const receipt = await resolve(account, await Promise.all(view.items.map((row) => liveResolution(account, row.id, "refresh"))));
    expect(receipt.cvRevision).toBe(revisionBefore + 1);
    expect([...(await freshness(account)).items.values()].map((entry) => entry.state)).toEqual(Array(6).fill("fresh"));
    const refreshed = await cvView(account);
    expect(refreshed.items.find((row) => row.skill_id === skill)?.source_snapshot).toMatchObject({ name: "PostgreSQL" });
    expect(refreshed.items.find((row) => row.experience_id === experience)?.source_snapshot).toMatchObject({ role_title: "Lead Engineer" });
  });

  it("detects a moved activity context, adds the new parent on refresh, and leaves raw-text edits and activity deletion alone", async () => {
    const account = await createAccount("context");
    await account.cv[0]!.ensure();
    const client = account.clients[0]!;
    const activity = await createActivity(account, `Menulis laporan ${SENTINEL}`);
    const achievement = await createAchievement(account, "Hasil dari aktivitas", { activityId: activity.id });
    const target = await createProject(account, "Proyek Tujuan");
    await select(account, "achievement", achievement.id);
    const item = await itemFor(account, "achievement_id", achievement.id);
    expect(await stateOf(account, item.id)).toBe("fresh");
    const before = await cvFingerprint(account);

    const current = await client.from("activities").select("revision").eq("id", activity.id).single();
    const relinked = await client.rpc("relink_activity_project", { p_activity_id: activity.id, p_expected_revision: required(current.data?.revision, current.error, "activity revision"), p_project_id: target.projectId });
    expect(relinked.error).toBeNull();
    expect(await stateOf(account, item.id)).toBe("changed");
    expect(await cvFingerprint(account)).toBe(before);
    expect((await cvView(account)).items.some((row) => row.project_id === target.projectId)).toBe(false);

    const receipt = await resolve(account, [await liveResolution(account, item.id, "refresh")]);
    expect(receipt.addedParentItemIds).toHaveLength(1);
    const view = await cvView(account);
    const parent = view.items.find((row) => row.project_id === target.projectId);
    expect(parent?.id).toBe(receipt.addedParentItemIds[0]);
    expect((await itemFor(account, "achievement_id", achievement.id)).source_snapshot).toMatchObject({ project_id: target.projectId });
    expect(await stateOf(account, item.id)).toBe("fresh");

    // Raw text edits and deleting the activity do not change what the CV shows.
    const row = required((await client.from("activities").select("*").eq("id", activity.id).single()).data, null, "activity row");
    await createActivityService(client).updateActivity({
      activityId: activity.id, expectedRevision: row.revision, rawText: `Teks baru ${SENTINEL}`, occurredOn: row.occurred_on,
      role: row.role, scope: row.scope, outcome: row.outcome, experienceId: row.experience_id, projectId: row.project_id,
    });
    expect(await stateOf(account, item.id)).toBe("fresh");
    const latest = await client.from("activities").select("revision").eq("id", activity.id).single();
    const removed = await client.rpc("delete_activity", { p_activity_id: activity.id, p_expected_revision: required(latest.data?.revision, latest.error, "activity revision") });
    expect(removed.error).toBeNull();
    expect(await stateOf(account, item.id)).toBe("fresh");
    expect((await achievementRow(account, achievement.id)).activity_id).toBeNull();
  });

  it("treats a reopened or dismissed achievement as unconfirmed and asks for review after it is confirmed again with changes", async () => {
    const account = await createAccount("lifecycle");
    await account.cv[0]!.ensure();
    const first = await createAchievement(account, "Pertama");
    const second = await createAchievement(account, "Kedua");
    await select(account, "achievement", first.id);
    await select(account, "achievement", second.id);
    const firstItem = await itemFor(account, "achievement_id", first.id);
    const secondItem = await itemFor(account, "achievement_id", second.id);
    const service = account.achievements[0]!;

    await service.saveAchievement({ achievementId: first.id, expectedRevision: (await achievementRow(account, first.id)).revision, action: "reopen", changes: CHANGES("Pertama"), skillNames: [] });
    expect(await stateOf(account, firstItem.id)).toBe("unconfirmed");
    const rows = await account.cv[0]!.getFreshness();
    expect(rows.find((row) => row.target === "item" && row.item_id === firstItem.id)).toMatchObject({ state: "unconfirmed", live_snapshot: null });
    await expectCvError(resolve(account, [{ target: "item", item_id: firstItem.id, source_revision: 1, action: "refresh" }]), "SOURCE_INELIGIBLE");

    await service.saveAchievement({ achievementId: first.id, expectedRevision: (await achievementRow(account, first.id)).revision, action: "save_draft", changes: CHANGES("Pertama diedit"), skillNames: [] });
    await service.saveAchievement({ achievementId: first.id, expectedRevision: (await achievementRow(account, first.id)).revision, action: "confirm", changes: CHANGES("Pertama diedit"), skillNames: [] });
    expect(await stateOf(account, firstItem.id)).toBe("changed");

    await service.saveAchievement({ achievementId: second.id, expectedRevision: (await achievementRow(account, second.id)).revision, action: "reopen", changes: CHANGES("Kedua"), skillNames: [] });
    await service.saveAchievement({ achievementId: second.id, expectedRevision: (await achievementRow(account, second.id)).revision, action: "dismiss", changes: CHANGES("Kedua"), skillNames: [] });
    expect(await stateOf(account, secondItem.id)).toBe("unconfirmed");
    // Confirming never adds an item by itself.
    expect((await cvView(account)).items).toHaveLength(2);
  });

  it("marks the profile changed by visible fields only and resolves it with keep, refresh and replace", async () => {
    const account = await createAccount("profile");
    const client = account.clients[0]!;
    await account.cv[0]!.ensure();
    const profileState = async () => (await freshness(account)).profile!;
    const profileRevision = async () => required((await client.from("profiles").select("revision").eq("id", account.id).single()).data?.revision, null, "profile revision");
    const updateProfile = async (changes: Record<string, string>) => {
      const result = await client.rpc("update_profile", { p_expected_revision: await profileRevision(), p_changes: changes });
      expect(result.error).toBeNull();
    };
    expect((await profileState()).state).toBe("fresh");

    await updateProfile({ locale: "id" });
    expect((await profileState()).state).toBe("fresh");

    await account.cv[0]!.saveEdits({
      expected_revision: (await cvView(account)).document.revision,
      summary_override: `Ringkasan saya ${SENTINEL}`, profile_overrides: { headline: "Headline saya" },
    });
    await updateProfile({ headline: "Headline sumber baru", summary: "Ringkasan sumber baru" });
    expect((await profileState()).state).toBe("changed");
    expect((await profileState()).liveSnapshot).toMatchObject({ headline: "Headline sumber baru" });

    await resolve(account, [{ target: "profile", source_revision: (await profileState()).liveRevision, action: "keep" }]);
    expect((await profileState()).state).toBe("kept");
    await updateProfile({ phone: "+62 812 0000" });
    expect((await profileState()).state).toBe("changed");

    await resolve(account, [{ target: "profile", source_revision: (await profileState()).liveRevision, action: "refresh" }]);
    let view = await cvView(account);
    expect(view.document.profile_snapshot).toMatchObject({ headline: "Headline sumber baru", phone: "+62 812 0000", display_overrides: { headline: "Headline saya" } });
    expect(view.document.summary_override).toBe(`Ringkasan saya ${SENTINEL}`);
    expect((await profileState()).state).toBe("fresh");

    // An import commit writes the same profile columns; it is exercised against the real function in pgTAP
    // (import tables are not writable by service_role, so a batch cannot be staged from here).
    await updateProfile({ headline: "Headline dari impor" });
    expect((await profileState()).state).toBe("changed");
    expect((await profileState()).liveSnapshot).toMatchObject({ headline: "Headline dari impor" });

    // Replace removes both overrides, and only Replace does.
    await resolve(account, [{ target: "profile", source_revision: (await profileState()).liveRevision, action: "replace" }]);
    view = await cvView(account);
    expect(view.document.summary_override).toBeNull();
    expect(view.document.profile_snapshot.display_overrides).toBeUndefined();
    expect(view.document.profile_snapshot).toMatchObject({ headline: "Headline dari impor" });
  });

  describe("real concurrency", () => {
    it("(a) a source edit racing a resolution never deadlocks and never writes the override", async () => {
      const account = await createAccount("race-a", { clientCount: 2 });
      await account.cv[0]!.ensure();
      const results: string[] = [];
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const achievement = await createAchievement(account, `Race A ${round}`);
        await select(account, "achievement", achievement.id);
        const item = await itemFor(account, "achievement_id", achievement.id);
        await account.cv[0]!.saveEdits({ expected_revision: (await cvView(account)).document.revision, item_overrides: [{ item_id: item.id, override_text: `Wording ${round}` }] });
        await editBullet(account, achievement.id, `Versi dua ${round}`);
        const resolution = await liveResolution(account, item.id, "refresh");
        const revision = (await cvView(account)).document.revision;
        const row = await achievementRow(account, achievement.id);
        const outcomes = (await Promise.allSettled([
          account.clients[0]!.rpc("resolve_cv_freshness", { p_expected_revision: revision, p_resolutions: [resolution] }),
          account.clients[1]!.rpc("save_achievement", {
            p_achievement_id: achievement.id, p_expected_revision: row.revision, p_action: "save_changes",
            p_changes: { title: row.title, contribution: row.contribution, outcome: row.outcome, achieved_on: row.achieved_on, cv_bullet: `Versi tiga ${round}` },
            p_skill_names: [],
          }),
        ])).map(outcomeOf);
        expectOutcomes(outcomes, ["CV_SOURCE_CHANGED"]);
        expect(outcomes[1]).toEqual({ code: null, message: null });
        results.push(`${round}:${outcomes[0]!.message ?? "ok"}`);
        expect((await itemFor(account, "achievement_id", achievement.id)).override_text).toBe(`Wording ${round}`);
        expect(["changed", "fresh"]).toContain(await stateOf(account, item.id));
      }
      expect(results).toHaveLength(RACE_ROUNDS);
    });

    it("(b) deleting a selected source racing a CV edit or removal ends consistent without deadlock", async () => {
      const account = await createAccount("race-b", { clientCount: 2 });
      await account.cv[0]!.ensure();
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const first = await createAchievement(account, `Race B1 ${round}`);
        const second = await createAchievement(account, `Race B2 ${round}`);
        await select(account, "achievement", first.id);
        await select(account, "achievement", second.id);
        const firstItem = await itemFor(account, "achievement_id", first.id);
        const secondItem = await itemFor(account, "achievement_id", second.id);
        const revision = (await cvView(account)).document.revision;
        const firstRow = await achievementRow(account, first.id);
        const removeOutcomes = (await Promise.allSettled([
          account.clients[0]!.rpc("delete_achievement", { p_achievement_id: first.id, p_expected_revision: firstRow.revision }),
          account.clients[1]!.rpc("remove_cv_item", { p_expected_revision: revision, p_item_id: firstItem.id, p_remove_children: false }),
        ])).map(outcomeOf);
        expectOutcomes(removeOutcomes, ["STALE_REVISION"]);
        expect(removeOutcomes[0]).toEqual({ code: null, message: null });

        const revisionAfter = (await cvView(account)).document.revision;
        const secondRow = await achievementRow(account, second.id);
        const saveOutcomes = (await Promise.allSettled([
          account.clients[0]!.rpc("delete_achievement", { p_achievement_id: second.id, p_expected_revision: secondRow.revision }),
          account.clients[1]!.rpc("save_cv_edits", { p_expected_revision: revisionAfter, p_edits: { item_overrides: [{ item_id: secondItem.id, override_text: `Wording ${round}` }] } }),
        ])).map(outcomeOf);
        expectOutcomes(saveOutcomes, ["STALE_REVISION"]);
        expect(saveOutcomes[0]).toEqual({ code: null, message: null });
        const view = await cvView(account);
        const left = view.items.find((row) => row.id === secondItem.id);
        // Either the wording landed before the delete (kept on the deleted item) or the save was stale; never lost silently.
        if (saveOutcomes[1]!.message === null) expect(left).toMatchObject({ source_deleted: true, override_text: `Wording ${round}` });
        else expect(left).toMatchObject({ source_deleted: true });
        expect(view.items.find((row) => row.id === firstItem.id)?.source_deleted ?? true).toBe(true);
      }
    });

    it("(c) relinking an achievement racing its selection never deadlocks and leaves one valid item", async () => {
      const account = await createAccount("race-c", { clientCount: 2 });
      await account.cv[0]!.ensure();
      const project = await createProject(account, "Proyek Race C");
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const achievement = await createAchievement(account, `Race C ${round}`);
        const revision = (await cvView(account)).document.revision;
        const row = await achievementRow(account, achievement.id);
        const outcomes = (await Promise.allSettled([
          account.clients[0]!.rpc("relink_achievement_project", { p_achievement_id: achievement.id, p_expected_revision: row.revision, p_project_id: project.projectId }),
          account.clients[1]!.rpc("select_cv_source", { p_expected_revision: revision, p_source_type: "achievement", p_source_id: achievement.id }),
        ])).map(outcomeOf);
        expectOutcomes(outcomes, ["CV_SOURCE_CHANGED"]);
        expect(outcomes[0]).toEqual({ code: null, message: null });
        const view = await cvView(account);
        const items = view.items.filter((candidate) => candidate.achievement_id === achievement.id);
        if (outcomes[1]!.message === null) {
          expect(items).toHaveLength(1);
          expect(["changed", "fresh"]).toContain(await stateOf(account, items[0]!.id));
        } else {
          expect(items).toHaveLength(0);
        }
      }
    });

    it("(d) deleting a source racing its resolution never deadlocks and reports a contract error", async () => {
      const account = await createAccount("race-d", { clientCount: 2 });
      await account.cv[0]!.ensure();
      for (let round = 0; round < RACE_ROUNDS; round += 1) {
        const achievement = await createAchievement(account, `Race D ${round}`);
        await select(account, "achievement", achievement.id);
        const item = await itemFor(account, "achievement_id", achievement.id);
        await editBullet(account, achievement.id, `Versi dua ${round}`);
        const resolution = await liveResolution(account, item.id, "refresh");
        const revision = (await cvView(account)).document.revision;
        const row = await achievementRow(account, achievement.id);
        const outcomes = (await Promise.allSettled([
          account.clients[0]!.rpc("delete_achievement", { p_achievement_id: achievement.id, p_expected_revision: row.revision }),
          account.clients[1]!.rpc("resolve_cv_freshness", { p_expected_revision: revision, p_resolutions: [resolution] }),
        ])).map(outcomeOf);
        expectOutcomes(outcomes, ["STALE_REVISION", "CV_RESOLUTION_INVALID", "CV_SOURCE_CHANGED", "CV_SOURCE_NOT_FOUND"]);
        expect(outcomes[0]).toEqual({ code: null, message: null });
        expect(await stateOf(account, item.id)).toBe("deleted");
      }
    });
  });

  it("reports the dashboard CV checks with separate counts, with and without a CV", async () => {
    const withCv = await createAccount("dash-cv");
    await withCv.cv[0]!.ensure();
    const selected = await createAchievement(withCv, "Dipilih");
    await createAchievement(withCv, "Belum dipilih satu");
    await createAchievement(withCv, "Belum dipilih dua");
    await createAchievement(withCv, "Draf saja", { confirm: false });
    await select(withCv, "achievement", selected.id);
    const dashboard = createDashboardService(withCv.clients[0]!);
    expect((await dashboard.getDashboard()).cvReview).toEqual({ hasCv: true, reviewCount: 0, availableCount: 2 });
    await editBullet(withCv, selected.id, "Berubah");
    expect((await dashboard.getDashboard()).cvReview).toEqual({ hasCv: true, reviewCount: 1, availableCount: 2 });
    const item = await itemFor(withCv, "achievement_id", selected.id);
    await resolve(withCv, [await liveResolution(withCv, item.id, "keep")]);
    expect((await dashboard.getDashboard()).cvReview).toEqual({ hasCv: true, reviewCount: 0, availableCount: 2 });

    const withoutCv = await createAccount("dash-none");
    await createAchievement(withoutCv, "Satu");
    await createAchievement(withoutCv, "Dua");
    expect((await createDashboardService(withoutCv.clients[0]!).getDashboard()).cvReview).toEqual({ hasCv: false, reviewCount: 0, availableCount: 2 });
  });

  it("returns only the caller's rows, hides another account's items, and never echoes private text", async () => {
    const owner = await createAccount("owner");
    const other = await createAccount("other");
    await owner.cv[0]!.ensure();
    await other.cv[0]!.ensure();
    const ownerAchievement = await createAchievement(owner, `Privat ${SENTINEL}`, { cvBullet: `Kalimat ${SENTINEL}` });
    const otherAchievement = await createAchievement(other, "Milik lain");
    await select(owner, "achievement", ownerAchievement.id);
    await select(other, "achievement", otherAchievement.id);
    const ownerItem = await itemFor(owner, "achievement_id", ownerAchievement.id);
    const otherItem = await itemFor(other, "achievement_id", otherAchievement.id);
    await editBullet(owner, ownerAchievement.id, `Kalimat baru ${SENTINEL}`);

    const ownerRows = await owner.cv[0]!.getFreshness();
    expect(ownerRows.filter((row) => row.target === "item").map((row) => (row.target === "item" ? row.item_id : null))).toEqual([ownerItem.id]);
    const otherRows = await other.cv[0]!.getFreshness();
    expect(otherRows.some((row) => row.target === "item" && row.item_id === ownerItem.id)).toBe(false);

    // Started one after the other so a rejection is always awaited by the time it happens.
    const attempts = [
      () => resolve(other, [{ target: "item", item_id: ownerItem.id, source_revision: 1, action: "refresh" }]),
      () => resolve(other, [{ target: "item", item_id: randomUUID(), source_revision: 1, action: "refresh" }]),
    ];
    const errors: CvServiceError[] = [];
    for (const attempt of attempts) errors.push(await expectCvError(attempt(), "NOT_FOUND"));
    expect(errors[0]!.messageKey).toBe(errors[1]!.messageKey);
    // The attempt did not change the owner's item.
    expect(await stateOf(owner, ownerItem.id)).toBe("changed");
    expect(await stateOf(other, otherItem.id)).toBe("fresh");

    const failures = [
      ...errors,
      await expectCvError(resolve(owner, [{ target: "item", item_id: ownerItem.id, source_revision: 1, action: "refresh" }]), "SOURCE_CHANGED"),
      await expectCvError(owner.cv[0]!.resolveFreshness({ expected_revision: 1, resolutions: [] }), "VALIDATION"),
    ];
    for (const error of failures) {
      expect(JSON.stringify(error)).not.toContain(SENTINEL);
      expect(error.message).not.toContain(SENTINEL);
      expect(error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
