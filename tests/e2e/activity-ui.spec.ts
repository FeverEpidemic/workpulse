import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import { expectNoWcagViolations } from "./helpers/accessibility";

type LocalClient = SupabaseClient<Database>;
type TestUser = { id: string; email: string; password: string };

const PROFILE_TIMEZONE = "Asia/Bangkok";
const ACTIVITY_DATE = "2024-04-01";
const FIXTURE_PASSWORD = "Activity-test-123!";

function config() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  if (!url || !publicKey || !secretKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, publicKey, secretKey };
}

function fixtureClient(url: string, key: string): LocalClient {
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function createTestUser(admin: LocalClient, label: string): Promise<TestUser> {
  const suffix = randomUUID().replaceAll("-", "");
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const email = `activity-ui-${slug}-${suffix}@workpulse.test`;
  const password = FIXTURE_PASSWORD + randomBytes(8).toString("base64url");
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: label },
  });
  const user = created.data.user;
  if (created.error || !user) throw new Error("Local Activity test account setup failed.");

  const profile = await admin.from("profiles").update({
    display_name: label,
    timezone: PROFILE_TIMEZONE,
    locale: "en",
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", user.id);
  if (profile.error) {
    await admin.auth.admin.deleteUser(user.id);
    throw new Error("Local Activity profile setup failed.");
  }
  return { id: user.id, email, password };
}

async function createActivityFixture(
  client: LocalClient,
  input: {
    rawText: string;
    occurredOn: string;
    captureMode?: "note" | "form" | "chat";
    role?: string | null;
    scope?: string | null;
    outcome?: string | null;
    experienceId?: string | null;
    projectId?: string | null;
  },
): Promise<string> {
  const result = await client.rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(),
    p_raw_text: input.rawText,
    p_occurred_on: input.occurredOn,
    p_capture_mode: input.captureMode ?? "note",
    p_role: input.role ?? null,
    p_scope: input.scope ?? null,
    p_outcome: input.outcome ?? null,
    p_experience_id: input.experienceId ?? null,
    p_project_id: input.projectId ?? null,
  } as unknown as Database["public"]["Functions"]["create_activity_idempotent"]["Args"]);
  const activityId = result.data?.[0]?.activity_id;
  if (result.error || !activityId) throw new Error("Local Activity fixture creation failed.");
  return activityId;
}

async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function localDateInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Test timezone date could not be resolved.");
  return `${year.padStart(4, "0")}-${month}-${day}`;
}

async function expectNoHorizontalOverflow(page: Page, route: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width < 500 ? 820 : 960 });
  await page.goto(route);
  const heading = route === "/activity"
    ? "Activity"
    : route === "/activity/new"
      ? "Capture work"
      : "Activity details";
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.documentWidth, `${route} at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, animations: "disabled" });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test("Activity capture, list, detail, context, and revision recovery work against local Supabase", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  let admin: LocalClient | null = null;
  let ownerClient: LocalClient | null = null;
  let otherClient: LocalClient | null = null;
  let owner: TestUser | null = null;
  let other: TestUser | null = null;

  try {
    const values = config();
    admin = fixtureClient(values.url, values.secretKey);
    ownerClient = fixtureClient(values.url, values.publicKey);
    otherClient = fixtureClient(values.url, values.publicKey);
    owner = await createTestUser(admin, "Activity UI owner");
    other = await createTestUser(admin, "Activity UI other");

    const experienceResult = await admin.from("experiences").insert({
      user_id: owner.id,
      organization: "Activity UI Studio",
      role_title: "Product engineer",
      kind: "employment",
    }).select("id").single();
    const experienceId = experienceResult.data?.id;
    if (experienceResult.error || !experienceId) throw new Error("Local Activity context setup failed.");

    const ownerSignIn = await ownerClient.auth.signInWithPassword({ email: owner.email, password: owner.password });
    if (ownerSignIn.error) throw new Error("Local Activity owner sign-in setup failed.");
    const projectResult = await ownerClient.rpc("create_project_idempotent", {
      p_operation_key: randomUUID(),
      p_title: "Activity UI launch",
      p_description: null,
      p_user_role: null,
      p_outcome: null,
      p_status: "active",
      p_start_date: null,
      p_start_precision: null,
      p_end_date: null,
      p_end_precision: null,
      p_is_current: false,
      p_experience_id: experienceId,
    } as unknown as Database["public"]["Functions"]["create_project_idempotent"]["Args"]);
    const projectId = projectResult.data?.[0]?.project_id;
    if (projectResult.error || !projectId) throw new Error("Local Activity project setup failed.");

    const otherSignIn = await otherClient.auth.signInWithPassword({ email: other.email, password: other.password });
    if (otherSignIn.error) throw new Error("Local Activity second-account setup failed.");

    const foreignActivityId = await createActivityFixture(otherClient, {
      rawText: "foreign activity fixture",
      occurredOn: "2025-01-02",
    });
    await Promise.all(Array.from({ length: 31 }, (_, index) => createActivityFixture(ownerClient!, {
      rawText: `same-date pagination fixture ${index + 1}`,
      occurredOn: ACTIVITY_DATE,
    })));

    await signIn(page, owner);
    await page.locator(".workspace-topbar").getByRole("link", { name: "Quick log", exact: true }).click();
    const note = page.locator("#quick-log-note");
    await expect(note).toBeFocused();
    await expect(page.locator('[name="occurred_on"]')).toHaveValue(localDateInZone(PROFILE_TIMEZONE));
    await expect(page.getByRole("button", { name: "Save activity" })).toBeEnabled();
    await expectNoWcagViolations(page, testInfo, "activity-note-capture");

    const noteSource = "  shipped the first milestone\nreviewed edge cases 😀  ";
    await note.fill(noteSource);
    await page.locator('[name="occurred_on"]').fill(ACTIVITY_DATE);
    await page.locator("#quick-log-note-form-project").selectOption(projectId);
    await expect(page.locator("#quick-log-note-form-experience")).toBeDisabled();
    await expect(page.locator("#quick-log-note-form-experience")).toHaveValue(experienceId);
    const activityCaptureRoute = (url: URL) => url.pathname === "/activity/new";
    let releaseNoteAction: () => void = () => {};
    let noteActionFetched = false;
    const heldNoteResponse = new Promise<void>((resolve) => { releaseNoteAction = resolve; });
    await page.route(activityCaptureRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      noteActionFetched = true;
      await heldNoteResponse;
      await route.fulfill({ response });
    });
    const saveNoteButton = page.locator("#quick-log-note-form button[type='submit']");
    const saveNoteAction = saveNoteButton.click();
    try {
      await expect.poll(() => noteActionFetched, { timeout: 15_000 }).toBe(true);
      await expect(saveNoteButton).toHaveText("Saving…");
      await expect(saveNoteButton).toBeDisabled();
    } finally {
      releaseNoteAction();
    }
    await saveNoteAction;
    await page.unroute(activityCaptureRoute);
    await expect(page).toHaveURL(/\/activity\/[0-9a-f-]{36}\?/i);
    const noteId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    await expect(page.getByRole("heading", { name: "Activity details" })).toBeVisible();
    await expect(page.locator(".activity-detail-source").first()).toHaveJSProperty("textContent", noteSource);
    await expect(page.locator(".activity-detail-card .activity-list-context")).toContainText("Activity UI launch");
    await expect(page.locator(".activity-detail-card .activity-list-context")).toContainText("Product engineer · Activity UI Studio");
    await expectNoWcagViolations(page, testInfo, "activity-note-detail");

    await page.goto("/activity/new?returnTo=%2Factivity");
    const formRadio = page.getByRole("radio", { name: "Form", exact: true });
    await page.getByRole("radio", { name: "Note", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(formRadio).toBeChecked();
    await page.getByLabel("Work note").fill("Structured delivery note");
    await page.locator('[name="occurred_on"]').fill("2025-02-03");
    const addDetails = page.getByText("Add details", { exact: true });
    await addDetails.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("details.activity-details-disclosure")).toHaveAttribute("open", "");
    await page.locator('[name="role"]').fill("Platform lead");
    await page.locator('[name="scope"]').fill("Coordinated rollout across three services");
    await page.locator('[name="outcome"]').fill("Release completed without rollback");
    await page.locator("#quick-log-note-form-experience").selectOption(experienceId);
    await expectNoWcagViolations(page, testInfo, "activity-form-mode");
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.locator(".activity-detail-card .activity-detail-source").first()).toHaveText("Structured delivery note");
    await expect(page.locator(".activity-detail-card")).toContainText("Platform lead");
    await expect(page.locator(".activity-detail-card")).toContainText("Release completed without rollback");

    await page.goto("/activity/new?returnTo=%2Factivity");
    await page.getByRole("radio", { name: "Chat", exact: true }).check();
    const chatMessage = "  first Chat message\nwith original spacing  ";
    await page.getByLabel("First message").fill(chatMessage);
    await page.locator('[name="occurred_on"]').fill("2025-02-04");
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.getByRole("heading", { name: "Original Chat history" })).toBeVisible();
    await expect(page.locator(".activity-chat-history > li")).toHaveCount(1);
    await expect(page.locator(".activity-chat-history .activity-detail-source")).toHaveJSProperty("textContent", chatMessage);
    await expect(page.getByText(/does not rewrite them/i)).toBeVisible();
    await expect(page.getByText(/analyz/i)).toHaveCount(0);
    const chatId = new URL(page.url()).pathname.split("/").at(-1) ?? "";

    const chatStructuredUpdate = await ownerClient!.rpc("update_activity", {
      p_activity_id: chatId,
      p_expected_revision: 1,
      p_changes: {
        raw_text: chatMessage,
        occurred_on: "2025-02-04",
        role: "Chat role kept",
        scope: "Chat scope kept",
        outcome: "Chat outcome kept",
        experience_id: null,
        project_id: null,
      },
    });
    if (chatStructuredUpdate.error) throw new Error("Local Chat structured-field fixture update failed.");
    await page.reload();
    await expect(page.locator(".activity-detail-card")).toContainText("Chat role kept");
    await expect(page.locator(".activity-detail-card")).toContainText("Chat scope kept");
    await expect(page.locator(".activity-detail-card")).toContainText("Chat outcome kept");

    await page.goto("/activity/new?returnTo=%2Factivity");
    const failedSource = "  \n   ";
    await page.getByLabel("Work note").fill(failedSource);
    await page.locator('[name="occurred_on"]').fill(ACTIVITY_DATE);
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.locator("[name='raw_text']")).toHaveValue(failedSource);
    await expect(page.locator("[name='raw_text']")).toHaveAttribute("aria-invalid", "true");
    const draftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":quick-log-note")) ?? "");
    expect(draftKey).toContain("workpulse:draft:v2:");
    await expect.poll(() => page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, unknown>)["raw_text"] : null;
    }, draftKey)).toBe(failedSource);
    await page.getByLabel("Work note").fill("fixed after validation");
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.locator(".activity-detail-card .activity-detail-source").first()).toHaveText("fixed after validation");
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();

    const expiredSource = "  keep this note after the session ends\nwith the same whitespace  ";
    await page.goto("/activity/new?returnTo=%2Factivity");
    await page.getByLabel("Work note").fill(expiredSource);
    await page.locator('[name="occurred_on"]').fill("2025-03-01");
    const expiredOperationKey = await page.locator('[name="operation_key"]').inputValue();
    const expiredDraftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":quick-log-note")) ?? "");
    await page.context().clearCookies();
    await page.getByRole("button", { name: "Save activity" }).click();
    const sessionError = page.locator(".workspace-activity-form [role='alert']");
    await expect(sessionError).toContainText("Your session ended. Sign in to continue; your draft is saved in this tab.");
    await expect(sessionError).toBeVisible();
    await expect(page.getByLabel("Work note")).toHaveValue(expiredSource);
    await expect.poll(() => page.evaluate((key) => {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Record<string, unknown>)["raw_text"] : null;
    }, expiredDraftKey)).toBe(expiredSource);
    await expect(sessionError.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /returnTo=/);
    await signIn(page, owner);
    await page.goto("/activity/new?returnTo=%2Factivity");
    await expect(page.getByLabel("Work note")).toHaveValue(expiredSource);
    await expect(page.locator('[name="operation_key"]')).toHaveValue(expiredOperationKey);
    await page.getByRole("button", { name: "Save activity" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveJSProperty("textContent", expiredSource);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), expiredDraftKey)).toBeNull();

    const dateList = `/activity?from=${ACTIVITY_DATE}&to=${ACTIVITY_DATE}`;
    await page.goto(dateList);
    await expect(page.locator(".activity-list-row")).toHaveCount(30);
    const firstPageIds = await page.locator(".activity-list-row").evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
    );
    const nextLink = page.getByRole("link", { name: "Next page" });
    await expect(nextLink).toHaveAttribute("href", /cursor=/);
    await nextLink.click();
    await expect(page.locator(".activity-list-row")).toHaveCount(3);
    const secondPageIds = await page.locator(".activity-list-row").evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
    );
    expect([...firstPageIds, ...secondPageIds]).toHaveLength(33);
    expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(33);
    await page.locator(".activity-list-row").first().click();
    await expect(page.getByRole("link", { name: "Back to activity" })).toHaveAttribute("href", /cursor=/);
    await page.getByRole("link", { name: "Back to activity" }).click();
    await expect(page).toHaveURL(/cursor=/);

    await page.goto(`/activity?from=${ACTIVITY_DATE}&to=${ACTIVITY_DATE}`);
    await page.locator("#activity-filter-project").selectOption(projectId);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get("project") === projectId);
    await expect(page.locator(".activity-list-row")).toHaveCount(1);
    await page.locator(".activity-list-row").first().click();
    await expect(page).toHaveURL(new RegExp(`${noteId}`));
    await expect(page.getByRole("link", { name: "Back to activity" })).toHaveAttribute("href", /project=/);
    await page.getByRole("link", { name: "Back to activity" }).click();
    await expect(page.locator("#activity-filter-project")).toHaveValue(projectId);
    await expectNoWcagViolations(page, testInfo, "activity-filtered-list");

    const returnTo = "/activity?from=2024-04-01&to=2024-04-01";
    await page.goto(`/activity/${randomUUID()}?returnTo=${encodeURIComponent(returnTo)}`);
    const randomUnavailable = await page.locator(".app-card").innerText();
    await page.goto(`/activity/${foreignActivityId}?returnTo=${encodeURIComponent(returnTo)}`);
    await expect(page.getByRole("heading", { name: "Record unavailable" })).toBeVisible();
    expect(await page.locator(".app-card").innerText()).toBe(randomUnavailable);
    await page.goto(`/activity/not-a-uuid?returnTo=${encodeURIComponent(returnTo)}`);
    expect(await page.locator(".app-card").innerText()).toBe(randomUnavailable);

    const conflictTab = await page.context().newPage();
    const noteDetailUrl = `/activity/${noteId}?returnTo=%2Factivity`;
    await page.goto(noteDetailUrl);
    await conflictTab.goto(noteDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await conflictTab.getByRole("button", { name: "Edit activity" }).click();
    const noteEdit = page.locator("textarea[name='raw_text']");
    const noteEditConflict = conflictTab.locator("textarea[name='raw_text']");
    await noteEdit.fill("first tab saved revision");
    await noteEditConflict.fill("second tab local revision");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveText("first tab saved revision");
    await conflictTab.getByRole("button", { name: "Save changes" }).click();
    await expect(conflictTab.getByRole("heading", { name: "This activity changed in another tab" })).toBeVisible();
    await expect(conflictTab.locator(".activity-latest-source")).toHaveText("first tab saved revision");
    await expect(noteEditConflict).toHaveValue("second tab local revision");
    await expectNoWcagViolations(conflictTab, testInfo, "activity-revision-conflict");
    await conflictTab.getByRole("button", { name: "Review and retry my changes" }).click();
    await expect(conflictTab.locator(".activity-detail-source").first()).toHaveText("second tab local revision");

    const restoredDraftSource = "local draft from the earlier server revision";
    await page.goto(noteDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await page.locator("textarea[name='raw_text']").fill(restoredDraftSource);
    const restoredDraftKey = await page.evaluate((activityId) =>
      Object.keys(sessionStorage).find((key) => key.endsWith(`:activity-edit-${activityId}`)) ?? "", noteId);
    expect(restoredDraftKey).toContain(`:activity-edit-${noteId}`);
    await page.getByRole("link", { name: "Back to activity" }).click();
    await page.getByRole("button", { name: "Continue without saving" }).click();
    await expect(page).toHaveURL(/\/activity(?:\?|$)/);

    const currentNoteBeforeServerEdit = await ownerClient!.from("activities").select("revision").eq("id", noteId).single();
    if (currentNoteBeforeServerEdit.error || !currentNoteBeforeServerEdit.data) throw new Error("Local restored-draft revision lookup failed.");
    const serverRevisionUpdate = await ownerClient!.rpc("update_activity", {
      p_activity_id: noteId,
      p_expected_revision: currentNoteBeforeServerEdit.data.revision,
      p_changes: {
        raw_text: "server version after local draft",
        occurred_on: ACTIVITY_DATE,
        role: null,
        scope: null,
        outcome: null,
        experience_id: experienceId,
        project_id: projectId,
      },
    });
    if (serverRevisionUpdate.error) throw new Error("Local restored-draft server update failed.");

    await page.goto(noteDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await expect(page.getByRole("heading", { name: "This restored draft is based on an older version" })).toBeVisible();
    await expect(page.locator("textarea[name='raw_text']")).toHaveValue(restoredDraftSource);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    await expect(page.locator(".activity-latest-source")).toHaveText("server version after local draft");
    await page.getByRole("button", { name: "Review and retry my changes" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveText(restoredDraftSource);

    const legacyDraftSource = "legacy draft without revision metadata";
    await page.goto(noteDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await page.locator("textarea[name='raw_text']").fill(legacyDraftSource);
    const legacyDraftKey = await page.evaluate((activityId) =>
      Object.keys(sessionStorage).find((key) => key.endsWith(`:activity-edit-${activityId}`)) ?? "", noteId);
    await page.evaluate((key) => sessionStorage.removeItem(`${key}:metadata:v1`), legacyDraftKey);
    await page.getByRole("link", { name: "Back to activity" }).click();
    await page.getByRole("button", { name: "Continue without saving" }).click();
    await expect(page).toHaveURL(/\/activity(?:\?|$)/);

    const currentNoteBeforeLegacyServerEdit = await ownerClient!.from("activities").select("revision").eq("id", noteId).single();
    if (currentNoteBeforeLegacyServerEdit.error || !currentNoteBeforeLegacyServerEdit.data) throw new Error("Local legacy-draft revision lookup failed.");
    const legacyServerRevisionUpdate = await ownerClient!.rpc("update_activity", {
      p_activity_id: noteId,
      p_expected_revision: currentNoteBeforeLegacyServerEdit.data.revision,
      p_changes: {
        raw_text: "server version after legacy draft",
        occurred_on: ACTIVITY_DATE,
        role: null,
        scope: null,
        outcome: null,
        experience_id: experienceId,
        project_id: projectId,
      },
    });
    if (legacyServerRevisionUpdate.error) throw new Error("Local legacy-draft server update failed.");

    await page.goto(noteDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await expect(page.getByRole("heading", { name: "This restored draft needs review" })).toBeVisible();
    await expect(page.locator("textarea[name='raw_text']")).toHaveValue(legacyDraftSource);
    await page.getByRole("button", { name: "Review and retry my changes" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveText(legacyDraftSource);

    const reloadConflictTab = await page.context().newPage();
    const chatDetailUrl = `/activity/${chatId}?returnTo=%2Factivity`;
    await page.goto(chatDetailUrl);
    await reloadConflictTab.goto(chatDetailUrl);
    await page.getByRole("button", { name: "Edit activity" }).click();
    await reloadConflictTab.getByRole("button", { name: "Edit activity" }).click();
    await expect(page.locator("input[name='role'], textarea[name='scope'], textarea[name='outcome']")).toHaveCount(0);
    await expect(reloadConflictTab.locator("input[name='role'], textarea[name='scope'], textarea[name='outcome']")).toHaveCount(0);
    await expect(reloadConflictTab.locator(".activity-detail-section")).toContainText("Chat role kept");
    await page.locator("textarea[name='raw_text']").fill("latest Chat source from first tab");
    await reloadConflictTab.locator("textarea[name='raw_text']").fill("local Chat source draft");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator(".activity-detail-source").first()).toHaveText("latest Chat source from first tab");
    await reloadConflictTab.getByRole("button", { name: "Save changes" }).click();
    await expect(reloadConflictTab.getByRole("heading", { name: "This activity changed in another tab" })).toBeVisible();
    await expect(reloadConflictTab.locator(".activity-latest-source")).toHaveText("latest Chat source from first tab");
    await expect(reloadConflictTab.locator(".activity-detail-section")).toContainText("Chat role kept");
    await expect(reloadConflictTab.locator(".activity-detail-section")).toContainText("Chat scope kept");
    await expect(reloadConflictTab.locator(".activity-detail-section")).toContainText("Chat outcome kept");
    await reloadConflictTab.getByRole("button", { name: "Reload server" }).click();
    await expect(reloadConflictTab.getByRole("heading", { name: "Activity details" })).toBeVisible();
    await expect(reloadConflictTab.locator(".activity-detail-source").first()).toHaveText("latest Chat source from first tab");
    await expect(reloadConflictTab.locator(".activity-chat-history .activity-detail-source")).toHaveJSProperty(
      "textContent",
      "  first Chat message\nwith original spacing  ",
    );
    await expect(reloadConflictTab.locator(".activity-detail-card")).toContainText("Chat role kept");

    await page.goto(dateList);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const transitionDuration = await page.locator(".activity-list-row").first().evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration) * 1000,
    );
    expect(transitionDuration).toBeLessThanOrEqual(0.01);

    const responsiveRoutes = ["/activity", "/activity/new", noteDetailUrl];
    for (const width of [360, 1440]) {
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((nextTheme) => {
          document.documentElement.dataset.theme = nextTheme;
          document.cookie = `wp-theme=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax`;
        }, theme);
        for (const route of responsiveRoutes) await expectNoHorizontalOverflow(page, route, width);
        if (width === 360 && theme === "light") {
          await page.goto("/activity/new");
          await expect(page.getByRole("heading", { name: "Capture work", exact: true })).toBeVisible();
          await attachScreenshot(page, testInfo, "activity-capture-mobile-light.png");
        }
        if (width === 1440 && theme === "dark") {
          await page.goto(noteDetailUrl);
          await expect(page.getByRole("heading", { name: "Activity details", exact: true })).toBeVisible();
          await attachScreenshot(page, testInfo, "activity-detail-desktop-dark.png");
        }
      }
    }
  } finally {
    await ownerClient?.auth.signOut();
    await otherClient?.auth.signOut();
    let cleanupFailed = false;
    if (admin) {
      if (other) cleanupFailed ||= Boolean((await admin.auth.admin.deleteUser(other.id)).error);
      if (owner) cleanupFailed ||= Boolean((await admin.auth.admin.deleteUser(owner.id)).error);
    }
    if (cleanupFailed) throw new Error("Local Activity E2E fixture cleanup failed.");
  }
});
