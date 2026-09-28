import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getRequestContext = vi.fn();
vi.mock("@/server/auth/context", () => ({ getRequestContext: () => getRequestContext() }));

const getAnalysisView = vi.fn();
vi.mock("@/features/ai/ai-review-service", () => ({ createAiReviewService: () => ({ getAnalysisView }) }));

const { GET } = await import("@/app/api/ai/activities/[id]/analysis/route");
const { AiServiceError } = await import("@/features/ai/ai-errors");

const ACTIVITY_ID = "4f1e1a52-8a6b-4d3c-9e21-0b7a5c4d2e11";

function context(id = ACTIVITY_ID) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/ai/activities/[id]/analysis", () => {
  it("answers 401 generically without a session", async () => {
    getRequestContext.mockResolvedValue({ configured: true, client: null, user: null, profile: null, profileUnavailable: false });
    const response = await GET(new Request("http://test"), context());
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ code: "UNAUTHENTICATED" }));
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(getAnalysisView).not.toHaveBeenCalled();
  });

  it("answers 404 generically for an activity the caller does not own (service throws NOT_FOUND)", async () => {
    getRequestContext.mockResolvedValue({
      configured: true, client: {}, user: { id: "u1" }, profile: { locale: "en", deleting_at: null }, profileUnavailable: false,
    });
    getAnalysisView.mockRejectedValue(new AiServiceError("NOT_FOUND"));
    const response = await GET(new Request("http://test"), context());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
  });

  it("answers 503 for a deleting account without calling the service", async () => {
    getRequestContext.mockResolvedValue({
      configured: true, client: {}, user: { id: "u1" }, profile: { locale: "en", deleting_at: "2026-09-28T00:00:00Z" }, profileUnavailable: false,
    });
    const response = await GET(new Request("http://test"), context());
    expect(response.status).toBe(401);
    expect(getAnalysisView).not.toHaveBeenCalled();
  });

  it("returns the view payload on success, never cached", async () => {
    getRequestContext.mockResolvedValue({
      configured: true, client: {}, user: { id: "u1" }, profile: { locale: "en", deleting_at: null }, profileUnavailable: false,
    });
    const payload = { activityRevision: 1, job: null, achievement: null, view: { state: "none", canRetry: false, canApply: false, applyBlockReason: null, visibleQuestions: [] } };
    getAnalysisView.mockResolvedValue(payload);
    const response = await GET(new Request("http://test"), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("never includes raw_text or an unrelated correlation id leak in an error body", async () => {
    getRequestContext.mockResolvedValue({
      configured: true, client: {}, user: { id: "u1" }, profile: { locale: "en", deleting_at: null }, profileUnavailable: false,
    });
    getAnalysisView.mockRejectedValue(new AiServiceError("UNAVAILABLE"));
    const response = await GET(new Request("http://test"), context());
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("raw_text");
  });
});
