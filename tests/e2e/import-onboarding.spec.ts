import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { CV_LINES, cvPdf, DOCX_MIME, emptyDocx, pdfFixture } from "../import-fixtures";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainImportWorker } from "./helpers/import-worker";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3009";
const CONSENT_VERSION = "ai-processing-v1";
const CONTENT_SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";
let admin: Client;
const users: User[] = [];

function config(): { url: string; secretKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey };
}

/** A new user who has not finished onboarding (S02 is only for them in T15). */
async function createUser(options: { locale?: "en" | "id"; consent?: boolean } = {}): Promise<User> {
  const email = `t15-import-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("T15 browser fixture setup failed");
  const profile = await admin.from("profiles").update({
    locale: options.locale ?? "en",
    ...(options.consent ? { ai_consent_at: new Date().toISOString(), ai_consent_version: CONSENT_VERSION } : {}),
  }).eq("id", id);
  if (profile.error) throw new Error("T15 browser fixture profile setup failed");
  const user = { id, email, password };
  users.push(user);
  return user;
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in?returnTo=%2Fonboarding%2Fimport");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/onboarding\/import$/);
}

async function batches(userId: string) {
  const { data, error } = await admin.from("import_batches").select("id, status, error_code").eq("user_id", userId).order("created_at");
  if (error) throw new Error("T15 batch read failed");
  return data ?? [];
}

/** Choose a file with the keyboard only: Tab to the drop area, Enter opens the chooser. */
async function chooseWithKeyboard(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dropzone = page.getByRole("button", { name: /CV file|File CV/ });
  await dropzone.focus();
  await expect(dropzone).toBeFocused();
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(file);
}

async function chooseFile(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.locator('input[type="file"]').setInputFiles(file);
}

const pdf = (name = "cv.pdf", bytes: Buffer = cvPdf(2)) => ({ name, mimeType: "application/pdf", buffer: bytes });

async function expectNoOverflow(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoWcagViolations(page, testInfo, name);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

test.beforeAll(() => {
  const { url, secretKey } = config();
  admin = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
});

test.afterAll(async () => {
  for (const user of users) {
    const { data } = await admin.storage.from("workpulse-private").list(`${user.id}/import`);
    if (data?.length) await admin.storage.from("workpulse-private").remove(data.map((object) => `${user.id}/import/${object.name}`));
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("S02 consent declined keeps the manual path and uploads nothing", async ({ page }, testInfo) => {
  const user = await createUser();
  await signIn(page, user);
  await expect(page.getByText("PDF or DOCX, up to 10 MiB and 20 pages")).toBeVisible();
  await snapshot(page, testInfo, "s02-choose");

  await chooseWithKeyboard(page, pdf());
  await expect(page.getByText("Selected: cv.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Upload and extract" }).click();
  const dialog = page.getByRole("dialog", { name: "Allow AI processing?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Only the text read from the CV you upload.");
  await expect(dialog.getByRole("button", { name: "Continue manually" })).toBeFocused();
  await snapshot(page, testInfo, "s02-consent");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "CV file. Press Enter or Space to choose a file." })).toBeFocused();
  expect(await batches(user.id)).toEqual([]);

  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  expect(await batches(user.id)).toEqual([]);
});

test("S02 allow, upload, leave and return, session expiry, then extraction finishes", async ({ page }, testInfo) => {
  const user = await createUser();
  await signIn(page, user);
  await chooseWithKeyboard(page, pdf());
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await page.getByRole("dialog", { name: "Allow AI processing?" }).getByRole("button", { name: "Allow AI" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await expect(page.getByText("You can leave this page")).toBeVisible();
  await snapshot(page, testInfo, "s02-waiting");

  // Leave and return: the same saved batch, no new one.
  await page.goto("/settings/profile?mode=onboarding");
  await page.goto("/onboarding/import");
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await expect(page.getByText("Saved import: cv.pdf")).toBeVisible();
  expect(await batches(user.id)).toHaveLength(1);

  // Session expiry: only saved server state resumes after signing in again.
  await page.context().clearCookies();
  await page.goto("/onboarding/import");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, user);
  await expect(page.getByText("Saved import: cv.pdf")).toBeVisible();

  const { claimed, output } = await drainImportWorker("valid");
  expect(claimed).toBeGreaterThan(0);
  expect(output).not.toContain(CONTENT_SENTINEL);
  expect(output).not.toContain("cv.pdf");
  await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });
  await expect(page.getByText("We found 7 candidate records")).toBeVisible();
  await expect(page.locator("dl.import-counts")).toContainText("Experience");
  await expect(page.locator('a[href*="/imports/"]')).toHaveCount(0);
  await snapshot(page, testInfo, "s02-review-ready");
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "review" })]);
});

test("S02 unsupported, password-protected and duplicate files", async ({ page }, testInfo) => {
  const user = await createUser({ consent: true });
  await signIn(page, user);

  await chooseFile(page, { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("plain text, not a pdf") });
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.locator(".import-start [role='alert']")).toContainText("Only PDF and DOCX files are supported.");
  expect(await batches(user.id)).toEqual([]);

  await chooseFile(page, pdf("locked.pdf", pdfFixture([CV_LINES], { encrypt: true })));
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await drainImportWorker("valid");
  await expect(page.getByRole("status")).toHaveText("This file could not be imported", { timeout: 30_000 });
  await expect(page.getByText("The file is password protected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start manually" })).toBeVisible();
  await snapshot(page, testInfo, "s02-failed-permanent");

  // Same bytes again under a new upload: non-blocking duplicate warning.
  const bytes = cvPdf(1, [...CV_LINES, `duplicate ${randomUUID()}`]);
  await page.getByRole("button", { name: "Try another file" }).click();
  await expect(page.getByRole("button", { name: "CV file. Press Enter or Space to choose a file." })).toBeFocused();
  await chooseFile(page, pdf("first.pdf", bytes));
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await page.getByRole("button", { name: "Cancel import" }).click();
  await page.getByRole("dialog", { name: "Cancel this import?" }).getByRole("button", { name: "Cancel import" }).click();
  await expect(page.getByRole("status")).toHaveText("Import cancelled");
  await page.getByRole("button", { name: "Try another file" }).click();
  await chooseFile(page, pdf("second.pdf", bytes));
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByText(/You already imported a file with the same content on/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
});

test("S02 transient AI failure offers Retry on the same batch", async ({ page }, testInfo) => {
  const user = await createUser({ consent: true });
  await signIn(page, user);
  await chooseFile(page, pdf());
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await drainImportWorker("unavailable");
  await expect(page.getByRole("status")).toHaveText("Extraction did not finish", { timeout: 30_000 });
  await expect(page.getByText("The AI service could not extract data from this file right now.")).toBeVisible();
  await snapshot(page, testInfo, "s02-failed-retriable");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toHaveText("Extracting career data");
  await drainImportWorker("valid");
  await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });
  expect(await batches(user.id)).toHaveLength(1);
});

test("S02 cancel while waiting keeps the batch cancelled after the worker runs", async ({ page }) => {
  const user = await createUser({ consent: true });
  await signIn(page, user);
  await chooseFile(page, pdf());
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  const trigger = page.getByRole("button", { name: "Cancel import" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Cancel this import?" });
  await expect(dialog.getByRole("button", { name: "Keep importing" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Cancel import" }).click();
  await expect(page.getByRole("status")).toHaveText("Import cancelled");
  await expect(page.getByText("Nothing was added to your career records.")).toBeVisible();
  await drainImportWorker("valid");
  await page.reload();
  expect(await batches(user.id)).toEqual([expect.objectContaining({ status: "cancelled" })]);
});

test("S02 empty extraction and Indonesian copy", async ({ page }, testInfo) => {
  const user = await createUser({ consent: true, locale: "id" });
  // Before onboarding completes, the interface language comes from the locale cookie (T03).
  await page.context().addCookies([{ name: "wp-locale", value: "id", url: BASE_URL }]);
  await signIn(page, user);
  await expect(page.getByText("PDF atau DOCX, maksimal 10 MiB dan 20 halaman")).toBeVisible();
  await chooseFile(page, { name: "kosong.docx", mimeType: DOCX_MIME, buffer: emptyDocx() });
  await page.getByRole("button", { name: "Unggah dan ekstrak" }).click();
  await expect(page.getByRole("status")).toHaveText("Menunggu dimulai");
  await drainImportWorker("valid");
  await expect(page.getByRole("status")).toHaveText("File ini tidak dapat diimpor", { timeout: 30_000 });
  await expect(page.getByText("Dokumen tidak berisi teks.")).toBeVisible();
  await snapshot(page, testInfo, "s02-failed-id");

  await page.getByRole("button", { name: "Coba file lain" }).click();
  await chooseFile(page, pdf("cv.pdf"));
  await page.getByRole("button", { name: "Unggah dan ekstrak" }).click();
  await expect(page.getByRole("status")).toHaveText("Menunggu dimulai");
  await drainImportWorker("import_empty");
  await expect(page.getByRole("status")).toHaveText("Tidak ada data karier", { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Mulai manual" })).toBeVisible();
  await snapshot(page, testInfo, "s02-empty-id");
});

test("S02 layouts at 360 and 1440 in light and dark stay within the viewport", async ({ page }, testInfo) => {
  const user = await createUser({ consent: true });
  await signIn(page, user);
  await chooseFile(page, pdf());
  await page.getByRole("button", { name: "Upload and extract" }).click();
  await expect(page.getByRole("status")).toHaveText("Waiting to start");
  await drainImportWorker("valid");
  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
      await page.goto("/onboarding/import");
      await expect(page.getByRole("status")).toHaveText("Extraction finished");
      await expectNoOverflow(page, `s02-${width}-${theme}`);
      await snapshot(page, testInfo, `s02-${width}-${theme}`);
    }
  }
});
