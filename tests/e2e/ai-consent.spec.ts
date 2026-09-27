import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const BASE_URL = "http://127.0.0.1:3007";
let admin: Client;
const users: User[] = [];

function config(): { url: string; secretKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey };
}

async function createUser(label: string, locale: "en" | "id" = "en"): Promise<User> {
  const email = `t13-consent-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`T13 browser fixture setup failed: ${label}`);
  const profile = await admin.from("profiles").update({
    display_name: label,
    locale,
    timezone: "Asia/Jakarta",
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", id);
  if (profile.error) throw new Error(`T13 browser fixture setup failed: ${label} profile`);
  const user = { id, email, password };
  users.push(user);
  return user;
}

async function signIn(page: Page, user: User, button = "Sign in"): Promise<void> {
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function consentRow(userId: string) {
  const { data, error } = await admin.from("profiles").select("ai_consent_at, ai_consent_version").eq("id", userId).single();
  if (error || !data) throw new Error("profile unavailable");
  return data;
}

async function expectNoOverflow(page: Page, testInfo: TestInfo, name: string, width: number, height: number, theme: "light" | "dark") {
  await page.setViewportSize({ width, height });
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);
  await page.goto("/settings/profile");
  await expect(page.getByRole("heading", { name: "AI processing" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const running = document.getAnimations().filter((animation) =>
      animation.playState === "running" && Number.isFinite(animation.effect?.getComputedTiming().endTime ?? Infinity));
    await Promise.all(running.map((animation) => animation.finished.catch(() => undefined)));
  });
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  if (size.scroll > size.width) {
    const wide = await page.evaluate((limit) => Array.from(document.querySelectorAll("body *"))
      .filter((element) => element.getBoundingClientRect().right > limit + 1)
      .slice(0, 12)
      .map((element) => `${element.tagName}.${(element as HTMLElement).className}#${element.id} ${Math.round(element.getBoundingClientRect().right)}`)
      .concat((() => {
        const found: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && found.length < 5; node = walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          if (range.getBoundingClientRect().right > limit + 1) found.push(`TEXT(${node.parentElement?.tagName}.${node.parentElement?.className}) ${node.textContent?.slice(0, 24)}`);
        }
        return found;
      })()), size.width);
    console.log("OVERFLOW", name, JSON.stringify(wide));
  }
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
  await page.getByRole("heading", { name: "AI processing" }).scrollIntoViewIfNeeded();
  await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
}

test.beforeAll(() => {
  const { url, secretKey } = config();
  admin = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
});

test.afterAll(async () => {
  for (const user of users) await admin.auth.admin.deleteUser(user.id);
});

test("S12 AI consent: decline, allow, withdraw, conflict, locale and accessibility", async ({ page, browser }, testInfo) => {
  const user = await createUser("T13 Consent Owner");
  await signIn(page, user);
  await page.goto("/settings/profile");

  const card = page.locator("#ai-consent-form");
  const status = page.getByTestId("ai-consent-status");
  const allowTrigger = card.getByRole("button", { name: "Allow AI…", exact: true });
  const dialog = page.getByRole("dialog", { name: "Allow AI processing?" });
  await expect(status).toHaveText("Not allowed");
  await expectNoWcagViolations(page, testInfo, "s12-consent-off");

  // 1. Escape and Continue manually close the dialog without consent; focus returns to the trigger.
  await allowTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue manually" })).toBeFocused();
  await expect(dialog).toContainText("OpenAI");
  await expect(dialog).toContainText("Evidence files, file names, your name, your email");
  await expectNoWcagViolations(page, testInfo, "s12-consent-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(allowTrigger).toBeFocused();
  expect(await consentRow(user.id)).toEqual({ ai_consent_at: null, ai_consent_version: null });

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Enter"); // focus is on Continue manually
  await expect(dialog).toBeHidden();
  expect(await consentRow(user.id)).toEqual({ ai_consent_at: null, ai_consent_version: null });

  // 2. Allow with the keyboard only.
  await allowTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Continue manually" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Allow AI", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toContainText("Allowed since");
  await expect(card).toContainText("Consent version ai-processing-v1");
  await expect(status).toBeFocused();
  await expect(card.getByRole("status")).toContainText("AI processing allowed.");
  const granted = await consentRow(user.id);
  expect(granted.ai_consent_version).toBe("ai-processing-v1");
  expect(granted.ai_consent_at).not.toBeNull();
  await page.reload();
  await expect(status).toContainText("Allowed since");
  await expectNoWcagViolations(page, testInfo, "s12-consent-on");

  // The profile editor keeps working after the consent change bumped the profile revision.
  await page.getByLabel("Headline").fill("Consent regression headline");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");

  // 3. Withdraw with inline confirmation; manual capture still works without AI.
  const withdraw = card.getByRole("button", { name: "Withdraw consent" });
  await withdraw.click();
  await expect(card.getByRole("button", { name: "Keep AI allowed" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(withdraw).toBeFocused();
  await withdraw.click();
  await card.getByRole("button", { name: "Withdraw now" }).click();
  await expect(status).toHaveText("Not allowed");
  await expect(card).toContainText("AI consent withdrawn. Manual features remain available.");
  expect(await consentRow(user.id)).toEqual({ ai_consent_at: null, ai_consent_version: null });

  await page.goto("/activity/new");
  const noteText = `T13 manual note ${randomUUID()}`;
  await page.locator("#quick-log-note").fill(noteText);
  await page.locator("#quick-log-note-form button[type='submit']").click();
  await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
  const activityId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  await expect(page.locator("main")).toContainText(noteText);
  await expect(page.locator("main")).not.toContainText(/analy[sz]ing|menganalisis/i);
  // service_role has no SELECT on activities (T06); read through the owner session.
  const owner = createClient<Database>(config().url, process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] ?? "", {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  await owner.auth.signInWithPassword({ email: user.email, password: user.password });
  const { data: saved } = await owner.from("activities").select("analysis_state, raw_text").eq("id", activityId).single();
  await owner.auth.signOut({ scope: "local" });
  expect(saved).toEqual({ analysis_state: "not_requested", raw_text: noteText });
  const { count: jobCount } = await admin.from("ai_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  expect(jobCount).toBe(0);

  // 4. Conflict: a second tab with a stale profile revision cannot overwrite the newer setting.
  await page.goto("/settings/profile");
  const staleContext = await browser.newContext({ storageState: await page.context().storageState() });
  const stale = await staleContext.newPage();
  await stale.goto(`${BASE_URL}/settings/profile`);
  await expect(stale.getByTestId("ai-consent-status")).toHaveText("Not allowed");

  await allowTrigger.click();
  await dialog.getByRole("button", { name: "Allow AI", exact: true }).click();
  await expect(status).toContainText("Allowed since");

  await stale.locator("#ai-consent-form").getByRole("button", { name: "Allow AI…" }).click();
  await stale.getByRole("dialog", { name: "Allow AI processing?" }).getByRole("button", { name: "Allow AI", exact: true }).click();
  await expect(stale.locator("#ai-consent-form")).toContainText("Your AI setting changed in another tab or session");
  await expect(stale.getByRole("dialog", { name: "Allow AI processing?" })).toBeHidden();
  await expect(stale.getByTestId("ai-consent-status")).toHaveText("Not allowed");
  await stale.locator("#ai-consent-form").getByRole("link", { name: "Reload" }).click();
  await expect(stale.getByTestId("ai-consent-status")).toContainText("Allowed since");
  await staleContext.close();

  // 6. Responsive light/dark without horizontal overflow.
  for (const [width, height] of [[360, 800], [1440, 900]] as const) {
    for (const theme of ["light", "dark"] as const) {
      await expectNoOverflow(page, testInfo, `s12-consent-${width}-${theme}`, width, height, theme);
    }
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await page.context().addCookies([{ name: "wp-theme", value: "dark", url: BASE_URL }]);
  await page.goto("/settings/profile");
  await expectNoWcagViolations(page, testInfo, "s12-consent-360-dark");
});

test("S12 AI consent dialog in Bahasa Indonesia", async ({ page }, testInfo) => {
  const user = await createUser("T13 Pemilik Persetujuan", "id");
  await signIn(page, user);
  await page.goto("/settings/profile");
  const card = page.locator("#ai-consent-form");
  await expect(page.getByTestId("ai-consent-status")).toHaveText("Tidak diizinkan");
  await card.getByRole("button", { name: "Izinkan AI…" }).click();
  const dialog = page.getByRole("dialog", { name: "Izinkan pemrosesan AI?" });
  await expect(dialog).toContainText("OpenAI");
  await expect(dialog).toContainText("File bukti, nama file, nama Anda, email Anda");
  await expect(dialog).toContainText("entri manual serta pengeditan CV selalu tersedia");
  await expectNoWcagViolations(page, testInfo, "s12-consent-dialog-id");
  await dialog.getByRole("button", { name: "Lanjutkan manual" }).click();
  await expect(dialog).toBeHidden();
  expect(await consentRow(user.id)).toEqual({ ai_consent_at: null, ai_consent_version: null });
});
