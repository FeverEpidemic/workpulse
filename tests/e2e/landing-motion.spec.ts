import { expect, test, type Page } from "@playwright/test";

// T32 acceptance 9-13: landing motion. Guests only, so no fixture accounts.

const NOTE_EN = "Checked returns with the warehouse team. Many were cut-off address labels.";

declare global {
  interface Window {
    __storyLog: [number, string][];
    __storyCardAtLoad: { visibility: string; opacity: string } | null;
  }
}

// Records every hero phase change with its time, and how the AI card looked when the document finished parsing.
async function recordStory(page: Page) {
  await page.addInitScript(() => {
    window.__storyLog = [];
    window.__storyCardAtLoad = null;
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as HTMLElement;
        if (target.classList.contains("landing-hero-stack")) window.__storyLog.push([performance.now(), target.dataset.phase ?? ""]);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
    document.addEventListener("DOMContentLoaded", () => {
      const card = document.querySelector(".landing-hero-achievement");
      if (card) window.__storyCardAtLoad = { visibility: getComputedStyle(card).visibility, opacity: getComputedStyle(card).opacity };
    });
  });
}

const stack = (page: Page) => page.locator(".landing-hero-stack");
const card = (page: Page) => page.locator(".landing-hero-achievement");
const replay = (page: Page) => page.getByRole("button", { name: "Replay example" });

test.describe("T32 hero story", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("plays once in order within 3.5 s without showing the end first, then replays from the keyboard", async ({ page }) => {
    await recordStory(page);
    // A page Chromium reports as hidden ends the story at once by design (visibilitychange), so keep it in front.
    await page.bringToFront();
    await page.goto("/");
    expect(await page.evaluate(() => document.visibilityState)).toBe("visible");
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 8_000 });

    const log = await page.evaluate(() => window.__storyLog);
    const phases = log.map(([, phase]) => phase);
    expect(phases.join(","), phases.join(",") === "idle,done" ? "story finished early: the page was hidden while it ran" : "story phases").toBe("idle,typing,saved,suggested,approved,done");
    const duration = log.at(-1)![0] - log[0]![0];
    expect(duration).toBeLessThanOrEqual(3_500);
    expect(duration).toBeGreaterThan(1_500);
    console.log(`T32 hero story ran for ${Math.round(duration)} ms`);

    const atLoad = await page.evaluate(() => window.__storyCardAtLoad);
    expect(atLoad, "AI card at DOMContentLoaded").not.toBeNull();
    expect(atLoad!.visibility === "hidden" || atLoad!.opacity === "0").toBe(true);

    await expect(page.locator(".landing-hero-activity .activity-list-excerpt")).toHaveText(NOTE_EN);
    await expect(card(page)).toHaveCSS("opacity", "1");
    await expect(card(page).getByText("Approved")).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await page.evaluate(() => window.__storyLog.length)).toBe(6);

    const button = replay(page);
    await expect(button).toHaveAttribute("aria-disabled", "false");
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(stack(page)).not.toHaveAttribute("data-phase", "done");
    await expect(button).toHaveAttribute("aria-disabled", "true");
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 5_000 });
    await expect(button).toHaveAttribute("aria-disabled", "false");
    await expect(button).toBeFocused();
  });

  test("gives screen readers the sample as one labelled group, with no live region", async ({ page }) => {
    await page.goto("/");
    const group = page.getByRole("group", { name: /Example of WorkPulse: one Activity note/ });
    await expect(group).toBeVisible();
    await expect(page.locator("#landing-hero [aria-live]")).toHaveCount(0);
    await expect(page.locator(".landing-hero-example [inert]")).toHaveCount(1);
  });

  test("shows the end state after 3 s when the page never hydrates", async ({ page }) => {
    await page.clock.install();
    await page.route(/\/_next\/static\/chunks\/.*\.js(\?|$)/, (route) => route.abort());
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hero-story", "armed");
    await expect(card(page)).toHaveCSS("visibility", "hidden");
    await page.clock.runFor(3_000);
    await expect(page.locator("html")).toHaveAttribute("data-hero-story", "expired");
    await expect(card(page)).toHaveCSS("visibility", "visible");
    await expect(card(page)).toHaveCSS("opacity", "1");
    await expect(page.locator(".landing-hero-activity .activity-list-excerpt")).toHaveText(NOTE_EN);
  });

  test("stops at the end when the tab is hidden", async ({ page }) => {
    await page.goto("/");
    await expect(stack(page)).toHaveAttribute("data-phase", /idle|typing/);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 1_000 });
  });
});

test.describe("T32 two-way reveal", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const shiftOf = (element: Element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42;

  async function ready(page: Page) {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/is-reveal-ready/);
  }

  async function scrollTo(page: Page, y: number) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
  }

  test("shows items on screen at load at once and staggers items below on their first entry", async ({ page }) => {
    await ready(page);
    await expect(page.locator(".landing-hero-text")).not.toHaveAttribute("data-reveal-offscreen", /.*/);
    await expect(page.locator(".landing-hero-text")).toHaveCSS("opacity", "1");

    const items = page.locator("#landing-data [data-reveal-item]");
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("data-reveal-offscreen", "below");
      await expect(item).toHaveCSS("opacity", "0");
    }
    const delays = await items.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transitionDelay));
    expect(delays).toEqual(["0s", "0.08s", "0.16s", "0.24s"]);
    const durations = await items.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transitionDuration));
    for (const value of durations) expect(value).toBe("0.24s, 0.24s");
    const shift = await items.first().evaluate(shiftOf);
    expect(shift).toBeGreaterThan(0);
    expect(shift).toBeLessThanOrEqual(16);

    await items.first().evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(items.first()).toHaveCSS("opacity", "1");
  });

  test("fades an item out past either edge and back in, with no stagger after it has left once", async ({ page }) => {
    await recordStory(page);
    await ready(page);
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 8_000 });
    const phasesBefore = await page.evaluate(() => window.__storyLog.length);

    const heroText = page.locator(".landing-hero-text");
    const maker = page.locator("#landing-maker [data-reveal-item]").first();
    const lastMaker = page.locator("#landing-maker [data-reveal-item]").last();

    // Past the top edge: fades out upward.
    await maker.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(maker).toHaveCSS("opacity", "1");
    await expect(heroText).toHaveAttribute("data-reveal-offscreen", "above");
    await expect(heroText).toHaveCSS("opacity", "0");
    await expect(heroText).toHaveAttribute("data-reveal-settled", "");
    await expect(heroText).toHaveCSS("transition-delay", "0s");
    expect(await heroText.evaluate(shiftOf)).toBeLessThan(0);

    // Past the bottom edge on the way up: fades out downward, and comes back with no stagger.
    await scrollTo(page, 0);
    await expect(heroText).not.toHaveAttribute("data-reveal-offscreen", /.*/);
    await expect(heroText).toHaveCSS("opacity", "1");
    await expect(lastMaker).toHaveAttribute("data-reveal-offscreen", "below");
    await expect(lastMaker).toHaveCSS("opacity", "0");
    await expect(lastMaker).toHaveCSS("transition-delay", "0s");
    expect(await lastMaker.evaluate(shiftOf)).toBeGreaterThan(0);

    // The hero story does not replay on its way back in.
    expect(await page.evaluate(() => window.__storyLog.length)).toBe(phasesBefore);
    await expect(stack(page)).toHaveAttribute("data-phase", "done");
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 800 }]) {
    test(`leaves nothing hidden on screen after fast scrolling at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await ready(page);
      await page.mouse.wheel(0, 20_000);
      await page.mouse.wheel(0, -20_000);
      await page.mouse.wheel(0, 20_000);
      await page.keyboard.press("Home");
      await page.keyboard.press("End");

      await expect(page.locator(".landing-closing h2")).toBeInViewport();
      await expect(page.locator(".landing-closing h2")).toHaveCSS("opacity", "1");
      await expect.poll(() => page.evaluate(() => {
        const edge = (height: number) => Math.max(height * 0.05, 24) + 12;
        return [...document.querySelectorAll("[data-reveal-item]")].filter((item) => {
          const { top, bottom, height } = item.getBoundingClientRect();
          return bottom >= edge(height) && window.innerHeight - top >= edge(height) && getComputedStyle(item).opacity !== "1";
        }).length;
      })).toBe(0);
    });
  }

  test("keeps the closing logo still", async ({ page }) => {
    await ready(page);
    await page.locator(".landing-closing-mark").scrollIntoViewIfNeeded();
    await expect(page.locator(".landing-closing-mark")).not.toHaveAttribute("data-reveal-item", /.*/);
    await expect(page.locator(".landing-closing-mark")).toHaveCSS("animation-name", "none");
    await expect(page.locator(".landing-closing-mark")).toHaveCSS("opacity", "1");
  });

  test("never fades an item that holds keyboard focus", async ({ page }) => {
    await ready(page);
    const item = page.locator("#landing-closing [data-reveal-item]").last();
    await item.locator("a").focus();
    await expect(item).toHaveCSS("opacity", "1");
    await scrollTo(page, 0);
    await expect(item).toHaveAttribute("data-reveal-offscreen", "below");
    await expect(item).toHaveCSS("opacity", "1");
    await expect(item.locator("a")).toBeFocused();
  });

  test("shows an item that moves on screen without a scroll", async ({ page }) => {
    await ready(page);
    const item = page.locator("#landing-import [data-reveal-item]").first();
    await expect(item).toHaveAttribute("data-reveal-offscreen", "below");
    await page.locator("#landing-how").evaluate((element) => { element.style.display = "none"; });
    await expect(item).not.toHaveAttribute("data-reveal-offscreen", /.*/);
    await expect(item).toHaveCSS("opacity", "1");
  });

  test("prints every item", async ({ page }) => {
    await ready(page);
    await page.emulateMedia({ media: "print" });
    for (const item of await page.locator("[data-reveal-item]").all()) await expect(item).toHaveCSS("opacity", "1");
  });
});

test.describe("T32 demo tabs and step dots", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function visiblePanel(page: Page) {
    return page.locator('[role="tabpanel"]:not([hidden])');
  }

  test("slides the new panel in from the side of the move, keeps one panel and the focus", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/is-reveal-ready/);
    const tabs = page.getByRole("tablist", { name: "WorkPulse steps" });
    await tabs.scrollIntoViewIfNeeded();
    await expect(await visiblePanel(page)).toHaveCount(1);
    await expect(await visiblePanel(page)).toHaveCSS("animation-name", "none");

    await page.getByRole("tab", { name: "Review an Achievement" }).click();
    await expect(await visiblePanel(page)).toHaveAttribute("id", "landing-panel-review");
    await expect(await visiblePanel(page)).toHaveCSS("animation-name", "landing-panel-from-right");
    await expect(await visiblePanel(page)).toHaveCSS("animation-duration", "0.24s");

    await page.getByRole("tab", { name: "Log an Activity" }).click();
    await expect(await visiblePanel(page)).toHaveCSS("animation-name", "landing-panel-from-left");

    for (const name of ["Build your CV", "Log an Activity", "Review an Achievement", "Build your CV"]) await page.getByRole("tab", { name }).click();
    await page.waitForTimeout(400);
    await expect(await visiblePanel(page)).toHaveCount(1);
    await expect(await visiblePanel(page)).toHaveAttribute("id", "landing-panel-cv");
    await expect(await visiblePanel(page)).toHaveCSS("opacity", "1");

    await page.getByRole("tab", { name: "Log an Activity" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Review an Achievement" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Review an Achievement" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Build your CV" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "Log an Activity" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Build your CV" })).toHaveAttribute("aria-selected", "true");
  });

  test("lights steps 1, 1-3, and 1-5 with a text status and a slow transition", async ({ page }) => {
    await page.goto("/");
    const lit = page.locator('.landing-step[data-on="true"]');
    const status = page.locator(".landing-step-status");
    await expect(lit).toHaveCount(1);
    await expect(status).toHaveText("Step 1 of 5");
    await page.getByRole("tab", { name: "Review an Achievement" }).click();
    await expect(lit).toHaveCount(3);
    await expect(status).toHaveText("Steps 1-3 of 5");
    await page.getByRole("tab", { name: "Build your CV" }).click();
    await expect(lit).toHaveCount(5);
    await expect(status).toHaveText("Steps 1-5 of 5");
    await expect(page.locator(".landing-step-dot").first()).toHaveCSS("transition-duration", "0.24s, 0.24s");
    await expect(page.locator(".landing-step-dot").first()).toHaveCSS("animation-name", "none");
  });
});

test.describe("T32 micro-interactions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("lifts sample cards and nudges the CTA arrow on hover and keyboard focus", async ({ page }) => {
    await page.goto("/");
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 8_000 });
    const activityCard = page.locator(".landing-hero-activity");
    await page.locator(".landing-hero-example .landing-example").hover();
    await expect(activityCard).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -2)");
    await expect(activityCard).toHaveCSS("box-shadow", /40px/);

    const arrow = page.locator("#landing-hero .landing-cta-arrow");
    await page.locator("#landing-hero .landing-cta").hover();
    await expect(arrow).toHaveCSS("transform", "matrix(1, 0, 0, 1, 3, 0)");
    await page.mouse.move(0, 0);
    await expect(arrow).toHaveCSS("transform", "none");
    await page.locator("#landing-hero .landing-text-link").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#landing-hero .landing-cta")).toBeFocused();
    await expect(arrow).toHaveCSS("transform", "matrix(1, 0, 0, 1, 3, 0)");
  });

  test("slides the language indicator to the chosen language", async ({ page }) => {
    await page.goto("/");
    const indicator = page.locator(".landing-locale-indicator");
    await expect(indicator).toHaveCSS("transition-duration", "0.24s");
    const width = await indicator.evaluate((element) => element.getBoundingClientRect().width);
    await expect.poll(() => indicator.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)).toBeCloseTo(width, 0);
  });

  test("does not lift cards on a touch device", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
    await page.locator(".landing-hero-example .landing-example").tap();
    await expect(page.locator(".landing-hero-activity")).toHaveCSS("transform", "none");
    await context.close();
  });
});

test.describe("T32 reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("shows the end state at once with no replay, reveal, slide, or lift", async ({ page }) => {
    await recordStory(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(stack(page)).toHaveAttribute("data-phase", "done");
    expect(await page.evaluate(() => window.__storyLog)).toEqual([]);
    await expect(replay(page)).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveClass(/is-reveal-ready/);
    await expect(page.locator("html")).not.toHaveAttribute("data-hero-story", /.*/);
    await expect(card(page)).toHaveCSS("opacity", "1");
    for (const item of await page.locator("[data-reveal-item]").all()) await expect(item).toHaveCSS("opacity", "1");

    await page.getByRole("tab", { name: "Review an Achievement" }).click();
    await expect(page.locator('[role="tabpanel"]:not([hidden])')).toHaveCSS("animation-name", "none");
    await expect(page.locator(".landing-step-dot").first()).toHaveCSS("transition-duration", "0s");
    await page.locator(".landing-hero-example .landing-example").hover();
    await expect(page.locator(".landing-hero-activity")).toHaveCSS("transform", "none");
  });
});

test.describe("T32 without JavaScript", () => {
  test.use({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });

  test("shows the hero end state, every panel, and every section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-hero-story", /.*/);
    await expect(card(page)).toHaveCSS("visibility", "visible");
    await expect(card(page)).toHaveCSS("opacity", "1");
    await expect(page.locator(".landing-hero-activity .activity-list-excerpt")).toHaveText(NOTE_EN);
    await expect(replay(page)).toHaveCount(0);
    const panels = page.locator('[role="tabpanel"]');
    await expect(panels).toHaveCount(3);
    for (const panel of await panels.all()) await expect(panel).toBeVisible();
    for (const item of await page.locator("[data-reveal-item]").all()) await expect(item).toHaveCSS("opacity", "1");
  });
});

test.describe("T32 hero tempo recording", () => {
  test.skip(!process.env.T32_RECORD_VIDEO, "Set T32_RECORD_VIDEO=1 to record docs/verification/T32-screenshots/hero-story.webm");

  test("records one run of the hero story", async ({ browser }, testInfo) => {
    const context = await browser.newContext({
      baseURL: String(testInfo.project.use.baseURL),
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: testInfo.outputPath("video"), size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(stack(page)).toHaveAttribute("data-phase", "done", { timeout: 8_000 });
    await page.waitForTimeout(800);
    await context.close();
    await page.video()!.saveAs("docs/verification/T32-screenshots/hero-story.webm");
  });
});
