import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createAchievementService } from "@/features/achievement/achievement-service";
import { createActivityService } from "@/features/activity/activity-service";
import { createDashboardService } from "@/features/dashboard/dashboard-service";
import { createProjectService } from "@/features/project/project-service";
import { createTimelineService } from "@/features/timeline/timeline-service";
import { dashboardLinks } from "@/domain/dashboard/links";
import { readAchievementQuery } from "@/domain/routes/achievement-filters";
import { readProjectQuery } from "@/domain/routes/project-filters";
import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";

type Client = SupabaseClient<Database>;
type Account = { id: string; client: Client };
type EvidenceReceipt = { id: string; revision: number; scan_job_id: string | null };
type RpcResult<T> = { data: T; error: { message: string } | null };
type AchievementService = ReturnType<typeof createAchievementService>;
type ProjectService = ReturnType<typeof createProjectService>;
type ActivityService = ReturnType<typeof createActivityService>;

let admin: Client;
let publicConfig: NonNullable<ReturnType<typeof getSupabasePublicConfig>>;
const createdUserIds: string[] = [];
let accountA: Account;
let accountB: Account;
let accountC: Account;
let serviceA: { achievements: AchievementService; projects: ProjectService; activities: ActivityService };
let serviceB: { achievements: AchievementService; projects: ProjectService; activities: ActivityService };
let serviceC: { achievements: AchievementService };
let projectA: { active: string; completed: string; undated: string; planned: string };
let foreignProjectId = "";
let foreignExperienceId = "";
let foreignEducationId = "";
let foreignActivityId = "";
let foreignAchievementId = "";
let educationAId = "";
let unknownEducationAId = "";
let ownerAAchievements: Record<string, string> = {};
let ownerAActivities: string[] = [];
let paginationSkillId = "";

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`Dashboard and Timeline integration setup failed: ${label}`);
  return value;
}

async function rawRpc<T>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const client = admin as unknown as { rpc: (functionName: string, rpcArgs: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const result = await client.rpc(name, args);
  return { data: result.data as T, error: result.error as RpcResult<T>["error"] };
}

async function createAccount(label: string): Promise<Account> {
  const email = `${label}-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = required(created.data.user?.id, created.error, `${label} account`);
  createdUserIds.push(id);
  const client = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  required(signedIn.data.user, signedIn.error, `${label} sign-in`);
  return { id, client };
}

async function createProject(
  service: ProjectService,
  input: {
    title: string;
    status: "planned" | "active" | "completed";
    outcome: string | null;
    experienceId?: string | null;
    startDate?: string | null;
    startPrecision?: "year" | "month" | "day" | null;
  },
): Promise<string> {
  const receipt = await service.createProject({
    operationKey: randomUUID(),
    title: input.title,
    description: null,
    userRole: null,
    outcome: input.outcome,
    status: input.status,
    experienceId: input.experienceId ?? null,
    startDate: input.startDate ?? null,
    startPrecision: input.startPrecision ?? null,
    endDate: null,
    endPrecision: null,
    isCurrent: false,
  });
  return receipt.projectId;
}

async function createActivity(service: ActivityService, rawText: string, occurredOn: string, projectId: string | null = null) {
  return service.createActivity({
    operationKey: randomUUID(),
    captureMode: "note",
    rawText,
    occurredOn,
    role: null,
    scope: null,
    outcome: null,
    experienceId: null,
    projectId,
  });
}

async function createAchievement(
  service: AchievementService,
  input: {
    title: string;
    achievedOn: string;
    projectId?: string | null;
    experienceId?: string | null;
    activityId?: string | null;
    skillNames?: string[];
    action?: "confirm" | "save_draft" | "dismiss";
  },
) {
  const created = await service.createAchievement({
    operationKey: randomUUID(),
    activityId: input.activityId ?? null,
    projectId: input.projectId ?? null,
    experienceId: input.experienceId ?? null,
  });
  const action = input.action ?? "confirm";
  const saved = await service.saveAchievement({
    achievementId: created.achievementId,
    expectedRevision: created.revision,
    action,
    changes: {
      title: input.title,
      contribution: action === "confirm" ? `Delivered ${input.title}` : "",
      scope: "",
      outcome: action === "confirm" ? `Recorded ${input.title}` : "",
      cvBullet: action === "confirm" ? `${input.title} with a documented result` : "",
      achievedOn: input.achievedOn,
      metrics: [],
    },
    skillNames: input.skillNames ?? [],
  });
  return saved;
}

async function addEvidence(userId: string, parentKind: "activity" | "achievement" | "project", parentId: string, expectedRevision: number, ready: boolean): Promise<EvidenceReceipt> {
  const reserved = await rawRpc<Array<EvidenceReceipt>>("reserve_evidence_upload", {
    p_user_id: userId,
    p_parent_kind: parentKind,
    p_parent_id: parentId,
    p_filename: "fixture.pdf",
    p_content_type: "application/pdf",
    p_expected_bytes: 20,
    p_idempotency_key: randomUUID(),
    p_expected_revision: expectedRevision,
  });
  const file = required(reserved.data?.[0], reserved.error, `${parentKind} evidence reservation`);
  const finalized = await rawRpc<Array<{ scan_job_id: string }>>("finalize_evidence_upload", {
    p_user_id: userId,
    p_evidence_id: file.id,
    p_expected_revision: file.revision,
    p_actual_bytes: 20,
    p_verified_content_type: "application/pdf",
    p_sha256: "a".repeat(64),
  });
  const scanJobId = required(finalized.data?.[0]?.scan_job_id, finalized.error, `${parentKind} evidence scan job`);
  if (!ready) return { ...file, scan_job_id: scanJobId };

  const claimed = await rawRpc<Array<{ id: string; attempt_token: string }>>("claim_evidence_scan_jobs", { p_limit: 100 });
  const job = required(claimed.data?.find((row) => row.id === scanJobId), claimed.error, "scan claim");
  const completed = await rawRpc<boolean>("complete_evidence_scan_job", {
    p_job_id: scanJobId,
    p_attempt_token: job.attempt_token,
    p_result: "clean",
  });
  if (completed.error || completed.data !== true) throw new Error("Dashboard and Timeline integration setup failed: scan completion");
  return { ...file, scan_job_id: scanJobId };
}

async function insertExperience(userId: string, input: {
  organization: string;
  roleTitle: string;
  startDate: string | null;
  startPrecision: "year" | "month" | "day" | null;
  endDate: string | null;
  endPrecision: "year" | "month" | "day" | null;
  isCurrent?: boolean;
}): Promise<string> {
  const result = await admin.from("experiences").insert({
    user_id: userId,
    organization: input.organization,
    role_title: input.roleTitle,
    kind: "employment",
    start_date: input.startDate,
    start_precision: input.startPrecision,
    end_date: input.endDate,
    end_precision: input.endPrecision,
    is_current: input.isCurrent ?? false,
  }).select("id").single();
  return required(result.data?.id, result.error, "experience fixture");
}

describe("local T12 Dashboard and Timeline integration", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    publicConfig = required(getSupabasePublicConfig(), null, "public Supabase config");
    if (!adminConfig) throw new Error("Local Supabase admin config required");
    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    accountA = await createAccount("dashboard-owner-a");
    accountB = await createAccount("dashboard-owner-b");
    accountC = await createAccount("dashboard-owner-c");
    const profileUpdate = await admin.from("profiles").update({ locale: "en", timezone: "Asia/Jakarta" }).eq("id", accountA.id);
    if (profileUpdate.error) throw new Error("Dashboard and Timeline integration setup failed: owner A profile");
    serviceA = {
      achievements: createAchievementService(accountA.client),
      projects: createProjectService(accountA.client),
      activities: createActivityService(accountA.client),
    };
    serviceB = {
      achievements: createAchievementService(accountB.client),
      projects: createProjectService(accountB.client),
      activities: createActivityService(accountB.client),
    };
    serviceC = { achievements: createAchievementService(accountC.client) };

    const experienceA = await insertExperience(accountA.id, {
      organization: "Northwind",
      roleTitle: "Analyst",
      startDate: "2021-03-01",
      startPrecision: "month",
      endDate: "2023-06-01",
      endPrecision: "month",
    });
    const currentExperienceA = await insertExperience(accountA.id, {
      organization: "Contoso",
      roleTitle: "Consultant",
      startDate: "2022-01-01",
      startPrecision: "month",
      endDate: null,
      endPrecision: null,
      isCurrent: true,
    });
    const education = await admin.from("education").insert({
      user_id: accountA.id,
      institution: "Universitas Indonesia",
      qualification: "S.Kom",
      start_date: "2016-01-01",
      start_precision: "year",
      end_date: "2020-01-01",
      end_precision: "year",
      is_current: false,
    }).select("id").single();
    educationAId = required(education.data?.id, education.error, "dated education fixture");
    const unknownEducation = await admin.from("education").insert({
      user_id: accountA.id,
      institution: "Online Academy",
      qualification: "Certificate",
      start_date: null,
      start_precision: null,
      end_date: null,
      end_precision: null,
      is_current: false,
    }).select("id").single();
    unknownEducationAId = required(unknownEducation.data?.id, unknownEducation.error, "unknown-date education fixture");

    projectA = {
      active: await createProject(serviceA.projects, {
        title: "Platform revamp",
        status: "active",
        outcome: null,
        experienceId: currentExperienceA,
        startDate: "2024-02-01",
        startPrecision: "month",
      }),
      completed: await createProject(serviceA.projects, {
        title: "Thesis prototype",
        status: "completed",
        outcome: null,
        experienceId: null,
        startDate: "2023-01-01",
        startPrecision: "year",
      }),
      undated: await createProject(serviceA.projects, {
        title: "Migration",
        status: "completed",
        outcome: "Shipped",
      }),
      planned: await createProject(serviceA.projects, {
        title: "Next initiative",
        status: "planned",
        outcome: null,
        startDate: "2025-01-15",
        startPrecision: "day",
      }),
    };

    const activityDates = ["2026-09-20", "2026-09-18", "2026-09-10", "2026-08-01", "2026-07-15", "2026-06-01"];
    for (let index = 0; index < activityDates.length; index += 1) {
      const activity = await createActivity(serviceA.activities, `AC${index + 1}`, activityDates[index]!);
      ownerAActivities.push(activity.activityId);
    }
    const activity7 = await createActivity(serviceA.activities, "AC7 older activity", "2025-11-03");
    ownerAActivities.push(activity7.activityId);

    const c1 = await createAchievement(serviceA.achievements, {
      title: "C1 Project result",
      achievedOn: "2026-08-10",
      projectId: projectA.active,
      skillNames: ["TypeScript", "SQL"],
    });
    const c2 = await createAchievement(serviceA.achievements, {
      title: "C2 Standalone result",
      achievedOn: "2026-07-01",
      skillNames: ["typescript "],
    });
    const c3 = await createAchievement(serviceA.achievements, {
      title: "C3 Experience result",
      achievedOn: "2023-05-20",
      experienceId: experienceA,
    });
    const c4 = await createAchievement(serviceA.achievements, {
      title: "C4 Derived result",
      achievedOn: "2025-11-03",
      activityId: activity7.activityId,
    });
    const c5 = await createAchievement(serviceA.achievements, {
      title: "C5 Project result",
      achievedOn: "2023-09-09",
      projectId: projectA.completed,
    });
    ownerAAchievements = {
      c1: c1.id,
      c2: c2.id,
      c3: c3.id,
      c4: c4.id,
      c5: c5.id,
    };

    await createAchievement(serviceA.achievements, {
      title: "D1 Draft only",
      achievedOn: "2026-09-01",
      skillNames: ["Figma"],
      action: "save_draft",
    });
    await createAchievement(serviceA.achievements, {
      title: "X1 Dismissed",
      achievedOn: "2026-08-01",
      action: "dismiss",
    });

    await addEvidence(accountA.id, "achievement", c1.id, c1.revision, true);
    await addEvidence(accountA.id, "achievement", c2.id, c2.revision, false);
    await addEvidence(accountA.id, "achievement", c3.id, c3.revision, false);
    await addEvidence(accountA.id, "activity", activity7.activityId, activity7.revision, true);
    await addEvidence(accountA.id, "project", projectA.completed, 1, true);

    foreignProjectId = await createProject(serviceB.projects, {
      title: "Other owner's project",
      status: "active",
      outcome: null,
    });
    const foreignAchievement = await createAchievement(serviceB.achievements, {
      title: "Other owner's confirmed result",
      achievedOn: "2026-08-11",
      projectId: foreignProjectId,
      skillNames: ["Foreign skill"],
    });
    foreignAchievementId = foreignAchievement.id;
    foreignExperienceId = await insertExperience(accountB.id, {
      organization: "Foreign company",
      roleTitle: "Foreign role",
      startDate: "2020-01-01",
      startPrecision: "year",
      endDate: null,
      endPrecision: null,
      isCurrent: true,
    });
    const foreignEducation = await admin.from("education").insert({
      user_id: accountB.id,
      institution: "Foreign school",
      qualification: "Foreign degree",
      start_date: "2018-01-01",
      start_precision: "year",
      end_date: "2019-01-01",
      end_precision: "year",
      is_current: false,
    }).select("id").single();
    foreignEducationId = required(foreignEducation.data?.id, foreignEducation.error, "owner B education fixture");
    const foreignActivity = await createActivity(serviceB.activities, "Foreign activity", "2026-09-19", foreignProjectId);
    foreignActivityId = foreignActivity.activityId;

    for (let offset = 0; offset < 31; offset += 8) {
      const batch = Array.from({ length: Math.min(8, 31 - offset) }, (_, index) => offset + index);
      await Promise.all(batch.map((index) => createAchievement(serviceC.achievements, {
        title: `C pagination ${index + 1}`,
        achievedOn: `2026-06-${String(30 - (index % 20)).padStart(2, "0")}`,
        skillNames: ["Pagination Skill"],
      })));
    }
    const skills = await accountC.client.from("skills").select("id, name").eq("user_id", accountC.id).eq("normalized_name", "pagination skill").single();
    paginationSkillId = required(skills.data?.id, skills.error, "pagination skill");
  }, 120_000);

  afterAll(async () => {
    await accountA?.client.auth.signOut();
    await accountB?.client.auth.signOut();
    await accountC?.client.auth.signOut();
    for (const userId of createdUserIds) await admin?.auth.admin.deleteUser(userId);
  }, 120_000);

  it("returns owner-scoped Dashboard counts and executes its canonical filter links", async () => {
    async function collectAchievements(filters: Record<string, unknown>) {
      const pages: Awaited<ReturnType<AchievementService["listAchievements"]>>[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < 10; index += 1) {
        const page = await serviceA.achievements.listAchievements({ ...filters, ...(cursor ? { cursor } : {}) });
        pages.push(page);
        if (!page.nextCursor) return pages.flatMap((item) => item.items);
        cursor = page.nextCursor;
      }
      throw new Error("Dashboard achievement-link pagination exceeded the fixture bound.");
    }

    async function collectProjects(filters: Record<string, unknown>) {
      const pages: Awaited<ReturnType<ProjectService["listProjects"]>>[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < 10; index += 1) {
        const page = await serviceA.projects.listProjects({ ...filters, ...(cursor ? { cursor } : {}) });
        pages.push(page);
        if (!page.nextCursor) return pages.flatMap((item) => item.items);
        cursor = page.nextCursor;
      }
      throw new Error("Dashboard project-link pagination exceeded the fixture bound.");
    }

    const dashboard = await createDashboardService(accountA.client).getDashboard();
    expect(dashboard.summary).toEqual({
      confirmedAchievementCount: 5,
      activeProjectCount: 1,
      demonstratedSkillCount: 2,
      missingEvidenceCount: 4,
      completedMissingOutcomeCount: 1,
      hasCareerRecords: true,
    });
    expect(dashboard.skills.map(({ name, confirmedAchievementCount }) => ({ name, confirmedAchievementCount }))).toEqual([
      { name: "TypeScript", confirmedAchievementCount: 2 },
      { name: "SQL", confirmedAchievementCount: 1 },
    ]);
    expect(dashboard.recentActivities.map(({ raw_text }) => raw_text)).toEqual(["AC1", "AC2", "AC3", "AC4", "AC5"]);
    expect(dashboard.recentActivities[0]?.id).toBe(ownerAActivities[0]);
    expect(dashboard.recentActivities.some(({ id }) => id === ownerAActivities[6])).toBe(false);
    expect(dashboard.activeProjects.map(({ id }) => id)).toEqual([projectA.active]);

    const confirmedQuery = readAchievementQuery(new URL(dashboardLinks.confirmedAchievements(), "http://workpulse.test").searchParams);
    expect(confirmedQuery.isValid).toBe(true);
    const confirmedRows = await collectAchievements({ status: confirmedQuery.filters.status });
    expect(confirmedRows).toHaveLength(dashboard.summary.confirmedAchievementCount);
    expect(new Set(confirmedRows.map(({ achievement }) => achievement.id))).toEqual(new Set(Object.values(ownerAAchievements)));

    const activeParams = Object.fromEntries(new URL(dashboardLinks.activeProjects(), "http://workpulse.test").searchParams);
    const activeQuery = readProjectQuery(activeParams);
    expect(activeQuery.isValid).toBe(true);
    const activeRows = await collectProjects({ status: activeQuery.filters.status });
    expect(activeRows).toHaveLength(dashboard.summary.activeProjectCount);
    expect(activeRows.map(({ project }) => project.id)).toEqual([projectA.active]);

    const missingQuery = readAchievementQuery(new URL(dashboardLinks.missingEvidence(), "http://workpulse.test").searchParams);
    expect(missingQuery.isValid).toBe(true);
    const missingRows = await collectAchievements({
      status: missingQuery.filters.status,
      missingEvidence: missingQuery.filters.evidence === "missing" ? true : undefined,
    });
    expect(missingRows).toHaveLength(dashboard.summary.missingEvidenceCount);
    expect(new Set(missingRows.map(({ achievement }) => achievement.id))).toEqual(new Set([
      ownerAAchievements.c2,
      ownerAAchievements.c3,
      ownerAAchievements.c4,
      ownerAAchievements.c5,
    ]));

    for (const skill of dashboard.skills) {
      const skillQuery = readAchievementQuery(new URL(dashboardLinks.skill(skill.id), "http://workpulse.test").searchParams);
      expect(skillQuery.isValid).toBe(true);
      const skillRows = await collectAchievements({ status: skillQuery.filters.status, skillId: skillQuery.filters.skill });
      expect(skillRows).toHaveLength(skill.confirmedAchievementCount);
      if (skill.name === "TypeScript") {
        expect(skillRows.map(({ achievement }) => achievement.id).sort()).toEqual([ownerAAchievements.c1, ownerAAchievements.c2].sort());
      }
      if (skill.name === "SQL") expect(skillRows.map(({ achievement }) => achievement.id)).toEqual([ownerAAchievements.c1]);
    }

    const outcomeParams = Object.fromEntries(new URL(dashboardLinks.missingOutcome(), "http://workpulse.test").searchParams);
    const outcomeQuery = readProjectQuery(outcomeParams);
    expect(outcomeQuery.isValid).toBe(true);
    const outcomeRows = await collectProjects({
      status: outcomeQuery.filters.status,
      outcomeMissing: outcomeQuery.filters.outcome === "missing" ? true : undefined,
    });
    expect(outcomeRows).toHaveLength(dashboard.summary.completedMissingOutcomeCount);
    expect(outcomeRows.map(({ project }) => project.id)).toEqual([projectA.completed]);
    const dashboardB = await createDashboardService(accountB.client).getDashboard();
    expect(dashboardB.summary).toMatchObject({
      confirmedAchievementCount: 1,
      activeProjectCount: 1,
      demonstratedSkillCount: 1,
      missingEvidenceCount: 1,
      completedMissingOutcomeCount: 0,
    });
    expect(dashboardB.recentActivities.map(({ raw_text }) => raw_text)).toEqual(["Foreign activity"]);
    expect(dashboardB.activeProjects.map(({ id }) => id)).toEqual([foreignProjectId]);
  }, 60_000);

  it("groups canonical career events, precision dates, unknown dates, and owner-safe deep links", async () => {
    const timeline = await createTimelineService(accountA.client).getTimeline({ type: "", project: "" });
    const groupByYear = new Map(timeline.groups.map((group) => [group.key, group.events]));
    const titles = (year: string) => (groupByYear.get(year) ?? []).map((event) => event.title);
    expect(titles("2026")).toEqual(["C1 Project result", "C2 Standalone result"]);
    expect(titles("2025")).toEqual(["C4 Derived result", "Next initiative"]);
    expect(titles("2024")).toEqual(["Platform revamp"]);
    expect(titles("2023")).toEqual(["C5 Project result", "C3 Experience result", "Thesis prototype"]);
    expect(titles("2022")).toEqual(["Consultant"]);
    expect(titles("2021")).toEqual(["Analyst"]);
    expect(titles("2016")).toEqual(["S.Kom"]);
    expect(titles("undated")).toEqual(["Migration", "Certificate"]);
    expect(timeline.projectOptions.map(({ title }) => title)).toEqual(["Migration", "Next initiative", "Platform revamp", "Thesis prototype"]);

    const allEvents = timeline.groups.flatMap((group) => group.events);
    expect(allEvents.some((event) => event.title === "D1 Draft only" || event.title === "X1 Dismissed")).toBe(false);
    expect(allEvents.find((event) => event.id === ownerAAchievements.c1)?.href).toBe(`/achievements/${ownerAAchievements.c1}`);
    expect(allEvents.find((event) => event.id === ownerAAchievements.c1)?.context).toBe("Platform revamp");
    expect(allEvents.find((event) => event.id === ownerAAchievements.c2)?.context).toBeNull();
    expect(allEvents.find((event) => event.id === projectA.completed)?.context).toBeNull();
    expect(allEvents.find((event) => event.id === projectA.active)?.href).toBe(`/projects/${projectA.active}`);
    expect(allEvents.find((event) => event.title === "Analyst")?.href).toContain(`/settings/profile?record=`);
    expect(allEvents.find((event) => event.id === educationAId)?.href).toBe(`/settings/profile?record=${educationAId}#education-${educationAId}`);
    expect(allEvents.find((event) => event.title === "Analyst")?.start).toEqual({ date: "2021-03-01", precision: "month" });
    expect(allEvents.find((event) => event.title === "Consultant")?.isCurrent).toBe(true);

    const projectFiltered = await createTimelineService(accountA.client).getTimeline({ type: "achievement", project: projectA.active });
    expect(projectFiltered.groups.flatMap((group) => group.events).map((event) => event.id)).toEqual([ownerAAchievements.c1]);
    const foreignFiltered = await createTimelineService(accountA.client).getTimeline({ type: "", project: foreignProjectId });
    expect(foreignFiltered.groups).toEqual([]);
    expect(timeline.projectOptions.some(({ id }) => id === foreignProjectId)).toBe(false);
    expect(allEvents.some(({ id }) => [foreignExperienceId, foreignEducationId, foreignProjectId, foreignAchievementId].includes(id))).toBe(false);

    const timelineB = await createTimelineService(accountB.client).getTimeline({ type: "", project: "" });
    const eventsB = timelineB.groups.flatMap((group) => group.events);
    expect(new Set(eventsB.map(({ id }) => id))).toEqual(new Set([foreignExperienceId, foreignEducationId, foreignProjectId, foreignAchievementId]));
    expect(eventsB.some(({ id }) => [projectA.active, projectA.completed, ...Object.values(ownerAAchievements)].includes(id))).toBe(false);
    expect(ownerAActivities).toHaveLength(7);
    expect(foreignActivityId).toMatch(/^[0-9a-f-]{36}$/i);
  }, 60_000);

  it("paginates authenticated skill and missing-evidence filter results without owner leakage", async () => {
    async function collect(fetchPage: (cursor?: string) => ReturnType<AchievementService["listAchievements"]>) {
      const pages = [] as Awaited<ReturnType<AchievementService["listAchievements"]>>[];
      let cursor: string | undefined;
      for (let index = 0; index < 4; index += 1) {
        const page = await fetchPage(cursor);
        pages.push(page);
        if (!page.nextCursor) return pages;
        cursor = page.nextCursor;
      }
      throw new Error("Dashboard filter pagination exceeded the fixture bound.");
    }

    const pages = await collect((cursor) => serviceC.achievements.listAchievements({
      status: "confirmed",
      skillId: paginationSkillId,
      missingEvidence: true,
      ...(cursor ? { cursor } : {}),
    }));
    const ids = pages.flatMap((page) => page.items.map(({ achievement }) => achievement.id));
    expect(pages).toHaveLength(2);
    expect(pages[0]?.items).toHaveLength(30);
    expect(pages[1]?.items).toHaveLength(1);
    expect(new Set(ids).size).toBe(31);
    expect(pages.flatMap((page) => page.items).every(({ achievement }) => achievement.user_id === accountC.id)).toBe(true);
    expect((await serviceA.achievements.listAchievements({ projectId: foreignProjectId })).items).toEqual([]);

    const anonymous = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    await expect(createDashboardService(anonymous).getDashboard()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(createTimelineService(anonymous).getTimeline({ type: "", project: "" })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await anonymous.auth.signOut();
  }, 60_000);

  it("updates check counts immediately after evidence becomes ready and an achievement is reopened", async () => {
    const dashboardService = createDashboardService(accountA.client);
    const c3Id = required(ownerAAchievements.c3, null, "C3 id");
    const c1Id = required(ownerAAchievements.c1, null, "C1 id");
    expect((await dashboardService.getDashboard()).summary.missingEvidenceCount).toBe(4);

    const c3 = await serviceA.achievements.getAchievement(c3Id);
    await addEvidence(accountA.id, "achievement", c3Id, c3.achievement.revision, true);
    const afterReady = await dashboardService.getDashboard();
    expect(afterReady.summary.missingEvidenceCount).toBe(3);

    const c1 = await serviceA.achievements.getAchievement(c1Id);
    const reopened = await serviceA.achievements.saveAchievement({
      achievementId: c1Id,
      expectedRevision: c1.achievement.revision,
      action: "reopen",
      changes: {
        title: c1.achievement.title ?? "",
        contribution: c1.achievement.contribution ?? "",
        scope: c1.achievement.scope ?? "",
        outcome: c1.achievement.outcome ?? "",
        cvBullet: c1.achievement.cv_bullet ?? "",
        achievedOn: c1.achievement.achieved_on,
        metrics: c1.achievement.metrics,
      },
      skillNames: c1.skills.map((skill) => skill.name),
    });
    expect(reopened.status).toBe("draft");

    const afterReopen = await dashboardService.getDashboard();
    expect(afterReopen.summary.confirmedAchievementCount).toBe(4);
    expect(afterReopen.summary.demonstratedSkillCount).toBe(1);
    expect(afterReopen.summary.missingEvidenceCount).toBe(3);
    expect(afterReopen.skills.map(({ name, confirmedAchievementCount }) => ({ name, confirmedAchievementCount }))).toEqual([
      { name: "TypeScript", confirmedAchievementCount: 1 },
    ]);
    const confirmedQuery = readAchievementQuery(new URL(dashboardLinks.confirmedAchievements(), "http://workpulse.test").searchParams);
    const confirmed = await serviceA.achievements.listAchievements({ status: confirmedQuery.filters.status });
    expect(confirmed.items).toHaveLength(afterReopen.summary.confirmedAchievementCount);
    expect(confirmed.items.some(({ achievement }) => achievement.id === c1Id)).toBe(false);
  }, 60_000);
});
