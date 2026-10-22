import { expect, test } from "@playwright/test";
import { consent, createUser, removeUsers, seedCareer, signIn, type Career, type User } from "./helpers/release-fixture";
import { verifyNavigationLoading } from "./helpers/motion-loading";

let user: User;
let career: Career;
test.beforeAll(async () => {
  user = await createUser("t30-motion");
  career = await seedCareer(user);
  await consent(user);
});
test.afterAll(async () => { if (user) await removeUsers([user]); });

for (const width of [360, 1440]) {
  test(`T30 navigation pending and slow loading at ${width}`, async ({ page }, testInfo) => {
    await verifyNavigationLoading(page, user, testInfo, width, "light");
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
