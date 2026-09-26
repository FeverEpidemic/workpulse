import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActivityService } from "@/features/activity/activity-service";
import { createAchievementService } from "@/features/achievement/achievement-service";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

type Client = SupabaseClient<Database>;
type FileRow = { id: string; user_id: string; parent_kind: string; parent_id: string; parent_revision: number; status: string; revision: number; object_key: string; sha256: string | null; actual_bytes: number | null; scan_job_id: string | null; created_at: string; updated_at: string };
type RpcResult<T> = { data: T; error: { message: string } | null };
let admin: Client; let owner: Client; let other: Client; let userId = ""; let otherId = "";

async function rawRpc<T>(name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const client = admin as unknown as { rpc: (functionName: string, rpcArgs: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const result = await client.rpc(name, args);
  return { data: result.data as T, error: result.error as RpcResult<T>["error"] };
}

function required<T>(value: T | null | undefined, error: unknown, label: string): T {
  if (error || value === null || value === undefined) throw new Error(`Evidence lifecycle setup failed: ${label}`);
  return value;
}

async function createAccount() {
  const email = `evidence-lifecycle-${randomUUID()}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = required(created.data.user?.id, created.error, "account");
  const config = getSupabasePublicConfig()!;
  const client = createClient<Database>(config.url, config.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  required(login.data.user, login.error, "sign in");
  return { id, client };
}

async function activity(client: Client, rawText: string) {
  return createActivityService(client).createActivity({ operationKey: randomUUID(), captureMode: "note", rawText, occurredOn: "2026-09-25", role: null, scope: null, outcome: null, experienceId: null, projectId: null });
}

async function derivedAchievement(client: Client, activityId: string) {
  return createAchievementService(client).createAchievement({ operationKey: randomUUID(), activityId, projectId: null, experienceId: null });
}

async function reserve(parentId: string) {
  const { data, error } = await rawRpc<FileRow[]>("reserve_evidence_upload", { p_user_id: userId, p_parent_kind: "activity", p_parent_id: parentId, p_filename: "fixture.pdf", p_content_type: "application/pdf", p_expected_bytes: 20, p_idempotency_key: randomUUID(), p_expected_revision: 1 });
  return required(data?.[0] as FileRow | undefined, error, "reservation");
}

async function readyFile(parentId: string) {
  const file = await reserve(parentId);
  const finalized = await rawRpc<Array<{ scan_job_id: string }>>("finalize_evidence_upload", { p_user_id: userId, p_evidence_id: file.id, p_expected_revision: file.revision, p_actual_bytes: 20, p_verified_content_type: "application/pdf", p_sha256: "a".repeat(64) });
  const scanId = required(finalized.data?.[0]?.scan_job_id, finalized.error, "scan finalize");
  const claimed = await rawRpc<Array<{ id: string; attempt_token: string }>>("claim_evidence_scan_jobs", { p_limit: 100 });
  const job = required(claimed.data?.find((row) => row.id === scanId), claimed.error, "scan claim");
  const completed = await rawRpc<boolean>("complete_evidence_scan_job", { p_job_id: scanId, p_attempt_token: job.attempt_token, p_result: "clean" });
  if (completed.error || completed.data !== true) throw new Error("Evidence lifecycle setup failed: scan completion");
  return required((await rawRpc<FileRow[]>("get_evidence_file", { p_user_id: userId, p_evidence_id: file.id })).data?.[0], null, "ready evidence");
}

describe("T11 evidence listing and parent movement", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig(); const publicConfig = getSupabasePublicConfig();
    if (!adminConfig || !publicConfig) throw new Error("Local Supabase config required");
    admin = createClient<Database>(adminConfig.url, adminConfig.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const a = await createAccount(); userId = a.id; owner = a.client;
    const b = await createAccount(); otherId = b.id; other = b.client;
  });

  afterAll(async () => {
    await owner?.auth.signOut(); await other?.auth.signOut();
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
  });

  it("lists only exact direct children and hides cross-owner parent queries", async () => {
    const a = await activity(owner, "evidence list A");
    const b = await activity(owner, "evidence list B");
    const files = [await reserve(a.activityId), await reserve(a.activityId)];
    const exact = await rawRpc<Array<{ id: string; created_at: string }>>("list_evidence_files", { p_user_id: userId, p_parent_kind: "activity", p_parent_id: a.activityId });
    expect(exact.error).toBeNull(); expect(exact.data).toHaveLength(2);
    expect(exact.data).toEqual([...exact.data!].sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)));
    expect(exact.data?.map((row) => row.id).sort()).toEqual(files.map((file) => file.id).sort());
    const unrelated = await rawRpc<Array<{ id: string }>>("list_evidence_files", { p_user_id: userId, p_parent_kind: "activity", p_parent_id: b.activityId });
    expect(unrelated.error).toBeNull(); expect(unrelated.data).toEqual([]);
    const foreign = await rawRpc<Array<{ id: string }>>("list_evidence_files", { p_user_id: otherId, p_parent_kind: "activity", p_parent_id: a.activityId });
    expect(foreign.error).toBeNull(); expect(foreign.data).toEqual([]);
  });

  it("moves ready evidence to the Activity's derived Achievement and preserves its immutable storage receipt", async () => {
    const source = await activity(owner, "move evidence source");
    const target = await derivedAchievement(owner, source.activityId);
    const file = await readyFile(source.activityId);
    const moved = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: target.revision });
    expect(moved.error).toBeNull();
    expect(moved.data?.[0]).toMatchObject({ parent_kind: "achievement", parent_id: target.achievementId, parent_revision: target.revision, revision: file.revision + 1, status: "ready", object_key: file.object_key, sha256: file.sha256, actual_bytes: file.actual_bytes, scan_job_id: file.scan_job_id, created_at: file.created_at });
    const repeated = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: target.revision });
    expect(Boolean(repeated.error) || repeated.data?.length === 0).toBe(true);
  });

  it("rejects stale revisions, a full destination, and a foreign Achievement without changing the source", async () => {
    const source = await activity(owner, "move evidence rejection source");
    const target = await derivedAchievement(owner, source.activityId);
    await createAchievementService(owner).saveAchievement({ achievementId: target.achievementId, expectedRevision: target.revision, action: "save_draft", changes: { title: "Destination", contribution: "Moved evidence", scope: "", outcome: "Ready for review", achievedOn: "2026-09-25", cvBullet: "", metrics: [] }, skillNames: [] });
    const targetRevision = 2;
    const file = await readyFile(source.activityId);
    const stale = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: 99, p_expected_target_revision: target.revision });
    expect(stale.error?.message).toContain("STALE_REVISION");
    const staleTarget = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: target.revision });
    expect(staleTarget.error?.message).toContain("STALE_REVISION");

    const otherActivity = await activity(other, "owner boundary target");
    const foreignTarget = await derivedAchievement(other, otherActivity.activityId);
    const foreign = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: foreignTarget.achievementId, p_expected_revision: file.revision, p_expected_target_revision: foreignTarget.revision });
    expect(foreign.error).toBeNull(); expect(foreign.data).toEqual([]);

    const uploadingSource = await activity(owner, "uploading evidence move source");
    const uploadingTarget = await derivedAchievement(owner, uploadingSource.activityId);
    const uploadingFile = await reserve(uploadingSource.activityId);
    const notReady = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: uploadingFile.id, p_target_achievement_id: uploadingTarget.achievementId, p_expected_revision: uploadingFile.revision, p_expected_target_revision: uploadingTarget.revision });
    expect(notReady.error?.message).toContain("EVIDENCE_MOVE_STATE_CONFLICT");
    expect((await rawRpc<FileRow[]>("get_evidence_file", { p_user_id: userId, p_evidence_id: uploadingFile.id })).data?.[0]).toMatchObject({ parent_kind: "activity", parent_id: uploadingSource.activityId, revision: uploadingFile.revision });

    const fillers = await Promise.all(Array.from({ length: 3 }, () => rawRpc<FileRow[]>("reserve_evidence_upload", { p_user_id: userId, p_parent_kind: "achievement", p_parent_id: target.achievementId, p_filename: "filler.pdf", p_content_type: "application/pdf", p_expected_bytes: 20, p_idempotency_key: randomUUID(), p_expected_revision: targetRevision })));
    expect(fillers.every((row) => !row.error && row.data?.length === 1)).toBe(true);
    const full = await rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: targetRevision });
    expect(full.error?.message).toContain("EVIDENCE_SLOT_LIMIT");
    const unchanged = await rawRpc<FileRow[]>("get_evidence_file", { p_user_id: userId, p_evidence_id: file.id });
    expect(unchanged.data?.[0]).toMatchObject({ parent_kind: "activity", parent_id: source.activityId, revision: file.revision, object_key: file.object_key, sha256: file.sha256, status: "ready" });
  });

  it("serializes concurrent moves competing for the final destination slot", async () => {
    const source = await activity(owner, "concurrent move source");
    const target = await derivedAchievement(owner, source.activityId);
    const fileA = await readyFile(source.activityId);
    const fileB = await readyFile(source.activityId);
    await Promise.all(Array.from({ length: 2 }, () => rawRpc<FileRow[]>("reserve_evidence_upload", { p_user_id: userId, p_parent_kind: "achievement", p_parent_id: target.achievementId, p_filename: "filler.pdf", p_content_type: "application/pdf", p_expected_bytes: 20, p_idempotency_key: randomUUID(), p_expected_revision: target.revision })));
    const moves = await Promise.all([fileA, fileB].map((file) => rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: target.revision })));
    expect(moves.filter((result) => !result.error && result.data.length === 1)).toHaveLength(1);
    expect(moves.filter((result) => result.error?.message.includes("EVIDENCE_SLOT_LIMIT"))).toHaveLength(1);
  });

  it("keeps source deletion and movement atomic under the shared parent lock order", async () => {
    const source = await activity(owner, "move deletion race");
    const target = await derivedAchievement(owner, source.activityId);
    const file = await readyFile(source.activityId);
    const [move, deletion] = await Promise.all([
      rawRpc<FileRow[]>("move_activity_evidence_to_achievement", { p_user_id: userId, p_evidence_id: file.id, p_target_achievement_id: target.achievementId, p_expected_revision: file.revision, p_expected_target_revision: target.revision }),
      createActivityService(owner).deleteActivity({ activityId: source.activityId, expectedRevision: 1 }),
    ]);
    expect(deletion.retainedAchievementCount).toBe(1);
    expect(move.error).toBeNull();
    const current = await rawRpc<FileRow[]>("get_evidence_file", { p_user_id: userId, p_evidence_id: file.id });
    if (move.data.length === 1) {
      expect(current.data?.[0]).toMatchObject({ parent_kind: "achievement", parent_id: target.achievementId });
    } else {
      expect(current.data).toEqual([]);
    }
  });
});
