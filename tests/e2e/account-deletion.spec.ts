import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Cookie, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainUntilCompleted, objectCount, receiptStatus, sql } from "./helpers/account-deletion-worker";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3015";
const SHOTS = "docs/verification/T23-screenshots";
const SENTINEL = `WP-PRIVATE-ACCOUNT-SENTINEL-${randomUUID()}`;
const BUCKET = "workpulse-private";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

let admin: Client;
const users: User[] = [];
const uploaded: string[] = [];

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publishable = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publishable) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publishable };
}

async function createUser(label: string, locale: "en" | "id" = "en"): Promise<User> {
  const email = `t23-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`T23 browser fixture setup failed: ${label}`);
  const profile = await admin.from("profiles").update({
    display_name: `T23 ${label}`, locale, timezone: "Asia/Jakarta", onboarding_completed_at: new Date().toISOString(),
  }).eq("id", id);
  if (profile.error) throw new Error(`T23 browser fixture setup failed: ${label} profile`);
  const user = { id, email, password };
  users.push(user);
  return user;
}

/**
 * Some owner data so the dialog has real counts to show: an activity with the private sentinel and an orphan object.
 * The activity goes through the user RPC with the user's JWT claims set in the database, so seeding costs no Auth
 * sign-in (local Auth allows 30 sign-ins per 5 minutes per IP, and this suite must pass when run twice in a row).
 */
async function seedData(user: User): Promise<void> {
  const created = sql(
    `begin; set local role authenticated; ` +
    `select set_config('request.jwt.claims', '{"sub":"${user.id}","role":"authenticated"}', true); ` +
    `select count(*) from public.create_activity_idempotent(p_operation_key => gen_random_uuid(), p_raw_text => '${SENTINEL} aktivitas', ` +
    `p_occurred_on => '2026-10-01', p_capture_mode => 'note', p_role => null, p_scope => null, p_outcome => null, p_experience_id => null, p_project_id => null); ` +
    `commit;`,
  );
  if (!created.endsWith("1")) throw new Error("T23 activity fixture failed");
  const key = `${user.id}/evidence/${randomUUID()}`;
  const upload = await admin.storage.from(BUCKET).upload(key, new TextEncoder().encode("%PDF-1.4\nwp-t23\n"), { contentType: "application/pdf", upsert: false });
  if (upload.error) throw new Error("T23 object fixture failed");
  uploaded.push(key);
}

async function signIn(page: Page, user: User, expectUrl: RegExp = /\/dashboard$/): Promise<void> {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(expectUrl);
}

let shared: { user: User; cookies: Cookie[] } | undefined;

/**
 * The dialog and screenshot tests never delete their account, so they share one account and one browser sign-in.
 * The session cookies are copied into each test's own page.
 */
async function signInShared(page: Page, browser: Browser): Promise<User> {
  if (!shared) {
    const user = await createUser("shared");
    const context = await browser.newContext({ baseURL: BASE_URL });
    await signIn(await context.newPage(), user);
    shared = { user, cookies: (await context.storageState()).cookies };
    await context.close();
  }
  await page.context().addCookies(shared.cookies);
  await page.goto("/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  // The page is the first one this context loads; wait for its scripts so the trigger is hydrated before a key press.
  await page.waitForLoadState("networkidle");
  return shared.user;
}

const dialogOf = (page: Page) => page.getByRole("dialog", { name: "Delete your account permanently?" });
const triggerOf = (page: Page) => page.getByRole("button", { name: "Delete account", exact: true });
const passwordOf = (page: Page) => dialogOf(page).getByLabel("Current password");
const confirmationOf = (page: Page) => dialogOf(page).getByLabel("Type your account email to confirm");
const confirmButton = (page: Page) => dialogOf(page).getByRole("button", { name: "Delete account permanently" });

async function openDialog(page: Page): Promise<void> {
  await triggerOf(page).focus();
  await page.keyboard.press("Enter");
  await expect(dialogOf(page)).toBeVisible();
  await expect(passwordOf(page)).toBeFocused();
}

/** Waits for the modal to close: while it is open the trigger is inert, so reopening at once would press nothing. */
async function closeWithEscape(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(dialogOf(page)).toBeHidden();
  await expect(triggerOf(page)).toBeFocused();
}

async function overflow(page: Page): Promise<{ page: boolean; dialog: boolean }> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    return {
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      dialog: dialog ? dialog.scrollWidth > dialog.clientWidth : false,
    };
  });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
}

test.beforeAll(() => {
  const { url, secretKey } = config();
  admin = createClient<Database>(url, secretKey, clientOptions);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  if (uploaded.length > 0) await admin.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
  for (const user of users) {
    // An account a test did not delete goes through the product path; a plain user delete fails on populated accounts.
    if (receiptStatus(user.id) === "none" && sql(`select count(*) from public.profiles where id = '${user.id}'::uuid`) === "1") {
      await admin.rpc("begin_account_deletion", { p_user_id: user.id });
    }
    if (receiptStatus(user.id) !== "none") await drainUntilCompleted(user.id, 8);
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    sql(`delete from internal.account_deletions where user_id = '${user.id}'::uuid`);
  }
});

test("S12 deletion with the keyboard: wrong password, wrong email, then the account is deleted and every session ends", async ({ page, browser }, testInfo) => {
  const owner = await createUser("owner");
  const other = await createUser("bystander");
  await seedData(owner);
  await seedData(other);

  // The same account in a second browser, signed in before the deletion.
  const secondContext = await browser.newContext({ baseURL: BASE_URL });
  const secondPage = await secondContext.newPage();
  await signIn(secondPage, owner);
  await signIn(page, owner);
  await page.goto("/settings/profile");

  await expect(page.getByRole("heading", { name: "Privacy and account", level: 2 })).toBeVisible();
  await expect(page.getByText("Backup copies that may contain your data are deleted within 30 days.")).toBeVisible();
  await expect(dialogOf(page)).toBeHidden();
  await openDialog(page);

  // The counts come from the database and name no record content.
  await expect(dialogOf(page).getByText("Activities: 1", { exact: true })).toBeVisible();
  await expect(dialogOf(page).getByText("Master CV: none", { exact: true })).toBeVisible();
  await expect(dialogOf(page)).not.toContainText(SENTINEL);
  await expect(confirmButton(page)).toBeDisabled();
  await expect(dialogOf(page).getByRole("button", { name: "Delete account permanently" })).toBeDisabled();

  // 1. Wrong password with the right email: the error sits on the password field and nothing changes.
  await passwordOf(page).fill("wrong-password-Aa1!");
  await page.keyboard.press("Tab");
  await expect(confirmationOf(page)).toBeFocused();
  await page.keyboard.type(owner.email.toUpperCase());
  await expect(confirmButton(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(dialogOf(page).getByText("That password is not correct.")).toBeVisible();
  await expect(passwordOf(page)).toHaveAttribute("aria-invalid", "true");
  await expect(passwordOf(page)).toBeFocused();
  await expect(passwordOf(page)).toHaveValue("");
  await expect(confirmationOf(page)).toHaveValue(owner.email.toUpperCase());
  expect(sql(`select deleting_at is null from public.profiles where id = '${owner.id}'::uuid`)).toBe("t");
  expect(receiptStatus(owner.id)).toBe("none");
  await expectNoWcagViolations(page, testInfo, "s12-delete-password-error");

  // 2. Right password, wrong email: the button stays disabled and the server never sees a request.
  await passwordOf(page).fill(owner.password);
  await confirmationOf(page).fill("someone-else@workpulse.test");
  await expect(confirmButton(page)).toBeDisabled();
  await expectNoWcagViolations(page, testInfo, "s12-delete-confirmation-unmatched");
  expect(receiptStatus(owner.id)).toBe("none");

  // 3. Right password and email: the account is marked deleting, sessions end, and the browser leaves the workspace.
  await confirmationOf(page).fill(owner.email);
  await expect(confirmButton(page)).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in\?notice=accountDeleted$/);
  await expect(page.getByText("Your account is being deleted. You are signed out on every device.")).toBeVisible();
  expect(sql(`select deleting_at is not null from public.profiles where id = '${owner.id}'::uuid`)).toBe("t");
  expect(receiptStatus(owner.id)).toBe("queued");

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);

  // The second browser loses access on its next navigation.
  await secondPage.goto("/activity");
  await expect(secondPage).toHaveURL(/\/sign-in/);
  await secondContext.close();

  // Signing in again is refused with the generic message (Auth checks the ban before the password).
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(owner.email);
  await page.locator('input[type="password"]').first().fill(owner.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);

  // 4. The worker finishes the job: Auth user, rows and objects are gone, then the same email registers again.
  expect(objectCount(owner.id)).toBe(1);
  const drained = await drainUntilCompleted(owner.id);
  expect(drained.output).not.toContain(SENTINEL);
  expect(drained.output).not.toContain(owner.email);
  expect(receiptStatus(owner.id)).toBe("completed");
  expect(objectCount(owner.id)).toBe(0);
  expect((await admin.auth.admin.getUserById(owner.id)).data.user).toBeNull();
  expect(sql(`select count(*) from public.activities where user_id = '${owner.id}'::uuid`)).toBe("0");
  expect(sql(`select count(*) from public.profiles where id = '${owner.id}'::uuid`)).toBe("0");

  const reborn = await admin.auth.admin.createUser({ email: owner.email, password: owner.password, email_confirm: true });
  expect(reborn.error).toBeNull();
  if (reborn.data.user) users.push({ id: reborn.data.user.id, email: owner.email, password: owner.password });
  await signIn(page, owner, /\/onboarding/);
  expect(sql(`select count(*) from public.activities where user_id = '${reborn.data.user!.id}'::uuid`)).toBe("0");

  // 5. The other account is untouched and still works.
  expect(objectCount(other.id)).toBe(1);
  const bystander = await browser.newContext({ baseURL: BASE_URL });
  const bystanderPage = await bystander.newPage();
  await signIn(bystanderPage, other);
  await bystanderPage.goto("/activity");
  await expect(bystanderPage.getByText(`${SENTINEL} aktivitas`).first()).toBeVisible();
  await bystander.close();
});

test("S12 dialog: Escape and Cancel return focus to the trigger, and reduced motion changes nothing", async ({ page, browser }, testInfo) => {
  const user = await signInShared(page, browser);
  await expectNoWcagViolations(page, testInfo, "s12-delete-closed");

  await openDialog(page);
  await expectNoWcagViolations(page, testInfo, "s12-delete-open");
  await closeWithEscape(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDialog(page);
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === "running").length)).toBe(0);
  await dialogOf(page).getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialogOf(page)).toBeHidden();
  await expect(triggerOf(page)).toBeFocused();

  // Nothing was requested.
  expect(receiptStatus(user.id)).toBe("none");
  expect(sql(`select deleting_at is null from public.profiles where id = '${user.id}'::uuid`)).toBe("t");

  // The typed email does not survive a closed dialog.
  await openDialog(page);
  await confirmationOf(page).fill(user.email);
  await closeWithEscape(page);
  await openDialog(page);
  await expect(confirmationOf(page)).toHaveValue("");

  // The error of a closed attempt is not shown again on the next opening.
  await passwordOf(page).fill("wrong-password-Aa1!");
  await confirmationOf(page).fill(user.email);
  await confirmButton(page).click();
  await expect(dialogOf(page).getByText("That password is not correct.")).toBeVisible();
  await closeWithEscape(page);
  await openDialog(page);
  await expect(dialogOf(page).getByText("That password is not correct.")).toHaveCount(0);
  await expect(passwordOf(page)).not.toHaveAttribute("aria-invalid", "true");
  expect(receiptStatus(user.id)).toBe("none");
});

for (const theme of ["light", "dark"] as const) {
  for (const [width, height] of [[360, 780], [1440, 900]] as const) {
    test(`S12 states at ${width}px in ${theme}: no overflow, Axe clean, screenshots`, async ({ page, browser }, testInfo: TestInfo) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width, height });
      const user = await signInShared(page, browser);

      const card = page.locator(".delete-account");
      await card.scrollIntoViewIfNeeded();
      expect((await overflow(page)).page, "closed state overflows").toBe(false);
      await expectNoWcagViolations(page, testInfo, `closed-${width}-${theme}`);
      await card.screenshot({ path: `${SHOTS}/s12-delete-closed-${width}-${theme}.png`, animations: "disabled" });

      await openDialog(page);
      await expect(dialogOf(page).getByText("Activities: 0", { exact: true })).toBeVisible();
      const open = await overflow(page);
      expect(open.page, "open state overflows the page").toBe(false);
      expect(open.dialog, "open state overflows the dialog").toBe(false);
      await expectNoWcagViolations(page, testInfo, `open-${width}-${theme}`);
      await page.screenshot({ path: `${SHOTS}/s12-delete-open-${width}-${theme}.png`, animations: "disabled" });

      await passwordOf(page).fill("wrong-password-Aa1!");
      await confirmationOf(page).fill(user.email);
      await confirmButton(page).click();
      await expect(dialogOf(page).getByText("That password is not correct.")).toBeVisible();
      const failed = await overflow(page);
      expect(failed.page, "error state overflows the page").toBe(false);
      expect(failed.dialog, "error state overflows the dialog").toBe(false);
      await expectNoWcagViolations(page, testInfo, `error-${width}-${theme}`);
      await page.screenshot({ path: `${SHOTS}/s12-delete-error-${width}-${theme}.png`, animations: "disabled" });
      expect(receiptStatus(user.id)).toBe("none");
    });
  }
}

test("S03 shows when an unfinished review import will be cancelled automatically", async ({ page }, testInfo) => {
  const user = await createUser("review");
  const batchId = randomUUID();
  sql(
    `insert into public.import_batches (id, user_id, idempotency_key, payload_hash, file_key, filename, mime_type, bytes, sha256, status, stage, page_count, extracted_text) ` +
    `values ('${batchId}', '${user.id}', gen_random_uuid(), decode(repeat('ab', 32), 'hex'), null, 'cv.pdf', 'application/pdf', 10, repeat('a', 64), 'review', 'done', 1, 'teks')`,
  );
  sql(
    `insert into public.import_items (user_id, batch_id, entity_type, ordinal, payload, source_excerpt, action) ` +
    `values ('${user.id}', '${batchId}', 'skill', 0, '{"name":"SQL"}'::jsonb, 'SQL', 'create')`,
  );
  await signIn(page, user);
  await page.goto(`/imports/${batchId}/review`);
  await expect(page.getByRole("heading", { name: "Review imported data", level: 1 })).toBeVisible();

  const deadline = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const english = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(deadline);
  const notice = page.getByTestId("import-auto-cancel-notice");
  await expect(notice).toHaveText(`This import will be cancelled automatically on ${english} if you don't finish it.`);
  await expectNoWcagViolations(page, testInfo, "s03-auto-cancel-notice");

  await admin.from("profiles").update({ locale: "id" }).eq("id", user.id);
  await page.reload();
  const indonesian = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "UTC" }).format(deadline);
  await expect(page.getByTestId("import-auto-cancel-notice")).toHaveText(`Impor ini akan dibatalkan otomatis pada ${indonesian} jika tidak Anda selesaikan.`);
});
