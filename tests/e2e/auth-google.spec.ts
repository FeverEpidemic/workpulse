import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Cookie, type Page, type Request } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { sql } from "./helpers/account-deletion-worker";

// T29 Google sign-in against the local Supabase stack. Google itself is never loaded: every request to
// accounts.google.com is fulfilled here and recorded. A Google-only account is made by turning the email identity of
// an Admin API user into a `google` identity in the local database; its session still comes from a password sign-in,
// so its `amr` is `password` and never counts as a fresh Google confirmation.

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3016";
const SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const SHOTS = "docs/verification/T29-screenshots";
const GOOGLE_NAME = "Sentinel Google T29";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

let admin: Client;
const users: User[] = [];

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publishableKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publishableKey) throw new Error("Local Supabase fixture credentials and publishable key are required.");
  return { url, secretKey, publishableKey };
}

async function createGoogleUser(label: string, complete: boolean): Promise<User> {
  const email = `t29-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: GOOGLE_NAME } });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`T29 fixture setup failed: ${label}`);
  const user = { id, email, password };
  users.push(user);
  const providerId = randomBytes(10).toString("hex");
  sql(
    `update auth.identities set provider = 'google', provider_id = '${providerId}' where user_id = '${id}'::uuid; ` +
    `update auth.users set raw_app_meta_data = '{"provider":"google","providers":["google"]}'::jsonb where id = '${id}'::uuid;`,
  );
  if (complete) {
    const profile = await admin.from("profiles").update({
      display_name: `T29 ${label}`, locale: "en", timezone: "Asia/Jakarta", onboarding_completed_at: new Date().toISOString(),
    }).eq("id", id);
    if (profile.error) throw new Error(`T29 fixture setup failed: ${label} profile`);
  }
  return user;
}

async function signIn(page: Page, user: User, expectUrl: RegExp): Promise<void> {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(expectUrl);
}

/** One sign-in per fixture account; later tests copy its cookies (local Auth allows 30 sign-ins per 5 minutes). */
const sessions = new Map<string, { user: User; cookies: Cookie[] }>();
async function sessionFor(browser: Browser, label: string, complete: boolean, expectUrl: RegExp) {
  let session = sessions.get(label);
  if (!session) {
    const user = await createGoogleUser(label, complete);
    const context = await browser.newContext({ baseURL: BASE_URL });
    await signIn(await context.newPage(), user, expectUrl);
    session = { user, cookies: (await context.storageState()).cookies };
    sessions.set(label, session);
    await context.close();
  }
  return session;
}

/**
 * Records the Supabase authorize request and where Supabase sends the browser next, without following that redirect:
 * Playwright routes do not see requests that a redirect starts, so the browser would otherwise load Google itself.
 */
async function stubGoogle(page: Page) {
  const authorize: string[] = [];
  const google: string[] = [];
  page.on("request", (request: Request) => {
    if (request.url().startsWith(`${SUPABASE_ORIGIN}/auth/v1/authorize`)) authorize.push(request.url());
  });
  await page.route(`${SUPABASE_ORIGIN}/auth/v1/authorize**`, async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers()["location"] ?? "";
    if (location.startsWith("https://accounts.google.com/")) google.push(location);
    await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google stub</title><p>Google stub</p>" });
  });
  await page.route("https://accounts.google.com/**", (route) => route.abort());
  return { authorize, google };
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
}

async function horizontalOverflow(page: Page): Promise<{ page: boolean; dialog: boolean }> {
  return page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    return {
      page: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      dialog: dialog ? dialog.scrollWidth > dialog.clientWidth : false,
    };
  });
}

function expectGoogleRedirect(authorize: string[], google: string[]) {
  expect(authorize.length, "the browser went to Supabase Auth").toBeGreaterThan(0);
  const start = new URL(authorize.at(-1)!);
  expect(start.searchParams.get("provider")).toBe("google");
  expect(start.searchParams.get("code_challenge")).toBeTruthy();
  expect(start.searchParams.get("code_challenge_method")?.toLowerCase()).toBe("s256");
  expect(start.searchParams.get("redirect_to")).toBe(`${BASE_URL}/auth/confirm`);
  expect(google.length, "Supabase Auth sent the browser on to Google").toBeGreaterThan(0);
  const consent = new URL(google.at(-1)!);
  expect(consent.searchParams.get("redirect_uri")).toBe(`${SUPABASE_ORIGIN}/auth/v1/callback`);
  expect(consent.searchParams.get("state")).toBeTruthy();
  return { start, consent };
}

test.beforeAll(async () => {
  const { url, secretKey, publishableKey } = config();
  const providerOffMessage = "Local Google provider is off or unavailable. The shared stack may have been restarted from a checkout without [auth.external.google]. Run pnpm db:stop then pnpm db:start from a checkout with that block after coordinating shared stack use. In a new worktree, first copy the image version files from supabase/.temp in the main checkout (not project-ref or linked-project.json).";
  try {
    const response = await fetch(`${SUPABASE_ORIGIN}/auth/v1/settings`, { headers: { apikey: publishableKey } });
    if (!response.ok || (await response.json()).external?.google !== true) throw new Error(providerOffMessage);
  } catch {
    throw new Error(providerOffMessage);
  }
  admin = createClient<Database>(url, secretKey, clientOptions);
  mkdirSync(SHOTS, { recursive: true });
});

test.afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
});

test("S01 Continue with Google starts PKCE through Supabase Auth and remembers the return path", async ({ page }) => {
  const { authorize, google } = await stubGoogle(page);
  await page.goto("/sign-in?returnTo=%2Fprojects");
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page.getByText("Google stub")).toBeVisible();
  expectGoogleRedirect(authorize, google);

  // `next start` runs as production, so the flow cookies are Secure; a URL filter of http://… would hide them, while
  // Chrome still sends Secure cookies to 127.0.0.1.
  const cookies = await page.context().cookies();
  const returnCookie = cookies.find((cookie) => cookie.name === "wp-oauth-return");
  expect(returnCookie?.value).toBe("%2Fprojects");
  expect(returnCookie?.httpOnly).toBe(true);
  expect(returnCookie?.sameSite).toBe("Lax");
  expect(cookies.some((cookie) => cookie.name.includes("code-verifier")), "PKCE verifier stored as a cookie").toBe(true);
});

test("S01 shows Google in sign-in and create-account modes only, not in recovery", async ({ page }) => {
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("#google-sign-in-form")).toHaveCount(1);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.locator("#google-sign-in-form")).toHaveCount(1);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.locator("#recovery-form")).toBeVisible();
  await expect(page.locator("#google-sign-in-form")).toHaveCount(0);
});

test("a cancelled Google sign-in returns to S01 with a neutral notice and no provider text", async ({ page }) => {
  await page.goto("/auth/confirm?error=access_denied&error_description=WP-PROVIDER-SECRET");
  await expect(page).toHaveURL(/\/sign-in\?notice=oauthFailed$/);
  await expect(page.getByText("Signing in with Google did not finish.")).toBeVisible();
  await expect(page.getByText("WP-PROVIDER-SECRET")).toHaveCount(0);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "wp-oauth-return")).toBeUndefined();
});

for (const width of [360, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`S01 with Google at ${width}px in ${theme}: no overflow, Axe clean`, async ({ page }, testInfo) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/sign-in");
      await page.waitForLoadState("networkidle");
      expect(await horizontalOverflow(page)).toEqual({ page: false, dialog: false });
      await expectNoWcagViolations(page, testInfo, `s01-google-${width}-${theme}`);
      await page.locator("section.app-card").screenshot({ path: `${SHOTS}/s01-google-${width}-${theme}.png`, animations: "disabled" });

      await page.getByRole("button", { name: "Create account", exact: true }).click();
      expect(await horizontalOverflow(page)).toEqual({ page: false, dialog: false });
      await expectNoWcagViolations(page, testInfo, `s01-google-create-${width}-${theme}`);
    });
  }
}

test("onboarding fills the display name from Google and saves nothing until the user does", async ({ page, browser }, testInfo) => {
  const { user, cookies } = await sessionFor(browser, "onboarding", false, /\/onboarding\/import$/);
  await page.context().addCookies(cookies);
  await page.goto("/settings/profile");
  const name = page.getByLabel("Display name");
  await expect(name).toHaveValue(GOOGLE_NAME);
  await expect(page.getByText("Filled in from your Google account. You can change it.")).toBeVisible();
  await expect(name).toHaveAttribute("aria-describedby", /onboarding-display-name-source/);
  expect(sql(`select display_name || '|' || (onboarding_completed_at is null) from public.profiles where id = '${user.id}'::uuid`))
    .toBe("Pending onboarding|true");
  await expectNoWcagViolations(page, testInfo, "onboarding-google-name");
});

test("S12 asks a Google-only account to confirm with Google, binds the intent to the user, and leaves for Google", async ({ page, browser }, testInfo) => {
  const { user, cookies } = await sessionFor(browser, "delete", true, /\/dashboard$/);
  await page.context().addCookies(cookies);
  const { authorize, google } = await stubGoogle(page);
  await page.goto("/settings/profile?reauth=delete-account");
  await page.waitForLoadState("networkidle");

  // A password session is not a fresh Google confirmation, so the query alone opens nothing.
  const dialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Delete account", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", { name: "Confirm with Google" });
  await expect(confirm).toBeFocused();
  await expect(dialog.getByLabel("Current password")).toHaveCount(0);
  await expect(dialog.getByLabel("Type your account email to confirm")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Delete account permanently" })).toHaveCount(0);
  await expect(dialog.getByText("You sign in with Google, so there is no password to check.")).toBeVisible();
  await expectNoWcagViolations(page, testInfo, "s12-delete-google");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(confirm).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Google stub")).toBeVisible();
  const { consent } = expectGoogleRedirect(authorize, google);
  expect(consent.searchParams.get("prompt")).toBe("select_account");

  const intent = (await page.context().cookies()).find((cookie) => cookie.name === "wp-reauth");
  expect(intent?.value).toBe(`delete-account.${user.id}`);
  expect(intent?.httpOnly).toBe(true);
  expect(sql(`select count(*) from internal.account_deletions where user_id = '${user.id}'::uuid`)).toBe("0");
});

for (const width of [360, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`S12 Google dialog at ${width}px in ${theme}: no overflow, Axe clean`, async ({ page, browser }, testInfo) => {
      const { cookies } = await sessionFor(browser, "delete", true, /\/dashboard$/);
      await page.context().addCookies(cookies);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings/profile");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Delete account", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
      await expect(dialog.getByRole("button", { name: "Confirm with Google" })).toBeVisible();
      expect(await horizontalOverflow(page)).toEqual({ page: false, dialog: false });
      await expectNoWcagViolations(page, testInfo, `s12-google-${width}-${theme}`);
      await page.screenshot({ path: `${SHOTS}/s12-delete-google-${width}-${theme}.png`, animations: "disabled" });
    });
  }
}

for (const width of [360, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`S12 switched notice at ${width}px in ${theme}: current email, closed dialog, Axe clean`, async ({ page, browser }, testInfo) => {
      const { user, cookies } = await sessionFor(browser, "delete", true, /\/dashboard$/);
      await page.context().addCookies(cookies);
      await setTheme(page, theme);
      await page.setViewportSize({ width, height: 900 });
      for (const locale of ["en", "id"] as const) {
        const updated = await admin.from("profiles").update({ locale }).eq("id", user.id);
        expect(updated.error).toBeNull();
        await page.goto("/settings/profile?reauth=switched");
        await page.waitForLoadState("networkidle");
        const notice = page.locator('.delete-account > p[role="status"]');
        await expect(notice).toContainText(user.email);
        await expect(notice).toContainText(locale === "en" ? "Nothing was deleted." : "Tidak ada yang dihapus.");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
        expect(await horizontalOverflow(page)).toEqual({ page: false, dialog: false });
        await expectNoWcagViolations(page, testInfo, `s12-switched-${locale}-${width}-${theme}`);
        for (const suffix of ["?reauth=other", ""]) {
          await page.goto(`/settings/profile${suffix}`);
          await expect(page.locator('.delete-account > p[role="status"]')).toHaveCount(0);
          await expect(page.locator("dialog[open]")).toHaveCount(0);
        }
      }
      const restored = await admin.from("profiles").update({ locale: "en" }).eq("id", user.id);
      expect(restored.error).toBeNull();
      expect(sql(`select count(*) from internal.account_deletions where user_id = '${user.id}'::uuid`)).toBe("0");
    });
  }
}
