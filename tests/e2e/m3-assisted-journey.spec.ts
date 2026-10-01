import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { CV_LINES, cvDocx, cvPdf, DOCX_MIME } from "../import-fixtures";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainAiWorker } from "./helpers/ai-worker";
import { drainImportWorker } from "./helpers/import-worker";

/**
 * Gate M3 (Assisted entry): one new user goes through F01 import and F02 assisted capture in
 * the browser, with the real worker process (explicit fake AI provider, real ClamAV), across
 * malformed file, AI unavailable + retry, stale result and consent withdrawal.
 */

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const CONTENT_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";
const NOTE_SENTINEL = `WP-M3-NOTE-${randomUUID()}`;
const FILENAME_SENTINEL = `WP-M3-FILENAME-${randomUUID()}`;
let admin: Client;
let supabaseUrl: string;
let publishableKey: string;
const users: User[] = [];

function config(): { url: string; secretKey: string; publicKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

/** A brand-new account: no display name, no onboarding, no AI consent. */
async function createUser(): Promise<User> {
  const email = `m3-journey-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("M3 browser fixture setup failed");
  const user = { id, email, password };
  users.push(user);
  return user;
}

/** Owner-scoped reads (service_role has no SELECT on activities/achievements). */
async function asOwner<T>(user: User, read: (client: Client) => Promise<T>): Promise<T> {
  const client = createClient<Database>(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  if ((await client.auth.signInWithPassword({ email: user.email, password: user.password })).error) throw new Error("M3 owner sign-in failed");
  try {
    return await read(client);
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

/** Edits the note through the same RPC the activity editor uses (a second session, e.g. another tab). */
async function editNote(user: User, activityId: string, rawText: string) {
  await asOwner(user, async (client) => {
    const current = await client.from("activities").select("revision, occurred_on, role, scope, outcome, experience_id, project_id").eq("id", activityId).single();
    if (current.error || !current.data) throw new Error("M3 activity read failed");
    const { revision, ...fields } = current.data;
    const updated = await client.rpc("update_activity", { p_activity_id: activityId, p_expected_revision: revision, p_changes: { ...fields, raw_text: rawText } });
    if (updated.error) throw new Error("M3 activity edit failed");
  });
}

async function batches(userId: string) {
  const { data, error } = await admin.from("import_batches").select("id, status, error_code, retry_count").eq("user_id", userId).order("created_at");
  if (error) throw new Error("M3 batch read failed");
  return data ?? [];
}

async function jobs(userId: string) {
  const { data, error } = await admin.from("ai_jobs").select("id, kind, status, error_code").eq("user_id", userId).order("created_at");
  if (error) throw new Error("M3 job read failed");
  return data ?? [];
}

async function captureNote(page: Page, note: string): Promise<string> {
  await page.goto("/activity/new");
  await page.locator("#quick-log-note").fill(note);
  await page.locator("#quick-log-note-form button[type='submit']").click();
  await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

const panel = (page: Page) => page.getByTestId("ai-analysis-panel");
const card = (page: Page, excerpt: string) => page.locator("article.import-candidate").filter({ hasText: excerpt });

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoWcagViolations(page, testInfo, name);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function confirmedCount(page: Page, count: number) {
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: `Confirmed achievements ${count}` })).toBeVisible();
}

test.beforeAll(() => {
  const { url, secretKey, publicKey } = config();
  supabaseUrl = url;
  publishableKey = publicKey;
  admin = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
});

test.afterAll(async () => {
  for (const user of users) {
    const { data } = await admin.storage.from("workpulse-private").list(`${user.id}/import`);
    if (data?.length) await admin.storage.from("workpulse-private").remove(data.map((object) => `${user.id}/import/${object.name}`));
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("M3 journey: import through an AI outage and retry, onboarding by commit, assisted capture with a stale result, then consent withdrawal keeps manual entry", async ({ page }, testInfo) => {
  const user = await createUser();
  const browserLog: string[] = [];
  page.on("console", (message) => browserLog.push(message.text()));
  page.on("pageerror", (error) => browserLog.push(String(error)));
  let workerOutput = "";

  // 1. F01 entry for a new user: S02, consent is asked on the first upload.
  await page.goto("/sign-in?returnTo=%2Fonboarding%2Fimport");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);

  const valid = { name: `cv-${FILENAME_SENTINEL}.pdf`, mimeType: "application/pdf", buffer: cvPdf(1, [...CV_LINES, `Journey ${randomUUID()}`]) };
  await page.locator('input[type="file"]').setInputFiles(valid);
  await page.getByRole("button", { name: "Upload and extract" }).click();
  const consent = page.getByRole("dialog", { name: "Allow AI processing?" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "Allow AI", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");

  // 2. AI unavailable: the batch fails as retriable, manual entry stays offered, Retry reuses the batch.
  workerOutput += (await drainImportWorker("unavailable")).output;
  await expect(page.getByRole("status")).toHaveText("Extraction did not finish", { timeout: 30_000 });
  await expect(page.getByText("The AI service could not extract data from this file right now.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start manually" })).toBeVisible();
  await snapshot(page, testInfo, "m3-s02-ai-unavailable");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toHaveText("Extracting career data");
  workerOutput += (await drainImportWorker("valid")).output;
  await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "review", retry_count: 1 })]);

  // 3. Leave and return: the saved batch is still the only one and is ready for review.
  await page.goto("/onboarding/import");
  await expect(page.getByRole("link", { name: "Review candidates" })).toBeVisible();
  const batchId = (await batches(user.id))[0]!.id;

  // 4. S03: correct and confirm one achievement explicitly, onboard through the commit.
  await page.getByRole("link", { name: "Review candidates" }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}/review$`));
  const achievement = card(page, "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara");
  await achievement.getByLabel("Contribution").fill("Menyusun laporan otomatis");
  await achievement.getByLabel("Outcome").fill("Waktu laporan turun dari 5 ke 2 jam");
  await achievement.getByLabel("Achieved on").fill("2021-06-15");
  await achievement.getByRole("button", { name: "Save changes" }).click();
  await expect(achievement.locator(".import-persistence")).toHaveText("Saved");
  // The choice is persisted before the box reflects it, so wait for the saved state instead of check().
  const confirmBox = achievement.getByRole("checkbox", { name: "Confirm this achievement" });
  await confirmBox.click();
  await expect(confirmBox).toBeChecked();
  await expect(achievement.locator(".import-persistence")).toHaveText("Saved");
  await page.locator("#import-onboarding-name").fill("Sekar Wulan");
  await page.locator("#import-onboarding-timezone").fill("Asia/Jakarta");
  await page.getByRole("button", { name: /^Confirm import$/ }).click();
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeFocused({ timeout: 30_000 });
  await expect(page.getByText("Confirmed achievements: 1")).toBeVisible();
  await page.getByRole("link", { name: "Open dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Confirmed achievements 1" })).toBeVisible();

  // 5. F02 assisted: consent from the import already applies; an edit while queued makes the result stale.
  const activityId = await captureNote(page, `Migrated 3 reports to the new pipeline. ${NOTE_SENTINEL}`);
  await panel(page).getByRole("button", { name: "Analyze with AI", exact: true }).click();
  await expect(panel(page)).toContainText("Waiting to start");
  await editNote(user, activityId, `Migrated 4 reports to the new pipeline. ${NOTE_SENTINEL}`);
  expect(await drainAiWorker("valid")).toBeGreaterThan(0);
  await page.reload();
  await expect(panel(page)).toContainText("This activity changed after analysis. The earlier suggestion no longer applies.");
  await expect(panel(page).getByRole("button", { name: "Review as draft", exact: true })).toHaveCount(0);
  await snapshot(page, testInfo, "m3-s06-stale");

  await panel(page).getByRole("button", { name: "Analyze again", exact: true }).click();
  await expect(panel(page)).toContainText("Waiting to start");
  expect(await drainAiWorker("valid")).toBeGreaterThan(0);
  await page.reload();
  await expect(panel(page).getByRole("heading", { name: "Suggested wording" })).toBeVisible();
  await panel(page).getByRole("button", { name: "Review as draft", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Delivered the described work");
  await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
  await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
  await confirmedCount(page, 2);

  // 6. Consent withdrawn while an analysis waits: the queued job is refused, Retry is disabled with a reason, manual entry works.
  const secondId = await captureNote(page, `Onboarded 2 new analysts. ${NOTE_SENTINEL}`);
  await panel(page).getByRole("button", { name: "Analyze with AI", exact: true }).click();
  await expect(panel(page)).toContainText("Waiting to start");
  await page.goto("/settings/profile");
  const consentCard = page.locator("#ai-consent-form");
  await consentCard.getByRole("button", { name: "Withdraw consent" }).click();
  await consentCard.getByRole("button", { name: "Withdraw now" }).click();
  await expect(page.getByTestId("ai-consent-status")).toHaveText("Not allowed");
  await drainAiWorker("valid");
  const secondJob = (await jobs(user.id)).at(-1)!;
  expect(secondJob).toMatchObject({ kind: "detect", status: "failed", error_code: "CONSENT_REQUIRED" });

  await page.goto(`/activity/${secondId}`);
  await expect(panel(page)).toContainText("Analysis did not finish");
  await expect(panel(page)).toContainText("Allow AI processing in Profile and settings before requesting analysis. Manual entry remains available.");
  await expect(panel(page).getByRole("button", { name: "Retry", exact: true })).toBeDisabled();
  await snapshot(page, testInfo, "m3-s06-consent-withdrawn");
  await panel(page).getByRole("link", { name: "Create achievement manually" }).click();
  await expect(page).toHaveURL(/\/achievements\/new\?/);
  await page.getByRole("button", { name: "New Achievement", exact: true }).click();
  await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Title", { exact: true }).fill("Onboarded two analysts");
  await page.getByLabel("Contribution", { exact: true }).fill("Planned and ran the onboarding for two new analysts");
  await page.getByLabel("Outcome", { exact: true }).fill("Both analysts shipped their first report in week two");
  await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-22");
  await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
  await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();

  // A fresh note after withdrawal is saved without any analysis or job.
  const jobsBefore = (await jobs(user.id)).length;
  const thirdId = await captureNote(page, `Reviewed the incident log. ${NOTE_SENTINEL}`);
  const third = await asOwner(user, async (client) => (await client.from("activities").select("analysis_state").eq("id", thirdId).single()).data);
  expect(third).toEqual({ analysis_state: "not_requested" });
  expect((await jobs(user.id)).length).toBe(jobsBefore);
  await confirmedCount(page, 3);

  // Totals: one imported confirmed, one assisted confirmed, one manual confirmed; the imported row is untouched.
  const rows = await asOwner(user, async (client) => (await client.from("achievements").select("origin, status, activity_id").eq("user_id", user.id)).data ?? []);
  expect(rows.filter((row) => row.status === "confirmed").map((row) => row.origin).sort()).toEqual(["activity", "activity", "import"]);
  expect(rows.find((row) => row.origin === "import")!.activity_id).toBeNull();

  // Nothing private reached the browser console or the worker output.
  for (const text of [browserLog.join("\n"), workerOutput]) {
    expect(text).not.toContain(CONTENT_SENTINEL);
    expect(text).not.toContain(NOTE_SENTINEL);
    expect(text).not.toContain(FILENAME_SENTINEL);
  }
});

test("M3 malformed and unsupported files are refused in S02 without creating a batch, for a user who already allowed AI", async ({ page }) => {
  const user = await createUser();
  await asOwner(user, async (client) => {
    const { data } = await client.from("profiles").select("revision").eq("id", user.id).single();
    const { error } = await client.rpc("set_ai_consent", { p_consented: true, p_expected_revision: data!.revision });
    if (error) throw new Error("M3 consent fixture failed");
  });
  await page.goto("/sign-in?returnTo=%2Fonboarding%2Fimport");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);

  await page.locator('input[type="file"]').setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from(`not a pdf ${CONTENT_SENTINEL}`) });
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.locator(".import-start [role='alert']")).toContainText("Only PDF and DOCX files are supported.");
  const docx = cvDocx();
  await page.locator('input[type="file"]').setInputFiles({ name: "cut.docx", mimeType: DOCX_MIME, buffer: docx.subarray(0, docx.length - 10) });
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.locator(".import-start [role='alert']")).toContainText("The file is damaged or could not be read.");
  expect(await batches(user.id)).toEqual([]);
  await expect(page.getByRole("link", { name: "Start manually" })).toBeVisible();
});
