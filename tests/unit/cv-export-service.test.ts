import { describe, expect, it, vi } from "vitest";

import { CvServiceError, mapCvDatabaseError } from "@/features/cv/cv-errors";
import { createCvExportService } from "@/features/cv/export-service";
import { PrivateStorageError, type PrivateStorageService } from "@/server/storage/private-storage-service";

const USER = "11111111-1111-4111-8111-111111111111";
const CV = "22222222-2222-4222-8222-222222222222";
const CORRELATION = "33333333-3333-4333-8333-333333333333";
const EXPORT = "44444444-4444-4444-8444-444444444444";
const ITEM = "a5000000-0000-4000-8000-0000000000a1";
const TOKEN = "55555555-5555-4555-8555-555555555555";
const OBJECT_KEY = `${USER}/export/${TOKEN}`;
const SENTINEL = "WP-PRIVATE-CV-SENTINEL-9c2e";

type Row = Record<string, unknown>;

function fakeClient(options: {
  user?: { id: string } | null;
  authError?: unknown;
  rows?: Row[];
  rpc?: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
} = {}) {
  const queries: { table: string; columns?: string; filters: [string, unknown][]; order?: string; limit?: number }[] = [];
  const rpc = vi.fn(options.rpc ?? (async () => ({ data: null, error: null })));
  const client = {
    auth: { getUser: async () => ({ data: { user: options.user === undefined ? { id: USER } : options.user }, error: options.authError ?? null }) },
    rpc,
    from(table: string) {
      const record: (typeof queries)[number] = { table, filters: [] };
      queries.push(record);
      const query: Record<string, unknown> = {
        select(columns?: string) { record.columns = columns; return query; },
        eq(column: string, value: unknown) { record.filters.push([column, value]); return query; },
        order(column: string) { record.order = column; return query; },
        limit(count: number) { record.limit = count; return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: options.rows ?? [], error: null }).then(resolve); },
      };
      return query;
    },
  };
  return { client: client as never, rpc, queries };
}

function storageStub(overrides: Partial<PrivateStorageService> = {}): PrivateStorageService {
  return {
    issueDownload: vi.fn(async () => ({ url: "https://storage.example/signed?token=abc", expiresInSeconds: 300 })),
    deleteObject: vi.fn(async () => undefined),
    ...overrides,
  };
}

function service(client: never, storage: PrivateStorageService = storageStub()) {
  return createCvExportService({ supabase: client, getStorage: () => storage, correlationId: CORRELATION });
}

const exportRow = (overrides: Row = {}): Row => ({
  id: EXPORT, cv_id: CV, cv_revision: 4, status: "queued", error_code: null, attempt_count: 0, page_count: null, byte_size: null,
  started_at: null, finished_at: null, expires_at: null, purged_at: null, created_at: "2026-10-06T10:00:00Z", updated_at: "2026-10-06T10:00:00Z", revision: 1,
  ...overrides,
});

describe("T21 CV export service: auth and validation", () => {
  it("reports an anonymous caller as unauthenticated without a database call", async () => {
    const { client, rpc, queries } = fakeClient({ user: null });
    const svc = service(client);
    for (const call of [
      () => svc.getReadiness(),
      () => svc.listExports(),
      () => svc.requestExport({ expected_revision: 1, idempotency_key: "k" }),
      () => svc.retryExport({ export_id: EXPORT }),
      () => svc.issueDownload({ export_id: EXPORT }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "UNAUTHENTICATED", messageKey: "auth.signInRequired", correlationId: CORRELATION });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("rejects malformed input before any database call", async () => {
    const { client, rpc } = fakeClient();
    const svc = service(client);
    await expect(svc.requestExport({ expected_revision: 0, idempotency_key: "k" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.requestExport({ expected_revision: 1, idempotency_key: "bad key" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.requestExport({ expected_revision: 1, idempotency_key: "k", user_id: USER })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.retryExport({ export_id: "nope" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.issueDownload({ export_id: "nope" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("T21 CV export service: readiness and listing", () => {
  it("reads the readiness through the RPC and validates it", async () => {
    const { client, rpc } = fakeClient({
      rpc: async () => ({ data: [{ has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_CHANGED", item_id: ITEM }, { code: "NAME_REQUIRED" }] }], error: null }),
    });
    await expect(service(client).getReadiness()).resolves.toEqual({
      has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_CHANGED", item_id: ITEM }, { code: "NAME_REQUIRED" }],
    });
    expect(rpc).toHaveBeenCalledWith("get_cv_export_readiness");
  });

  it("treats an account without a readiness row (deleting) as unauthenticated and a malformed row as unavailable", async () => {
    const empty = fakeClient({ rpc: async () => ({ data: [], error: null }) });
    await expect(service(empty.client).getReadiness()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const broken = fakeClient({ rpc: async () => ({ data: [{ has_cv: true, cv_revision: 8, ready: true, blockers: [{ code: "ITEM_CHANGED" }] }], error: null }) });
    await expect(service(broken.client).getReadiness()).rejects.toMatchObject({ code: "UNAVAILABLE", messageKey: "error.unavailable" });
    const failing = fakeClient({ rpc: async () => ({ data: null, error: { code: "XX000", message: `boom ${SENTINEL}` } }) });
    const error = await service(failing.client).getReadiness().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CvServiceError);
    expect(JSON.stringify({ message: (error as Error).message, code: (error as CvServiceError).code })).not.toContain(SENTINEL);
  });

  it("lists at most ten exports, newest first, with the safe columns only", async () => {
    const { client, queries } = fakeClient({ rows: [exportRow(), exportRow({ id: "66666666-6666-4666-8666-666666666666", status: "failed", attempt_count: 1, error_code: "RENDERER_TIMEOUT", finished_at: "2026-10-06T10:01:00Z" })] });
    const rows = await service(client).listExports(50);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: EXPORT, status: "queued" });
    const query = queries[0]!;
    expect(query.table).toBe("cv_exports");
    expect(query.filters).toEqual([["user_id", USER]]);
    expect(query.order).toBe("created_at");
    expect(query.limit).toBe(10);
    for (const forbidden of ["snapshot", "object_key", "attempt_token", "lease_expires_at", "idempotency_key", "user_id"]) {
      expect(query.columns!.split(",").map((column) => column.trim())).not.toContain(forbidden);
    }
    await service(client).listExports(3);
    expect(queries[1]!.limit).toBe(3);
  });

  it("rejects a listed row that carries a private column", async () => {
    const { client } = fakeClient({ rows: [exportRow({ object_key: OBJECT_KEY })] });
    await expect(service(client).listExports()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("T21 CV export service: request and retry", () => {
  it("requests an export with the session-owned arguments only", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: [{ export_id: EXPORT, status: "queued", cv_revision: 4, reused: false }], error: null }) });
    await expect(service(client).requestExport({ expected_revision: 4, idempotency_key: "  req-1  " })).resolves.toEqual({
      exportId: EXPORT, status: "queued", cvRevision: 4, reused: false,
    });
    expect(rpc).toHaveBeenCalledWith("request_cv_export", { p_expected_revision: 4, p_idempotency_key: "req-1" });
  });

  it("rejects a malformed request receipt", async () => {
    const { client } = fakeClient({ rpc: async () => ({ data: [{ export_id: "nope", status: "queued", cv_revision: 4, reused: false }], error: null }) });
    await expect(service(client).requestExport({ expected_revision: 4, idempotency_key: "k" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("retries the same snapshot through the RPC", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: [{ export_id: EXPORT, status: "queued", attempt_count: 2 }], error: null }) });
    await expect(service(client).retryExport({ export_id: EXPORT })).resolves.toEqual({ exportId: EXPORT, status: "queued", attemptCount: 2 });
    expect(rpc).toHaveBeenCalledWith("retry_cv_export", { p_export_id: EXPORT });
  });

  it.each([
    ["CV_EXPORT_BLOCKED", "EXPORT_BLOCKED", "cv.export.error.blocked"],
    ["CV_EXPORT_IN_PROGRESS", "EXPORT_IN_PROGRESS", "cv.export.error.inProgress"],
    ["CV_EXPORT_NOT_FOUND", "EXPORT_NOT_FOUND", "cv.export.error.notFound"],
    ["CV_EXPORT_NOT_RETRYABLE", "EXPORT_NOT_RETRYABLE", "cv.export.error.notRetryable"],
    ["CV_EXPORT_NOT_READY", "EXPORT_NOT_READY", "cv.export.error.notReady"],
    ["CV_EXPORT_EXPIRED", "EXPORT_EXPIRED", "cv.export.error.expired"],
    ["IDEMPOTENCY_KEY_REUSED", "CONFLICT", "error.conflict"],
    ["STALE_REVISION", "CONFLICT", "error.conflict"],
    ["CV_NOT_FOUND", "NOT_FOUND", "error.notFound"],
    ["ONBOARDING_REQUIRED", "ONBOARDING_REQUIRED", "cv.error.onboardingRequired"],
    ["INVALID_CV_INPUT", "VALIDATION", "error.validation"],
    ["AUTH_REQUIRED", "UNAUTHENTICATED", "auth.signInRequired"],
    ["CV_EXPORT_IMMUTABLE", "UNAVAILABLE", "error.unavailable"],
  ] as const)("maps %s to %s with a message key and the correlation id", (message, code, messageKey) => {
    const error = mapCvDatabaseError({ code: "P0001", message }, CORRELATION);
    expect(error).toMatchObject({ code, messageKey, correlationId: CORRELATION });
  });

  it("carries the blockers of CV_EXPORT_BLOCKED from the detail", async () => {
    const detail = JSON.stringify({ blockers: [{ code: "ITEM_DELETED", item_id: ITEM }, { code: "NAME_REQUIRED" }] });
    const { client } = fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message: "CV_EXPORT_BLOCKED", details: detail } }) });
    const error = await service(client).requestExport({ expected_revision: 4, idempotency_key: "k" }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "EXPORT_BLOCKED", messageKey: "cv.export.error.blocked", correlationId: CORRELATION });
    expect((error as CvServiceError).blockers).toEqual([{ code: "ITEM_DELETED", item_id: ITEM }, { code: "NAME_REQUIRED" }]);
  });

  it("keeps EXPORT_BLOCKED with no blockers when the detail is broken or carries text", () => {
    for (const details of [null, undefined, "not json", JSON.stringify({ blockers: [{ code: "ITEM_CHANGED", text: SENTINEL }] }), JSON.stringify({ blockers: [{ code: SENTINEL }] }), JSON.stringify([SENTINEL])]) {
      const error = mapCvDatabaseError({ code: "P0001", message: "CV_EXPORT_BLOCKED", details }, CORRELATION);
      expect(error).toMatchObject({ code: "EXPORT_BLOCKED", blockers: [] });
      expect(JSON.stringify(error.blockers)).not.toContain(SENTINEL);
    }
  });

  it("never lets private text reach an error message", () => {
    for (const error of [
      mapCvDatabaseError({ code: "XX000", message: `fail ${SENTINEL}`, details: SENTINEL }, CORRELATION),
      mapCvDatabaseError({ code: "P0001", message: "CV_EXPORT_BLOCKED", details: SENTINEL }, CORRELATION),
    ]) {
      expect(error.message).not.toContain(SENTINEL);
      expect(JSON.stringify(error.blockers)).not.toContain(SENTINEL);
    }
  });
});

describe("T21 CV export service: download", () => {
  const rpcKey = (key: unknown) => async () => ({ data: key, error: null });

  it("issues a signed URL of at most 300 seconds and never returns the object key", async () => {
    const storage = storageStub();
    const { client, rpc } = fakeClient({ rpc: rpcKey(OBJECT_KEY) });
    const result = await service(client, storage).issueDownload({ export_id: EXPORT });
    expect(rpc).toHaveBeenCalledWith("get_cv_export_download", { p_export_id: EXPORT });
    // T22: a download is an attachment with a generic name (WorkPulse-CV.pdf here, as the fake has no finished_at).
    expect(storage.issueDownload).toHaveBeenCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV.pdf" });
    expect(result).toEqual({ url: "https://storage.example/signed?token=abc", expiresInSeconds: 300 });
    expect(JSON.stringify(result)).not.toContain(OBJECT_KEY);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("maps expired, not ready and not found downloads without touching storage", async () => {
    for (const [message, code] of [["CV_EXPORT_EXPIRED", "EXPORT_EXPIRED"], ["CV_EXPORT_NOT_READY", "EXPORT_NOT_READY"], ["CV_EXPORT_NOT_FOUND", "EXPORT_NOT_FOUND"]] as const) {
      const storage = storageStub();
      const { client } = fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message } }) });
      await expect(service(client, storage).issueDownload({ export_id: EXPORT })).rejects.toMatchObject({ code, correlationId: CORRELATION });
      expect(storage.issueDownload).not.toHaveBeenCalled();
    }
  });

  it("refuses a key that is not an export object of the caller", async () => {
    for (const key of [
      null, "", 5, `${USER}/evidence/${TOKEN}`, `${USER}/import/${TOKEN}`, `22222222-2222-4222-8222-222222222223/export/${TOKEN}`, "not a key", `${OBJECT_KEY}.pdf`,
    ]) {
      const storage = storageStub();
      const { client } = fakeClient({ rpc: rpcKey(key) });
      await expect(service(client, storage).issueDownload({ export_id: EXPORT })).rejects.toMatchObject({ code: "UNAVAILABLE" });
      expect(storage.issueDownload).not.toHaveBeenCalled();
    }
  });

  it("reports a storage failure as unavailable without leaking its message", async () => {
    const storage = storageStub({ issueDownload: vi.fn(async () => { throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE"); }) });
    const { client } = fakeClient({ rpc: rpcKey(OBJECT_KEY) });
    const error = await service(client, storage).issueDownload({ export_id: EXPORT }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "UNAVAILABLE", messageKey: "error.unavailable", correlationId: CORRELATION });
    expect(String((error as Error).message)).not.toContain(OBJECT_KEY);
  });

  it("only builds the storage service when a download is requested", async () => {
    const getStorage = vi.fn(() => storageStub());
    const { client } = fakeClient({ rpc: async () => ({ data: [{ export_id: EXPORT, status: "queued", cv_revision: 4, reused: false }], error: null }) });
    await createCvExportService({ supabase: client, getStorage, correlationId: CORRELATION }).requestExport({ expected_revision: 4, idempotency_key: "k" });
    expect(getStorage).not.toHaveBeenCalled();
    const failing = createCvExportService({
      supabase: fakeClient({ rpc: rpcKey(OBJECT_KEY) }).client,
      getStorage: () => { throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE"); },
      correlationId: CORRELATION,
    });
    await expect(failing.issueDownload({ export_id: EXPORT })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("T22 CV export service: one export", () => {
  it("returns null for an id that is not a UUID without any database call", async () => {
    const { client, rpc, queries } = fakeClient({ rows: [exportRow()] });
    for (const id of ["nope", "", "4444", `${EXPORT}x`, "../../etc/passwd"]) {
      await expect(service(client).getExport(id)).resolves.toBeNull();
    }
    expect(queries).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reads one export of the caller with the safe columns only", async () => {
    const { client, queries } = fakeClient({ rows: [exportRow({ status: "succeeded", page_count: 2, byte_size: 2048, finished_at: "2026-10-07T01:00:05Z", expires_at: "2026-10-08T01:00:05Z" })] });
    await expect(service(client).getExport(EXPORT)).resolves.toMatchObject({ id: EXPORT, status: "succeeded", page_count: 2, cv_revision: 4 });
    const query = queries[0]!;
    expect(query.table).toBe("cv_exports");
    expect(query.filters).toEqual([["id", EXPORT], ["user_id", USER]]);
    expect(query.limit).toBe(1);
    for (const forbidden of ["snapshot", "object_key", "attempt_token", "lease_expires_at", "idempotency_key", "user_id"]) {
      expect(query.columns!.split(",").map((column) => column.trim())).not.toContain(forbidden);
    }
  });

  it("returns null when the caller has no such export (foreign or missing look the same)", async () => {
    const { client } = fakeClient({ rows: [] });
    await expect(service(client).getExport(EXPORT)).resolves.toBeNull();
  });

  it("fails closed on a row with a private column or a broken state, and for an anonymous caller", async () => {
    await expect(service(fakeClient({ rows: [exportRow({ object_key: OBJECT_KEY })] }).client).getExport(EXPORT)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(service(fakeClient({ rows: [exportRow({ status: "failed" })] }).client).getExport(EXPORT)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const anonymous = fakeClient({ user: null, rows: [exportRow()] });
    await expect(service(anonymous.client).getExport(EXPORT)).rejects.toMatchObject({ code: "UNAUTHENTICATED", correlationId: CORRELATION });
    expect(anonymous.queries).toEqual([]);
  });
});

describe("T22 CV export service: download disposition and name", () => {
  const rpcKey = async () => ({ data: OBJECT_KEY, error: null });
  const finished = [exportRow({ status: "succeeded", page_count: 2, byte_size: 2048, finished_at: "2026-10-07T23:30:00-05:00", expires_at: "2026-10-09T01:00:00Z" })];

  it("names an attachment WorkPulse-CV-<UTC day of finished_at>.pdf and defaults to an attachment", async () => {
    const storage = storageStub();
    const { client, queries } = fakeClient({ rpc: rpcKey, rows: finished });
    await service(client, storage).issueDownload({ export_id: EXPORT });
    expect(storage.issueDownload).toHaveBeenLastCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV-2026-10-08.pdf" });
    expect(queries[0]).toMatchObject({ table: "cv_exports", filters: [["id", EXPORT], ["user_id", USER]], limit: 1 });
    await service(client, storage).issueDownload({ export_id: EXPORT, disposition: "attachment" });
    expect(storage.issueDownload).toHaveBeenLastCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV-2026-10-08.pdf" });
  });

  it("signs an inline URL without a name and without reading the export row", async () => {
    const storage = storageStub();
    const { client, queries } = fakeClient({ rpc: rpcKey, rows: finished });
    await expect(service(client, storage).issueDownload({ export_id: EXPORT, disposition: "inline" })).resolves.toEqual({
      url: "https://storage.example/signed?token=abc", expiresInSeconds: 300,
    });
    expect(storage.issueDownload).toHaveBeenCalledWith(OBJECT_KEY, 300, { disposition: "inline" });
    expect(queries).toEqual([]);
  });

  it("falls back to the generic name when the row cannot be read, never failing the download over a name", async () => {
    const storage = storageStub();
    const failing = fakeClient({ rpc: rpcKey });
    (failing.client as unknown as { from: () => never }).from = () => { throw new Error(`boom ${SENTINEL}`); };
    await service(failing.client, storage).issueDownload({ export_id: EXPORT });
    expect(storage.issueDownload).toHaveBeenLastCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV.pdf" });
    const unreadable = fakeClient({ rpc: rpcKey, rows: [exportRow({ object_key: OBJECT_KEY })] });
    await service(unreadable.client, storage).issueDownload({ export_id: EXPORT });
    expect(storage.issueDownload).toHaveBeenLastCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV.pdf" });
  });

  it("rejects an unknown disposition before any database or storage call", async () => {
    const storage = storageStub();
    const { client, rpc, queries } = fakeClient({ rpc: rpcKey });
    for (const disposition of ["download", "ATTACHMENT", "", "inline; filename=x"]) {
      await expect(service(client, storage).issueDownload({ export_id: EXPORT, disposition })).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(service(client, storage).issueDownload({ export_id: EXPORT, filename: "x.pdf" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
    expect(storage.issueDownload).not.toHaveBeenCalled();
  });

  it("never puts the account's name, the object key or the snapshot into the name or the result", async () => {
    const storage = storageStub();
    const { client } = fakeClient({ rpc: rpcKey, rows: finished });
    const result = await service(client, storage).issueDownload({ export_id: EXPORT });
    const options = (storage.issueDownload as ReturnType<typeof vi.fn>).mock.calls.at(-1)![2] as { filename: string };
    expect(options.filename).toMatch(/^[A-Za-z0-9._-]{1,80}\.pdf$/);
    expect(JSON.stringify(result)).not.toContain(OBJECT_KEY);
    expect(JSON.stringify(result)).not.toContain(options.filename);
  });
});