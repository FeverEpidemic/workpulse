import { mkdirSync } from "node:fs";

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import { collectWcagViolations, type WcagFinding } from "./helpers/accessibility";
import { admin, createUser, removeUsers, signIn, type User } from "./helpers/release-fixture";

// T32 acceptance 1-8 and 14-18 against a production build. Motion (9-13) is in landing-motion.spec.ts.

const SHOTS = "docs/verification/T32-screenshots";
const WRITE_SHOTS = process.env["T32_WRITE_SCREENSHOTS"] === "1";
const SIGN_UP = "/sign-in?mode=create-account";
const PROTECTED = /^\/(dashboard|activity|achievements|projects|cv|timeline|settings|onboarding|imports)(\/|\?|$)/;
const TITLE_EN = "You sit down to update your CV and can't remember what you did last year.";
const TITLE_ID = "Mau update CV. Terus lupa setahun kemarin ngerjain apa aja.";

let onboarded: User;
let provisional: { id: string; email: string; password: string };

test.beforeAll(async () => {
  onboarded = await createUser("t32-landing", { locale: "id" });
  const email = `t32-provisional-${Date.now()}@workpulse.test`;
  const password = `T32-${Date.now()}-Aa1!`;
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("T32 fixture: provisional user failed");
  provisional = { id: created.data.user.id, email, password };
});

test.afterAll(async () => {
  const users = [onboarded, provisional].filter(Boolean) as User[];
  if (users.length) await removeUsers(users);
});

/** `browserLocale` sets the browser's own Accept-Language; `locale` sets the wp-locale cookie. */
async function guest(browser: Browser, testInfo: TestInfo, options: { width?: number; height?: number; theme?: "light" | "dark"; locale?: "en" | "id"; browserLocale?: string } = {}) {
  const baseURL = String(testInfo.project.use.baseURL);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: options.width ?? 1440, height: options.height ?? 900 },
    locale: options.browserLocale ?? "en-US",
    colorScheme: options.theme ?? "light",
  });
  const cookies = [];
  if (options.theme) cookies.push({ name: "wp-theme", value: options.theme, url: baseURL });
  if (options.locale) cookies.push({ name: "wp-locale", value: options.locale, url: baseURL });
  if (cookies.length) await context.addCookies(cookies);
  return { context, page: await context.newPage() };
}

/**
 * Lets the hero story finish and turns the scroll fade off. Items off screen sit at opacity 0, and axe skips those
 * without failing, so the contrast and layout checks would quietly miss them.
 */
async function settleLanding(page: Page) {
  await expect(page.locator(".landing-hero-stack")).toHaveAttribute("data-phase", "done", { timeout: 8_000 });
  await expect(page.locator("html")).toHaveClass(/is-reveal-ready/);
  await page.evaluate(() => document.documentElement.classList.remove("is-reveal-ready"));
  for (const item of await page.locator("[data-reveal-item]").all()) await expect(item).toHaveCSS("opacity", "1");
}

test.describe("T32 root route", () => {
  test("a guest gets the landing page at /, not a redirect", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(response?.request().redirectedFrom()).toBeNull();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: TITLE_EN })).toBeVisible();
  });

  test("an onboarded account still lands on the dashboard", async ({ page }) => {
    await signIn(page, onboarded, "/dashboard");
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator(".landing")).toHaveCount(0);
  });

  test("a provisional account still lands on import onboarding", async ({ page }) => {
    await page.goto("/sign-in");
    await page.locator("#sign-in-email").fill(provisional.email);
    await page.locator("#sign-in-password").fill(provisional.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding\/import$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding\/import$/);
    await expect(page.locator(".landing")).toHaveCount(0);
  });
});

test.describe("T32 first-visit locale", () => {
  // Chromium derives Accept-Language from the context locale, so the exact header values go through the API client.
  for (const [header, locale] of [["id-ID,id;q=0.9", "id"], ["en-US,en;q=0.9", "en"], ["ms-MY,ms;q=0.9", "en"], ["", "en"]] as const) {
    test(`Accept-Language "${header}" renders ${locale}`, async ({ request }) => {
      const html = await (await request.get("/", { headers: { "Accept-Language": header } })).text();
      expect(html).toMatch(new RegExp(`<html[^>]* lang="${locale}"`));
      expect(html).toContain(locale === "id" ? TITLE_ID : TITLE_EN.replace("'", "&#x27;"));
    });
  }

  test("an Indonesian browser gets Indonesian on its first visit", async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL: String(testInfo.project.use.baseURL), locale: "id-ID" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE_ID);
    await context.close();
  });

  test("the wp-locale cookie beats the header", async ({ browser }, testInfo) => {
    const { context, page } = await guest(browser, testInfo, { browserLocale: "id-ID", locale: "en" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.close();
  });

  test("an onboarded profile's locale beats cookie and header", async ({ browser }, testInfo) => {
    const { context, page } = await guest(browser, testInfo, { locale: "en" });
    await signIn(page, onboarded, "/dashboard");
    await page.goto("/privacy");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Kebijakan Privasi");
    await context.close();
  });
});

test.describe("T32 language toggle", () => {
  test("switches the page, keeps the choice after reload and on /sign-in, from the keyboard", async ({ browser }, testInfo) => {
    const { context, page } = await guest(browser, testInfo, {});
    await page.goto("/");
    const indonesian = page.getByRole("button", { name: "Bahasa Indonesia" });
    await expect(indonesian).toHaveAttribute("aria-pressed", "false");
    await expect(indonesian).toHaveAttribute("lang", "id");
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await indonesian.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE_ID);
    await expect(page.getByRole("button", { name: "Bahasa Indonesia" })).toHaveAttribute("aria-pressed", "true");
    expect((await context.cookies()).find((cookie) => cookie.name === "wp-locale")?.value).toBe("id");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 2, name: "Masuk ke WorkPulse" })).toBeVisible();
    await context.close();
  });
});

test.describe("T32 sign-up CTAs", () => {
  test("every sign-up link opens the create-account form; Sign in opens sign-in", async ({ page }) => {
    await page.goto("/");
    const signUps = page.locator(`a[href="${SIGN_UP}"]`);
    expect(await signUps.count()).toBeGreaterThanOrEqual(3);
    await page.getByRole("link", { name: "Join the free pilot" }).first().click();
    await expect(page).toHaveURL(/\/sign-in\?mode=create-account$/);
    await expect(page.getByRole("heading", { level: 2, name: "Create account" })).toBeVisible();
    await expect(page.locator("#sign-up-email")).toBeVisible();
    await expect(page.locator("#sign-up-form").getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(page.locator("#sign-up-form").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");

    await page.goto("/");
    await page.locator("header").getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.locator("#sign-in-form")).toBeVisible();
    await expect(page.locator("#sign-up-form")).toHaveCount(0);

    await page.goto("/sign-in?mode=recovery");
    await expect(page.locator("#sign-in-form")).toBeVisible();
  });
});

test.describe("T32 content", () => {
  test("follows the brief's order, avoids ruled-out claims, and has no video or FAQ", async ({ page }) => {
    await page.goto("/");
    const ids = await page.locator("main > section").evaluateAll((sections) => sections.map((section) => section.id));
    expect(ids).toEqual(["landing-hero", "landing-how", "landing-import", "landing-data", "landing-maker", "landing-closing"]);
    for (const locale of ["en", "id"] as const) {
      await page.context().addCookies([{ name: "wp-locale", value: locale, url: page.url() }]);
      await page.goto("/");
      const text = await page.locator("body").innerText();
      for (const pattern of [/\bATS\b/, /testimon/i, /\d\s*%|persen|percent/i, /x lebih|times (faster|more)/i, /openai|anthropic|claude|gemini/i, /singapore|singapura|tokyo|frankfurt|aws|supabase/i, /freemium|berbayar|premium|waitlist|kuota|quota/i]) {
        expect(text, `${locale} ${pattern}`).not.toMatch(pattern);
      }
    }
    await expect(page.locator("video, iframe")).toHaveCount(0);
    await expect(page.getByText(/FAQ/)).toHaveCount(0);
  });

  test("every internal link on the landing and legal pages answers 200", async ({ page, request }) => {
    const hrefs = new Set<string>();
    for (const path of ["/", "/privacy", "/terms"]) {
      await page.goto(path);
      for (const href of await page.locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")!))) {
        if (href.startsWith("/")) hrefs.add(href.split("#")[0]!);
      }
    }
    expect([...hrefs].sort()).toEqual(["/", "/privacy", "/sign-in", SIGN_UP, "/terms"].sort());
    for (const href of hrefs) expect((await request.get(href)).status(), href).toBe(200);
  });

  test("labels the sample UI as examples and keeps it inert, with fictional data only", async ({ page }) => {
    await page.goto("/");
    const frames = page.locator('[data-example="true"]');
    expect(await frames.count()).toBe(5);
    for (const frame of await frames.all()) {
      await expect(frame).toHaveAttribute("role", "group");
      await expect(frame.locator(".landing-example-badge")).toHaveText("Example");
      await expect(frame.locator(":scope > [inert]")).toHaveCount(1);
      await expect(frame.locator("form, [type=submit]")).toHaveCount(0);
    }
    const mainLinks = await page.locator("main a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    for (const href of mainLinks) expect(href, href).not.toMatch(PROTECTED);
    await expect(page.locator("main")).not.toContainText(/@(?!myworkpulse\.my\.id)/);
    await expect(page.getByRole("group", { name: /Example of WorkPulse/ })).toBeVisible();
    await expect(page.locator(".landing-hero-activity")).toContainText("Warehouse returns");
    await expect(page.locator("#landing-panel-cv")).toContainText("PT Contoh Logistik");
  });

  test("ties each tab to its panel", async ({ page }) => {
    await page.goto("/");
    for (const tab of await page.getByRole("tab").all()) {
      const panel = page.locator(`#${await tab.getAttribute("aria-controls")}`);
      await expect(panel).toHaveAttribute("role", "tabpanel");
      await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
    }
  });

  test("names the maker and the contact address; the footer links the legal pages", async ({ page }) => {
    await page.goto("/");
    const maker = page.locator("#landing-maker");
    await expect(maker).toContainText("Ilham Aisy Rasyid");
    await expect(maker.getByRole("link", { name: "halo@myworkpulse.my.id" })).toHaveAttribute("href", "mailto:halo@myworkpulse.my.id");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(footer.getByRole("link", { name: "halo@myworkpulse.my.id" })).toHaveAttribute("href", "mailto:halo@myworkpulse.my.id");
  });

  test("has a title and description per locale", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("WorkPulse: log your work, build your CV from your own notes");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Free pilot\.$/);
    await page.context().addCookies([{ name: "wp-locale", value: "id", url: page.url() }]);
    await page.goto("/");
    await expect(page).toHaveTitle("WorkPulse: catat kerjaan, susun CV dari catatan sendiri");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /Pilot gratis\.$/);
  });
});

test.describe("T32 warm surfaces", () => {
  for (const [theme, warm, subtle] of [["light", "rgb(246, 243, 236)", "rgb(239, 234, 223)"], ["dark", "rgb(28, 27, 23)", "rgb(35, 33, 28)"]] as const) {
    test(`uses the warm tokens and the sage CTA in ${theme}, without gradients`, async ({ browser }, testInfo) => {
      const { context, page } = await guest(browser, testInfo, { theme });
      await page.goto("/");
      await expect(page.locator("#landing-hero")).toHaveCSS("background-color", warm);
      await expect(page.locator("#landing-data")).toHaveCSS("background-color", warm);
      await expect(page.locator("#landing-closing")).toHaveCSS("background-color", subtle);
      const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-action-primary").trim());
      const cta = await page.locator("#landing-hero .landing-cta").evaluate((element) => getComputedStyle(element).backgroundColor);
      const probe = await page.evaluate((color) => { const element = document.createElement("span"); element.style.color = color; document.body.append(element); const value = getComputedStyle(element).color; element.remove(); return value; }, primary);
      expect(cta).toBe(probe);
      const gradients = await page.locator(".landing *").evaluateAll((elements) => elements.filter((element) => getComputedStyle(element).backgroundImage.includes("gradient")).length);
      expect(gradients).toBe(0);
      await context.close();
    });
  }
});

test.describe("T32 legal pages", () => {
  for (const [path, en, id] of [["/privacy", "Privacy Policy", "Kebijakan Privasi"], ["/terms", "Terms of Service", "Syarat Layanan"]] as const) {
    test(`${path} works for guests and signed-in accounts, in both languages, as a noindex draft`, async ({ browser }, testInfo) => {
      const english = await guest(browser, testInfo, {});
      const response = await english.page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(english.page.getByRole("heading", { level: 1 })).toHaveText(en);
      await expect(english.page.locator("article h2")).toHaveCount(12);
      await expect(english.page.getByRole("note")).toContainText("Draft, not yet in effect.");
      await expect(english.page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(english.page.locator("article")).toContainText("Ilham Aisy Rasyid");
      await expect(english.page.locator("article mark").first()).toBeVisible();
      await english.context.close();

      const indonesian = await guest(browser, testInfo, { locale: "id" });
      await indonesian.page.goto(path);
      await expect(indonesian.page.locator("html")).toHaveAttribute("lang", "id");
      await expect(indonesian.page.getByRole("heading", { level: 1 })).toHaveText(id);
      await expect(indonesian.page.getByRole("note")).toContainText("Draf, belum berlaku.");
      await indonesian.context.close();

      const signedIn = await guest(browser, testInfo);
      await signIn(signedIn.page, onboarded, "/dashboard");
      expect((await signedIn.page.goto(path))?.status()).toBe(200);
      await expect(signedIn.page).toHaveURL(new RegExp(`${path}$`));
      await expect(signedIn.page.getByRole("heading", { level: 1 })).toHaveText(id);
      // RV1: the profile sets the language, so a signed-in account gets no toggle and no sign-in links.
      const header = signedIn.page.getByRole("banner");
      await expect(header.locator('button[name="locale"]')).toHaveCount(0);
      await expect(header.locator('a[href^="/sign-in"]')).toHaveCount(0);
      await header.getByRole("link", { name: "Buka dashboard" }).click();
      await expect(signedIn.page).toHaveURL(/\/dashboard$/);
      await signedIn.context.close();
    });
  }
});

test.describe("T32 responsive and accessible", () => {
  test("no horizontal scroll, 44 px targets, one h1, landmarks, and a working skip link at 360, 768, and 1440", async ({ browser }, testInfo) => {
    const problems: string[] = [];
    for (const width of [360, 768, 1440]) {
      for (const path of ["/", "/privacy", "/terms"]) {
        const { context, page } = await guest(browser, testInfo, { width, height: 800 });
        await page.goto(path);
        if (path === "/") await settleLanding(page);
        const report = await page.evaluate(() => {
          const visible = (element: Element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            small: [...document.querySelectorAll("a, button, summary")]
              .filter((element) => visible(element) && !element.closest(".legal-article p, .legal-article li, .legal-article td") && !element.closest("[inert]"))
              .filter((element) => { const rect = element.getBoundingClientRect(); return rect.height < 44 || rect.width < 24; })
              .map((element) => { const rect = element.getBoundingClientRect(); return `${element.textContent?.trim().slice(0, 30)} (${Math.round(rect.width)}x${Math.round(rect.height)}, ${element.className})`; }),
            clipped: [...document.querySelectorAll(".landing h1, .landing h2, .landing h3, .landing p, .landing a, .landing button")]
              .filter((element) => visible(element) && !element.closest("[inert]") && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== "visible")
              .map((element) => element.textContent?.trim().slice(0, 30)),
            h1: document.querySelectorAll("h1").length,
          };
        });
        const landmarks = [await page.getByRole("banner").count(), await page.getByRole("main").count(), await page.getByRole("contentinfo").count()];
        const label = `${path} @${width}`;
        if (report.overflow > 0) problems.push(`${label}: horizontal scroll ${report.overflow}px`);
        if (report.small.length) problems.push(`${label}: small targets ${report.small.join(" | ")}`);
        if (report.clipped.length) problems.push(`${label}: clipped ${report.clipped.join(" | ")}`);
        if (report.h1 !== 1) problems.push(`${label}: ${report.h1} h1`);
        if (landmarks.join() !== "1,1,1") problems.push(`${label}: landmarks ${landmarks.join()}`);
        if (width === 360 && path === "/") {
          const cta = (await page.locator("#landing-hero .landing-cta").boundingBox())!;
          if (cta.y + cta.height > 800) problems.push(`${label}: hero CTA below the fold`);
        }
        await page.keyboard.press("Tab");
        await expect(page.locator(".skip-link")).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(page.locator("#main-content")).toBeFocused();
        await context.close();
      }
    }
    expect(problems).toEqual([]);
  });

  test("axe finds no WCAG 2.2 AA violation at 360 and 1440, light and dark, en and id", async ({ browser }, testInfo) => {
    test.setTimeout(600_000);
    if (WRITE_SHOTS) mkdirSync(SHOTS, { recursive: true });
    const findings: (WcagFinding & { where: string })[] = [];
    for (const width of [360, 1440]) {
      for (const theme of ["light", "dark"] as const) {
        for (const locale of ["en", "id"] as const) {
          for (const path of ["/", "/privacy", "/terms"]) {
            const { context, page } = await guest(browser, testInfo, { width, height: width === 360 ? 800 : 900, theme, locale });
            await page.goto(path);
            if (path === "/") await settleLanding(page);
            const where = `${path} ${width} ${theme} ${locale}`;
            for (const finding of await collectWcagViolations(page)) findings.push({ ...finding, where });
            if (WRITE_SHOTS && path === "/") {
              await page.screenshot({ path: `${SHOTS}/landing-hero-${width}-${theme}-${locale}.png` });
              // A viewport shot: element shots taller than the viewport enlarge it and misplace the fixed skip link.
              await page.locator("#landing-how").evaluate((element) => element.scrollIntoView({ block: "start" }));
              await page.screenshot({ path: `${SHOTS}/landing-demo-${width}-${theme}-${locale}.png` });
            }
            if (WRITE_SHOTS && path === "/privacy" && width === 360 && locale === "id") {
              await page.screenshot({ path: `${SHOTS}/privacy-360-${theme}-id.png` });
            }
            await context.close();
          }
        }
      }
    }
    if (WRITE_SHOTS) {
      const { context, page } = await guest(browser, testInfo, { width: 360, height: 800, locale: "id" });
      await page.goto(SIGN_UP);
      await page.locator("#sign-up-form").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/sign-up-360-light-id.png`, fullPage: true });
      await context.close();
    }
    await testInfo.attach("t32-axe.json", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
    expect(findings).toEqual([]);
  });
});
