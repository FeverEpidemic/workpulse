import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };
type Fixture = {
  user: User;
  foreignUser: User;
  emptyUser: User;
  ids: {
    experience1: string;
    experience2: string;
    education1: string;
    education2: string;
    projects: { p1: string; p2: string; p3: string; p4: string };
    activities: string[];
    achievements: { c1: string; c2: string; c3: string; c4: string; c5: string };
    skillId: string;
  };
};

function config(): { url: string; publicKey: string; secretKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !publicKey || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, publicKey, secretKey };
}

function client(url: string, key: string): Client {
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`T12 browser fixture setup failed: ${label}`);
  return value;
}

async function createUser(admin: Client, label: string, locale = "en"): Promise<User> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = `t12-dashboard-${suffix}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: label } });
  const id = required(created.data.user?.id, created.error, `${label} auth user`);
  const profile = await admin.from("profiles").update({
    display_name: label,
    locale,
    timezone: "Asia/Jakarta",
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", id);
  if (profile.error) throw new Error(`T12 browser fixture setup failed: ${label} profile`);
  return { id, email, password };
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function createProject(owner: Client, input: {
  title: string;
  status: "planned" | "active" | "completed";
  outcome: string | null;
  experienceId?: string | null;
  startDate?: string | null;
  startPrecision?: "year" | "month" | "day" | null;
}): Promise<string> {
  const result = await owner.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(),
    p_title: input.title,
    p_description: null,
    p_user_role: null,
    p_outcome: input.outcome,
    p_status: input.status,
    p_start_date: input.startDate ?? null,
    p_start_precision: input.startPrecision ?? null,
    p_end_date: null,
    p_end_precision: null,
    p_is_current: false,
    p_experience_id: input.experienceId ?? null,
  } as unknown as Database["public"]["Functions"]["create_project_idempotent"]["Args"]);
  const id = result.data?.[0]?.project_id;
  return required(id, result.error, `project ${input.title}`);
}

async function createActivity(owner: Client, rawText: string, occurredOn: string, projectId: string | null = null) {
  const result = await owner.rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(),
    p_raw_text: rawText,
    p_occurred_on: occurredOn,
    p_capture_mode: "note",
    p_role: null,
    p_scope: null,
    p_outcome: null,
    p_experience_id: null,
    p_project_id: projectId,
  } as unknown as Database["public"]["Functions"]["create_activity_idempotent"]["Args"]);
  const row = result.data?.[0];
  if (result.error || !row?.activity_id) throw new Error("T12 browser fixture setup failed: activity");
  return { id: row.activity_id, revision: row.revision };
}

async function createAchievement(owner: Client, input: {
  title: string;
  achievedOn: string;
  projectId?: string | null;
  experienceId?: string | null;
  activityId?: string | null;
  skillNames?: string[];
  action?: "confirm" | "save_draft" | "dismiss";
}): Promise<{ id: string; revision: number }> {
  const created = await owner.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(),
    p_activity_id: input.activityId ?? null,
    p_project_id: input.projectId ?? null,
    p_experience_id: input.experienceId ?? null,
  } as unknown as Database["public"]["Functions"]["create_achievement_idempotent"]["Args"]);
  const draft = created.data?.[0];
  if (created.error || !draft?.achievement_id) throw new Error(`T12 browser fixture setup failed: ${input.title} create`);
  const action = input.action ?? "confirm";
  const saved = await owner.rpc("save_achievement", {
    p_achievement_id: draft.achievement_id,
    p_expected_revision: draft.revision,
    p_action: action,
    p_changes: {
      title: input.title,
      contribution: action === "confirm" ? `Delivered ${input.title}` : "",
      scope: "",
      outcome: action === "confirm" ? `Recorded ${input.title}` : "",
      cv_bullet: action === "confirm" ? `${input.title} with a documented result` : "",
      achieved_on: input.achievedOn,
      metrics: [],
    },
    p_skill_names: input.skillNames ?? [],
  } as unknown as Database["public"]["Functions"]["save_achievement"]["Args"]);
  const row = saved.data?.[0];
  if (saved.error || !row) throw new Error(`T12 browser fixture setup failed: ${input.title} save`);
  return { id: row.id, revision: row.revision };
}

async function addEvidence(admin: Client, userId: string, parentKind: "activity" | "achievement" | "project", parentId: string, revision: number, ready: boolean): Promise<void> {
  const reserved = await admin.rpc("reserve_evidence_upload", {
    p_user_id: userId,
    p_parent_kind: parentKind,
    p_parent_id: parentId,
    p_filename: "fixture.pdf",
    p_content_type: "application/pdf",
    p_expected_bytes: 20,
    p_idempotency_key: randomUUID(),
    p_expected_revision: revision,
  } as unknown as Database["public"]["Functions"]["reserve_evidence_upload"]["Args"]);
  const file = reserved.data?.[0];
  if (reserved.error || !file) throw new Error(`T12 browser fixture setup failed: ${parentKind} evidence reserve`);
  const finalized = await admin.rpc("finalize_evidence_upload", {
    p_user_id: userId,
    p_evidence_id: file.id,
    p_expected_revision: file.revision,
    p_actual_bytes: 20,
    p_verified_content_type: "application/pdf",
    p_sha256: "a".repeat(64),
  } as unknown as Database["public"]["Functions"]["finalize_evidence_upload"]["Args"]);
  const scanJobId = finalized.data?.[0]?.scan_job_id;
  if (finalized.error || !scanJobId) throw new Error(`T12 browser fixture setup failed: ${parentKind} evidence finalize`);
  if (!ready) return;
  const claimed = await admin.rpc("claim_evidence_scan_jobs", { p_limit: 100 });
  const jobs = (claimed.data ?? []) as { id: string; attempt_token: string }[];
  const job = jobs.find((row) => row.id === scanJobId);
  if (claimed.error || !job) throw new Error("T12 browser fixture setup failed: evidence scan claim");
  const completed = await admin.rpc("complete_evidence_scan_job", {
    p_job_id: scanJobId,
    p_attempt_token: job.attempt_token,
    p_result: "clean",
  } as unknown as Database["public"]["Functions"]["complete_evidence_scan_job"]["Args"]);
  if (completed.error || completed.data !== true) throw new Error("T12 browser fixture setup failed: evidence scan completion");
}

async function insertFoundation(admin: Client, userId: string, input: {
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
  return required(result.data?.id, result.error, `experience ${input.roleTitle}`);
}

async function insertEducation(admin: Client, userId: string, input: {
  institution: string;
  qualification: string;
  startDate: string | null;
  startPrecision: "year" | "month" | "day" | null;
  endDate: string | null;
  endPrecision: "year" | "month" | "day" | null;
}): Promise<string> {
  const result = await admin.from("education").insert({
    user_id: userId,
    institution: input.institution,
    qualification: input.qualification,
    start_date: input.startDate,
    start_precision: input.startPrecision,
    end_date: input.endDate,
    end_precision: input.endPrecision,
    is_current: false,
  }).select("id").single();
  return required(result.data?.id, result.error, `education ${input.qualification}`);
}

async function createFixture(admin: Client, publicKey: string, createdUsers: User[]): Promise<Fixture> {
  const user = await createUser(admin, "T12 Owner A");
  createdUsers.push(user);
  const foreignUser = await createUser(admin, "T12 Owner B");
  createdUsers.push(foreignUser);
  const emptyUser = await createUser(admin, "T12 Empty Owner");
  createdUsers.push(emptyUser);
  const owner = client(config().url, publicKey);
  const foreign = client(config().url, publicKey);
  const ownerLogin = await owner.auth.signInWithPassword({ email: user.email, password: user.password });
  const foreignLogin = await foreign.auth.signInWithPassword({ email: foreignUser.email, password: foreignUser.password });
  if (ownerLogin.error || foreignLogin.error) throw new Error("T12 browser fixture setup failed: public owner sign-in");

  const experience1 = await insertFoundation(admin, user.id, {
    organization: "Northwind", roleTitle: "Analyst", startDate: "2021-03-01", startPrecision: "month", endDate: "2023-06-01", endPrecision: "month",
  });
  const experience2 = await insertFoundation(admin, user.id, {
    organization: "Contoso", roleTitle: "Consultant", startDate: "2022-01-01", startPrecision: "month", endDate: null, endPrecision: null, isCurrent: true,
  });
  const education1 = await insertEducation(admin, user.id, {
    institution: "Universitas Indonesia", qualification: "S.Kom", startDate: "2016-01-01", startPrecision: "year", endDate: "2020-01-01", endPrecision: "year",
  });
  const education2 = await insertEducation(admin, user.id, {
    institution: "Online Academy", qualification: "Certificate", startDate: null, startPrecision: null, endDate: null, endPrecision: null,
  });

  const projects = {
    p1: await createProject(owner, { title: "Platform revamp", status: "active", outcome: null, experienceId: experience2, startDate: "2024-02-01", startPrecision: "month" }),
    p2: await createProject(owner, { title: "Thesis prototype", status: "completed", outcome: null, startDate: "2023-01-01", startPrecision: "year" }),
    p3: await createProject(owner, { title: "Migration", status: "completed", outcome: "Shipped" }),
    p4: await createProject(owner, { title: "Next initiative", status: "planned", outcome: null, startDate: "2025-01-15", startPrecision: "day" }),
  };
  const activityDates = ["2026-09-20", "2026-09-18", "2026-09-10", "2026-08-01", "2026-07-15", "2026-06-01"];
  const activities = [];
  for (let index = 0; index < activityDates.length; index += 1) activities.push(await createActivity(owner, `AC${index + 1}`, activityDates[index]!));
  const activity7 = await createActivity(owner, "AC7 older activity", "2025-11-03");
  activities.push(activity7);

  const achievements = {
    c1: await createAchievement(owner, { title: "C1 Project result", achievedOn: "2026-08-10", projectId: projects.p1, skillNames: ["TypeScript", "SQL"] }),
    c2: await createAchievement(owner, { title: "C2 Standalone result", achievedOn: "2026-07-01", skillNames: ["typescript "] }),
    c3: await createAchievement(owner, { title: "C3 Experience result", achievedOn: "2023-05-20", experienceId: experience1 }),
    c4: await createAchievement(owner, { title: "C4 Derived result", achievedOn: "2025-11-03", activityId: activity7.id }),
    c5: await createAchievement(owner, { title: "C5 Project result", achievedOn: "2023-09-09", projectId: projects.p2 }),
  };
  await createAchievement(owner, { title: "D1 Draft only", achievedOn: "2026-09-01", skillNames: ["Figma"], action: "save_draft" });
  await createAchievement(owner, { title: "X1 Dismissed", achievedOn: "2026-08-01", action: "dismiss" });

  await addEvidence(admin, user.id, "achievement", achievements.c1.id, achievements.c1.revision, true);
  await addEvidence(admin, user.id, "achievement", achievements.c2.id, achievements.c2.revision, false);
  await addEvidence(admin, user.id, "activity", activity7.id, activity7.revision, true);
  await addEvidence(admin, user.id, "project", projects.p2, 1, true);

  const foreignExperience = await insertFoundation(admin, foreignUser.id, {
    organization: "T12 Foreign Company", roleTitle: "Foreign Role", startDate: "2020-01-01", startPrecision: "year", endDate: null, endPrecision: null, isCurrent: true,
  });
  const foreignProjectId = await createProject(foreign, { title: "T12 Foreign Project", status: "active", outcome: null });
  await createActivity(foreign, "T12 Foreign Activity", "2026-09-19", foreignProjectId);
  await createAchievement(foreign, { title: "T12 Foreign Achievement", achievedOn: "2026-09-19", projectId: foreignProjectId, skillNames: ["Foreign skill"] });
  await insertEducation(admin, foreignUser.id, {
    institution: "T12 Foreign School", qualification: "Foreign Degree", startDate: "2018-01-01", startPrecision: "year", endDate: "2019-01-01", endPrecision: "year",
  });

  const skill = await owner.from("skills").select("id, name").eq("user_id", user.id).eq("normalized_name", "typescript").single();
  const skillId = required(skill.data?.id, skill.error, "TypeScript skill");
  return {
    user,
    foreignUser,
    emptyUser,
    ids: {
      experience1,
      experience2,
      education1,
      education2,
      projects,
      activities: activities.map((activity) => activity.id),
      achievements: Object.fromEntries(Object.entries(achievements).map(([key, value]) => [key, value.id])) as Fixture["ids"]["achievements"],
      skillId,
    },
  };
}

async function tabUntilFocused(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  for (let index = 0; index < 80; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) {
      expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard traversal did not reach ${selector}`);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string, route: string, width: number, height: number, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: "http://127.0.0.1:3005" }]);
  await page.goto(route);
  await expect(page.locator("h1")).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(dimensions.width);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test("Dashboard and Timeline browser acceptance, accessibility, filters, and ownership", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  const values = config();
  const admin = client(values.url, values.secretKey);
  const createdUsers: User[] = [];
  let fixture: Fixture | null = null;
  try {
    fixture = await createFixture(admin, values.publicKey, createdUsers);

    await signIn(page, fixture.emptyUser);
    await expect(page.locator(".dashboard-stat-card")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Add your first activity" })).toHaveAttribute("href", "/activity/new");
    await expect(page.getByRole("button", { name: "Import CV" })).toBeDisabled();
    await expect(page.locator("#dashboard-import-unavailable")).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "dashboard-empty");
    await page.getByRole("link", { name: "Add your first activity" }).click();
    await expect(page).toHaveURL(/\/activity\/new$/);
    await expect(page.locator("#quick-log-note")).toBeFocused();

    await page.context().clearCookies();
    await signIn(page, fixture.user);
    await expect(page.locator(".dashboard-stat-card")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Confirmed achievements 5" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Current projects 1" })).toBeVisible();
    await expect(page.locator(".dashboard-stat-card").nth(2).locator("strong")).toHaveText("2");
    await expect(page.getByRole("link", { name: "4 confirmed achievements have no ready evidence." })).toBeVisible();
    await expect(page.getByRole("link", { name: "1 completed project has no outcome." })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "dashboard-full");
    await expect(page.getByText(/streak|readiness|proficiency|%/i)).toHaveCount(0);

    await page.getByRole("link", { name: /Confirmed achievements 5/ }).click();
    await expect(page).toHaveURL(/\/achievements\?status=confirmed$/);
    await expect(page.locator(".achievement-list-row")).toHaveCount(5);
    for (const title of ["C1 Project result", "C2 Standalone result", "C3 Experience result", "C4 Derived result", "C5 Project result"]) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "4 confirmed achievements have no ready evidence." }).click();
    await expect(page).toHaveURL(/\/achievements\?.*evidence=missing/);
    await expect(page.locator(".achievement-list-row")).toHaveCount(4);
    for (const title of ["C2 Standalone result", "C3 Experience result", "C4 Derived result", "C5 Project result"]) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("C1 Project result", { exact: true })).toHaveCount(0);

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "1 completed project has no outcome." }).click();
    await expect(page).toHaveURL(/\/projects\?.*outcome=missing/);
    await expect(page.locator(".project-list-row")).toHaveCount(1);
    await expect(page.getByText("Thesis prototype", { exact: true })).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "TypeScript, 2 confirmed achievements" }).click();
    await expect(page).toHaveURL(new RegExp(`/achievements\\?.*skill=${fixture.ids.skillId}`));
    await expect(page.locator(".achievement-list-row")).toHaveCount(2);
    await expect(page.getByText("C1 Project result", { exact: true })).toBeVisible();
    await expect(page.getByText("C2 Standalone result", { exact: true })).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("heading", { name: "Recent activity" }).locator("..")
      .locator("xpath=following-sibling::ol").getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/activity/${fixture.ids.activities[0]}`));
    await expect(page.locator(".activity-detail-source")).toHaveText("AC1");

    await page.goto("/dashboard");
    await page.getByRole("heading", { name: "Current projects" }).locator("..")
      .locator("xpath=following-sibling::ul").getByRole("link", { name: "Platform revamp" }).click();
    await expect(page).toHaveURL(`/projects/${fixture.ids.projects.p1}`);
    await expect(page.getByRole("heading", { name: "Platform revamp" })).toBeVisible();

    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await tabUntilFocused(page, ".dashboard-stat-card");
    await tabUntilFocused(page, ".dashboard-check-list a");

    await page.goto("/timeline");
    await expect(page.locator(".timeline-year").allTextContents()).resolves.toEqual([
      "2026", "2025", "2024", "2023", "2022", "2021", "2016", "Date not set",
    ]);
    await expect(page.locator(".timeline-event-type", { hasText: "Experience" })).toHaveCount(2);
    await expect(page.locator(".timeline-event").filter({ has: page.getByRole("link", { name: "Consultant", exact: true }) })).toContainText("Present");
    const undatedGroup = page.locator(".timeline-year-group").filter({ has: page.getByRole("heading", { name: "Date not set", exact: true }) });
    await expect(undatedGroup.getByRole("link", { name: "Certificate", exact: true })).toBeVisible();
    await expect(undatedGroup.getByRole("link", { name: "Migration", exact: true })).toBeVisible();
    const partialYearProject = page.locator(".timeline-event").filter({ has: page.getByRole("link", { name: "Thesis prototype", exact: true }) });
    await expect(partialYearProject).toContainText("Started 2023");
    await expect(partialYearProject).not.toContainText("Jan 2023");
    await expect(page.getByText("D1 Draft only", { exact: true })).toHaveCount(0);
    await expect(page.getByText("X1 Dismissed", { exact: true })).toHaveCount(0);
    await expect(page.getByText("2023", { exact: true })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, "timeline-full");
    await expect(page.getByText(/streak|readiness|proficiency|%/i)).toHaveCount(0);

    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await tabUntilFocused(page, ".timeline-event-title");

    await page.locator("#timeline-type-filter").selectOption("project");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/\/timeline\?type=project(?:&project=)?$/);
    await expect(page.locator(".timeline-event")).toHaveCount(4);
    await expectNoWcagViolations(page, testInfo, "timeline-filtered");
    await page.reload();
    await expect(page.locator("#timeline-type-filter")).toHaveValue("project");
    await page.goBack();
    await expect(page).toHaveURL(/\/timeline$/);
    await expect(page.locator("#timeline-type-filter")).toHaveValue("");
    await page.goForward();
    await expect(page).toHaveURL(/\/timeline\?type=project(?:&project=)?$/);
    await expect(page.locator(".timeline-event")).toHaveCount(4);

    await page.goto("/timeline");
    await page.getByRole("link", { name: "Analyst", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/profile\\?record=${fixture.ids.experience1}#experience-${fixture.ids.experience1}`));
    await expect(page.locator(`#experience-${fixture.ids.experience1}`)).toHaveAttribute("open", "");
    await expect(page.locator(`#experience-${fixture.ids.experience1}`)).toBeInViewport();

    await page.goto("/timeline");
    await page.getByRole("link", { name: "C1 Project result", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/achievements/${fixture.ids.achievements.c1}`));

    await page.context().clearCookies();
    await signIn(page, fixture.foreignUser);
    await expect(page.getByText("T12 Foreign Achievement", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Platform revamp", { exact: true })).toHaveCount(0);
    await expect(page.getByText("T12 Foreign Project", { exact: true })).toBeVisible();
    await page.goto(`/timeline?project=${fixture.ids.projects.p1}`);
    await expect(page.getByText("No events match these filters.", { exact: true })).toBeVisible();
    await expect(page.getByText("Platform revamp", { exact: true })).toHaveCount(0);
    await expect(page.getByText("C1 Project result", { exact: true })).toHaveCount(0);

    const localeUpdate = await admin.from("profiles").update({ locale: "id" }).eq("id", fixture.user.id);
    if (localeUpdate.error) throw new Error("T12 browser fixture setup failed: switch locale to Indonesian");
    await page.context().clearCookies();
    await signIn(page, fixture.user);
    await expect(page.getByText(/runtun|kesiapan|kemahiran|%/i)).toHaveCount(0);
    await page.goto("/timeline");
    await expect(page.getByText(/runtun|kesiapan|kemahiran|%/i)).toHaveCount(0);

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
        await attachScreenshot(page, testInfo, `dashboard-${viewport.width}-${theme}.png`, "/dashboard", viewport.width, viewport.height, theme);
        await attachScreenshot(page, testInfo, `timeline-${viewport.width}-${theme}.png`, "/timeline?type=project", viewport.width, viewport.height, theme);
      }
    }
  } finally {
    await admin.auth.signOut();
    for (const user of createdUsers) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw new Error("T12 browser fixture cleanup failed.");
    }
  }
});
