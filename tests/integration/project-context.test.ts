import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createActivityService } from "@/features/activity/activity-service";
import { ProjectServiceError, createProjectService } from "@/features/project/project-service";
import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";

type Client = SupabaseClient<Database>;

let admin: Client | null = null;
let owner: Client | null = null;
let ownerConcurrent: Client | null = null;
let other: Client | null = null;
let ownerId = "";
let otherId = "";
let ownerEmail = "";
let ownerPassword = "";
let otherEmail = "";
let otherPassword = "";
let ownerProjects: ReturnType<typeof createProjectService> | null = null;
let otherProjects: ReturnType<typeof createProjectService> | null = null;
let ownerActivities: ReturnType<typeof createActivityService> | null = null;
let experienceOneId = "";
let experienceTwoId = "";
let foreignProjectId = "";

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error("Project integration setup failed: " + label);
  return value;
}

function projectInput(title: string, experienceId: string | null = null, status: "planned" | "active" | "completed" = "active") {
  return {
    operationKey: randomUUID(),
    title,
    description: null,
    userRole: null,
    outcome: null,
    status,
    experienceId,
    startDate: null,
    startPrecision: null,
    endDate: null,
    endPrecision: null,
    isCurrent: false,
  };
}

describe("local Project and context propagation integration", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    const publicConfig = getSupabasePublicConfig();
    if (!adminConfig || !publicConfig) throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");

    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const suffix = randomUUID().replaceAll("-", "");
    ownerEmail = `project-owner-${suffix}@workpulse.test`;
    otherEmail = `project-other-${suffix}@workpulse.test`;
    ownerPassword = randomBytes(18).toString("base64url") + "Aa1!";
    otherPassword = randomBytes(18).toString("base64url") + "Bb2!";

    const ownerCreated = await admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true, user_metadata: { display_name: "Project owner" } });
    ownerId = required(ownerCreated.data.user?.id, ownerCreated.error, "owner creation");
    const otherCreated = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true, user_metadata: { display_name: "Project other" } });
    otherId = required(otherCreated.data.user?.id, otherCreated.error, "other creation");

    owner = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    ownerConcurrent = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    other = createClient<Database>(publicConfig.url, publicConfig.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
    const ownerSignIn = await owner.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    required(ownerSignIn.data.user, ownerSignIn.error, "owner sign-in");
    const ownerConcurrentSignIn = await ownerConcurrent.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    required(ownerConcurrentSignIn.data.user, ownerConcurrentSignIn.error, "concurrent owner sign-in");
    const otherSignIn = await other.auth.signInWithPassword({ email: otherEmail, password: otherPassword });
    required(otherSignIn.data.user, otherSignIn.error, "other sign-in");

    const experienceOne = await admin.from("experiences").insert({ user_id: ownerId, organization: "Project integration", role_title: "Original context", kind: "employment" }).select("id").single();
    experienceOneId = required(experienceOne.data?.id, experienceOne.error, "first Experience");
    const experienceTwo = await admin.from("experiences").insert({ user_id: ownerId, organization: "Project integration", role_title: "Updated context", kind: "volunteer" }).select("id").single();
    experienceTwoId = required(experienceTwo.data?.id, experienceTwo.error, "second Experience");

    ownerProjects = createProjectService(owner);
    otherProjects = createProjectService(other);
    ownerActivities = createActivityService(owner);
  });

  afterAll(async () => {
    await owner?.auth.signOut();
    await ownerConcurrent?.auth.signOut();
    await other?.auth.signOut();
    if (admin) {
      if (ownerId) await admin.auth.admin.deleteUser(ownerId);
      if (otherId) await admin.auth.admin.deleteUser(otherId);
    }
  });

  it("creates standalone and completed Projects with stable idempotent receipts", async () => {
    if (!ownerProjects) throw new Error("Project service unavailable");
    const input = {
      ...projectInput("Completed graduate project", null, "completed"),
      operationKey: randomUUID(),
      endDate: "2024-06-01",
      endPrecision: "month" as const,
    };
    const first = await ownerProjects.createProject(input);
    const replay = await ownerProjects.createProject(input);
    expect(first).toEqual(replay);
    expect(first.revision).toBe(1);
    await expect(ownerProjects.createProject({ ...input, title: "Changed retry payload" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const detail = await ownerProjects.getProject(first.projectId);
    expect(detail.project.experience_id).toBeNull();
    expect(detail.project.outcome).toBeNull();
    expect(detail.project.status).toBe("completed");
    expect(detail.project.is_current).toBe(false);
    expect(detail.project.end_date).toBe("2024-06-01");
    expect(detail.project.end_precision).toBe("month");

    const updated = await ownerProjects.updateProject({
      projectId: first.projectId,
      expectedRevision: detail.project.revision,
      title: detail.project.title,
      description: detail.project.description,
      userRole: detail.project.user_role,
      outcome: detail.project.outcome,
      status: "completed",
      experienceId: null,
      startDate: detail.project.start_date,
      startPrecision: detail.project.start_precision,
      endDate: "2024-06-15",
      endPrecision: "day",
      isCurrent: false,
    });
    expect(updated.is_current).toBe(false);
    expect(updated.end_date).toBe("2024-06-15");
    expect(updated.end_precision).toBe("day");
  });

  it("replays the original receipt after its Experience is deleted", async () => {
    if (!ownerProjects || !owner) throw new Error("Project service unavailable");
    const experience = await admin!.from("experiences").insert({ user_id: ownerId, organization: "Replay context", role_title: "Deleted context", kind: "employment" }).select("id, revision").single();
    const replayExperienceId = required(experience.data?.id, experience.error, "replay Experience");
    const input = { ...projectInput("Replay after deleted Experience", replayExperienceId), operationKey: randomUUID() };
    const first = await ownerProjects.createProject(input);
    const deleted = await owner.rpc("delete_experience", { p_experience_id: replayExperienceId, p_expected_revision: experience.data?.revision ?? 1 });
    required(deleted.data?.[0], deleted.error, "replay Experience deletion");
    await expect(ownerProjects.createProject(input)).resolves.toEqual(first);
    await expect(ownerProjects.createProject({ ...input, title: "Changed replay payload" })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("lists 31 owned Projects with a stable cursor and no foreign rows", async () => {
    if (!ownerProjects || !otherProjects) throw new Error("Project service unavailable");
    const created = await Promise.all(Array.from({ length: 31 }, (_, index) => ownerProjects!.createProject(projectInput(`Pagination project ${index}`))));
    const first = await ownerProjects.listProjects();
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const second = await ownerProjects.listProjects({ cursor: first.nextCursor ?? undefined });
    expect(second.items).toHaveLength(3);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.project.id)).size).toBeGreaterThanOrEqual(31);
    expect(created.every((receipt) => receipt.userId === ownerId)).toBe(true);
    const foreign = await otherProjects.createProject(projectInput("Foreign project"));
    foreignProjectId = foreign.projectId;
    expect((await ownerProjects.listProjects()).items.some((item) => item.project.id === foreign.projectId)).toBe(false);
  });

  it("derives context on attach, preserves it on detach, propagates Project edits, and deletes with a receipt", async () => {
    if (!ownerProjects || !ownerActivities) throw new Error("Project service unavailable");
    const projectA = await ownerProjects.createProject(projectInput("Context A", experienceOneId));
    const projectB = await ownerProjects.createProject(projectInput("Context B", experienceTwoId));

    const activity = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "chat",
      rawText: "Project context integration source",
      occurredOn: "2026-09-20",
      experienceId: experienceOneId,
      projectId: null,
    });
    const attached = await ownerProjects.relinkActivity({ activityId: activity.activityId, expectedRevision: 1, projectId: projectB.projectId });
    expect(attached.project_id).toBe(projectB.projectId);
    expect(attached.experience_id).toBe(experienceTwoId);
    expect(attached.revision).toBe(2);
    const detached = await ownerProjects.relinkActivity({ activityId: activity.activityId, expectedRevision: 2, projectId: null });
    expect(detached.project_id).toBeNull();
    expect(detached.experience_id).toBe(experienceTwoId);
    expect(detached.revision).toBe(3);

    const linked = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: "Linked Project source",
      occurredOn: "2026-09-19",
      experienceId: experienceOneId,
      projectId: projectA.projectId,
    });
    const current = await ownerProjects.getProject(projectA.projectId);
    const updated = await ownerProjects.updateProject({
      projectId: projectA.projectId,
      expectedRevision: current.project.revision,
      title: current.project.title,
      description: current.project.description,
      userRole: current.project.user_role,
      outcome: current.project.outcome,
      status: current.project.status,
      experienceId: experienceTwoId,
      startDate: current.project.start_date,
      startPrecision: current.project.start_precision,
      endDate: current.project.end_date,
      endPrecision: current.project.end_precision,
      isCurrent: current.project.is_current,
    });
    expect(updated.revision).toBe(2);
    const propagated = await ownerActivities.getActivity(linked.activityId);
    expect(propagated.activity.experience_id).toBe(experienceTwoId);
    expect(propagated.activity.revision).toBe(2);

    const receipt = await ownerProjects.deleteProject({ projectId: projectA.projectId, expectedRevision: updated.revision });
    expect(receipt).toEqual({ deletedProjectId: projectA.projectId, releasedActivityCount: 1, releasedAchievementCount: 0 });
    const afterDelete = await ownerActivities.getActivity(linked.activityId);
    expect(afterDelete.activity.project_id).toBeNull();
    expect(afterDelete.activity.experience_id).toBe(experienceTwoId);
    expect(afterDelete.activity.revision).toBe(3);
  });

  it("returns an actionable conflict and hides foreign relink targets", async () => {
    if (!ownerProjects || !ownerActivities) throw new Error("Project service unavailable");
    const project = await ownerProjects.createProject(projectInput("Conflict project", experienceOneId));
    const first = await ownerProjects.updateProject({
      projectId: project.projectId,
      expectedRevision: 1,
      title: "Conflict project updated",
      description: null,
      userRole: null,
      outcome: null,
      status: "active",
      experienceId: experienceOneId,
      startDate: null,
      startPrecision: null,
      endDate: null,
      endPrecision: null,
      isCurrent: false,
    });
    expect(first.revision).toBe(2);
    await expect(ownerProjects.updateProject({
      projectId: project.projectId,
      expectedRevision: 1,
      title: "Stale write",
      description: null,
      userRole: null,
      outcome: null,
      status: "active",
      experienceId: experienceOneId,
      startDate: null,
      startPrecision: null,
      endDate: null,
      endPrecision: null,
      isCurrent: false,
    })).rejects.toMatchObject({ code: "CONFLICT", latestRecord: { revision: 2 } });

    const activity = await ownerActivities.createActivity({ operationKey: randomUUID(), captureMode: "note", rawText: "Foreign relink source", occurredOn: "2026-09-18" });
    await expect(ownerProjects.relinkActivity({ activityId: activity.activityId, expectedRevision: 1, projectId: foreignProjectId })).rejects.toBeInstanceOf(ProjectServiceError);
    await expect(ownerProjects.relinkActivity({ activityId: activity.activityId, expectedRevision: 1, projectId: foreignProjectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters the target Project before limiting and paginates all eligible candidates", async () => {
    if (!ownerProjects || !ownerActivities) throw new Error("Project service unavailable");
    const target = await ownerProjects.createProject(projectInput("Candidate target", experienceOneId));
    await Promise.all(Array.from({ length: 101 }, (_, index) => ownerActivities!.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: `Target-linked candidate ${index}`,
      occurredOn: "2026-09-20",
      experienceId: experienceOneId,
      projectId: target.projectId,
    })));
    const eligible = await Promise.all(Array.from({ length: 31 }, (_, index) => ownerActivities!.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: `Eligible candidate ${index}`,
      occurredOn: "2026-09-19",
      experienceId: experienceOneId,
      projectId: null,
    })));

    const first = await ownerProjects.listRelinkCandidates(target.projectId);
    expect(first.items).toHaveLength(30);
    expect(first.items.every((item) => item.project_id !== target.projectId)).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    const second = await ownerProjects.listRelinkCandidates(target.projectId, { cursor: first.nextCursor });
    expect(second.nextCursor).toBeNull();
    const allCandidateIds = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(allCandidateIds.size).toBeGreaterThanOrEqual(31);
    expect(first.items.every((item) => item.project_id !== target.projectId)).toBe(true);
    expect(second.items.every((item) => item.project_id !== target.projectId)).toBe(true);
    for (const activity of eligible) expect(allCandidateIds.has(activity.activityId)).toBe(true);
  });

  it("completes concurrent Project context edit and Experience delete without a deadlock", async () => {
    if (!owner || !ownerConcurrent || !ownerProjects || !ownerActivities || !admin) throw new Error("Project integration setup unavailable");
    for (let index = 0; index < 4; index += 1) {
      const experience = await admin.from("experiences").insert({ user_id: ownerId, organization: `Race context ${index}`, role_title: "Concurrent context", kind: "employment" }).select("id, revision").single();
      const experienceId = required(experience.data?.id, experience.error, `race Experience ${index}`);
      const experienceRevision = experience.data?.revision ?? 1;
      const project = await ownerProjects.createProject(projectInput(`Race project ${index}`, experienceId));
      const activity = await ownerActivities.createActivity({
        operationKey: randomUUID(),
        captureMode: "note",
        rawText: `Race activity ${index}`,
        occurredOn: "2026-09-20",
        experienceId,
        projectId: project.projectId,
      });

      const updatePromise = owner.rpc("update_project", {
        p_project_id: project.projectId,
        p_expected_revision: 1,
        p_changes: { experience_id: null, title: `Race project ${index} updated` },
      });
      const deletePromise = ownerConcurrent.rpc("delete_experience", {
        p_experience_id: experienceId,
        p_expected_revision: experienceRevision,
      });
      const [updated, deleted] = await Promise.race([
        Promise.all([updatePromise, deletePromise]),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Project/Experience concurrency exceeded timeout")), 5_000)),
      ]);

      expect(updated.error?.code).not.toBe("40P01");
      expect(updated.error?.message ?? "").not.toContain("deadlock");
      expect(deleted.error?.code).not.toBe("40P01");
      expect(deleted.error?.message ?? "").not.toContain("deadlock");

      const finalProject = await owner.from("projects").select("experience_id").eq("id", project.projectId).single();
      expect(finalProject.error).toBeNull();
      expect(finalProject.data?.experience_id).toBeNull();
      const finalActivity = await owner.from("activities").select("experience_id, project_id").eq("id", activity.activityId).single();
      expect(finalActivity.error).toBeNull();
      expect(finalActivity.data?.project_id).toBe(project.projectId);
      expect(finalActivity.data?.experience_id).toBeNull();
    }
  });
});
