import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";

type ActivityClient = SupabaseClient<Database>;

let adminClient: ActivityClient | null = null;
let anonymousClient: ActivityClient | null = null;
let ownerClient: ActivityClient | null = null;
let otherClient: ActivityClient | null = null;
let ownerService: ReturnType<typeof createActivityService> | null = null;
let otherService: ReturnType<typeof createActivityService> | null = null;
let ownerId: string | null = null;
let otherId: string | null = null;
let ownerEmail: string | null = null;
let otherEmail: string | null = null;
let ownerPassword: string | null = null;
let otherPassword: string | null = null;
let ownerExperienceOneId: string | null = null;
let ownerExperienceTwoId: string | null = null;
let otherExperienceId: string | null = null;
let ownerProjectId: string | null = null;
let otherProjectId: string | null = null;

function requireResult<T>(data: T | null, error: unknown, label: string): T {
  if (error || data === null) throw new Error("Local Activity integration setup failed: " + label);
  return data;
}

function requireClients(): {
  admin: ActivityClient;
  owner: ActivityClient;
  other: ActivityClient;
  ownerActivities: ReturnType<typeof createActivityService>;
  otherActivities: ReturnType<typeof createActivityService>;
  ownerId: string;
  otherId: string;
  ownerExperienceOneId: string;
  ownerExperienceTwoId: string;
  otherExperienceId: string;
  ownerProjectId: string;
  otherProjectId: string;
} {
  if (
    !adminClient || !ownerClient || !otherClient || !ownerService || !otherService ||
    !ownerId || !otherId || !ownerExperienceOneId || !ownerExperienceTwoId ||
    !otherExperienceId || !ownerProjectId || !otherProjectId
  ) {
    throw new Error("Local Activity integration fixtures are unavailable");
  }
  return {
    admin: adminClient,
    owner: ownerClient,
    other: otherClient,
    ownerActivities: ownerService,
    otherActivities: otherService,
    ownerId,
    otherId,
    ownerExperienceOneId,
    ownerExperienceTwoId,
    otherExperienceId,
    ownerProjectId,
    otherProjectId,
  };
}

describe("local Activity persistence integration", () => {
  beforeAll(async () => {
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    const adminConfig = getSupabaseAdminConfig();
    const publicConfig = getSupabasePublicConfig();
    if (!adminConfig || !publicConfig) {
      throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
    }

    adminClient = createClient<Database>(adminConfig.url, adminConfig.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const suffix = randomUUID().replaceAll("-", "");
    ownerEmail = "activity-owner-" + suffix + "@workpulse.test";
    otherEmail = "activity-other-" + suffix + "@workpulse.test";
    ownerPassword = randomBytes(18).toString("base64url") + "Aa1!";
    otherPassword = randomBytes(18).toString("base64url") + "Bb2!";

    const ownerCreate = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { display_name: "Activity owner" },
    });
    const owner = requireResult(ownerCreate.data.user, ownerCreate.error, "owner creation");
    ownerId = owner.id;

    const otherCreate = await adminClient.auth.admin.createUser({
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
      user_metadata: { display_name: "Activity other" },
    });
    const other = requireResult(otherCreate.data.user, otherCreate.error, "second account creation");
    otherId = other.id;

    ownerClient = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    anonymousClient = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    otherClient = createClient<Database>(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const ownerSignIn = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    requireResult(ownerSignIn.data.user, ownerSignIn.error, "owner sign-in");

    const otherSignIn = await otherClient.auth.signInWithPassword({
      email: otherEmail,
      password: otherPassword,
    });
    requireResult(otherSignIn.data.user, otherSignIn.error, "second account sign-in");

    ownerService = createActivityService(ownerClient);
    otherService = createActivityService(otherClient);

    const ownerExperienceOneResult = await adminClient.from("experiences").insert({
      user_id: ownerId,
      organization: "Activity fixture",
      role_title: "Original context",
      kind: "employment",
    }).select("id").single();
    const ownerExperienceOne = requireResult(ownerExperienceOneResult.data, ownerExperienceOneResult.error, "owner experience creation");
    ownerExperienceOneId = ownerExperienceOne.id;

    const ownerExperienceTwoResult = await adminClient.from("experiences").insert({
      user_id: ownerId,
      organization: "Activity fixture",
      role_title: "Updated context",
      kind: "volunteer",
    }).select("id").single();
    ownerExperienceTwoId = requireResult(ownerExperienceTwoResult.data, ownerExperienceTwoResult.error, "second owner experience creation").id;

    const otherExperienceResult = await adminClient.from("experiences").insert({
      user_id: otherId,
      organization: "Other fixture",
      role_title: "Other context",
      kind: "internship",
    }).select("id").single();
    otherExperienceId = requireResult(otherExperienceResult.data, otherExperienceResult.error, "other account experience creation").id;

    const ownerProjectResult = await ownerClient.rpc("create_project_idempotent", {
      p_operation_key: randomUUID(),
      p_title: "Activity project",
      p_description: null,
      p_user_role: null,
      p_outcome: null,
      p_status: "active",
      p_start_date: null,
      p_start_precision: null,
      p_end_date: null,
      p_end_precision: null,
      p_is_current: false,
      p_experience_id: ownerExperienceOneId,
    } as unknown as Database["public"]["Functions"]["create_project_idempotent"]["Args"]);
    ownerProjectId = requireResult(ownerProjectResult.data?.[0] ?? null, ownerProjectResult.error, "owner project creation").project_id;

    const otherProjectResult = await otherClient.rpc("create_project_idempotent", {
      p_operation_key: randomUUID(),
      p_title: "Other project",
      p_description: null,
      p_user_role: null,
      p_outcome: null,
      p_status: "planned",
      p_start_date: null,
      p_start_precision: null,
      p_end_date: null,
      p_end_precision: null,
      p_is_current: false,
      p_experience_id: otherExperienceId,
    } as unknown as Database["public"]["Functions"]["create_project_idempotent"]["Args"]);
    otherProjectId = requireResult(otherProjectResult.data?.[0] ?? null, otherProjectResult.error, "other project creation").project_id;
  });

  afterAll(async () => {
    let cleanupFailed = false;
    if (adminClient) {
      if (ownerId) {
        const { error } = await adminClient.auth.admin.deleteUser(ownerId);
        cleanupFailed ||= Boolean(error);
      }
      if (otherId) {
        const { error } = await adminClient.auth.admin.deleteUser(otherId);
        cleanupFailed ||= Boolean(error);
      }
    }
    await ownerClient?.auth.signOut();
    await anonymousClient?.auth.signOut();
    await otherClient?.auth.signOut();
    if (cleanupFailed) throw new Error("Local Activity integration fixture cleanup failed");
  });

  it("maps Supabase's real missing-session result for an anonymous client to UNAUTHENTICATED", async () => {
    if (!anonymousClient) throw new Error("Local anonymous Activity client is unavailable");

    const authResult = await anonymousClient.auth.getUser();
    expect(isAuthSessionMissingError(authResult.error)).toBe(true);

    const anonymousActivities = createActivityService(anonymousClient);
    const error = await anonymousActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: "anonymous requests do not persist",
      occurredOn: "2026-09-17",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ActivityServiceError);
    expect((error as ActivityServiceError).code).toBe("UNAUTHENTICATED");
    expect((error as ActivityServiceError).messageKey).toBe("auth.signInRequired");
    expect((error as ActivityServiceError).correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("persists raw text exactly, creates Chat history atomically, and accepts the Unicode limit", async () => {
    const { ownerActivities } = requireClients();
    const rawText = "  original note\nwith Unicode 😀  ";
    const input = {
      operationKey: randomUUID(),
      captureMode: "chat" as const,
      rawText,
      occurredOn: "2026-09-17",
      role: "  Engineer  ",
      scope: "  Service reliability  ",
      outcome: "  Reduced queue latency  ",
    };

    const created = await ownerActivities.createActivity(input);
    expect(created).toEqual({
      activityId: expect.any(String),
      userId: ownerId,
      revision: 1,
      occurredOn: "2026-09-17",
      captureMode: "chat",
    });
    expect(Object.keys(created)).toEqual(["activityId", "userId", "revision", "occurredOn", "captureMode"]);
    expect(Object.isFrozen(created)).toBe(true);

    const detail = await ownerActivities.getActivity(created.activityId);
    expect(detail.activity.raw_text).toBe(rawText);
    expect(detail.activity.revision).toBe(1);
    expect(detail.activity.analysis_state).toBe("not_requested");
    expect(detail.activity.capture_mode).toBe("chat");
    expect(detail.activity.occurred_on).toBe("2026-09-17");
    expect(detail.activity.role).toBe("Engineer");
    expect(detail.activity.scope).toBe("Service reliability");
    expect(detail.activity.outcome).toBe("Reduced queue latency");
    expect(detail.chatMessages).toHaveLength(1);
    expect(detail.chatMessages[0]?.role).toBe("user");
    expect(detail.chatMessages[0]?.sequence_no).toBe(1);
    expect(detail.chatMessages[0]?.content).toBe(rawText);

    const replay = await ownerActivities.createActivity(input);
    expect(replay).toEqual(created);

    await expect(ownerActivities.createActivity({ ...input, rawText: " \t\n " }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(ownerActivities.createActivity({
      ...input,
      operationKey: randomUUID(),
      rawText: "x".repeat(10_001),
    })).rejects.toMatchObject({ code: "VALIDATION" });

    const unicodeText = "😀".repeat(10_000);
    const unicodeActivity = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: unicodeText,
      occurredOn: "2026-09-17",
    });
    const unicodeDetail = await ownerActivities.getActivity(unicodeActivity.activityId);
    expect(Array.from(unicodeDetail.activity.raw_text)).toHaveLength(10_000);
  });

  it("deduplicates concurrent create retries and returns an actionable revision conflict", async () => {
    const { ownerActivities } = requireClients();
    const input = {
      operationKey: randomUUID(),
      captureMode: "chat" as const,
      rawText: "concurrent identical request",
      occurredOn: "2026-09-17",
    };

    const [first, retry] = await Promise.all([
      ownerActivities.createActivity(input),
      ownerActivities.createActivity(input),
    ]);
    expect(first).toEqual(retry);

    const { count: activityCount, error: activityCountError } = await ownerClient!
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("id", first.activityId);
    expect(activityCountError).toBeNull();
    expect(activityCount).toBe(1);

    const { data: chatRows, error: chatError } = await ownerClient!
      .from("chat_messages")
      .select("id")
      .eq("activity_id", first.activityId);
    expect(chatError).toBeNull();
    expect(chatRows).toHaveLength(1);

    const reusedKey = await ownerActivities.createActivity({
      ...input,
      rawText: "different payload with the same key",
    }).catch((error: unknown) => error);
    expect(reusedKey).toBeInstanceOf(ActivityServiceError);
    expect((reusedKey as ActivityServiceError).code).toBe("IDEMPOTENCY_KEY_REUSED");
    const { count: changedPayloadActivityCount, error: changedPayloadCountError } = await ownerClient!
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("id", first.activityId);
    expect(changedPayloadCountError).toBeNull();
    expect(changedPayloadActivityCount).toBe(1);

    const editableInput = {
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: "revision race input",
      occurredOn: "2026-09-17",
    };
    const editable = await ownerActivities.createActivity(editableInput);
    const edits = await Promise.allSettled([
      ownerActivities.updateActivity({
        activityId: editable.activityId,
        expectedRevision: 1,
        rawText: "revision race winner A",
        occurredOn: "2026-09-17",
      }),
      ownerActivities.updateActivity({
        activityId: editable.activityId,
        expectedRevision: 1,
        rawText: "revision race winner B",
        occurredOn: "2026-09-17",
      }),
    ]);
    const successes = edits.filter((result) => result.status === "fulfilled");
    const conflicts = edits.filter((result) => result.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict?.status).toBe("rejected");
    if (conflict?.status === "rejected") {
      expect(conflict.reason).toBeInstanceOf(ActivityServiceError);
      expect(conflict.reason.code).toBe("CONFLICT");
      expect(conflict.reason.latestRecord?.revision).toBe(2);
      expect(conflict.reason.latestRecord?.raw_text).toMatch(/^revision race winner [AB]$/);
    }

    const replayAfterEdit = await ownerActivities.createActivity(editableInput);
    expect(replayAfterEdit).toEqual(editable);
    expect(replayAfterEdit.revision).toBe(1);

    const latest = await ownerActivities.getActivity(editable.activityId);
    expect(latest.activity.revision).toBe(2);
    expect(latest.activity.raw_text).toMatch(/^revision race winner [AB]$/);
  });

  it("enforces two-account ownership and denies direct table mutations", async () => {
    const { owner, other, ownerActivities, otherActivities, ownerId, otherId } = requireClients();
    const ownerChat = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "chat",
      rawText: "owner-only chat history",
      occurredOn: "2026-09-17",
    });
    const foreignActivity = await otherActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: "second account activity",
      occurredOn: "2026-09-17",
    });

    const foreignError = await ownerActivities.getActivity(foreignActivity.activityId).catch((error: unknown) => error);
    const missingError = await ownerActivities.getActivity(randomUUID()).catch((error: unknown) => error);
    expect(foreignError).toBeInstanceOf(ActivityServiceError);
    expect(missingError).toBeInstanceOf(ActivityServiceError);
    expect((foreignError as ActivityServiceError).code).toBe("NOT_FOUND");
    expect((missingError as ActivityServiceError).code).toBe("NOT_FOUND");
    expect((foreignError as Error).message).toBe((missingError as Error).message);

    const { data: foreignRows, error: foreignReadError } = await owner
      .from("activities")
      .select("id")
      .eq("id", foreignActivity.activityId);
    expect(foreignReadError).toBeNull();
    expect(foreignRows).toEqual([]);

    const directActivityInsert = await owner.from("activities").insert({
      user_id: ownerId,
      raw_text: "direct mutation",
      occurred_on: "2026-09-17",
      capture_mode: "note",
    });
    expect(directActivityInsert.error).not.toBeNull();

    const directActivityUpdate = await owner.from("activities")
      .update({ raw_text: "direct mutation" })
      .eq("id", ownerChat.activityId);
    expect(directActivityUpdate.error).not.toBeNull();

    const directActivityDelete = await owner.from("activities").delete().eq("id", ownerChat.activityId);
    expect(directActivityDelete.error).not.toBeNull();

    const directChatInsert = await owner.from("chat_messages").insert({
      user_id: ownerId,
      activity_id: ownerChat.activityId,
      role: "assistant",
      content: "direct mutation",
      sequence_no: 2,
    });
    expect(directChatInsert.error).not.toBeNull();

    const directChatUpdate = await owner.from("chat_messages")
      .update({ content: "direct mutation" })
      .eq("activity_id", ownerChat.activityId);
    expect(directChatUpdate.error).not.toBeNull();

    const directChatDelete = await owner.from("chat_messages").delete().eq("activity_id", ownerChat.activityId);
    expect(directChatDelete.error).not.toBeNull();

    const ownerPage = await ownerActivities.listActivities({ from: "2026-09-17", to: "2026-09-17" });
    expect(ownerPage.items.some((item) => item.id === foreignActivity.activityId)).toBe(false);
    expect(otherId).not.toBe(ownerId);
  });

  it("paginates 31 same-date rows without gaps and applies inclusive date/project filters", async () => {
    const { ownerActivities, ownerProjectId, ownerExperienceOneId } = requireClients();
    const projectActivity = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "project context filter fixture",
      occurredOn: "2025-01-15",
      experienceId: ownerExperienceOneId,
      projectId: ownerProjectId,
    });

    const fixtures = await Promise.all(Array.from({ length: 31 }, (_, index) => ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "note",
      rawText: "same-day pagination fixture " + index,
      occurredOn: "2024-04-01",
    })));

    const first = await ownerActivities.listActivities({ from: "2024-04-01", to: "2024-04-01" });
    expect(first.items).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();

    const second = await ownerActivities.listActivities({
      from: "2024-04-01",
      to: "2024-04-01",
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();

    const pageIds = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(pageIds).size).toBe(31);
    expect(pageIds).toEqual(fixtures.map((fixture) => fixture.activityId).sort().reverse());

    const projectPage = await ownerActivities.listActivities({
      from: "2025-01-15",
      to: "2025-01-15",
      projectId: ownerProjectId,
    });
    expect(projectPage.items.map((item) => item.id)).toEqual([projectActivity.activityId]);

    await expect(ownerActivities.listActivities({ from: "2025-01-16", to: "2025-01-15" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
    await expect(ownerActivities.listActivities({ cursor: "tampered" }))
      .rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps project and experience context consistent through existing lifecycle RPCs", async () => {
    const {
      owner,
      ownerActivities,
      ownerExperienceOneId,
      ownerExperienceTwoId,
      ownerProjectId,
    } = requireClients();

    const activityInput = {
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "context lifecycle source",
      occurredOn: "2025-01-15",
      experienceId: ownerExperienceOneId,
      projectId: ownerProjectId,
    };
    const activity = await ownerActivities.createActivity(activityInput);

    const standaloneExperienceActivity = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "standalone experience context",
      occurredOn: "2025-01-15",
      experienceId: ownerExperienceTwoId,
    });

    const mismatched = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "mismatched context",
      occurredOn: "2025-01-15",
      experienceId: ownerExperienceTwoId,
      projectId: ownerProjectId,
    }).catch((error: unknown) => error);
    expect(mismatched).toBeInstanceOf(ActivityServiceError);
    expect((mismatched as ActivityServiceError).code).toBe("VALIDATION");

    const foreignContext = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "foreign context",
      occurredOn: "2025-01-15",
      experienceId: otherExperienceId,
      projectId: otherProjectId,
    }).catch((error: unknown) => error);
    expect(foreignContext).toBeInstanceOf(ActivityServiceError);
    expect((foreignContext as ActivityServiceError).code).toBe("VALIDATION");

    const foreignExperience = await ownerActivities.createActivity({
      operationKey: randomUUID(),
      captureMode: "form",
      rawText: "foreign experience context",
      occurredOn: "2025-01-15",
      experienceId: otherExperienceId,
    }).catch((error: unknown) => error);
    expect(foreignExperience).toBeInstanceOf(ActivityServiceError);
    expect((foreignExperience as ActivityServiceError).code).toBe("VALIDATION");

    const projectUpdate = await owner.rpc("update_project", {
      p_project_id: ownerProjectId,
      p_expected_revision: 1,
      p_changes: { experience_id: ownerExperienceTwoId },
    });
    expect(projectUpdate.error).toBeNull();

    const propagated = await ownerActivities.getActivity(activity.activityId);
    expect(propagated.activity.experience_id).toBe(ownerExperienceTwoId);
    expect(propagated.activity.revision).toBe(2);
    const replayAfterPropagation = await ownerActivities.createActivity(activityInput);
    expect(replayAfterPropagation).toEqual(activity);
    expect(replayAfterPropagation.revision).toBe(1);

    const projectDelete = await owner.rpc("delete_project", {
      p_project_id: ownerProjectId,
      p_expected_revision: 2,
    });
    expect(projectDelete.error).toBeNull();

    const afterProjectDelete = await ownerActivities.getActivity(activity.activityId);
    expect(afterProjectDelete.activity.project_id).toBeNull();
    expect(afterProjectDelete.activity.experience_id).toBe(ownerExperienceTwoId);
    expect(afterProjectDelete.activity.revision).toBe(3);

    const experienceDelete = await owner.rpc("delete_experience", {
      p_experience_id: ownerExperienceTwoId,
      p_expected_revision: 1,
    });
    expect(experienceDelete.error).toBeNull();
    expect(experienceDelete.data).toHaveLength(1);

    const afterExperienceDelete = await ownerActivities.getActivity(activity.activityId);
    expect(afterExperienceDelete.activity.experience_id).toBeNull();
    expect(afterExperienceDelete.activity.project_id).toBeNull();
    expect(afterExperienceDelete.activity.revision).toBe(4);

    const afterStandaloneExperienceDelete = await ownerActivities.getActivity(standaloneExperienceActivity.activityId);
    expect(afterStandaloneExperienceDelete.activity.experience_id).toBeNull();
    expect(afterStandaloneExperienceDelete.activity.project_id).toBeNull();
    expect(afterStandaloneExperienceDelete.activity.revision).toBe(2);
  });
});
