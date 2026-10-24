import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectNoWcagViolations } from "./accessibility";
import { signIn, type User } from "./release-fixture";
import { drainAiWorker } from "./ai-worker";

export async function verifyPendingAndProgress(page: Page, user: User, testInfo: TestInfo, width: number, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height: 800 });
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: String(testInfo.project.use.baseURL) }]);
  await signIn(page, user, "/activity/new");
  const note = `T30 private capture ${width} ${theme}`;
  await page.locator("textarea[name='raw_text']").fill(note);
  const button = page.locator("#quick-log-note-form button[type='submit']");
  await expect(button).toBeEnabled();
  const before = await button.boundingBox();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let posts = 0;
  await page.route("**/activity/new", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts += 1;
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  try {
    await button.dblclick({ noWaitAfter: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toContainText("Save activity");
    await expect(button).toHaveCSS("opacity", "1");
    expect(Math.abs((await button.boundingBox())!.width - before!.width)).toBeLessThanOrEqual(1);
    await expect(button.locator(".ui-loading-spinner")).toHaveCSS("animation-delay", "0s, 0.15s");
    await expect.poll(() => button.locator(".ui-loading-spinner").evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1);
    await motionShot(page, button, `button-pending-${width}-${theme}`);
    await expectNoWcagViolations(page, testInfo, `t30-button-${width}-${theme}`);
    expect(posts).toBe(1);
  } finally { release(); }
  await expect(page).toHaveURL((url) => /^\/activity\/[0-9a-f-]+$/.test(url.pathname));
  const rows = await user.client.from("activities").select("id").eq("raw_text", note);
  expect(rows.error).toBeNull();
  expect(rows.data).toHaveLength(1);
  await page.getByRole("button", { name: "Analyze with AI", exact: true }).click();
  const progress = page.locator(".ui-progress-status[data-kind='ai']");
  await expect(progress).toContainText("Waiting to start");
  await motionShot(page, progress, `progress-normal-${width}-${theme}`);
  const elapsed = progress.locator("[aria-hidden='true'].field-help");
  await expect(elapsed).toContainText(/Waiting \d+s/, { timeout: 5_000 });
  await expect(progress.getByRole("status")).not.toContainText(/Waiting \d+s/);
  await expectNoWcagViolations(page, testInfo, `t30-progress-${width}-${theme}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const paused = await elapsed.textContent();
  await page.waitForTimeout(2_100);
  expect(await elapsed.textContent()).toBe(paused);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(elapsed).not.toHaveText(paused!);
  await expect(progress.locator(".ui-progress-slow")).toBeVisible({ timeout: 35_000 });
  await motionShot(page, progress, `progress-slow-${width}-${theme}`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(progress.locator(".ui-loading-spinner")).toBeHidden();
  await expect(progress.locator(".ui-loading-static")).toBeVisible();
  await expect(elapsed).toBeVisible();
  await motionShot(page, progress, `progress-reduced-${width}-${theme}`);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const detailUrl = page.url();
  await page.goto("/dashboard");
  await page.waitForTimeout(1_200);
  expect(errors).toEqual([]);
  await page.goto(detailUrl);
  await expect(progress).toContainText("Waiting to start");
  expect(await drainAiWorker("valid")).toBeGreaterThan(0);
  await expect(progress).toHaveCount(0, { timeout: 35_000 });
  await expect(page.getByRole("heading", { name: "Suggested wording" })).toBeVisible();
  await page.goto("/settings/profile");
  const trigger = page.getByRole("button", { name: "Delete account", exact: true });
  await trigger.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.00001);
  await motionShot(page, modal, `dialog-${width}-${theme}-reduced`);
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await trigger.click();
  await expect(modal).toHaveCSS("transition-duration", "0.18s");
  await expect.poll(() => modal.evaluate((element) => getComputedStyle(element, "::backdrop").opacity)).toBe("1");
  await motionShot(page, modal, `dialog-${width}-${theme}`);
  await expectNoWcagViolations(page, testInfo, `t30-dialog-${width}-${theme}`);
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).not.toBeVisible();
  const closingModal = page.locator("dialog").filter({ has: page.locator("#delete-account-password") });
  await expect(closingModal).toHaveCSS("transition-duration", "0.12s, 0.12s, 0.12s, 0.12s");
  await expect.poll(() => closingModal.evaluate((element) => getComputedStyle(element, "::backdrop").transitionDuration)).toBe("0.12s, 0.12s, 0.12s");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(modal).toBeVisible();
  await page.mouse.click(1, 1);
  await expect(modal).not.toBeVisible();
  await expect(trigger).toBeFocused();
}

export async function verifyQuickLogMotion(page: Page, user: User, testInfo: TestInfo, theme: "light" | "dark", path: "/dashboard" | "/activity"): Promise<void> {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: String(testInfo.project.use.baseURL) }]);
  await page.addInitScript(() => {
    const writes: string[] = [];
    const toastEvents: { kind: string; at: number }[] = [];
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "attributes" && (change.target as HTMLElement).matches(".ui-toast[data-leaving='true']")) toastEvents.push({ kind: "leaving", at: performance.now() });
        for (const node of change.addedNodes) if (node instanceof HTMLElement && node.matches(".ui-toast")) toastEvents.push({ kind: "added", at: performance.now() });
        for (const node of change.removedNodes) if (node instanceof HTMLElement && node.matches(".ui-toast")) toastEvents.push({ kind: "removed", at: performance.now() });
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-leaving"] });
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "workpulse-just-added") writes.push(value);
      original.call(this, key, value);
    };
    Object.assign(window, { t30Markers: writes, t30ToastEvents: toastEvents });
  });
  await signIn(page, user, path);
  const trigger = page.locator(".workspace-tab-bar").getByRole("button", { name: "Quick log", exact: true });
  const dialog = page.getByRole("dialog", { name: "Quick log", exact: true });
  await trigger.click();
  await expect(dialog.locator("textarea")).toBeFocused();
  await page.setViewportSize({ width: 360, height: 420 });
  await expect(dialog.locator("textarea")).toBeFocused();
  await expect.poll(() => dialog.locator("textarea").evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(420);
  await expect.poll(() => dialog.locator("textarea").evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 360, height: 800 });
  await motionShot(page, dialog, `sheet-${path.slice(1)}-${theme}`);
  await expect(dialog).toHaveCSS("transition-duration", "0.24s");
  await expectNoWcagViolations(page, testInfo, `t30-sheet-${path}-${theme}`);
  const sheetElement = (await dialog.elementHandle())!;
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  expect(await sheetElement.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0.18s");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "Close quick log", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  const note = `T30 private sheet ${path} ${theme}`;
  await dialog.locator("textarea").fill(note);
  await dialog.getByRole("button", { name: "Save activity", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".ui-toast")).toHaveCount(1);
  await expect(page.locator(".ui-toast")).toContainText("Activity saved");
  await expect(page.locator(".ui-toast")).toHaveCSS("animation-name", "ui-toast-enter");
  await expect(page.locator(".ui-toast")).toHaveCSS("animation-duration", "0.18s");
  await expect(page.locator(".ui-toast")).toHaveCSS("transition-duration", "0.12s");
  const highlighted = page.locator("[data-just-added='true']");
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toContainText(note);
  await highlighted.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await highlighted.evaluate((element) => {
    for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = 200; }
  });
  await motionShot(page, highlighted, `highlight-${path.slice(1)}-${theme}`);
  await highlighted.evaluate((element) => { for (const animation of element.getAnimations()) animation.play(); });
  expect(await page.evaluate(() => sessionStorage.getItem("workpulse-just-added"))).toBeNull();
  expect(await page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))).not.toContain(note);
  const markers = await page.evaluate(() => (window as unknown as { t30Markers: string[] }).t30Markers);
  expect(markers).toHaveLength(1);
  expect(Object.keys(JSON.parse(markers[0]!)).sort()).toEqual(["at", "id"]);
  await expect(page.locator(".ui-toast")).toHaveCount(0, { timeout: 6_000 });
  const toastEvents = await page.evaluate(() => (window as unknown as { t30ToastEvents: { kind: string; at: number }[] }).t30ToastEvents);
  expect(toastEvents.map((event) => event.kind)).toEqual(["added", "leaving", "removed"]);
  expect(toastEvents[1]!.at - toastEvents[0]!.at).toBeGreaterThanOrEqual(4_000);
  expect(toastEvents[2]!.at).toBeGreaterThan(toastEvents[1]!.at);
  await page.reload();
  await expect(page.locator("[data-just-added]")).toHaveCount(0);
}

export async function motionShot(page: Page, target: Locator, name: string, viewport = false): Promise<void> {
  const directory = "docs/verification/T30-screenshots";
  mkdirSync(directory, { recursive: true });
  const options = {
    path: join(directory, `${name}.png`), animations: "allow" as const,
    mask: [target.locator("input[type='date'], time, .field-help[aria-hidden='true']")], maskColor: "#8a8a8a",
  };
  if (viewport) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot(options);
  } else await target.screenshot(options);
}

export async function verifyNavigationLoading(page: Page, user: User, testInfo: TestInfo, width: number, theme: "light" | "dark", checkNavigationPending = true, reloadOnSlow = true): Promise<void> {
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
    console.log("T30 pending diagnostic", JSON.stringify(await page.evaluate(() => ({
      pathname: location.pathname,
      skeletons: document.querySelectorAll(".ui-skeleton").length,
      hook: [...document.querySelectorAll("a[href='/activity'] .pending-link-content")].map((element) => element.getAttribute("data-link-pending")),
      combined: [...document.querySelectorAll("a[href='/activity'] .pending-link-content")].map((element) => element.getAttribute("data-pending")),
    }))));
    if (checkNavigationPending) {
      await expect(link).toHaveAttribute("data-pending", "true");
      await expect(link.locator(".pending-link-content")).toHaveAttribute("data-link-pending", "false");
      await expect(link).toHaveAttribute("data-pending", "true");
      await expect.poll(() => link.locator(".ui-loading-spinner").evaluate((element) => Number(getComputedStyle(element).opacity))).toBe(1);
      await motionShot(page, link, `navigation-pending-${width}-${theme}`);
    }
    const loading = page.locator(".ui-page-loading-status").first();
    await expect(loading.getByText("Loading this page", { exact: true })).toBeVisible();
    const skeleton = page.locator(".ui-skeleton").first();
    await expect(skeleton).toHaveCSS("animation-name", "ui-skeleton-pulse");
    await motionShot(page, page.locator("main"), `skeleton-${width}-${theme}`, true);
    await expectNoWcagViolations(page, testInfo, `t30-skeleton-${width}-${theme}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(skeleton).toHaveCSS("animation-name", "none");
    await expect(skeleton).toHaveCSS("opacity", "1");
    await expect(loading.getByText("Loading this page", { exact: true })).toBeVisible();
    await motionShot(page, page.locator("main"), `loading-reduced-${width}-${theme}`, true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    if (!reloadOnSlow) {
      release();
      await expect(page.locator(".activity-list")).toBeVisible();
      await expect(page.locator(".ui-skeleton")).toHaveCount(0);
      await expect(link).toHaveAttribute("data-pending", "false");
      await expect(link.locator(".pending-link-spinner")).toHaveCount(0);
      return;
    }
    await expect(loading.getByRole("button", { name: "Reload", exact: true })).toBeVisible({ timeout: 12_000 });
    await motionShot(page, loading, `slow-loading-${width}-${theme}`);
    const reload = page.waitForRequest((request) => request.isNavigationRequest() && new URL(request.url()).pathname === "/activity");
    await loading.getByRole("button", { name: "Reload", exact: true }).click();
    await reload;
    await expect(page.locator(".activity-list")).toBeVisible();
    await expect(page.locator(".ui-skeleton")).toHaveCount(0);
    await expect(link).toHaveAttribute("data-pending", "false");
  } finally {
    release();
    await page.unroute(target);
  }
}
