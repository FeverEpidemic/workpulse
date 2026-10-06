import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const rpc = vi.fn();
const getUser = vi.fn();
const issueDownload = vi.fn();
const storageFactory = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args), auth: { getUser: () => getUser() } }),
}));
vi.mock("@/server/storage/request-service", () => ({
  createRequestPrivateStorageService: () => {
    storageFactory();
    return { issueDownload: (...args: unknown[]) => issueDownload(...args), deleteObject: async () => undefined };
  },
}));

import { issueCvExportDownloadAction, requestCvExportAction, retryCvExportAction } from "@/features/cv/actions";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const EXPORT = "44444444-4444-4444-8444-444444444444";
const ITEM = "a5000000-0000-4000-8000-0000000000a1";
const TOKEN = "55555555-5555-4555-8555-555555555555";
const OBJECT_KEY = `${USER}/export/${TOKEN}`;
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("T21 CV export actions", () => {
  beforeEach(() => {
    for (const mock of [revalidatePath, rpc, getUser, issueDownload, storageFactory]) mock.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    issueDownload.mockResolvedValue({ url: "https://storage.example/signed", expiresInSeconds: 300 });
  });

  it("requests an export and revalidates /cv only after success", async () => {
    rpc.mockResolvedValue({ data: [{ export_id: EXPORT, status: "queued", cv_revision: 4, reused: false }], error: null });
    const state = await requestCvExportAction(IDLE, form({ expected_revision: "4", idempotency_key: "req-1" }));
    expect(state).toMatchObject({ status: "success", data: { exportId: EXPORT, status: "queued", cvRevision: 4, reused: false } });
    expect(rpc).toHaveBeenCalledWith("request_cv_export", { p_expected_revision: 4, p_idempotency_key: "req-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
    expect(storageFactory).not.toHaveBeenCalled();
  });

  it("retries an export and revalidates /cv only after success", async () => {
    rpc.mockResolvedValue({ data: [{ export_id: EXPORT, status: "queued", attempt_count: 2 }], error: null });
    const state = await retryCvExportAction(IDLE, form({ export_id: EXPORT }));
    expect(state).toMatchObject({ status: "success", data: { exportId: EXPORT, attemptCount: 2 } });
    expect(rpc).toHaveBeenCalledWith("retry_cv_export", { p_export_id: EXPORT });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
  });

  it("issues a download URL without revalidating and without returning the object key", async () => {
    rpc.mockResolvedValue({ data: OBJECT_KEY, error: null });
    const state = await issueCvExportDownloadAction(IDLE, form({ export_id: EXPORT }));
    expect(state).toMatchObject({ status: "success", data: { url: "https://storage.example/signed", expiresInSeconds: 300 } });
    expect(issueDownload).toHaveBeenCalledWith(OBJECT_KEY, 300);
    expect(JSON.stringify(state)).not.toContain(OBJECT_KEY);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed input without a database call or revalidation", async () => {
    const results = await Promise.all([
      requestCvExportAction(IDLE, form({ expected_revision: "abc", idempotency_key: "k" })),
      requestCvExportAction(IDLE, form({ expected_revision: "0", idempotency_key: "k" })),
      requestCvExportAction(IDLE, form({ expected_revision: "1" })),
      requestCvExportAction(IDLE, form({ expected_revision: "1", idempotency_key: "bad key" })),
      retryCvExportAction(IDLE, form({ export_id: "nope" })),
      retryCvExportAction(IDLE, form({})),
      issueCvExportDownloadAction(IDLE, form({ export_id: "nope" })),
      issueCvExportDownloadAction(IDLE, form({})),
    ]);
    for (const state of results) expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION", messageKey: "error.validation" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the blockers of a blocked request and does not revalidate", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "CV_EXPORT_BLOCKED", details: JSON.stringify({ blockers: [{ code: "ITEM_CHANGED", item_id: ITEM }] }) },
    });
    const state = await requestCvExportAction(IDLE, form({ expected_revision: "4", idempotency_key: "req-1" }));
    expect(state).toMatchObject({
      status: "error",
      error: { code: "VALIDATION", messageKey: "cv.export.error.blocked", latestRecord: { blockers: [{ code: "ITEM_CHANGED", item_id: ITEM }] } },
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["CV_EXPORT_IN_PROGRESS", "CONFLICT", "cv.export.error.inProgress"],
    ["CV_EXPORT_NOT_RETRYABLE", "CONFLICT", "cv.export.error.notRetryable"],
    ["CV_EXPORT_NOT_FOUND", "NOT_FOUND", "cv.export.error.notFound"],
    ["CV_EXPORT_EXPIRED", "CONFLICT", "cv.export.error.expired"],
    ["CV_EXPORT_NOT_READY", "CONFLICT", "cv.export.error.notReady"],
    ["STALE_REVISION", "CONFLICT", "error.conflict"],
    ["IDEMPOTENCY_KEY_REUSED", "CONFLICT", "error.conflict"],
  ] as const)("maps %s to action code %s", async (message, code, messageKey) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message } });
    const state = await retryCvExportAction(IDLE, form({ export_id: EXPORT }));
    expect(state).toMatchObject({ status: "error", error: { code, messageKey } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uses one correlation ID for the service and the action error", async () => {
    const fixed = "99999999-9999-4999-8999-999999999999";
    const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce(fixed);
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_EXPORT_IN_PROGRESS" } });
    const state = await requestCvExportAction(IDLE, form({ expected_revision: "4", idempotency_key: "req-1" }));
    spy.mockRestore();
    expect(state).toMatchObject({ status: "error", error: { correlationId: fixed } });
  });

  it("ignores form fields it does not know, so an owner or object key in the form never reaches the service", async () => {
    rpc.mockResolvedValue({ data: [{ export_id: EXPORT, status: "queued", cv_revision: 4, reused: false }], error: null });
    await requestCvExportAction(IDLE, form({ expected_revision: "4", idempotency_key: "req-1", user_id: "someone-else", object_key: OBJECT_KEY }));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("request_cv_export", { p_expected_revision: 4, p_idempotency_key: "req-1" });
  });

  it("rejects an anonymous caller", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    for (const state of [
      await requestCvExportAction(IDLE, form({ expected_revision: "1", idempotency_key: "k" })),
      await retryCvExportAction(IDLE, form({ export_id: EXPORT })),
      await issueCvExportDownloadAction(IDLE, form({ export_id: EXPORT })),
    ]) {
      expect(state).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(issueDownload).not.toHaveBeenCalled();
  });

  it("reports a storage failure on download as unavailable", async () => {
    rpc.mockResolvedValue({ data: OBJECT_KEY, error: null });
    issueDownload.mockRejectedValue(new Error("provider WP-SECRET"));
    const state = await issueCvExportDownloadAction(IDLE, form({ export_id: EXPORT }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable" } });
    expect(JSON.stringify(state)).not.toContain("WP-SECRET");
  });
});
