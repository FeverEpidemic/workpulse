import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
  const view = await account.cv[0]!.getCv();
  return required(view, null, "CV view");
}

function sectionPositions(view: Awaited<ReturnType<typeof cvView>>, section: string): number[] {
  return view.items.filter((item) => item.section_key === section).map((item) => item.position).sort((a, b) => a - b);
}

function contiguous(positions: number[]): boolean {
  return positions.every((position, index) => position === index + 1);
}

async function expectCvError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CvServiceError);
  expect((error as CvServiceError).code).toBe(code);
  return error as CvServiceError;
}

describe("local master CV schema and selection integration", () => {
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

  it("gives a graduate one CV under five parallel opens and nests the achievement under its project", async () => {
    const account = await createAccount("graduate", { clientCount: 5 });
    const receipts = await Promise.all(account.cv.map((service) => service.ensure()));
    expect(new Set(receipts.map((receipt) => receipt.cvId)).size).toBe(1);
    expect(receipts.filter((receipt) => receipt.created)).toHaveLength(1);
    const rows = await account.clients[0]!.from("cv_documents").select("id, locale, template_key").eq("user_id", account.id);
    expect(rows.data).toHaveLength(1);
    expect(rows.data?.[0]).toMatchObject({ locale: "en", template_key: "single_column_v1" });
    expect((await account.cv[0]!.ensure()).created).toBe(false);

    const educationId = await createEducation(account);
    const skillId = await createSkill(account, "SQL");
    const certificationId = await createCertification(account);
    const project = await createProject(account, "Skripsi Sistem Antrian");
    const achievement = await createAchievement(account, `Antrian ${SENTINEL}`, { projectId: project.projectId });
    const cv = account.cv[0]!;

    let revision = (await cvView(account)).document.revision;
    const selected = await cv.select({ expected_revision: revision, source_type: "achievement", source_id: achievement.id });
    expect(selected.cvRevision).toBe(revision + 1);
    expect(selected.itemIds).toHaveLength(2);
    expect(selected.parentItemIds).toHaveLength(1);
    revision = selected.cvRevision;
    for (const [type, id] of [["education", educationId], ["skill", skillId], ["certification", certificationId]] as const) {
      const step = await cv.select({ expected_revision: revision, source_type: type, source_id: id });
      expect(step.cvRevision).toBe(revision + 1);
      revision = step.cvRevision;
    }

    const view = await cvView(account);
    expect(view.document.revision).toBe(revision);
    const projects = view.outline.sections.find((section) => section.key === "projects")!;
    expect(projects.entries).toHaveLength(1);
    expect(projects.entries[0]!.children.map((child) => child.achievement_id)).toEqual([achievement.id]);
    expect(view.outline.sections.find((section) => section.key === "achievements")!.entries).toEqual([]);
    expect(view.items.every((item) => item.source_snapshot.schema_version === "cv-source.v1")).toBe(true);
    for (const section of ["projects", "achievements", "education", "skills", "certifications"]) {
      expect(contiguous(sectionPositions(view, section))).toBe(true);
    }
  });

  it("keeps drafts out of the pool and the CV until they are confirmed", async () => {
    const account = await createAccount("draft");
    const cv = account.cv[0]!;
    await cv.ensure();
    const draft = await createAchievement(account, "Masih draf", { confirm: false });
    const ready = await createAchievement(account, "Sudah siap");

    const pool = await cv.getSelectionPool();
    expect(pool.achievements.map((entry) => entry.row.id)).toEqual([ready.id]);
    const revision = (await cvView(account)).document.revision;
    const refused = await expectCvError(cv.select({ expected_revision: revision, source_type: "achievement", source_id: draft.id }), "SOURCE_INELIGIBLE");
    expect(refused.messageKey).toBe("cv.error.sourceIneligible");
    expect((await cvView(account)).items).toHaveLength(0);

    await account.achievements[0]!.saveAchievement({
      achievementId: draft.id, expectedRevision: draft.revision, action: "confirm", changes: ACHIEVEMENT_CHANGES("Masih draf"), skillNames: [],
    });
    const confirmed = await cv.select({ expected_revision: revision, source_type: "achievement", source_id: draft.id });
    expect(confirmed.itemIds).toHaveLength(1);
    expect((await cv.getSelectionPool()).achievements.find((entry) => entry.row.id === draft.id)?.selected).toBe(true);
  });

  it("rejects a duplicate and reuses a parent that is already selected", async () => {
    const account = await createAccount("duplicate");
    const cv = account.cv[0]!;
    await cv.ensure();
    const experienceId = await createExperience(account, "PT Magang");
    const first = await createAchievement(account, "Pertama", { experienceId });
    const second = await createAchievement(account, "Kedua", { experienceId });

    let revision = (await cvView(account)).document.revision;
    const one = await cv.select({ expected_revision: revision, source_type: "achievement", source_id: first.id });
    expect(one.parentItemIds).toHaveLength(1);
    revision = one.cvRevision;
    const two = await cv.select({ expected_revision: revision, source_type: "achievement", source_id: second.id });
    expect(two.itemIds).toHaveLength(1);
    expect(two.parentItemIds).toEqual([]);
    revision = two.cvRevision;

    await expectCvError(cv.select({ expected_revision: revision, source_type: "achievement", source_id: first.id }), "SOURCE_DUPLICATE");
    await expectCvError(cv.select({ expected_revision: revision, source_type: "experience", source_id: experienceId }), "SOURCE_DUPLICATE");
    const view = await cvView(account);
    expect(view.document.revision).toBe(revision);
    expect(view.items).toHaveLength(3);
    const experienceEntry = view.outline.sections.find((section) => section.key === "experience")!.entries[0]!;
    expect(experienceEntry.children).toHaveLength(2);
  });

  it("serializes concurrent edits on one revision: exactly one wins, the other is stale, no deadlock", async () => {
    const account = await createAccount("concurrent", { clientCount: 2 });
    const [first, second] = account.cv as [ReturnType<typeof createCvService>, ReturnType<typeof createCvService>];
    await first.ensure();
    const skillIds = await Promise.all(["A", "B", "C", "D", "E"].map((name) => createSkill(account, `Skill ${name}`)));
    let revision = (await cvView(account)).document.revision;
    for (const skillId of skillIds.slice(0, 2)) {
      revision = (await first.select({ expected_revision: revision, source_type: "skill", source_id: skillId })).cvRevision;
    }

    for (let round = 0; round < 3; round += 1) {
      const before = await cvView(account);
      const ids = before.items.filter((item) => item.section_key === "skills").sort((a, b) => a.position - b.position).map((item) => item.id);
      const outcomes = await Promise.allSettled([
        first.reorder({ expected_revision: before.document.revision, section_key: "skills", item_ids: [...ids].reverse() }),
        second.select({ expected_revision: before.document.revision, source_type: "skill", source_id: skillIds[2 + round]! }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(CvServiceError);
      expect((rejected.reason as CvServiceError).code).toBe("CONFLICT");
      const after = await cvView(account);
      expect(after.document.revision).toBe(before.document.revision + 1);
      expect(contiguous(sectionPositions(after, "skills"))).toBe(true);
    }
  });

  it("stays consistent when a source is reopened or deleted while it is being selected", async () => {
    const account = await createAccount("race", { clientCount: 2 });
    const [selecting, other] = account.cv as [ReturnType<typeof createCvService>, ReturnType<typeof createCvService>];
    const [selectingAchievements, otherAchievements] = account.achievements as [
      ReturnType<typeof createAchievementService>,
      ReturnType<typeof createAchievementService>,
    ];
    void other;
    await selecting.ensure();

    for (let round = 0; round < 4; round += 1) {
      const target = await createAchievement(account, `Reopen ${round}`);
      const { revision } = await cvView(account).then((view) => view.document);
      const outcomes = await Promise.allSettled([
        selecting.select({ expected_revision: revision, source_type: "achievement", source_id: target.id }),
        otherAchievements.saveAchievement({
          achievementId: target.id, expectedRevision: target.revision, action: "reopen", changes: ACHIEVEMENT_CHANGES(`Reopen ${round}`), skillNames: [],
        }),
      ]);
      expect(outcomes[1]!.status).toBe("fulfilled");
      const item = await account.clients[0]!.from("cv_items").select("id").eq("user_id", account.id).eq("achievement_id", target.id);
      if (outcomes[0]!.status === "fulfilled") {
        expect(item.data).toHaveLength(1);
      } else {
        expect((outcomes[0]!.reason as CvServiceError).code).toBe("SOURCE_INELIGIBLE");
        expect(item.data).toHaveLength(0);
      }
    }

    for (let round = 0; round < 4; round += 1) {
      const target = await createAchievement(account, `Delete ${round}`);
      const { revision } = await cvView(account).then((view) => view.document);
      const outcomes = await Promise.allSettled([
        selecting.select({ expected_revision: revision, source_type: "achievement", source_id: target.id }),
        account.clients[1]!.rpc("delete_achievement", { p_achievement_id: target.id, p_expected_revision: target.revision }),
      ]);
      expect(outcomes[1]!.status).toBe("fulfilled");
      expect((outcomes[1] as PromiseFulfilledResult<{ error: unknown }>).value.error).toBeNull();
      const item = await account.clients[0]!.from("cv_items").select("achievement_id, source_deleted").eq("user_id", account.id).contains("source_snapshot", { source_id: target.id });
      if (outcomes[0]!.status === "fulfilled") {
        expect(item.data).toEqual([{ achievement_id: null, source_deleted: true }]);
      } else {
        expect((outcomes[0]!.reason as CvServiceError).code).toBe("SOURCE_NOT_FOUND");
        expect(item.data).toHaveLength(0);
      }
    }
    void selectingAchievements;

    // Reorder while one of the reordered sources is deleted.
    const experienceIds = [await createExperience(account, "Org 1"), await createExperience(account, "Org 2")];
    let revision = (await cvView(account)).document.revision;
    for (const id of experienceIds) {
      revision = (await selecting.select({ expected_revision: revision, source_type: "experience", source_id: id })).cvRevision;
    }
    const view = await cvView(account);
    const ordered = view.items.filter((item) => item.section_key === "experience").sort((a, b) => a.position - b.position);
    const sourceRevision = await account.clients[0]!.from("experiences").select("revision").eq("id", experienceIds[0]!).single();
    const outcomes = await Promise.allSettled([
      selecting.reorder({ expected_revision: view.document.revision, section_key: "experience", item_ids: ordered.map((item) => item.id).reverse() }),
      account.clients[1]!.rpc("delete_experience", { p_experience_id: experienceIds[0]!, p_expected_revision: sourceRevision.data!.revision }),
    ]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    const after = await cvView(account);
    const experienceItems = after.items.filter((item) => item.section_key === "experience").sort((a, b) => a.position - b.position);
    expect(experienceItems.map((item) => item.position)).toEqual([1, 2]);
    expect(experienceItems.map((item) => item.id)).toEqual(ordered.map((item) => item.id).reverse());
    expect(experienceItems.find((item) => item.id === ordered[0]!.id)).toMatchObject({ source_deleted: true, experience_id: null });
    expect(experienceItems.find((item) => item.id === ordered[1]!.id)).toMatchObject({ source_deleted: false, experience_id: experienceIds[1] });
  });

  it("marks selected sources as deleted, keeps their snapshots, and never blocks the old delete paths", async () => {
    const account = await createAccount("deletion");
    const cv = account.cv[0]!;
    await cv.ensure();
    const client = account.clients[0]!;
    const experienceId = await createExperience(account, "PT Hapus");
    const project = await createProject(account, "Proyek Hapus", experienceId);
    const achievement = await createAchievement(account, "Hasil Hapus", { projectId: project.projectId, experienceId });
    const skillId = await createSkill(account, "Excel");
    const educationId = await createEducation(account);
    const certificationId = await createCertification(account);

    let revision = (await cvView(account)).document.revision;
    for (const [type, id] of [
      ["experience", experienceId], ["achievement", achievement.id], ["skill", skillId], ["education", educationId], ["certification", certificationId],
    ] as const) {
      revision = (await cv.select({ expected_revision: revision, source_type: type, source_id: id })).cvRevision;
    }
    const before = await cvView(account);
    expect(before.items).toHaveLength(6);
    const snapshots = new Map(before.items.map((item) => [item.id, JSON.stringify(item.source_snapshot)]));
    const positions = new Map(before.items.map((item) => [item.id, item.position]));

    const revisionOf = async (table: "experiences" | "projects" | "achievements" | "skills" | "education" | "certifications", id: string) => {
      const row = await client.from(table).select("revision").eq("id", id).single();
      return required(row.data?.revision, row.error, `${table} revision`);
    };
    const results = [
      await client.rpc("delete_achievement", { p_achievement_id: achievement.id, p_expected_revision: await revisionOf("achievements", achievement.id) }),
      await client.rpc("delete_project", { p_project_id: project.projectId, p_expected_revision: await revisionOf("projects", project.projectId) }),
      await client.rpc("delete_experience", { p_experience_id: experienceId, p_expected_revision: await revisionOf("experiences", experienceId) }),
      await client.rpc("delete_skill", { p_skill_id: skillId, p_expected_revision: await revisionOf("skills", skillId) }),
      await client.rpc("delete_education", { p_education_id: educationId, p_expected_revision: await revisionOf("education", educationId) }),
      await client.rpc("delete_certification", { p_certification_id: certificationId, p_expected_revision: await revisionOf("certifications", certificationId) }),
    ];
    for (const result of results) expect(result.error).toBeNull();

    const after = await cvView(account);
    expect(after.items).toHaveLength(6);
    for (const item of after.items) {
      expect(item.source_deleted).toBe(true);
      expect([item.experience_id, item.project_id, item.achievement_id, item.education_id, item.skill_id, item.certification_id]).toEqual([null, null, null, null, null, null]);
      expect(JSON.stringify(item.source_snapshot)).toBe(snapshots.get(item.id));
      expect(item.position).toBe(positions.get(item.id));
    }
    const entries = after.outline.sections.flatMap((section) => section.entries);
    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => entry.deleted)).toBe(true);
    expect(entries.flatMap((entry) => entry.children)).toHaveLength(1);
  });

  it("removes a parent only after an explicit decision about its children", async () => {
    const account = await createAccount("parent");
    const cv = account.cv[0]!;
    await cv.ensure();
    const project = await createProject(account, "Proyek Induk");
    const achievement = await createAchievement(account, "Anak", { projectId: project.projectId });
    let revision = (await cvView(account)).document.revision;
    revision = (await cv.select({ expected_revision: revision, source_type: "achievement", source_id: achievement.id })).cvRevision;
    const view = await cvView(account);
    const parent = view.items.find((item) => item.section_key === "projects")!;
    const child = view.items.find((item) => item.section_key === "achievements")!;

    const refused = await expectCvError(cv.remove({ expected_revision: revision, item_id: parent.id, remove_children: false }), "CHILD_ITEMS_EXIST");
    expect(refused.childItemIds).toEqual([child.id]);
    expect((await cvView(account)).items).toHaveLength(2);

    const removed = await cv.remove({ expected_revision: revision, item_id: parent.id, remove_children: true });
    expect(removed.removedItemIds.sort()).toEqual([parent.id, child.id].sort());
    expect(removed.cvRevision).toBe(revision + 1);
    expect((await cvView(account)).items).toHaveLength(0);
  });

  it("isolates accounts, denies direct writes, and never echoes source text in errors", async () => {
    const owner = await createAccount("iso-a");
    const stranger = await createAccount("iso-b");
    const cv = owner.cv[0]!;
    const strangerCv = stranger.cv[0]!;
    await cv.ensure();
    await strangerCv.ensure();
    const skillId = await createSkill(owner, "Rahasia");
    const achievement = await createAchievement(owner, `Rahasia ${SENTINEL}`);
    const draft = await createAchievement(owner, `Draf ${SENTINEL}`, { confirm: false });
    let revision = (await cvView(owner)).document.revision;
    revision = (await cv.select({ expected_revision: revision, source_type: "achievement", source_id: achievement.id })).cvRevision;
    await cv.select({ expected_revision: revision, source_type: "skill", source_id: skillId }).then((receipt) => { revision = receipt.cvRevision; });
    const ownerView = await cvView(owner);
    const ownerItem = ownerView.items[0]!;

    // B cannot see, select, remove, or reorder anything of A.
    const strangerView = await cvView(stranger);
    expect(strangerView.items).toHaveLength(0);
    expect(strangerView.document.id).not.toBe(ownerView.document.id);
    expect((await stranger.clients[0]!.from("cv_items").select("id")).data).toEqual([]);
    expect((await stranger.clients[0]!.from("cv_documents").select("id").eq("user_id", owner.id)).data).toEqual([]);
    const strangerRevision = strangerView.document.revision;
    await expectCvError(strangerCv.select({ expected_revision: strangerRevision, source_type: "skill", source_id: skillId }), "SOURCE_NOT_FOUND");
    await expectCvError(strangerCv.select({ expected_revision: strangerRevision, source_type: "skill", source_id: randomUUID() }), "SOURCE_NOT_FOUND");
    await expectCvError(strangerCv.remove({ expected_revision: strangerRevision, item_id: ownerItem.id, remove_children: false }), "NOT_FOUND");
    await expectCvError(strangerCv.reorder({ expected_revision: strangerRevision, section_key: "skills", item_ids: [ownerItem.id] }), "REORDER_INVALID");

    // Direct client writes are denied for both accounts.
    for (const account of [owner, stranger]) {
      const client = account.clients[0]!;
      const insert = await client.from("cv_items").insert({
        user_id: account.id, cv_id: ownerView.document.id, section_key: "skills", position: 9, source_snapshot: {}, source_revision: 1, source_deleted: true,
      } as never);
      expect(insert.error?.code).toBe("42501");
      const update = await client.from("cv_documents").update({ title: "Hijack" }).eq("id", ownerView.document.id).select();
      expect(update.error?.code === "42501" || update.data?.length === 0).toBe(true);
      const remove = await client.from("cv_items").delete().eq("id", ownerItem.id).select();
      expect(remove.error?.code === "42501" || remove.data?.length === 0).toBe(true);
      const exportInsert = await client.from("cv_exports").insert({
        user_id: account.id, cv_id: ownerView.document.id, cv_revision: 1, snapshot: {}, idempotency_key: randomUUID(),
      } as never);
      expect(exportInsert.error?.code).toBe("42501");
    }
    expect((await cvView(owner)).document.title).toBe("Master CV");
    expect((await cvView(owner)).items).toHaveLength(2);

    // Error surfaces carry codes and ids only.
    const failures: unknown[] = [];
    failures.push(await cv.select({ expected_revision: revision, source_type: "achievement", source_id: achievement.id }).catch((error: unknown) => error));
    failures.push(await cv.select({ expected_revision: revision, source_type: "achievement", source_id: draft.id }).catch((error: unknown) => error));
    failures.push(await cv.select({ expected_revision: 1, source_type: "skill", source_id: skillId }).catch((error: unknown) => error));
    failures.push(await cv.remove({ expected_revision: revision, item_id: randomUUID(), remove_children: false }).catch((error: unknown) => error));
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(CvServiceError);
      expect(JSON.stringify(failure)).not.toContain(SENTINEL);
      expect((failure as Error).message).not.toContain(SENTINEL);
      expect((failure as Error).stack ?? "").not.toContain(SENTINEL);
    }
    const raw = [
      await owner.clients[0]!.rpc("select_cv_source", { p_expected_revision: revision, p_source_type: "achievement", p_source_id: achievement.id }),
      await owner.clients[0]!.rpc("select_cv_source", { p_expected_revision: revision, p_source_type: "achievement", p_source_id: draft.id }),
      await owner.clients[0]!.rpc("remove_cv_item", { p_expected_revision: 1, p_item_id: ownerItem.id, p_remove_children: false }),
    ];
    for (const result of raw) {
      expect(result.error).not.toBeNull();
      expect(JSON.stringify(result.error)).not.toContain(SENTINEL);
    }
  });

  it("requires onboarding before a CV exists", async () => {
    const account = await createAccount("no-onboarding", { onboard: false });
    const error = await expectCvError(account.cv[0]!.ensure(), "ONBOARDING_REQUIRED");
    expect(error.messageKey).toBe("cv.error.onboardingRequired");
    const rows = await account.clients[0]!.from("cv_documents").select("id").eq("user_id", account.id);
    expect(rows.data).toEqual([]);
  });

  it("reorders sections and updates the layout under the revision guard", async () => {
    const account = await createAccount("layout");
    const cv = account.cv[0]!;
    await cv.ensure();
    const ids = await Promise.all([createSkill(account, "Satu"), createSkill(account, "Dua"), createSkill(account, "Tiga")]);
    let revision = (await cvView(account)).document.revision;
    for (const id of ids) revision = (await cv.select({ expected_revision: revision, source_type: "skill", source_id: id })).cvRevision;
    const view = await cvView(account);
    const itemIds = view.items.sort((a, b) => a.position - b.position).map((item) => item.id);

    await expectCvError(cv.reorder({ expected_revision: revision, section_key: "skills", item_ids: itemIds.slice(1) }), "REORDER_INVALID");
    const reordered = await cv.reorder({ expected_revision: revision, section_key: "skills", item_ids: [itemIds[2]!, itemIds[0]!, itemIds[1]!] });
    expect(reordered.cvRevision).toBe(revision + 1);
    const after = await cvView(account);
    expect(after.items.sort((a, b) => a.position - b.position).map((item) => item.id)).toEqual([itemIds[2], itemIds[0], itemIds[1]]);

    await expectCvError(cv.updateLayout({ expected_revision: revision, locale: "id" }), "CONFLICT");
    const layout = await cv.updateLayout({
      expected_revision: reordered.cvRevision, locale: "id", section_order: ["skills", "education", "experience", "projects", "achievements", "certifications"],
    });
    expect(layout.cvRevision).toBe(reordered.cvRevision + 1);
    const finalView = await cvView(account);
    expect(finalView.document.locale).toBe("id");
    expect(finalView.outline.sections.map((section) => section.key)).toEqual(["skills", "education", "experience", "projects", "achievements", "certifications"]);
  });
});
