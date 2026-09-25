import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import { createProjectService } from "@/features/project/project-service";
import type { Database } from "@/server/supabase/database.types";

type Evidence = { id: string; revision: number; status: string; object_key: string };
const MiB = 1024 * 1024;
let admin: SupabaseClient;
let owner: SupabaseClient;
let other: SupabaseClient;
let userId: string;
let otherId: string;

async function project(account = userId) {
  const client = account === userId ? owner : other;
  const result = await createProjectService(client as SupabaseClient<Database>).createProject({ operationKey: randomUUID(), title: "Evidence acceptance", description: null, userRole: null, outcome: null, status: "active", experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
  return result.projectId;
}

function reserveArgs(parent: string, bytes = 20, key = randomUUID()) {
  return { p_user_id: userId, p_parent_kind: "project", p_parent_id: parent, p_filename: "fixture.pdf", p_content_type: "application/pdf", p_expected_bytes: bytes, p_idempotency_key: key, p_expected_revision: 1 };
}

async function reserve(parent: string, bytes = 20) {
  const { data, error } = await admin.rpc("reserve_evidence_upload", reserveArgs(parent, bytes));
  if (error || !data?.[0]) throw new Error(`Reservation failed: ${error?.message ?? "missing receipt"}`);
  return data[0] as Evidence;
}

async function getFile(id: string, account = userId) {
  const { data, error } = await admin.rpc("get_evidence_file", { p_user_id: account, p_evidence_id: id });
  if (error) throw new Error(`Evidence read failed: ${error.message}`);
  return data?.[0] as Evidence | undefined;
}

async function accountFixture() {
  const email = `evidence-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const result = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error || !result.data.user) throw new Error("Evidence account fixture failed");
  const config = getSupabasePublicConfig()!;
  const client = createClient(config.url, config.publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Evidence fixture sign-in failed");
  return { id: result.data.user.id, client };
}

describe("T10 real PostgreSQL evidence boundaries", () => {
  beforeEach(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const config = getSupabaseAdminConfig();
    if (!config || !getSupabasePublicConfig()) throw new Error("Local Supabase config required");
    admin = createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const a = await accountFixture(); userId = a.id; owner = a.client;
    const b = await accountFixture(); otherId = b.id; other = b.client;
  });
  afterEach(async () => {
    await owner?.auth.signOut(); await other?.auth.signOut();
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
  });

  it("serializes competing last-slot uploads and preserves idempotency", async () => {
    const parent = await project();
    await reserve(parent); await reserve(parent);
    const races = await Promise.all(Array.from({ length: 6 }, () => admin.rpc("reserve_evidence_upload", reserveArgs(parent))));
    expect(races.filter((r) => !r.error && r.data?.length === 1)).toHaveLength(1);
    expect(races.filter((r) => r.error?.message.includes("EVIDENCE_SLOT_LIMIT"))).toHaveLength(5);
    const freshParent = await project();
    const args = reserveArgs(freshParent);
    const first = await admin.rpc("reserve_evidence_upload", args);
    const duplicate = await admin.rpc("reserve_evidence_upload", args);
    expect(first.error).toBeNull(); expect(duplicate.error).toBeNull();
    expect(duplicate.data?.[0]?.id).toBe(first.data?.[0]?.id);
    const changed = await admin.rpc("reserve_evidence_upload", { ...args, p_expected_bytes: 21 });
    expect(changed.error?.message).toContain("IDEMPOTENCY_KEY_REUSED");
  });

  it("serializes the 50 MiB account boundary across different parents and returns failed quota", async () => {
    const parents = await Promise.all(Array.from({ length: 4 }, () => project()));
    await reserve(parents[0]!, 10 * MiB); await reserve(parents[0]!, 10 * MiB);
    await reserve(parents[1]!, 10 * MiB); await reserve(parents[1]!, 10 * MiB);
    const results = await Promise.all(parents.slice(2).map((p) => admin.rpc("reserve_evidence_upload", reserveArgs(p, 10 * MiB))));
    const success = results.find((r) => !r.error)?.data?.[0] as Evidence;
    expect(success).toBeDefined();
    expect(results.filter((r) => r.error?.message.includes("EVIDENCE_QUOTA_EXCEEDED"))).toHaveLength(1);
    const failed = await admin.rpc("fail_evidence_upload", { p_user_id: userId, p_evidence_id: success.id, p_expected_revision: success.revision, p_error_code: "UPLOAD_FAILED" });
    expect(failed.error).toBeNull();
    expect((await reserve(await project(), 10 * MiB)).status).toBe("uploading");
  });

  it("rejects client lifecycle writes, foreign parents and cross-account reads", async () => {
    const parent = await project();
    const file = await reserve(parent);
    const ownRead = await owner.from("evidence_files").select("id").eq("id", file.id);
    expect(ownRead.error).toBeNull(); expect(ownRead.data).toHaveLength(1);
    const foreignRead = await other.from("evidence_files").select("id").eq("id", file.id);
    expect(foreignRead.error).toBeNull(); expect(foreignRead.data).toHaveLength(0);
    expect(await getFile(file.id, otherId)).toBeUndefined();
    const direct = await owner.rpc("reserve_evidence_upload", reserveArgs(parent));
    expect(direct.error).not.toBeNull();
    const write = await owner.from("evidence_files").update({ status: "ready" }).eq("id", file.id);
    expect(write.error).not.toBeNull();
    expect((await getFile(file.id))?.status).toBe("uploading");
    const foreignParent = await admin.rpc("reserve_evidence_upload", reserveArgs(await project(otherId)));
    expect(Boolean(foreignParent.error) || foreignParent.data?.length === 0).toBe(true);
  });

  it("guards finalize revision and actual bytes, then rejects clean completion from an invalid token", async () => {
    const file = await reserve(await project());
    const args = { p_user_id: userId, p_evidence_id: file.id, p_expected_revision: file.revision, p_actual_bytes: 20, p_verified_content_type: "application/pdf", p_sha256: "a".repeat(64) };
    expect((await admin.rpc("finalize_evidence_upload", { ...args, p_expected_revision: 999 })).error?.message).toContain("STALE_REVISION");
    const mismatched = await reserve(await project());
    const invalidSize = await admin.rpc("finalize_evidence_upload", { ...args, p_evidence_id: mismatched.id, p_actual_bytes: 21 });
    expect(invalidSize.error).toBeNull(); expect(invalidSize.data?.[0]?.status).toBe("failed");
    const finalized = await admin.rpc("finalize_evidence_upload", args);
    expect(finalized.error).toBeNull(); expect(finalized.data?.[0]?.status).toBe("scanning");
    const repeated = await admin.rpc("finalize_evidence_upload", args);
    expect(repeated.error).toBeNull(); expect(repeated.data?.[0]?.id).toBe(file.id);
    const invalid = await admin.rpc("complete_evidence_scan_job", { p_job_id: finalized.data?.[0]?.scan_job_id, p_attempt_token: randomUUID(), p_result: "clean", p_error_code: null });
    expect(invalid.error).toBeNull(); expect(invalid.data).toBe(false);
    expect((await getFile(file.id))?.status).toBe("scanning");
  });

  it("blocks writes for deleting accounts and closes access when a parent is deleted", async () => {
    const parent = await project();
    const file = await reserve(parent);
    const deletion = await owner.rpc("delete_project", { p_project_id: parent, p_expected_revision: 1 });
    expect(deletion.error).toBeNull();
    expect(await getFile(file.id)).toBeUndefined();
    const remaining = await project();
    expect((await admin.from("profiles").update({ deleting_at: new Date().toISOString() }).eq("id", userId)).error).toBeNull();
    expect((await admin.rpc("reserve_evidence_upload", reserveArgs(remaining))).error).not.toBeNull();
  });

  it("reclaims abandoned reservations without allowing a concurrent late finalize", async () => {
    const parent = await project();
    const file = await reserve(parent);
    await reserve(parent); await reserve(parent);
    // Test-only clock fixture through the local DB administrator; the production API
    // intentionally provides no way to mutate reservation timestamps.
    execFileSync("docker", ["exec", process.env.WORKPULSE_TEST_DB_CONTAINER ?? "supabase_db_WorkPulse", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `update public.evidence_files set reserved_until=now()-interval '1 minute' where id='${file.id}'::uuid`], { stdio: "pipe" });
    const [sweep, finalize] = await Promise.all([
      admin.rpc("expire_evidence_uploads", { p_limit: 100 }),
      admin.rpc("finalize_evidence_upload", { p_user_id: userId, p_evidence_id: file.id, p_expected_revision: file.revision, p_actual_bytes: 20, p_verified_content_type: "application/pdf", p_sha256: "a".repeat(64) }),
    ]);
    expect(sweep.error).toBeNull();
    expect(Boolean(finalize.error) || finalize.data?.[0]?.status === "failed").toBe(true);
    expect((await reserve(parent)).status).toBe("uploading");
    expect((await getFile(file.id))?.status).not.toBe("ready");
  });

  it("serializes parent deletion racing reservation without an orphan canonical row", async () => {
    const parent = await project();
    const [reservation, deletion] = await Promise.all([
      admin.rpc("reserve_evidence_upload", reserveArgs(parent)),
      owner.rpc("delete_project", { p_project_id: parent, p_expected_revision: 1 }),
    ]);
    expect(deletion.error).toBeNull();
    const rows = await admin.from("evidence_files").select("id").eq("project_id", parent);
    expect(rows.error).toBeNull(); expect(rows.data).toHaveLength(0);
    if (!reservation.error && reservation.data?.[0]) {
      expect(await getFile(reservation.data[0].id)).toBeUndefined();
    }
  });
});
