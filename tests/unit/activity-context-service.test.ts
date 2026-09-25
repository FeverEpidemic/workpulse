import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  ActivityContextServiceError,
  activityContextIssueFromError,
  listActivityContextOptions,
} from "@/features/activity/activity-context-service";
import type { Database } from "@/server/supabase/database.types";

const OWNER_ID = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";
const PRIVATE_PROVIDER_MESSAGE = "provider context failure with private source";

function queryBuilder(result: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  return builder;
}

function contextClient(experienceResult: unknown, projectResult: unknown): SupabaseClient<Database> {
  const experiences = queryBuilder(experienceResult);
  const projects = queryBuilder(projectResult);
  const from = vi.fn((table: string) => table === "experiences" ? experiences : projects);
  return { from } as unknown as SupabaseClient<Database>;
}

function expectUuid(value: string): void {
  expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

describe("Activity context error contract", () => {
  it("maps provider failures once to a safe localized error with a correlation ID", async () => {
    const error = await listActivityContextOptions(
      contextClient(
        { data: null, error: { code: "PGRST000", message: PRIVATE_PROVIDER_MESSAGE } },
        { data: [], error: null },
      ),
      OWNER_ID,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ActivityContextServiceError);
    const contextError = error as ActivityContextServiceError;
    expect(contextError.code).toBe("UNAVAILABLE");
    expect(contextError.messageKey).toBe("activity.contextOptionsUnavailable");
    expectUuid(contextError.correlationId);
    expect(contextError.message).not.toContain(PRIVATE_PROVIDER_MESSAGE);

    const forwarded = activityContextIssueFromError(contextError);
    expect(forwarded).toEqual({
      code: "UNAVAILABLE",
      messageKey: "activity.contextOptionsUnavailable",
      correlationId: contextError.correlationId,
    });
  });

  it("does not create a second correlation ID when the same error reaches a caller", () => {
    const error = new ActivityContextServiceError();
    expect(activityContextIssueFromError(error).correlationId).toBe(error.correlationId);
    expect(activityContextIssueFromError(error).correlationId).toBe(error.correlationId);
  });
});
