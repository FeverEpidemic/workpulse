import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainExportWorker, requireRealRenderer } from "./helpers/export-worker";

// Gate M4 (docs/verification/M4-gate-review-plan.md, Fase 3): one graduate runs F07 through the browser against local
// Supabase, private Storage and the real Chromium PDF renderer. Only account creation, worker drains and clock moves
// bypass the UI. The web server and the journey run without any AI configuration.
const ORIGIN = "http://127.0.0.1:3016";
const BUCKET = "workpulse-private";
const CONTAINER = process.env["WORKPULSE_TEST_DB_CONTAINER"] ?? "supabase_db_WorkPulse";
const AI_CLAIM = /analy[sz]|menganalisis|AI suggestion|saran AI/i;
const AI_DISCLAIMERS = [/will not be analyzed now\.?/gi, /works without AI\.?/gi, /tetap berfungsi tanpa AI\.?/gi];
const INDONESIAN_OVERRIDE = "Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”";
const A4 = { width: 595, height: 842 };

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const norm = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

/** Statements run as the database owner: they move clocks that no API role may touch. */
function sql(statement: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe", encoding: "utf8" }).trim();
}

async function createUser(admin: Client, label: string, onboarded: boolean): Promise<User> {
  const email = `m4-journey-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`M4 journey fixture failed: ${label} user`);
  if (onboarded) {
    const profile = await admin.from("profiles").update({ display_name: `M4 ${label}`, locale: "en", timezone: "Asia/Jakarta", onboarding_completed_at: new Date().toISOString() }).eq("id", id);
    if (profile.error) throw new Error(`M4 journey fixture failed: ${label} profile`);
  }
  return { id, email, password };
}

async function signedInClient(url: string, publicKey: string, user: User): Promise<Client> {
  const client = createClient<Database>(url, publicKey, options);
  if ((await client.auth.signInWithPassword({ email: user.email, password: user.password })).error) throw new Error("M4 journey sign-in failed");
  return client;
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Move focus with Tab only; the target must show a visible focus indicator. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  await target.waitFor({ state: "visible" });
  const handle = await target.elementHandle();
  if (!handle) throw new Error("Keyboard target disappeared.");
  for (let index = 0; index < 200; index += 1) {
    if (await handle.evaluate((element) => element === document.activeElement)) {
      expect(await handle.evaluate((element) => element.matches(":focus-visible")), "keyboard focus must be visible").toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard traversal did not reach the target control.");
}

async function keyboardType(page: Page, target: Locator, text: string): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

async function keyboardPress(page: Page, target: Locator, key = "Enter"): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

/** A hydrated page is needed before a key press (a click is retried, a key press is not); focus is moved directly. */
async function press(page: Page, target: Locator, key = "Enter"): Promise<void> {
  await page.waitForLoadState("networkidle");
  await target.focus();
  await page.keyboard.press(key);
}

async function expectAiFree(page: Page, label: string): Promise<void> {
  let text = await page.locator("body").innerText();
  for (const disclaimer of AI_DISCLAIMERS) text = text.replace(disclaimer, "");
  expect(text.match(AI_CLAIM), `${label} must not claim AI analysis or suggestions`).toBeNull();
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${label} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

/** Focus is moved after the reloaded CV is on screen, so it is polled rather than read once. */
async function expectFocusKept(page: Page, label: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? "NONE"), { message: `${label}: focus must stay on a control or status, not fall to the page`, timeout: 8_000 })
    .not.toMatch(/^(BODY|HTML|NONE)$/);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expectNoWcagViolations(page, testInfo, name);
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function pdfFacts(bytes: Uint8Array) {
  expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await task.promise;
    const sizes: { width: number; height: number }[] = [];
    let text = "";
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      sizes.push({ width: page.view[2]! - page.view[0]!, height: page.view[3]! - page.view[1]! });
      const content = await page.getTextContent();
      text += ` ${(content.items as { str?: string }[]).map((item) => item.str ?? "").join(" ")}`;
    }
    return { pageCount: document.numPages, sizes, text: norm(text) };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

function expectA4(sizes: { width: number; height: number }[], label: string): void {
  expect(sizes.length, `${label}: pages`).toBeGreaterThan(0);
  for (const size of sizes) {
    expect(Math.abs(size.width - A4.width), `${label}: page width`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(size.height - A4.height), `${label}: page height`).toBeLessThanOrEqual(1.5);
  }
}

const status = (page: Page) => page.getByTestId("cv-export-status");
const retryButton = (page: Page) => page.getByTestId("cv-export-retry");
const regenerateButton = (page: Page) => page.getByTestId("cv-export-regenerate");
const downloadButton = (page: Page) => page.getByTestId("cv-export-download");
const pdfPages = (page: Page) => page.getByTestId("cv-pdf-pages");
const saveStatus = (page: Page) => page.locator(".cv-save-status");
const preview = (page: Page) => page.getByTestId("cv-preview-paper");
const announcer = (page: Page) => page.getByTestId("cv-announcer");
const saveButton = (page: Page) => page.getByRole("button", { name: "Save changes", exact: true });

test("M4 journey (F07): career data → S04/S08 → S13 → S14 → real PDF, override, freshness, delete, Retry and Regenerate, two accounts", async ({ page, browser }, testInfo) => {
  const { url, secretKey, publicKey } = config();
  const admin = createClient<Database>(url, secretKey, options);
  const aiVariables = Object.keys(process.env).filter((key) => /(^|_)(AI|OPENAI|ANTHROPIC|GEMINI|LLM)(_|$)/i.test(key));
  expect(aiVariables, "the gate journey must run without AI configuration").toEqual([]);
  await requireRealRenderer();
  await drainExportWorker("fake");

  const suffix = randomUUID().slice(0, 8);
  const fullName = `Dewi Anggraini ${suffix}`;
  const school = `Universitas Brawijaya ${suffix}`;
  const qualification = "Sarjana Teknik Informatika";
  const projectTitle = `Skripsi Sistem Antrian ${suffix}`;
  const firstTitle = `Merancang simulasi antrian ${suffix}`;
  const secondTitle = `Merangkum umpan balik penguji ${suffix}`;
  const secondBullet = `Merangkum umpan balik penguji untuk tim ${suffix}`;
  const editedSource = `Sumber diubah di S08 ${suffix}`;
  const note = `Catatan skripsi ${suffix}: menyiapkan simulasi antrian\ndan demo untuk penguji`;
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(`${new URL(page.url()).pathname} :: ${(error.stack ?? String(error)).split("\n").slice(0, 4).join(" | ")}`));

  const users: User[] = [];
  const objectKeys: string[] = [];
  const graduate = await createUser(admin, "graduate", false);
  users.push(graduate);
  const other = await createUser(admin, "other", true);
  users.push(other);
  const owner = await signedInClient(url, publicKey, graduate);

  const exportRows = async () => {
    const { data, error } = await owner.from("cv_exports").select("id, status, cv_revision, page_count, error_code").order("created_at", { ascending: false });
    if (error) throw new Error("M4 export read failed");
    return data ?? [];
  };
  const objectKeyOf = (exportId: string) => sql(`select object_key from public.cv_exports where id = '${exportId}'::uuid`);
  const storedBytes = async (exportId: string) => {
    const key = objectKeyOf(exportId);
    if (!objectKeys.includes(key)) objectKeys.push(key);
    const { data, error } = await admin.storage.from(BUCKET).download(key);
    if (error || !data) throw new Error("M4 stored PDF read failed");
    return new Uint8Array(await data.arrayBuffer());
  };
  const cvRevision = async () => {
    const { data, error } = await owner.from("cv_documents").select("revision").single();
    if (error || !data) throw new Error("M4 CV read failed");
    return data.revision;
  };
  const snapshotMd5 = (exportId: string) => sql(`select md5(snapshot::text) from public.cv_exports where id = '${exportId}'::uuid`);

  const downloadWithKeyboard = async (target: Locator) => {
    await page.waitForLoadState("networkidle");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await target.focus();
        await page.keyboard.press("Enter");
      })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^WorkPulse-CV-\d{4}-\d{2}-\d{2}\.pdf$/);
    return new Uint8Array(readFileSync((await download.path())!));
  };

  // The first export of a revision is Export; once the CV has changed since an earlier export the same action is Regenerate.
  const exportAction = page.locator('[data-testid="cv-export-export"], [data-testid="cv-export-regenerate"]');
  const exportThroughS14 = async (renderer: "gotenberg" | "unavailable" = "gotenberg") => {
    await press(page, exportAction);
    await expect(status(page)).toContainText("Waiting to start");
    await expect(status(page)).toBeFocused();
    const drained = await drainExportWorker(renderer);
    expect(drained.claimed).toBe(1);
    return drained;
  };

  try {
    // 1. Graduate without CV or employment, keyboard only: display name only, education, an academic project, a note,
    //    a derived Achievement, confirmed without metrics or evidence.
    await signIn(page, graduate);
    await expect(page).toHaveURL(/\/onboarding\/import$/);
    await keyboardPress(page, page.getByRole("link", { name: "Start manually", exact: true }));
    await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
    await keyboardType(page, page.getByLabel("Display name"), fullName);
    await keyboardType(page, page.getByLabel("Time zone"), "Asia/Jakarta");
    await keyboardPress(page, page.getByRole("button", { name: "Continue to dashboard", exact: true }));
    await expect(page).toHaveURL(/\/dashboard$/);
    await expectAiFree(page, "empty dashboard");

    await page.goto("/settings/profile");
    const education = page.getByRole("heading", { name: "Education", exact: true }).locator("xpath=ancestor::section[1]");
    const addEducation = education.locator(":scope > details").last();
    await tabTo(page, addEducation.locator("summary").first());
    await page.keyboard.press("Enter");
    await expect(addEducation).toHaveJSProperty("open", true);
    const educationForm = addEducation.locator("form");
    await keyboardType(page, educationForm.locator('[name="institution"]'), school);
    await keyboardType(page, educationForm.locator('[name="qualification"]'), qualification);
    await keyboardPress(page, educationForm.getByRole("button", { name: "Save record" }));
    await expect(educationForm.getByRole("status")).toContainText("Record saved.");

    await page.goto("/dashboard");
    await keyboardPress(page, page.locator(".workspace-topbar").getByRole("link", { name: "Quick log", exact: true }));
    await expect(page).toHaveURL(/\/activity\/new/);
    await expect(page.locator("#quick-log-note")).toBeFocused();
    await page.keyboard.type(note);
    await keyboardPress(page, page.locator("#quick-log-note-form button[type='submit']"));
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
    const activityId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    await page.goto("/projects/new");
    const projectForm = page.locator("#project-create-form");
    await keyboardType(page, projectForm.getByLabel("Title"), projectTitle);
    await tabTo(page, projectForm.locator('[name="status"]'));
    await page.keyboard.type("Completed");
    await expect(projectForm.locator('[name="status"]')).toHaveValue("completed");
    await keyboardPress(page, projectForm.getByRole("button", { name: "Create project", exact: true }));
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/i);
    const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await keyboardPress(page, page.getByRole("button", { name: "Attach existing activity", exact: true }));
    const attachDialog = page.getByRole("dialog", { name: "Attach existing activity" });
    const candidate = attachDialog.locator(".project-candidate-row").filter({ hasText: `Catatan skripsi ${suffix}` });
    await keyboardPress(page, candidate.getByRole("button", { name: "Attach", exact: true }));
    await expect(candidate).toHaveCount(0);
    if (await attachDialog.isVisible()) await page.keyboard.press("Escape");
    await expect(attachDialog).toBeHidden();

    await page.goto(`/activity/${activityId}`);
    await keyboardPress(page, page.getByRole("link", { name: "Create Achievement", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await keyboardPress(page, page.getByRole("button", { name: "New Achievement", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
    await page.waitForLoadState("networkidle");
    const firstId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expect(page.locator(".achievement-detail-context")).toContainText(`Project: ${projectTitle}`);
    await keyboardType(page, page.getByLabel("Title", { exact: true }), firstTitle);
    await keyboardType(page, page.getByLabel("Contribution", { exact: true }), "Merancang dan menjalankan simulasi antrian untuk skripsi");
    await keyboardType(page, page.getByLabel("Outcome", { exact: true }), "Penguji menerima hasil simulasi tanpa revisi besar");
    const achievedOn = page.getByLabel("Achieved on", { exact: true });
    for (const digits of ["20092026", "09202026"]) {
      await tabTo(page, achievedOn);
      await page.keyboard.type(digits);
      if (await achievedOn.inputValue() === "2026-09-20") break;
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
    }
    await expect(achievedOn).toHaveValue("2026-09-20");
    await keyboardPress(page, page.getByRole("button", { name: "Confirm Achievement", exact: true }));
    await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
    const confirmed = await owner.from("achievements").select("status, metrics, cv_bullet, project_id, activity_id").eq("id", firstId).single();
    expect(confirmed.data).toMatchObject({ status: "confirmed", metrics: [], project_id: projectId, activity_id: activityId });
    const fallbackBullet = confirmed.data!.cv_bullet!;
    expect(fallbackBullet.length).toBeGreaterThan(10);
    const educationRow = await owner.from("education").select("id").eq("institution", school).single();
    const educationId = educationRow.data!.id;

    // 2. Entry from S04: the Dashboard offers the confirmed Achievement, and confirming did not add it to the CV.
    await page.goto("/dashboard");
    await expectAiFree(page, "dashboard after confirm");
    const notOnCv = page.getByRole("link", { name: "1 confirmed achievement is not on your CV." });
    await expect(notOnCv).toHaveAttribute("href", "/cv#cv-pool-achievements");
    expect((await owner.from("cv_items").select("id")).data).toEqual([]);
    await keyboardPress(page, notOnCv);
    await expect(page).toHaveURL(/\/cv#cv-pool-achievements$/);
    await expect(page.locator("#cv-pool-achievements")).toHaveJSProperty("open", true);
    await expectAiFree(page, "S13 first open");

    // 3. S13: select (the project parent follows its child), the education record, the CV language, an override
    //    with Indonesian characters, the section order, then an explicit Save.
    for (const id of [firstId, educationId]) {
      const add = page.locator(`#cv-add-${id}`);
      await expect(add).toHaveAttribute("aria-label", /^Add /);
      await press(page, add);
      await expect(add).toHaveAttribute("aria-disabled", "true");
    }
    await expect(page.locator('section[data-section="projects"] [data-testid="cv-item"]')).toHaveCount(2);
    await expect(page.locator('section[data-section="education"] [data-testid="cv-item"]')).toHaveCount(1);
    await expectFocusKept(page, "after Add");
    await page.getByLabel("CV language").selectOption("id");
    await expect(preview(page)).toContainText("Pendidikan");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByText(/^(Analy|Menganalisis)/)).toHaveCount(0);
    await snapshot(page, testInfo, "s13-selection");

    await press(page, page.getByRole("button", { name: `Edit wording for ${firstTitle}` }));
    const wording = page.getByLabel(`CV wording for ${firstTitle}`);
    await wording.fill(INDONESIAN_OVERRIDE);
    await expect(saveStatus(page)).toContainText("Unsaved changes");
    await expect(preview(page)).not.toContainText(INDONESIAN_OVERRIDE);
    await snapshot(page, testInfo, "s13-override");
    // A move is one server round trip: wait until the row has moved before the next key press.
    for (const row of [2, 1]) {
      await press(page, page.getByRole("button", { name: "Move Education section up" }));
      await expect(page.locator(".cv-order-row").nth(row)).toContainText("Education");
      await expect(page.getByRole("button", { name: "Move Education section up" })).toBeFocused();
    }
    await press(page, saveButton(page));
    await expect(saveStatus(page)).toContainText("All changes saved");
    await expect(preview(page)).toContainText(INDONESIAN_OVERRIDE);
    const savedRevision = await cvRevision();
    await expectAiFree(page, "S13 saved");

    // 4. S14 shows exactly the saved revision, then exports it with the real renderer.
    await press(page, page.getByTestId("cv-preview-export-link"));
    await expect(page).toHaveURL(/\/cv\/preview$/);
    await expect(page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${savedRevision}`);
    await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);
    await expectAiFree(page, "S14 ready");
    await snapshot(page, testInfo, "s14-ready");
    const first = await exportThroughS14();
    expect(first).toMatchObject({ succeeded: 1, failed: {} });
    await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
    const [pdf1Row] = await exportRows();
    expect(pdf1Row).toMatchObject({ status: "succeeded", cv_revision: savedRevision });
    await expect(pdfPages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("cv-pdf-indicator")).toHaveText(`Page 1 of ${pdf1Row!.page_count}`);
    await expect(page.getByTestId("cv-pdf-canvas")).toHaveAttribute("data-rendered", "1", { timeout: 30_000 });
    await snapshot(page, testInfo, "s14-succeeded-pdf1");

    // 5. The downloaded PDF is A4 and searchable, carries the saved override instead of the source wording, and no evidence.
    const pdf1Bytes = await downloadWithKeyboard(downloadButton(page));
    await expect(page.getByTestId("cv-export-notice")).toContainText("Your download has started.");
    const pdf1 = await pdfFacts(pdf1Bytes);
    expectA4(pdf1.sizes, "PDF-1");
    expect(pdf1.pageCount).toBe(pdf1Row!.page_count);
    for (const expected of [fullName, "Pendidikan", "Proyek", school, qualification, projectTitle, INDONESIAN_OVERRIDE]) {
      expect(pdf1.text, `PDF-1 carries ${expected}`).toContain(norm(expected));
    }
    expect(pdf1.text.indexOf("Pendidikan")).toBeLessThan(pdf1.text.indexOf("Proyek"));
    expect(pdf1.text).not.toContain(norm(fallbackBullet));
    expect(pdf1.text).not.toMatch(/evidence|https?:|\.pdf|storage|workpulse-private/i);
    const pdf1Hash = sha256(pdf1Bytes);
    expect(sha256(await storedBytes(pdf1Row!.id))).toBe(pdf1Hash);
    const pdf1Snapshot = snapshotMd5(pdf1Row!.id);

    // 6. Entry from S08 (Add to CV) with a second confirmed Achievement; then an edit of the first one in S08 turns its
    //    item into "changed", and Keep my wording keeps the override.
    await page.goto(`/projects/${projectId}`);
    await keyboardPress(page, page.getByRole("link", { name: "Create Achievement", exact: true }));
    await keyboardPress(page, page.getByRole("button", { name: "New Achievement", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
    await page.waitForLoadState("networkidle");
    const secondId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await page.getByLabel("Title", { exact: true }).fill(secondTitle);
    await page.getByLabel("Contribution", { exact: true }).fill("Merangkum masukan penguji sidang");
    await page.getByLabel("Outcome", { exact: true }).fill("Tim sepakat pada perbaikan berikutnya");
    await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-21");
    await page.locator('textarea[name="cv_bullet"]').fill(secondBullet);
    await keyboardPress(page, page.getByRole("button", { name: "Confirm Achievement", exact: true }));
    await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
    const itemsBefore = (await owner.from("cv_items").select("id")).data!.length;
    await keyboardPress(page, page.getByRole("link", { name: "Add to CV" }));
    await expect(page).toHaveURL(new RegExp(`/cv\\?highlight=${secondId}$`));
    await expect(page.locator('[data-testid="cv-pool-row"][aria-current="true"]')).toContainText("Suggested");
    expect((await owner.from("cv_items").select("id")).data!.length, "Add to CV only suggests").toBe(itemsBefore);
    const addSecond = page.locator(`#cv-add-${secondId}`);
    await expect(addSecond).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(addSecond).toHaveAttribute("aria-disabled", "true");
    await expect(saveStatus(page)).toContainText("All changes saved");
    await expect(preview(page)).toContainText(secondBullet);

    await page.goto(`/achievements/${firstId}`);
    await page.waitForLoadState("networkidle");
    await page.locator('textarea[name="cv_bullet"]').fill(editedSource);
    await keyboardPress(page, page.getByRole("button", { name: "Save changes", exact: true }));
    await expect(page.getByText("Achievement saved.", { exact: true }).first()).toBeVisible();
    await page.goto("/cv");
    const firstItem = page.locator('[data-testid="cv-item"]').filter({ hasText: firstTitle }).first();
    await expect(firstItem.getByText("Source changed")).toBeVisible();
    await expect(firstItem.getByText("Manual wording")).toBeVisible();
    await expect(preview(page)).toContainText(INDONESIAN_OVERRIDE);
    await expect(preview(page)).not.toContainText(editedSource);
    await press(page, page.getByRole("button", { name: `Review change for ${firstTitle}` }));
    const panel = page.getByTestId("cv-review-panel");
    await expect(panel).toContainText(INDONESIAN_OVERRIDE);
    await expect(panel).toContainText(editedSource);
    await snapshot(page, testInfo, "s13-review-changed");
    await press(page, panel.getByRole("button", { name: `Keep my wording for ${firstTitle}` }));
    await expect(announcer(page)).toContainText("Your wording kept for");
    await expect(preview(page)).toContainText(INDONESIAN_OVERRIDE);
    await expectFocusKept(page, "after Keep my wording");
    expect((await owner.from("cv_items").select("override_text").eq("achievement_id", firstId).single()).data?.override_text).toBe(INDONESIAN_OVERRIDE);
    await expect(page.getByTestId("cv-review-summary")).toHaveCount(0);

    await press(page, page.getByTestId("cv-preview-export-link"));
    await expect(page).toHaveURL(/\/cv\/preview$/);
    await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);
    const second = await exportThroughS14();
    expect(second).toMatchObject({ succeeded: 1, failed: {} });
    await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
    const [pdf2Row] = await exportRows();
    expect(pdf2Row!.id).not.toBe(pdf1Row!.id);
    const pdf2Bytes = await downloadWithKeyboard(downloadButton(page));
    const pdf2 = await pdfFacts(pdf2Bytes);
    expectA4(pdf2.sizes, "PDF-2");
    expect(pdf2.text).toContain(norm(INDONESIAN_OVERRIDE));
    expect(pdf2.text).toContain(norm(secondBullet));
    expect(pdf2.text).not.toContain(norm(editedSource));
    expect(sha256(pdf2Bytes)).not.toBe(pdf1Hash);

    // 7. Release scenario: the second Achievement is deleted in S08; S14 blocks, links to S13, Remove, export again.
    await page.goto(`/achievements/${secondId}`);
    const evidenceCountReady = page.getByRole("button", { name: "Delete", exact: true });
    await expect(evidenceCountReady).toBeEnabled();
    await keyboardPress(page, evidenceCountReady);
    const deleteDialog = page.getByRole("dialog", { name: "Delete this record?" });
    await expect(deleteDialog).toContainText(secondTitle);
    await keyboardPress(page, deleteDialog.getByRole("button", { name: "Delete", exact: true }));
    await expect.poll(async () => (await owner.from("achievements").select("id").eq("id", secondId)).data?.length).toBe(0);
    await page.goto("/cv/preview");
    const blocker = page.getByTestId("cv-export-blocker");
    await expect(blocker).toHaveCount(1);
    await expect(blocker).toHaveAttribute("data-code", "ITEM_DELETED");
    await expect(exportAction).toHaveAttribute("aria-disabled", "true");
    const rowsBeforeBlocked = (await exportRows()).length;
    await expect(exportAction).toBeVisible();
    await exportAction.click({ force: true });
    expect((await exportRows()).length, "a blocked export queues nothing").toBe(rowsBeforeBlocked);
    await expectAiFree(page, "S14 blocked");
    await snapshot(page, testInfo, "s14-blocked");
    const href = await blocker.getAttribute("href");
    expect(href).toMatch(/^\/cv#cv-item-[0-9a-f-]{36}$/);
    await keyboardPress(page, blocker);
    await expect(page).toHaveURL(new RegExp(`${href!.replace("/", "\\/")}$`));
    await press(page, page.getByRole("button", { name: `Remove ${secondTitle} from CV` }));
    await expect(page.locator('[data-testid="cv-item"]').filter({ hasText: secondTitle })).toHaveCount(0);
    await press(page, page.getByTestId("cv-preview-export-link"));
    await expect(page).toHaveURL(/\/cv\/preview$/);
    await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);
    const third = await exportThroughS14();
    expect(third).toMatchObject({ succeeded: 1, failed: {} });
    await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
    const [pdf3Row] = await exportRows();
    const pdf3 = await pdfFacts(await downloadWithKeyboard(downloadButton(page)));
    expect(pdf3.text).toContain(norm(INDONESIAN_OVERRIDE));
    expect(pdf3.text).not.toContain(norm(secondBullet));
    expect(pdf3Row!.id).not.toBe(pdf2Row!.id);

    // 8. A PDF made earlier does not change: the history download is the same bytes, and so are the stored object and snapshot.
    const oldRow = page.locator(`[data-testid="cv-export-row"][data-revision="${pdf1Row!.cv_revision}"]`);
    await expect(oldRow).toHaveCount(1);
    const redownloaded = await downloadWithKeyboard(oldRow.getByTestId("cv-export-row-download"));
    expect(sha256(redownloaded)).toBe(pdf1Hash);
    expect(sha256(await storedBytes(pdf1Row!.id))).toBe(pdf1Hash);
    expect(snapshotMd5(pdf1Row!.id)).toBe(pdf1Snapshot);

    // 9. A failed export is retried and an expired one regenerated, with the keyboard only.
    await page.goto("/cv");
    await page.locator("#cv-title").fill(`CV ${fullName}`);
    await press(page, saveButton(page));
    await expect(saveStatus(page)).toContainText("All changes saved");
    await press(page, page.getByTestId("cv-preview-export-link"));
    await expect(page).toHaveURL(/\/cv\/preview$/);
    const failed = await exportThroughS14("unavailable");
    expect(failed).toMatchObject({ succeeded: 0, failed: { RENDERER_UNAVAILABLE: 1 } });
    await expect(status(page)).toContainText("Export failed. Your CV is unchanged.", { timeout: 30_000 });
    await expect(retryButton(page)).toBeVisible();
    await expect(regenerateButton(page)).toHaveCount(0);
    const rowsBeforeRetry = (await exportRows()).length;
    await press(page, retryButton(page));
    await expect(status(page)).toContainText("Waiting to start");
    await expect(status(page)).toBeFocused();
    expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
    await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
    const retried = await exportRows();
    expect(retried.length, "Retry reuses the same export").toBe(rowsBeforeRetry);
    expect(retried[0]).toMatchObject({ status: "succeeded" });
    sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${retried[0]!.id}'::uuid`);
    await page.reload();
    await expect(status(page)).toContainText("Download expired");
    await expect(regenerateButton(page)).toBeVisible();
    await press(page, regenerateButton(page));
    await expect(status(page)).toContainText("Waiting to start");
    await expect(status(page)).toBeFocused();
    expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
    await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
    const afterRegenerate = await exportRows();
    expect(afterRegenerate.length).toBe(rowsBeforeRetry + 1);
    expect(afterRegenerate[0]!.id).not.toBe(retried[0]!.id);
    expect(sha256(await storedBytes(pdf1Row!.id))).toBe(pdf1Hash);

    // 10. Isolation: account B cannot see, query, sign or download anything of A through pages, routes, the API or Storage.
    const context = await browser.newContext({ baseURL: ORIGIN });
    const otherPage = await context.newPage();
    const ownerExportId = afterRegenerate[0]!.id;
    const ownerKey = objectKeyOf(ownerExportId);
    try {
      await signIn(otherPage, other);
      await expect(otherPage).toHaveURL(/\/dashboard$/);
      const secrets = [fullName, school, projectTitle, firstTitle, secondTitle, INDONESIAN_OVERRIDE, editedSource, `CV ${fullName}`];
      for (const route of ["/dashboard", "/cv", "/cv/preview", "/achievements", "/projects", "/activity", "/timeline"]) {
        await otherPage.goto(route);
        const body = await otherPage.locator("body").innerText();
        for (const secret of secrets) expect(body.includes(secret), `${route} must not reveal ${secret}`).toBe(false);
      }
      const answers = await Promise.all([ownerExportId, randomUUID(), "not-a-uuid"].map(async (id) => {
        const response = await otherPage.request.get(`${ORIGIN}/api/cv/exports/${id}`);
        return { status: response.status(), body: await response.json() as Record<string, unknown> };
      }));
      for (const answer of answers) {
        expect(answer.status).toBe(404);
        expect({ ...answer.body, correlationId: null }).toEqual({ ...answers[0]!.body, correlationId: null });
      }
      expect(answers[0]!.body).toMatchObject({ code: "EXPORT_NOT_FOUND" });
      const stranger = await signedInClient(url, publicKey, other);
      expect((await stranger.from("cv_exports").select("id").eq("id", ownerExportId)).data).toEqual([]);
      const ownerCv = await owner.from("cv_documents").select("id").single();
      expect((await stranger.from("cv_documents").select("id").eq("id", ownerCv.data!.id)).data).toEqual([]);
      expect((await stranger.from("cv_items").select("id")).data).toEqual([]);
      const foreignRpc = await stranger.rpc("get_cv_export_download", { p_export_id: ownerExportId });
      const randomRpc = await stranger.rpc("get_cv_export_download", { p_export_id: randomUUID() });
      expect(foreignRpc.error?.message).toBeTruthy();
      expect(foreignRpc.error?.message).toBe(randomRpc.error?.message);
      expect((await stranger.storage.from(BUCKET).createSignedUrl(ownerKey, 60)).data).toBeNull();
      expect((await stranger.storage.from(BUCKET).download(ownerKey)).data).toBeNull();
    } finally {
      await context.close();
    }

    // 11. A final accessibility pass on S14 with a real PDF page, and the 360 × 800 dark pass on S13 and S14.
    await page.goto("/cv/preview");
    await expect(pdfPages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("cv-pdf-canvas")).toHaveAttribute("data-rendered", /^\d+$/, { timeout: 30_000 });
    await snapshot(page, testInfo, "s14-succeeded-final");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.context().addCookies([{ name: "wp-theme", value: "dark", url: ORIGIN }]);
    for (const [label, route] of [["s13", "/cv"], ["s14", "/cv/preview"]] as const) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      if (route === "/cv/preview") await expect(page.getByTestId("cv-pdf-canvas")).toHaveAttribute("data-rendered", /^\d+$/, { timeout: 30_000 });
      await expectNoOverflow(page, `${label} 360 dark`);
      await snapshot(page, testInfo, `${label}-360-dark`);
      await expectAiFree(page, `${label} 360 dark`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    expect(consoleErrors, "no uncaught page errors during the journey").toEqual([]);
  } finally {
    for (const key of objectKeys) await admin.storage.from(BUCKET).remove([key]).catch(() => undefined);
    for (const user of users) {
      const listed = await admin.storage.from(BUCKET).list(`${user.id}/export`).catch(() => ({ data: null }));
      const names = (listed.data ?? []).map((object) => `${user.id}/export/${object.name}`);
      if (names.length > 0) await admin.storage.from(BUCKET).remove(names).catch(() => undefined);
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw new Error("M4 journey fixture cleanup failed.");
    }
  }
});
