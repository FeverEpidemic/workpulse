import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainAiWorker } from "./helpers/ai-worker";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3008";
const CONSENT_VERSION = "ai-processing-v1";
let admin: Client;
const users: User[] = [];

function config(): { url: string; secretKey: string; publishableKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publishableKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publishableKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publishableKey };
}

async function createUser(label: string, options: { locale?: "en" | "id"; consent?: boolean } = {}): Promise<User> {
  const email = `t14-review-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`T14 browser fixture setup failed: ${label}`);
  const profile = await admin.from("profiles").update({
    display_name: label,
    locale: options.locale ?? "en",
    timezone: "Asia/Jakarta",
    onboarding_completed_at: new Date().toISOString(),
    ...(options.consent ? { ai_consent_at: new Date().toISOString(), ai_consent_version: CONSENT_VERSION } : {}),
  }).eq("id", id);
  if (profile.error) throw new Error(`T14 browser fixture setup failed: ${label} profile`);
  const user = { id, email, password };
  users.push(user);
  return user;
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function ownerClient(user: User): Promise<Client> {
  const { url, publishableKey } = config();
  const client = createClient<Database>(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const signed = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signed.error) throw new Error("T14 owner sign-in failed");
  return client;
}

/** Edits the note through the same RPC the activity editor uses, bumping the activity revision. */
async function editNote(user: User, activityId: string, rawText: string): Promise<number> {
  const owner = await ownerClient(user);
  try {
    const current = await owner.from("activities")
      .select("revision, occurred_on, role, scope, outcome, experience_id, project_id")
      .eq("id", activityId).single();
    if (current.error || !current.data) throw new Error("T14 activity read failed");
    const { revision, ...fields } = current.data;
    const updated = await owner.rpc("update_activity", {
      p_activity_id: activityId,
      p_expected_revision: revision,
      p_changes: { ...fields, raw_text: rawText },
    });
    if (updated.error) throw new Error(`T14 activity edit failed: ${updated.error.code}`);
    return revision + 1;
  } finally {
    await owner.auth.signOut({ scope: "local" });
  }
}

async function jobCount(userId: string): Promise<number> {
  const { count, error } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (error) throw new Error("T14 job count failed");
  return count ?? 0;
}

async function captureNote(page: Page, note: string): Promise<string> {
  await page.goto("/activity/new");
  await page.locator("#quick-log-note").fill(note);
  await page.locator("#quick-log-note-form button[type='submit']").click();
  await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

const panel = (page: Page): Locator => page.getByTestId("ai-analysis-panel");

async function analyze(page: Page): Promise<void> {
  await panel(page).getByRole("button", { name: /^(Analyze with AI|Analyze again|Analisis dengan AI|Analisis ulang)$/ }).click();
  await expect(panel(page)).toContainText(/Waiting to start|Analyzing…|Menunggu dimulai|Menganalisis…/);
}

async function drainAndReload(page: Page, scenario: Parameters<typeof drainAiWorker>[0]): Promise<void> {
  const claimed = await drainAiWorker(scenario);
  expect(claimed, "worker should have claimed a queued AI job").toBeGreaterThan(0);
  await page.reload();
}

async function expectNoOverflow(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

test.beforeAll(() => {
  const { url, secretKey } = config();
  admin = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
});

test.afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
});

test("S06 consent declined keeps the manual path working and creates no AI job", async ({ page }, testInfo) => {
  const user = await createUser("T14 Manual Owner");
  await signIn(page, user);
  const activityId = await captureNote(page, `Migrated 3 reports to the new pipeline. WP-PRIVATE-SENTINEL-${randomUUID()}`);

  const analyzeButton = panel(page).getByRole("button", { name: "Analyze with AI", exact: true });
  await expect(analyzeButton).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "s06-none");

  await analyzeButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Allow AI processing?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue manually" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(analyzeButton).toBeFocused();

  // Chromium still dispatches trailing events right after a native dialog closes; reopening with Enter needs a short settle.
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Enter"); // focus starts on Continue manually
  await expect(dialog).toBeHidden();
  expect(await jobCount(user.id)).toBe(0);
  await expect(panel(page)).not.toContainText(/Waiting to start|Analyzing…|Suggested wording/);

  await page.getByRole("link", { name: "Create Achievement", exact: true }).click();
  await page.getByRole("button", { name: "New Achievement", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Title", { exact: true }).fill("Migrated reports by hand");
  await page.getByLabel("Contribution", { exact: true }).fill("Moved three reports to the new pipeline");
  await page.getByLabel("Outcome", { exact: true }).fill("The reports run on the new pipeline");
  await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-21");
  await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
  await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
  expect(await jobCount(user.id)).toBe(0);
  expect(activityId).toMatch(/^[0-9a-f-]{36}$/);
});

test("S06/S08 allow, analyze, answer, review as draft and confirm; another owner cannot read it", async ({ page, browser }, testInfo) => {
  const owner = await createUser("T14 Review Owner");
  const other = await createUser("T14 Other Owner", { consent: true });
  await signIn(page, owner);
  const note = `Migrated 3 reports to the new pipeline. WP-PRIVATE-SENTINEL-${randomUUID()}`;
  const activityId = await captureNote(page, note);

  // Consent is asked when the user first requests analysis; allowing it queues the job in the same step.
  await panel(page).getByRole("button", { name: "Analyze with AI", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Allow AI processing?" });
  await expect(dialog.getByRole("button", { name: "Continue manually" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Allow AI", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("Waiting to start");
  await expectNoWcagViolations(page, testInfo, "s06-queued");
  expect(await jobCount(owner.id)).toBe(1);

  await drainAndReload(page, "with_skills");
  await expect(panel(page).getByRole("heading", { name: "Your note" })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
  await expect(panel(page)).toContainText("Delivered the described work");
  await expect(panel(page).getByRole("heading", { name: "Optional follow-up questions" })).toBeVisible();
  await expect(panel(page)).toContainText(note);
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "s06-suggestion");
  await testInfo.attach("s06-suggestion", { body: await page.screenshot(), contentType: "image/png" });

  // A different owner gets no data for this activity.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signIn(otherPage, other);
  const foreign = await otherPage.request.get(`/api/ai/activities/${activityId}/analysis`);
  expect(foreign.status()).not.toBe(200);
  expect(await foreign.text()).not.toContain("WP-PRIVATE-SENTINEL");
  await otherContext.close();

  // Answer the follow-up by keyboard: the note gets a new revision and a refine job.
  await panel(page).getByLabel("What was the result?").fill("Weekly prep dropped from 5 to 2 hours");
  await panel(page).getByLabel("What was the result?").press("Tab");
  await page.keyboard.press("Enter");
  await expect(panel(page)).toContainText("Waiting to start");
  expect(await jobCount(owner.id)).toBe(2);
  await drainAndReload(page, "with_skills");
  await expect(panel(page)).toContainText("Suggested wording");
  await expect(panel(page).getByRole("heading", { name: "Optional follow-up questions" })).toBeHidden();

  await panel(page).getByRole("button", { name: "Review as draft", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Delivered the described work");
  await expect(page.getByRole("button", { name: "Confirm Achievement", exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  // A draft that was just applied has nothing newer to compare against.
  await expect(page.getByTestId("ai-suggestion-aside")).toHaveCount(0);

  // Skill chips only fill the form; nothing is linked until the user saves.
  await page.getByRole("button", { name: "Add Data pipelines", exact: true }).click();
  await expect(page.locator('input[name="skill_names"]')).toHaveValue(/Data pipelines/);
  await expectNoWcagViolations(page, testInfo, "s08-draft-with-skill");
  await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
  await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();

  // The activity now shows the review as applied and offers only the open link.
  await page.goto(`/activity/${activityId}`);
  await expect(panel(page)).toContainText("This suggestion was reviewed as a draft achievement.");
});

test("S06 skip questions and save for later persist across reload", async ({ page }, testInfo) => {
  const user = await createUser("T14 Questions Owner", { consent: true });
  await signIn(page, user);
  await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "valid");

  const questions = panel(page).getByRole("heading", { name: "Optional follow-up questions" });
  await expect(questions).toBeVisible();

  await panel(page).getByRole("button", { name: "Save for later", exact: true }).click();
  await expect(questions).toBeHidden();
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toBeFocused();
  await page.reload();
  await expect(questions).toBeVisible();

  await panel(page).getByRole("button", { name: "Skip questions", exact: true }).click();
  await expect(questions).toBeHidden();
  await page.reload();
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
  await expect(questions).toBeHidden();
  await expectNoWcagViolations(page, testInfo, "s06-skipped");
});

test("S06 dismiss suppresses the suggestion until the note changes", async ({ page }) => {
  const user = await createUser("T14 Dismiss Owner", { consent: true });
  await signIn(page, user);
  const activityId = await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "valid");

  await panel(page).getByRole("button", { name: "Dismiss suggestion", exact: true }).click();
  await expect(panel(page)).toContainText("You dismissed this suggestion. Edit the note to get a new one.");
  await page.reload();
  await expect(panel(page)).toContainText("You dismissed this suggestion. Edit the note to get a new one.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);

  await editNote(user, activityId, `Migrated 4 reports ${randomUUID()}`);
  await page.reload();
  await expect(panel(page)).not.toContainText("You dismissed this suggestion");
  await analyze(page);
  await drainAndReload(page, "valid");
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
  expect(await jobCount(user.id)).toBe(2);
});

test("S06 provider outage offers Retry and manual creation; Retry recovers", async ({ page }, testInfo) => {
  const user = await createUser("T14 Outage Owner", { consent: true });
  await signIn(page, user);
  await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "unavailable");

  await expect(panel(page)).toContainText("Analysis did not finish");
  await expect(panel(page)).toContainText("The AI service is unavailable right now.");
  await expect(panel(page).getByRole("link", { name: "Create achievement manually" })).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "s06-failed");

  await panel(page).getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel(page)).toContainText("Waiting to start");
  await drainAndReload(page, "valid");
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
});

test("S06 malformed provider output is rejected and never applied", async ({ page }) => {
  const user = await createUser("T14 Malformed Owner", { consent: true });
  await signIn(page, user);
  await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "malformed");

  await expect(panel(page)).toContainText("The AI returned a result that could not be used.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("link", { name: "Create achievement manually" })).toBeVisible();
});

test("S06 no-potential result leaves the activity in the log", async ({ page }) => {
  const user = await createUser("T14 NoPotential Owner", { consent: true });
  await signIn(page, user);
  await captureNote(page, `Team lunch ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "no_potential");
  await expect(panel(page)).toContainText("No achievement detected. This activity stays in your log.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);
});

test("S06 editing the note while a job is queued marks the result stale", async ({ page }) => {
  const user = await createUser("T14 Stale Owner", { consent: true });
  await signIn(page, user);
  const activityId = await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await editNote(user, activityId, `Migrated 5 reports ${randomUUID()}`);
  await drainAiWorker("valid");
  await page.reload();
  await expect(panel(page)).toContainText("This activity changed after analysis. The earlier suggestion no longer applies.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Analyze again", exact: true })).toBeVisible();
});

test("S08 a newer suggestion never overwrites an edited draft", async ({ page }, testInfo) => {
  const user = await createUser("T14 Aside Owner", { consent: true });
  await signIn(page, user);
  const activityId = await captureNote(page, `Migrated 3 reports ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "valid");
  await panel(page).getByRole("button", { name: "Skip questions", exact: true }).click();
  await panel(page).getByRole("button", { name: "Review as draft", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");

  const edited = "My own wording for the migration";
  await page.getByLabel("Title", { exact: true }).fill(edited);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(edited);
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(edited);

  await editNote(user, activityId, `Migrated 6 reports ${randomUUID()}`);
  await page.goto(`/activity/${activityId}`);
  await analyze(page);
  await drainAndReload(page, "valid");
  await expect(panel(page)).toContainText("This draft was edited since the suggestion was applied. Review it directly to update it.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);

  await panel(page).getByRole("link", { name: "Open Achievement", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  const aside = page.getByTestId("ai-suggestion-aside");
  await expect(aside).toBeVisible();
  await expect(aside).toContainText("AI suggestion (not applied)");
  await expect(aside).toContainText("Delivered the described work");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(edited);
  await expectNoWcagViolations(page, testInfo, "s08-aside");
});

test("S06 in Bahasa Indonesia: consent, waiting state, question and review", async ({ page }, testInfo) => {
  const user = await createUser("T14 Pemilik Saran", { locale: "id", consent: true });
  await signIn(page, user);
  await captureNote(page, `Memigrasikan 3 laporan ${randomUUID()}`);
  await expect(panel(page).getByRole("heading", { name: "Saran AI" })).toBeVisible();
  await analyze(page);
  await expect(panel(page)).toContainText("Menunggu dimulai");
  await drainAndReload(page, "valid");
  await expect(panel(page).getByRole("heading", { name: "Catatan Anda" })).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Kalimat yang disarankan" })).toBeVisible();
  await expect(panel(page).getByLabel("Apa hasilnya?")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Tinjau sebagai draf", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Lewati pertanyaan", exact: true })).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "s06-suggestion-id");
});

test("S06 layouts at 360 and 1440 in light and dark stay within the viewport", async ({ page }, testInfo) => {
  const user = await createUser("T14 Layout Owner", { consent: true });
  await signIn(page, user);
  const activityId = await captureNote(page, `Migrated 3 reports to the new pipeline ${randomUUID()}`);
  await analyze(page);
  await drainAndReload(page, "with_skills");
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();

  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
      await page.goto(`/activity/${activityId}`);
      await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
      await expectNoOverflow(page, `s06-${width}-${theme}`);
      await expectNoWcagViolations(page, testInfo, `s06-${width}-${theme}`);
      await panel(page).scrollIntoViewIfNeeded();
      await testInfo.attach(`s06-${width}-${theme}`, { body: await page.screenshot(), contentType: "image/png" });
    }
  }
});
