import { expect, test, type Locator, type Page } from "@playwright/test";
import { consent, createUser, removeUsers, seedCareer, signIn, type Career, type User } from "./helpers/release-fixture";
import { verifyNavigationLoading, verifyQuickLogMotion } from "./helpers/motion-loading";

let user: User;
let career: Career;
test.beforeAll(async () => {
  user = await createUser("t30-motion");
  career = await seedCareer(user);
  await consent(user);
});
test.afterAll(async () => { if (user) await removeUsers([user]); });

async function pressWithoutClick(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeEnabled();
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => control.evaluate((element) => getComputedStyle(element).transform)).toBe("matrix(0.97, 0, 0, 0.97, 0, 0)");
  await page.mouse.move(0, 0);
  await page.mouse.up();
}

for (const theme of ["light", "dark"] as const) {
  test(`T30 native press on five button variants ${theme}`, async ({ page }, testInfo) => {
    await page.context().addCookies([{ name: "wp-theme", value: theme, url: String(testInfo.project.use.baseURL) }]);
    await signIn(page, user, "/activity/new");
    await pressWithoutClick(page, page.locator("#quick-log-note-form .button-primary"));
    await pressWithoutClick(page, page.locator(".workspace-sidebar .button-secondary"));
    await pressWithoutClick(page, page.locator(".workspace-sidebar .ui-button-ghost"));
    await page.goto("/settings/profile");
    await pressWithoutClick(page, page.getByRole("button", { name: "Delete account", exact: true }));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.locator(".workspace-tab-bar").getByRole("button", { name: "Quick log", exact: true }).click();
    await pressWithoutClick(page, page.getByRole("dialog", { name: "Quick log", exact: true }).locator(".ui-icon-button"));
    await page.keyboard.press("Escape");
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const path of ["/dashboard", "/activity"] as const) {
    test(`T30 sheet, single toast and highlight ${path} ${theme}`, async ({ page }, testInfo) => {
      await verifyQuickLogMotion(page, user, testInfo, theme, path);
    });
  }
}

for (const width of [360, 1440]) {
  test(`T30 navigation pending and slow loading at ${width}`, async ({ page }, testInfo) => {
    await verifyNavigationLoading(page, user, testInfo, width, "light");
  });
  test(`T30 navigation pending and slow loading at ${width} dark`, async ({ page }, testInfo) => {
    await verifyNavigationLoading(page, user, testInfo, width, "dark");
  });
  test(`T30 navigation clears after fallback unmount at ${width}`, async ({ page }, testInfo) => {
    await verifyNavigationLoading(page, user, testInfo, width, "light", true, false);
  });
}

test("T30 page entry excludes chrome and does not replay for a GET filter", async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("animationstart", (event) => {
      if (event.animationName === "ui-page-enter") {
        sessionStorage.setItem("t30-page-entries", String(Number(sessionStorage.getItem("t30-page-entries") ?? 0) + 1));
      }
    });
  });
  await signIn(page, user, "/activity");
  await expect(page.locator(".workspace-page-enter")).toBeVisible();
  await expect(page.locator(".workspace-sidebar .workspace-page-enter, .workspace-tab-bar .workspace-page-enter, .workspace-mobile-header .workspace-page-enter")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("t30-page-entries")))).toBeGreaterThan(0);
  const count = await page.evaluate(() => Number(sessionStorage.getItem("t30-page-entries")));
  await page.locator("#activity-filter-from").fill("2026-01-01");
  await page.locator(".workspace-filter-form button[type='submit']").click();
  await expect(page).toHaveURL(/\/activity\?from=2026-01-01/);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => Number(sessionStorage.getItem("t30-page-entries")))).toBe(count);
  await page.locator(".workspace-sidebar").getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem("t30-page-entries")))).toBe(count + 1);
  expect(career.activityId).toBeTruthy();
});
