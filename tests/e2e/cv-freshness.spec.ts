import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string; client: Client };
type SourceType = "experience" | "project" | "achievement" | "education" | "skill" | "certification";

const BASE_URL = "http://127.0.0.1:3013";

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
const nul = null as never;

async function createUser(): Promise<User> {
  const email = `t20-cv-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("T20 fixture user failed");
  const client = createClient<Database>(supabaseUrl, publishableKey, options);
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("T20 fixture sign-in failed");
  const profile = await client.from("profiles").select("revision").eq("id", id).single();
  const done = await client.rpc("complete_onboarding", {
    p_display_name: "Ani Contoh", p_locale: "en", p_timezone: "Asia/Jakarta", p_expected_revision: profile.data!.revision,
  });
  if (done.error) throw new Error("T20 onboarding fixture failed");
  const user = { id, email, password, client };
  users.push(user);
  return user;
}

async function createProject(user: User, title: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: title, p_description: "Deskripsi", p_user_role: "Peneliti", p_outcome: nul, p_status: "completed",
    p_start_date: nul, p_start_precision: nul, p_end_date: nul, p_end_precision: nul, p_is_current: false, p_experience_id: nul,
  } as never);
  const id = (data as { project_id?: string }[] | null)?.[0]?.project_id;
  if (error || !id) throw new Error("T20 project fixture failed");
  return id;
}

async function createAchievement(user: User, title: string, projectId: string | null = null, action: "confirm" | "save_draft" = "confirm"): Promise<string> {
  const created = await user.client.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: nul, p_project_id: projectId as never, p_experience_id: nul,
  } as never);
  const draft = created.data?.[0];
  if (created.error || !draft?.achievement_id) throw new Error("T20 achievement create failed");
  const confirm = action === "confirm";
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: draft.achievement_id, p_expected_revision: draft.revision, p_action: action,
    p_changes: {
      title, contribution: confirm ? `Kontribusi ${title}` : "", scope: "", outcome: confirm ? `Hasil ${title}` : "",
      cv_bullet: confirm ? `Bullet ${title}` : "", achieved_on: "2023-05-10", metrics: [],
    },
    p_skill_names: [],
  } as never);
  if (saved.error || !saved.data?.[0]) throw new Error("T20 achievement save failed");
  return draft.achievement_id;
}

async function achievementRow(user: User, id: string) {
  const { data, error } = await user.client.from("achievements").select("revision, title, contribution, outcome, achieved_on").eq("id", id).single();
  if (error || !data) throw new Error("T20 achievement read failed");
  return data;
}

/** A source edit made outside the CV (as on the Achievements screen). */
async function editBullet(user: User, id: string, bullet: string): Promise<void> {
  const row = await achievementRow(user, id);
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: id, p_expected_revision: row.revision, p_action: "save_changes",
    p_changes: { title: row.title, contribution: row.contribution, outcome: row.outcome, cv_bullet: bullet, achieved_on: row.achieved_on },
    p_skill_names: [],
  } as never);
  if (saved.error) throw new Error("T20 achievement edit failed");
}

async function reopen(user: User, id: string): Promise<void> {
  const row = await achievementRow(user, id);
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: id, p_expected_revision: row.revision, p_action: "reopen", p_changes: {}, p_skill_names: [],
  } as never);
  if (saved.error) throw new Error("T20 achievement reopen failed");
}

async function removeAchievement(user: User, id: string): Promise<void> {
  const row = await achievementRow(user, id);
  const deleted = await user.client.rpc("delete_achievement", { p_achievement_id: id, p_expected_revision: row.revision });
  if (deleted.error) throw new Error("T20 achievement delete failed");
}

async function updateProfile(user: User, changes: Record<string, string>): Promise<void> {
  const profile = await user.client.from("profiles").select("revision").eq("id", user.id).single();
  const updated = await user.client.rpc("update_profile", { p_expected_revision: profile.data!.revision, p_changes: changes });
  if (updated.error) throw new Error("T20 profile update failed");
}

/** Opens the CV and selects sources through the real RPC, as the Add button does. */
async function selectSources(user: User, sources: [SourceType, string][]): Promise<void> {
  const ensured = await user.client.rpc("ensure_cv_document");
  if (ensured.error) throw new Error("T20 CV open failed");
  for (const [type, id] of sources) {
    const doc = await user.client.from("cv_documents").select("revision").eq("user_id", user.id).single();
    const added = await user.client.rpc("select_cv_source", { p_expected_revision: doc.data!.revision, p_source_type: type, p_source_id: id });
    if (added.error) throw new Error("T20 CV selection failed");
  }
}

async function itemIdFor(user: User, achievementId: string): Promise<string> {
  const { data, error } = await user.client.from("cv_items").select("id").eq("achievement_id", achievementId).single();
  if (error || !data) throw new Error("T20 item lookup failed");
  return data.id;
}

async function snapshotOf(user: User, itemId: string) {
  const { data } = await user.client.from("cv_items").select("source_snapshot, override_text, acknowledged_revision").eq("id", itemId).single();
  return data!;
}

async function signIn(page: Page, user: User, returnTo = "/cv"): Promise<void> {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/[?/=#]/g, "\\$&") + "$"));
}

const item = (page: Page, itemId: string): Locator => page.locator(`[data-testid="cv-item"][data-item-id="${itemId}"]`);
const preview = (page: Page) => page.getByTestId("cv-preview-paper");
const announcer = (page: Page) => page.getByTestId("cv-announcer");
const summary = (page: Page) => page.getByTestId("cv-review-summary");
const saveButton = (page: Page) => page.getByRole("button", { name: "Save changes", exact: true });

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

test("a changed source without manual wording: badge, comparison, Refresh from source, and the preview follows only after the choice", async ({ page }, testInfo) => {
  const errors = collectConsole(page);
  const user = await createUser();
  const projectId = await createProject(user, "Proyek A");
  const achievementId = await createAchievement(user, "Hasil A", projectId);
  await selectSources(user, [["achievement", achievementId]]);
  const itemId = await itemIdFor(user, achievementId);
  await signIn(page, user);
  await expect(summary(page)).toHaveCount(0);
  await expect(preview(page)).toContainText("Bullet Hasil A");

  await editBullet(user, achievementId, "Bullet baru A");
  await page.reload();
  await expect(summary(page).getByRole("heading", { name: "1 item needs review" })).toBeVisible();
  await expect(item(page, itemId).getByText("Source changed")).toBeVisible();
  // Nothing on the CV changed by itself.
  await expect(preview(page)).toContainText("Bullet Hasil A");
  await expect(preview(page)).not.toContainText("Bullet baru A");
  await expect(page.getByTestId("cv-review-panel")).toHaveCount(0);

  await page.getByRole("button", { name: "Review change for Hasil A" }).click();
  const panel = page.getByTestId("cv-review-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "Saved on CV" })).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "Current source" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "Bullet Hasil A" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "Bullet baru A" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Keep my wording for Hasil A" })).toHaveCount(0);
  await expect(preview(page)).not.toContainText("Bullet baru A");

  await page.getByRole("button", { name: "Refresh Hasil A from source" }).click();
  await expect(preview(page)).toContainText("Bullet baru A");
  await expect(summary(page)).toHaveCount(0);
  await expect(item(page, itemId).getByText("Source changed")).toHaveCount(0);
  await expect(announcer(page)).toContainText("Hasil A refreshed from source.");
  // The review button is gone with the state, so focus lands on the heading of the section.
  await expect(page.getByRole("heading", { name: "Achievements", level: 2 })).toBeFocused();
  expect(errors.filter((message) => !/Failed to load resource/.test(message))).toEqual([]);
});

test("an item with manual wording: Keep my wording refreshes the details only; Replace from source is the explicit way to drop the wording", async ({ page }) => {
  const user = await createUser();
  const achievementId = await createAchievement(user, "Hasil B");
  await selectSources(user, [["achievement", achievementId]]);
  const itemId = await itemIdFor(user, achievementId);
  await signIn(page, user);
  await page.getByRole("button", { name: "Edit wording for Hasil B" }).click();
  await page.getByLabel("CV wording for Hasil B").fill("Wording saya sendiri");
  await saveButton(page).click();
  await expect(page.locator(".cv-save-status")).toContainText("All changes saved");

  await editBullet(user, achievementId, "Sumber B versi dua");
  await page.reload();
  await expect(item(page, itemId).getByText("Source changed")).toBeVisible();
  await expect(item(page, itemId).getByText("Manual wording")).toBeVisible();
  await page.getByRole("button", { name: "Review change for Hasil B" }).click();
  const panel = page.getByTestId("cv-review-panel");
  await expect(panel).toContainText("Your wording");
  await expect(panel).toContainText("Wording saya sendiri");
  await expect(panel.getByRole("button", { name: "Refresh Hasil B from source" })).toHaveCount(0);
  await panel.getByRole("button", { name: "Keep my wording for Hasil B" }).click();
  await expect(announcer(page)).toContainText("Your wording kept for Hasil B");
  await expect(preview(page)).toContainText("Wording saya sendiri");
  await expect(summary(page)).toHaveCount(0);
  const kept = await snapshotOf(user, itemId);
  expect(kept.override_text).toBe("Wording saya sendiri");
  expect(kept.source_snapshot).toMatchObject({ cv_bullet: "Sumber B versi dua" });

  await editBullet(user, achievementId, "Sumber B versi tiga");
  await page.reload();
  await page.getByRole("button", { name: "Review change for Hasil B" }).click();
  await page.getByRole("button", { name: "Replace the wording of Hasil B with the source wording" }).click();
  await expect(preview(page)).toContainText("Sumber B versi tiga");
  await expect(preview(page)).not.toContainText("Wording saya sendiri");
  await expect(item(page, itemId).getByText("Manual wording")).toHaveCount(0);
  expect((await snapshotOf(user, itemId)).override_text).toBeNull();
});

test("Keep saved wording is bound to that version: another edit asks again", async ({ page }) => {
  const user = await createUser();
  const achievementId = await createAchievement(user, "Hasil C");
  await selectSources(user, [["achievement", achievementId]]);
  const itemId = await itemIdFor(user, achievementId);
  await signIn(page, user);
  await editBullet(user, achievementId, "Sumber C versi dua");
  await page.reload();
  await page.getByRole("button", { name: "Review change for Hasil C" }).click();
  await page.getByRole("button", { name: "Keep saved wording for Hasil C" }).click();
  await expect(announcer(page)).toContainText("Saved wording kept for Hasil C.");
  await expect(item(page, itemId).getByText("Saved wording kept")).toBeVisible();
  await expect(item(page, itemId).getByText("Source changed")).toHaveCount(0);
  await expect(summary(page)).toHaveCount(0);
  await expect(preview(page)).toContainText("Bullet Hasil C");
  // The kept item stays focusable for an optional refresh, and focus returned to its review button.
  await expect(page.getByRole("button", { name: "Review change for Hasil C" })).toBeFocused();

  await editBullet(user, achievementId, "Sumber C versi tiga");
  await page.reload();
  await expect(item(page, itemId).getByText("Source changed")).toBeVisible();
  await expect(item(page, itemId).getByText("Saved wording kept")).toHaveCount(0);
  await expect(summary(page).getByRole("heading", { name: "1 item needs review" })).toBeVisible();
});

test("a deleted source and an unconfirmed achievement cannot be refreshed: Remove, or open the achievement", async ({ page }) => {
  const user = await createUser();
  const deletedId = await createAchievement(user, "Akan dihapus");
  const reopenedId = await createAchievement(user, "Akan dibuka ulang");
  await selectSources(user, [["achievement", deletedId], ["achievement", reopenedId]]);
  const deletedItem = await itemIdFor(user, deletedId);
  const reopenedItem = await itemIdFor(user, reopenedId);
  await signIn(page, user);

  await removeAchievement(user, deletedId);
  await reopen(user, reopenedId);
  await page.reload();
  await expect(summary(page).getByRole("heading", { name: "2 items need review" })).toBeVisible();
  await expect(item(page, deletedItem).getByText("Source deleted")).toBeVisible();
  await expect(item(page, reopenedItem).getByText("Source unconfirmed")).toBeVisible();

  await page.getByRole("button", { name: "Review change for Akan dihapus" }).click();
  const deletedPanel = page.getByTestId("cv-review-panel");
  await expect(deletedPanel).toContainText("The record was deleted, so there is nothing to refresh.");
  await expect(deletedPanel.getByRole("button")).toHaveCount(0);
  await expect(item(page, deletedItem).getByRole("button", { name: "Remove Akan dihapus from CV" })).toBeVisible();

  await page.getByRole("button", { name: "Review change for Akan dibuka ulang" }).click();
  const link = page.getByRole("link", { name: "Open achievement Akan dibuka ulang" });
  await expect(link).toHaveAttribute("href", `/achievements/${reopenedId}`);

  // Removing the deleted item resolves it.
  await item(page, deletedItem).getByRole("button", { name: "Remove Akan dihapus from CV" }).click();
  await expect(item(page, deletedItem)).toHaveCount(0);
  await expect(summary(page).getByRole("heading", { name: "1 item needs review" })).toBeVisible();
});

test("a profile change is reviewed like an item and refresh keeps the profile display overrides", async ({ page }) => {
  const user = await createUser();
  const achievementId = await createAchievement(user, "Hasil profil");
  await selectSources(user, [["achievement", achievementId]]);
  await signIn(page, user);
  await page.locator("#cv-headline").fill("Headline di CV");
  await saveButton(page).click();
  await expect(page.locator(".cv-save-status")).toContainText("All changes saved");

  await updateProfile(user, { headline: "Headline sumber baru", location: "Bandung" });
  await page.reload();
  await expect(summary(page).getByRole("link", { name: "Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Review change for Profile" }).click();
  const panel = page.getByTestId("cv-review-panel");
  await expect(panel.getByRole("cell", { name: "Headline sumber baru" })).toBeVisible();
  await expect(panel.getByRole("cell", { name: "Bandung" })).toBeVisible();
  await panel.getByRole("button", { name: "Keep my wording for Profile" }).click();
  await expect(announcer(page)).toContainText("Your wording kept for Profile.");
  await expect(summary(page)).toHaveCount(0);
  const doc = await user.client.from("cv_documents").select("profile_snapshot").eq("user_id", user.id).single();
  expect(doc.data?.profile_snapshot).toMatchObject({ headline: "Headline sumber baru", location: "Bandung", display_overrides: { headline: "Headline di CV" } });
  await expect(preview(page)).toContainText("Headline di CV");
});

test("Refresh all skips items with manual wording and the review actions stay off while wording is unsaved", async ({ page }) => {
  const user = await createUser();
  const plainId = await createAchievement(user, "Tanpa wording");
  const wordedId = await createAchievement(user, "Dengan wording");
  await selectSources(user, [["achievement", plainId], ["achievement", wordedId]]);
  const plainItem = await itemIdFor(user, plainId);
  const wordedItem = await itemIdFor(user, wordedId);
  await signIn(page, user);
  await page.getByRole("button", { name: "Edit wording for Dengan wording" }).click();
  await page.getByLabel("CV wording for Dengan wording").fill("Wording tersimpan");
  await saveButton(page).click();
  await expect(page.locator(".cv-save-status")).toContainText("All changes saved");

  await editBullet(user, plainId, "Sumber plain baru");
  await editBullet(user, wordedId, "Sumber worded baru");
  await page.reload();
  await expect(summary(page).getByRole("heading", { name: "2 items need review" })).toBeVisible();

  // Unsaved wording for the worded item disables its own review actions, with the reason on screen.
  await page.getByRole("button", { name: "Review change for Dengan wording" }).click();
  await page.getByRole("button", { name: "Edit wording for Dengan wording" }).click();
  await page.getByLabel("CV wording for Dengan wording").fill("Wording yang belum disimpan");
  await expect(page.getByText("Save or discard your wording first.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep my wording for Dengan wording" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replace the wording of Dengan wording with the source wording" })).toBeDisabled();

  await page.getByRole("button", { name: "Refresh all items without manual wording" }).click();
  await expect(announcer(page)).toContainText("1 item(s) refreshed from source.");
  await expect(item(page, plainItem).getByText("Source changed")).toHaveCount(0);
  await expect(item(page, wordedItem).getByText("Source changed")).toBeVisible();
  // The unsaved text of the other item survived the reload.
  await expect(page.getByLabel("CV wording for Dengan wording")).toHaveValue("Wording yang belum disimpan");
  await expect(page.getByRole("button", { name: "Refresh all items without manual wording" })).toHaveCount(0);
  expect((await snapshotOf(user, wordedItem)).override_text).toBe("Wording tersimpan");

  // Saving the text re-enables the actions.
  await saveButton(page).click();
  await expect(page.locator(".cv-save-status")).toContainText("All changes saved");
  await expect(page.getByRole("button", { name: "Keep my wording for Dengan wording" })).toBeEnabled();
});

test("the dashboard shows the two CV checks and each link opens the right place on the CV", async ({ page }) => {
  const user = await createUser();
  const selectedId = await createAchievement(user, "Sudah di CV");
  await createAchievement(user, "Belum di CV");
  await selectSources(user, [["achievement", selectedId]]);
  await editBullet(user, selectedId, "Sumber berubah");
  await signIn(page, user, "/dashboard");

  const review = page.getByRole("link", { name: "1 CV item needs review." });
  const available = page.getByRole("link", { name: "1 confirmed achievement is not on your CV." });
  await expect(review).toHaveAttribute("href", "/cv#cv-review");
  await expect(available).toHaveAttribute("href", "/cv#cv-pool-achievements");
  await review.click();
  await expect(page).toHaveURL(/\/cv#cv-review$/);
  await expect(summary(page)).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("link", { name: "1 confirmed achievement is not on your CV." }).click();
  await expect(page).toHaveURL(/\/cv#cv-pool-achievements$/);
  await expect(page.locator("#cv-pool-achievements")).toHaveJSProperty("open", true);
  await expect(page.getByRole("button", { name: "Add Belum di CV to CV" })).toBeVisible();

  // With nothing to review or add, neither check is shown.
  await page.goto("/cv");
  await page.locator("#cv-pool-achievements summary").click();
  await page.getByRole("button", { name: "Review change for Sudah di CV" }).click();
  await page.getByRole("button", { name: "Keep saved wording for Sudah di CV" }).click();
  await expect(summary(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add Belum di CV to CV" }).click();
  await expect(page.getByRole("button", { name: "Belum di CV is already on the CV" })).toBeVisible();
  await page.goto("/dashboard");
  // Other checks (confirmed achievements without evidence) may still show; the two CV checks are gone.
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("link", { name: /CV item/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /not on your CV/ })).toHaveCount(0);
});

test("a review works with the keyboard alone: open, choose, hear the result, keep focus", async ({ page }) => {
  const user = await createUser();
  const achievementId = await createAchievement(user, "Hasil keyboard");
  await selectSources(user, [["achievement", achievementId]]);
  await signIn(page, user);
  await editBullet(user, achievementId, "Sumber keyboard baru");
  await page.reload();

  // The accessible name flips with the state, so the toggle is found by its id.
  const toggle = page.locator('[id^="cv-review-open-"]');
  // Keyboard events need a hydrated page; a click would be retried, a key press is not.
  await page.waitForLoadState("networkidle");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Hide review for Hasil keyboard" })).toBeFocused();
  // The panel follows the row actions in the tab order; Tab reaches its first action.
  const refresh = page.getByRole("button", { name: "Refresh Hasil keyboard from source" });
  for (let step = 0; step < 8 && !(await refresh.evaluate((element) => element === document.activeElement)); step += 1) await page.keyboard.press("Tab");
  await expect(refresh).toBeFocused();
  await page.keyboard.press("Space");
  await expect(announcer(page)).toContainText("Hasil keyboard refreshed from source.");
  await expect(preview(page)).toContainText("Sumber keyboard baru");
  await expect(page.getByRole("heading", { name: "Achievements", level: 2 })).toBeFocused();
});

test("layout and accessibility with changed, deleted and unconfirmed items: 360 and 1440 px, light and dark, no overflow, no Axe findings", async ({ page }, testInfo) => {
  const user = await createUser();
  const changedId = await createAchievement(user, "Berubah");
  const deletedId = await createAchievement(user, "Terhapus");
  const reopenedId = await createAchievement(user, "Dibuka ulang");
  await selectSources(user, [["achievement", changedId], ["achievement", deletedId], ["achievement", reopenedId]]);
  await signIn(page, user);
  await editBullet(user, changedId, "Sumber berubah dengan teks yang cukup panjang untuk membungkus di layar sempit tanpa membuat halaman bergulir menyamping");
  await removeAchievement(user, deletedId);
  await reopen(user, reopenedId);
  await updateProfile(user, { headline: "Headline baru", phone: "+62 812 0000" });

  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
      await page.goto("/cv");
      await expect(summary(page).getByRole("heading", { name: "4 items need review" })).toBeVisible();
      for (const name of ["Review change for Berubah", "Review change for Terhapus", "Review change for Dibuka ulang", "Review change for Profile"]) {
        const toggle = page.getByRole("button", { name });
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      }
      await expect(page.getByTestId("cv-review-panel")).toHaveCount(4);
      await expectNoOverflow(page, `cv-review-${width}-${theme}`);
      await snapshot(page, testInfo, `cv-review-${width}-${theme}`);

      await page.goto("/dashboard");
      await expect(page.getByRole("link", { name: "4 CV items need review." })).toBeVisible();
      await expectNoOverflow(page, `dashboard-cv-${width}-${theme}`);
      await snapshot(page, testInfo, `dashboard-cv-${width}-${theme}`);
    }
  }
});

test("reduced motion is respected while reviewing", async ({ page }) => {
  const user = await createUser();
  const achievementId = await createAchievement(user, "Tanpa animasi");
  await selectSources(user, [["achievement", achievementId]]);
  await editBullet(user, achievementId, "Sumber tanpa animasi baru");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, user);
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await page.getByRole("button", { name: "Review change for Tanpa animasi" }).click();
  await expect(page.getByTestId("cv-review-panel")).toBeVisible();
  const transition = await page.getByTestId("cv-review-panel").evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(["0s", "0s, 0s"]).toContain(transition);
  await page.getByRole("button", { name: "Refresh Tanpa animasi from source" }).click();
  await expect(preview(page)).toContainText("Sumber tanpa animasi baru");
});
