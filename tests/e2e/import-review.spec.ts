import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { CV_LINES, cvPdf } from "../import-fixtures";
import { expectEveryFieldErrorAssociated, expectNoWcagViolations } from "./helpers/accessibility";
import { drainImportWorker, type ImportWorkerScenario } from "./helpers/import-worker";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3010";
const CONSENT_VERSION = "ai-processing-v1";
const CONTENT_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";
const FILENAME_SENTINEL = `WP-FILENAME-SENTINEL-${randomUUID()}`;
const FILLER = [
  "Pengalaman kerja di bidang analitik data untuk tim produk dan operasional perusahaan.",
  "Ringkasan tambahan untuk kebutuhan uji peninjauan impor CV berbahasa Indonesia.",
];
const HEAD = CV_LINES[0]!;

let admin: Client;
let publishableKey: string;
let supabaseUrl: string;
const users: User[] = [];

function config(): { url: string; secretKey: string; publicKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

async function asUser(user: User): Promise<Client> {
  const client = createClient<Database>(supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  if ((await client.auth.signInWithPassword({ email: user.email, password: user.password })).error) throw new Error("T17 fixture sign-in failed");
  return client;
}

async function createUser(options: { locale?: "en" | "id"; onboarded?: boolean; name?: string } = {}): Promise<User> {
  const email = `t17-review-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("T17 browser fixture setup failed");
  const profile = await admin.from("profiles").update({
    locale: options.locale ?? "en", ai_consent_at: new Date().toISOString(), ai_consent_version: CONSENT_VERSION,
  }).eq("id", id);
  if (profile.error) throw new Error("T17 browser fixture profile setup failed");
  const user = { id, email, password };
  users.push(user);
  if (options.onboarded) {
    const client = await asUser(user);
    const { data } = await client.from("profiles").select("revision").eq("id", id).single();
    const done = await client.rpc("complete_onboarding", {
      p_display_name: options.name ?? "Owner Existing", p_locale: options.locale ?? "en", p_timezone: "Asia/Jakarta", p_expected_revision: data!.revision,
    });
    if (done.error) throw new Error("T17 onboarding fixture failed");
  }
  return user;
}

async function createSkill(client: Client, name: string) {
  const { data, error } = await client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error("T17 skill fixture failed");
  return row;
}

async function createExperience(client: Client, organization: string, roleTitle: string) {
  const { data, error } = await client.rpc("create_experience_idempotent", {
    p_operation_key: randomUUID(), p_organization: organization, p_role_title: roleTitle, p_description: null as never, p_kind: "employment",
    p_start_date: null as never, p_start_precision: null as never, p_end_date: null as never, p_end_precision: null as never, p_is_current: false,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) throw new Error("T17 experience fixture failed");
  return row;
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in?returnTo=%2Fonboarding%2Fimport");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);
}

async function batches(userId: string) {
  const { data, error } = await admin.from("import_batches").select("id, status, revision").eq("user_id", userId).order("created_at");
  if (error) throw new Error("T17 batch read failed");
  return data ?? [];
}

async function experienceRows(userId: string) {
  const { data, error } = await admin.from("experiences").select("*").eq("user_id", userId);
  if (error) throw new Error("T17 experiences read failed");
  return data ?? [];
}
async function educationRows(userId: string) {
  const { data, error } = await admin.from("education").select("*").eq("user_id", userId);
  if (error) throw new Error("T17 education read failed");
  return data ?? [];
}
async function skillRows(userId: string) {
  const { data, error } = await admin.from("skills").select("*").eq("user_id", userId);
  if (error) throw new Error("T17 skills read failed");
  return data ?? [];
}
async function achievementRows(client: Client, userId: string) {
  const { data, error } = await client.from("achievements").select("*").eq("user_id", userId);
  if (error) throw new Error("T17 achievements read failed");
  return data ?? [];
}
const press = async (locator: Locator, page: Page, key: string) => {
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press(key);
};
const activate = (locator: Locator, page: Page) => press(locator, page, "Enter");
const toggle = (locator: Locator, page: Page) => press(locator, page, "Space");

async function chooseWithKeyboard(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dropzone = page.getByRole("button", { name: /CV file|File CV/ });
  await dropzone.focus();
  await expect(dropzone).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(file);
}

const card = (page: Page, excerpt: string) => page.locator("article.import-candidate").filter({ hasText: excerpt });
const cardStatus = (locator: Locator) => locator.locator(".import-persistence");

async function expectNoOverflow(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoWcagViolations(page, testInfo, name);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

/** Upload a synthetic CV in S02 with the keyboard, drain the worker and return the batch id of the ready batch. */
async function uploadAndExtract(page: Page, user: User, lines: string[], scenario: ImportWorkerScenario = "valid", keyboard = false) {
  const file = { name: `cv-${FILENAME_SENTINEL}.pdf`, mimeType: "application/pdf", buffer: cvPdf(1, [`${HEAD}-${randomUUID()}`, ...lines, ...FILLER]) };
  if (keyboard) await chooseWithKeyboard(page, file);
  else await page.locator('input[type="file"]').setInputFiles(file);
  const upload = page.getByRole("button", { name: "Upload and extract" });
  if (keyboard) await activate(upload, page);
  else await upload.click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  const worker = await drainImportWorker(scenario);
  expect(worker.claimed).toBeGreaterThan(0);
  expect(worker.output).not.toContain(CONTENT_SENTINEL);
  expect(worker.output).not.toContain(FILENAME_SENTINEL);
  const all = await batches(user.id);
  return { batchId: all.at(-1)!.id, output: worker.output };
}

async function openReview(page: Page, batchId: string) {
  await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });
  await activate(page.getByRole("link", { name: "Review candidates" }), page);
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}/review$`));
  await expect(page.getByRole("heading", { name: "Review imported data", level: 1 })).toBeVisible();
}

const reviewUrl = (batchId: string) => `/imports/${batchId}/review`;
const confirmButton = (page: Page) => page.getByRole("button", { name: /^Confirm import$/ });

function collectConsole(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message) => seen.push(message.text()));
  page.on("pageerror", (error) => seen.push(String(error)));
  return seen;
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

test("R02 release scenario: an Indonesian CV with overlapping employment is corrected, mapped, confirmed once and shown on dashboard and timeline (keyboard only)", async ({ page }, testInfo) => {
  const user = await createUser();
  const client = await asUser(user);
  await createSkill(client, "SQL");
  const seen = collectConsole(page);
  await signIn(page, user);

  const lines = [
    "EXP|PT Sentinel Nusantara|Analis Data|2019|2022",
    "EXP|WP Labs|Data Lead|2021|",
    "EDU|Universitas Contoh|S1 Statistika|2014|2018",
    "SKILL|SQL",
    "SKILL|Python",
    "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara",
    "ACH|Menyusun dashboard operasional|WP Labs",
  ];
  const { batchId, output } = await uploadAndExtract(page, user, lines, "valid", true);
  await expect(page.getByText("We found 7 candidate records")).toBeVisible();
  await snapshot(page, testInfo, "s02-review-ready");
  await openReview(page, batchId);

  // Correct one extracted field and save it explicitly.
  const analyst = card(page, "EXP|PT Sentinel Nusantara|Analis Data|2019|2022");
  await analyst.getByLabel("Role").fill("Analis Data Senior");
  await expect(cardStatus(analyst)).toHaveText("Unsaved edits");
  await expect(confirmButton(page)).toBeDisabled();
  await activate(analyst.getByRole("button", { name: "Save changes" }), page);
  await expect(cardStatus(analyst)).toHaveText("Saved");

  // The existing SQL skill: a blocking duplicate that Map resolves with one action.
  const sql = card(page, "SKILL|SQL");
  await expect(sql.getByText("This skill is already in your list.")).toBeVisible();
  await expect(page.getByText("Fix these before importing")).toBeVisible();
  await activate(sql.getByRole("button", { name: "Map to SQL" }), page);
  await expect(cardStatus(sql)).toHaveText("Saved");
  await expect(sql.getByRole("radio", { name: "Map to existing" })).toBeChecked();
  await expect(page.getByText("Fix these before importing")).toBeHidden();

  // Confirming an achievement needs its fields saved first; nothing is confirmed by default.
  const reportTime = card(page, "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Sentinel Nusantara");
  const confirmBox = reportTime.getByRole("checkbox", { name: "Confirm this achievement" });
  await expect(confirmBox).toBeDisabled();
  await expect(reportTime.getByText("To confirm, add and save: Contribution, Outcome, Achieved on.")).toBeVisible();
  await reportTime.getByLabel("Contribution").fill("Menyusun laporan otomatis");
  await reportTime.getByLabel("Outcome").fill("Waktu laporan turun dari 5 ke 2 jam");
  await reportTime.getByLabel("Achieved on").fill("2021-06-15");
  await activate(reportTime.getByRole("button", { name: "Save changes" }), page);
  await expect(cardStatus(reportTime)).toHaveText("Saved");
  await expect(confirmBox).toBeEnabled();
  await expect(confirmBox).not.toBeChecked();
  await toggle(confirmBox, page);
  await expect(confirmBox).toBeChecked();
  await expect(cardStatus(reportTime)).toHaveText("Saved");

  // Skip one candidate.
  const dashboardAchievement = card(page, "ACH|Menyusun dashboard operasional|WP Labs");
  await toggle(dashboardAchievement.getByRole("radio", { name: "Skip" }), page);
  await expect(dashboardAchievement.getByText("Skipped: this candidate will not be imported.")).toBeVisible();

  // A new user finishes onboarding through the same commit; the button waits for a real name.
  await expect(page.getByText("Enter your name to finish getting started.")).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();
  await page.locator("#import-onboarding-name").fill("Rina Sari");
  await page.locator("#import-onboarding-timezone").fill("Asia/Jakarta");
  await expect(page.getByText("Experience: 2 create · 0 map · 0 skip")).toBeVisible();
  await expect(page.getByText("Skills: 1 create · 1 map · 0 skip")).toBeVisible();
  await expect(page.getByText("Achievements to confirm: 1")).toBeVisible();
  await expect(confirmButton(page)).toBeEnabled();
  await snapshot(page, testInfo, "s03-review");

  await activate(confirmButton(page), page);
  const heading = page.getByRole("heading", { name: "Import saved" });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  await expect(heading).toBeFocused();
  await expect(page.getByText("Experience: 2 created · 0 mapped · 0 skipped")).toBeVisible();
  await expect(page.getByText("Skills: 1 created · 1 mapped · 0 skipped")).toBeVisible();
  await expect(page.getByText("Achievement candidates: 1 created · 0 mapped · 1 skipped")).toBeVisible();
  await expect(page.getByText("Confirmed achievements: 1")).toBeVisible();
  await snapshot(page, testInfo, "s03-committed");

  // The numbers on screen are the real rows, with the overlap intact.
  const experiences = await experienceRows(user.id);
  expect(experiences).toHaveLength(2);
  expect(experiences.map((row) => row.role_title).sort()).toEqual(["Analis Data Senior", "Data Lead"]);
  expect(await educationRows(user.id)).toHaveLength(1);
  expect((await skillRows(user.id)).map((row) => row.name).sort()).toEqual(["Python", "SQL"]);
  const achievements = await achievementRows(client, user.id);
  expect(achievements).toHaveLength(1);
  expect(achievements[0]).toMatchObject({ status: "confirmed", origin: "import", achieved_on: "2021-06-15" });
  const profile = await admin.from("profiles").select("display_name, onboarding_completed_at").eq("id", user.id).single();
  expect(profile.data?.display_name).toBe("Rina Sari");
  expect(profile.data?.onboarding_completed_at).not.toBeNull();

  await activate(page.getByRole("link", { name: "Open dashboard" }), page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("link", { name: "Confirmed achievements 1" })).toBeVisible();
  await page.goto("/timeline");
  await expect(page.getByText("Analis Data Senior").first()).toBeVisible();
  await expect(page.getByText("Data Lead").first()).toBeVisible();

  const browserText = seen.join("\n");
  expect(browserText).not.toContain(CONTENT_SENTINEL);
  expect(browserText).not.toContain(FILENAME_SENTINEL);
  expect(output).not.toContain(FILENAME_SENTINEL);
});

test("double click on Confirm import and reloading the saved result never add rows", async ({ page }) => {
  const user = await createUser();
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["SKILL|Rust"]);
  await openReview(page, batchId);
  await page.locator("#import-onboarding-name").fill("Dewi Nyata");

  await expect(confirmButton(page)).toBeEnabled();
  await confirmButton(page).dblclick();
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  expect(await skillRows(user.id)).toHaveLength(1);
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "committed" })]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible();
  await expect(page.getByText("Skills: 1 created · 0 mapped · 0 skipped")).toBeVisible();
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible();
  await expect(page.getByText("Skills: 1 created · 0 mapped · 0 skipped")).toBeVisible();
  expect(await skillRows(user.id)).toHaveLength(1);
  const profile = await admin.from("profiles").select("display_name").eq("id", user.id).single();
  expect(profile.data?.display_name).toBe("Dewi Nyata");
});

test("choices and fields survive a refresh, and unsaved edits ask before leaving", async ({ page }) => {
  const user = await createUser();
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["EXP|Refresh Nusantara|Analis|2018|2019", "SKILL|Elixir"]);
  await openReview(page, batchId);

  const skill = card(page, "SKILL|Elixir");
  await toggle(skill.getByRole("radio", { name: "Skip" }), page);
  await expect(cardStatus(skill)).toHaveText("Saved");
  await page.locator("#import-onboarding-name").fill("Dewi Refresh");

  const experience = card(page, "EXP|Refresh Nusantara|Analis|2018|2019");
  await experience.getByLabel("Role").fill("Analis Baru");
  await expect(cardStatus(experience)).toHaveText("Unsaved edits");
  await expect(page.getByText("1 candidate(s) have unsaved edits. Save or discard them.")).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();

  // Leaving with unsaved edits asks first; staying keeps the local value.
  await page.getByRole("link", { name: "Start manually" }).click();
  const dialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${batchId}/review$`));
  await expect(experience.getByLabel("Role")).toHaveValue("Analis Baru");

  await activate(experience.getByRole("button", { name: "Save changes" }), page);
  await expect(cardStatus(experience)).toHaveText("Saved");

  await page.reload();
  await expect(card(page, "SKILL|Elixir").getByRole("radio", { name: "Skip" })).toBeChecked();
  await expect(card(page, "EXP|Refresh Nusantara|Analis|2018|2019").getByLabel("Role")).toHaveValue("Analis Baru");
  await expect(page.locator("#import-onboarding-name")).toHaveValue("Dewi Refresh");
  await expect(confirmButton(page)).toBeEnabled();
});

test("partial extraction highlights the missing field and keeps Confirm import disabled until it is fixed", async ({ page }, testInfo) => {
  const user = await createUser({ onboarded: true });
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["EXP|Parsial Satu|Analis|2018|2019", "EXP|Parsial Dua|Analis|2019|2020", "SKILL|Kotlin"], "import_partial");
  await openReview(page, batchId);

  const first = card(page, "EXP|Parsial Satu|Analis|2018|2019");
  const second = card(page, "EXP|Parsial Dua|Analis|2019|2020");
  await expect(first.getByLabel("Role")).toHaveAttribute("aria-invalid", "true");
  await expect(first.getByText("This field is required.")).toBeVisible();
  await expect(page.getByText("2 selected candidate(s) need fixing.")).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();
  await expectEveryFieldErrorAssociated(page);
  await snapshot(page, testInfo, "s03-errors");

  // The error summary links to the field.
  await page.getByRole("link", { name: /Experience 1: Role/ }).click();
  await expect(first.getByLabel("Role")).toBeFocused();

  await first.getByLabel("Role").fill("Analis Satu");
  await activate(first.getByRole("button", { name: "Save changes" }), page);
  await expect(cardStatus(first)).toHaveText("Saved");
  await expect(page.getByText("1 selected candidate(s) need fixing.")).toBeVisible();
  await expect(confirmButton(page)).toBeDisabled();
  await second.getByLabel("Role").fill("Analis Dua");
  await activate(second.getByRole("button", { name: "Save changes" }), page);
  await expect(cardStatus(second)).toHaveText("Saved");
  await expect(confirmButton(page)).toBeEnabled();
  await activate(confirmButton(page), page);
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  expect((await experienceRows(user.id)).map((row) => row.role_title).sort()).toEqual(["Analis Dua", "Analis Satu"]);
});

test("two tabs: a stale save keeps the local input and shows the server value; a stale commit does not commit", async ({ page, context }, testInfo) => {
  const user = await createUser({ onboarded: true });
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["EXP|Dua Tab Satu|Analis|2018|2019", "EXP|Dua Tab Dua|Analis|2019|2020", "SKILL|Scala"]);
  await openReview(page, batchId);

  const other = await context.newPage();
  await other.goto(reviewUrl(batchId));
  await expect(other.getByRole("heading", { name: "Review imported data", level: 1 })).toBeVisible();

  const otherFirst = card(other, "EXP|Dua Tab Satu|Analis|2018|2019");
  await otherFirst.getByLabel("Role").fill("Dari tab dua");
  await activate(otherFirst.getByRole("button", { name: "Save changes" }), other);
  await expect(cardStatus(otherFirst)).toHaveText("Saved");

  const first = card(page, "EXP|Dua Tab Satu|Analis|2018|2019");
  await first.getByLabel("Role").fill("Dari tab satu");
  await activate(first.getByRole("button", { name: "Save changes" }), page);
  await expect(first.getByText("This candidate changed elsewhere")).toBeVisible();
  await expect(cardStatus(first)).toHaveText("Changed elsewhere");
  await expect(first.getByLabel("Role")).toHaveValue("Dari tab satu");
  await snapshot(page, testInfo, "s03-conflict");

  // Reload shows the server value beside the kept local edit; nothing was overwritten silently.
  await first.getByRole("button", { name: "Reload latest" }).click();
  await expect(first.getByText("Saved on server: Dari tab dua")).toBeVisible();
  await expect(first.getByLabel("Role")).toHaveValue("Dari tab satu");
  await first.getByRole("button", { name: "Discard edits" }).click();
  await expect(first.getByLabel("Role")).toHaveValue("Dari tab dua");
  const saved = await admin.from("import_items").select("payload").eq("batch_id", batchId).eq("entity_type", "experience").order("ordinal");
  expect((saved.data?.[0]?.payload as { role_title?: string }).role_title).toBe("Dari tab dua");

  // Another tab changes the batch after this tab's last sync: the commit must not go through.
  const otherSecond = card(other, "EXP|Dua Tab Dua|Analis|2019|2020");
  await otherSecond.getByLabel("Role").fill("Dari tab dua lagi");
  await activate(otherSecond.getByRole("button", { name: "Save changes" }), other);
  await expect(cardStatus(otherSecond)).toHaveText("Saved");

  await expect(confirmButton(page)).toBeEnabled();
  await activate(confirmButton(page), page);
  await expect(page.getByText("This import changed elsewhere. We reloaded the latest choices. Check them and confirm again.")).toBeVisible();
  expect(await experienceRows(user.id)).toHaveLength(0);
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "review" })]);
  await expect(card(page, "EXP|Dua Tab Dua|Analis|2019|2020").getByLabel("Role")).toHaveValue("Dari tab dua lagi");

  // In sync again: the commit succeeds once.
  await activate(confirmButton(page), page);
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  expect(await experienceRows(user.id)).toHaveLength(2);
});

test("a save that reveals a change from another tab reloads before this tab can commit (RV1)", async ({ page, context }) => {
  const user = await createUser({ onboarded: true });
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["EXP|Sinkron Satu|Analis|2018|2019", "EXP|Sinkron Dua|Analis|2019|2020"]);
  await openReview(page, batchId);

  const other = await context.newPage();
  await other.goto(reviewUrl(batchId));
  await expect(other.getByRole("heading", { name: "Review imported data", level: 1 })).toBeVisible();

  // The other tab skips the first candidate; this tab still shows it as Create new.
  const otherFirst = card(other, "EXP|Sinkron Satu|Analis|2018|2019");
  await otherFirst.getByRole("radio", { name: "Skip" }).click();
  await expect(cardStatus(otherFirst)).toHaveText("Saved");
  await expect(otherFirst.getByRole("radio", { name: "Skip" })).toBeChecked();
  const first = card(page, "EXP|Sinkron Satu|Analis|2018|2019");
  await expect(first.getByRole("radio", { name: "Create new" })).toBeChecked();

  // This tab saves a different candidate: the receipt shows the batch moved further than its own save.
  const second = card(page, "EXP|Sinkron Dua|Analis|2019|2020");
  await second.getByLabel("Role").fill("Analis Sinkron");
  await activate(second.getByRole("button", { name: "Save changes" }), page);
  await expect(page.getByText("This import also changed in another tab or window.", { exact: false })).toBeVisible();
  await expect(first.getByRole("radio", { name: "Skip" })).toBeChecked();
  expect(await experienceRows(user.id)).toHaveLength(0);

  // Now the tab shows what will be committed: one experience created, the skipped one not.
  await activate(confirmButton(page), page);
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  const rows = await experienceRows(user.id);
  expect(rows.map((row) => row.role_title)).toEqual(["Analis Sinkron"]);
});

test("empty extraction offers manual entry as the primary action and lets the user cancel the import", async ({ page }, testInfo) => {
  const user = await createUser();
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["Tidak ada data terstruktur di sini."], "import_empty");
  await expect(page.getByRole("status")).toHaveText("No career data found", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Start manually" })).toHaveClass(/button-primary/);

  await page.goto(reviewUrl(batchId));
  await expect(page.getByRole("heading", { name: "Nothing to review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start manually" })).toHaveAttribute("href", "/settings/profile?mode=onboarding");
  await expect(page.getByRole("link", { name: "Start manually" })).toHaveClass(/button-primary/);
  await snapshot(page, testInfo, "s03-empty");

  await page.getByRole("button", { name: "Cancel import" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this import?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel import" }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await expect(page.getByText("PDF or DOCX, up to 10 MiB and 20 pages")).toBeVisible();
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "cancelled" })]);
});

test("a returning user imports from Settings, maps an existing experience and leaves the existing rows unchanged", async ({ page }) => {
  const user = await createUser({ onboarded: true, name: "Owner Lama" });
  const client = await asUser(user);
  const existingSkill = await createSkill(client, "SQL");
  const existingExperience = await createExperience(client, "PT Lama Sentosa", "Staf");
  const before = { skill: (await admin.from("skills").select("*").eq("id", existingSkill.id).single()).data, experience: (await admin.from("experiences").select("*").eq("id", existingExperience.id).single()).data };

  await signIn(page, user);
  await page.goto("/settings/profile");
  await page.getByRole("link", { name: "Import CV" }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await expect(page.getByRole("heading", { name: "Import a CV", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start manually" })).toHaveAttribute("href", "/settings/profile");

  const { batchId } = await uploadAndExtract(page, user, ["EXP|PT Lama Sentosa|Staf|2015|2018", "SKILL|SQL", "SKILL|Go"]);
  await openReview(page, batchId);
  await expect(page.getByText("Your details")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start manually" })).toHaveAttribute("href", "/settings/profile");

  const experience = card(page, "EXP|PT Lama Sentosa|Staf|2015|2018");
  await expect(experience.getByText("Possible duplicate of Staf · PT Lama Sentosa.")).toBeVisible();
  await activate(experience.getByRole("button", { name: "Map to Staf · PT Lama Sentosa" }), page);
  await expect(cardStatus(experience)).toHaveText("Saved");
  await expect(experience.getByText("The existing record is kept unchanged.")).toBeVisible();
  await activate(card(page, "SKILL|SQL").getByRole("button", { name: "Map to SQL" }), page);
  await expect(cardStatus(card(page, "SKILL|SQL"))).toHaveText("Saved");

  await expect(confirmButton(page)).toBeEnabled();
  await activate(confirmButton(page), page);
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Experience: 0 created · 1 mapped · 0 skipped")).toBeVisible();
  await expect(page.getByText("Skills: 1 created · 1 mapped · 0 skipped")).toBeVisible();

  expect(await experienceRows(user.id)).toHaveLength(1);
  const after = { skill: (await admin.from("skills").select("*").eq("id", existingSkill.id).single()).data, experience: (await admin.from("experiences").select("*").eq("id", existingExperience.id).single()).data };
  expect(after).toEqual(before);
  expect((await skillRows(user.id)).map((row) => row.name).sort()).toEqual(["Go", "SQL"]);
});

test("another account and an anonymous visitor cannot see a batch, and no candidate text or file name leaks", async ({ page }) => {
  const owner = await createUser();
  const intruder = await createUser({ onboarded: true });
  const seen = collectConsole(page);
  await signIn(page, owner);
  const { batchId, output } = await uploadAndExtract(page, owner, ["EXP|Rahasia Nusantara|Analis|2018|2019", "SKILL|Rahasia"]);
  await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });

  await page.context().clearCookies();
  const anonymous = await page.goto(reviewUrl(batchId));
  expect(anonymous?.url()).toContain("/sign-in");
  expect(anonymous?.url()).toContain(encodeURIComponent(reviewUrl(batchId)));
  const anonymousApi = await page.request.get(`/api/imports/${batchId}/review`);
  expect(anonymousApi.status()).toBe(401);

  await signIn(page, intruder);
  // The streamed page has already sent its status when the not-found boundary renders, so compare the content.
  await page.goto(reviewUrl(batchId));
  const foreignHeading = await page.getByRole("heading", { level: 1 }).allTextContents();
  await page.goto(reviewUrl(randomUUID()));
  const missingHeading = await page.getByRole("heading", { level: 1 }).allTextContents();
  expect(foreignHeading).toEqual(missingHeading);
  expect(foreignHeading.join()).not.toContain("Review imported data");
  await expect(page.getByText("Rahasia")).toHaveCount(0);
  const foreignApi = await page.request.get(`/api/imports/${batchId}/review`);
  const missingApi = await page.request.get(`/api/imports/${randomUUID()}/review`);
  expect(foreignApi.status()).toBe(404);
  expect(missingApi.status()).toBe(404);
  const foreignBody = await foreignApi.text();
  expect(JSON.parse(foreignBody)).toMatchObject({ code: "NOT_FOUND" });
  expect(Object.keys(JSON.parse(foreignBody)).sort()).toEqual(Object.keys(JSON.parse(await missingApi.text())).sort());
  expect(foreignBody).not.toContain("Rahasia");
  expect(foreignBody).not.toContain(FILENAME_SENTINEL);

  const text = [seen.join("\n"), output, foreignBody, await page.content()].join("\n");
  expect(text).not.toContain(CONTENT_SENTINEL);
  expect(text).not.toContain(FILENAME_SENTINEL);
  expect(text).not.toContain("Rahasia Nusantara");
});

test("S03 stays inside the viewport at 360 and 1440 in light and dark, including the saved result", async ({ page }, testInfo) => {
  const user = await createUser();
  const client = await asUser(user);
  await createSkill(client, "SQL");
  await signIn(page, user);
  const { batchId } = await uploadAndExtract(page, user, ["EXP|Layout Nusantara|Analis|2018|2019", "SKILL|SQL", "ACH|Merapikan tata letak laporan|Layout Nusantara"]);
  await openReview(page, batchId);

  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
      await page.goto(reviewUrl(batchId));
      await expect(page.getByRole("heading", { name: "Review imported data", level: 1 })).toBeVisible();
      await expect(page.getByText("Fix these before importing")).toBeVisible();
      await expectNoOverflow(page, `s03-${width}-${theme}`);
      await snapshot(page, testInfo, `s03-${width}-${theme}`);
    }
  }

  // Resolve the duplicate, commit, and check the saved result in the narrowest dark layout.
  await page.setViewportSize({ width: 360, height: 800 });
  await activate(card(page, "SKILL|SQL").getByRole("button", { name: "Map to SQL" }), page);
  await expect(cardStatus(card(page, "SKILL|SQL"))).toHaveText("Saved");
  await page.locator("#import-onboarding-name").fill("Tata Letak");
  await expect(confirmButton(page)).toBeEnabled();
  await activate(confirmButton(page), page);
  await expect(page.getByRole("heading", { name: "Import saved" })).toBeVisible({ timeout: 30_000 });
  await expectNoOverflow(page, "s03-committed-360-dark");
  await snapshot(page, testInfo, "s03-committed-360-dark");
});
