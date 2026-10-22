import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectNoWcagViolations } from "./accessibility";
import { signIn, type User } from "./release-fixture";

export async function motionShot(page: Page, target: Locator, name: string): Promise<void> {
  const directory = "docs/verification/T30-screenshots";
  mkdirSync(directory, { recursive: true });
  await target.screenshot({
    path: join(directory, `${name}.png`), animations: "allow",
    mask: [page.locator("input[type='date'], time"), target.locator(".field-help[aria-hidden='true']")],
  });
}

export async function verifyNavigationLoading(page: Page, user: User, testInfo: TestInfo, width: number, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: String(testInfo.project.use.baseURL) }]);
  await page.addInitScript(() => {
    const observed: { tag: string; pending: string | null }[] = [];
    Object.assign(window, { t30PendingObserved: observed });
    new MutationObserver((changes) => {
      for (const change of changes) {
        const element = change.target as HTMLElement;
        if (element.matches(".pending-link-content, .workspace-nav-link, .workspace-tab")) observed.push({ tag: element.tagName, pending: element.getAttribute("data-pending") });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-pending"] });
  });
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let fetched = false;
  const target = (url: URL) => url.pathname === "/activity";
  await page.route(target, async (route) => {
    const headers = route.request().headers();
    if (headers["rsc"] !== "1" || headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) {
      await route.continue(); return;
    }
    const response = await route.fetch();
    console.log("T30 held navigation response", JSON.stringify({ prefetch: headers["next-router-prefetch"] ?? null, segment: headers["next-router-segment-prefetch"] ?? null, status: response.status() }));
    fetched = true;
    await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  try {
    await signIn(page, user, "/dashboard");
    await page.waitForLoadState("networkidle");
    const nav = width <= 880 ? page.locator(".workspace-tab-bar") : page.locator(".workspace-sidebar");
    const link = nav.getByRole("link", { name: "Activity", exact: true });
    await link.click({ noWaitAfter: true });
    await expect.poll(() => fetched).toBe(true);
    console.log("T30 pending diagnostic", JSON.stringify(await page.evaluate(() => ({ pathname: location.pathname, skeletons: document.querySelectorAll(".ui-skeleton").length, pageHeading: document.querySelector("main h1")?.textContent, hook: [...document.querySelectorAll("a[href='/activity'] .pending-link-content")].map((element) => element.getAttribute("data-pending")), observed: (window as unknown as { t30PendingObserved: unknown }).t30PendingObserved }))));
    await expect(link).toHaveAttribute("data-pending", "true");
    await expect.poll(() => link.locator(".ui-loading-spinner").evaluate((element) => Number(getComputedStyle(element).opacity))).toBeGreaterThan(0);
    await motionShot(page, link, `navigation-pending-${width}-${theme}`);
    const loading = page.locator(".ui-page-loading-status").first();
    await expect(loading.getByText("Loading this page", { exact: true })).toBeVisible();
    const skeleton = page.locator(".ui-skeleton").first();
    await expect(skeleton).toHaveCSS("animation-name", "ui-skeleton-pulse");
    await motionShot(page, skeleton, `skeleton-${width}-${theme}`);
    await expectNoWcagViolations(page, testInfo, `t30-skeleton-${width}-${theme}`);
    await expect(loading.getByRole("button", { name: "Reload", exact: true })).toBeVisible({ timeout: 12_000 });
    await motionShot(page, loading, `slow-loading-${width}-${theme}`);
    const reload = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname === "/activity");
    await loading.getByRole("button", { name: "Reload", exact: true }).click();
    await reload;
    await expect(page.locator(".activity-list")).toBeVisible();
    await expect(page.locator(".ui-skeleton")).toHaveCount(0);
  } finally {
    release();
    await page.unroute(target);
  }
}
