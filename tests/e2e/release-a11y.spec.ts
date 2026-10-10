import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { collectWcagViolations, expectNoWcagViolations } from "./helpers/accessibility";
import { drainExportWorker, requireRealRenderer } from "./helpers/export-worker";
import { drainImportWorker } from "./helpers/import-worker";
import {
  admin, consent, createUser, removeUsers, requestExport, seedCareer, seedCv, signIn, type Career, type User,
} from "./helpers/release-fixture";
import { CV_LINES, cvPdf } from "../import-fixtures";

// T25 plan sections 1.8, 1.10, 1.11, 1.12 and D6: every reachable screen S01 to S14 at 360 and 1440 px, light and dark,
// against a production build. One run reports every finding; the test fails at the end if there is any.

const SHOTS = "docs/verification/T25-screenshots";
const ARIA = "docs/verification/T25-aria";
const VIEWPORTS = [{ width: 360, height: 800 }, { width: 1440, height: 900 }] as const;
const THEMES = ["light", "dark"] as const;
const WRITE_ARIA = process.env["WORKPULSE_RELEASE_WRITE_ARIA"] === "1";

type Actor = "rich" | "empty" | "indo" | "anon";
interface World {
  users: Record<Exclude<Actor, "anon">, User>;
  career: Career;
  batchId: string;
  states: Record<Exclude<Actor, "anon">, Awaited<ReturnType<BrowserContext["storageState"]>>>;
}
interface Screen {
  id: string;
  actor: Actor;
  path: (world: World) => string;
  /** Text that proves the screen shows its data and not an empty or loading state. */
  text: string | RegExp;
  prepare?: (page: Page) => Promise<void>;
}

const SCREENS: Screen[] = [
  { id: "s01-sign-in", actor: "anon", path: () => "/sign-in", text: /Sign in/ },
  { id: "s02-import-start", actor: "empty", path: () => "/onboarding/import", text: /CV/ },
  { id: "s03-import-review", actor: "rich", path: (w) => `/imports/${w.batchId}/review`, text: /Review imported data/ },
  { id: "s04-dashboard", actor: "rich", path: () => "/dashboard", text: /Menyusun laporan penjualan mingguan/ },
  { id: "s04-dashboard-empty", actor: "empty", path: () => "/dashboard", text: /Add your first activity/ },
  { id: "s05-capture-note", actor: "rich", path: () => "/activity/new", text: /Work note/ },
  {
    id: "s05-capture-form", actor: "rich", path: () => "/activity/new", text: /Work note/,
    prepare: async (page) => { await page.locator('input[name="capture_mode"][value="form"]').check(); },
  },
  { id: "s06-activity-list", actor: "rich", path: () => "/activity", text: /laporan penjualan mingguan/ },
  { id: "s06-activity-empty", actor: "empty", path: () => "/activity", text: /activit/i },
  { id: "s06-activity-detail", actor: "rich", path: (w) => `/activity/${w.career.activityId}`, text: /laporan penjualan mingguan/ },
  { id: "s07-achievements", actor: "rich", path: () => "/achievements", text: /Mempercepat laporan mingguan/ },
  { id: "s08-achievement-confirmed", actor: "rich", path: (w) => `/achievements/${w.career.achievementId}`, text: /Mempercepat laporan mingguan/ },
  { id: "s08-achievement-draft", actor: "rich", path: (w) => `/achievements/${w.career.draftAchievementId}`, text: /Pelatihan tim baru/ },
  { id: "s09-projects", actor: "rich", path: () => "/projects", text: /Dasbor Penjualan/ },
  { id: "s10-project-detail", actor: "rich", path: (w) => `/projects/${w.career.projectId}`, text: /Dasbor Penjualan/ },
  { id: "s11-timeline", actor: "rich", path: () => "/timeline", text: /Perusahaan Contoh/ },
  { id: "s12-settings", actor: "rich", path: () => "/settings/profile", text: /Privacy and account/ },
  {
    id: "s12-delete-dialog", actor: "rich", path: () => "/settings/profile", text: /Privacy and account/,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Delete account", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.locator(".delete-account-counts")).toBeVisible();
    },
  },
  { id: "s13-cv", actor: "rich", path: () => "/cv", text: /Universitas Contoh/ },
  { id: "s14-preview", actor: "rich", path: () => "/cv/preview", text: /Saved revision/ },
];

let world: World;

test.beforeAll(async ({ browser }, testInfo) => {
  await requireRealRenderer();
  const baseURL = String(testInfo.project.use.baseURL);
  const rich = await createUser("a11y-rich", { name: "Ani Contoh" });
  const empty = await createUser("a11y-empty", { name: "Budi Kosong" });
  const indo = await createUser("a11y-id", { name: "Citra Contoh", locale: "id" });
  const career = await seedCareer(rich);
  const indoCareer = await seedCareer(indo);
  const revision = await seedCv(rich, career);
  await seedCv(indo, indoCareer);
  await requestExport(rich, revision);
  expect(await drainExportWorker("gotenberg")).toMatchObject({ succeeded: expect.any(Number) });
  await consent(rich);

  const states = {} as World["states"];
  for (const [actor, user] of [["rich", rich], ["empty", empty], ["indo", indo]] as const) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signIn(page, user, "/dashboard");
    states[actor] = await context.storageState();
    if (actor === "rich") {
      // S03 needs a batch in review: upload through S02, let the workers run, read the batch id.
      await page.goto("/onboarding/import");
      await page.locator('input[type="file"]').setInputFiles({ name: "cv-contoh.pdf", mimeType: "application/pdf", buffer: cvPdf(2, CV_LINES) });
      await page.getByRole("button", { name: "Upload and extract" }).click();
      await expect(page.getByRole("status")).toHaveText("Waiting to start");
      expect((await drainImportWorker("valid")).claimed).toBeGreaterThan(0);
      await expect(page.getByRole("status")).toHaveText("Extraction finished", { timeout: 30_000 });
    }
    await context.close();
  }
  const batches = await admin().from("import_batches").select("id").eq("user_id", rich.id).order("created_at", { ascending: false }).limit(1);
  const batchId = batches.data?.[0]?.id;
  if (!batchId) throw new Error("T25 fixture failed: import batch");
  world = { users: { rich, empty, indo }, career, batchId, states };
});

test.afterAll(async () => {
  if (world) await removeUsers(Object.values(world.users));
});

function contextFor(browser: Browser, actor: Actor, viewport: { width: number; height: number }, theme: "light" | "dark", baseURL: string) {
  const state = actor === "anon" ? undefined : world.states[actor];
  return browser.newContext({ baseURL, viewport, ...(state ? { storageState: state } : {}), colorScheme: theme });
}

/** Width of the layout viewport and of the document: the document is wider when the page scrolls sideways. */
async function widthsOf(page: Page): Promise<{ width: number; scroll: number }> {
  return page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
}

async function inspect(page: Page, screen: Screen, theme: "light" | "dark", width: number, user: User | null, expectedLang: string, findings: string[]) {
  const label = `${screen.id} ${width} ${theme}`;
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main").first(), `${label}: main`).toBeVisible();
  try {
    await expect(page.locator("main").first()).toContainText(screen.text, { timeout: 8_000 });
  } catch {
    findings.push(`${label}: the screen does not show its data (expected ${String(screen.text)})`);
  }
  if (screen.prepare) {
    try {
      await screen.prepare(page);
    } catch {
      findings.push(`${label}: the state could not be prepared`);
    }
  }
  await page.waitForLoadState("networkidle");

  const facts = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset["theme"] ?? "",
    h1: document.querySelectorAll("h1").length,
    mains: document.querySelectorAll("main").length,
  }));
  const { width: viewportWidth, scroll: documentWidth } = await widthsOf(page);
  if (facts.lang !== expectedLang) findings.push(`${label}: lang is "${facts.lang}", expected "${expectedLang}"`);
  if (facts.theme !== theme) findings.push(`${label}: data-theme is "${facts.theme}"`);
  if (facts.h1 !== 1) findings.push(`${label}: ${facts.h1} h1 elements`);
  if (facts.mains !== 1) findings.push(`${label}: ${facts.mains} main landmarks`);
  if (documentWidth > viewportWidth) findings.push(`${label}: horizontal scroll (${documentWidth} > ${viewportWidth})`);
  for (const violation of await collectWcagViolations(page)) {
    findings.push(`${label}: axe ${violation.rule} (${violation.impact}) x${violation.nodes} at ${violation.target}`);
  }
  mkdirSync(SHOTS, { recursive: true });
  const masks = user ? [page.getByText(user.email)] : [];
  await page.screenshot({ path: join(SHOTS, `${screen.id}-${width}-${theme}.png`), animations: "disabled", mask: masks, maskColor: "#8a8a8a" });
}

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`matrix ${viewport.width}px ${theme}: axe, landmarks, language and layout on every screen`, async ({ browser }, testInfo) => {
      const baseURL = String(testInfo.project.use.baseURL);
      const findings: string[] = [];
      const consoleErrors: string[] = [];
      const contexts = new Map<Actor, BrowserContext>();
      const pages = new Map<Actor, Page>();
      try {
        for (const actor of ["anon", "rich", "empty"] as const) {
          const context = await contextFor(browser, actor, viewport, theme, baseURL);
          await context.addCookies([{ name: "wp-theme", value: theme, url: baseURL }]);
          const page = await context.newPage();
          page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
          page.on("pageerror", (error) => consoleErrors.push(String(error)));
          contexts.set(actor, context);
          pages.set(actor, page);
        }
        for (const screen of SCREENS) {
          const page = pages.get(screen.actor)!;
          const user = screen.actor === "anon" ? null : world.users[screen.actor];
          await page.goto(screen.path(world));
          await inspect(page, screen, theme, viewport.width, user, "en", findings);
        }
      } finally {
        for (const context of contexts.values()) await context.close();
      }
      await testInfo.attach(`findings-${viewport.width}-${theme}.json`, { body: JSON.stringify({ findings, consoleErrors }, null, 2), contentType: "application/json" });
      expect(findings, "accessibility and layout findings").toEqual([]);
      expect(consoleErrors, "browser console errors").toEqual([]);
    });
  }
}

test("Indonesian: lang, axe and layout on S04, S05, S12 and S13", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const findings: string[] = [];
  for (const viewport of VIEWPORTS) {
    const context = await contextFor(browser, "indo", viewport, "light", baseURL);
    const page = await context.newPage();
    try {
      for (const [id, path, text] of [
        ["s04-dashboard-id", "/dashboard", /Menyusun laporan penjualan mingguan/], ["s05-capture-id", "/activity/new", /Catatan/],
        ["s12-settings-id", "/settings/profile", /Privasi dan akun/], ["s13-cv-id", "/cv", /Universitas Contoh/],
      ] as const) {
        await page.goto(path);
        await inspect(page, { id, actor: "indo", path: () => path, text }, "light", viewport.width, world.users.indo, "id", findings);
      }
    } finally {
      await context.close();
    }
  }
  await testInfo.attach("findings-id.json", { body: JSON.stringify(findings, null, 2), contentType: "application/json" });
  expect(findings).toEqual([]);
});

test("text at 200%: S04, S05, S08 and S13 neither clip text nor scroll sideways at 720, 360 and 320 px", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const failures: string[] = [];
  // The plan asks for 360 and 1440 px with the root font size at 200%; 720 px is a 1440 px layout at 200% browser zoom and\n  // 320 px is the narrowest layout WCAG 1.4.10 asks for.
  for (const viewport of [{ width: 720, height: 900 }, { width: 360, height: 800 }, { width: 320, height: 800 }]) {
    const context = await contextFor(browser, "rich", viewport, "light", baseURL);
    const page = await context.newPage();
    try {
      for (const [id, path] of [
        ["s04", "/dashboard"], ["s05", "/activity/new"], ["s08", `/achievements/${world.career.achievementId}`], ["s13", "/cv"],
      ] as const) {
        await page.goto(path);
        await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
        await page.waitForLoadState("networkidle");
        const result = await page.evaluate(() => {
          const clipped: string[] = [];
          const selector = "main h1, main h2, main h3, main label, main button, main a, main legend, main p, main li, main summary";
          for (const element of document.querySelectorAll<HTMLElement>(selector)) {
            // The activity excerpt is a deliberate three line preview; the detail screen carries the full text.
            if (element.closest(".activity-list-excerpt")) continue;
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            if (style.display === "none" || style.visibility === "hidden" || box.width === 0 || box.height === 0) continue;
            const clipsX = style.overflowX !== "visible" && element.scrollWidth > element.clientWidth + 1;
            const clipsY = style.overflowY !== "visible" && element.scrollHeight > element.clientHeight + 1;
            if (clipsX || clipsY) clipped.push(`${element.tagName.toLowerCase()}.${element.className} "${(element.textContent ?? "").trim().slice(0, 40)}"`);
          }
          const width = document.documentElement.clientWidth;
          const wide: string[] = [];
          for (const element of document.querySelectorAll<HTMLElement>("body *")) {
            const box = element.getBoundingClientRect();
            if (box.width >= 380 && box.right > width + 1 && wide.length < 14) {
              wide.push(`${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]}[${element.getAttribute("name") ?? element.id}] w=${Math.round(box.width)} right=${Math.round(box.right)}`);
            }
          }
          return { clipped, wide, scroll: document.documentElement.scrollWidth, width };
        });
        if (result.scroll > result.width) failures.push(`${id} ${viewport.width}: horizontal scroll ${result.scroll} > ${result.width}: ${result.wide.join("; ")}`);
        for (const entry of result.clipped) failures.push(`${id} ${viewport.width}: clipped ${entry}`);
      }
    } finally {
      await context.close();
    }
  }
  await testInfo.attach("text-200.json", { body: JSON.stringify(failures, null, 2), contentType: "application/json" });
  expect(failures).toEqual([]);
});

function normalizeAria(snapshot: string, user: User): string {
  return snapshot
    .replaceAll(user.email, "<email>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    // Dates and times follow the clock (the capture form defaults to today, an export is available until tomorrow).
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>")
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}, \d{4}\b/g, "<date>")
    .replace(/\b\d{1,2} (?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des) \d{4}\b/g, "<date>")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?\b/g, "<time>");
}

test("accessibility tree of S04, S05, S08, S13 and S14 is locked (screen reader proxy)", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const context = await contextFor(browser, "rich", VIEWPORTS[1], "light", baseURL);
  const page = await context.newPage();
  const mismatches: string[] = [];
  mkdirSync(ARIA, { recursive: true });
  try {
    for (const screen of SCREENS.filter((entry) => ["s04-dashboard", "s05-capture-note", "s08-achievement-confirmed", "s13-cv", "s14-preview"].includes(entry.id))) {
      await page.goto(screen.path(world));
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main").first()).toContainText(screen.text);
      const snapshot = normalizeAria(await page.locator("body").ariaSnapshot(), world.users.rich);
      const file = join(ARIA, `${screen.id}.aria.yml`);
      if (WRITE_ARIA) writeFileSync(file, snapshot + "\n");
      else if (!existsSync(file)) mismatches.push(`${screen.id}: no locked snapshot (run once with WORKPULSE_RELEASE_WRITE_ARIA=1)`);
      else if (readFileSync(file, "utf8").trimEnd() !== snapshot.trimEnd()) {
        await testInfo.attach(`${screen.id}.actual.yml`, { body: snapshot, contentType: "text/plain" });
        const expectedLines = readFileSync(file, "utf8").trimEnd().split(/\r?\n/);
        const actualLines = snapshot.trimEnd().split(/\r?\n/);
        const first = actualLines.findIndex((line, index) => line !== expectedLines[index]);
        mismatches.push(
          `${screen.id}: accessibility tree differs from ${file} at line ${first + 1}: expected ${JSON.stringify(expectedLines[first])}, got ${JSON.stringify(actualLines[first])}`,
        );
      }
      // Names the checklist relies on: a page always has a heading, and every control has a name.
      expect(snapshot, `${screen.id}: heading`).toMatch(/- heading "/);
      expect(snapshot, `${screen.id}: unnamed control`).not.toMatch(/- (button|link|textbox|combobox|checkbox|radio)( \[[^\]]*\])*:?\s*$/m);
    }
  } finally {
    await context.close();
  }
  expect(mismatches).toEqual([]);
});

test("one axe pass with the shared helper on the signed-in dashboard", async ({ browser }, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const context = await contextFor(browser, "rich", VIEWPORTS[1], "dark", baseURL);
  const page = await context.newPage();
  try {
    await context.addCookies([{ name: "wp-theme", value: "dark", url: baseURL }]);
    await page.goto("/dashboard");
    await expect(page.locator("main")).toContainText("Menyusun laporan penjualan mingguan");
    await expectNoWcagViolations(page, testInfo, "release-dashboard-dark");
  } finally {
    await context.close();
  }
});

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

test("no server secret reaches the browser bundle or the served HTML (D6)", async ({ request }) => {
  const forbiddenText = ["sb_secret_", "SUPABASE_SECRET_KEY", "WORKPULSE_OPENAI_API_KEY", "WORKPULSE_AI_MODE", "SERVICE_ROLE_KEY"];
  const secret = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const roleOf = (jwt: string) => {
    try {
      return (JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8")) as { role?: string }).role ?? "";
    } catch {
      return "";
    }
  };
  const findings: string[] = [];
  const staticDirectory = join(".next", "static");
  expect(existsSync(staticDirectory), "the production build output").toBe(true);
  const files = walk(staticDirectory).filter((file) => /\.(js|css|html|json|txt|map)$/.test(file));
  expect(files.length, "bundle files scanned").toBeGreaterThan(5);
  const check = (name: string, text: string) => {
    for (const needle of forbiddenText) if (text.includes(needle)) findings.push(`${name}: contains ${needle}`);
    if (secret && secret.length > 20 && text.includes(secret)) findings.push(`${name}: contains the server secret key value`);
    for (const jwt of text.match(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g) ?? []) {
      if (roleOf(jwt) === "service_role") findings.push(`${name}: contains a service_role JWT`);
    }
  };
  for (const file of files) check(file, readFileSync(file, "utf8"));
  for (const route of ["/sign-in", "/"]) check(route, await (await request.get(route)).text());
  expect(findings).toEqual([]);
});

test("the layout checks report a page that scrolls sideways and a document with two h1", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.setContent('<!doctype html><html lang="en"><body><main><h1>Satu</h1><h1>Dua</h1><div style="width: 900px">Lebar</div></main></body></html>');
  const widths = await widthsOf(page);
  expect(widths.scroll, "a 900 px block widens the document").toBeGreaterThan(widths.width);
  expect(await page.locator("h1").count()).toBe(2);
  await page.setContent('<!doctype html><html lang="en"><head><title>Contoh</title></head><body><main><h1>Satu</h1><p>Isi</p></main></body></html>');
  const clean = await widthsOf(page);
  expect(clean.scroll).toBeLessThanOrEqual(clean.width);
  expect((await collectWcagViolations(page)).length, "a clean document has no axe finding").toBe(0);
  await page.setContent('<!doctype html><html lang="en"><body><main><h1>Satu</h1><button></button><img src="x.png"></main></body></html>');
  expect((await collectWcagViolations(page)).map((violation) => violation.rule), "an unnamed button and an image without alt").toEqual(
    expect.arrayContaining(["button-name", "image-alt"]),
  );
});