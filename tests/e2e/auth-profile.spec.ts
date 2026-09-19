import { randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expectEveryFieldErrorAssociated, expectNoWcagViolations } from "./helpers/accessibility";

const APP_ORIGIN = "http://127.0.0.1:3000";
const MAILPIT_ORIGIN = process.env["WORKPULSE_MAILPIT_URL"] ?? "http://127.0.0.1:54324";
const INITIAL_PASSWORD = "Test-password-123!";
const UPDATED_PASSWORD = "New-test-password-456!";

interface MailAddress {
  Address?: string;
  Email?: string;
}

interface MailSummary {
  ID: string;
  Subject: string;
  To: MailAddress[];
}

interface MailList {
  messages?: MailSummary[];
}

interface MailDetail {
  HTML?: string;
  Text?: string;
}

async function waitForMail(
  request: APIRequestContext,
  email: string,
  subject: RegExp,
  timeoutMs = 60_000,
): Promise<MailSummary> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await request.get(`${MAILPIT_ORIGIN}/api/v1/messages?start=0&limit=50`);
    if (response.ok()) {
      const list = await response.json() as MailList;
      const found = list.messages?.find((message) =>
        message.Subject && subject.test(message.Subject) &&
        message.To?.some((recipient) => (recipient.Address ?? recipient.Email ?? "").toLowerCase() === email.toLowerCase()),
      );
      if (found) return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`No matching local Mailpit message arrived for ${email}.`);
}

async function emailActionLink(request: APIRequestContext, message: MailSummary): Promise<string> {
  const response = await request.get(`${MAILPIT_ORIGIN}/api/v1/message/${encodeURIComponent(message.ID)}`);
  expect(response.ok()).toBeTruthy();
  const detail = await response.json() as MailDetail;
  const body = `${detail.HTML ?? ""}\n${detail.Text ?? ""}`;
  const candidates = [...body.matchAll(/href\s*=\s*["']([^"']*\/auth\/confirm[^"']*)["']/gi)]
    .map((match) => match[1]);
  const rawLink = candidates[0] ?? body.match(/https?:\/\/[^\s"'<>]*\/auth\/confirm[^\s"'<>]*/i)?.[0];
  expect(rawLink, "The local Auth email must link to the WorkPulse confirmation route").toBeTruthy();

  const decoded = (rawLink as string)
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x3D;", "=")
    .replaceAll("&quot;", "\"");
  const url = new URL(decoded, APP_ORIGIN);
  expect(url.origin).toBe(APP_ORIGIN);
  expect(url.pathname).toBe("/auth/confirm");
  expect(url.searchParams.has("token_hash") || url.searchParams.has("code")).toBe(true);
  return url.toString();
}

async function confirmEmail(request: APIRequestContext, page: Page, email: string, subject: RegExp): Promise<void> {
  const message = await waitForMail(request, email, subject);
  await page.goto(await emailActionLink(request, message));
}

async function signIn(page: Page, email: string, password: string, returnTo: string): Promise<void> {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function careerSection(page: Page, title: string): Promise<Locator> {
  return page.getByRole("heading", { name: title, exact: true }).locator("xpath=ancestor::section[1]");
}

async function ensureDetailsOpen(details: Locator): Promise<void> {
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator("summary").first().click();
  }
  await expect(details).toHaveJSProperty("open", true);
}

async function addRecord(section: Locator, fields: Record<string, string>): Promise<void> {
  const addDetails = section.locator(":scope > details").last();
  await ensureDetailsOpen(addDetails);
  const form = addDetails.locator("form");
  for (const [name, value] of Object.entries(fields)) {
    const control = form.locator(`[name="${name}"]`);
    if (await control.evaluate((element) => element instanceof HTMLSelectElement)) {
      await control.selectOption(value);
    } else {
      await control.fill(value);
    }
  }
  const operationKeyField = form.locator('[name="operation_key"]');
  await expect(operationKeyField).toHaveValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const operationKeyBeforeSave = await operationKeyField.inputValue();
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(form.getByRole("status")).toContainText("Record saved.");
  await expect.poll(() => operationKeyField.inputValue()).not.toBe(operationKeyBeforeSave);
}

async function editRecord(section: Locator, summary: string, field: string, value: string, nextSummary: string): Promise<void> {
  const record = section.locator("details").filter({ hasText: summary }).first();
  await ensureDetailsOpen(record);
  const form = record.locator("form").first();
  const formId = await form.getAttribute("id");
  expect(formId).toBeTruthy();
  await form.locator(`[name="${field}"]`).fill(value);
  if (field === "role_title") {
    await form.locator('[name="start_precision"]').selectOption("year");
    await form.locator('[name="start_year"]').fill("2021");
  }
  await form.getByRole("button", { name: "Save record" }).click();
  const updatedForm = section.locator(`#${formId}`);
  await expect(updatedForm.getByRole("status")).toContainText("Record saved.");
  await expect(section.locator("details > summary").filter({ hasText: nextSummary })).toHaveCount(1);
  const updatedRevision = await updatedForm.locator('[name="expected_revision"]').inputValue();
  const updatedRecord = section.locator("details").filter({ hasText: nextSummary }).first();
  const deleteRevision = updatedRecord.locator('form[id^="delete-"] [name="expected_revision"]');
  await expect(deleteRevision).toHaveValue(updatedRevision);
}

async function deleteRecord(section: Locator, summary: string, experience = false): Promise<void> {
  const record = section.locator("details").filter({ hasText: summary }).first();
  await ensureDetailsOpen(record);
  const deleteButton = record.getByRole("button", { name: "Delete", exact: true });
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const dialog = section.page().getByRole("dialog", { name: "Delete this record?" });
  await expect(dialog).toContainText(summary);
  if (experience) await expect(dialog).toContainText("0 project(s)");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(section.getByText(summary, { exact: true })).toHaveCount(0);
}

test("email auth, onboarding, profile recovery, conflict recovery, and foundation ownership", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  const suffix = randomUUID().slice(0, 8);
  const email = `wp-${suffix}@example.test`;
  const otherEmail = `wp-other-${suffix}@example.test`;
  const profileName = `WorkPulse ${suffix}`;

  await page.goto("/sign-in");
  const signInForm = page.locator("#sign-in-form");
  await signInForm.evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByLabel("Email address").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill(INITIAL_PASSWORD);
  await signInForm.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(signInForm.locator(".field-error")).toContainText("Enter a valid email address.");
  await expectEveryFieldErrorAssociated(page);
  await expectNoWcagViolations(page, testInfo, "sign-in-validation");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(INITIAL_PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  await confirmEmail(request, page, email, /confirm/i);
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  await page.getByLabel("Display name").fill(`A onboarding draft ${suffix}`);
  const userADraftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":onboarding-profile")) ?? "");
  expect(userADraftKey.startsWith("workpulse:draft:v2:")).toBe(true);
  await page.getByLabel("Display name").fill("Pending onboarding");
  await page.getByLabel("Time zone").fill("Mars/Phobos");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.locator(".field-error").filter({ hasText: "Enter a real display name." })).toHaveCount(1);
  await expect(page.locator(".field-error").filter({ hasText: "Choose a valid IANA time zone." })).toHaveCount(1);
  await expect(page.locator("#onboarding-display-name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#onboarding-timezone")).toHaveAttribute("aria-invalid", "true");
  await expectEveryFieldErrorAssociated(page);
  await expectNoWcagViolations(page, testInfo, "onboarding-validation");
  await page.getByLabel("Display name").fill(`A onboarding draft ${suffix}`);
  await page.getByLabel("Time zone").fill("UTC");

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email address").fill(otherEmail);
  await page.getByLabel("Password", { exact: true }).fill(INITIAL_PASSWORD);
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");
  await confirmEmail(request, page, otherEmail, /confirm/i);
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  await expect(page.getByLabel("Display name")).toHaveValue("");
  await page.getByLabel("Display name").fill(`B onboarding draft ${suffix}`);
  const userBDraft = await page.evaluate((userADraftKey) => {
    const key = Object.keys(sessionStorage).find((entry) => entry.endsWith(":onboarding-profile") && entry !== userADraftKey) ?? "";
    const raw = key ? sessionStorage.getItem(key) : null;
    const value = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    return { key, displayName: value?.["display_name"] };
  }, userADraftKey);
  const userBDraftKey = userBDraft.key;
  expect(userBDraft.key.startsWith("workpulse:draft:v2:")).toBe(true);
  expect(userBDraft.key).not.toBe(userADraftKey);
  expect(userBDraft.displayName).toBe(`B onboarding draft ${suffix}`);
  const draftHasUnsafeFields = await page.evaluate((password) => {
    const entries = Object.entries(sessionStorage).filter(([key]) => key.startsWith("workpulse:draft:v2:"));
    return entries.some(([key, raw]) => {
      if (raw.includes(password)) return true;
      let value: unknown;
      try {
        value = JSON.parse(raw) as unknown;
      } catch {
        return true;
      }
      if (value === null || typeof value !== "object" || Array.isArray(value)) return true;
      return Object.keys(value).some((field) => ["id", "kind", "user_id", "owner_id", "expected_revision", "password"].includes(field));
    });
  }, INITIAL_PASSWORD);
  expect(draftHasUnsafeFields).toBe(false);

  await page.context().clearCookies();
  await signIn(page, email, INITIAL_PASSWORD, "/settings/profile?mode=onboarding");
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  await expect(page.getByLabel("Display name")).toHaveValue(`A onboarding draft ${suffix}`);
  await page.getByLabel("Display name").fill(profileName);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), userADraftKey)).toBeNull();
  await expect(page.getByRole("heading", { name: "Your workspace is ready" })).toBeVisible();

  await page.getByRole("link", { name: "Quick log", exact: true }).click();
  const quickLogNoteA = `A private quick log ${suffix}`;
  await page.getByLabel("Work note").fill(quickLogNoteA);
  const quickLogDraftKeyA = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":quick-log-note")) ?? "");
  expect(quickLogDraftKeyA.startsWith("workpulse:draft:v2:")).toBe(true);
  expect(await page.evaluate((key) => {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
    return value?.["raw_text"];
  }, quickLogDraftKeyA)).toBe(quickLogNoteA);
  await page.getByRole("link", { name: "Activity", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave without saving?" }).getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await page.context().clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page, email, INITIAL_PASSWORD, "/activity/new");
  await expect(page).toHaveURL(/\/activity\/new$/);
  await expect(page.getByLabel("Work note")).toHaveValue(quickLogNoteA);
  await page.getByRole("link", { name: "Profile and settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave without saving?" })
    .getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.context().clearCookies();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page, email, INITIAL_PASSWORD, "/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByLabel("Headline").fill("Career systems builder");
  await page.getByLabel("Summary").fill("Keeps a verified record of work and learning.");
  await page.getByLabel("Contact email").fill(`contact-${suffix}@example.test`);
  await page.getByLabel("Phone").fill("+1 555 0100");
  await page.getByLabel("Location").fill("Remote");
  await page.getByLabel("Website").fill("https://example.test/profile");
  await page.locator('#profile-settings-form [name="locale"]').selectOption("id");
  await page.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await page.locator('#profile-settings-form [name="locale"]').selectOption("en");
  await page.locator("#profile-settings-form").getByRole("button", { name: "Simpan profil" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();

  await page.getByLabel("Headline").fill("Unsaved draft before session expiry");
  const experienceSectionBeforeExpiry = await careerSection(page, "Experience");
  const addExperienceBeforeExpiry = experienceSectionBeforeExpiry.locator("details").last();
  await addExperienceBeforeExpiry.locator("summary").click();
  const experienceFormBeforeExpiry = addExperienceBeforeExpiry.locator("form");
  await experienceFormBeforeExpiry.locator('[name="organization"]').fill(`Expiry Draft Org ${suffix}`);
  await experienceFormBeforeExpiry.locator('[name="role_title"]').fill(`Expiry Draft Role ${suffix}`);
  const operationKeyBeforeExpiry = await experienceFormBeforeExpiry.locator('[name="operation_key"]').inputValue();
  expect(operationKeyBeforeExpiry).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  await page.context().clearCookies();
  await page.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  const sessionError = page.locator("#profile-settings-form").getByRole("alert");
  await expect(sessionError).toContainText("Your session ended");
  await sessionError.getByRole("link", { name: "Sign in" }).click();
  await signIn(page, email, INITIAL_PASSWORD, "/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByLabel("Headline")).toHaveValue("Unsaved draft before session expiry");
  const experienceSectionAfterExpiry = await careerSection(page, "Experience");
  const addExperienceAfterExpiry = experienceSectionAfterExpiry.locator("details").last();
  await addExperienceAfterExpiry.locator("summary").click();
  const experienceFormAfterExpiry = addExperienceAfterExpiry.locator("form");
  await expect(experienceFormAfterExpiry.locator('[name="organization"]')).toHaveValue(`Expiry Draft Org ${suffix}`);
  await expect(experienceFormAfterExpiry.locator('[name="role_title"]')).toHaveValue(`Expiry Draft Role ${suffix}`);
  await expect(experienceFormAfterExpiry.locator('[name="operation_key"]')).toHaveValue(operationKeyBeforeExpiry);
  await page.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");

  const staleTab = await page.context().newPage();
  await staleTab.goto(`${APP_ORIGIN}/settings/profile`);
  await expect(staleTab.getByLabel("Headline")).toHaveValue("Unsaved draft before session expiry");
  await page.getByLabel("Headline").fill("Saved in the first tab");
  await page.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");
  await staleTab.getByLabel("Headline").fill("Retained draft from the stale tab");
  const storedStaleDraft = await staleTab.evaluate(() => {
    const key = Object.keys(sessionStorage).find((entry) => entry.endsWith(":profile-settings"));
    const raw = key ? sessionStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as Record<string, unknown>)["headline"] : null;
  });
  expect(storedStaleDraft).toBe("Retained draft from the stale tab");
  await staleTab.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(staleTab.locator("#profile-settings-form").getByRole("alert")).toContainText("Your draft is still here");
  await expect(staleTab.getByLabel("Headline")).toHaveValue("Retained draft from the stale tab");
  await expectNoWcagViolations(staleTab, testInfo, "profile-conflict");
  await staleTab.getByRole("button", { name: "Review and retry my changes" }).click();
  await expect(staleTab.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");

  await page.reload();
  await expect(page.getByLabel("Headline")).toHaveValue("Retained draft from the stale tab");
  await page.getByLabel("Headline").fill("Server version before reload");
  await page.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");

  await staleTab.getByLabel("Headline").fill("Local profile before reload");
  await staleTab.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(staleTab.locator("#profile-settings-form").getByRole("alert")).toContainText("Your draft is still here");
  await staleTab.getByRole("button", { name: "Reload server" }).click();
  await expect(staleTab.getByLabel("Headline")).toHaveValue("Server version before reload");
  const mainTabRevision = await page.locator('#profile-settings-form [name="expected_revision"]').inputValue();
  await expect(staleTab.locator('#profile-settings-form [name="expected_revision"]')).toHaveValue(mainTabRevision);
  await staleTab.getByLabel("Headline").fill("Profile saved after server reload");
  await staleTab.locator("#profile-settings-form").getByRole("button", { name: "Save profile" }).click();
  await expect(staleTab.locator("#profile-settings-form").getByRole("status")).toContainText("Profile saved.");
  await staleTab.close();

  const experiences = await careerSection(page, "Experience");
  const partialDateOrganization = `Partial Date Org ${suffix}`;
  const partialDateRole = `Partial Date Role ${suffix}`;
  const partialDateForm = experiences.locator(":scope > details").last().locator("form");
  await ensureDetailsOpen(experiences.locator(":scope > details").last());
  await partialDateForm.locator('[name="organization"]').fill(partialDateOrganization);
  await partialDateForm.locator('[name="role_title"]').fill(partialDateRole);
  await partialDateForm.locator('[name="start_precision"]').selectOption("day");
  await partialDateForm.locator('[name="start_year"]').fill("2021");
  await partialDateForm.locator('[name="start_month"]').fill("2");
  await partialDateForm.locator('[name="start_day"]').fill("30");
  await partialDateForm.getByRole("button", { name: "Save record" }).click();
  const partialDayError = partialDateForm.locator(".field-error").filter({ hasText: "Enter a complete date for the selected precision." });
  await expect(partialDayError).toHaveCount(1);
  await expect(partialDateForm.locator('[name="start_day"]')).toHaveAttribute("aria-invalid", "true");
  await expectEveryFieldErrorAssociated(page);
  await expectNoWcagViolations(page, testInfo, "foundation-partial-date-validation");
  await expect(partialDateForm.locator('[name="start_precision"]')).toHaveValue("day");
  await expect(partialDateForm.locator('[name="start_year"]')).toHaveValue("2021");
  await expect(partialDateForm.locator('[name="start_month"]')).toHaveValue("2");
  await expect(partialDateForm.locator('[name="start_day"]')).toHaveValue("30");
  await partialDateForm.locator('[name="start_day"]').fill("28");
  await partialDateForm.getByRole("button", { name: "Save record" }).click();
  await expect(partialDateForm.getByRole("status")).toContainText("Record saved.");
  await deleteRecord(experiences, `${partialDateRole} · ${partialDateOrganization}`, true);

  const privateOrganization = `Private Org ${suffix}`;
  const privateRole = `Private Role ${suffix}`;
  const privateRoleAfterReload = `Private Role Saved ${suffix}`;
  const deleteOrganization = `Delete Org ${suffix}`;
  await addRecord(experiences, { organization: privateOrganization, role_title: privateRole, start_precision: "unknown" });

  const experienceTab = await page.context().newPage();
  await experienceTab.goto(`${APP_ORIGIN}/settings/profile`);
  const experienceSectionStale = await careerSection(experienceTab, "Experience");
  const experienceDetailsStale = experienceSectionStale.locator("details").filter({ hasText: `${privateRole} · ${privateOrganization}` }).first();
  await experienceDetailsStale.locator("summary").first().click();
  const experienceFormStale = experienceDetailsStale.locator("form").first();
  const originalExperienceId = await experienceFormStale.locator('[name="id"]').inputValue();
  const originalExpectedRevision = await experienceFormStale.locator('[name="expected_revision"]').inputValue();

  const experienceDetailsServer = experiences.locator("details").filter({ hasText: `${privateRole} · ${privateOrganization}` }).first();
  await experienceDetailsServer.locator("summary").first().click();
  const experienceFormServer = experienceDetailsServer.locator("form").first();
  await experienceFormServer.locator('[name="experience_kind"]').selectOption("internship");
  await experienceFormServer.locator('[name="start_precision"]').selectOption("year");
  await experienceFormServer.locator('[name="start_year"]').fill("2022");
  await experienceFormServer.getByRole("button", { name: "Save record" }).click();
  await expect(experienceFormServer.getByRole("status")).toContainText("Record saved.");

  await experienceFormStale.locator('[name="role_title"]').fill("Local experience before reload");
  await experienceFormStale.getByRole("button", { name: "Save record" }).click();
  await expect(experienceFormStale.getByRole("alert")).toContainText("Your draft is still here");
  await experienceFormStale.getByRole("button", { name: "Reload server" }).click();
  await expect(experienceFormStale.locator('[name="experience_kind"]')).toHaveValue("internship");
  await expect(experienceFormStale.locator('[name="kind"]')).toHaveValue("experience");
  await expect(experienceFormStale.locator('[name="id"]')).toHaveValue(originalExperienceId);
  const reloadedExpectedRevision = await experienceFormStale.locator('[name="expected_revision"]').inputValue();
  expect(Number(reloadedExpectedRevision)).toBeGreaterThan(Number(originalExpectedRevision));
  await expect(experienceFormStale.locator('[name="start_precision"]')).toHaveValue("year");
  await expect(experienceFormStale.locator('[name="start_year"]')).toHaveValue("2022");
  await expect(experienceFormStale.locator('[name="start_month"]')).toHaveValue("");
  await expect(experienceFormStale.locator('[name="start_day"]')).toHaveValue("");
  await expect(experienceFormStale.locator('[name="end_precision"]')).toHaveValue("unknown");
  await expect(experienceFormStale.locator('[name="end_year"]')).toHaveValue("");
  await expect(experienceFormStale.locator('[name="end_month"]')).toHaveValue("");
  await expect(experienceFormStale.locator('[name="end_day"]')).toHaveValue("");
  await ensureDetailsOpen(experienceDetailsStale);
  await experienceFormStale.locator('[name="role_title"]').fill(privateRoleAfterReload);
  await experienceFormStale.getByRole("button", { name: "Save record" }).click();
  await expect(experienceSectionStale.locator("details > summary").filter({ hasText: `${privateRoleAfterReload} · ${privateOrganization}` })).toHaveCount(1);
  await experienceTab.close();

  await addRecord(experiences, { organization: deleteOrganization, role_title: `Candidate ${suffix}` });
  const oldExperience = `Candidate ${suffix} · ${deleteOrganization}`;
  const updatedExperience = `Candidate Updated ${suffix} · ${deleteOrganization}`;
  await editRecord(experiences, oldExperience, "role_title", `Candidate Updated ${suffix}`, updatedExperience);
  await deleteRecord(experiences, updatedExperience, true);

  const education = await careerSection(page, "Education");
  const school = `School ${suffix}`;
  await addRecord(education, { institution: school, qualification: "Bachelor's degree" });
  await editRecord(education, `Bachelor's degree · ${school}`, "qualification", "Master's degree", `Master's degree · ${school}`);
  await deleteRecord(education, `Master's degree · ${school}`);

  const certifications = await careerSection(page, "Certifications");
  const certificate = `Certificate ${suffix}`;
  await addRecord(certifications, { name: certificate, issuer: "Local Test Institute", credential_url: "https://example.test/certificate" });
  await editRecord(certifications, certificate, "issuer", "Updated Test Institute", certificate);
  await deleteRecord(certifications, certificate);

  const skills = await careerSection(page, "Skills");
  const duplicateSkill = `Review Duplicate ${suffix}`;
  const replacementSkill = `Review Replacement ${suffix}`;
  await addRecord(skills, { name: duplicateSkill });
  const duplicateSkillForm = skills.locator(":scope > details").last().locator("form");
  await duplicateSkillForm.locator('[name="name"]').fill(duplicateSkill);
  await duplicateSkillForm.getByRole("button", { name: "Save record" }).click();
  await expect(duplicateSkillForm.locator(".field-error")).toContainText("You already added this skill.");
  await expect(duplicateSkillForm.locator('[name="name"]')).toHaveAttribute("aria-invalid", "true");
  await expectEveryFieldErrorAssociated(page);
  await expectNoWcagViolations(page, testInfo, "foundation-duplicate-skill-validation");
  await duplicateSkillForm.locator('[name="name"]').fill(replacementSkill);
  await duplicateSkillForm.getByRole("button", { name: "Save record" }).click();
  await expect(duplicateSkillForm.getByRole("status")).toContainText("Record saved.");
  await deleteRecord(skills, replacementSkill);
  await deleteRecord(skills, duplicateSkill);

  const skill = `Testing ${suffix}`;
  await addRecord(skills, { name: skill });
  await editRecord(skills, skill, "name", `Testing Updated ${suffix}`, `Testing Updated ${suffix}`);
  await deleteRecord(skills, `Testing Updated ${suffix}`);

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, userBDraftKey)).toBe(true);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account matches that address");
  await confirmEmail(request, page, email, /reset/i);
  await expect(page).toHaveURL(/\/update-password$/);
  await page.getByLabel("Password", { exact: true }).fill(UPDATED_PASSWORD);
  await page.getByLabel("Confirm password").fill(UPDATED_PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?notice=passwordUpdated$/);
  await signIn(page, email, UPDATED_PASSWORD, "/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.context().clearCookies();
  await page.goto("/sign-in");
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, otherEmail, INITIAL_PASSWORD, "/settings/profile?mode=onboarding");
  await expect(page).toHaveURL(/\/onboarding\/import$/);
  await page.getByRole("link", { name: "Start manually" }).click();
  await expect(page).toHaveURL(/\/settings\/profile\?mode=onboarding$/);
  await expect(page.getByLabel("Display name")).toHaveValue(`B onboarding draft ${suffix}`);
  await page.getByLabel("Display name").fill(`Second user ${suffix}`);
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), userBDraftKey)).toBeNull();
  await page.getByRole("link", { name: "Profile and settings" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByText(`${privateRoleAfterReload} · ${privateOrganization}`, { exact: true })).toHaveCount(0);

  await page.getByLabel("Headline").fill("B draft to clear on sign out");
  const experienceSectionB = await careerSection(page, "Experience");
  const addExperienceB = experienceSectionB.locator("details").last();
  await addExperienceB.locator("summary").click();
  const experienceFormB = addExperienceB.locator("form");
  await experienceFormB.locator('[name="organization"]').fill(`B Org ${suffix}`);
  await experienceFormB.locator('[name="role_title"]').fill(`B Role ${suffix}`);
  const bProfileDraftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":profile-settings")) ?? "");
  expect(bProfileDraftKey.startsWith("workpulse:draft:v2:")).toBe(true);

  await page.getByRole("link", { name: "Quick log", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave without saving?" }).getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/activity\/new$/);
  await expect(page.getByLabel("Work note")).toHaveValue("");
  const quickLogNoteB = `B private quick log ${suffix}`;
  await page.getByLabel("Work note").fill(quickLogNoteB);
  const quickLogDraftKeyB = await page.evaluate((userADraftKey) =>
    Object.keys(sessionStorage).find((key) => key.endsWith(":quick-log-note") && key !== userADraftKey) ?? "",
  quickLogDraftKeyA);
  expect(quickLogDraftKeyB.startsWith("workpulse:draft:v2:")).toBe(true);
  expect(quickLogDraftKeyB).not.toBe(quickLogDraftKeyA);
  expect(await page.evaluate((key) => {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
    return value?.["raw_text"];
  }, quickLogDraftKeyB)).toBe(quickLogNoteB);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), bProfileDraftKey)).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), quickLogDraftKeyB)).toBeNull();
  expect(await page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>)["raw_text"] : null;
  }, quickLogDraftKeyA)).toBe(quickLogNoteA);

  await signIn(page, email, UPDATED_PASSWORD, "/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByRole("link", { name: "Quick log", exact: true }).click();
  await expect(page.getByLabel("Work note")).toHaveValue(quickLogNoteA);
  await page.getByRole("link", { name: "Profile and settings", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave without saving?" })
    .getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByLabel("Headline").fill("A private cross-account draft");
  const experienceSectionA = await careerSection(page, "Experience");
  const addExperienceA = experienceSectionA.locator("details").last();
  await addExperienceA.locator("summary").click();
  const experienceFormA = addExperienceA.locator("form");
  await experienceFormA.locator('[name="organization"]').fill(`A private org ${suffix}`);
  await experienceFormA.locator('[name="role_title"]').fill(`A private role ${suffix}`);
  const aProfileDraftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.endsWith(":profile-settings")) ?? "");
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).find((key) => key.startsWith("workpulse:draft:v2:") && key.includes(":foundation-experience-new")) ?? ""))
    .toMatch(/^workpulse:draft:v2:/);
  const aExperienceDraftKey = await page.evaluate(() => Object.keys(sessionStorage).find((key) => key.startsWith("workpulse:draft:v2:") && key.includes(":foundation-experience-new")) ?? "");
  expect(aProfileDraftKey.startsWith("workpulse:draft:v2:")).toBe(true);
  expect(aExperienceDraftKey.startsWith("workpulse:draft:v2:")).toBe(true);

  await page.context().clearCookies();
  await signIn(page, otherEmail, INITIAL_PASSWORD, "/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await page.getByRole("link", { name: "Quick log", exact: true }).click();
  await expect(page.getByLabel("Work note")).toHaveValue("");
  await page.getByRole("link", { name: "Profile and settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByLabel("Headline")).toHaveValue("");
  const experienceSectionBReloaded = await careerSection(page, "Experience");
  const addExperienceBReloaded = experienceSectionBReloaded.locator("details").last();
  await addExperienceBReloaded.locator("summary").click();
  const experienceFormBReloaded = addExperienceBReloaded.locator("form");
  await expect(experienceFormBReloaded.locator('[name="organization"]')).toHaveValue("");
  await expect(experienceFormBReloaded.locator('[name="role_title"]')).toHaveValue("");
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, aProfileDraftKey)).toBe(true);

  await page.getByLabel("Headline").fill("B own profile draft");
  const bProfileDraftKeyAfterSwitch = await page.evaluate((aDraftKey) =>
    Object.keys(sessionStorage).find((key) => key.endsWith(":profile-settings") && key !== aDraftKey) ?? "",
  aProfileDraftKey);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), bProfileDraftKeyAfterSwitch)).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key) !== null, aProfileDraftKey)).toBe(true);

  await signIn(page, email, UPDATED_PASSWORD, "/settings/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect.poll(() => page.evaluate((key) => {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>)["raw_text"] : null;
  }, quickLogDraftKeyA)).toBe(quickLogNoteA);
  await expect(page.getByLabel("Headline")).toHaveValue("A private cross-account draft");
  const experienceSectionAReloaded = await careerSection(page, "Experience");
  const addExperienceAReloaded = experienceSectionAReloaded.locator("details").last();
  await addExperienceAReloaded.locator("summary").click();
  const experienceFormAReloaded = addExperienceAReloaded.locator("form");
  await expect(experienceFormAReloaded.locator('[name="organization"]')).toHaveValue(`A private org ${suffix}`);
  await expect(experienceFormAReloaded.locator('[name="role_title"]')).toHaveValue(`A private role ${suffix}`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), quickLogDraftKeyA)).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), aProfileDraftKey)).toBeNull();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), aExperienceDraftKey)).toBeNull();
});
