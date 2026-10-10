import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestContext = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/context", () => ({ getRequestContext: () => getRequestContext() }));
vi.mock("@/server/storage/request-service", () => ({
  createRequestPrivateStorageService: () => { throw new Error("the status route never needs storage"); },
}));

import { GET } from "@/app/api/cv/exports/[id]/route";

const OWNER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const EXPORT = "44444444-4444-4444-8444-444444444444";
const OTHER = "55555555-5555-4555-8555-555555555555";
const SENTINEL = "WP-PRIVATE-CV-SENTINEL-route";

type Row = Record<string, unknown>;

const exportRow = (over: Row = {}): Row => ({
  id: EXPORT, cv_id: "22222222-2222-4222-8222-222222222222", cv_revision: 4, status: "succeeded", error_code: null, attempt_count: 1,
  page_count: 2, byte_size: 2048, started_at: "2026-10-07T01:00:00Z", finished_at: "2026-10-07T01:00:05Z", expires_at: "2099-01-01T00:00:00Z",
  purged_at: null, created_at: "2026-10-07T01:00:00Z", updated_at: "2026-10-07T01:00:05Z", revision: 2, ...over,
});

function client(rows: Row[] | { error: true }, filters: [string, unknown][] = []) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
    order: () => chain,
    limit: () => chain,
    then: (resolve: (value: unknown) => unknown) =>
      resolve("error" in rows ? { data: null, error: { code: "XX000", message: `boom ${SENTINEL}` } } : { data: rows, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: OWNER } }, error: null }) },
    from: () => chain,
    rpc: vi.fn(),
  };
}

const profile = (over: Row = {}) => ({ locale: "en", deleting_at: null, onboarding_completed_at: "2026-09-01T00:00:00Z", ...over });
const signedIn = (rows: Row[] | { error: true }, over: Row = {}, filters: [string, unknown][] = []) =>
  getRequestContext.mockResolvedValue({ user: { id: OWNER }, client: client(rows, filters), profile: profile(), profileUnavailable: false, ...over });
const call = (id: string) => GET(new Request(`http://localhost/api/cv/exports/${id}`), { params: Promise.resolve({ id }) });

describe("T22 GET /api/cv/exports/[id]", () => {
  beforeEach(() => getRequestContext.mockReset());

  it("answers 401 with a generic body and no-store when signed out or the account is deleting", async () => {
    getRequestContext.mockResolvedValue({ user: null, client: null, profile: null, profileUnavailable: false });
    const anonymous = await call(EXPORT);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(await anonymous.json()).sort()).toEqual(["code", "correlationId", "message"]);

    signedIn([exportRow()], { profile: profile({ deleting_at: "2026-10-07T00:00:00Z" }) });
    expect((await call(EXPORT)).status).toBe(401);
    signedIn([exportRow()], { profile: null });
    expect((await call(EXPORT)).status).toBe(401);
  });

  it("answers 503 when the profile cannot be read", async () => {
    signedIn([exportRow()], { profileUnavailable: true });
    const response = await call(EXPORT);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("returns the owner's export with only the safe columns plus expired, never cached", async () => {
    const filters: [string, unknown][] = [];
    signedIn([exportRow()], {}, filters);
    const response = await call(EXPORT);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual([
      "attempt_count", "byte_size", "created_at", "cv_id", "cv_revision", "error_code", "expired", "expires_at", "finished_at", "id",
      "page_count", "purged_at", "revision", "snapshot_purged_at", "started_at", "status", "updated_at",
    ]);
    expect(body).toMatchObject({ id: EXPORT, status: "succeeded", expired: false, cv_revision: 4, page_count: 2 });
    expect(filters).toEqual([["id", EXPORT], ["user_id", OWNER]]);
  });

  it("reports a succeeded export past its 24 hours, or purged, as expired", async () => {
    signedIn([exportRow({ expires_at: "2020-01-01T00:00:00Z" })]);
    expect((await (await call(EXPORT)).json()).expired).toBe(true);
    signedIn([exportRow({ purged_at: "2026-10-07T02:00:00Z" })]);
    expect((await (await call(EXPORT)).json()).expired).toBe(true);
    signedIn([exportRow({ status: "queued", attempt_count: 0, page_count: null, byte_size: null, started_at: null, finished_at: null, expires_at: null })]);
    expect((await (await call(EXPORT)).json()).expired).toBe(false);
  });

  it("answers the same generic 404 for a foreign, missing or malformed id, without any export data", async () => {
    signedIn([]);
    const bodies: Record<string, unknown>[] = [];
    for (const id of [EXPORT, OTHER, "not-a-uuid", "../../x", "4444"]) {
      const response = await call(id);
      expect(response.status, id).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(EXPORT);
      bodies.push(JSON.parse(text) as Record<string, unknown>);
    }
    expect(bodies[0]).toMatchObject({ code: "EXPORT_NOT_FOUND", message: "This export is no longer available." });
    for (const body of bodies) {
      expect(Object.keys(body).sort()).toEqual(["code", "correlationId", "message"]);
      expect({ ...body, correlationId: null }).toEqual({ ...bodies[0], correlationId: null });
    }
    expect(new Set(bodies.map((body) => body.correlationId)).size).toBe(bodies.length);
  });

  it("localizes the message by the profile language", async () => {
    signedIn([], { profile: profile({ locale: "id" }) });
    expect(await (await call(EXPORT)).json()).toMatchObject({ code: "EXPORT_NOT_FOUND", message: "Ekspor ini sudah tidak tersedia." });
  });

  it("answers 503 without leaking a database message", async () => {
    signedIn({ error: true });
    const response = await call(EXPORT);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain(SENTINEL);
    expect(JSON.parse(text)).toMatchObject({ code: "UNAVAILABLE" });
  });

  it("answers 503 for a row that carries a private column", async () => {
    signedIn([exportRow({ object_key: `${OWNER}/export/${OTHER}`, snapshot: { title: SENTINEL } })]);
    const response = await call(EXPORT);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain("object_key");
  });
});
