import { randomBytes, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { cvDocx, DOCX_MIME } from "../import-fixtures";
import { expectNoWcagViolations } from "./helpers/accessibility";
import { requireRealRenderer } from "./helpers/export-worker";

// Gate M5 (docs/verification/M5-gate-review-plan.md, Fase 3): one pilot account runs the whole product life cycle in the
// browser, in Bahasa Indonesia, against local Supabase, private Storage, real ClamAV, real Gotenberg and the real PDF
// renderer. Only the mail sink, worker drains, one concurrent edit and read-only checks bypass the UI.
const ORIGIN = "http://127.0.0.1:3018";
const MAILPIT_ORIGIN = process.env["WORKPULSE_MAILPIT_URL"] ?? "http://127.0.0.1:54324";
const CONTAINER = process.env["WORKPULSE_TEST_DB_CONTAINER"] ?? "supabase_db_WorkPulse";
const BUCKET = "workpulse-private";
const CLAMD = { host: "127.0.0.1", port: "13310" };
const DOCX_RENDERER_URL = "http://127.0.0.1:13400";
const PDF_RENDERER_URL = process.env["WORKPULSE_PDF_GOTENBERG_URL"]?.trim() || "http://127.0.0.1:13401";

type Client = SupabaseClient<Database>;
const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const norm = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey };
}

/** Read-only checks and the one concurrent edit run as the database owner. */
function sql(statement: string): string {
  return execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], { stdio: "pipe", encoding: "utf8" }).trim();
}
const count = (statement: string) => Number(sql(statement));

// The worker child gets the real adapters and AI mode `unavailable`, the pilot default. Nothing else leaks into it.
const CHILD_ONLY_PREFIXES = ["WORKPULSE_AI_", "WORKPULSE_OPENAI_", "WORKPULSE_DOCX_", "WORKPULSE_GOTENBERG_", "WORKPULSE_PDF_", "WORKPULSE_SCANNER_", "WORKPULSE_CLAMD_"];
function workerEnv(): NodeJS.ProcessEnv {
  config();
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!CHILD_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: "test",
    WORKPULSE_AI_MODE: "unavailable",
    WORKPULSE_SCANNER_MODE: "clamav",
    WORKPULSE_CLAMD_HOST: CLAMD.host,
    WORKPULSE_CLAMD_PORT: CLAMD.port,
    WORKPULSE_DOCX_RENDERER_MODE: "gotenberg",
    WORKPULSE_GOTENBERG_URL: DOCX_RENDERER_URL,
    WORKPULSE_PDF_RENDERER_MODE: "gotenberg",
    WORKPULSE_PDF_GOTENBERG_URL: PDF_RENDERER_URL,
  });
  return env as NodeJS.ProcessEnv;
}

type WorkerSummary = Record<string, unknown>;
const CLAIM_KEYS = ["scanJobsClaimed", "importJobsClaimed", "exportJobsClaimed", "accountDeletionsClaimed", "aiJobsClaimed", "importCleanupClaimed", "exportCleanupClaimed", "cleanupJobsClaimed"];

function workerOnce(): Promise<{ summary: WorkerSummary; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["workers/run.ts", "--once"], { env: workerEnv(), timeout: 150_000 }, (error, stdout, stderr) => {
      const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
      let summary: WorkerSummary | null = null;
      try { summary = JSON.parse(line) as WorkerSummary; } catch { summary = null; }
      if (summary === null) return reject(new Error(`worker produced no summary${error ? " (process failed)" : ""}`));
      resolve({ summary, output: stdout + stderr });
    });
  });
}

/** Runs the real worker until a pass claims nothing, or until `done` holds; returns every pass's output. */
async function drain(done: () => boolean = () => false, rounds = 12): Promise<{ output: string; summaries: WorkerSummary[] }> {
  let output = "";
  const summaries: WorkerSummary[] = [];
  for (let round = 0; round < rounds; round += 1) {
    const pass = await workerOnce();
    output += pass.output;
    summaries.push(pass.summary);
    expect(pass.summary["docxRenderer"], "the journey never uses the fake DOCX renderer").toBeUndefined();
    expect(pass.summary["pdfRenderer"], "the journey never uses the fake PDF renderer").toBeUndefined();
    if (done()) break;
    const claimed = CLAIM_KEYS.reduce((sum, key) => sum + (Number(pass.summary[key]) || 0), 0);
    if (claimed === 0) break;
  }
  return { output, summaries };
}

async function requireRealServices(): Promise<void> {
  await requireRealRenderer();
  const gotenberg = await fetch(`${DOCX_RENDERER_URL}/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!gotenberg?.ok) throw new Error("Gotenberg for DOCX page counts is not reachable on 127.0.0.1:13400; the gate never falls back to the fake renderer");
  const clamd = execFileSync("docker", ["exec", "workpulse-t10-clamav", "clamdscan", "--version"], { stdio: "pipe", encoding: "utf8" });
  if (!/ClamAV/.test(clamd)) throw new Error("ClamAV is not running in workpulse-t10-clamav");
}

/** Move focus with Tab only; the target must show a visible focus indicator. */
async function tabTo(page: Page, target: Locator, limit = 200): Promise<void> {
  await target.waitFor({ state: "visible" });
  const handle = await target.elementHandle();
  if (!handle) throw new Error("Keyboard target disappeared.");
  for (let index = 0; index < limit; index += 1) {
    if (await handle.evaluate((element) => element === document.activeElement)) {
      expect(await handle.evaluate((element) => element.matches(":focus-visible")), "keyboard focus must be visible").toBe(true);
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard traversal did not reach the target control.");
}

/** A hydrated page is needed before a key press (a click is retried, a key press is not). */
async function press(page: Page, target: Locator, key = "Enter"): Promise<void> {
  await page.waitForLoadState("networkidle");
  await target.focus();
  await page.keyboard.press(key);
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  const size = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
    return {
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
      dialog: dialog ? dialog.scrollWidth > dialog.clientWidth : false,
    };
  });
  expect(size.scroll, `${label} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
  expect(size.dialog, `${label} dialog should not overflow horizontally`).toBe(false);
}

async function snapshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expectNoWcagViolations(page, testInfo, name);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.context().addCookies([{ name: "wp-theme", value: theme, url: ORIGIN }]);
}

interface MailSummary { ID: string; Subject: string; To: { Address?: string; Email?: string }[] }

/**
 * Opens the confirmation link from the local mail sink. Local Auth only allows redirects to port 3000, so the link's
 * path and token are opened on the gate port, from an opaque-origin page as a mail client would.
 */
async function confirmFromMail(request: APIRequestContext, page: Page, email: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let message: MailSummary | undefined;
  while (Date.now() < deadline && !message) {
    const response = await request.get(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=50`);
    if (response.ok()) {
      const list = await response.json() as { messages?: MailSummary[] };
      message = list.messages?.find((item) => /confirm/i.test(item.Subject)
        && item.To.some((to) => (to.Address ?? to.Email ?? "").toLowerCase() === email.toLowerCase()));
    }
    if (!message) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  expect(message, "a local confirmation email arrives").toBeTruthy();
  const detail = await (await request.get(`${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent(message!.ID)}`)).json() as { HTML?: string; Text?: string };
  const body = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`;
  const raw = [...body.matchAll(/href\s*=\s*["']([^"']*\/auth\/confirm[^"']*)["']/gi)].map((match) => match[1])[0];
  expect(raw, "the email links to the WorkPulse confirmation route").toBeTruthy();
  const link = new URL(raw!.replaceAll("&amp;", "&").replaceAll("&#38;", "&").replaceAll("&#x3D;", "="), ORIGIN);
  expect(link.pathname).toBe("/auth/confirm");
  expect(link.searchParams.has("token_hash")).toBe(true);
  const target = `${ORIGIN}${link.pathname}${link.search}`;
  await page.goto(`data:text/html,<a href="${encodeURIComponent(target)}">open</a>`);
  await page.getByRole("link", { name: "open" }).click();
}

async function pdfText(bytes: Uint8Array): Promise<{ pageCount: number; text: string }> {
  expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await task.promise;
    let text = "";
    for (let number = 1; number <= document.numPages; number += 1) {
      const content = await (await document.getPage(number)).getTextContent();
      text += ` ${(content.items as { str?: string }[]).map((item) => item.str ?? "").join(" ")}`;
    }
    return { pageCount: document.numPages, text: norm(text) };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// Every table of the public schema that carries user_id, read from the catalog so a new table is counted too.
function ownedRowCounts(userId: string): Record<string, number> {
  const tables = sql(
    "select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name " +
    "where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE' order by 1",
  ).split("\n").filter(Boolean);
  const counts: Record<string, number> = {};
  for (const table of tables) counts[`public.${table}`] = count(`select count(*) from public.${table} where user_id = '${userId}'::uuid`);
  counts["public.profiles"] = count(`select count(*) from public.profiles where id = '${userId}'::uuid`);
  counts["auth.users"] = count(`select count(*) from auth.users where id = '${userId}'::uuid`);
  for (const table of ["ai_usage", "ai_plan_assignments", "product_events", "pilot_participants"]) {
    counts[`internal.${table}`] = count(`select count(*) from internal.${table} where user_id = '${userId}'::uuid`);
  }
  for (const category of ["evidence", "import", "export"]) {
    counts[`storage:${category}`] = count(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${userId}/${category}/')`);
  }
  counts["storage:all"] = count(`select count(*) from storage.objects where bucket_id = '${BUCKET}' and starts_with(name, '${userId}/')`);
  return counts;
}

function health(): Record<string, number> {
  const rows = sql("select metric || '=' || value from public.get_operational_health()").split("\n").filter(Boolean);
  return Object.fromEntries(rows.map((row) => { const [key, value] = row.split("="); return [key!, Number(value)]; }));
}

// Synthetic Indonesian CV for a fictional person. The two jobs overlap (2021 to now, 2020 to 2022).
const SUFFIX = randomUUID().slice(0, 8);
const CV_ORGANIZATION = `PT Gudang Fiktif Nusantara ${SUFFIX}`;
const CV_LINES = [
  "Sari Rekaan",
  "Analis Operasional",
  "sari.rekaan@contoh.test",
  "Ringkasan",
  "Analis operasional dengan pengalaman mengelola gudang dan laporan harian.",
  "Pengalaman Kerja",
  "Kepala Gudang",
  CV_ORGANIZATION,
  "Maret 2021 s/d sekarang",
  "• Menata ulang tata letak gudang",
  "Konsultan Lepas, CV Rekaan Mandiri, 2020 sampai 2022",
  "Pendidikan",
  "S1, Teknik Industri, Universitas Rekaan Jaya",
  "2015 - 2019",
  "Keahlian",
  "• Excel • SQL",
];

test("M5 pilot journey: sign up → onboarding (id) → import without AI → capture with AI unavailable → confirm → evidence → CV → PDF → account deletion → sign-in refused", async ({ page, browser, request }, testInfo) => {
  const { url, secretKey } = config();
  const admin: Client = createClient<Database>(url, secretKey, options);
  const aiVariables = Object.keys(process.env).filter((key) => /(^|_)(AI|OPENAI|ANTHROPIC|GEMINI|LLM)(_|$)/i.test(key));
  expect(aiVariables, "the gate journey must run without AI configuration").toEqual([]);
  await requireRealServices();

  const email = `m5-journey-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const displayName = `Sari Rekaan ${SUFFIX}`;
  const noteSentinel = `WP-M5-NOTE-SENTINEL-${SUFFIX}`;
  const note = `Merapikan laporan stok harian gudang ${noteSentinel}`;
  const editedNote = `Merapikan laporan stok harian dan mingguan gudang ${noteSentinel}`;
  const cvFileName = `cv-sari-${SUFFIX}-WP-M5-FILENAME.docx`;
  const evidenceName = `bukti-${SUFFIX}-WP-M5-EVIDENCE.pdf`;
  const achievementTitle = `Laporan stok harian ${SUFFIX}`;
  const cvBullet = `Menyusun laporan stok harian senilai Rp1,5 miliar “tepat waktu” ${SUFFIX}`;
  const localTitle = `Laporan stok harian (versi saya) ${SUFFIX}`;
  const errors: string[] = [];
  const browserLog: string[] = [];
  page.on("pageerror", (error) => errors.push(`${new URL(page.url()).pathname} :: ${String(error).split("\n")[0]}`));
  page.on("console", (message) => browserLog.push(message.text()));
  let userId = "";
  const workerOutput: string[] = [];

  try {
    // 1. Sign up through the UI, confirm from the local mail sink, onboarding with a display name and Bahasa Indonesia.
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    const signUpForm = page.locator("form").filter({ has: page.getByLabel("Email address") });
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await signUpForm.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Check your inbox");
    await confirmFromMail(request, page, email);
    await expect(page).toHaveURL(/\/onboarding\/import$/);
    userId = sql(`select id from auth.users where email = '${email}'`);
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    // Operator action, not the user: the account gets an explicit free plan so the purge has a row to remove.
    sql(`insert into internal.ai_plan_assignments (user_id, plan) values ('${userId}'::uuid, 'free')`);

    await press(page, page.getByRole("link", { name: "Start manually", exact: true }));
    await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
    await page.getByLabel("Display name").fill(displayName);
    await page.locator("#onboarding-locale").selectOption("id");
    await page.getByLabel("Time zone").fill("Asia/Jakarta");
    await press(page, page.getByRole("button", { name: "Continue to dashboard", exact: true }));
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    expect(sql(`select locale || '|' || (onboarding_completed_at is not null) || '|' || coalesce(ai_consent_version, 'none') from public.profiles where id = '${userId}'::uuid`)).toBe("id|true|none");

    // 2. S02 at 360 px dark: the neutral choice, Read without AI with the keyboard, then real ClamAV and Gotenberg.
    await page.setViewportSize({ width: 360, height: 800 });
    await setTheme(page, "dark");
    await page.goto("/onboarding/import");
    const dropzone = page.getByRole("button", { name: "File CV. Tekan Enter atau Spasi untuk memilih file." });
    await page.waitForLoadState("networkidle");
    await dropzone.focus();
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({ name: cvFileName, mimeType: DOCX_MIME, buffer: cvDocx(CV_LINES) });
    await press(page, page.getByRole("button", { name: "Unggah dan ekstrak", exact: true }));
    const modeDialog = page.getByRole("dialog", { name: "Bagaimana CV Anda dibaca?" });
    await expect(modeDialog).toBeVisible();
    await expect(modeDialog.getByRole("heading", { name: "Bagaimana CV Anda dibaca?" })).toBeFocused();
    await expectNoOverflow(page, "S02 mode dialog 360 dark");
    await snapshot(page, testInfo, "m5-s02-mode-dialog-360-dark");
    await tabTo(page, modeDialog.getByRole("button", { name: "Baca tanpa AI", exact: true }), 6);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText("Menunggu dimulai");
    const batch = sql(`select id || '|' || extraction_mode from public.import_batches where user_id = '${userId}'::uuid`);
    expect(batch).toMatch(/\|rules$/);
    const batchId = batch.split("|")[0]!;

    const importDrain = await drain();
    workerOutput.push(importDrain.output);
    expect(importDrain.summaries.some((summary) => Number(summary["importJobsClaimed"]) > 0)).toBe(true);
    await expect(page.getByRole("status")).toHaveText("Ekstraksi selesai", { timeout: 30_000 });
    await expect(page.getByText("Data ini dibaca tanpa AI. Cek nama perusahaan, jabatan, dan tanggal sebelum mengonfirmasi.")).toBeVisible();
    // The neutral S02 disclosure is expected (T26); no consent dialog may appear on this path.
    await expect(page.getByRole("dialog", { name: "Izinkan pemrosesan AI?" })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "light");

    await press(page, page.getByRole("link", { name: "Tinjau kandidat", exact: true }));
    await expect(page.getByRole("heading", { name: "Tinjau data hasil impor", level: 1 })).toBeVisible();
    const head = page.locator("article.import-candidate").filter({ hasText: "Kepala Gudang" });
    const consultant = page.locator("article.import-candidate").filter({ hasText: "Konsultan Lepas" });
    await expect(head.getByLabel("Peran")).toHaveValue("Kepala Gudang");
    await expect(consultant.getByLabel("Peran")).toHaveValue("Konsultan Lepas");
    for (const card of [head, consultant]) {
      await card.getByLabel("Jenis").selectOption("employment");
    }
    await consultant.getByLabel("Peran").fill("Konsultan Operasional Lepas");
    for (const card of [head, consultant]) {
      await press(page, card.getByRole("button", { name: "Simpan perubahan", exact: true }));
      await expect(card.locator(".import-persistence")).toHaveText("Tersimpan");
    }
    await snapshot(page, testInfo, "m5-s03-review");
    const confirmImport = page.getByRole("button", { name: /^Konfirmasi impor$/ });
    await expect(confirmImport).toBeEnabled();
    await page.waitForLoadState("networkidle");
    await confirmImport.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter").catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Impor disimpan" })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Impor disimpan" })).toBeVisible();
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Impor disimpan" })).toBeVisible();

    const experiences = sql(`select role_title || '|' || organization || '|' || kind from public.experiences where user_id = '${userId}'::uuid order by role_title`).split("\n");
    expect(experiences).toEqual([`Kepala Gudang|${CV_ORGANIZATION}|employment`, "Konsultan Operasional Lepas|CV Rekaan Mandiri|employment"]);
    expect(sql(`select status from public.import_batches where id = '${batchId}'::uuid`)).toBe("committed");
    expect(count(`select count(*) from public.ai_jobs where user_id = '${userId}'::uuid`), "rules import creates no AI job").toBe(0);
    expect(count(`select count(*) from internal.ai_usage where user_id = '${userId}'::uuid`), "rules import charges no AI unit").toBe(0);
    expect(sql(`select coalesce(ai_consent_version, 'none') from public.profiles where id = '${userId}'::uuid`)).toBe("none");
    await page.goto("/timeline");
    await expect(page.getByText("Kepala Gudang", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Konsultan Operasional Lepas", { exact: true })).toHaveCount(1);

    // 3. Quick log, then analysis with AI unavailable (the pilot default): the manual path stays, an edit makes the
    //    old result stale and nothing overwrites the newer note.
    await page.goto("/dashboard");
    await press(page, page.locator(".workspace-topbar").getByRole("link", { name: "Catatan cepat", exact: true }));
    await expect(page).toHaveURL(/\/activity\/new/);
    await expect(page.locator("#quick-log-note")).toBeFocused();
    await page.keyboard.type(note);
    await press(page, page.locator("#quick-log-note-form button[type='submit']"));
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
    const activityId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const panel = page.getByTestId("ai-analysis-panel");
    await press(page, panel.getByRole("button", { name: "Analisis dengan AI", exact: true }));
    const consentDialog = page.getByRole("dialog", { name: "Izinkan pemrosesan AI?" });
    await expect(consentDialog).toBeVisible();
    await press(page, consentDialog.getByRole("button", { name: "Izinkan AI", exact: true }));
    await expect(panel).toContainText(/Menunggu dimulai|Menganalisis/);
    expect(count(`select count(*) from public.ai_jobs where user_id = '${userId}'::uuid and kind = 'detect'`)).toBe(1);
    expect(count(`select coalesce(sum(units), 0) from internal.ai_usage where user_id = '${userId}'::uuid and bucket = 'analysis'`), "analysis charges its unit in the job transaction").toBeGreaterThan(0);

    const aiDrain = await drain(() => sql(`select status from public.ai_jobs where user_id = '${userId}'::uuid`) === "failed");
    workerOutput.push(aiDrain.output);
    await page.reload();
    await expect(panel).toContainText("Analisis tidak selesai");
    await expect(panel).toContainText("Layanan AI sedang tidak tersedia.");
    const manual = panel.getByRole("link", { name: "Buat pencapaian secara manual", exact: true });
    await expect(manual).toBeVisible();
    await snapshot(page, testInfo, "m5-s06-ai-unavailable");

    await press(page, page.getByRole("button", { name: "Edit aktivitas", exact: true }));
    await page.locator("textarea[name='raw_text']").fill(editedNote);
    await press(page, page.getByRole("button", { name: "Simpan perubahan", exact: true }));
    await expect(page.locator(".activity-detail-source").first()).toHaveText(editedNote);
    await expect(panel).toContainText("Aktivitas ini berubah setelah analisis. Saran sebelumnya tidak lagi berlaku.");
    await expect(panel.getByRole("button", { name: "Coba lagi", exact: true })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Analisis lagi", exact: true })).toBeVisible();
    expect(sql(`select raw_text from public.activities where id = '${activityId}'::uuid`)).toBe(editedNote);
    expect(sql(`select (job.input_revision < activity.revision)::text from public.ai_jobs job join public.activities activity on activity.id = job.activity_id where job.user_id = '${userId}'::uuid`)).toBe("true");

    // Retry after the edit: a new job for the new revision; it fails again and the note keeps the user's text.
    await press(page, panel.getByRole("button", { name: "Analisis lagi", exact: true }));
    await expect(panel).toContainText(/Menunggu dimulai|Menganalisis/);
    const retryDrain = await drain(() => count(`select count(*) from public.ai_jobs where user_id = '${userId}'::uuid and status = 'failed'`) === 2);
    workerOutput.push(retryDrain.output);
    expect(sql(`select string_agg(job.status || ':' || (job.input_revision = activity.revision)::text, ',' order by job.created_at) from public.ai_jobs job join public.activities activity on activity.id = job.activity_id where job.user_id = '${userId}'::uuid`)).toBe("failed:false,failed:true");
    await page.reload();
    await expect(panel).toContainText("Layanan AI sedang tidak tersedia.");
    expect(sql(`select raw_text from public.activities where id = '${activityId}'::uuid`)).toBe(editedNote);

    // 4. Manual Achievement from the S06 link, confirm, a forced failed save keeps the form, then real ClamAV evidence.
    await page.reload();
    await press(page, page.getByTestId("ai-analysis-panel").getByRole("link", { name: "Buat pencapaian secara manual", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await press(page, page.getByRole("button", { name: "Pencapaian baru", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
    await page.waitForLoadState("networkidle");
    const achievementId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await page.getByLabel("Judul", { exact: true }).fill(achievementTitle);
    await page.getByLabel("Kontribusi", { exact: true }).fill("Menyusun ulang format laporan stok harian gudang");
    await page.getByLabel("Hasil", { exact: true }).fill("Laporan stok siap setiap pagi sebelum pukul delapan");
    await page.getByLabel("Tanggal tercapai", { exact: true }).fill("2026-10-15");
    await page.locator('textarea[name="cv_bullet"]').fill(cvBullet);
    await press(page, page.getByRole("button", { name: "Konfirmasi Pencapaian", exact: true }));
    await expect(page.getByText("Pencapaian dikonfirmasi dan siap dipilih untuk CV di masa depan.", { exact: true }).first()).toBeVisible();
    expect(sql(`select status from public.achievements where id = '${achievementId}'::uuid`)).toBe("confirmed");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Judul", { exact: true }).fill(localTitle);
    // A save in another session moves the revision first; the browser keeps its own edit.
    const revisionBefore = Number(sql(`select revision from public.achievements where id = '${achievementId}'::uuid`));
    sql(`update public.achievements set contribution = contribution || ' (tab lain)', revision = revision + 1 where id = '${achievementId}'::uuid`);
    expect(Number(sql(`select revision from public.achievements where id = '${achievementId}'::uuid`))).toBeGreaterThan(revisionBefore);
    await press(page, page.getByRole("button", { name: "Simpan perubahan", exact: true }));
    await expect(page.getByText("Pencapaian ini berubah di server", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Judul", { exact: true })).toHaveValue(localTitle);
    const conflictShot = testInfo.outputPath("m5-s08-conflict.png");
    await page.screenshot({ path: conflictShot, fullPage: true });
    await testInfo.attach("m5-s08-conflict", { path: conflictShot, contentType: "image/png" });
    await press(page, page.getByRole("button", { name: "Tinjau dan coba simpan perubahan saya", exact: true }));
    await expect.poll(() => sql(`select title from public.achievements where id = '${achievementId}'::uuid`)).toBe(localTitle);
    expect(sql(`select status from public.achievements where id = '${achievementId}'::uuid`)).toBe("confirmed");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Memuat bukti…", { exact: true })).toHaveCount(0);
    await page.getByLabel("Pilih file bukti").setInputFiles({ name: evidenceName, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.7\nM5 bukti ${SUFFIX}\n%%EOF\n`) });
    const evidenceRow = page.locator(".evidence-item").filter({ hasText: evidenceName });
    await expect(evidenceRow.getByText("Pemeriksaan keamanan berlangsung", { exact: true })).toBeVisible();
    const evidenceDrain = await drain(() => sql(`select status from public.evidence_files where user_id = '${userId}'::uuid`) === "ready");
    workerOutput.push(evidenceDrain.output);
    await expect(async () => {
      if (!(await evidenceRow.getByText("Siap", { exact: true }).isVisible())) {
        await page.getByRole("button", { name: "Segarkan bukti", exact: true }).click();
      }
      await expect(evidenceRow.getByText("Siap", { exact: true })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // 5. S13 selection and Save, S14 export with the real renderer, Download PDF.
    const headExperienceId = sql(`select id from public.experiences where user_id = '${userId}'::uuid and role_title = 'Kepala Gudang'`);
    await page.goto("/cv");
    for (const id of [achievementId, headExperienceId]) {
      const add = page.locator(`#cv-add-${id}`);
      await press(page, add);
      await expect(add).toHaveAttribute("aria-disabled", "true");
    }
    await page.locator("#cv-locale").selectOption("id");
    await press(page, page.getByRole("button", { name: "Simpan perubahan", exact: true }));
    await expect(page.locator(".cv-save-status")).toContainText("Semua perubahan tersimpan");
    await press(page, page.getByTestId("cv-preview-export-link"));
    await expect(page).toHaveURL(/\/cv\/preview$/);
    await expect(page.getByTestId("cv-export-blockers")).toHaveCount(0);
    await press(page, page.locator('[data-testid="cv-export-export"], [data-testid="cv-export-regenerate"]'));
    await expect(page.getByTestId("cv-export-status")).toContainText("Menunggu giliran");
    const exportDrain = await drain(() => sql(`select status from public.cv_exports where user_id = '${userId}'::uuid`) === "succeeded");
    workerOutput.push(exportDrain.output);
    await expect(page.getByTestId("cv-export-status")).toContainText("PDF siap", { timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => { await page.getByTestId("cv-export-download").focus(); await page.keyboard.press("Enter"); })(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^WorkPulse-CV-\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = await pdfText(new Uint8Array(readFileSync((await download.path())!)));
    const cvName = sql(`select display_name from public.profiles where id = '${userId}'::uuid`);
    for (const expected of [cvName, "Kepala Gudang", CV_ORGANIZATION, cvBullet]) {
      expect(pdf.text, `the PDF carries ${expected}`).toContain(norm(expected));
    }
    for (const forbidden of [evidenceName, cvFileName, noteSentinel, "workpulse-private"]) {
      expect(pdf.text, `the PDF must not carry ${forbidden}`).not.toContain(forbidden);
    }
    testInfo.annotations.push({ type: "pdf", description: `pages=${pdf.pageCount}` });

    // 6. Product events: the expected names, allowlisted properties only, no private text.
    const events = sql(`select event_name || '|' || properties::text from internal.product_events where user_id = '${userId}'::uuid order by occurred_at`).split("\n").filter(Boolean);
    const names = new Set(events.map((row) => row.split("|")[0]));
    for (const name of ["import_committed", "career_record_created", "activity_saved", "achievement_confirmed", "cv_export_finished"]) {
      expect(names.has(name), `event ${name} is recorded`).toBe(true);
    }
    const eventText = events.join("\n");
    for (const secret of [noteSentinel, cvFileName, evidenceName, CV_ORGANIZATION, displayName, email, userId, activityId, achievementId, batchId]) {
      expect(eventText.includes(secret), `events must not carry ${secret}`).toBe(false);
    }

    // 7. S12: Axe and 360 px dark on the dialog, then deletion with password and email; a second signed-in tab loses access.
    const second = await browser.newContext({ baseURL: ORIGIN });
    const secondPage = await second.newPage();
    await secondPage.goto("/sign-in");
    await secondPage.locator('input[type="email"]').fill(email);
    await secondPage.locator('input[type="password"]').first().fill(password);
    await secondPage.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
    await expect(secondPage).toHaveURL(/\/dashboard$/);

    await page.setViewportSize({ width: 360, height: 800 });
    await setTheme(page, "dark");
    await page.goto("/settings/profile");
    await expect(page.getByRole("heading", { name: "Privasi dan akun", level: 2 })).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Hapus akun Anda secara permanen?" });
    await press(page, page.getByRole("button", { name: "Hapus akun", exact: true }));
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Kata sandi saat ini")).toBeFocused();
    await expectNoOverflow(page, "S12 deletion dialog 360 dark");
    await snapshot(page, testInfo, "m5-s12-delete-360-dark");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 1440, height: 900 });
    await setTheme(page, "light");
    await page.reload();

    const before = ownedRowCounts(userId);
    testInfo.annotations.push({ type: "rows-before-purge", description: JSON.stringify(before) });
    process.stdout.write(`M5-ROWS before ${JSON.stringify(before)}\n`);
    for (const key of ["public.activities", "public.achievements", "public.experiences", "public.import_batches", "public.ai_jobs", "public.evidence_files", "public.cv_exports", "internal.ai_usage", "internal.ai_plan_assignments", "internal.product_events", "storage:evidence", "storage:export"]) {
      expect(before[key], `${key} has rows before the deletion`).toBeGreaterThan(0);
    }
    const healthBefore = health();

    await press(page, page.getByRole("button", { name: "Hapus akun", exact: true }));
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Kata sandi saat ini").fill(password);
    await dialog.getByLabel("Ketik email akun Anda untuk konfirmasi").fill(email);
    await expectNoWcagViolations(page, testInfo, "m5-s12-delete-ready");
    await press(page, dialog.getByRole("button", { name: "Hapus akun secara permanen", exact: true }));
    await expect(page).toHaveURL(/\/sign-in\?notice=accountDeleted$/);
    await expect(page.getByText(/Akun Anda sedang dihapus\. Anda keluar dari semua perangkat\.|Your account is being deleted\. You are signed out on every device\./)).toBeVisible();
    await secondPage.goto("/activity");
    await expect(secondPage).toHaveURL(/\/sign-in/);
    await second.close();

    const purge = await drain(() => sql(`select coalesce((select status from internal.account_deletions where user_id = '${userId}'::uuid), 'none')`) === "completed");
    workerOutput.push(purge.output);
    expect(sql(`select status from internal.account_deletions where user_id = '${userId}'::uuid`)).toBe("completed");

    await page.goto("/sign-in");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
    await expect(page.getByText(/^(Email or password is incorrect\.|Email atau kata sandi salah\.)$/)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    // 8. After the purge every row, counter, event and object of the account is gone, and health has no backlog from it.
    const after = ownedRowCounts(userId);
    testInfo.annotations.push({ type: "rows-after-purge", description: JSON.stringify(after) });
    process.stdout.write(`M5-ROWS after ${JSON.stringify(after)}\n`);
    for (const [key, value] of Object.entries(after)) expect(value, `${key} after the purge`).toBe(0);
    const healthAfter = health();
    expect(healthAfter["account_deletion_overdue"], "no overdue deletion added").toBeLessThanOrEqual(healthBefore["account_deletion_overdue"]!);
    expect(healthAfter["storage_cleanup_failed"], "no failed cleanup added").toBeLessThanOrEqual(healthBefore["storage_cleanup_failed"]!);
    expect(count(`select count(*) from internal.storage_jobs where status in ('queued', 'running', 'failed') and starts_with(object_key, '${userId}/')`), "no open cleanup job for the account").toBe(0);

    // Private text never reaches worker output or the browser console.
    const logs = `${workerOutput.join("\n")}\n${browserLog.join("\n")}`;
    for (const secret of [noteSentinel, cvFileName, evidenceName, CV_ORGANIZATION, email]) {
      expect(logs.includes(secret), `logs must not carry ${secret}`).toBe(false);
    }
    expect(errors, "no uncaught page errors").toEqual([]);
  } finally {
    if (userId && sql(`select count(*) from public.profiles where id = '${userId}'::uuid`) === "1") {
      if (sql(`select count(*) from internal.account_deletions where user_id = '${userId}'::uuid`) === "0") {
        await admin.rpc("begin_account_deletion", { p_user_id: userId });
      }
      await drain(() => sql(`select coalesce((select status from internal.account_deletions where user_id = '${userId}'::uuid), 'none')`) === "completed").catch(() => undefined);
    }
    if (userId) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
});
