import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { createProjectService } from "@/features/project/project-service";

type Client = SupabaseClient<Database>;
let admin: Client;
let owner: Client;
let ownerConcurrent: Client;
let other: Client;
let ownerId = "";
let otherId = "";
let ownerAchievements: ReturnType<typeof createAchievementService>;
let concurrentAchievements: ReturnType<typeof createAchievementService>;
let ownerActivities: ReturnType<typeof createActivityService>;
let otherAchievements: ReturnType<typeof createAchievementService>;
let ownerExperienceId = "";
let ownerProjectId = "";

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`Achievement integration setup failed: ${label}`);
  return value;
}

describe("local Achievement and Skills lifecycle integration", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    const publicConfig = getSupabasePublicConfig();
    if (!adminConfig || !publicConfig) throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const suffix = randomUUID().replaceAll("-", "");
    const ownerEmail = `achievement-owner-${suffix}@workpulse.test`;
    const otherEmail = `achievement-other-${suffix}@workpulse.test`;
    const password = randomBytes(18).toString("base64url") + "Aa1!";
    const otherPassword = randomBytes(18).toString("base64url") + "Bb2!";
    ownerId = required((await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true })).data.user?.id, null, "owner");
    otherId = required((await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true })).data.user?.id, null, "other");
    owner = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    ownerConcurrent = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    other = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const [ownerSignIn, concurrentSignIn, otherSignIn] = await Promise.all([
      owner.auth.signInWithPassword({ email: ownerEmail, password }),
      ownerConcurrent.auth.signInWithPassword({ email: ownerEmail, password }),
      other.auth.signInWithPassword({ email: otherEmail, password: otherPassword }),
    ]);
    required(ownerSignIn.data.user, ownerSignIn.error, "owner sign-in");
    required(concurrentSignIn.data.user, concurrentSignIn.error, "concurrent sign-in");
    required(otherSignIn.data.user, otherSignIn.error, "other sign-in");
    const experience = await admin.from("experiences").insert({ user_id: ownerId, organization: "Achievement integration", role_title: "Builder", kind: "employment" }).select("id").single();
    ownerExperienceId = required(experience.data?.id, experience.error, "Experience");
    const project = await createProjectService(owner).createProject({ operationKey: randomUUID(), title: "Achievement project", description: null, userRole: null, outcome: null, status: "active", experienceId: ownerExperienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
    ownerProjectId = project.projectId;
    ownerAchievements = createAchievementService(owner);
    concurrentAchievements = createAchievementService(ownerConcurrent);
    otherAchievements = createAchievementService(other);
    ownerActivities = createActivityService(owner);
  });

  afterAll(async () => {
    await owner?.auth.signOut();
    await ownerConcurrent?.auth.signOut();
    await other?.auth.signOut();
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
  });

  it("creates, replays, saves, confirms, and counts normalized skill labels", async () => {
    const input = { operationKey: randomUUID(), activityId: null, projectId: null, experienceId: ownerExperienceId };
    const created = await ownerAchievements.createAchievement(input);
    expect(await ownerAchievements.createAchievement(input)).toEqual(created);
    await expect(ownerAchievements.createAchievement({ ...input, projectId: ownerProjectId })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    const draft = await ownerAchievements.saveAchievement({
      achievementId: created.achievementId,
      expectedRevision: 1,
      action: "save_draft",
      changes: { title: "Manual achievement", contribution: "Built a reliable flow", scope: "", outcome: "Reduced rework", cvBullet: "", achievedOn: "2026-09-20", metrics: [] },
      skillNames: ["SQL", "Product operations"],
    });
    expect(draft.revision).toBe(2);
    const confirmed = await ownerAchievements.saveAchievement({
      achievementId: created.achievementId,
      expectedRevision: draft.revision,
      action: "confirm",
      changes: { title: draft.title ?? "", contribution: draft.contribution ?? "", scope: draft.scope ?? "", outcome: draft.outcome ?? "", cvBullet: "", achievedOn: draft.achieved_on, metrics: [] },
      skillNames: ["sql", "Product operations"],
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.cv_bullet).toBe("Built a reliable flow. Reduced rework");
    const detail = await ownerAchievements.getAchievement(created.achievementId);
    expect(detail.skills.map((skill) => skill.name).sort()).toEqual(["Product operations", "SQL"]);
    expect(detail.skills.every((skill) => skill.demonstratedCount === 1)).toBe(true);

    const candidates = await ownerAchievements.listRelinkCandidates(ownerProjectId);
    const standaloneCandidate = candidates.items.find((item) => item.achievement.id === created.achievementId);
    expect(standaloneCandidate?.currentProjectTitle).toBeNull();
    const attached = await ownerAchievements.relinkAchievement({ achievementId: created.achievementId, expectedRevision: confirmed.revision, projectId: ownerProjectId });
    expect(attached.project_id).toBe(ownerProjectId);
    expect(attached.revision).toBe(confirmed.revision + 1);
    expect((await ownerAchievements.listRelinkCandidates(ownerProjectId)).items.some((item) => item.achievement.id === created.achievementId)).toBe(false);
    const detached = await ownerAchievements.relinkAchievement({ achievementId: created.achievementId, expectedRevision: attached.revision, projectId: null });
    expect(detached.project_id).toBeNull();
    expect(detached.experience_id).toBe(ownerExperienceId);

    const deletionProject = await createProjectService(owner).createProject({ operationKey: randomUUID(), title: "Achievement deletion project", description: null, userRole: null, outcome: null, status: "active", experienceId: ownerExperienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
    const deletionAchievement = await ownerAchievements.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: deletionProject.projectId, experienceId: null });
    const deletionReceipt = await createProjectService(owner).deleteProject({ projectId: deletionProject.projectId, expectedRevision: deletionProject.revision });
    expect(deletionReceipt).toEqual({ deletedProjectId: deletionProject.projectId, releasedActivityCount: 0, releasedAchievementCount: 1 });
    expect((await ownerAchievements.getAchievement(deletionAchievement.achievementId)).achievement.project_id).toBeNull();
  });

  it("rejects blank metric values before mutation and confirms a qualitative achievement without metrics", async () => {
    const created = await ownerAchievements.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: null, experienceId: null });
    await expect(ownerAchievements.saveAchievement({
      achievementId: created.achievementId,
      expectedRevision: 1,
      action: "save_draft",
      changes: { title: "Metric draft", contribution: "Recorded a blank metric", scope: "", outcome: "", cvBullet: "", achievedOn: null, metrics: [{ label: "People", value: "" as unknown as number, unit: "people" }] },
      skillNames: [],
    })).rejects.toMatchObject({ code: "VALIDATION" });
    const unchanged = await owner.from("achievements").select("revision, metrics").eq("user_id", ownerId).eq("id", created.achievementId).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toMatchObject({ revision: 1, metrics: [] });

    const confirmed = await ownerAchievements.saveAchievement({
      achievementId: created.achievementId,
      expectedRevision: 1,
      action: "confirm",
      changes: { title: "Qualitative result", contribution: "Built a manual review flow", scope: "", outcome: "The team had a clearer record", cvBullet: "", achievedOn: "2026-09-24", metrics: [] },
      skillNames: [],
    });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.metrics).toEqual([]);
  });

  it("paginates dated and NULL-date achievements without gaps, duplicates, or cross-owner candidates", async () => {
    const projectService = createProjectService(owner);
    const targetProject = await projectService.createProject({ operationKey: randomUUID(), title: "Pagination target", description: null, userRole: null, outcome: null, status: "active", experienceId: ownerExperienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
    const mixedProject = await projectService.createProject({ operationKey: randomUUID(), title: "Mixed date fixtures", description: null, userRole: null, outcome: null, status: "active", experienceId: ownerExperienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
    const nullOnlyProject = await projectService.createProject({ operationKey: randomUUID(), title: "Unknown date fixtures", description: null, userRole: null, outcome: null, status: "active", experienceId: ownerExperienceId, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
    const otherProject = await createProjectService(other).createProject({ operationKey: randomUUID(), title: "Other account target", description: null, userRole: null, outcome: null, status: "active", experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });

    type Fixture = { title: string; achieved_on: string | null; project_id: string | null; status: "draft" | "dismissed" };
    const fixtures: Fixture[] = [];
    const addRow = (title: string, achievedOn: string | null, projectId: string | null, status: "draft" | "dismissed" = "draft") => {
      fixtures.push({ title, achieved_on: achievedOn, project_id: projectId, status });
    };
    for (let index = 1; index <= 35; index += 1) {
      const day = String(20 - Math.floor((index - 1) / 5)).padStart(2, "0");
      addRow(`Dated mixed ${index}`, `2026-09-${day}`, mixedProject.projectId, index % 2 ? "draft" : "dismissed");
    }
    for (let index = 1; index <= 35; index += 1) {
      addRow(`Unknown mixed ${index}`, null, mixedProject.projectId, index % 2 ? "draft" : "dismissed");
    }
    for (let index = 1; index <= 32; index += 1) {
      addRow(`Unknown only ${index}`, null, nullOnlyProject.projectId);
    }
    for (let index = 1; index <= 35; index += 1) {
      addRow(`Target linked ${index}`, "2030-01-01", targetProject.projectId);
    }
    async function createFixture(fixture: Fixture) {
      const created = await ownerAchievements.createAchievement({
        operationKey: randomUUID(),
        activityId: null,
        projectId: fixture.project_id,
        experienceId: fixture.project_id ? null : ownerExperienceId,
      });
      await ownerAchievements.saveAchievement({
        achievementId: created.achievementId,
        expectedRevision: created.revision,
        action: fixture.status === "dismissed" ? "dismiss" : "save_draft",
        changes: { title: fixture.title, contribution: "", scope: "", outcome: "", cvBullet: "", achievedOn: fixture.achieved_on, metrics: [] },
        skillNames: [],
      });
      return { ...fixture, id: created.achievementId };
    }
    const rows: Array<Fixture & { id: string }> = [];
    for (let offset = 0; offset < fixtures.length; offset += 10) {
      rows.push(...await Promise.all(fixtures.slice(offset, offset + 10).map(createFixture)));
    }

    const foreign = await otherAchievements.createAchievement({ operationKey: randomUUID(), activityId: null, projectId: otherProject.projectId, experienceId: null });
    const foreignId = foreign.achievementId;

    async function collect<T extends { nextCursor: string | null }>(fetchPage: (cursor?: string) => Promise<T>): Promise<T[]> {
      const pages: T[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < 10; index += 1) {
        const page = await fetchPage(cursor);
        pages.push(page);
        if (!page.nextCursor) return pages;
        cursor = page.nextCursor;
      }
      throw new Error("Achievement pagination exceeded its fixture bound.");
    }
    const idOrder = (left: { id: string; achieved_on: string | null }, right: { id: string; achieved_on: string | null }) => {
      if (left.achieved_on === null && right.achieved_on !== null) return 1;
      if (left.achieved_on !== null && right.achieved_on === null) return -1;
      if (left.achieved_on !== right.achieved_on) return (right.achieved_on ?? "").localeCompare(left.achieved_on ?? "");
      return right.id.localeCompare(left.id);
    };
    const storedResult = await owner.from("achievements").select("id, achieved_on, status, project_id").eq("user_id", ownerId);
    const stored = required(storedResult.data, storedResult.error, "pagination fixture read").sort(idOrder);
    const allPages = await collect((cursor) => ownerAchievements.listAchievements(cursor ? { cursor } : {}));
    const allIds = allPages.flatMap((page) => page.items.map((item) => item.achievement.id));
    expect(allIds).toEqual(stored.map((row) => row.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    const nullIds = new Set(rows.filter((row) => row.achieved_on === null).map((row) => row.id));
    expect(allIds.filter((id) => nullIds.has(id))).toHaveLength(nullIds.size);

    const mixedRows = stored.filter((row) => row.project_id === mixedProject.projectId);
    const firstMixedPage = await ownerAchievements.listAchievements({ projectId: mixedProject.projectId });
    const datedCursorId = firstMixedPage.items.at(-1)?.achievement.id;
    expect(firstMixedPage.items).toHaveLength(30);
    expect(datedCursorId).toBeTruthy();
    expect(mixedRows.some((row) => row.achieved_on === null && row.id > (datedCursorId ?? ""))).toBe(true);
    const mixedPages = await collect((cursor) => ownerAchievements.listAchievements({ projectId: mixedProject.projectId, ...(cursor ? { cursor } : {}) }));
    expect(mixedPages.flatMap((page) => page.items.map((item) => item.achievement.id))).toEqual(mixedRows.map((row) => row.id));
    expect(mixedPages.some((page) => page.items.some((item) => item.achievement.achieved_on === null))).toBe(true);
    expect(mixedPages[1]?.items.some((item) => item.achievement.achieved_on !== null) && mixedPages[1]?.items.some((item) => item.achievement.achieved_on === null)).toBe(true);

    const dismissedRows = stored.filter((row) => row.status === "dismissed");
    const dismissedPages = await collect((cursor) => ownerAchievements.listAchievements({ status: "dismissed", ...(cursor ? { cursor } : {}) }));
    expect(dismissedPages.flatMap((page) => page.items.map((item) => item.achievement.id))).toEqual(dismissedRows.map((row) => row.id));
    const nullOnlyRows = stored.filter((row) => row.project_id === nullOnlyProject.projectId);
    const nullOnlyPages = await collect((cursor) => ownerAchievements.listAchievements({ projectId: nullOnlyProject.projectId, ...(cursor ? { cursor } : {}) }));
    expect(nullOnlyPages.flatMap((page) => page.items.map((item) => item.achievement.id))).toEqual(nullOnlyRows.map((row) => row.id));
    expect(nullOnlyPages.flatMap((page) => page.items).every((item) => item.achievement.achieved_on === null)).toBe(true);

    const candidatePages = await collect((cursor) => ownerAchievements.listRelinkCandidates(targetProject.projectId, cursor ? { cursor } : {}));
    const candidateIds = candidatePages.flatMap((page) => page.items.map((item) => item.achievement.id));
    expect(candidateIds).toEqual(stored.filter((row) => row.project_id !== targetProject.projectId).map((row) => row.id));
    expect(candidateIds).not.toContain(foreignId);
    expect(candidatePages.flatMap((page) => page.items).every((item) => item.currentProjectTitle !== "Pagination target")).toBe(true);
    expect((await createAchievementService(other).listRelinkCandidates(otherProject.projectId)).items).toEqual([]);
    await expect(ownerAchievements.listAchievements({ cursor: "malformed" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(ownerAchievements.listRelinkCandidates(targetProject.projectId, { cursor: "malformed" })).rejects.toMatchObject({ code: "VALIDATION" });
  }, 120_000);

  it("allows only one derived Achievement when two sessions race", async () => {
    const activity = await ownerActivities.createActivity({ operationKey: randomUUID(), captureMode: "note", rawText: "Race source", occurredOn: "2026-09-19", experienceId: ownerExperienceId, projectId: ownerProjectId });
    const results = await Promise.allSettled([
      ownerAchievements.createAchievement({ operationKey: randomUUID(), activityId: activity.activityId, projectId: null, experienceId: null }),
      concurrentAchievements.createAchievement({ operationKey: randomUUID(), activityId: activity.activityId, projectId: null, experienceId: null }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(AchievementServiceError);
    const rows = await owner.from("achievements").select("id").eq("activity_id", activity.activityId);
    expect(rows.error).toBeNull();
    expect(rows.data).toHaveLength(1);
  });

  it("marks source changes and retains provenance after Activity deletion", async () => {
    const activity = await ownerActivities.createActivity({ operationKey: randomUUID(), captureMode: "note", rawText: "Original source wording", occurredOn: "2026-09-18", experienceId: ownerExperienceId, projectId: ownerProjectId });
    const derived = await ownerAchievements.createAchievement({ operationKey: randomUUID(), activityId: activity.activityId, projectId: null, experienceId: null });
    await ownerActivities.updateActivity({ activityId: activity.activityId, expectedRevision: 1, rawText: "Edited current wording", occurredOn: "2026-09-18", role: null, scope: null, outcome: null, experienceId: ownerExperienceId, projectId: ownerProjectId });
    const changed = await ownerAchievements.getAchievement(derived.achievementId);
    expect(changed.activity?.revision).toBe(2);
    expect(changed.achievement.source_activity_revision).toBe(1);
    await ownerActivities.deleteActivity({ activityId: activity.activityId, expectedRevision: 2 });
    const retained = await ownerAchievements.getAchievement(derived.achievementId);
    expect(retained.activity).toBeNull();
    expect(retained.achievement.source_excerpt).toBe("Original source wording");
    expect(await ownerAchievements.getAchievement(derived.achievementId)).toEqual(retained);
    await expect(ownerActivities.getActivity(activity.activityId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherAchievements.getAchievement(derived.achievementId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ownerId).not.toBe(otherId);
  });
});
