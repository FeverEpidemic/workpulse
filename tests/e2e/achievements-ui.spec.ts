import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type TestUser = { id: string; email: string; password: string };
type ActivityCreateArgs = Database["public"]["Functions"]["create_activity_idempotent"]["Args"];
type AchievementCreateArgs = Database["public"]["Functions"]["create_achievement_idempotent"]["Args"];
type AchievementSaveArgs = Database["public"]["Functions"]["save_achievement"]["Args"];
type ProjectCreateArgs = Database["public"]["Functions"]["create_project_idempotent"]["Args"];

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

async function createUser(admin: Client): Promise<TestUser> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `achievements-ui-${suffix}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Achievements UI owner" } });
  if (created.error || !created.data.user) throw new Error("Local Achievement UI user setup failed.");
  const profile = await admin.from("profiles").update({ display_name: "Achievements UI owner", locale: "en", timezone: "Asia/Bangkok", onboarding_completed_at: new Date().toISOString() }).eq("id", created.data.user.id);
  if (profile.error) throw new Error("Local Achievement UI profile setup failed.");
  return { id: created.data.user.id, email, password };
}

async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createActivity(clientForUser: Client, rawText: string): Promise<string> {
  const result = await clientForUser.rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(),
    p_raw_text: rawText,
    p_occurred_on: "2026-09-20",
    p_capture_mode: "note",
    p_role: null,
    p_scope: null,
    p_outcome: null,
    p_experience_id: null,
    p_project_id: null,
  } as unknown as ActivityCreateArgs);
  const id = result.data?.[0]?.activity_id;
  if (result.error || !id) throw new Error("Local Achievement UI Activity setup failed.");
  return id;
}

async function createDerivedAchievement(clientForUser: Client, activityId: string): Promise<string> {
  const result = await clientForUser.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(),
    p_activity_id: activityId,
    p_project_id: null,
    p_experience_id: null,
  } as unknown as AchievementCreateArgs);
  const id = result.data?.[0]?.achievement_id;
  if (result.error || !id) throw new Error("Local derived Achievement UI fixture failed.");
  return id;
}

async function createStandaloneAchievement(clientForUser: Client): Promise<string> {
  const result = await clientForUser.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(),
    p_activity_id: null,
    p_project_id: null,
    p_experience_id: null,
  } as unknown as AchievementCreateArgs);
  const id = result.data?.[0]?.achievement_id;
  if (result.error || !id) throw new Error("Local Achievement fixture setup failed.");
  return id;
}

async function saveAchievement(clientForUser: Client, id: string, revision: number, action: string, changes: Record<string, unknown>) {
  const result = await clientForUser.rpc("save_achievement", {
    p_achievement_id: id,
    p_expected_revision: revision,
    p_action: action,
    p_changes: changes,
    p_skill_names: [],
  } as unknown as AchievementSaveArgs);
  const row = result.data?.[0];
  if (result.error || !row) throw new Error("Local Achievement concurrent-save fixture failed.");
  return row;
}

async function createProject(clientForUser: Client, title: string): Promise<string> {
  const result = await clientForUser.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(),
    p_title: title,
    p_description: null,
    p_user_role: null,
    p_outcome: null,
    p_status: "active",
    p_start_date: null,
    p_start_precision: null,
    p_end_date: null,
    p_end_precision: null,
    p_is_current: false,
    p_experience_id: null,
  } as unknown as ProjectCreateArgs);
  const id = result.data?.[0]?.project_id;
  if (result.error || !id) throw new Error("Local Project context fixture setup failed.");
  return id;
}

async function createDraft(page: Page): Promise<void> {
  await page.goto("/achievements/new?returnTo=%2Fachievements");
  await page.getByRole("button", { name: "New Achievement", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}\?/i);
  await page.waitForLoadState("networkidle");
}

async function fillConfirmableFields(page: Page, title: string): Promise<void> {
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Contribution", { exact: true }).fill("Built a manual review flow");
  await page.getByLabel("Outcome", { exact: true }).fill("The team had a clearer record of impact");
  await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-20");
  const skill = page.getByLabel("Add a skill label", { exact: true });
  await skill.fill("SQL");
  await expect(skill).toHaveValue("SQL");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await expect(skill).toHaveValue("");
  await expect(page.locator('input[name="skill_names"]')).toHaveValue('["SQL"]');
}

test("Achievement create links resume after sign-in with source context and safe back destination", async ({ page }) => {
  test.setTimeout(360_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const publicClient = client(values.url, values.publicKey);
  const user = await createUser(admin);
  try {
    const signInResult = await publicClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signInResult.error) throw new Error("Local Achievement auth fixture sign-in failed.");
    const activityId = await createActivity(publicClient, "Auth resume Activity source");
    const projectId = await createProject(publicClient, "Auth resume Project source");
    const returnTo = "/activity?from=2026-09-01";

    async function resumeCreate(createPath: string) {
      await page.context().clearCookies();
      await page.goto(createPath);
      await expect(page).toHaveURL(/\/sign-in\?returnTo=/);
      await page.getByLabel("Email address").fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(user.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe("/achievements/new");
      const resumed = new URL(page.url());
      expect(resumed.searchParams.get("returnTo")).toBe(returnTo);
      return resumed;
    }

    const standalone = await resumeCreate(`/achievements/new?${new URLSearchParams({ returnTo }).toString()}`);
    expect(standalone.searchParams.has("activity")).toBe(false);
    expect(standalone.searchParams.has("project")).toBe(false);

    const derived = await resumeCreate(`/achievements/new?${new URLSearchParams({ activity: activityId, returnTo }).toString()}`);
    expect(derived.searchParams.get("activity")).toBe(activityId);
    await expect(page.locator(".achievement-source-preview")).toContainText("Auth resume Activity source");

    const projectContext = await resumeCreate(`/achievements/new?${new URLSearchParams({ project: projectId, returnTo }).toString()}`);
    expect(projectContext.searchParams.get("project")).toBe(projectId);
    await expect(page.locator('input[name="project_id"]')).toHaveValue(projectId);

    await page.context().clearCookies();
    await page.getByRole("button", { name: "New Achievement", exact: true }).click();
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Email address").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/achievements/new");
    await expect(page.locator('input[name="project_id"]')).toHaveValue(projectId);
    const afterExpiredSubmit = await publicClient.from("achievements").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("project_id", projectId);
    expect(afterExpiredSubmit.error).toBeNull();
    expect(afterExpiredSubmit.count).toBe(0);
  } finally {
    await publicClient.auth.signOut();
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("a second Achievement create in the same tab uses a fresh operation key and keeps its Project context", async ({ page }) => {
  // Gate M2 finding F1: after creating a derived Achievement, creating another Achievement from a
  // Project in the same browser tab must not replay the previous create key.
  test.setTimeout(240_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const publicClient = client(values.url, values.publicKey);
  const user = await createUser(admin);
  try {
    const signInResult = await publicClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signInResult.error) throw new Error("Local Achievement create-key fixture sign-in failed.");
    const activityId = await createActivity(publicClient, "Create-key derived source");
    const projectId = await createProject(publicClient, "Create-key Project source");
    await signIn(page, user);

    await page.goto(`/activity/${activityId}`);
    await page.getByRole("link", { name: "Create Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await page.waitForLoadState("networkidle");
    const firstKey = await page.locator('#achievement-create-form input[name="operation_key"]').inputValue();
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/i);
    await page.getByRole("button", { name: "New Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}\?/i);

    await page.goto(`/projects/${projectId}`);
    await page.getByRole("link", { name: "Create Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await page.waitForLoadState("networkidle");
    await expect(page.locator('#achievement-create-form input[name="project_id"]')).toHaveValue(projectId);
    const secondKey = await page.locator('#achievement-create-form input[name="operation_key"]').inputValue();
    expect(secondKey, "a completed create must not leave its key for the next create").not.toBe(firstKey);
    await page.getByRole("button", { name: "New Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}\?/i);
    await expect(page.locator(".achievement-detail-context")).toContainText("Project: Create-key Project source");
    const linked = await publicClient.from("achievements").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("project_id", projectId);
    expect(linked.count).toBe(1);
  } finally {
    await publicClient.auth.signOut();
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("Achievement conflict retry preserves each valid lifecycle action", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(360_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const publicClient = client(values.url, values.publicKey);
  const user = await createUser(admin);
  try {
    const signInResult = await publicClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signInResult.error) throw new Error("Local Achievement conflict fixture sign-in failed.");
    await signIn(page, user);

    const completeChanges = (title: string) => ({ title, contribution: "Built a reliable review flow", scope: "", outcome: "The team had a clearer record", cv_bullet: "Built a reliable review flow. The team had a clearer record", achieved_on: "2026-09-24", metrics: [] });
    const cases = [
      { action: "save_draft", initial: "draft", final: "draft" },
      { action: "confirm", initial: "draft", final: "confirmed" },
      { action: "dismiss", initial: "draft", final: "dismissed" },
      { action: "reopen", initial: "dismissed", final: "draft" },
      { action: "save_changes", initial: "confirmed", final: "confirmed" },
    ] as const;
    for (const { action, initial, final } of cases) {
      const id = await createStandaloneAchievement(publicClient);
      let revision = 1;
      if (initial === "dismissed") {
        await saveAchievement(publicClient, id, revision, "dismiss", { title: "Initial dismissed", contribution: "", scope: "", outcome: "", cv_bullet: "", achieved_on: null, metrics: [] });
        revision += 1;
      } else if (initial === "confirmed") {
        await saveAchievement(publicClient, id, revision, "confirm", completeChanges("Initial confirmed"));
        revision += 1;
      }

      await page.goto(`/achievements/${id}?returnTo=%2Fachievements`);
      await page.waitForLoadState("networkidle");
      const localTitle = `Local ${action}`;
      await page.getByLabel("Title", { exact: true }).fill(localTitle);
      if (action === "confirm") {
        await page.getByLabel("Contribution", { exact: true }).fill("Built the local review flow");
        await page.getByLabel("Outcome", { exact: true }).fill("The team could review the result");
        await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-24");
      }

      const concurrentAction = initial === "confirmed" ? "save_changes" : "save_draft";
      const concurrentChanges = initial === "confirmed"
        ? completeChanges(`Remote ${action}`)
        : { title: `Remote ${action}`, contribution: "Concurrent edit", scope: "", outcome: "", cv_bullet: "", achieved_on: null, metrics: [] };
      await saveAchievement(publicClient, id, revision, concurrentAction, concurrentChanges);
      if (action === "save_draft") await page.getByLabel("Title", { exact: true }).press("Enter");
      else await page.locator(`button[name="achievement_action"][value="${action}"]`).click();
      await expect(page.getByText("This Achievement changed on the server", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(localTitle);
      const retry = page.getByRole("button", { name: "Review and retry my changes", exact: true });
      if (action === "save_draft") {
        await expect(retry).toBeFocused();
        await expectNoWcagViolations(page, testInfo, "achievement-conflict-desktop-light");
        await page.setViewportSize({ width: 360, height: 820 });
        await expectNoWcagViolations(page, testInfo, "achievement-conflict-mobile-light");
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
        await expect.poll(() => retry.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(143, 175, 135)");
        await expect.poll(() => retry.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(17, 22, 19)");
        await expectNoWcagViolations(page, testInfo, "achievement-conflict-desktop-dark");
        await page.getByRole("button", { name: "Switch to light theme", exact: true }).click();
      }
      await retry.click();
      await expect.poll(async () => {
        const row = await publicClient.from("achievements").select("status,title").eq("user_id", user.id).eq("id", id).maybeSingle();
        return row.data?.title;
      }).toBe(localTitle);
      const saved = await publicClient.from("achievements").select("status").eq("user_id", user.id).eq("id", id).single();
      expect(saved.data?.status).toBe(final);
    }

    const changedStatusId = await createStandaloneAchievement(publicClient);
    await page.goto(`/achievements/${changedStatusId}?returnTo=%2Fachievements`);
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Title", { exact: true }).fill("Keep these local edits");
    await saveAchievement(publicClient, changedStatusId, 1, "dismiss", { title: "Concurrent dismissal", contribution: "", scope: "", outcome: "", cv_bullet: "", achieved_on: null, metrics: [] });
    await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
    await expect(page.getByText("This Achievement changed on the server", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review and retry my changes", exact: true })).toHaveCount(0);
    await expect(page.getByText("The latest status changed. Choose a valid action for this status to keep your local edits.", { exact: true })).toBeVisible();
    const changedStatus = await publicClient.from("achievements").select("revision,status").eq("user_id", user.id).eq("id", changedStatusId).single();
    expect(changedStatus.data).toMatchObject({ revision: 2, status: "dismissed" });
    await expect(page.locator('form.achievement-form input[name="expected_revision"]')).toHaveValue("2");
    const reopenAction = page.getByRole("button", { name: "Reopen as draft", exact: true });
    await reopenAction.click();
    await expect.poll(async () => {
      const row = await publicClient.from("achievements").select("status,title").eq("user_id", user.id).eq("id", changedStatusId).maybeSingle();
      return row.data?.status;
    }).toBe("draft");
    const resumed = await publicClient.from("achievements").select("title").eq("user_id", user.id).eq("id", changedStatusId).single();
    expect(resumed.data?.title).toBe("Keep these local edits");
  } finally {
    await publicClient.auth.signOut();
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("manual Achievement lifecycle, source handoff, accessibility, and mobile layout work", async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(360_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const publicClient = client(values.url, values.publicKey);
  const user = await createUser(admin);
  try {
    const signInResult = await publicClient.auth.signInWithPassword({ email: user.email, password: user.password });
    if (signInResult.error) throw new Error("Local Achievement UI sign-in setup failed.");

    await signIn(page, user);
    await page.goto("/achievements");
    await expect(page.getByRole("heading", { name: "Achievements", exact: true })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "achievement-list");

    await createDraft(page);
    await fillConfirmableFields(page, "Manual review achievement");
    await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
    await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
    await expect(page.locator('textarea[name="cv_bullet"]')).toHaveValue("Built a manual review flow. The team had a clearer record of impact");
    await expect(page.locator(".achievement-detail-context")).toContainText("SQL (1)");
    await expectNoWcagViolations(page, testInfo, "achievement-confirmed-detail");

    await page.getByRole("link", { name: "Back to Achievements", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Achievements", exact: true })).toBeVisible();
    await expect(page.getByText("Manual review achievement", { exact: true })).toBeVisible();

    await createDraft(page);
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await expect(page.getByText("Dismissed", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Reopen as draft", exact: true }).click();
    await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();

    await createDraft(page);
    const blankMetricId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await page.getByRole("button", { name: "Add metric", exact: true }).click();
    const metricLabelInput = page.getByLabel("Metric label", { exact: true });
    await metricLabelInput.fill("People served");
    await expect(metricLabelInput).toHaveValue("People served");
    await page.getByLabel("Unit", { exact: true }).fill("people");
    await expect(metricLabelInput).toHaveValue("People served");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("region", { name: "Notifications" }).getByText("Check the highlighted fields and try again.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Metric label", { exact: true })).toHaveValue("People served");
    await expect(page.getByLabel("Unit", { exact: true })).toHaveValue("people");
    const rejectedMetric = await publicClient.from("achievements").select("revision,metrics").eq("user_id", user.id).eq("id", blankMetricId).single();
    expect(rejectedMetric.error).toBeNull();
    expect(rejectedMetric.data).toMatchObject({ revision: 1, metrics: [] });

    const activityId = await createActivity(publicClient, "Achievement source from Activity");
    await page.goto(`/activity/${activityId}?returnTo=%2Fachievements`);
    await page.getByRole("link", { name: "Create Achievement", exact: true }).click();
    await expect(page.locator(".achievement-source-preview").getByText("Achievement source from Activity", { exact: true })).toBeVisible();
    const derivedId = await createDerivedAchievement(publicClient, activityId);
    const achievementBack = `/achievements/${derivedId}?${new URLSearchParams({ returnTo: "/achievements?status=confirmed" }).toString()}`;
    await page.goto(`/achievements/new?${new URLSearchParams({ activity: activityId, returnTo: "/achievements?status=confirmed" }).toString()}`);
    await expect(page).toHaveURL(new RegExp(`/achievements/${derivedId}`));
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/achievements?status=confirmed");
    const derivedCount = await publicClient.from("achievements").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("activity_id", activityId);
    expect(derivedCount.error).toBeNull();
    expect(derivedCount.count).toBe(1);

    await page.goto(achievementBack);
    await expect(page.locator(".achievement-source-preview").getByText("Achievement source from Activity", { exact: true }).first()).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "achievement-derived-detail");
    await page.getByRole("link", { name: "Open Activity", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/activity/${activityId}`));
    expect(new URL(page.url()).pathname).toBe(`/activity/${activityId}`);
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe(achievementBack);
    await page.getByRole("link", { name: "Back to activity", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/achievements/${derivedId}`));
    expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/achievements?status=confirmed");
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/activity/${activityId}`));
    expect(new URL(page.url()).pathname).toBe(`/activity/${activityId}`);
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/achievements/${derivedId}`));
    expect(new URL(page.url()).pathname).toBe(`/achievements/${derivedId}`);

    await page.setViewportSize({ width: 360, height: 820 });
    await page.goto("/achievements");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expectNoWcagViolations(page, testInfo, "achievement-list-mobile");
  } finally {
    await publicClient.auth.signOut();
    await admin.auth.admin.deleteUser(user.id);
  }
});
