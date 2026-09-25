import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type TestUser = { id: string; email: string; password: string };
type ProjectCreateArgs = Database["public"]["Functions"]["create_project_idempotent"]["Args"];
type ActivityCreateArgs = Database["public"]["Functions"]["create_activity_idempotent"]["Args"];
type AchievementCreateArgs = Database["public"]["Functions"]["create_achievement_idempotent"]["Args"];
type AchievementSaveArgs = Database["public"]["Functions"]["save_achievement"]["Args"];

function config(): { url: string; publicKey: string; secretKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !publicKey || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, publicKey, secretKey };
}

function client(url: string, key: string): Client {
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

async function createUser(admin: Client, label: string): Promise<TestUser> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `projects-ui-${suffix}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: label } });
  if (created.error || !created.data.user) throw new Error("Local Project UI user setup failed.");
  const profile = await admin.from("profiles").update({ display_name: label, locale: "en", timezone: "Asia/Bangkok", onboarding_completed_at: new Date().toISOString() }).eq("id", created.data.user.id);
  if (profile.error) throw new Error("Local Project UI profile setup failed.");
  return { id: created.data.user.id, email, password };
}

async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function saveAchievementCandidate(clientForUser: Client, id: string, revision: number, title: string, achievedOn: string | null): Promise<number> {
  const saved = await clientForUser.rpc("save_achievement", {
    p_achievement_id: id,
    p_expected_revision: revision,
    p_action: "save_draft",
    p_changes: { title, contribution: "", scope: "", outcome: "", cv_bullet: "", achieved_on: achievedOn, metrics: [] },
    p_skill_names: [],
  } as unknown as AchievementSaveArgs);
  const row = saved.data?.[0];
  if (saved.error || !row) throw new Error("Achievement candidate save setup failed.");
  return row.revision;
}

async function createAchievementCandidate(clientForUser: Client, title: string, achievedOn: string | null): Promise<{ id: string; revision: number }> {
  const created = await clientForUser.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(),
    p_activity_id: null,
    p_project_id: null,
    p_experience_id: null,
  } as unknown as AchievementCreateArgs);
  const row = created.data?.[0];
  if (created.error || !row?.achievement_id) throw new Error("Achievement candidate create setup failed.");
  const revision = await saveAchievementCandidate(clientForUser, row.achievement_id, row.revision, title, achievedOn);
  return { id: row.achievement_id, revision };
}

test("Projects create, context prefill, completed warning, and dependency delete work", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(360_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const publicClient = client(values.url, values.publicKey);
  const user = await createUser(admin, "Projects UI owner");
  let experienceId = "";

  try {
    const experience = await admin.from("experiences").insert({ user_id: user.id, organization: "Projects UI Studio", role_title: "Product engineer", kind: "employment" }).select("id").single();
    if (experience.error || !experience.data) throw new Error("Local Project UI Experience setup failed.");
    experienceId = experience.data.id;
    const signInResult = await publicClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signInResult.error) throw new Error("Local Project UI sign-in setup failed.");

    await signIn(page, user);
    await page.goto("/projects");
    await page.getByRole("link", { name: "New project", exact: true }).first().click();
    const createForm = page.locator("#project-create-form");
    await createForm.getByLabel("Title").fill("Graduate portfolio launch");
    await createForm.locator('[name="status"]').selectOption("completed");
    await createForm.locator('[name="end_precision"]').selectOption("month");
    await createForm.locator('[name="end_year"]').fill("2024");
    await createForm.locator('[name="end_month"]').fill("6");
    await createForm.getByRole("button", { name: "Create project", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/i);
    await expect(page.getByText("Needs outcome", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Jun 2024", { exact: true })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "project-detail-completed");

    const projectUrl = new URL(page.url());
    const projectId = projectUrl.pathname.split("/").at(-1);
    expect(projectId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.getByRole("link", { name: "Log related work", exact: true }).click();
    await expect(page).toHaveURL(/\/activity\/new\?/);
    await expect(page.locator('[name="project_id"]')).toHaveValue(projectId!);
    await page.locator('[name="raw_text"]').fill("Recorded a project milestone");
    await page.locator('[name="occurred_on"]').fill("2026-09-20");
    await page.getByRole("button", { name: "Save activity", exact: true }).click();
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText("1 linked activity/activities", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("1 linked activity/activities will remain.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(page).toHaveURL(/\/projects(?:\?|$)/);
    await expect(page.getByText("Graduate portfolio launch", { exact: true })).toHaveCount(0);

    const targetProjectResult = await publicClient.rpc("create_project_idempotent", {
      p_operation_key: randomUUID(),
      p_title: "Candidate pagination target",
      p_description: null,
      p_user_role: null,
      p_outcome: null,
      p_status: "active",
      p_start_date: null,
      p_start_precision: null,
      p_end_date: null,
      p_end_precision: null,
      p_is_current: false,
      p_experience_id: experienceId,
    } as unknown as ProjectCreateArgs);
    if (targetProjectResult.error || !targetProjectResult.data?.[0]?.project_id) throw new Error("Candidate pagination Project setup failed.");
    const targetProjectId = targetProjectResult.data[0].project_id;
    await Promise.all(Array.from({ length: 101 }, (_, index) => publicClient.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(),
      p_raw_text: `Target-linked pagination filler ${index}`,
      p_occurred_on: "2026-09-20",
      p_capture_mode: "note",
      p_role: null,
      p_scope: null,
      p_outcome: null,
      p_experience_id: experienceId,
      p_project_id: targetProjectId,
    } as unknown as ActivityCreateArgs)));
    await Promise.all(Array.from({ length: 30 }, (_, index) => publicClient.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(),
      p_raw_text: `Eligible pagination filler ${index}`,
      p_occurred_on: "2026-09-19",
      p_capture_mode: "note",
      p_role: null,
      p_scope: null,
      p_outcome: null,
      p_experience_id: experienceId,
      p_project_id: null,
    } as unknown as ActivityCreateArgs)));
    const sentinel = await publicClient.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(),
      p_raw_text: "Eligible pagination sentinel",
      p_occurred_on: "2020-01-01",
      p_capture_mode: "note",
      p_role: null,
      p_scope: null,
      p_outcome: null,
      p_experience_id: experienceId,
      p_project_id: null,
    } as unknown as ActivityCreateArgs);
    if (sentinel.error) throw new Error("Candidate pagination Activity setup failed.");

    await page.goto(`/projects/${targetProjectId}`);
    await page.getByRole("button", { name: "Attach existing activity", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load more activities", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load more activities", exact: true }).click();
    await expect(page.getByText("Eligible pagination sentinel", { exact: true })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "project-candidate-pagination");

    const datedCandidateIds = await Promise.all(Array.from({ length: 30 }, async (_, index) => {
      const candidate = await createAchievementCandidate(publicClient, `Dated achievement candidate ${index + 1}`, "2026-09-20");
      return candidate.id;
    }));
    const datedCandidates = await publicClient.from("achievements").select("id,achieved_on").in("id", datedCandidateIds).order("achieved_on", { ascending: false }).order("id", { ascending: false });
    if (datedCandidates.error || datedCandidates.data?.length !== 30) throw new Error("Dated Achievement candidate fixture failed.");
    const datedCursorId = datedCandidates.data.at(-1)?.id;
    if (!datedCursorId) throw new Error("Dated Achievement cursor fixture failed.");
    let sentinelId: string | null = null;
    for (let attempt = 0; attempt < 20 && !sentinelId; attempt += 1) {
      const candidate = await createAchievementCandidate(publicClient, `Unknown-date boundary probe ${attempt + 1}`, null);
      if (candidate.id > datedCursorId) {
        await saveAchievementCandidate(publicClient, candidate.id, candidate.revision, "Unknown-date achievement sentinel", null);
        sentinelId = candidate.id;
      }
    }
    if (!sentinelId) throw new Error("Could not create an unknown-date sentinel beyond the dated cursor.");
    await page.goto(`/projects/${targetProjectId}`);
    await page.getByRole("button", { name: "Attach existing Achievement", exact: true }).click();
    await expect(page.getByRole("button", { name: "Load more Achievements", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Load more Achievements", exact: true }).click();
    await expect(page.getByText("Unknown-date achievement sentinel", { exact: true })).toBeVisible();
    await expect(page.getByText("Date not set", { exact: true })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "project-achievement-candidate-pagination");

    await page.setViewportSize({ width: 360, height: 820 });
    await page.goto("/projects");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expectNoWcagViolations(page, testInfo, "project-list-mobile");
  } finally {
    await publicClient.auth.signOut();
    await admin.auth.admin.deleteUser(user.id);
    void experienceId;
  }
});
