import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { ActivityServiceError, createActivityService, type ActivityServiceErrorCode } from "@/features/activity/activity-service";
import type { MessageKey } from "@/i18n/messages";
import type { Database } from "@/server/supabase/database.types";

const ACTOR_ID = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";
const ACTIVITY_ID = "69d5940d-288c-4d5b-a9a7-41954870c1b8";
const OPERATION_KEY = "bb781741-c3ab-4113-a873-ed0282e8311e";
const PRIVATE_SOURCE = "private-activity-source-9cc0e44d";

const validInput = {
  operationKey: OPERATION_KEY,
  captureMode: "note" as const,
  rawText: "A valid activity source note.",
  occurredOn: "2026-09-17",
};

const liveActivity = {
  id: ACTIVITY_ID,
  user_id: ACTOR_ID,
  raw_text: "Live row after a later edit.",
  occurred_on: "2026-09-17",
  capture_mode: "note",
  role: null,
  scope: null,
  outcome: null,
  experience_id: null,
  project_id: null,
  analysis_state: "not_requested",
  revision: 2,
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:01:00.000Z",
};

const rpcReceipt = {
  activity_id: ACTIVITY_ID,
  user_id: ACTOR_ID,
  revision: 1,
  occurred_on: "2026-09-17",
  capture_mode: "note",
};

interface FakeOptions {
  auth?: {
    data: { user: { id: string } | null };
    error: unknown | null;
  };
  authReject?: unknown;
  rpc?: { data: unknown; error: unknown | null };
  activity?: unknown | null;
}

function makeService(options: FakeOptions = {}) {
  const authResult = options.auth ?? { data: { user: { id: ACTOR_ID } }, error: null };
  const getUser = options.authReject
    ? vi.fn().mockRejectedValue(options.authReject)
    : vi.fn().mockResolvedValue(authResult);
  const rpc = vi.fn().mockResolvedValue(options.rpc ?? { data: [rpcReceipt], error: null });
  const from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: options.activity ?? liveActivity, error: null }),
  }));
  const client = {
    auth: { getUser },
    rpc,
    from,
  } as unknown as SupabaseClient<Database>;

  return { service: createActivityService(client), getUser, rpc, from };
}

async function rejectedActivityError(promise: Promise<unknown>): Promise<ActivityServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ActivityServiceError) return error;
    throw error;
  }
  throw new Error("Expected an ActivityServiceError");
}

function expectUuid(value: string): void {
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

describe("Activity service contract", () => {
  it("maps a missing session to localized sign-in recovery", async () => {
    const { service, rpc } = makeService({
      auth: { data: { user: null }, error: new AuthSessionMissingError() },
    });

    const error = await rejectedActivityError(service.createActivity(validInput));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.messageKey).toBe("auth.signInRequired");
    expectUuid(error.correlationId);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an invalid JWT", new AuthInvalidJwtError(PRIVATE_SOURCE)],
    ["an HTTP 403 auth response", new AuthApiError(PRIVATE_SOURCE, 403, "no_authorization")],
  ])("maps %s to localized sign-in recovery without echoing provider details", async (_label, authError) => {
    const { service } = makeService({ auth: { data: { user: null }, error: authError } });

    const error = await rejectedActivityError(service.createActivity(validInput));

    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.messageKey).toBe("auth.signInRequired");
    expect(error.message).not.toContain(PRIVATE_SOURCE);
    expect(error.correlationId).not.toContain(PRIVATE_SOURCE);
  });

  it("keeps retryable and unexpected auth failures unavailable and safe", async () => {
    const retryable = makeService({
      auth: {
        data: { user: null },
        error: new AuthRetryableFetchError(PRIVATE_SOURCE, 503),
      },
    });
    const retryableError = await rejectedActivityError(retryable.service.createActivity(validInput));

    expect(retryableError.code).toBe("UNAVAILABLE");
    expect(retryableError.messageKey).toBe("error.unavailable");
    expect(retryableError.message).not.toContain(PRIVATE_SOURCE);

    const thrown = makeService({ authReject: new Error(`transport failed: ${PRIVATE_SOURCE}`) });
    const thrownError = await rejectedActivityError(thrown.service.createActivity(validInput));

    expect(thrownError.code).toBe("UNAVAILABLE");
    expect(thrownError.messageKey).toBe("error.unavailable");
    expect(thrownError.message).not.toContain(PRIVATE_SOURCE);

    const untrustedMessage = makeService({
      auth: { data: { user: null }, error: new Error(`session_expired ${PRIVATE_SOURCE}`) },
    });
    const untrustedMessageError = await rejectedActivityError(untrustedMessage.service.createActivity(validInput));
    expect(untrustedMessageError.code).toBe("UNAVAILABLE");

    const contradictory = makeService({
      auth: { data: { user: { id: ACTOR_ID } }, error: new AuthSessionMissingError() },
    });
    const contradictoryError = await rejectedActivityError(contradictory.service.createActivity(validInput));
    expect(contradictoryError.code).toBe("UNAVAILABLE");
  });

  it("maps validation issues to localized field keys without copying input values", async () => {
    const { service, getUser } = makeService();
    const error = await rejectedActivityError(service.createActivity({
      ...validInput,
      rawText: PRIVATE_SOURCE + " ".repeat(10_001),
      occurredOn: "not-a-date",
    }));

    expect(error.code).toBe("VALIDATION");
    expect(error.messageKey).toBe("error.validation");
    expect(error.fieldErrors).toEqual({
      rawText: "error.validation",
      occurredOn: "error.validation",
    });
    expectUuid(error.correlationId);
    expect(JSON.stringify({ message: error.message, fieldErrors: error.fieldErrors, correlationId: error.correlationId }))
      .not.toContain(PRIVATE_SOURCE);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("returns the validated immutable RPC receipt without reading mutable Activity state", async () => {
    const { service, from } = makeService();

    const receipt = await service.createActivity(validInput);

    expect(receipt).toEqual({
      activityId: ACTIVITY_ID,
      userId: ACTOR_ID,
      revision: 1,
      occurredOn: "2026-09-17",
      captureMode: "note",
    });
    expect(Object.keys(receipt)).toEqual(["activityId", "userId", "revision", "occurredOn", "captureMode"]);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ["a foreign actor", [{ ...rpcReceipt, user_id: "2597d167-39de-4c0a-b26a-ad13d294fef7" }]],
    ["a changed revision", [{ ...rpcReceipt, revision: 2 }]],
    ["an invalid exact date", [{ ...rpcReceipt, occurred_on: "2026-02-30" }]],
    ["an unsupported capture mode", [{ ...rpcReceipt, capture_mode: "unknown" }]],
    ["multiple rows", [rpcReceipt, rpcReceipt]],
  ])("maps %s from the RPC to a safe unavailable error", async (_label, rows) => {
    const { service } = makeService({ rpc: { data: rows, error: null } });
    const error = await rejectedActivityError(service.createActivity(validInput));

    expect(error.code).toBe("UNAVAILABLE");
    expect(error.messageKey).toBe("error.unavailable");
    expect(error.message).not.toContain(PRIVATE_SOURCE);
  });

  it("assigns a new UUID and the matching dictionary key to every error code", () => {
    const keys: Record<ActivityServiceErrorCode, MessageKey> = {
      VALIDATION: "error.validation",
      UNAUTHENTICATED: "auth.signInRequired",
      NOT_FOUND: "error.notFound",
      CONFLICT: "error.conflict",
      IDEMPOTENCY_KEY_REUSED: "error.operationKeyReused",
      UNAVAILABLE: "error.unavailable",
    };
    const errors = Object.entries(keys).map(([code, messageKey]) => {
      const error = new ActivityServiceError(code as ActivityServiceErrorCode);
      expect(error.messageKey).toBe(messageKey);
      expect(error.message).not.toContain(PRIVATE_SOURCE);
      expectUuid(error.correlationId);
      return error;
    });

    expect(new Set(errors.map((error) => error.correlationId)).size).toBe(errors.length);
  });
});
