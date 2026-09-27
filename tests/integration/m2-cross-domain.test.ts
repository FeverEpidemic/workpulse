import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { createEvidenceService } from "@/features/evidence/evidence-service";
import { createProjectService } from "@/features/project/project-service";
import { createTimelineService } from "@/features/timeline/timeline-service";
import { SupabaseEvidenceRepository } from "@/server/storage/evidence-repository";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";

// Gate M2 Fase 4 (docs/verification/M2-gate-review-plan.md): every scenario measures the Dashboard,
// the filtered lists and the Timeline before and after one cross-domain mutation, through the real
// service layer and authenticated sessions against local PostgreSQL.

type Client = SupabaseClient<Database>;
type Services = {
  activities: ReturnType<typeof createActivityService>;
  projects: ReturnType<typeof createProjectService>;
  achievements: ReturnType<typeof createAchievementService>;
  dashboard: ReturnType<typeof createDashboardService>;
  timeline: ReturnType<typeof createTimelineService>;
  evidence: ReturnType<typeof createEvidenceService>;
};
type Account = { id: string; client: Client; services: Services };
type RpcResult<T> = { data: T; error: { message: string } | null };

let admin: Client;
let ownerA: Account;
let ownerB: Account;
const createdUserIds: string[] = [];
let sequence = 0;

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`M2 cross-domain setup failed: ${label}`);
  return value;
}

async function rawRpc<T>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const rpcClient = admin as unknown as { rpc: (fn: string, rpcArgs: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const result = await rpcClient.rpc(name, args);
  return { data: result.data as T, error: result.error as RpcResult<T>["error"] };
}

async function createAccount(label: string): Promise<Account> {
  const publicConfig = required(getSupabasePublicConfig(), null, "public config");
  const email = `m2-${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = required(created.data.user?.id, created.error, `${label} account`);
  createdUserIds.push(id);
  const client = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  required((await client.auth.signInWithPassword({ email, password })).data.user, null, `${label} sign-in`);
  const services: Services = {
    activities: createActivityService(client),
    projects: createProjectService(client),
    achievements: createAchievementService(client),
    dashboard: createDashboardService(client),
    timeline: createTimelineService(client),
    evidence: createEvidenceService({
      repository: new SupabaseEvidenceRepository(admin),
      storage: new SupabaseStorageAdapter(admin),
      resolveActor: async () => ({ id }),
    }),
  };
  return { id, client, services };
}

function label(prefix: string): string {
  sequence += 1;
  return `M2 ${prefix} ${sequence}`;
}

async function insertExperience(account: Account, roleTitle: string): Promise<string> {
  const result = await admin.from("experiences").insert({
    user_id: account.id, organization: `${roleTitle} Org`, role_title: roleTitle, kind: "employment",
    start_date: "2024-01-01", start_precision: "year", end_date: null, end_precision: null, is_current: true,
  }).select("id").single();
  return required(result.data?.id, result.error, "experience");
}

async function createProject(account: Account, title: string, experienceId: string | null) {
  return account.services.projects.createProject({
    operationKey: randomUUID(), title, description: null, userRole: null, outcome: null, status: "active",
    experienceId, startDate: "2026-02-01", startPrecision: "month", endDate: null, endPrecision: null, isCurrent: false,
  });
}

async function createActivity(account: Account, rawText: string, occurredOn: string, projectId: string | null = null) {
  // Like the capture UI, the Project determines the Activity's Experience.
  const experienceId = projectId ? (await account.services.projects.getProject(projectId)).project.experience_id : null;
  return account.services.activities.createActivity({
    operationKey: randomUUID(), captureMode: "note", rawText, occurredOn,
    role: null, scope: null, outcome: null, experienceId, projectId,
  });
}

async function confirmedAchievement(account: Account, input: {
  title: string; activityId?: string | null; projectId?: string | null; experienceId?: string | null; skillNames?: string[];
}) {
  const created = await account.services.achievements.createAchievement({
    operationKey: randomUUID(), activityId: input.activityId ?? null, projectId: input.projectId ?? null, experienceId: input.experienceId ?? null,
  });
  return account.services.achievements.saveAchievement({
    achievementId: created.achievementId, expectedRevision: created.revision, action: "confirm",
    changes: {
      title: input.title, contribution: `Delivered ${input.title}`, scope: "", outcome: `Recorded ${input.title}`,
      cvBullet: `${input.title} with a documented result`, achievedOn: "2026-09-10", metrics: [],
    },
    skillNames: input.skillNames ?? [],
  });
}

async function readyEvidence(account: Account, parentKind: "activity" | "achievement", parentId: string, parentRevision: number) {
  const reserved = await rawRpc<Array<{ id: string; revision: number }>>("reserve_evidence_upload", {
    p_user_id: account.id, p_parent_kind: parentKind, p_parent_id: parentId, p_filename: "m2.pdf",
    p_content_type: "application/pdf", p_expected_bytes: 20, p_idempotency_key: randomUUID(), p_expected_revision: parentRevision,
  });
  const file = required(reserved.data?.[0], reserved.error, "evidence reserve");
  const finalized = await rawRpc<Array<{ scan_job_id: string }>>("finalize_evidence_upload", {
    p_user_id: account.id, p_evidence_id: file.id, p_expected_revision: file.revision, p_actual_bytes: 20,
    p_verified_content_type: "application/pdf", p_sha256: "b".repeat(64),
  });
  const scanJobId = required(finalized.data?.[0]?.scan_job_id, finalized.error, "evidence finalize");
  const claimed = await rawRpc<Array<{ id: string; attempt_token: string }>>("claim_evidence_scan_jobs", { p_limit: 100 });
  const job = required(claimed.data?.find((row) => row.id === scanJobId), claimed.error, "scan claim");
  const completed = await rawRpc<boolean>("complete_evidence_scan_job", { p_job_id: scanJobId, p_attempt_token: job.attempt_token, p_result: "clean" });
  if (completed.error || completed.data !== true) throw new Error("M2 cross-domain setup failed: scan completion");
  return account.services.evidence.get(file.id);
}

async function allAchievements(account: Account, filters: Record<string, unknown>) {
  const rows = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await account.services.achievements.listAchievements({ ...filters, ...(cursor ? { cursor } : {}) });
    rows.push(...result.items);
    if (!result.nextCursor) return rows.map(({ achievement }) => achievement);
    cursor = result.nextCursor;
  }
  throw new Error("achievement pagination bound exceeded");
}

async function allActivities(account: Account, filters: Record<string, unknown> = {}) {
  const rows = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await account.services.activities.listActivities({ ...filters, ...(cursor ? { cursor } : {}) });
    rows.push(...result.items);
    if (!result.nextCursor) return rows;
    cursor = result.nextCursor;
  }
  throw new Error("activity pagination bound exceeded");
}

async function allProjects(account: Account, filters: Record<string, unknown>) {
  const rows = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await account.services.projects.listProjects({ ...filters, ...(cursor ? { cursor } : {}) });
    rows.push(...result.items);
    if (!result.nextCursor) return rows.map(({ project }) => project);
    cursor = result.nextCursor;
  }
  throw new Error("project pagination bound exceeded");
}

async function timelineEvents(account: Account) {
  const timeline = await account.services.timeline.getTimeline({ type: "", project: "" });
  return timeline.groups.flatMap((group) => group.events);
}

/** Dashboard counts must equal the rows returned by the same filters the Dashboard links to. */
async function consistentSnapshot(account: Account) {
  const dashboard = await account.services.dashboard.getDashboard();
  const confirmed = await allAchievements(account, { status: "confirmed" });
  const missing = await allAchievements(account, { status: "confirmed", missingEvidence: true });
  const active = await allProjects(account, { status: "active" });
  expect(confirmed).toHaveLength(dashboard.summary.confirmedAchievementCount);
  expect(missing).toHaveLength(dashboard.summary.missingEvidenceCount);
  expect(active).toHaveLength(dashboard.summary.activeProjectCount);
  expect(dashboard.skills.length).toBeLessThanOrEqual(dashboard.summary.demonstratedSkillCount);
  for (const skill of dashboard.skills) {
    expect(await allAchievements(account, { status: "confirmed", skillId: skill.id })).toHaveLength(skill.confirmedAchievementCount);
  }
  return {
    summary: dashboard.summary,
    recentActivityIds: dashboard.recentActivities.map(({ id }) => id),
    confirmedIds: new Set(confirmed.map(({ id }) => id)),
    missingIds: new Set(missing.map(({ id }) => id)),
    events: await timelineEvents(account),
  };
}

async function reservedBytes(account: Account): Promise<number> {
  const result = await account.client.from("evidence_files").select("bytes, status").eq("user_id", account.id);
  const rows = required(result.data, result.error, "evidence bytes");
  return rows.filter((row) => ["uploading", "scanning", "ready"].includes(row.status)).reduce((sum, row) => sum + Number(row.bytes), 0);
}

async function errorCode(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation();
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
  return "NO_ERROR";
}

describe("Gate M2 cross-domain consistency", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    if (!adminConfig) throw new Error("Local Supabase admin config required");
    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    ownerA = await createAccount("owner-a");
    ownerB = await createAccount("owner-b");
    const profile = await admin.from("profiles").update({ locale: "en", timezone: "Asia/Jakarta" }).eq("id", ownerA.id);
    if (profile.error) throw new Error("M2 cross-domain setup failed: profile");
    // Older baseline records so recent-activity windows have neighbours to shift into.
    for (const day of ["2026-01-05", "2026-01-04", "2026-01-03", "2026-01-02", "2026-01-01", "2025-12-31"]) {
      await createActivity(ownerA, `M2 baseline ${day}`, day);
    }
  }, 120_000);

  afterAll(async () => {
    await ownerA?.client.auth.signOut();
    await ownerB?.client.auth.signOut();
    for (const userId of createdUserIds) await admin?.auth.admin.deleteUser(userId);
  }, 120_000);

  it("1. deleting a source Activity keeps its confirmed Achievement, provenance and counts", async () => {
    const raw = `${label("source note")}\nwith original whitespace  `;
    const activity = await createActivity(ownerA, raw, "2026-09-26");
    const title = label("derived from deleted activity");
    const achievement = await confirmedAchievement(ownerA, { title, activityId: activity.activityId, skillNames: ["M2 Provenance"] });
    const before = await consistentSnapshot(ownerA);
    expect(before.recentActivityIds[0]).toBe(activity.activityId);
    expect(before.confirmedIds.has(achievement.id)).toBe(true);

    const current = await ownerA.services.activities.getActivity(activity.activityId);
    const receipt = await ownerA.services.activities.deleteActivity({ activityId: activity.activityId, expectedRevision: current.activity.revision });
    expect(receipt).toMatchObject({ deletedActivityId: activity.activityId, retainedAchievementCount: 1 });

    const after = await consistentSnapshot(ownerA);
    const retained = await ownerA.services.achievements.getAchievement(achievement.id);
    expect(retained.achievement).toMatchObject({ status: "confirmed", activity_id: null, source_excerpt: raw, title });
    expect(retained.achievement.source_activity_revision).toBe(current.activity.revision);
    expect(retained.skills.map(({ name }) => name)).toEqual(["M2 Provenance"]);
    expect(after.summary.confirmedAchievementCount).toBe(before.summary.confirmedAchievementCount);
    expect(after.summary.demonstratedSkillCount).toBe(before.summary.demonstratedSkillCount);
    expect(after.recentActivityIds).not.toContain(activity.activityId);
    expect(after.recentActivityIds).toHaveLength(before.recentActivityIds.length);
    expect((await allActivities(ownerA)).some(({ id }) => id === activity.activityId)).toBe(false);
    expect(after.events.some(({ id }) => id === achievement.id)).toBe(true);
    expect(await errorCode(() => ownerA.services.activities.getActivity(activity.activityId))).toBe("NOT_FOUND");
  }, 60_000);

  it("2. deleting a Project keeps its Activity and Achievement with their Experience", async () => {
    const role = label("project experience");
    const experienceId = await insertExperience(ownerA, role);
    const projectTitle = label("deleted project");
    const project = await createProject(ownerA, projectTitle, experienceId);
    const activity = await createActivity(ownerA, label("project work"), "2026-09-11", project.projectId);
    const achievement = await confirmedAchievement(ownerA, { title: label("project achievement"), activityId: activity.activityId });
    expect(achievement).toMatchObject({ project_id: project.projectId, experience_id: experienceId });
    const before = await consistentSnapshot(ownerA);
    expect(before.events.find(({ id }) => id === project.projectId)?.type).toBe("project");
    expect(before.events.find(({ id }) => id === achievement.id)?.context).toBe(projectTitle);

    const detail = await ownerA.services.projects.getProject(project.projectId);
    const receipt = await ownerA.services.projects.deleteProject({ projectId: project.projectId, expectedRevision: detail.project.revision });
    expect(receipt).toMatchObject({ releasedActivityCount: 1, releasedAchievementCount: 1 });

    const after = await consistentSnapshot(ownerA);
    const keptActivity = await ownerA.services.activities.getActivity(activity.activityId);
    expect(keptActivity.activity).toMatchObject({ project_id: null, experience_id: experienceId });
    const keptAchievement = await ownerA.services.achievements.getAchievement(achievement.id);
    expect(keptAchievement.achievement).toMatchObject({ status: "confirmed", project_id: null, experience_id: experienceId });
    expect(after.summary.activeProjectCount).toBe(before.summary.activeProjectCount - 1);
    expect(after.summary.confirmedAchievementCount).toBe(before.summary.confirmedAchievementCount);
    expect(after.events.some(({ id }) => id === project.projectId)).toBe(false);
    expect(after.events.find(({ id }) => id === achievement.id)?.context).toBe(`${role} · ${role} Org`);
    expect(await allAchievements(ownerA, { projectId: project.projectId })).toEqual([]);
    expect(await allActivities(ownerA, { projectId: project.projectId })).toEqual([]);
  }, 60_000);

  it("3. deleting an Experience clears context without deleting Projects, Activities or Achievements", async () => {
    const role = label("deleted experience");
    const experienceId = await insertExperience(ownerA, role);
    const projectTitle = label("project under deleted experience");
    const project = await createProject(ownerA, projectTitle, experienceId);
    const activity = await createActivity(ownerA, label("experience work"), "2026-09-12", project.projectId);
    const derived = await confirmedAchievement(ownerA, { title: label("experience derived"), activityId: activity.activityId });
    const standalone = await confirmedAchievement(ownerA, { title: label("experience standalone"), experienceId });
    const before = await consistentSnapshot(ownerA);
    expect(before.events.some(({ id }) => id === experienceId)).toBe(true);
    expect(before.events.find(({ id }) => id === standalone.id)?.context).toBe(`${role} · ${role} Org`);

    const experience = await ownerA.client.from("experiences").select("revision").eq("id", experienceId).single();
    const deleted = await ownerA.client.rpc("delete_experience", {
      p_experience_id: experienceId, p_expected_revision: required(experience.data?.revision, experience.error, "experience revision"),
    });
    expect(deleted.error).toBeNull();

    const after = await consistentSnapshot(ownerA);
    expect((await ownerA.services.projects.getProject(project.projectId)).project.experience_id).toBeNull();
    expect((await ownerA.services.activities.getActivity(activity.activityId)).activity).toMatchObject({ project_id: project.projectId, experience_id: null });
    expect((await ownerA.services.achievements.getAchievement(derived.id)).achievement).toMatchObject({ status: "confirmed", project_id: project.projectId, experience_id: null });
    expect((await ownerA.services.achievements.getAchievement(standalone.id)).achievement).toMatchObject({ status: "confirmed", experience_id: null });
    expect(after.summary.confirmedAchievementCount).toBe(before.summary.confirmedAchievementCount);
    expect(after.summary.activeProjectCount).toBe(before.summary.activeProjectCount);
    expect(after.events.some(({ id }) => id === experienceId)).toBe(false);
    expect(after.events.find(({ id }) => id === project.projectId)?.context).toBeNull();
    expect(after.events.find(({ id }) => id === derived.id)?.context).toBe(projectTitle);
    expect(after.events.find(({ id }) => id === standalone.id)?.context).toBeNull();
  }, 60_000);

  it("4. relinking a Project or Activity moves the derived Achievement context atomically", async () => {
    const firstRole = label("first experience");
    const secondRole = label("second experience");
    const first = await insertExperience(ownerA, firstRole);
    const second = await insertExperience(ownerA, secondRole);
    const projectTitle = label("relinked project");
    const project = await createProject(ownerA, projectTitle, first);
    const activity = await createActivity(ownerA, label("relink work"), "2026-09-13", project.projectId);
    const achievement = await confirmedAchievement(ownerA, { title: label("relinked achievement"), activityId: activity.activityId });
    expect(achievement.experience_id).toBe(first);
    const before = await consistentSnapshot(ownerA);
    expect(before.events.find(({ id }) => id === project.projectId)?.context).toBe(`${firstRole} · ${firstRole} Org`);

    const current = (await ownerA.services.projects.getProject(project.projectId)).project;
    await ownerA.services.projects.updateProject({
      projectId: current.id, expectedRevision: current.revision, title: current.title, description: current.description,
      userRole: current.user_role, outcome: current.outcome, status: current.status, experienceId: second,
      startDate: current.start_date, startPrecision: current.start_precision, endDate: current.end_date,
      endPrecision: current.end_precision, isCurrent: current.is_current,
    });
    expect((await ownerA.services.activities.getActivity(activity.activityId)).activity.experience_id).toBe(second);
    const followed = await ownerA.services.achievements.getAchievement(achievement.id);
    expect(followed.achievement).toMatchObject({ status: "confirmed", project_id: project.projectId, experience_id: second });
    const afterProjectRelink = await consistentSnapshot(ownerA);
    expect(afterProjectRelink.events.find(({ id }) => id === project.projectId)?.context).toBe(`${secondRole} · ${secondRole} Org`);
    expect(afterProjectRelink.events.find(({ id }) => id === achievement.id)?.context).toBe(projectTitle);

    const targetTitle = label("target project");
    const target = await createProject(ownerA, targetTitle, first);
    const activityNow = (await ownerA.services.activities.getActivity(activity.activityId)).activity;
    await ownerA.services.projects.relinkActivity({ activityId: activity.activityId, expectedRevision: activityNow.revision, projectId: target.projectId });
    const moved = await ownerA.services.achievements.getAchievement(achievement.id);
    expect(moved.achievement).toMatchObject({ status: "confirmed", project_id: target.projectId, experience_id: first });
    const afterActivityRelink = await consistentSnapshot(ownerA);
    expect(afterActivityRelink.events.find(({ id }) => id === achievement.id)?.context).toBe(targetTitle);
    expect((await allAchievements(ownerA, { projectId: target.projectId })).map(({ id }) => id)).toEqual([achievement.id]);
    expect(await allAchievements(ownerA, { projectId: project.projectId })).toEqual([]);
    expect(afterActivityRelink.summary.confirmedAchievementCount).toBe(before.summary.confirmedAchievementCount);
  }, 60_000);

  it("5. reopening a confirmed Achievement removes it from counts and Timeline until confirmed again", async () => {
    const skill = `M2 Reopen ${randomUUID().slice(0, 8)}`;
    const title = label("reopened achievement");
    const achievement = await confirmedAchievement(ownerA, { title, skillNames: [skill] });
    const before = await consistentSnapshot(ownerA);
    expect(before.missingIds.has(achievement.id)).toBe(true);
    expect(before.events.some(({ id }) => id === achievement.id)).toBe(true);

    const changes = {
      title, contribution: `Delivered ${title}`, scope: "", outcome: `Recorded ${title}`,
      cvBullet: `${title} with a documented result`, achievedOn: "2026-09-10", metrics: [],
    };
    const reopened = await ownerA.services.achievements.saveAchievement({
      achievementId: achievement.id, expectedRevision: achievement.revision, action: "reopen", changes, skillNames: [skill],
    });
    expect(reopened.status).toBe("draft");
    const draft = await consistentSnapshot(ownerA);
    expect(draft.summary.confirmedAchievementCount).toBe(before.summary.confirmedAchievementCount - 1);
    expect(draft.summary.missingEvidenceCount).toBe(before.summary.missingEvidenceCount - 1);
    expect(draft.summary.demonstratedSkillCount).toBe(before.summary.demonstratedSkillCount - 1);
    expect(draft.events.some(({ id }) => id === achievement.id)).toBe(false);

    const reconfirmed = await ownerA.services.achievements.saveAchievement({
      achievementId: achievement.id, expectedRevision: reopened.revision, action: "confirm", changes, skillNames: [skill],
    });
    expect(reconfirmed.status).toBe("confirmed");
    const after = await consistentSnapshot(ownerA);
    expect(after.summary).toEqual(before.summary);
    expect(after.events.some(({ id }) => id === achievement.id)).toBe(true);
  }, 60_000);

  it("6. moving ready Activity evidence to its derived Achievement clears the check without new quota", async () => {
    const activity = await createActivity(ownerA, label("move source"), "2026-09-14");
    const achievement = await confirmedAchievement(ownerA, { title: label("move target"), activityId: activity.activityId });
    const activityNow = (await ownerA.services.activities.getActivity(activity.activityId)).activity;
    const file = await readyEvidence(ownerA, "activity", activity.activityId, activityNow.revision);
    const before = await consistentSnapshot(ownerA);
    const bytesBefore = await reservedBytes(ownerA);
    expect(before.missingIds.has(achievement.id)).toBe(true);

    const moved = await ownerA.services.evidence.moveToAchievement(file.id, {
      targetAchievementId: achievement.id, expectedRevision: file.revision, expectedTargetRevision: achievement.revision,
    });
    expect(moved).toMatchObject({ id: file.id, parentKind: "achievement", parentId: achievement.id, status: "ready" });

    const after = await consistentSnapshot(ownerA);
    expect(after.summary.missingEvidenceCount).toBe(before.summary.missingEvidenceCount - 1);
    expect(after.missingIds.has(achievement.id)).toBe(false);
    expect(await reservedBytes(ownerA)).toBe(bytesBefore);
    expect(await ownerA.services.evidence.list("activity", activity.activityId)).toEqual([]);
    expect((await ownerA.services.evidence.list("achievement", achievement.id)).map(({ id }) => id)).toEqual([file.id]);
  }, 60_000);

  it("7. deleting the only ready evidence restores the check and closes new download URLs", async () => {
    const achievement = await confirmedAchievement(ownerA, { title: label("evidence removed") });
    const file = await readyEvidence(ownerA, "achievement", achievement.id, achievement.revision);
    const before = await consistentSnapshot(ownerA);
    expect(before.missingIds.has(achievement.id)).toBe(false);

    await ownerA.services.evidence.remove(file.id, file.revision);

    const after = await consistentSnapshot(ownerA);
    expect(after.summary.missingEvidenceCount).toBe(before.summary.missingEvidenceCount + 1);
    expect(after.missingIds.has(achievement.id)).toBe(true);
    expect(await errorCode(() => ownerA.services.evidence.download(file.id))).toBe("EVIDENCE_NOT_FOUND");
    expect(await errorCode(() => ownerA.services.evidence.get(file.id))).toBe("EVIDENCE_NOT_FOUND");
    expect(after.events.some(({ title }) => title.includes("m2.pdf"))).toBe(false);
  }, 60_000);

  it("8. account B cannot read, count, filter, mutate or deep-link account A records", async () => {
    const experienceId = await insertExperience(ownerA, label("private experience"));
    const project = await createProject(ownerA, label("private project"), experienceId);
    const activity = await createActivity(ownerA, label("private activity"), "2026-09-15", project.projectId);
    const achievement = await confirmedAchievement(ownerA, { title: label("private achievement"), activityId: activity.activityId, skillNames: ["M2 Private"] });
    const file = await readyEvidence(ownerA, "achievement", achievement.id, achievement.revision);
    const skill = await ownerA.client.from("skills").select("id").eq("user_id", ownerA.id).eq("normalized_name", "m2 private").single();
    const skillId = required(skill.data?.id, skill.error, "private skill");
    const randomId = randomUUID();
    const b = ownerB.services;

    const pairs: Array<[string, (id: string) => Promise<unknown>, string]> = [
      ["activity detail", (id) => b.activities.getActivity(id), activity.activityId],
      ["activity delete", (id) => b.activities.deleteActivity({ activityId: id, expectedRevision: 1 }), activity.activityId],
      ["achievement detail", (id) => b.achievements.getAchievement(id), achievement.id],
      ["achievement delete", (id) => b.achievements.deleteAchievement({ achievementId: id, expectedRevision: achievement.revision }), achievement.id],
      ["project detail", (id) => b.projects.getProject(id), project.projectId],
      ["project delete", (id) => b.projects.deleteProject({ projectId: id, expectedRevision: 1 }), project.projectId],
      ["project candidates", (id) => b.projects.listRelinkCandidates(id), project.projectId],
      ["evidence get", (id) => b.evidence.get(id), file.id],
      ["evidence download", (id) => b.evidence.download(id), file.id],
      ["evidence remove", (id) => b.evidence.remove(id, file.revision), file.id],
    ];
    for (const [name, operation, foreignId] of pairs) {
      const foreign = await errorCode(() => operation(foreignId));
      const random = await errorCode(() => operation(randomId));
      expect(foreign, `${name} must fail for a foreign id`).not.toBe("NO_ERROR");
      expect(foreign, `${name} must match a random id`).toBe(random);
    }
    expect(await errorCode(() => b.evidence.moveToAchievement(file.id, { targetAchievementId: achievement.id, expectedRevision: 1, expectedTargetRevision: 1 })))
      .toBe(await errorCode(() => b.evidence.moveToAchievement(randomId, { targetAchievementId: randomUUID(), expectedRevision: 1, expectedTargetRevision: 1 })));
    expect(await errorCode(() => b.evidence.reserve({
      parentKind: "achievement", parentId: achievement.id, filename: "x.pdf", contentType: "application/pdf", expectedBytes: 10, idempotencyKey: randomUUID(), expectedRevision: achievement.revision,
    }))).toBe(await errorCode(() => b.evidence.reserve({
      parentKind: "achievement", parentId: randomId, filename: "x.pdf", contentType: "application/pdf", expectedBytes: 10, idempotencyKey: randomUUID(), expectedRevision: 1,
    })));

    expect(await b.evidence.list("achievement", achievement.id)).toEqual([]);
    expect(await allAchievements(ownerB, { projectId: project.projectId })).toEqual([]);
    expect(await allAchievements(ownerB, { skillId })).toEqual([]);
    expect(await allAchievements(ownerB, { status: "confirmed", missingEvidence: true })).toEqual([]);
    expect(await allActivities(ownerB, { projectId: project.projectId })).toEqual([]);
    const dashboardB = await b.dashboard.getDashboard();
    expect(dashboardB.summary).toEqual({
      confirmedAchievementCount: 0, activeProjectCount: 0, demonstratedSkillCount: 0,
      missingEvidenceCount: 0, completedMissingOutcomeCount: 0, hasCareerRecords: false,
    });
    expect(dashboardB.recentActivities).toEqual([]);
    const timelineB = await b.timeline.getTimeline({ type: "", project: project.projectId });
    expect(timelineB.groups).toEqual([]);
    expect(timelineB.projectOptions).toEqual([]);
    expect((await b.timeline.getTimeline({ type: "", project: "" })).groups).toEqual([]);

    // Account A still sees everything, unchanged by B's attempts.
    expect((await ownerA.services.achievements.getAchievement(achievement.id)).achievement.status).toBe("confirmed");
    expect((await ownerA.services.evidence.get(file.id)).status).toBe("ready");
    expect((await ownerA.services.activities.getActivity(activity.activityId)).activity.project_id).toBe(project.projectId);
    await consistentSnapshot(ownerA);
  }, 60_000);
});
