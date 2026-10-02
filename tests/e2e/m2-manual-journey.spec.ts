import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { formatActivityDate } from "../../src/domain/activity/activity-display";
import { resolveMalwareScanner } from "../../src/server/storage/malware-scanner";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker";
import { expectNoWcagViolations } from "./helpers/accessibility";

// Gate M2 (docs/verification/M2-gate-review-plan.md §5 Fase 3): one user runs F02→F06 through the UI
// against local Supabase, private Storage and real ClamAV. Only account creation and worker drain
// bypass the UI. The browser clock runs in UTC-11 while the profile uses UTC+14, so the two calendar
// dates always differ and the capture default must come from the profile timezone.
const ORIGIN = "http://127.0.0.1:3006";
const BROWSER_TIMEZONE = "Pacific/Pago_Pago";
const PROFILE_TIMEZONE = "Pacific/Kiritimati";
const AI_CLAIM = /analy[sz]|menganalisis|AI suggestion|saran AI/i;
// Copy that explicitly states AI is not running is allowed (handoff §5 Fase 3 langkah 10).
const AI_DISCLAIMERS = [/will not be analyzed now\.?/gi, /works without AI\.?/gi, /tetap berfungsi tanpa AI\.?/gi];

test.use({ timezoneId: BROWSER_TIMEZONE, locale: "en-US" });

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };

function config(): { url: string; publicKey: string; secretKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !publicKey || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, publicKey, secretKey };
}

function client(url: string, key: string): Client {
  return createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
}

async function createUser(admin: Client, label: string, completeOnboarding: boolean): Promise<User> {
  const email = `m2-journey-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`M2 journey fixture failed: ${label} user`);
  if (completeOnboarding) {
    const profile = await admin.from("profiles").update({
      display_name: `M2 ${label}`, locale: "en", timezone: "Asia/Jakarta", onboarding_completed_at: new Date().toISOString(),
    }).eq("id", id);
    if (profile.error) throw new Error(`M2 journey fixture failed: ${label} profile`);
  }
  return { id, email, password };
}

function dateInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  for (let index = 0; index < 160; index += 1) {
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

async function expectAiFree(page: Page, label: string): Promise<void> {
  let text = await page.locator("body").innerText();
  for (const disclaimer of AI_DISCLAIMERS) text = text.replace(disclaimer, "");
  expect(text.match(AI_CLAIM), `${label} must not claim AI analysis or suggestions`).toBeNull();
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll, `${label} should not overflow horizontally`).toBeLessThanOrEqual(size.width);
}

async function attach(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function uploadEvidence(page: Page, filename: string, bytes: Buffer): Promise<string> {
  // The attachment control is a client component: wait for hydration and its first list load.
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Loading evidence…", { exact: true })).toHaveCount(0);
  const reserved = page.waitForResponse((response) => response.url() === `${ORIGIN}/api/evidence` && response.request().method() === "POST");
  await page.getByLabel("Choose an evidence file").setInputFiles({ name: filename, mimeType: "application/pdf", buffer: bytes });
  const reservation = await reserved;
  expect(reservation.status()).toBe(200);
  const body = await reservation.json() as { id: string };
  await expect(page.locator(".evidence-item").filter({ hasText: filename }).getByText("Security check in progress", { exact: true })).toBeVisible();
  await expect(page.getByText("Upload received. The file will be available after its security check.", { exact: true })).toBeVisible();
  return body.id;
}

async function waitForReady(page: Page, filename: string): Promise<void> {
  const row = page.locator(".evidence-item").filter({ hasText: filename });
  await expect(async () => {
    if (!(await row.getByText("Ready", { exact: true }).isVisible())) {
      await page.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    }
    await expect(row.getByText("Ready", { exact: true })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test("M2 manual journey: note → project → achievement → private evidence → dashboard → timeline, without AI", async ({ page, browser }, testInfo) => {
  const values = config();
  const admin = client(values.url, values.secretKey);
  const gateway = createSupabaseEvidenceWorkerGateway({ url: values.url, secretKey: values.secretKey });
  const scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
  const drain = async () => {
    for (let pass = 0; pass < 100; pass += 1) {
      const summary = await runEvidenceWorkerOnce({ ...gateway, scanner });
      if (!summary.scanJobsClaimed && !summary.cleanupJobsClaimed) return;
    }
  };
  const aiVariables = Object.keys(process.env).filter((key) => /(^|_)(AI|OPENAI|ANTHROPIC|GEMINI|LLM)(_|$)/i.test(key));
  expect(aiVariables, "the gate journey must run without AI configuration").toEqual([]);

  const users: User[] = [];
  const suffix = randomUUID().slice(0, 8);
  const note = `M2 graduate note ${suffix}: prepared the capstone demo\nwith keyboard only`;
  const projectTitle = `M2 Capstone ${suffix}`;
  const achievementTitle = `M2 Capstone demo ${suffix}`;
  const secondTitle = `M2 Project follow-up ${suffix}`;
  const role = `M2 Teaching assistant ${suffix}`;
  const organization = `M2 University ${suffix}`;
  const proof = Buffer.from(`%PDF-1.7\nM2 gate proof ${suffix}\n%%EOF\n`);
  const activityProof = Buffer.from(`%PDF-1.7\nM2 activity proof ${suffix}\n%%EOF\n`);

  try {
    const graduate = await createUser(admin, "graduate", false);
    users.push(graduate);
    const other = await createUser(admin, "other", true);
    users.push(other);

    // 1. Graduate without CV or employment: display name only, then an empty dashboard.
    await signIn(page, graduate);
    await expect(page).toHaveURL(/\/onboarding\/import$/);
    // T15 replaced the "Import CV · not available yet" placeholder with the real S02; the manual path is unchanged
    // and nothing is uploaded or sent to AI unless the user chooses a file and uploads it.
    await expect(page.getByRole("button", { name: "Upload and extract", exact: true })).toBeDisabled();
    await expectAiFree(page, "onboarding import");
    await page.getByRole("link", { name: "Start manually", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
    await page.getByLabel("Display name").fill(`M2 Graduate ${suffix}`);
    await page.getByLabel("Time zone").fill(PROFILE_TIMEZONE);
    await page.getByRole("button", { name: "Continue to dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator(".dashboard-stat-card")).toHaveCount(0);
    // T17: the empty dashboard now links to S02 (it was a disabled placeholder before).
    await expect(page.getByRole("link", { name: "Import CV" })).toHaveAttribute("href", "/onboarding/import");
    await expectAiFree(page, "empty dashboard");
    await page.getByRole("link", { name: "Add your first activity", exact: true }).click();
    await expect(page).toHaveURL(/\/activity\/new$/);
    await expect(page.locator("#quick-log-note")).toBeFocused();

    // 2. F02 capture from Quick log, keyboard only. Success appears only after the commit returns.
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await keyboardPress(page, page.locator(".workspace-topbar").getByRole("link", { name: "Quick log", exact: true }));
    await expect(page).toHaveURL(/\/activity\/new/);
    const noteField = page.locator("#quick-log-note");
    await expect(noteField).toBeFocused();
    const expectedDate = dateInZone(PROFILE_TIMEZONE);
    expect(expectedDate, "fixture timezones must disagree on the calendar date").not.toBe(dateInZone(BROWSER_TIMEZONE));
    await expect(page.locator('[name="occurred_on"]')).toHaveValue(expectedDate);
    await page.keyboard.type(note);
    await expectAiFree(page, "capture");
    const captureRoute = (url: URL) => url.pathname === "/activity/new";
    let release: () => void = () => {};
    let fetched = false;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(captureRoute, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      fetched = true;
      await held;
      await route.fulfill({ response });
    });
    const saveButton = page.locator("#quick-log-note-form button[type='submit']");
    await tabTo(page, saveButton);
    const saving = page.keyboard.press("Enter");
    try {
      await expect.poll(() => fetched, { timeout: 15_000 }).toBe(true);
      await expect(saveButton).toBeDisabled();
      await expect(page.getByText("Activity saved.", { exact: true })).toHaveCount(0);
    } finally {
      release();
    }
    await saving;
    await page.unroute(captureRoute);
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}/i);
    const activityId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await page.reload();
    await expect(page.locator(".activity-detail-source").first()).toHaveJSProperty("textContent", note);
    await page.goto("/activity");
    const activityRow = page.locator(".activity-list-row").filter({ hasText: `M2 graduate note ${suffix}` });
    await expect(activityRow).toHaveCount(1);
    await expect(activityRow).toContainText(formatActivityDate(expectedDate, "en"));
    // Career tables grant no service-role access; read back through the owner's RLS session.
    const ownerRead = client(values.url, values.publicKey);
    const ownerLogin = await ownerRead.auth.signInWithPassword({ email: graduate.email, password: graduate.password });
    if (ownerLogin.error) throw new Error("M2 journey owner read-back sign-in failed.");
    const stored = await ownerRead.from("activities").select("occurred_on, raw_text, analysis_state").eq("id", activityId).single();
    expect(stored.data).toEqual({ occurred_on: expectedDate, raw_text: note, analysis_state: "not_requested" });

    // 3. F04: create an active project from /projects/new and attach the saved activity.
    await page.goto("/projects/new");
    const projectForm = page.locator("#project-create-form");
    await keyboardType(page, projectForm.getByLabel("Title"), projectTitle);
    await tabTo(page, projectForm.locator('[name="status"]'));
    await page.keyboard.type("Active");
    await expect(projectForm.locator('[name="status"]')).toHaveValue("active");
    await tabTo(page, projectForm.locator('[name="start_precision"]'));
    await page.keyboard.type("Month");
    await expect(projectForm.locator('[name="start_precision"]')).toHaveValue("month");
    await keyboardType(page, projectForm.locator('[name="start_year"]'), "2026");
    await keyboardType(page, projectForm.locator('[name="start_month"]'), "9");
    await expectAiFree(page, "project create");
    await keyboardPress(page, projectForm.getByRole("button", { name: "Create project", exact: true }));
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/i);
    const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await keyboardPress(page, page.getByRole("button", { name: "Attach existing activity", exact: true }));
    const attachDialog = page.getByRole("dialog", { name: "Attach existing activity" });
    const candidate = attachDialog.locator(".project-candidate-row").filter({ hasText: `M2 graduate note ${suffix}` });
    await keyboardPress(page, candidate.getByRole("button", { name: "Attach", exact: true }));
    await expect(candidate).toHaveCount(0);
    if (await attachDialog.isVisible()) await page.keyboard.press("Escape");
    await expect(attachDialog).toBeHidden();
    await page.reload();
    await expect(page.getByText("1 linked activity/activities", { exact: true })).toBeVisible();
    await expect(page.getByText(`M2 graduate note ${suffix}`, { exact: false }).first()).toBeVisible();

    // 4. F03: derived achievement from the Activity inherits the project context; confirm without
    //    metrics or evidence, keyboard only.
    await page.goto(`/activity/${activityId}`);
    await keyboardPress(page, page.getByRole("link", { name: "Create Achievement", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await expectAiFree(page, "achievement create");
    await keyboardPress(page, page.getByRole("button", { name: "New Achievement", exact: true }));
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
    await page.waitForLoadState("networkidle");
    const achievementId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expect(page.locator(".achievement-detail-context")).toContainText(`Project: ${projectTitle}`);
    await keyboardType(page, page.getByLabel("Title", { exact: true }), achievementTitle);
    await keyboardType(page, page.getByLabel("Contribution", { exact: true }), "Built and rehearsed the capstone demo");
    await keyboardType(page, page.getByLabel("Outcome", { exact: true }), "The panel accepted the demo without follow-up questions");
    const achievedOn = page.getByLabel("Achieved on", { exact: true });
    // The native date control follows the OS locale segment order; try day-first, then month-first.
    for (const digits of ["20092026", "09202026"]) {
      await tabTo(page, achievedOn);
      await page.keyboard.type(digits);
      if (await achievedOn.inputValue() === "2026-09-20") break;
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
    }
    await expect(achievedOn).toHaveValue("2026-09-20");
    await keyboardType(page, page.getByLabel("Add a skill label", { exact: true }), "Public speaking");
    await keyboardPress(page, page.getByRole("button", { name: "Add skill", exact: true }));
    await expect(page.locator('input[name="skill_names"]')).toHaveValue('["Public speaking"]');
    await expectAiFree(page, "achievement draft");
    await keyboardPress(page, page.getByRole("button", { name: "Confirm Achievement", exact: true }));
    await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
    await expect(page.locator(".achievement-detail-context")).toContainText("Public speaking (1)");
    const confirmed = await ownerRead.from("achievements").select("status, metrics, project_id, activity_id").eq("id", achievementId).single();
    expect(confirmed.data).toEqual({ status: "confirmed", metrics: [], project_id: projectId, activity_id: activityId });

    // 5. Dashboard after confirm: one confirmed, one current project, one skill, one missing-evidence check.
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Confirmed achievements 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Current projects 1" })).toBeVisible();
    await expect(page.locator(".dashboard-stat-card").nth(2).locator("strong")).toHaveText("1");
    await expectAiFree(page, "dashboard");
    await page.getByRole("link", { name: "1 confirmed achievement has no ready evidence." }).click();
    await expect(page).toHaveURL(/\/achievements\?.*evidence=missing/);
    await expect(page.locator(".achievement-list-row")).toHaveCount(1);
    await expect(page.getByText(achievementTitle, { exact: true })).toBeVisible();

    // 6. F05: private evidence on the Achievement is scanned by real ClamAV before it becomes ready.
    await page.goto(`/achievements/${achievementId}`);
    const achievementEvidenceId = await uploadEvidence(page, "m2-proof.pdf", proof);
    await expect(page.locator(".evidence-item").filter({ hasText: "m2-proof.pdf" }).getByRole("button", { name: "Download m2-proof.pdf" })).toHaveCount(0);
    await drain();
    await waitForReady(page, "m2-proof.pdf");
    const signedResponse = page.waitForResponse((response) => response.url() === `${ORIGIN}/api/evidence/${achievementEvidenceId}/download`);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download m2-proof.pdf", exact: true }).click();
    const signed = await (await signedResponse).json() as { url: string; expiresInSeconds: number };
    expect(signed.expiresInSeconds).toBeGreaterThan(0);
    expect(signed.expiresInSeconds).toBeLessThanOrEqual(300);
    expect(new URL(signed.url).pathname).toContain("/storage/v1/object/sign/");
    expect(new URL(signed.url).searchParams.get("token")).toBeTruthy();
    const download = await downloadEvent;
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(proof)).toBe(true);
    await page.goto(`/achievements/${achievementId}`);
    await waitForReady(page, "m2-proof.pdf");
    await expectNoWcagViolations(page, testInfo, "m2-achievement-with-evidence");
    await expectAiFree(page, "achievement with evidence");
    await attach(page, testInfo, "m2-achievement-evidence-1440-light.png");
    await page.goto("/dashboard");
    // T20: a confirmed achievement that is not on the CV is offered as its own CV check, so the list is no longer empty.
    await expect(page.getByRole("link", { name: /confirmed achievements? (is|are) not on your CV/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /confirmed achievements? ha(s|ve) no ready evidence/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /completed projects? ha(s|ve) no outcome/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /confirmed achievements? ha(s|ve) no ready evidence/ })).toHaveCount(0);

    // 7. Activity evidence is not inherited; another confirmed Achievement in the same project still
    //    needs its own direct evidence.
    await page.goto(`/activity/${activityId}`);
    await uploadEvidence(page, "m2-activity.pdf", activityProof);
    await drain();
    await waitForReady(page, "m2-activity.pdf");
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("link", { name: "Create Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/new\?/);
    await page.getByRole("button", { name: "New Achievement", exact: true }).click();
    await expect(page).toHaveURL(/\/achievements\/[0-9a-f-]{36}/i);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(".achievement-detail-context")).toContainText(`Project: ${projectTitle}`);
    await page.getByLabel("Title", { exact: true }).fill(secondTitle);
    await page.getByLabel("Contribution", { exact: true }).fill("Summarised panel feedback for the team");
    await page.getByLabel("Outcome", { exact: true }).fill("The team agreed on the next iteration");
    await page.getByLabel("Achieved on", { exact: true }).fill("2026-09-21");
    await page.getByRole("button", { name: "Confirm Achievement", exact: true }).click();
    await expect(page.getByText("Achievement confirmed and eligible for future CV selection.", { exact: true }).first()).toBeVisible();
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Confirmed achievements 2" })).toBeVisible();
    await page.getByRole("link", { name: "1 confirmed achievement has no ready evidence." }).click();
    await expect(page.locator(".achievement-list-row")).toHaveCount(1);
    await expect(page.getByText(secondTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(achievementTitle, { exact: true })).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page.getByText(/m2-proof\.pdf|m2-activity\.pdf/)).toHaveCount(0);
    await expectNoWcagViolations(page, testInfo, "m2-dashboard");
    await attach(page, testInfo, "m2-dashboard-1440-light.png");

    // 8. F06: timeline events, context, experience from S12 and canonical deep links.
    await page.goto("/timeline");
    const year2026 = page.locator(".timeline-year-group").filter({ has: page.getByRole("heading", { name: "2026", exact: true }) });
    const achievementEvent = year2026.locator(".timeline-event").filter({ has: page.getByRole("link", { name: achievementTitle, exact: true }) });
    await expect(achievementEvent).toContainText(projectTitle);
    const projectEvent = year2026.locator(".timeline-event").filter({ has: page.getByRole("link", { name: projectTitle, exact: true }) });
    await expect(projectEvent.locator(".timeline-event-date")).toHaveText("Started Sep 2026");
    await expect(page.getByText(/m2-proof\.pdf|m2-activity\.pdf/)).toHaveCount(0);
    await expect(page.getByText(`M2 graduate note ${suffix}`, { exact: false })).toHaveCount(0);
    await expectAiFree(page, "timeline");
    await page.goto("/settings/profile");
    const experiences = page.getByRole("heading", { name: "Experience", exact: true }).locator("xpath=ancestor::section[1]");
    const addExperience = experiences.locator(":scope > details").last();
    if (!(await addExperience.evaluate((element) => (element as HTMLDetailsElement).open))) await addExperience.locator("summary").first().click();
    const experienceForm = addExperience.locator("form");
    await experienceForm.locator('[name="organization"]').fill(organization);
    await experienceForm.locator('[name="role_title"]').fill(role);
    await experienceForm.locator('[name="start_precision"]').selectOption("year");
    await experienceForm.locator('[name="start_year"]').fill("2024");
    await experienceForm.getByRole("button", { name: "Save record" }).click();
    await expect(experienceForm.getByRole("status")).toContainText("Record saved.");
    await page.goto("/timeline");
    const experienceEvent = page.locator(".timeline-event").filter({ has: page.getByRole("link", { name: role, exact: true }) });
    await expect(experienceEvent).toContainText(organization);
    await expectNoWcagViolations(page, testInfo, "m2-timeline");
    await attach(page, testInfo, "m2-timeline-1440-light.png");
    await experienceEvent.getByRole("link", { name: role, exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/profile\?record=[0-9a-f-]{36}#experience-[0-9a-f-]{36}/);
    const experienceId = new URL(page.url()).searchParams.get("record") ?? "";
    await expect(page.locator(`#experience-${experienceId}`)).toHaveAttribute("open", "");
    await page.goto("/timeline");
    await page.getByRole("link", { name: achievementTitle, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/achievements/${achievementId}`));
    await page.goto("/timeline");
    await page.getByRole("link", { name: projectTitle, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`));

    // 11. Mobile 360×800 dark pass without horizontal overflow.
    await page.setViewportSize({ width: 360, height: 800 });
    await page.context().addCookies([{ name: "wp-theme", value: "dark", url: ORIGIN }]);
    for (const [label, route] of [["dashboard", "/dashboard"], ["achievement", `/achievements/${achievementId}`], ["timeline", "/timeline"]] as const) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoHorizontalOverflow(page, `${label} 360 dark`);
      await attach(page, testInfo, `m2-${label}-360-dark.png`);
    }
    await expectNoWcagViolations(page, testInfo, "m2-timeline-360-dark");
    await page.setViewportSize({ width: 1440, height: 900 });

    // 9. Isolation: account B cannot read, count or deep-link A's records, and responses match random IDs.
    const context = await browser.newContext({ baseURL: ORIGIN, timezoneId: BROWSER_TIMEZONE, locale: "en-US" });
    const otherPage = await context.newPage();
    try {
      await signIn(otherPage, other);
      await expect(otherPage).toHaveURL(/\/dashboard$/);
      const randomId = randomUUID();
      for (const [kind, id] of [["activity", activityId], ["achievements", achievementId], ["projects", projectId]] as const) {
        await otherPage.goto(`/${kind}/${randomId}`);
        const randomText = await otherPage.locator("main").innerText();
        await otherPage.goto(`/${kind}/${id}`);
        await expect(otherPage.getByRole("heading", { name: "Record unavailable" })).toBeVisible();
        expect(await otherPage.locator("main").innerText(), `${kind} foreign vs random`).toBe(randomText);
      }
      const headers = { origin: ORIGIN };
      const foreign = await context.request.post(`/api/evidence/${achievementEvidenceId}/download`, { headers });
      const random = await context.request.post(`/api/evidence/${randomId}/download`, { headers });
      expect(foreign.status()).toBe(404);
      expect(random.status()).toBe(404);
      expect((await foreign.json() as { code: string }).code).toBe((await random.json() as { code: string }).code);
      expect((await context.request.get(`/api/evidence/${achievementEvidenceId}`)).status()).toBe(404);
      const foreignList = await context.request.get(`/api/evidence?parentKind=achievement&parentId=${achievementId}`);
      expect((await foreignList.json() as { items: unknown[] }).items).toEqual([]);
      for (const route of ["/dashboard", "/timeline", `/achievements?evidence=missing`, `/activity?project=${projectId}`, `/timeline?project=${projectId}`]) {
        await otherPage.goto(route);
        const body = await otherPage.locator("body").innerText();
        for (const secret of [achievementTitle, secondTitle, projectTitle, role, `M2 graduate note ${suffix}`, "m2-proof.pdf"]) {
          expect(body.includes(secret), `${route} must not reveal ${secret}`).toBe(false);
        }
      }
      await otherPage.goto("/dashboard");
      await expect(otherPage.locator(".dashboard-stat-card")).toHaveCount(0);
    } finally {
      await context.close();
    }
  } finally {
    for (const user of users) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw new Error("M2 journey fixture cleanup failed.");
    }
    await drain();
  }
});
