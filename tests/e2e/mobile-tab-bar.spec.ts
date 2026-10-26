import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoWcagViolations } from "./helpers/accessibility";
import { createUser, removeUsers, seedCareer, signIn, type Career, type User } from "./helpers/release-fixture";

// T27 plan section 1: the mobile tab bar, header, composer sheet and More menu at 360 px against a production build.
// T31 turns the bar into a floating capsule that narrows when compact (docs/verification/T31-implementation-plan.md).
// One account with a two-word name and 23 activities, so /activity is long enough to scroll at 360 x 640.

const SHOTS = "docs/verification/T31-screenshots";
const PHONE = { width: 360, height: 640 };
// T31: 8 px between the capsule and the screen edges, 268 px wide when compact (5 targets of 44 px, 6 gaps of 8 px).
const GUTTER = 8;
const COMPACT_WIDTH = 268;

let user: User;
let career: Career;

test.beforeAll(async () => {
  user = await createUser("tabbar", { name: "Rina Wulandari" });
  career = await seedCareer(user);
  for (let index = 0; index < 20; index += 1) {
    const day = String(1 + (index % 28)).padStart(2, "0");
    const created = await user.client.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(), p_raw_text: `Catatan kerja nomor ${index + 1} untuk daftar yang panjang.`,
      p_occurred_on: `2026-09-${day}`, p_capture_mode: "note", p_role: null as never, p_scope: null as never,
      p_outcome: null as never, p_experience_id: null as never, p_project_id: null as never,
    });
    if (created.error) throw new Error("T27 fixture failed: activity");
  }
});

test.afterAll(async () => {
  if (user) await removeUsers([user]);
});

function tabBar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main tabs" });
}

function header(page: Page): Locator {
  return page.locator(".workspace-mobile-header");
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), animations: "disabled", mask: [page.getByText(user.email)], maskColor: "#8a8a8a" });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: new URL(page.url()).origin }]);
}

async function scrollBy(page: Page, deltaY: number): Promise<void> {
  // The scroll listener exists only after hydration; a wheel before that moves the page without a state change.
  await page.waitForLoadState("networkidle");
  await page.mouse.move(180, 300);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(250);
}

async function capsule(page: Page): Promise<{ left: number; right: number; bottom: number; width: number }> {
  const box = await tabBar(page).boundingBox();
  return { left: box!.x, right: box!.x + box!.width, bottom: box!.y + box!.height, width: box!.width };
}

async function expectCompactCapsule(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await expect.poll(async () => Math.round((await capsule(page)).width), "capsule narrows to five targets").toBe(COMPACT_WIDTH);
  const box = await capsule(page);
  expect(Math.abs(box.left - (viewport.width - box.right)), "capsule stays centred").toBeLessThanOrEqual(1);
  expect(Math.abs(box.bottom - (viewport.height - GUTTER)), "capsule keeps its distance from the bottom").toBeLessThanOrEqual(1);
}

async function expectTargets(page: Page, minGap: number): Promise<void> {
  const boxes = await tabBar(page).locator("a, button").evaluateAll((controls) =>
    controls.map((control) => control.getBoundingClientRect().toJSON() as DOMRect));
  for (const box of boxes) {
    expect(box.width, "target width").toBeGreaterThanOrEqual(44);
    expect(box.height, "target height").toBeGreaterThanOrEqual(44);
  }
  for (let index = 1; index < boxes.length; index += 1) {
    expect(boxes[index]!.left - boxes[index - 1]!.right, `gap between target ${index} and ${index + 1}`).toBeGreaterThanOrEqual(minGap - 0.5);
  }
}

async function draftNote(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((entry) => entry.endsWith(":quick-log-note"));
    if (!key) return null;
    const draft = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    return typeof draft["raw_text"] === "string" ? draft["raw_text"] : null;
  });
}

test("five tabs, the current tab, labels and header that follow the scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, user, "/dashboard");
  const bar = tabBar(page);

  // Acceptance 1: five controls in a fixed order, no drawer.
  const names = await bar.locator("a, button").evaluateAll((controls) => controls.map((control) => {
    const label = control.querySelector(".workspace-tab-label");
    return `${control.tagName.toLowerCase()}:${label?.textContent ?? ""}`;
  }));
  expect(names).toEqual(["a:Dashboard", "a:Activity", "button:Quick log", "a:Projects", "a:Profile"]);
  await expect(page.getByRole("button", { name: "Open navigation menu" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Primary navigation" })).toHaveCount(0);
  await expect(header(page)).toContainText("Dashboard");
  // Every visible label fits its slot, including the bold current one.
  const clipped = await bar.locator(".workspace-tab-label:not(.sr-only)").evaluateAll((labels) =>
    labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent));
  expect(clipped).toEqual([]);
  // T31 G1: the bold current "Dashboard" label keeps real room inside its tab, not a rounding error.
  const room = await bar.locator('a[aria-current="page"]').evaluate((tab) => {
    const range = document.createRange();
    range.selectNodeContents(tab.querySelector(".workspace-tab-label")!);
    return tab.clientWidth - range.getBoundingClientRect().width;
  });
  expect(room, "room left for the bold current label").toBeGreaterThanOrEqual(1.5);

  // T31 acceptance 1: a floating capsule 8 px off the left, right and bottom, border on four sides, no blur.
  const expanded = await capsule(page);
  expect(expanded.left).toBeCloseTo(GUTTER, 0);
  expect(expanded.right).toBeCloseTo(PHONE.width - GUTTER, 0);
  expect(expanded.bottom).toBeCloseTo(PHONE.height - GUTTER, 0);
  const surface = await bar.evaluate((element) => {
    const style = getComputedStyle(element);
    const radius = getComputedStyle(document.documentElement).getPropertyValue("--radius-lg").trim();
    return {
      borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      radius: style.borderTopLeftRadius,
      radiusToken: radius,
      shadow: style.boxShadow,
      blur: style.backdropFilter,
      transition: { property: style.transitionProperty, duration: style.transitionDuration, easing: style.transitionTimingFunction },
    };
  });
  expect(surface.borders).toEqual(["1px", "1px", "1px", "1px"]);
  expect(surface.radius).toBe(surface.radiusToken);
  expect(surface.shadow).not.toBe("none");
  expect(surface.blur).toBe("none");
  // T31 acceptance 3: width eases with the T30 normal duration and ease-out curve.
  expect(surface.transition).toEqual({ property: "width", duration: "0.18s", easing: "cubic-bezier(0.2, 0, 0, 1)" });
  const listTransition = await bar.locator(".workspace-tab-list").evaluate((list) => {
    const style = getComputedStyle(list);
    return { property: style.transitionProperty, duration: style.transitionDuration };
  });
  expect(listTransition.property.split(", ")).toEqual(expect.arrayContaining(["height", "column-gap", "padding"]));
  expect(new Set(listTransition.duration.split(", "))).toEqual(new Set(["0.18s"]));
  await expectTargets(page, 0);

  // T31 acceptance 5: a tap beside the capsule reaches the page, not the bar.
  const beside = await page.evaluate(({ x, y }) => {
    const hit = document.elementFromPoint(x, y);
    return { insideBar: hit?.closest(".workspace-tab-bar") !== null, tag: hit?.tagName ?? null };
  }, { x: GUTTER / 2, y: expanded.bottom - 32 });
  expect(beside.insideBar, `gutter hit ${beside.tag}`).toBe(false);

  // Acceptance 8: initials from the two-word name, hidden from screen readers; the tab is named Profile.
  const profileTab = bar.getByRole("link", { name: "Profile", exact: true });
  await expect(profileTab.locator(".initials-avatar")).toHaveText("RW");
  await expect(profileTab.locator(".initials-avatar")).toHaveAttribute("aria-hidden", "true");

  // Acceptance 2: exact route is the page, a child route marks its parent, the More menu routes light Profile.
  await expect(bar.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  await bar.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(bar.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(bar.getByRole("link", { name: "Dashboard", exact: true })).not.toHaveAttribute("aria-current", /.*/);
  const currentWeight = await bar.getByRole("link", { name: "Activity", exact: true }).evaluate((link) => getComputedStyle(link).fontWeight);
  expect(currentWeight).toBe("700");
  await page.goto(`/projects/${career.projectId}`);
  await expect(bar.getByRole("link", { name: "Projects", exact: true })).toHaveAttribute("aria-current", "true");
  await page.goto("/timeline");
  await expect(profileTab).toHaveAttribute("aria-current", "true");
  await page.goto("/activity/new");
  await expect(bar.locator("[aria-current]")).toHaveCount(0);

  // Acceptance 3 and 4: down past the threshold compacts the bar and hides the header; up brings both back.
  await page.goto("/activity");
  await expect(page.locator("main")).toContainText("Catatan kerja nomor 20");
  await expect(bar).toHaveAttribute("data-compact", "false");
  await scrollBy(page, 600);
  await expect(bar).toHaveAttribute("data-compact", "true");
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await expect.poll(() => header(page).evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  await expect(bar.locator(".workspace-tab-label.sr-only")).toHaveCount(5);
  await expect(bar.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
  await expect.poll(() => bar.locator(".workspace-tab-list").evaluate((list) => list.getBoundingClientRect().height)).toBe(52);
  // T31 acceptance 2 and 7: the capsule closes in on five targets with 8 px between them.
  await expectCompactCapsule(page);
  await expectTargets(page, 8);
  await shot(page, "bar-compact-360-light");
  await scrollBy(page, -200);
  await expect(bar).toHaveAttribute("data-compact", "false");
  await expect(header(page)).toHaveAttribute("data-hidden", "false");
  await expect.poll(() => bar.locator(".workspace-tab-list").evaluate((list) => list.getBoundingClientRect().height)).toBe(64);
  await expect.poll(async () => Math.round((await capsule(page)).width), "capsule widens again").toBe(PHONE.width - 2 * GUTTER);

  // A tap on the bar outside the tabs brings the labels back without navigating.
  await scrollBy(page, 600);
  await expect(bar).toHaveAttribute("data-compact", "true");
  const box = await bar.boundingBox();
  await page.mouse.click(box!.x + 2, box!.y + box!.height / 2);
  await expect(bar).toHaveAttribute("data-compact", "false");
  // T31 G2: the tap widens the capsule back, not only the attribute.
  await expect.poll(async () => Math.round((await capsule(page)).width), "capsule widens after a tap").toBe(PHONE.width - 2 * GUTTER);
  await expect(page).toHaveURL(/\/activity$/);

  // A tab navigates in the compact state too, and the new page starts expanded at the top.
  await scrollBy(page, 600);
  await expect(bar).toHaveAttribute("data-compact", "true");
  await bar.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(bar).toHaveAttribute("data-compact", "false");
  await expect(header(page)).toHaveAttribute("data-hidden", "false");

  // Acceptance 4: keyboard focus inside a hidden header brings it back.
  await page.goto("/settings/profile");
  await scrollBy(page, 700);
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
  await page.getByRole("button", { name: "Open more menu" }).focus();
  await expect(header(page)).toHaveAttribute("data-hidden", "false");
  await expect.poll(() => header(page).evaluate((element) => getComputedStyle(element).transform)).toBe("none");
});

test("content is never under the bar and nothing scrolls sideways at 360 x 640", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, user, "/activity");
  for (const route of ["/activity", "/projects", "/settings/profile", "/dashboard", `/projects/${career.projectId}`]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const barElement = document.querySelector<HTMLElement>(".workspace-tab-bar")!;
      const bar = barElement.getBoundingClientRect();
      // Controls actually painted in the viewport: hit-tested with the bar out of the way, so a control clipped by its
      // own container does not count and one under the bar does.
      barElement.style.visibility = "hidden";
      const painted = [...document.querySelectorAll<HTMLElement>("main a, main button, main input, main select, main textarea, main summary")]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ element, rect }) => {
          const y = rect.top + rect.height / 2;
          if (rect.height === 0 || y < 0 || y > window.innerHeight) return false;
          const hit = document.elementFromPoint(rect.left + rect.width / 2, y);
          return hit !== null && (hit === element || element.contains(hit) || hit.closest("label")?.contains(element) === true);
        });
      barElement.style.visibility = "";
      const lowest = painted.reduce((bottom, { rect }) => Math.max(bottom, rect.bottom), 0);
      const padding = Number.parseFloat(getComputedStyle(document.querySelector("main")!).paddingBottom);
      return {
        painted: painted.length,
        lowestBottom: lowest,
        barTop: bar.top,
        padding,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(result.painted, `${route}: controls in view at the end of the page`).toBeGreaterThan(0);
    expect(result.lowestBottom, `${route}: no control under the bar`).toBeLessThanOrEqual(result.barTop);
    // T31: the 64 px bar plus its 8 px offset.
    expect(result.padding, `${route}: room for the expanded bar and its offset`).toBeGreaterThanOrEqual(64 + GUTTER);
    expect(result.overflow, `${route}: horizontal scroll`).toBeLessThanOrEqual(0);
  }
});

test("the composer opens focused, keeps the shared draft and saves in place", async ({ page }) => {
  const consoleText: string[] = [];
  page.on("console", (message) => consoleText.push(message.text()));
  await page.setViewportSize(PHONE);
  await signIn(page, user, "/projects");
  const sentinel = `T27 sentinel ${randomUUID()}`;
  const plus = tabBar(page).getByRole("button", { name: "Quick log", exact: true });
  const sheet = page.getByRole("dialog", { name: "Quick log" });
  const note = sheet.getByLabel("Work note");

  // Acceptance 5: one tap, the note is focused, no other screen.
  await plus.click();
  await expect(sheet).toBeVisible();
  await expect(note).toBeFocused();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(header(page)).toHaveAttribute("data-hidden", "false");
  await expect(sheet.getByRole("group", { name: "Capture mode" })).toHaveCount(0);
  await expect(sheet.locator('[name="project_id"]')).toHaveCount(0);
  await shot(page, "composer-360-light");

  // Acceptance 6: Escape, the close button and the backdrop all keep the draft; focus goes back to +.
  await note.fill(`${sentinel} draft`);
  await expect.poll(() => draftNote(page)).toBe(`${sentinel} draft`);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(plus).toBeFocused();
  expect(await draftNote(page)).toBe(`${sentinel} draft`);
  await plus.click();
  await expect(note).toHaveValue(`${sentinel} draft`);
  await sheet.getByRole("button", { name: "Close quick log" }).click();
  await expect(sheet).toBeHidden();
  await plus.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(180, 10);
  await expect(sheet).toBeHidden();
  expect(await draftNote(page)).toBe(`${sentinel} draft`);

  // The full form link carries the same text and the page the user came from.
  await plus.click();
  await sheet.getByRole("link", { name: "Open full form" }).click();
  await expect(page).toHaveURL(/\/activity\/new\?returnTo=%2Fprojects$/);
  await expect(page.getByLabel("Work note")).toHaveValue(`${sentinel} draft`);
  await expect(page.getByRole("dialog", { name: "Quick log" })).toBeHidden();
  // On the full form, + focuses the form already on screen instead of opening a second one.
  await page.getByLabel("Work note").blur();
  await plus.click();
  await expect(page.getByLabel("Work note")).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Quick log" })).toBeHidden();
  await tabBar(page).getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave without saving?" }).getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Same validation as the full form: an empty note is not sent, over 10,000 characters is flagged.
  await plus.click();
  await note.fill("");
  await sheet.getByRole("button", { name: "Save activity" }).click();
  await expect(sheet).toBeVisible();
  expect(await note.evaluate((element) => (element as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
  await note.evaluate((element) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.value = "a".repeat(10_001);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(sheet.getByText("Keep the source text within 10,000 Unicode characters.")).toBeVisible();

  // Acceptance 5: save closes the sheet, shows a toast, stays on the page and clears the draft.
  await note.fill(`${sentinel} saved`);
  await sheet.getByRole("button", { name: "Save activity" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".ui-toast").filter({ hasText: "Activity saved." }), "exactly one toast").toHaveCount(1);
  await expect(page).toHaveURL(/\/projects$/);
  await expect.poll(() => draftNote(page)).toBeNull();
  const toast = await page.locator(".ui-toast").first().boundingBox();
  const barBox = await tabBar(page).boundingBox();
  expect(toast!.y + toast!.height, "toast sits above the bar").toBeLessThanOrEqual(barBox!.y);
  await page.goto("/activity");
  await expect(page.locator("main")).toContainText(`${sentinel} saved`);
  expect(consoleText.filter((text) => text.includes(sentinel)), "the note never reaches the console").toEqual([]);
});

test("the More menu holds Achievements, Timeline, CV, theme and sign out", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, user, "/dashboard");
  await expect(page.getByRole("button", { name: "Open more menu" })).toHaveCount(0);
  await page.goto("/settings/profile");
  await expect(header(page)).toContainText("Profile and settings");
  const more = page.getByRole("button", { name: "Open more menu" });
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(more).toContainText("More");
  await more.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("link")).toHaveText(["Achievements", "Timeline", "CV"]);
  await expect(sheet.getByRole("button", { name: /Switch to (dark|light) theme/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(sheet.getByRole("link", { name: "Profile and settings" })).toHaveCount(0);
  await shot(page, "more-360-light");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();
  await more.click();
  await sheet.getByRole("link", { name: "Timeline" }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(sheet).toBeHidden();
  await expect(tabBar(page).getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("aria-current", "true");
  await expect(header(page)).toContainText("Timeline");
  // Focus came back to the More button before it left with the old route; the new header still hides on scroll.
  await page.evaluate(() => document.body.style.setProperty("min-height", "3000px"));
  await scrollBy(page, 600);
  await expect(header(page)).toHaveAttribute("data-hidden", "true");
});

test("controls are at least 44 px, reduced motion turns transitions off, and 1440 px keeps the sidebar", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await signIn(page, user, "/settings/profile");
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".workspace-tab-bar a, .workspace-tab-bar button, .workspace-mobile-header button")]
    .map((element) => ({ name: element.textContent, ...element.getBoundingClientRect().toJSON() as DOMRect }))
    .filter((box) => box.width < 44 || box.height < 44));
  expect(small).toEqual([]);
  await page.getByRole("button", { name: "Open more menu" }).click();
  const sheetSmall = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("dialog[open] a, dialog[open] button")]
    .map((element) => ({ name: element.textContent, ...element.getBoundingClientRect().toJSON() as DOMRect }))
    .filter((box) => box.width < 44 || box.height < 44));
  expect(sheetSmall).toEqual([]);
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  const durations = await page.evaluate(() => [".workspace-tab-bar", ".workspace-tab-list", ".workspace-mobile-header", ".workspace-tab"]
    .map((selector) => Math.max(...getComputedStyle(document.querySelector(selector)!).transitionDuration.split(",").map((value) => Number.parseFloat(value) * 1000))));
  for (const duration of durations) expect(duration).toBeLessThanOrEqual(0.01);
  // T31 acceptance 4: the compact state still switches, without a transition.
  await page.goto("/activity");
  await expect(page.locator("main")).toContainText("Catatan kerja nomor 20");
  await scrollBy(page, 600);
  await expect(tabBar(page)).toHaveAttribute("data-compact", "true");
  await expectCompactCapsule(page);
  await expectTargets(page, 8);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(tabBar(page)).toBeHidden();
  await expect(header(page)).toBeHidden();
  await expect(page.locator(".workspace-sidebar").getByRole("navigation", { name: "Primary navigation" }).getByRole("link")).toHaveCount(6);
  await expect(page.locator(".workspace-topbar").getByRole("link", { name: "Quick log", exact: true })).toHaveAttribute("href", "/activity/new");
});

test("at 768 px the capsule stops at 480 px and stays centred, and it narrows the same way", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 800 });
  await signIn(page, user, "/activity");
  await expect(page.locator("main")).toContainText("Catatan kerja nomor 20");
  await page.waitForLoadState("networkidle");
  const expanded = await capsule(page);
  expect(expanded.width).toBeCloseTo(480, 0);
  expect(Math.abs(expanded.left - (768 - expanded.right))).toBeLessThanOrEqual(1);
  expect(expanded.bottom).toBeCloseTo(800 - GUTTER, 0);
  await shot(page, "bar-expanded-768-light");
  await scrollBy(page, 600);
  await expect(tabBar(page)).toHaveAttribute("data-compact", "true");
  await expectCompactCapsule(page);
});

test("axe finds nothing on the bar, both sheets and Profile at 360 px in light and dark", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, user, "/dashboard");
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await page.goto("/dashboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectNoWcagViolations(page, testInfo, `t27-dashboard-${theme}`);
    // T31 G3: in dark the shadow barely shows, so the capsule takes the stronger border.
    const edge = await tabBar(page).evaluate((element, token) => {
      const probe = document.createElement("div");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(token);
      document.body.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).borderTopColor, expected };
    }, theme === "dark" ? "--color-border-strong" : "--color-border-default");
    expect(edge.actual).toBe(edge.expected);
    await shot(page, `bar-expanded-360-${theme}`);
    // T31 acceptance 10: the compact capsule too, in both themes.
    await scrollBy(page, 600);
    await expect(tabBar(page)).toHaveAttribute("data-compact", "true");
    await expectCompactCapsule(page);
    await expectNoWcagViolations(page, testInfo, `t31-dashboard-compact-${theme}`);
    await shot(page, `bar-compact-360-${theme}-dashboard`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await tabBar(page).getByRole("button", { name: "Quick log", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Quick log" })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, `t27-composer-${theme}`);
    if (theme === "dark") await shot(page, "composer-360-dark");
    await page.keyboard.press("Escape");
    await page.goto("/settings/profile");
    await expectNoWcagViolations(page, testInfo, `t27-profile-${theme}`);
    await page.getByRole("button", { name: "Open more menu" }).click();
    await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
    await expectNoWcagViolations(page, testInfo, `t27-more-${theme}`);
    if (theme === "dark") await shot(page, "more-360-dark");
    await page.keyboard.press("Escape");
  }
});
