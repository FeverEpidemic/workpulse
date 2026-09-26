import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { Database } from "../../src/server/supabase/database.types";
import type { EvidencePublicRecord } from "../../src/features/evidence/contracts";
import { expectNoWcagViolations } from "./helpers/accessibility";

type Client = SupabaseClient<Database>;
type User = { id: string; email: string; password: string };
const TEST_PDF = Buffer.from("%PDF-1.7\nWorkPulse evidence fixture\n%%EOF\n");

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

async function createUser(admin: Client): Promise<User> {
  const suffix = randomUUID().replaceAll("-", "");
  const email = "evidence-ui-" + suffix + "@workpulse.test";
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Evidence UI owner" } });
  const user = created.data.user;
  if (created.error || !user) throw new Error("Evidence UI user fixture setup failed.");
  const profile = await admin.from("profiles").update({ display_name: "Evidence UI owner", locale: "en", timezone: "Asia/Bangkok", onboarding_completed_at: new Date().toISOString() }).eq("id", user.id);
  if (profile.error) throw new Error("Evidence UI profile fixture setup failed.");
  return { id: user.id, email, password };
}

async function createActivity(owner: Client): Promise<string> {
  const result = await owner.rpc("create_activity_idempotent", {
    p_operation_key: randomUUID(), p_raw_text: "Evidence UI host fixture", p_occurred_on: "2026-09-20", p_capture_mode: "note",
    p_role: null, p_scope: null, p_outcome: null, p_experience_id: null, p_project_id: null,
  } as unknown as Database["public"]["Functions"]["create_activity_idempotent"]["Args"]);
  const id = result.data?.[0]?.activity_id;
  if (result.error || !id) throw new Error("Evidence UI Activity fixture setup failed.");
  return id;
}

async function createProject(owner: Client): Promise<string> {
  const result = await owner.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: "Evidence UI project", p_description: null, p_user_role: null, p_outcome: null,
    p_status: "active", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null,
    p_is_current: false, p_experience_id: null,
  } as unknown as Database["public"]["Functions"]["create_project_idempotent"]["Args"]);
  const id = result.data?.[0]?.project_id;
  if (result.error || !id) throw new Error("Evidence UI Project fixture setup failed.");
  return id;
}

async function createAchievement(owner: Client, activityId: string): Promise<string> {
  const result = await owner.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: activityId, p_project_id: null, p_experience_id: null,
  } as unknown as Database["public"]["Functions"]["create_achievement_idempotent"]["Args"]);
  const id = result.data?.[0]?.achievement_id;
  if (result.error || !id) throw new Error("Evidence UI Achievement fixture setup failed.");
  return id;
}

async function signIn(page: Page, user: User): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

function evidence(id: string, filename: string, status: EvidencePublicRecord["status"], revision = 1): EvidencePublicRecord {
  const timestamp = "2026-09-26T00:00:00.000Z";
  return { id, filename, contentType: "application/pdf", bytes: TEST_PDF.byteLength, status, revision,
    reservationExpiresAt: status === "uploading" ? "2026-09-26T00:15:00.000Z" : null,
    createdAt: timestamp, updatedAt: timestamp, failureCode: status === "failed" ? "SCAN_FAILED" : null };
}

function publicResponse(item: EvidencePublicRecord) {
  return { status: 200, contentType: "application/json", body: JSON.stringify(item) };
}

async function expectNoOverflow(page: Page, route: string, width: 360 | 1440, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize({ width, height: width < 500 ? 840 : 960 });
  await page.goto(route);
  await page.locator(".evidence-attachments").waitFor();
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
  expect(sizes.document, route + " " + width + "px " + theme).toBeLessThanOrEqual(sizes.viewport);
}

test("Evidence lifecycle controls work on Activity, Achievement, and Project hosts", async ({ page }) => {
  test.setTimeout(360_000);
  let admin: Client | null = null;
  let owner: Client | null = null;
  let user: User | null = null;
  try {
    const values = config();
    admin = client(values.url, values.secretKey);
    owner = client(values.url, values.publicKey);
    user = await createUser(admin);
    if ((await owner.auth.signInWithPassword({ email: user.email, password: user.password })).error) throw new Error("Evidence UI owner sign-in fixture failed.");
    const activityId = await createActivity(owner);
    const projectId = await createProject(owner);
    const achievementId = await createAchievement(owner, activityId);

    const movedId = randomUUID();
    const failedId = randomUUID();
    const pendingId = randomUUID();
    const longUnicodeFilename = "研究報告_".repeat(12) + "成果証明.pdf";
    const projectFile = evidence(randomUUID(), longUnicodeFilename, "ready");
    const activityItems: EvidencePublicRecord[] = [
      evidence(movedId, "Ready-movable-evidence.pdf", "ready"),
      evidence(failedId, "retry dossier résumé.pdf", "failed"),
      evidence(pendingId, "pending scan.pdf", "scanning"),
    ];
    const byParent = new Map<string, EvidencePublicRecord[]>([[activityId, activityItems], [achievementId, []], [projectId, [projectFile]]]);
    const parentByItem = new Map<string, string>([[movedId, activityId], [failedId, activityId], [pendingId, activityId], [projectFile.id, projectId]]);
    const reservationKeys: string[] = [];
    const reservationIds: string[] = [];
    const deletes: string[] = [];
    const moves: Array<{ itemId: string; targetId: string; itemRevision: number; targetRevision: number }> = [];
    let holdNextUpload = false;
    let notifyHeldUpload: () => void = () => {};
    let releaseHeldUpload: () => void = () => {};
    let heldUploadStarted: Promise<void> = Promise.resolve();
    let heldUploadGate: Promise<void> = Promise.resolve();

    await page.route("**/api/evidence**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 2 && request.method() === "GET") {
        const parentId = url.searchParams.get("parentId") ?? "";
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: byParent.get(parentId) ?? [] }) });
        return;
      }
      if (parts.length === 2 && request.method() === "POST") {
        const input = request.postDataJSON() as { parentId: string; filename: string; idempotencyKey: string };
        const id = randomUUID();
        reservationKeys.push(input.idempotencyKey);
        reservationIds.push(id);
        const reserved = evidence(id, input.filename, "uploading");
        parentByItem.set(id, input.parentId);
        byParent.set(input.parentId, [reserved, ...(byParent.get(input.parentId) ?? [])]);
        await route.fulfill(publicResponse(reserved));
        return;
      }
      const itemId = parts[2];
      const action = parts[3];
      const parentId = itemId ? parentByItem.get(itemId) : undefined;
      const record = itemId && parentId ? (byParent.get(parentId) ?? []).find((item) => item.id === itemId) : undefined;
      if (parts[0] === "api" && parts[1] === "evidence" && request.method() === "PUT" && action === "upload" && itemId && parentId && record) {
        if (holdNextUpload) {
          holdNextUpload = false;
          notifyHeldUpload();
          await heldUploadGate;
        }
        const scanning = { ...record, status: "scanning" as const, reservationExpiresAt: null, revision: record.revision + 1 };
        byParent.set(parentId, (byParent.get(parentId) ?? []).map((item) => item.id === itemId ? scanning : item));
        await route.fulfill(publicResponse(scanning));
        return;
      }
      if (parts.length === 3 && request.method() === "DELETE" && itemId && parentId && record) {
        deletes.push(itemId);
        const deleting = { ...record, status: "deleting" as const, revision: record.revision + 1 };
        byParent.set(parentId, (byParent.get(parentId) ?? []).map((item) => item.id === itemId ? deleting : item));
        await route.fulfill(publicResponse(deleting));
        return;
      }
      if (request.method() === "POST" && action === "move" && itemId && parentId && record) {
        const input = request.postDataJSON() as { targetAchievementId: string; expectedRevision: number; expectedTargetRevision: number };
        moves.push({ itemId, targetId: input.targetAchievementId, itemRevision: input.expectedRevision, targetRevision: input.expectedTargetRevision });
        byParent.set(parentId, (byParent.get(parentId) ?? []).filter((item) => item.id !== itemId));
        const updated = { ...record, revision: record.revision + 1 };
        byParent.set(input.targetAchievementId, [updated, ...(byParent.get(input.targetAchievementId) ?? [])]);
        parentByItem.set(itemId, input.targetAchievementId);
        await route.fulfill(publicResponse(updated));
        return;
      }
      if (request.method() === "POST" && action === "download") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "https://files.invalid/evidence.pdf" }) });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) });
    });

    await signIn(page, user);
    const activityUrl = "/activity/" + activityId + "?returnTo=%2Factivity";
    const projectUrl = "/projects/" + projectId + "?returnTo=%2Fprojects";
    const achievementUrl = "/achievements/" + achievementId + "?returnTo=%2Fachievements";
    await page.goto(activityUrl);
    await expect(page.getByText("Ready-movable-evidence.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("Security check in progress", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download pending scan.pdf", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Move pending scan.pdf to Untitled draft", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download retry dossier résumé.pdf", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Choose retry dossier résumé.pdf again to retry", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "retry replacement.pdf", mimeType: "application/pdf", buffer: TEST_PDF });
    await expect(page.getByText("Security check in progress", { exact: true }).nth(1)).toBeVisible();
    expect(reservationKeys).toHaveLength(1);
    const retryKey = reservationKeys[0];
    const retryId = reservationIds[0];
    expect(retryKey).toBeTruthy();
    expect(retryId).not.toBe(failedId);

    const removeFailed = page.getByRole("button", { name: "Remove retry dossier résumé.pdf", exact: true });
    await removeFailed.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("button", { name: "Remove file", exact: true });
    await expect(confirm).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(removeFailed).toBeFocused();
    expect(deletes).toHaveLength(0);
    await removeFailed.press("Enter");
    await page.getByRole("button", { name: "Remove file", exact: true }).click();
    await expect(page.getByText("Removing", { exact: true })).toBeVisible();
    expect(deletes).toContain(failedId);

    holdNextUpload = true;
    heldUploadStarted = new Promise((resolve) => { notifyHeldUpload = resolve; });
    heldUploadGate = new Promise((resolve) => { releaseHeldUpload = resolve; });
    await page.getByRole("button", { name: "Add file", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "new scan.pdf", mimeType: "application/pdf", buffer: TEST_PDF });
    await heldUploadStarted;
    await expect(page.getByText("Uploading", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download new scan.pdf", exact: true })).toHaveCount(0);
    releaseHeldUpload();
    await expect(page.getByText("Upload received. The file will be available after its security check.", { exact: true })).toBeVisible();
    const uploadId = reservationIds[1]!;
    const uploadKey = reservationKeys[1]!;
    expect(uploadId).not.toBe(retryId);
    expect(uploadKey).not.toBe(retryKey);
    await expect(page.getByRole("button", { name: "Download new scan.pdf", exact: true })).toHaveCount(0);

    byParent.set(activityId, (byParent.get(activityId) ?? []).map((item) => item.id === uploadId ? { ...item, status: "ready", revision: item.revision + 1 } : item));
    await page.getByRole("button", { name: "Refresh evidence", exact: true }).click();
    const moveButton = page.getByRole("button", { name: "Move new scan.pdf to Untitled draft", exact: true });
    await expect(moveButton).toBeVisible();
    await expect(page.getByRole("button", { name: "Download new scan.pdf", exact: true })).toBeVisible();
    await moveButton.click();
    await expect(page.getByText("File moved to Untitled draft.", { exact: true })).toBeVisible();
    expect(moves).toEqual([{ itemId: uploadId, targetId: achievementId, itemRevision: 3, targetRevision: 1 }]);

    await page.goto(projectUrl);
    await expect(page.getByText(longUnicodeFilename, { exact: true })).toBeVisible();
    await page.goto(achievementUrl);
    await expect(page.getByText("new scan.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText(longUnicodeFilename, { exact: true })).toHaveCount(0);
    await expectNoWcagViolations(page, test.info(), "evidence-achievement-detail");

    for (const route of [activityUrl, projectUrl, achievementUrl]) {
      for (const width of [360, 1440] as const) {
        for (const theme of ["light", "dark"] as const) await expectNoOverflow(page, route, width, theme);
      }
    }
  } finally {
    if (owner) await owner.auth.signOut();
    if (admin && user) {
      const deleted = await admin.auth.admin.deleteUser(user.id);
      if (deleted.error) throw new Error("Evidence UI fixture user cleanup failed.");
    }
  }
});
