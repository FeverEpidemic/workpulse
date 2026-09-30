import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildCvPreviewModel } from "@/domain/cv/preview";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { CvServiceError } from "@/features/cv/cv-errors";
import { createCvService } from "@/features/cv/cv-service";
import { createProjectService } from "@/features/project/project-service";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";
type Client = SupabaseClient<Database>;

const SENTINEL = `WP-PRIVATE-CV-SENTINEL-${randomUUID()}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

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
  if (error || value === null || value === undefined) throw new Error(`CV integration setup failed: ${label}`);
  return value;
}

/** A real, onboarded account with `clientCount` independent signed-in sessions. */
async function createAccount(label: string, options: { clientCount?: number; onboard?: boolean } = {}): Promise<Account> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `cv-${label}-${suffix}@workpulse.test`;
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

const ACHIEVEMENT_CHANGES = (title: string) => ({
  title, contribution: `Kontribusi ${title}`, scope: "", outcome: `Hasil ${title}`, cvBullet: "", achievedOn: "2026-09-20", metrics: [],
});

async function createAchievement(
  account: Account,
  title: string,
  options: { projectId?: string | null; experienceId?: string | null; confirm?: boolean } = {},
): Promise<{ id: string; revision: number }> {
  const service = account.achievements[0]!;
  const created = await service.createAchievement({
    operationKey: randomUUID(), activityId: null, projectId: options.projectId ?? null, experienceId: options.experienceId ?? null,
  });
  const draft = await service.saveAchievement({
    achievementId: created.achievementId, expectedRevision: 1, action: "save_draft", changes: ACHIEVEMENT_CHANGES(title), skillNames: [],
  });
  if (options.confirm === false) return { id: created.achievementId, revision: draft.revision };
  const confirmed = await service.saveAchievement({
    achievementId: created.achievementId, expectedRevision: draft.revision, action: "confirm", changes: ACHIEVEMENT_CHANGES(title), skillNames: [],
  });
  return { id: created.achievementId, revision: confirmed.revision };
}

async function cvView(account: Account) {
  return required(await account.cv[0]!.getCv(), null, "CV view");
}

async function expectCvError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CvServiceError);
  expect((error as CvServiceError).code).toBe(code);
  return error as CvServiceError;
}

async function canonical(account: Account, ids: { project: string; achievement: string; education: string; skill: string }) {
  const client = account.clients[0]!;
  const [project, achievement, education, skill] = await Promise.all([
    client.from("projects").select("*").eq("id", ids.project).single(),
    client.from("achievements").select("*").eq("id", ids.achievement).single(),
    client.from("education").select("*").eq("id", ids.education).single(),
    client.from("skills").select("*").eq("id", ids.skill).single(),
  ]);
  return JSON.stringify([project.data, achievement.data, education.data, skill.data]);
}

async function selectAll(account: Account, sources: [string, string][]) {
  let revision = (await cvView(account)).document.revision;
  const itemIds: string[] = [];
  for (const [type, id] of sources) {
    const step = await account.cv[0]!.select({ expected_revision: revision, source_type: type, source_id: id });
    revision = step.cvRevision;
    itemIds.push(...step.itemIds);
  }
  return { revision, itemIds };
}

describe("local CV builder and overrides integration", () => {
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

  it("lets a graduate without employment compose a CV and leaves every canonical record untouched", async () => {
    const account = await createAccount("graduate", { clientCount: 3 });
    const receipts = await Promise.all(account.cv.map((service) => service.ensure()));
    expect(new Set(receipts.map((receipt) => receipt.cvId)).size).toBe(1);
    expect(receipts.filter((receipt) => receipt.created)).toHaveLength(1);
    expect((await cvView(account)).items).toHaveLength(0);

    const education = await createEducation(account);
    const skill = await createSkill(account, "SQL");
    const project = await createProject(account, "Skripsi Sistem Antrian");
    const achievement = await createAchievement(account, `Antrian ${SENTINEL}`, { projectId: project.projectId });
    const ids = { project: project.projectId, achievement: achievement.id, education, skill };
    const before = await canonical(account, ids);

    const { revision, itemIds } = await selectAll(account, [["education", education], ["achievement", achievement.id], ["skill", skill]]);
    expect(itemIds).toHaveLength(4);
    const view = await cvView(account);
    const educationItem = view.items.find((item) => item.education_id === education)!;
    const achievementItem = view.items.find((item) => item.achievement_id === achievement.id)!;
    const skillItem = view.items.find((item) => item.skill_id === skill)!;

    const saved = await account.cv[0]!.saveEdits({
      expected_revision: revision,
      title: `CV Ani ${SENTINEL}`,
      summary_override: "Lulusan Informatika yang tertarik pada data.",
      profile_overrides: { headline: "Data Analyst", website: "https://example.com/ani" },
      item_overrides: [
        { item_id: achievementItem.id, override_text: "Merancang simulasi antrian dan memangkas waktu tunggu." },
        { item_id: educationItem.id, override_text: "Fokus pada basis data." },
      ],
    });
    expect(saved.cvRevision).toBe(revision + 1);

    const after = await cvView(account);
    expect(after.document.revision).toBe(revision + 1);
    expect(after.document.title).toBe(`CV Ani ${SENTINEL}`);
    const model = buildCvPreviewModel({ document: after.document, items: after.items });
    expect(model.profile).toMatchObject({ headline: "Data Analyst", website: "https://example.com/ani", display_name: "Ani graduate" });
    expect(model.summary).toBe("Lulusan Informatika yang tertarik pada data.");
    expect(model.sections.map((section) => section.key)).toEqual(["projects", "education", "skills"]);
    const projectEntry = model.sections[0]!.entries[0]!;
    expect(projectEntry.children.map((child) => child.text)).toEqual(["Merancang simulasi antrian dan memangkas waktu tunggu."]);
    expect(projectEntry.children[0]).toMatchObject({ hasOverride: true });
    expect(model.sections[1]!.entries[0]).toMatchObject({ text: "Fokus pada basis data.", hasOverride: true });
    expect(model.sections[2]!.entries[0]).toMatchObject({ headline: "SQL", hasOverride: false });

    expect(after.items.find((item) => item.id === achievementItem.id)!.source_snapshot).toEqual(achievementItem.source_snapshot);
    expect(after.items.find((item) => item.id === skillItem.id)!.override_text).toBeNull();
    expect(await canonical(account, ids)).toBe(before);
  });

  it("keeps overrides out of the snapshot, clears them back to the source wording, and refuses skills and certifications", async () => {
    const account = await createAccount("override");
    const cv = account.cv[0]!;
    await cv.ensure();
    const skill = await createSkill(account, "Python");
    const certification = await createCertification(account);
    const achievement = await createAchievement(account, "Hasil", {});
    const { revision } = await selectAll(account, [["achievement", achievement.id], ["skill", skill], ["certification", certification]]);
    const view = await cvView(account);
    const achievementItem = view.items.find((item) => item.achievement_id === achievement.id)!;

    const first = await cv.saveEdits({ expected_revision: revision, item_overrides: [{ item_id: achievementItem.id, override_text: "  Wording khusus  " }] });
    let current = await cvView(account);
    const row = current.items.find((item) => item.id === achievementItem.id)!;
    expect(row.override_text).toBe("Wording khusus");
    expect(row.source_snapshot).toEqual(achievementItem.source_snapshot);
    expect(row.source_revision).toBe(achievementItem.source_revision);

    const unchanged = await cv.saveEdits({ expected_revision: first.cvRevision, item_overrides: [{ item_id: achievementItem.id, override_text: "Wording khusus" }] });
    expect(unchanged.cvRevision).toBe(first.cvRevision);

    for (const kind of ["skill", "certification"] as const) {
      const target = current.items.find((item) => (kind === "skill" ? item.skill_id : item.certification_id) !== null)!;
      const refused = await expectCvError(
        cv.saveEdits({ expected_revision: first.cvRevision, item_overrides: [{ item_id: target.id, override_text: "Nama lain" }] }),
        "OVERRIDE_UNSUPPORTED",
      );
      expect(refused.messageKey).toBe("cv.error.overrideUnsupported");
    }

    const cleared = await cv.saveEdits({ expected_revision: first.cvRevision, item_overrides: [{ item_id: achievementItem.id, override_text: null }] });
    expect(cleared.cvRevision).toBe(first.cvRevision + 1);
    current = await cvView(account);
    expect(current.items.find((item) => item.id === achievementItem.id)!.override_text).toBeNull();
    const model = buildCvPreviewModel({ document: current.document, items: current.items });
    expect(model.sections.find((section) => section.key === "achievements")!.entries[0]!.text).toBe(achievementItem.source_snapshot.source_type === "achievement" ? achievementItem.source_snapshot.cv_bullet : "");
  });

  it("serializes concurrent text edits and structural edits on one revision without losing the winner", async () => {
    const account = await createAccount("concurrent", { clientCount: 2 });
    const [first, second] = account.cv as [ReturnType<typeof createCvService>, ReturnType<typeof createCvService>];
    await first.ensure();
    const skills = await Promise.all(["A", "B", "C", "D", "E", "F"].map((name) => createSkill(account, `Skill ${name}`)));
    const education = await createEducation(account);
    let { revision } = await selectAll(account, [["education", education], ["skill", skills[0]!], ["skill", skills[1]!]]);
    const educationItem = (await cvView(account)).items.find((item) => item.education_id === education)!;

    for (let round = 0; round < 3; round += 1) {
      const outcomes = await Promise.allSettled([
        first.saveEdits({ expected_revision: revision, item_overrides: [{ item_id: educationItem.id, override_text: `Tulisan ${round} A` }] }),
        round === 0
          ? second.saveEdits({ expected_revision: revision, title: `Judul ${round} B` })
          : second.select({ expected_revision: revision, source_type: "skill", source_id: skills[1 + round]! }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      expect((rejected.reason as CvServiceError).code).toBe("CONFLICT");
      expect(JSON.stringify(rejected.reason)).not.toContain("40P01");
      const after = await cvView(account);
      expect(after.document.revision).toBe(revision + 1);
      const winnerIsEdit = outcomes[0]!.status === "fulfilled";
      if (winnerIsEdit) expect(after.items.find((item) => item.id === educationItem.id)!.override_text).toBe(`Tulisan ${round} A`);
      else expect(after.items.find((item) => item.id === educationItem.id)!.override_text).not.toBe(`Tulisan ${round} A`);
      revision = after.document.revision;
    }
  });

  it("asks before removing a parent, then removes its achievements and their overrides together", async () => {
    const account = await createAccount("parent");
    const cv = account.cv[0]!;
    await cv.ensure();
    const project = await createProject(account, "Proyek Induk");
    const one = await createAchievement(account, "Anak satu", { projectId: project.projectId });
    const two = await createAchievement(account, "Anak dua", { projectId: project.projectId });
    const { revision } = await selectAll(account, [["achievement", one.id], ["achievement", two.id]]);
    const view = await cvView(account);
    const parent = view.items.find((item) => item.project_id === project.projectId)!;
    const childItems = view.items.filter((item) => item.achievement_id !== null);
    const saved = await cv.saveEdits({ expected_revision: revision, item_overrides: childItems.map((item) => ({ item_id: item.id, override_text: "Teks anak" })) });

    const refused = await expectCvError(cv.remove({ expected_revision: saved.cvRevision, item_id: parent.id, remove_children: false }), "CHILD_ITEMS_EXIST");
    expect([...refused.childItemIds].sort()).toEqual(childItems.map((item) => item.id).sort());
    expect((await cvView(account)).items).toHaveLength(3);

    const removed = await cv.remove({ expected_revision: saved.cvRevision, item_id: parent.id, remove_children: true });
    expect(removed.removedItemIds).toHaveLength(3);
    expect((await cvView(account)).items).toHaveLength(0);
    const left = await account.clients[0]!.from("cv_items").select("id").in("id", childItems.map((item) => item.id));
    expect(left.data).toEqual([]);
  });

  it("does not let another account edit or see this CV", async () => {
    const owner = await createAccount("owner");
    const other = await createAccount("other");
    await Promise.all([owner.cv[0]!.ensure(), other.cv[0]!.ensure()]);
    const education = await createEducation(owner);
    await selectAll(owner, [["education", education]]);
    const ownerView = await cvView(owner);
    const ownerItem = ownerView.items[0]!;
    const otherRevision = (await cvView(other)).document.revision;

    await expectCvError(other.cv[0]!.saveEdits({ expected_revision: otherRevision, item_overrides: [{ item_id: ownerItem.id, override_text: "Bukan milik saya" }] }), "NOT_FOUND");
    await expectCvError(other.cv[0]!.saveEdits({ expected_revision: otherRevision, item_overrides: [{ item_id: randomUUID(), override_text: "Acak" }] }), "NOT_FOUND");
    expect((await cvView(other)).items).toHaveLength(0);
    const unchanged = await cvView(owner);
    expect(unchanged.items[0]!.override_text).toBeNull();
    expect(unchanged.document.revision).toBe(ownerView.document.revision);
    const saved = await other.cv[0]!.saveEdits({ expected_revision: otherRevision, title: "CV lain" });
    expect(saved.cvRevision).toBe(otherRevision + 1);
    expect((await cvView(owner)).document.title).toBe("Master CV");
  });

  it("keeps the override and the snapshot when the source is deleted afterwards", async () => {
    const account = await createAccount("deleted");
    const cv = account.cv[0]!;
    await cv.ensure();
    const project = await createProject(account, "Proyek Hilang");
    const { revision } = await selectAll(account, [["project", project.projectId]]);
    const item = (await cvView(account)).items[0]!;
    await cv.saveEdits({ expected_revision: revision, item_overrides: [{ item_id: item.id, override_text: "Tetap ada setelah hapus" }] });
    const sourceRevision = await account.clients[0]!.from("projects").select("revision").eq("id", project.projectId).single();
    const deleted = await account.clients[0]!.rpc("delete_project", { p_project_id: project.projectId, p_expected_revision: sourceRevision.data!.revision });
    expect(deleted.error).toBeNull();

    const after = await cvView(account);
    expect(after.items[0]).toMatchObject({ source_deleted: true, project_id: null, override_text: "Tetap ada setelah hapus" });
    expect(after.items[0]!.source_snapshot).toEqual(item.source_snapshot);
    const model = buildCvPreviewModel({ document: after.document, items: after.items });
    expect(model.sections[0]!.entries[0]).toMatchObject({ deleted: true, text: "Tetap ada setelah hapus" });
  });

  it("never puts CV text into errors, details or error responses", async () => {
    const account = await createAccount("hygiene");
    const cv = account.cv[0]!;
    await cv.ensure();
    const education = await createEducation(account);
    const { revision } = await selectAll(account, [["education", education]]);
    const item = (await cvView(account)).items[0]!;

    const attempts: (() => Promise<unknown>)[] = [
      () => cv.saveEdits({ expected_revision: revision + 5, title: SENTINEL, summary_override: SENTINEL }),
      () => cv.saveEdits({ expected_revision: revision, profile_overrides: { website: `ftp://${SENTINEL}` } }),
      () => cv.saveEdits({ expected_revision: revision, item_overrides: [{ item_id: randomUUID(), override_text: SENTINEL }] }),
      () => cv.saveEdits({ expected_revision: revision, item_overrides: [{ item_id: item.id, override_text: "x".repeat(2001) }] }),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(() => null, (caught: unknown) => caught);
      expect(error).toBeInstanceOf(CvServiceError);
      expect(JSON.stringify(error)).not.toContain(SENTINEL);
      expect((error as Error).message).not.toContain(SENTINEL);
      expect((error as CvServiceError).correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect((await cvView(account)).document.revision).toBe(revision);
  });
});