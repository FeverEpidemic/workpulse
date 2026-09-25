import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/context", () => ({ getRequestContext: vi.fn(async () => ({ user: null, profile: null })) }));
vi.mock("@/server/supabase/admin", () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock("@/server/supabase/config", () => ({ getTrustedSiteUrl: () => "http://127.0.0.1:3000" }));
import { evidenceHttp, evidenceJson } from "@/features/evidence/http";
import { getRequestContext } from "@/server/auth/context";

describe("evidence HTTP boundary", () => {
  it("rejects cross-origin mutation before reading session or invoking service", async () => {
    const action = vi.fn(); vi.mocked(getRequestContext).mockClear();
    const response = await evidenceHttp(new Request("http://127.0.0.1:3000/api/evidence", { method: "POST", headers: { origin: "https://foreign.test" } }), true, action);
    expect(response.status).toBe(400); expect(action).not.toHaveBeenCalled(); expect(getRequestContext).not.toHaveBeenCalled();
  });
  it("returns safe correlated auth error with no-cache", async () => {
    const response = await evidenceHttp(new Request("http://127.0.0.1:3000/api/evidence"), false, vi.fn());
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED", correlationId: expect.any(String) });
  });
  it("rejects metadata over 4 KiB and non-JSON bodies", async () => {
    await expect(evidenceJson(new Request("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a".repeat(4096) }) }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(evidenceJson(new Request("http://localhost", { method: "POST", body: "{}" }))).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
