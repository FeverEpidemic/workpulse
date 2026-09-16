import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const APP_ORIGIN = process.env["WORKPULSE_SITE_URL"] ?? "http://127.0.0.1:3000";
const MAILPIT_ORIGIN = process.env["WORKPULSE_MAILPIT_URL"] ?? "http://127.0.0.1:54324";
const INITIAL_PASSWORD = "Test-password-123!";

interface MailAddress {
  Address?: string;
  Email?: string;
}

interface MailSummary {
  ID: string;
  Subject: string;
  To: MailAddress[];
}

interface MailList {
  messages?: MailSummary[];
}

interface MailDetail {
  HTML?: string;
  Text?: string;
}

async function confirmSignup(request: APIRequestContext, page: Page, email: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let message: MailSummary | undefined;
  while (Date.now() < deadline && !message) {
    const response = await request.get(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=50`);
    if (response.ok()) {
      const list = await response.json() as MailList;
      message = list.messages?.find((item) =>
        /confirm/i.test(item.Subject) &&
        item.To.some((recipient) => (recipient.Address ?? recipient.Email ?? "").toLowerCase() === email.toLowerCase()),
      );
    }
    if (!message) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  expect(message, `A local confirmation email should arrive for ${email}`).toBeTruthy();

  const response = await request.get(`${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent((message as MailSummary).ID)}`);
  expect(response.ok()).toBeTruthy();
  const detail = await response.json() as MailDetail;
  const body = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`;
  const candidate = [...body.matchAll(/href\s*=\s*["']([^"']*\/auth\/confirm[^"']*)["']/gi)]
    .map((match) => match[1])[0]
    ?? body.match(/https?:\/\/[^\s"'<>]*\/auth\/confirm[^\s"'<>]*/i)?.[0];
  expect(candidate, "The email should contain the WorkPulse confirmation route").toBeTruthy();
  const decoded = (candidate as string)
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x3D;", "=")
    .replaceAll("&quot;", "\"");
  const confirmationUrl = new URL(decoded, APP_ORIGIN);
  expect(confirmationUrl.origin).toBe(APP_ORIGIN);
  expect(confirmationUrl.pathname).toBe("/auth/confirm");
  expect(confirmationUrl.searchParams.has("token_hash") || confirmationUrl.searchParams.has("code")).toBe(true);
  await page.goto(confirmationUrl.toString());
}

async function expectNoSeriousAxeViolations(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  await testInfo.attach(`axe-${label}.json`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  const serious = results.violations.filter((violation) =>
    violation.impact === "serious" || violation.impact === "critical",
  );
  expect(serious, `${label} serious/critical Axe violations`).toEqual([]);
}

async function attachViewportScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, {
    path,
    contentType: "image/png",
  });
}

async function expectNoHorizontalOverflow(page: Page, route: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 500 ? 820 : 960 });
  await page.goto(route);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth, `${route} at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);
}

test("authenticated frame, themes, filters, keyboard paths, and responsive states work together", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const suffix = randomUUID().slice(0, 8);
  const email = `wp-ui-${suffix}@example.test`;

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(INITIAL_PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  await confirmSignup(request, page, email);
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  await page.getByLabel("Display name").fill(`UI test ${suffix}`);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const primaryNavigation = page.locator(".workspace-sidebar").getByRole("navigation", { name: "Primary navigation" });
  const expectedRoutes = [
    ["Dashboard", "/dashboard"],
    ["Activity", "/activity"],
    ["Achievements", "/achievements"],
    ["Projects", "/projects"],
    ["Timeline", "/timeline"],
    ["CV", "/cv"],
  ] as const;
  await expect(primaryNavigation.getByRole("link")).toHaveCount(expectedRoutes.length);
  for (const [label, href] of expectedRoutes) {
    const link = primaryNavigation.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", href);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
    await expect(primaryNavigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
  }

  await page.goto("/dashboard");
  await expectNoSeriousAxeViolations(page, testInfo, "dashboard");
  await page.setViewportSize({ width: 1440, height: 960 });
  await attachViewportScreenshot(page, testInfo, "dashboard-desktop-light.png");
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page).toHaveURL(/\/dashboard$/);
  await attachViewportScreenshot(page, testInfo, "dashboard-desktop-dark.png");
  expect(await page.evaluate(() => document.cookie)).toContain("wp-theme=dark");

  await page.evaluate(() => {
    document.cookie = "wp-theme=; Path=/; Max-Age=0; SameSite=Lax";
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.goto("/activity");
  await expectNoSeriousAxeViolations(page, testInfo, "activity");
  await page.getByLabel("From").fill("2025-01-02");
  await page.getByLabel("Project").fill("Launch planning");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/\/activity\?/);
  const filteredUrl = new URL(page.url());
  expect(filteredUrl.searchParams.get("from")).toBe("2025-01-02");
  expect(filteredUrl.searchParams.get("project")).toBe("Launch planning");
  expect(filteredUrl.searchParams.has("to")).toBe(false);
  await page.getByLabel("Project").fill("Customer launch");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/project=Customer\+launch/);
  await page.goBack();
  await expect(page.getByLabel("Project")).toHaveValue("Launch planning");
  await page.goForward();
  await expect(page.getByLabel("Project")).toHaveValue("Customer launch");
  await page.goto("/activity?from=not-a-date&returnTo=https%3A%2F%2Fevil.example&unknown=1");
  await expect(page.getByLabel("From")).toHaveValue("");
  await expect(page).toHaveURL(/returnTo=https%3A%2F%2Fevil\.example/);

  await page.goto("/activity/new");
  const quickLogInput = page.getByLabel("Work note");
  await expect(quickLogInput).toBeFocused();
  await expect(page.getByRole("button", { name: "Saving is not available yet" })).toBeDisabled();

  await page.goto("/settings/profile");
  await expectNoSeriousAxeViolations(page, testInfo, "profile");
  await page.getByLabel("Headline").fill(`Unsaved UI draft ${suffix}`);
  const activityLink = primaryNavigation.getByRole("link", { name: "Activity", exact: true });
  await activityLink.click();
  const unsavedDialog = page.getByRole("dialog", { name: "Leave without saving?" });
  await expect(unsavedDialog).toBeVisible();
  await unsavedDialog.getByRole("button", { name: "Stay on this page" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(activityLink).toBeFocused();
  await activityLink.click();
  await page.getByRole("dialog", { name: "Leave without saving?" })
    .getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.locator(".workspace-sidebar").getByRole("link", { name: "Profile and settings", exact: true }).click();
  await expect(page.getByLabel("Headline")).toHaveValue(`Unsaved UI draft ${suffix}`);

  await page.goto("/dashboard");
  await page.keyboard.press("Tab");
  await expect(page.locator(".skip-link")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  await page.setViewportSize({ width: 360, height: 820 });
  await page.goto("/dashboard");
  const menuButton = page.getByRole("button", { name: "Open navigation menu" });
  await menuButton.click();
  const drawer = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(drawer).toBeVisible();
  await attachViewportScreenshot(page, testInfo, "navigation-drawer-mobile.png");
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(menuButton).toBeFocused();
  await menuButton.click();
  await drawer.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(drawer).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Quick log", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Quick log", exact: true }).click();
  await expect(page).toHaveURL(/\/activity\/new$/);
  await expect(page.getByLabel("Work note")).toBeFocused();

  const responsiveRoutes = ["/dashboard", "/activity", "/activity/new", "/settings/profile"];
  for (const width of [360, 1440]) {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
        document.cookie = `wp-theme=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
      }, theme);
      for (const route of responsiveRoutes) await expectNoHorizontalOverflow(page, route, width);
      if (width === 360 && theme === "light") {
        await expectNoHorizontalOverflow(page, "/dashboard", width);
        await attachViewportScreenshot(page, testInfo, "dashboard-mobile-light.png");
      }
      if (width === 360 && theme === "dark") {
        await expectNoHorizontalOverflow(page, "/dashboard", width);
        await attachViewportScreenshot(page, testInfo, "dashboard-mobile-dark.png");
      }
    }
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  const transitionDuration = await page.locator(".workspace-nav-link").first().evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000,
  );
  expect(transitionDuration).toBeLessThanOrEqual(0.01);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
