import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker";
import { resolveMalwareScanner } from "../../src/server/storage/malware-scanner";

test("authenticated evidence HTTP endpoints enforce quarantine, ownership and CSRF", async ({ page, context, baseURL }) => {
  const url = process.env.SUPABASE_URL!; const secretKey = process.env.SUPABASE_SECRET_KEY!;
  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `evidence-http-${randomUUID()}@workpulse.test`; const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Evidence HTTP" } });
  const id = created.data.user?.id; if (!id || created.error) throw new Error("Evidence HTTP fixture failed");
  const gateway = createSupabaseEvidenceWorkerGateway({ url, secretKey });
  const scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
  const drain = async () => { for (let n = 0; n < 100; n++) { const pass = await runEvidenceWorkerOnce({ ...gateway, scanner }); if (!pass.scanJobsClaimed && !pass.cleanupJobsClaimed) return; } };
  try {
    const profile = await admin.from("profiles").update({ display_name: "Evidence HTTP", onboarding_completed_at: new Date().toISOString(), locale: "en", timezone: "Asia/Bangkok" }).eq("id", id);
    if (profile.error) throw new Error("Evidence HTTP profile fixture failed");
    await owner.auth.signInWithPassword({ email, password });
    const project = await owner.rpc("create_project_idempotent", { p_operation_key: randomUUID(), p_title: "Evidence HTTP parent", p_description: null, p_user_role: null, p_outcome: null, p_status: "active", p_start_date: null, p_start_precision: null, p_end_date: null, p_end_precision: null, p_is_current: false, p_experience_id: null });
    if (project.error || !project.data?.[0]) throw new Error("Evidence HTTP parent fixture failed");
    await page.goto("/sign-in");
    await page.getByLabel("Email address").fill(email); await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    const payload = Buffer.from("%PDF-1.7\nfixture\n%%EOF\n");
    const input = { parentKind: "project", parentId: project.data[0].project_id, filename: "fixture.pdf", contentType: "application/pdf", expectedBytes: payload.length, idempotencyKey: randomUUID(), expectedRevision: 1 };
    const csrf = await context.request.post("/api/evidence", { headers: { origin: "https://foreign.test" }, data: input }); expect(csrf.status()).toBe(400);
    const headers = { origin: baseURL! };
    const reserved = await context.request.post("/api/evidence", { headers, data: input }); expect(reserved.status()).toBe(200);
    const file = await reserved.json(); expect(file.status).toBe("uploading"); expect(file.objectKey).toBeUndefined();
    const pending = await context.request.post(`/api/evidence/${file.id}/download`, { headers }); expect(pending.status()).toBe(404);
    const uploaded = await context.request.put(`/api/evidence/${file.id}/upload`, { headers: { ...headers, "content-type": "application/pdf", "x-expected-revision": "1" }, data: payload });
    expect(uploaded.status()).toBe(200); expect((await uploaded.json()).status).toBe("scanning");
    await drain();
    const status = await context.request.get(`/api/evidence/${file.id}`); const ready = await status.json(); expect(ready.status).toBe("ready");
    const signed = await context.request.post(`/api/evidence/${file.id}/download`, { headers }); expect(signed.status()).toBe(200);
    const signedBody = await signed.json(); expect(signedBody.expiresInSeconds).toBe(300);
    const download = await context.request.get(signedBody.url); expect(download.headers()["content-disposition"]).toContain("attachment"); expect(await download.body()).toEqual(payload);
    const removal = await context.request.delete(`/api/evidence/${file.id}`, { headers, data: { expectedRevision: ready.revision } }); expect(removal.status()).toBe(200);
    expect((await context.request.post(`/api/evidence/${file.id}/download`, { headers })).status()).toBe(404);
    await drain();
  } finally {
    await owner.auth.signOut();
    const removed = await admin.auth.admin.deleteUser(id); if (removed.error) throw new Error("Evidence HTTP fixture cleanup failed");
    await drain();
  }
});
