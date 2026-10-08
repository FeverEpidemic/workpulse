import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { parseInThread } from "../../src/server/documents/parse-in-thread.ts";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { drainExportWorker, requireRealRenderer } from "./helpers/export-worker";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string; client: Client };
type SourceType = "experience" | "project" | "achievement" | "education" | "skill" | "certification";

const BASE_URL = "http://127.0.0.1:3014";
const SHOTS = "docs/verification/T22-screenshots";
const BUCKET = "workpulse-private";
const CONTAINER = process.env["WORKPULSE_TEST_DB_CONTAINER"] ?? "supabase_db_WorkPulse";
/** Only ever written to the accounts of the isolation test; nothing in a screenshot carries it. */
const SENTINEL = `WP-PRIVATE-CV-SENTINEL-${randomUUID()}`;

let admin: Client;
let supabaseUrl: string;
let publishableKey: string;
const users: User[] = [];

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const nul = null as never;

/** Statements run as the database owner: they move clocks and states that no API role may touch. */
function sql(statement: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe", encoding: "utf8" }).trim();
}

async function createUser(name = "Ani Contoh"): Promise<User> {
  const email = `t22-cv-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error("T22 fixture user failed");
  const client = createClient<Database>(supabaseUrl, publishableKey, options);
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error("T22 fixture sign-in failed");
  const profile = await client.from("profiles").select("revision").eq("id", id).single();
  const done = await client.rpc("complete_onboarding", {
    p_display_name: name, p_locale: "en", p_timezone: "Asia/Jakarta", p_expected_revision: profile.data!.revision,
  });
  if (done.error) throw new Error("T22 onboarding fixture failed");
  const user = { id, email, password, client };
  users.push(user);
  return user;
}

async function createEducation(user: User): Promise<string> {
  const { data, error } = await user.client.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: "Informatika",
    p_description: nul, p_start_date: "2019-01-01", p_start_precision: "year", p_end_date: "2023-01-01", p_end_precision: "year", p_is_current: false,
  });
  const id = data?.[0]?.id;
  if (error || !id) throw new Error("T22 education fixture failed");
  return id;
}

async function createProject(user: User, title: string): Promise<string> {
  const { data, error } = await user.client.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: title, p_description: "Deskripsi", p_user_role: "Peneliti", p_outcome: nul, p_status: "completed",
    p_start_date: nul, p_start_precision: nul, p_end_date: nul, p_end_precision: nul, p_is_current: false, p_experience_id: nul,
  } as never);
  const id = (data as { project_id?: string }[] | null)?.[0]?.project_id;
  if (error || !id) throw new Error("T22 project fixture failed");
  return id;
}

async function createAchievement(user: User, title: string, projectId: string | null = null, bullet?: string): Promise<string> {
  const created = await user.client.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: nul, p_project_id: projectId as never, p_experience_id: nul,
  } as never);
  const draft = created.data?.[0];
  if (created.error || !draft?.achievement_id) throw new Error("T22 achievement create failed");
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: draft.achievement_id, p_expected_revision: draft.revision, p_action: "confirm",
    p_changes: { title, contribution: `Kontribusi ${title}`, scope: "", outcome: `Hasil ${title}`, cv_bullet: bullet ?? `Bullet ${title}`, achieved_on: "2023-05-10", metrics: [] },
    p_skill_names: [],
  } as never);
  if (saved.error || !saved.data?.[0]) throw new Error("T22 achievement save failed");
  return draft.achievement_id;
}

async function achievementRow(user: User, id: string) {
  const { data, error } = await user.client.from("achievements").select("revision, title, contribution, outcome, achieved_on").eq("id", id).single();
  if (error || !data) throw new Error("T22 achievement read failed");
  return data;
}

/** A source edit made outside the CV (as on the Achievements screen). */
async function editBullet(user: User, id: string, bullet: string): Promise<void> {
  const row = await achievementRow(user, id);
  const saved = await user.client.rpc("save_achievement", {
    p_achievement_id: id, p_expected_revision: row.revision, p_action: "save_changes",
    p_changes: { title: row.title, contribution: row.contribution, outcome: row.outcome, cv_bullet: bullet, achieved_on: row.achieved_on },
    p_skill_names: [],
  } as never);
  if (saved.error) throw new Error("T22 achievement edit failed");
}

async function removeAchievement(user: User, id: string): Promise<void> {
  const row = await achievementRow(user, id);
  const deleted = await user.client.rpc("delete_achievement", { p_achievement_id: id, p_expected_revision: row.revision });
  if (deleted.error) throw new Error("T22 achievement delete failed");
}

async function cvDoc(user: User) {
  const { data, error } = await user.client.from("cv_documents").select("id, revision, locale, section_order").eq("user_id", user.id).single();
  if (error || !data) throw new Error("T22 CV read failed");
  return data;
}

async function ensureCv(user: User): Promise<void> {
  if ((await user.client.rpc("ensure_cv_document")).error) throw new Error("T22 CV open failed");
}

/** Selects sources through the real RPC, as the Add button does. */
async function selectSources(user: User, sources: [SourceType, string][]): Promise<void> {
  await ensureCv(user);
  for (const [type, id] of sources) {
    const doc = await cvDoc(user);
    const added = await user.client.rpc("select_cv_source", { p_expected_revision: doc.revision, p_source_type: type, p_source_id: id });
    if (added.error) throw new Error("T22 CV selection failed");
  }
}

async function saveCvEdits(user: User, edits: Record<string, unknown>): Promise<void> {
  const doc = await cvDoc(user);
  const saved = await user.client.rpc("save_cv_edits", { p_expected_revision: doc.revision, p_edits: edits as never });
  if (saved.error) throw new Error("T22 CV save failed");
}

async function setCvLocale(user: User, locale: "en" | "id"): Promise<void> {
  const doc = await cvDoc(user);
  const updated = await user.client.rpc("update_cv_layout", { p_expected_revision: doc.revision, p_locale: locale, p_section_order: doc.section_order as never });
  if (updated.error) throw new Error("T22 CV layout failed");
}

async function itemIdFor(user: User, achievementId: string): Promise<string> {
  const { data, error } = await user.client.from("cv_items").select("id").eq("achievement_id", achievementId).single();
  if (error || !data) throw new Error("T22 item lookup failed");
  return data.id;
}

/** A CV a graduate could export: education, an academic project and one confirmed achievement, all selected. */
async function readyCv(user: User, label = "Hasil skripsi") {
  const education = await createEducation(user);
  const project = await createProject(user, "Skripsi Sistem Antrian");
  const achievement = await createAchievement(user, label, project);
  await selectSources(user, [["education", education], ["project", project], ["achievement", achievement]]);
  return { education, project, achievement, itemId: await itemIdFor(user, achievement) };
}

type ExportRow = { id: string; status: string; cv_revision: number; error_code: string | null; attempt_count: number; page_count: number | null };
async function exportRows(user: User): Promise<ExportRow[]> {
  const { data, error } = await user.client.from("cv_exports").select("id, status, cv_revision, error_code, attempt_count, page_count").order("created_at", { ascending: false });
  if (error) throw new Error("T22 export read failed");
  return (data ?? []) as ExportRow[];
}

async function storedPdfText(exportId: string): Promise<string> {
  const key = sql(`select object_key from public.cv_exports where id = '${exportId}'::uuid`);
  const { data, error } = await admin.storage.from(BUCKET).download(key);
  if (error || !data) throw new Error("T22 stored PDF read failed");
  const parsed = await parseInThread("pdf-export", new Uint8Array(await data.arrayBuffer()));
  if (parsed.status !== "ok") throw new Error("T22 stored PDF parse failed");
  return (parsed.text ?? "").normalize("NFKC").replace(/\s+/g, " ");
}

async function signIn(page: Page, user: User, returnTo = "/cv/preview"): Promise<void> {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/[?/=#]/g, "\\$&") + "$"));
}

const status = (page: Page) => page.getByTestId("cv-export-status");
const saveStatus = (page: Page) => page.locator(".cv-save-status");
const exportButton = (page: Page) => page.getByTestId("cv-export-export");
const retryButton = (page: Page) => page.getByTestId("cv-export-retry");
const regenerateButton = (page: Page) => page.getByTestId("cv-export-regenerate");
const downloadButton = (page: Page) => page.getByTestId("cv-export-download");
const pages = (page: Page) => page.getByTestId("cv-pdf-pages");
const canvas = (page: Page) => page.getByTestId("cv-pdf-canvas");
const preview = (page: Page) => page.getByTestId("cv-preview-paper");

/** Keyboard events need a hydrated page; a click would be retried, a key press is not. */
async function press(page: Page, target: Locator, key = "Enter") {
  await page.waitForLoadState("networkidle");
  await target.focus();
  await page.keyboard.press(key);
}

/** Pixel facts of the page now on the canvas: how much ink there is and where its edges are (as fractions of the page). */
async function ink(page: Page) {
  return canvas(page).evaluate((element) => {
    const canvasElement = element as HTMLCanvasElement;
    const { width, height } = canvasElement;
    const data = canvasElement.getContext("2d")!.getImageData(0, 0, width, height).data;
    let count = 0;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        if (data[at]! < 200 || data[at + 1]! < 200 || data[at + 2]! < 200) {
          count += 1;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    return { width, height, count, left: left / width, right: (right + 1) / width, top: top / height, bottom: (bottom + 1) / height };
  });
}

/** Waits until the canvas holds the whole page (the component marks it), then until it has ink. */
async function expectPageDrawn(page: Page, label: string, number?: number) {
  if (number !== undefined) await expect(canvas(page), `${label}: page ${number} is fully drawn`).toHaveAttribute("data-rendered", String(number), { timeout: 30_000 });
  else await expect(canvas(page), `${label}: the page is fully drawn`).toHaveAttribute("data-rendered", /^\d+$/, { timeout: 30_000 });
  await expect(canvas(page)).not.toHaveAttribute("aria-busy", "true");
  await expect.poll(async () => (await ink(page)).count, { message: `${label}: the page has ink on the canvas`, timeout: 30_000 }).toBeGreaterThan(300);
}

function expectInsideMargins(box: Awaited<ReturnType<typeof ink>>, label: string) {
  // A4 with 18 mm and 16 mm margins: 8.6 % and 5.4 %; the checks leave about 1.5 % of slack for anti-aliasing.
  expect(box.left, `${label}: left edge of the ink`).toBeGreaterThanOrEqual(0.07);
  expect(box.right, `${label}: right edge of the ink`).toBeLessThanOrEqual(0.93);
  expect(box.top, `${label}: top edge of the ink`).toBeGreaterThanOrEqual(0.04);
  expect(box.bottom, `${label}: bottom edge of the ink`).toBeLessThanOrEqual(0.96);
}

async function expectNoOverflow(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${name} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string) {
  await expectNoWcagViolations(page, testInfo, name);
  mkdirSync(SHOTS, { recursive: true });
  const shot = await page.screenshot({ fullPage: true, path: `${SHOTS}/${name}.png` });
  await testInfo.attach(name, { body: shot, contentType: "image/png" });
}

function collectConsole(page: Page): string[] {
  const seen: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") seen.push(message.text()); });
  page.on("pageerror", (error) => seen.push(String(error)));
  return seen;
}

async function secondSession(browser: Browser, user: User, returnTo = "/cv/preview") {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await signIn(page, user, returnTo);
  return { context, page };
}

test.beforeAll(async () => {
  const { url, secretKey, publicKey } = config();
  supabaseUrl = url;
  publishableKey = publicKey;
  admin = createClient<Database>(url, secretKey, options);
  await requireRealRenderer();
});

// The queue is global: a job a previous scenario left behind (it did not need it finished) must not be counted by this one.
test.beforeEach(async () => {
  await drainExportWorker("fake");
});

test.afterAll(async () => {
  for (const user of users) {
    const listed = await admin.storage.from(BUCKET).list(`${user.id}/export`).catch(() => ({ data: null }));
    const names = (listed.data ?? []).map((object) => `${user.id}/export/${object.name}`);
    if (names.length > 0) await admin.storage.from(BUCKET).remove(names).catch(() => undefined);
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("access: anonymous goes to sign-in and back, an account without a CV sees an empty state that creates nothing, and the CV stays active in the navigation", async ({ page, request }) => {
  const user = await createUser();
  await page.goto("/cv/preview");
  await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fcv%2Fpreview/);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(/\/cv\/preview$/);

  await expect(page.getByRole("heading", { name: "There is no CV to export yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open CV builder" })).toHaveAttribute("href", "/cv");
  await expect(page.locator(".workspace-nav-link.is-current").first()).toHaveText("CV");
  const documents = await user.client.from("cv_documents").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  expect(documents.count).toBe(0);

  // The status route answers an anonymous request with a generic 401.
  const anonymous = await request.get(`${BASE_URL}/api/cv/exports/${randomUUID()}`);
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
});

test("graduate journey with the keyboard: select, save, open S14, export with the real renderer, see the real pages, download", async ({ page }) => {
  const errors = collectConsole(page);
  const user = await createUser();
  const education = await createEducation(user);
  const project = await createProject(user, "Skripsi Sistem Antrian");
  const achievement = await createAchievement(user, "Hasil skripsi", project);
  await signIn(page, user, "/cv");

  // Select three records, one key press each, and wait for each to be reported as added.
  for (const id of [education, project, achievement]) {
    const add = page.locator(`#cv-add-${id}`);
    await expect(add).toHaveAttribute("aria-label", /^Add /);
    await press(page, add);
    await expect(add).toHaveAttribute("aria-disabled", "true");
  }
  // A text edit needs the explicit Save; until then the way to S14 is closed.
  await page.locator("#cv-summary").fill("Lulusan Informatika yang terbiasa menyusun laporan penelitian.");
  const link = page.getByTestId("cv-preview-export-link");
  await expect(link).toHaveAttribute("aria-disabled", "true");
  await press(page, page.getByRole("button", { name: "Save changes", exact: true }));
  await expect(saveStatus(page)).toHaveText("All changes saved");
  await expect(link).not.toHaveAttribute("aria-disabled", "true");
  await press(page, link);
  await expect(page).toHaveURL(/\/cv\/preview$/);

  const revision = (await cvDoc(user)).revision;
  await expect(page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${revision}`);
  await expect(preview(page)).toContainText("Lulusan Informatika yang terbiasa menyusun laporan penelitian.");
  await expect(status(page)).toContainText("No PDF has been exported from this revision yet.");
  await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);

  // The explicit action: the job is queued, the status is announced, and focus moves to it.
  await press(page, exportButton(page));
  await expect(status(page)).toContainText("Waiting to start");
  await expect(status(page)).toBeFocused();
  expect((await exportRows(user)).map((row) => row.status)).toEqual(["queued"]);

  const drained = await drainExportWorker("gotenberg");
  expect(drained).toMatchObject({ claimed: 1, succeeded: 1, failed: {} });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  const [row] = await exportRows(user);
  expect(row).toMatchObject({ status: "succeeded", cv_revision: revision });

  // The pages come from the real PDF: as many as the worker stored, drawn on a labelled canvas.
  await expect(pages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expect(page.getByTestId("cv-pdf-indicator")).toHaveText(`Page 1 of ${row!.page_count}`);
  await expect(canvas(page)).toHaveAttribute("aria-label", `Page 1 of ${row!.page_count} of the exported PDF`);
  await expectPageDrawn(page, "page 1", 1);
  expectInsideMargins(await ink(page), "page 1");
  const next = page.getByTestId("cv-pdf-next");
  if (row!.page_count! > 1) {
    await press(page, next);
    await expect(page.getByTestId("cv-pdf-indicator")).toHaveText(`Page 2 of ${row!.page_count}`);
  } else {
    await expect(next).toHaveAttribute("aria-disabled", "true");
  }

  // The initial HTML of the page never contained a download address.
  const html = await (await page.context().request.get(`${BASE_URL}/cv/preview`)).text();
  expect(html).not.toMatch(/token=|\/storage\/v1\/object\/sign|signedUrl/);

  // Download: a generic dated name, and the bytes are a PDF.
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton(page).click()]);
  expect(download.suggestedFilename()).toMatch(/^WorkPulse-CV-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect(readFileSync((await download.path())!).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  await expect(page.getByTestId("cv-export-notice")).toContainText("Your download has started.");
  expect(errors.filter((message) => !/Failed to load resource/.test(message))).toEqual([]);
});

test("unsaved wording closes the way to S14 with a visible reason, and S14 itself shows only the saved revision", async ({ page, browser }) => {
  const user = await createUser();
  await readyCv(user);
  await signIn(page, user, "/cv");
  const draft = `Draf belum disimpan ${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: "Edit wording for Hasil skripsi" }).click();
  await page.getByLabel("CV wording for Hasil skripsi").fill(draft);

  const link = page.getByTestId("cv-preview-export-link");
  await expect(link).toHaveAttribute("aria-disabled", "true");
  const reason = page.getByTestId("cv-preview-export-reason");
  await expect(reason).toHaveText("Save your changes first.");
  await expect(link).toHaveAttribute("aria-describedby", (await reason.getAttribute("id"))!);
  await expect(link).toBeVisible();
  await link.click({ force: true });
  await expect(page).toHaveURL(/\/cv$/);

  // Opening S14 straight away (another tab) shows the saved revision and none of the draft.
  const other = await secondSession(browser, user, "/cv/preview");
  await expect(other.page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${(await cvDoc(user)).revision}`);
  await expect(preview(other.page)).toContainText("Bullet Hasil skripsi");
  await expect(other.page.locator("body")).not.toContainText(draft);
  await other.context.close();
});

test("release scenario: deleting a selected source blocks the export with a link to the item, and it is ready again after the item is removed", async ({ page }) => {
  const user = await createUser();
  const { achievement, itemId } = await readyCv(user);
  await signIn(page, user);
  await expect(exportButton(page)).not.toHaveAttribute("aria-disabled", "true");

  await removeAchievement(user, achievement);
  await page.reload();
  const blocker = page.getByTestId("cv-export-blocker");
  await expect(blocker).toHaveCount(1);
  await expect(blocker).toHaveAttribute("data-code", "ITEM_DELETED");
  await expect(blocker).toHaveAttribute("href", `/cv#cv-item-${itemId}`);
  await expect(exportButton(page)).toHaveAttribute("aria-disabled", "true");
  const reasonId = await exportButton(page).getAttribute("aria-describedby");
  await expect(page.locator(`#${reasonId}`)).toContainText("Your CV cannot be exported yet.");
  // A click on the disabled action does nothing (a forced click does not wait, so wait until the page is revealed first).
  await expect(exportButton(page)).toBeVisible();
  await exportButton(page).click({ force: true });
  expect(await exportRows(user)).toHaveLength(0);

  await blocker.click();
  await expect(page).toHaveURL(new RegExp(`/cv#cv-item-${itemId}$`));
  await page.getByRole("button", { name: "Remove Hasil skripsi from CV" }).click();
  await page.getByTestId("cv-preview-export-link").click();
  await expect(page).toHaveURL(/\/cv\/preview$/);
  await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);
  await expect(exportButton(page)).not.toHaveAttribute("aria-disabled", "true");
});

test("a changed source blocks until Keep saved wording; the export then carries the saved wording, not the new source text", async ({ page }) => {
  const user = await createUser();
  const { achievement, itemId } = await readyCv(user);
  await signIn(page, user);
  const edited = `Sumber diubah ${randomUUID().slice(0, 8)}`;
  await editBullet(user, achievement, edited);
  await page.reload();
  const blocker = page.getByTestId("cv-export-blocker");
  await expect(blocker).toHaveAttribute("data-code", "ITEM_CHANGED");
  await expect(blocker).toHaveAttribute("href", `/cv#cv-item-${itemId}`);
  await expect(exportButton(page)).toHaveAttribute("aria-disabled", "true");

  await blocker.click();
  await page.getByRole("button", { name: "Review change for Hasil skripsi" }).click();
  await page.getByRole("button", { name: "Keep saved wording for Hasil skripsi" }).click();
  await page.getByTestId("cv-preview-export-link").click();
  await expect(page).toHaveURL(/\/cv\/preview$/);
  await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);

  await exportButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
  expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  const [row] = await exportRows(user);
  const text = await storedPdfText(row!.id);
  expect(text).toContain("Bullet Hasil skripsi");
  expect(text).not.toContain(edited);
});

test("a failed export offers Retry for the same snapshot; after the CV changed only Regenerate is offered", async ({ page }) => {
  const user = await createUser();
  await readyCv(user);
  await signIn(page, user);

  await exportButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
  expect(await drainExportWorker("unavailable")).toMatchObject({ claimed: 1, succeeded: 0, failed: { RENDERER_UNAVAILABLE: 1 } });
  await expect(status(page)).toContainText("Export failed. Your CV is unchanged.", { timeout: 30_000 });
  await expect(page.getByTestId("cv-export-failure")).toContainText("The PDF service is not available right now.");
  await expect(page.getByTestId("cv-export-failure")).not.toContainText("RENDERER_UNAVAILABLE");
  await expect(retryButton(page)).toBeVisible();
  await expect(regenerateButton(page)).toHaveCount(0);

  // Retry: same export, back in the queue; the real renderer finishes it.
  await retryButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
  const [queuedRow] = await exportRows(user);
  expect(queuedRow).toMatchObject({ status: "queued" });
  expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  expect(await exportRows(user)).toHaveLength(1);

  // The CV changes; a new export fails; then the CV changes again: that failure belongs to an earlier revision.
  await saveCvEdits(user, { title: `Judul kedua ${randomUUID().slice(0, 6)}` });
  await page.reload();
  await expect(regenerateButton(page)).toBeVisible();
  await expect(downloadButton(page)).toBeVisible();
  await regenerateButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
  expect(await drainExportWorker("unavailable")).toMatchObject({ claimed: 1, failed: { RENDERER_UNAVAILABLE: 1 } });
  await expect(retryButton(page)).toBeVisible({ timeout: 30_000 });
  await saveCvEdits(user, { title: `Judul ketiga ${randomUUID().slice(0, 6)}` });
  await page.reload();
  await expect(status(page)).toContainText("Export failed. Your CV is unchanged.");
  await expect(retryButton(page)).toHaveCount(0);
  await expect(regenerateButton(page)).toBeVisible();
  await expect(page.getByTestId("cv-export-row-retry")).toHaveCount(0);
});

test("an expired file says so and offers Regenerate, which makes a new export", async ({ page }) => {
  const user = await createUser();
  await readyCv(user);
  await signIn(page, user);
  await exportButton(page).click();
  expect(await drainExportWorker("fake")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  const [first] = await exportRows(user);

  sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${first!.id}'::uuid`);
  await page.reload();
  await expect(status(page)).toContainText("Download expired");
  await expect(pages(page)).toHaveCount(0);
  await expect(downloadButton(page)).toHaveCount(0);
  await expect(regenerateButton(page)).toBeVisible();

  await regenerateButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
  expect(await drainExportWorker("fake")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  const rows = await exportRows(user);
  expect(rows).toHaveLength(2);
  expect(rows[0]!.id).not.toBe(first!.id);
  await expect(page.getByTestId("cv-export-row")).toHaveCount(2);
});

test("when the PDF pages cannot be loaded the page says so, offers Try again, and the download stays available", async ({ page }) => {
  const user = await createUser();
  await readyCv(user);
  await signIn(page, user);
  await exportButton(page).click();
  expect(await drainExportWorker("fake")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(status(page)).toContainText("PDF ready", { timeout: 30_000 });
  await expect(pages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });

  // The storage request that carries the bytes fails: the pages cannot be drawn, nothing else is affected.
  await page.route("**/storage/v1/object/sign/**", (route) => route.abort());
  await page.reload();
  await expect(pages(page)).toHaveAttribute("data-phase", "error", { timeout: 30_000 });
  await expect(page.getByTestId("cv-pdf-error")).toHaveText("The PDF pages could not be shown. You can still download the PDF.");
  await expect(status(page)).toContainText("PDF ready");
  await expect(downloadButton(page)).toBeVisible();
  await expect(downloadButton(page)).toBeEnabled();
  await expect(canvas(page)).toHaveCount(0);

  // Try again after the network is back.
  await page.unroute("**/storage/v1/object/sign/**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(pages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
  await expectPageDrawn(page, "after Try again", 1);
});

test("two tabs: a CV saved in one tab turns Export in the other into a reload prompt and creates no export", async ({ page, browser }) => {
  const user = await createUser();
  await readyCv(user);
  await signIn(page, user);
  const shown = (await cvDoc(user)).revision;
  await expect(page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${shown}`);

  // Another tab saves the CV.
  const other = await secondSession(browser, user, "/cv");
  await other.page.locator("#cv-title").fill(`Judul dari tab lain ${randomUUID().slice(0, 6)}`);
  await other.page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(saveStatus(other.page)).toHaveText("All changes saved");
  const saved = (await cvDoc(user)).revision;
  expect(saved).toBeGreaterThan(shown);

  await exportButton(page).click();
  const notice = page.getByTestId("cv-export-notice");
  await expect(notice).toHaveAttribute("data-kind", "stale");
  await expect(notice).toContainText("Your CV changed since this page loaded.");
  await expect(notice).toBeFocused();
  expect(await exportRows(user)).toHaveLength(0);
  // The page does not retry by itself.
  await page.waitForTimeout(1500);
  expect(await exportRows(user)).toHaveLength(0);

  await page.getByTestId("cv-export-reload").click();
  await expect(page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${saved}`);
  await expect(notice).toHaveCount(0);
  await other.context.close();
});

test("isolation: another account cannot see, download or retry an export, and the owner's private text never reaches it", async ({ page, browser, request }) => {
  const owner = await createUser("Ani Pemilik");
  const { achievement } = await readyCv(owner);
  await saveCvEdits(owner, { title: `CV ${SENTINEL}`, item_overrides: [{ item_id: await itemIdFor(owner, achievement), override_text: `Wording ${SENTINEL}` }] });
  const ownerSession = await secondSession(browser, owner);
  await ownerSession.page.getByTestId("cv-export-export").click();
  expect(await drainExportWorker("fake")).toMatchObject({ claimed: 1, succeeded: 1 });
  await expect(ownerSession.page.getByTestId("cv-export-status")).toContainText("PDF ready", { timeout: 30_000 });
  await expect(ownerSession.page.locator("body")).toContainText(SENTINEL);
  const [ownerExport] = await exportRows(owner);

  const intruder = await createUser("Budi Lain");
  await readyCv(intruder, "Hasil milik Budi");
  const seen: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    if (/text|json/.test(type)) seen.push(await response.text().catch(() => ""));
  });
  const errors = collectConsole(page);
  await signIn(page, intruder);
  await expect(page.getByTestId("cv-export-title")).toHaveText(/Master CV|CV/);
  await expect(page.getByTestId("cv-export-row")).toHaveCount(0);

  const results = await Promise.all([ownerExport!.id, randomUUID(), "not-a-uuid"].map(async (id) => {
    const response = await page.request.get(`${BASE_URL}/api/cv/exports/${id}`);
    return { status: response.status(), body: await response.json() as Record<string, unknown>, cache: response.headers()["cache-control"] };
  }));
  for (const result of results) {
    expect(result.status).toBe(404);
    expect(result.cache).toBe("no-store");
    expect(Object.keys(result.body).sort()).toEqual(["code", "correlationId", "message"]);
    expect({ ...result.body, correlationId: null }).toEqual({ ...results[0]!.body, correlationId: null });
  }
  expect(results[0]!.body).toMatchObject({ code: "EXPORT_NOT_FOUND" });
  seen.push(JSON.stringify(results));

  // The intruder's page, its network and its console carry nothing of the owner.
  expect(await page.content()).not.toContain(SENTINEL);
  expect(seen.join("\n")).not.toContain(SENTINEL);
  expect(errors.join("\n")).not.toContain(SENTINEL);
  const anonymous = await request.get(`${BASE_URL}/api/cv/exports/${ownerExport!.id}`);
  expect(anonymous.status()).toBe(401);
  await ownerSession.context.close();
});

test("accessibility, responsive layout and themes: six states, 360 and 1440 px, light and dark, keyboard focus and reduced motion", async ({ page, browser }, testInfo) => {
  test.setTimeout(900_000);
  const blocked = await createUser();
  const blockedCv = await readyCv(blocked);
  await removeAchievement(blocked, blockedCv.achievement);
  const ready = await createUser();
  await readyCv(ready);
  const running = await createUser();
  await readyCv(running);
  const succeeded = await createUser();
  await readyCv(succeeded);
  const failed = await createUser();
  await readyCv(failed);

  // running: a real queued export that the database moved to running by hand (its lease outlives the test);
  // succeeded: the real renderer; failed: a renderer that is not available (retriable failure).
  const queueExport = async (user: User) => {
    const session = await secondSession(browser, user);
    await session.page.getByTestId("cv-export-export").click();
    await expect(session.page.getByTestId("cv-export-status")).toContainText("Waiting to start");
    await session.context.close();
    return (await exportRows(user))[0]!;
  };
  const runningRow = await queueExport(running);
  sql(`update public.cv_exports set status = 'running', attempt_token = gen_random_uuid(), lease_expires_at = clock_timestamp() + interval '30 minutes', attempt_count = 1, started_at = clock_timestamp() where id = '${runningRow.id}'::uuid`);
  const succeededRow = await queueExport(succeeded);
  expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
  await queueExport(failed);
  expect(await drainExportWorker("unavailable")).toMatchObject({ claimed: 1, failed: { RENDERER_UNAVAILABLE: 1 } });
  const BLOCKERS = "blockers";
  const cases: { name: string; user: User; text: string; pdf?: boolean }[] = [
    { name: "blocked", user: blocked, text: BLOCKERS },
    { name: "ready", user: ready, text: "No PDF has been exported from this revision yet." },
    { name: "running", user: running, text: "Preparing your PDF" },
    { name: "succeeded", user: succeeded, text: "PDF ready", pdf: true },
    { name: "failed", user: failed, text: "Export failed. Your CV is unchanged." },
  ];
  const widths = [1440, 360] as const;
  const themes = ["light", "dark"] as const;
  const view = async (user: User, width: number, theme: "light" | "dark", text: string, pdf = false) => {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    await page.context().addCookies([{ name: "wp-theme", value: theme, url: BASE_URL }]);

    await page.goto("/cv/preview");
    if (page.url().includes("/sign-in")) await signIn(page, user);
    // The blocked state has no export yet: its message is the list of blockers, the other states speak through the status.
    if (text === BLOCKERS) await expect(page.getByTestId("cv-export-blockers")).toContainText("A record on your CV was deleted.");
    else await expect(status(page)).toContainText(text);
    if (pdf) {
      await expect(pages(page)).toHaveAttribute("data-phase", "ready", { timeout: 30_000 });
      await expectPageDrawn(page, `${width} ${theme}`);
    }
  };

  for (const entry of cases) {
    await page.context().clearCookies();
    await signIn(page, entry.user);
    for (const width of widths) {
      for (const theme of themes) {
        await view(entry.user, width, theme, entry.text, entry.pdf);
        await expectNoOverflow(page, `s14-${entry.name}-${width}-${theme}`);
        await snapshot(page, testInfo, `s14-${entry.name}-${width}-${theme}`);
      }
    }
  }

  // expired: the same account as succeeded, after its 24 hours.
  await page.context().clearCookies();
  await signIn(page, succeeded);
  sql(`update public.cv_exports set expires_at = clock_timestamp() - interval '1 minute' where id = '${succeededRow!.id}'::uuid`);
  for (const width of widths) {
    for (const theme of themes) {
      await view(succeeded, width, theme, "Download expired");
      await expectNoOverflow(page, `s14-expired-${width}-${theme}`);
      await snapshot(page, testInfo, `s14-expired-${width}-${theme}`);
    }
  }

  // Keyboard and focus: the explicit action by key, the status takes focus, and the focus ring is visible.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.context().clearCookies();
  await signIn(page, ready);
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  await exportButton(page).focus();
  await expect(exportButton(page)).toBeFocused();
  const outline = await exportButton(page).evaluate((element) => getComputedStyle(element).outlineStyle + " " + getComputedStyle(element).outlineWidth);
  expect(outline).not.toMatch(/^none/);
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("Waiting to start");
  await expect(status(page)).toBeFocused();
  await expect(status(page)).toHaveAttribute("role", "status");
  await expect(status(page)).toHaveAttribute("aria-live", "polite");

  // Reduced motion: no transition or animation runs on the page.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const durations = await page.locator(".cv-export-layout button, .cv-export-layout a").evaluateAll((elements) => elements.map((element) => getComputedStyle(element).transitionDuration));
  expect(new Set(durations)).toEqual(new Set(["0s"]));
});

/** A paragraph of at least `length` characters that begins with START-<tag> and ends with END-<tag>. */
function longBullet(tag: string, length = 640): string {
  const words = "tim berhasil memberikan hasil yang terukur bagi pelanggan sambil menjaga biaya program tetap terkendali dan mendokumentasikan setiap keputusan".split(" ");
  let text = `START-${tag}`;
  for (let index = 0; text.length < length; index += 1) text += ` ${words[index % words.length]}`;
  return `${text} END-${tag}`;
}

test("long CV in Bahasa Indonesia and English: every page of the real PDF is drawn inside its margins (screenshots of each page)", async ({ page }, testInfo) => {
  test.setTimeout(900_000);
  const user = await createUser("Budi Santoso");
  const bigProject = await createProject(user, "Program Transformasi Digital");
  const sources: [SourceType, string][] = [["project", bigProject]];
  for (let index = 1; index <= 12; index += 1) sources.push(["achievement", await createAchievement(user, `Pencapaian ${index}`, null, longBullet(`A${index}`))]);
  for (let index = 1; index <= 24; index += 1) sources.push(["achievement", await createAchievement(user, `Hasil program ${index}`, bigProject, longBullet(`P${index}`))]);
  await selectSources(user, sources);
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });

  let expectedRevision = 0;
  for (const locale of ["id", "en"] as const) {
    await setCvLocale(user, locale);
    expectedRevision = (await cvDoc(user)).revision;
    await page.reload();
    await expect(page.getByTestId("cv-export-revision")).toHaveText(`Saved revision ${expectedRevision}`);
    await regenerateOrExport(page);
    expect(await drainExportWorker("gotenberg")).toMatchObject({ claimed: 1, succeeded: 1 });
    await expect(status(page)).toContainText("PDF ready", { timeout: 60_000 });
    const [row] = await exportRows(user);
    expect(row).toMatchObject({ status: "succeeded", cv_revision: expectedRevision });
    const total = row!.page_count!;
    expect(total).toBeGreaterThan(1);
    expect(total).toBeLessThanOrEqual(20);
    await expect(pages(page)).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
    mkdirSync(SHOTS, { recursive: true });
    for (let number = 1; number <= total; number += 1) {
      await expect(page.getByTestId("cv-pdf-indicator")).toHaveText(`Page ${number} of ${total}`);
      await expectPageDrawn(page, `${locale} page ${number}`, number);
      const box = await ink(page);
      expectInsideMargins(box, `${locale} page ${number}`);
      const shot = await canvas(page).screenshot({ path: `${SHOTS}/pdf-${locale}-page-${number}.png` });
      await testInfo.attach(`pdf-${locale}-page-${number}`, { body: shot, contentType: "image/png" });
      if (number < total) await press(page, page.getByTestId("cv-pdf-next"));
    }
    const text = await storedPdfText(row!.id);
    for (const tag of ["A1", "A12", "P1", "P24"]) {
      expect(text).toContain(`START-${tag}`);
      expect(text).toContain(`END-${tag}`);
    }
  }
});

async function regenerateOrExport(page: Page) {
  const regenerate = regenerateButton(page);
  if (await regenerate.count()) await regenerate.click();
  else await exportButton(page).click();
  await expect(status(page)).toContainText("Waiting to start");
}
