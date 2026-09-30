import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestContext = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/context", () => ({ getRequestContext: () => getRequestContext() }));
vi.mock("@/server/supabase/admin", () => ({ getSupabaseAdminClient: () => ({}) }));
vi.mock("@/server/storage/supabase-storage-adapter", () => ({ SupabaseStorageAdapter: class {} }));
vi.mock("@/server/supabase/config", () => ({ getTrustedSiteUrl: () => "http://localhost" }));

import { GET } from "@/app/api/imports/[id]/review/route";

const BATCH = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const OWNER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";

function client(batch: unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: batch, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  return { from: () => chain, rpc: async () => ({ data: [], error: null }) };
}

const call = (id: string) => GET(new Request(`http://localhost/api/imports/${id}/review`), { params: Promise.resolve({ id }) });

describe("T17 GET /api/imports/[id]/review", () => {
  beforeEach(() => getRequestContext.mockReset());

  it("answers 401 with a generic body when signed out", async () => {
    getRequestContext.mockResolvedValue({ user: null, client: null, profile: null });
    const response = await call(BATCH);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["code", "correlationId", "message"]);
  });

  it("answers the same 404 for a foreign, missing or malformed id, without candidate text", async () => {
    getRequestContext.mockResolvedValue({ user: { id: OWNER }, client: client(null), profile: { locale: "en" } });
    for (const id of [BATCH, "not-a-uuid"]) {
      const response = await call(id);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).not.toContain(SENTINEL);
      expect(JSON.parse(text)).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("returns the owner's saved review state with no-store caching", async () => {
    const batch = { id: BATCH, filename: "cv.pdf", status: "committed", stage: "done", error_code: null, revision: 3, commit_result: null };
    const profile = { onboarding_completed_at: "2026-09-01T00:00:00Z", headline: null };
    const table = (single: unknown) => {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: single, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    };
    const from = vi.fn((name: string) => table(name === "import_batches" ? batch : profile));
    getRequestContext.mockResolvedValue({ user: { id: OWNER }, client: { from, rpc: vi.fn() }, profile: { locale: "id" } });
    const response = await call(BATCH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).batch).toMatchObject({ id: BATCH, status: "committed" });
  });
});

