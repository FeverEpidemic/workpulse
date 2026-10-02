import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { DashboardServiceError, createDashboardService } from "@/features/dashboard/dashboard-service";
import type { Database } from "@/server/supabase/database.types";

const ACTOR_ID = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";

const validSummary = {
  confirmed_achievement_count: 5,
  active_project_count: 1,
  demonstrated_skill_count: 2,
  missing_evidence_count: 4,
  completed_missing_outcome_count: 1,
  has_career_records: true,
};

interface FakeOptions {
  user?: { id: string } | null;
  summary?: { data: unknown; error: unknown | null };
  skills?: { data: unknown; error: unknown | null };
  activity?: { data: unknown; error: unknown | null };
  projects?: { data: unknown; error: unknown | null };
  cvReview?: { data: unknown; error: unknown | null };
}

function makeService(options: FakeOptions = {}) {
  const getUser = vi.fn().mockResolvedValue({ data: { user: options.user === undefined ? { id: ACTOR_ID } : options.user }, error: null });
  const rpcResponses: Record<string, { data: unknown; error: unknown | null }> = {
    get_dashboard_summary: options.summary ?? { data: [validSummary], error: null },
    list_demonstrated_skills: options.skills ?? { data: [], error: null },
    get_cv_review_summary: options.cvReview ?? { data: [{ has_cv: true, review_count: 0, available_count: 0 }], error: null },
  };
  const rpc = vi.fn(async (name: string) => rpcResponses[name] ?? { data: null, error: null });
  const from = vi.fn((table: string) => {
    const response = table === "activities"
      ? options.activity ?? { data: [], error: null }
      : options.projects ?? { data: [], error: null };
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn().mockResolvedValue(response),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    builder.order.mockReturnValue(builder);
    return builder;
  });
  const client = { auth: { getUser }, rpc, from } as unknown as SupabaseClient<Database>;
  return { service: createDashboardService(client), getUser, rpc, from };
}

async function rejectedDashboardError(promise: Promise<unknown>): Promise<DashboardServiceError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DashboardServiceError) return error;
    throw error;
  }
  throw new Error("Expected a DashboardServiceError");
}

describe("Dashboard service", () => {
  it("maps a missing summary row to sign-in recovery", async () => {
    const { service } = makeService({ summary: { data: [], error: null } });
    const error = await rejectedDashboardError(service.getDashboard());
    expect(error.code).toBe("UNAUTHENTICATED");
    expect(error.messageKey).toBe("auth.signInRequired");
  });

  it("maps RPC and invalid count failures to a safe unavailable error", async () => {
    const rpcFailure = await rejectedDashboardError(makeService({
      summary: { data: null, error: { message: "private database detail" } },
    }).service.getDashboard());
    expect(rpcFailure.code).toBe("UNAVAILABLE");
    expect(rpcFailure.message).not.toContain("private database detail");
    expect(rpcFailure.correlationId).toMatch(/^[0-9a-f-]{36}$/i);

    const invalidCount = await rejectedDashboardError(makeService({
      summary: { data: [{ ...validSummary, confirmed_achievement_count: -1 }], error: null },
    }).service.getDashboard());
    expect(invalidCount.code).toBe("UNAVAILABLE");
    expect(invalidCount.correlationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("accepts PostgreSQL timestamptz offsets in active project rows", async () => {
    const project = { id: "4b9d2123-d0fd-4e0f-aec6-b30f59e8663d", title: "Active project", updated_at: "2026-09-26T15:29:56+00:00" };
    const result = await makeService({ projects: { data: [project], error: null } }).service.getDashboard();
    expect(result.activeProjects).toEqual([project]);
  });

  it("does not query with an absent session", async () => {
    const { service, rpc, from } = makeService({ user: null });
    const error = await rejectedDashboardError(service.getDashboard());
    expect(error.code).toBe("UNAUTHENTICATED");
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it("maps the CV review summary into separate review and available counts", async () => {
    const { service, rpc } = makeService({ cvReview: { data: [{ has_cv: true, review_count: 3, available_count: 2 }], error: null } });
    const result = await service.getDashboard();
    expect(result.cvReview).toEqual({ hasCv: true, reviewCount: 3, availableCount: 2 });
    expect(rpc).toHaveBeenCalledWith("get_cv_review_summary");
    const withoutCv = await makeService({ cvReview: { data: [{ has_cv: false, review_count: 0, available_count: 5 }], error: null } }).service.getDashboard();
    expect(withoutCv.cvReview).toEqual({ hasCv: false, reviewCount: 0, availableCount: 5 });
  });

  it("treats a failing or malformed CV summary as unavailable and an empty one as signed out", async () => {
    const failing = await rejectedDashboardError(makeService({ cvReview: { data: null, error: { message: "private database detail" } } }).service.getDashboard());
    expect(failing.code).toBe("UNAVAILABLE");
    expect(failing.message).not.toContain("private database detail");
    const negative = await rejectedDashboardError(makeService({ cvReview: { data: [{ has_cv: true, review_count: -1, available_count: 0 }], error: null } }).service.getDashboard());
    expect(negative.code).toBe("UNAVAILABLE");
    const extra = await rejectedDashboardError(makeService({ cvReview: { data: [{ has_cv: true, review_count: 1, available_count: 0, title: "x" }], error: null } }).service.getDashboard());
    expect(extra.code).toBe("UNAVAILABLE");
    const empty = await rejectedDashboardError(makeService({ cvReview: { data: [], error: null } }).service.getDashboard());
    expect(empty.code).toBe("UNAUTHENTICATED");
  });});
