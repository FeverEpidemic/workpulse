import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string; client: Client };

const BASE_URL = "http://127.0.0.1:3012";
const SENTINEL = `WP-PRIVATE-CV-E2E-${randomUUID()}`;

let admin: Client;
let supabaseUrl: string;
let publishableKey: string;
const users: User[] = [];

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

async function createUser(): Promise<User> {
  const email = `t19-cv-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("T19 fixture user failed");
  const client = createClient<Database>(supabaseUrl, publishableKey, options);
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("T19 fixture sign-in failed");
  const profile = await client.from("profiles").select("revision").eq("id", id).single();
  const done = await client.rpc("complete_onboarding", {
    p_display_name: "Ani Contoh", p_locale: "en", p_timezone: "Asia/Jakarta", p_expected_revision: profile.data!.revision,
  });
  if (done.error) throw new Error("T19 onboarding fixture failed");
  const user = { id, email, password, client };
  users.push(user);
  return user;
}

const nul = null as never;

async function createEducation(user: User): Promise<string> {
  const { data, error } = await user.client.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: "Informatika",
    p_description: nul, p_start_date: "2019-01-01", p_start_precision: "year", p_end_date: "2023-01-01", p_end_precision: "year", p_is_current: false,
  });
  const id = data?.[0]?.id;
  if (error || !id) throw new Error("T19 education fixture failed");
  return id;
}

async function createSkill(user: User, name: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: name });
  const id = data?.[0]?.id;
  if (error || !id) throw new Error("T19 skill fixture failed");
  return id;
}

async function createProject(user: User, title: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: title, p_description: "Deskripsi skripsi", p_user_role: "Peneliti", p_outcome: nul, p_status: "completed",
    p_start_date: nul, p_start_precision: nul, p_end_date: nul, p_end_precision: nul, p_is_current: false, p_experience_id: nul,
  } as never);
  const id = (data as { project_id?: string }[] | null)?.[0]?.project_id;
  if (error || !id) throw new Error("T19 project fixture failed");
  return id;
}

async function createAchievement(user: User, title: string, projectId: string | null, action: "confirm" | "save_draft" = "confirm"): Promise<string> {
  const created = await user.client.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: nul, p_project_id: projectId as never, p_experience_id: nul,
  } as never);
  const draft = created.data?.[0];
  if (created.error || !draft?.achievement_id) throw new Error("T19 achievement create failed");
  const confirm = action === "confirm";
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: draft.achievement_id, p_expected_revision: draft.revision, p_action: action,
    p_changes: {
      title, contribution: confirm ? `Kontribusi ${title}` : "", scope: "", outcome: confirm ? `Hasil ${title}` : "",
      cv_bullet: confirm ? `Bullet ${title}` : "", achieved_on: "2023-05-10", metrics: [],
    },
    p_skill_names: [],
  } as never);
  if (saved.error || !saved.data?.[0]) throw new Error("T19 achievement save failed");
  return draft.achievement_id;
}

async function signIn(page: Page, user: User, returnTo = "/cv"): Promise<void> {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/[?/=]/g, "\\$&") + "$"));
}

const section = (page: Page, key: string) => page.locator(`section[data-section="${key}"]`);
const status = (page: Page) => page.locator(".cv-save-status");
const saveButton = (page: Page) => page.getByRole("button", { name: "Save changes", exact: true });
const itemIds = async (page: Page, key: string) => section(page, key).locator('[data-testid="cv-item"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-item-id")));
const itemTitles = async (page: Page, key: string) =>
  section(page, key).locator('[data-testid="cv-item"] > .cv-item-main .cv-item-title > span:first-child').allTextContents();

/** Adds a record and waits until the reloaded list shows it as added (one change at a time). */
async function add(page: Page, name: string) {
  await page.getByRole("button", { name: `Add ${name} to CV` }).click();
  await expect(page.getByRole("button", { name: `${name} is already on the CV` })).toBeVisible();
}

async function expectNoOverflow(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoWcagViolations(page, testInfo, name);
  const shot = await page.screenshot({ fullPage: true, path: process.env["CV_SHOTS_DIR"] ? `${process.env["CV_SHOTS_DIR"]}/${name}.png` : undefined });
  await testInfo.attach(name, { body: shot, contentType: "image/png" });
}

async function secondSession(browser: Browser, user: User) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await signIn(page, user);
  return { context, page };
}

function collectConsole(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") seen.push(message.text()); });
  page.on("pageerror", (error) => seen.push(String(error)));
  return seen;
}

test.beforeAll(() => {
  const { url, secretKey, publicKey } = config();
  supabaseUrl = url;
  publishableKey = publicKey;
  admin = createClient<Database>(url, secretKey, options);
});

test.afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
});

test("graduate journey: first open is empty, records are added, moved with the keyboard, reworded, saved, and the records stay untouched", async ({ page }, testInfo) => {
  const errors = collectConsole(page);
  const user = await createUser();
  const educationId = await createEducation(user);
  await createSkill(user, "SQL");
  const projectId = await createProject(user, "Skripsi Sistem Antrian");
  const childId = await createAchievement(user, "Menurunkan waktu antre", projectId);
  await createAchievement(user, "Menulis panduan", null);
  await createAchievement(user, "Merancang simulasi", null);
  await createAchievement(user, "Masih draf", null, "save_draft");
  const before = await user.client.from("achievements").select("*").eq("id", childId).single();
  expect(before.error).toBeNull();
  expect(before.data?.cv_bullet).toBe("Bullet Menurunkan waktu antre");

  await signIn(page, user);
  await expect(page.getByRole("heading", { name: "CV", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your CV is empty" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add all/ })).toHaveCount(0);
  await expect(status(page)).toContainText("All changes saved");
  const cvRows = await user.client.from("cv_documents").select("id, locale, title").eq("user_id", user.id);
  expect(cvRows.data).toHaveLength(1);
  expect(cvRows.data?.[0]).toMatchObject({ locale: "en", title: "Master CV" });
  // Draft achievements are not offered.
  await expect(page.getByRole("button", { name: /Masih draf/ })).toHaveCount(0);

  await add(page, "S1 · Informatika · Universitas Contoh");
  await expect(page.getByRole("button", { name: "S1 · Informatika · Universitas Contoh is already on the CV" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("cv-announcer")).toContainText("added to the CV");

  // The achievement brings its project along and renders under it exactly once.
  await add(page, "Menurunkan waktu antre");
  await expect(section(page, "projects").locator('[data-testid="cv-item"]')).toHaveCount(2);
  expect(await itemTitles(page, "projects")).toEqual(["Skripsi Sistem Antrian", "Menurunkan waktu antre"]);
  await expect(section(page, "projects").locator(".cv-item-children .cv-item-title")).toContainText("Menurunkan waktu antre");
  await expect(section(page, "achievements").getByText("Menurunkan waktu antre").first()).toBeVisible();
  expect(await itemTitles(page, "achievements")).toEqual([]);
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Bullet Menurunkan waktu antre");

  await add(page, "Menulis panduan");
  await expect(section(page, "achievements").locator('[data-testid="cv-item"]')).toHaveCount(1);
  await add(page, "Merancang simulasi");
  await expect.poll(() => itemTitles(page, "achievements")).toEqual(["Menulis panduan", "Merancang simulasi"]);
  await add(page, "SQL");
  await expect(section(page, "skills").locator('[data-testid="cv-item"]')).toHaveCount(1);
  // Confirming an achievement never adds it: the unadded ones are still offered.
  const items = await user.client.from("cv_items").select("id").eq("user_id", user.id);
  expect(items.data).toHaveLength(6);

  // Move with the keyboard only: focus stays on a usable control and the change is announced.
  await page.getByRole("button", { name: "Move Merancang simulasi up" }).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => itemTitles(page, "achievements")).toEqual(["Merancang simulasi", "Menulis panduan"]);
  await expect(page.getByRole("button", { name: "Move Merancang simulasi down" })).toBeFocused();
  await expect(page.getByTestId("cv-announcer")).toContainText("Merancang simulasi moved to position 1 of 2");
  await expect(page.getByRole("button", { name: "Move Merancang simulasi up" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Move Menulis panduan down" })).toBeDisabled();
  await page.getByRole("button", { name: "Move Education section down" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cv-order-row").nth(3)).toContainText("Skills");
  await expect(page.getByRole("button", { name: "Move Education section down" })).toBeFocused();

  // Reword: the draft is unsaved and the preview keeps the saved text until Save.
  await page.getByRole("button", { name: "Edit wording for Merancang simulasi" }).click();
  await page.getByLabel("CV wording for Merancang simulasi").fill("Wording khusus untuk CV");
  await expect(status(page)).toContainText("Unsaved changes");
  await expect(page.getByTestId("cv-preview-paper")).not.toContainText("Wording khusus untuk CV");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Bullet Merancang simulasi");
  await expect(page.getByText("Unsaved changes are not shown until you save.")).toBeVisible();
  await page.locator("#cv-summary").fill(`Ringkasan ${SENTINEL}`);
  await page.locator("#cv-headline").fill("Data Analyst");
  await page.locator("#cv-title").fill("CV Ani");
  await saveButton(page).click();
  await expect(status(page)).toContainText("All changes saved");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Wording khusus untuk CV");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Data Analyst");
  await expect(page.getByRole("button", { name: "Edit wording for Merancang simulasi" })).toBeVisible();
  await expect(page.locator(".ui-badge", { hasText: "Manual wording" })).toHaveCount(1);

  // Persisted after a reload; the canonical achievement did not change.
  await page.reload();
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Wording khusus untuk CV");
  await expect(page.locator("#cv-title")).toHaveValue("CV Ani");
  const after = await user.client.from("achievements").select("*").eq("id", childId).single();
  expect(after.error).toBeNull();
  expect(after.data).toEqual(before.data);
  const merged = await user.client.from("achievements").select("cv_bullet").eq("user_id", user.id).eq("title", "Merancang simulasi").single();
  expect(merged.error?.message ?? null).toBeNull();
  expect(merged.data?.cv_bullet).toBe("Bullet Merancang simulasi");
  expect(educationId).toBeTruthy();
  expect(errors.filter((message) => !/Failed to load resource/.test(message))).toEqual([]);
  await testInfo.attach("cv-journey.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("the CV language changes labels and dates on the CV but not the app language or the source text", async ({ page }) => {
  const user = await createUser();
  await createEducation(user);
  await signIn(page, user);
  await add(page, "S1 · Informatika · Universitas Contoh");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Education");
  await page.getByLabel("CV language").selectOption("id");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Pendidikan");
  await expect(page.getByTestId("cv-preview-paper")).toContainText("Universitas Contoh");
  await expect(page.getByRole("heading", { name: "CV settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const cv = await user.client.from("cv_documents").select("locale").eq("user_id", user.id).single();
  expect(cv.data?.locale).toBe("id");
  const profile = await user.client.from("profiles").select("locale").eq("id", user.id).single();
  expect(profile.data?.locale).toBe("en");
});

test("removing a parent asks first, names its achievements, and keeps everything on Cancel", async ({ page }) => {
  const user = await createUser();
  const projectId = await createProject(user, "Proyek Induk");
  await createAchievement(user, "Anak Satu", projectId);
  await createAchievement(user, "Anak Dua", projectId);
  await createAchievement(user, "Mandiri", null);
  await signIn(page, user);
  await add(page, "Anak Satu");
  await add(page, "Anak Dua");
  await expect(section(page, "projects").locator('[data-testid="cv-item"]')).toHaveCount(3);

  await page.getByRole("button", { name: "Remove Proyek Induk from CV" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Proyek Induk?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Anak Satu")).toBeVisible();
  await expect(dialog.getByText("Anak Dua")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(section(page, "projects").locator('[data-testid="cv-item"]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Remove Proyek Induk from CV" })).toBeFocused();

  await page.getByRole("button", { name: "Remove Proyek Induk from CV" }).click();
  await dialog.getByRole("button", { name: "Remove parent and its achievements" }).click();
  await expect(section(page, "projects").locator('[data-testid="cv-item"]')).toHaveCount(0);
  await expect(page.getByTestId("cv-announcer")).toContainText("Proyek Induk removed from the CV");
  await expect(page.locator("#cv-section-heading-projects")).toBeFocused();
  const left = await user.client.from("cv_items").select("id").eq("user_id", user.id);
  expect(left.data).toEqual([]);
  // The records themselves stay.
  const achievements = await user.client.from("achievements").select("id").eq("user_id", user.id).eq("status", "confirmed");
  expect(achievements.error?.message ?? null).toBeNull();
  expect(achievements.data).toHaveLength(3);

  // A standalone item is removed directly, without a dialog.
  await add(page, "Mandiri");
  await page.getByRole("button", { name: "Remove Mandiri from CV" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(section(page, "achievements").locator('[data-testid="cv-item"]')).toHaveCount(0);
});

test("a stale save in a second session keeps the typed text and asks which version to use; nothing is overwritten silently", async ({ page, browser }) => {
  const user = await createUser();
  await createEducation(user);
  await signIn(page, user);
  await add(page, "S1 · Informatika · Universitas Contoh");
  await expect(section(page, "education").locator('[data-testid="cv-item"]')).toHaveCount(1);
  await page.locator("#cv-summary").fill("Ringkasan dari sesi A");
  await page.locator("#cv-headline").fill("Headline A");

  const other = await secondSession(browser, user);
  await other.page.locator("#cv-summary").fill("Ringkasan dari sesi B");
  await saveButton(other.page).click();
  await expect(status(other.page)).toContainText("All changes saved");

  await saveButton(page).click();
  await expect(page.getByRole("heading", { name: "This CV changed somewhere else" })).toBeVisible();
  await expect(page.locator("#cv-summary")).toHaveValue("Ringkasan dari sesi A");
  await expect(page.locator("#cv-headline")).toHaveValue("Headline A");
  await expect(page.locator(".cv-conflict")).toContainText("Ringkasan dari sesi B");
  await expect(saveButton(page)).toBeDisabled();
  const row = await user.client.from("cv_documents").select("summary_override").eq("user_id", user.id).single();
  expect(row.data?.summary_override).toBe("Ringkasan dari sesi B");

  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).click();
  await expect(status(page)).toContainText("All changes saved");
  const saved = await user.client.from("cv_documents").select("summary_override, profile_snapshot").eq("user_id", user.id).single();
  expect(saved.data?.summary_override).toBe("Ringkasan dari sesi A");
  expect(JSON.stringify(saved.data?.profile_snapshot)).toContain("Headline A");

  // The other direction: Use saved drops the local text for that field.
  await other.page.reload();
  await other.page.locator("#cv-summary").fill("Ringkasan B kedua");
  await page.locator("#cv-summary").fill("Ringkasan A kedua");
  await saveButton(page).click();
  await expect(status(page)).toContainText("All changes saved");
  await saveButton(other.page).click();
  await expect(other.page.getByRole("heading", { name: "This CV changed somewhere else" })).toBeVisible();
  await other.page.getByRole("button", { name: "Use saved" }).click();
  await expect(other.page.locator("#cv-summary")).toHaveValue("Ringkasan A kedua");
  await expect(status(other.page)).toContainText("All changes saved");
  await other.context.close();
});

test("Add to CV opens the CV with the achievement suggested but not added; drafts and bad parameters are ignored", async ({ page }) => {
  const user = await createUser();
  const confirmed = await createAchievement(user, "Sudah dikonfirmasi", null);
  const draft = await createAchievement(user, "Belum dikonfirmasi", null, "save_draft");
  await signIn(page, user, "/achievements");
  await page.goto(`/achievements/${confirmed}`);
  const link = page.getByRole("link", { name: "Add to CV" });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/cv\\?highlight=${confirmed}$`));
  const row = page.locator('[data-testid="cv-pool-row"][aria-current="true"]');
  await expect(row).toContainText("Sudah dikonfirmasi");
  await expect(row).toContainText("Suggested");
  await expect(page.getByRole("button", { name: "Add Sudah dikonfirmasi to CV" })).toBeFocused();
  const items = await user.client.from("cv_items").select("id").eq("user_id", user.id);
  expect(items.data).toEqual([]);

  await page.goto(`/achievements/${draft}`);
  await expect(page.getByRole("link", { name: "Add to CV" })).toHaveCount(0);
  for (const value of [draft, randomUUID(), "not-a-uuid"]) {
    await page.goto(`/cv?highlight=${value}`);
    await expect(page.locator('[data-testid="cv-pool-row"][aria-current="true"]')).toHaveCount(0);
    await expect(page.getByText("Suggested")).toHaveCount(0);
  }
  // Already-added records are not suggested either.
  await page.goto(`/cv?highlight=${confirmed}`);
  await add(page, "Sudah dikonfirmasi");
  await expect(page.getByRole("button", { name: "Sudah dikonfirmasi is already on the CV" })).toBeVisible();
  await page.goto(`/cv?highlight=${confirmed}`);
  await expect(page.getByText("Suggested")).toHaveCount(0);
});

test("layout, accessibility and theme: side by side at 1440 px, stacked at 360 px, no overflow, no serious Axe findings", async ({ page }, testInfo) => {
  const user = await createUser();
  await createEducation(user);
  await createSkill(user, "SQL");
  const projectId = await createProject(user, "Skripsi Sistem Antrian");
  await createAchievement(user, "Menurunkan waktu antre", projectId);
  await signIn(page, user);
  await add(page, "Menurunkan waktu antre");
  await add(page, "SQL");
  await add(page, "S1 · Informatika · Universitas Contoh");
  await expect(section(page, "education").locator('[data-testid="cv-item"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Edit wording for Skripsi Sistem Antrian" }).click();

  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
      await page.goto("/cv");
      await expect(page.getByRole("heading", { name: "CV", level: 1 })).toBeVisible();
      await expectNoOverflow(page, `cv-${width}-${theme}`);
      const editor = await page.locator(".cv-editor").boundingBox();
      const preview = await page.locator(".cv-preview-column").boundingBox();
      if (width === 1440) {
        expect(preview!.x, "preview sits to the right of the editor").toBeGreaterThan(editor!.x + editor!.width - 1);
      } else {
        expect(preview!.y, "preview is stacked below the editor").toBeGreaterThanOrEqual(editor!.y + editor!.height - 1);
      }
      await snapshot(page, testInfo, `cv-${width}-${theme}`);
    }
  }
});

test("reduced motion is respected and the page works without a pointer", async ({ page }) => {
  const user = await createUser();
  const confirmed = await createAchievement(user, "Fokus tanpa animasi", null);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, user);
  await page.goto(`/cv?highlight=${confirmed}`);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.getByRole("button", { name: "Add Fokus tanpa animasi to CV" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(section(page, "achievements").locator('[data-testid="cv-item"]')).toHaveCount(1);
  const transition = await page.locator(".cv-panel").first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(["0s", "0s, 0s"]).toContain(transition);
});
