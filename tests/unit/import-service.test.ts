import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { ImportServiceError, mapImportDatabaseError } from "@/features/import/import-errors";
import { createImportService } from "@/features/import/import-service";

import { cvDocx, cvPdf, DOCX_MIME, PDF_MIME } from "../import-fixtures";

function fakeClient() {
  const rpc = vi.fn(async () => ({ data: null, error: { message: "UNEXPECTED" } }));
  return { rpc, from: vi.fn(), auth: { getUser: vi.fn() } };
}

function service() {
  const client = fakeClient();
  const admin = fakeClient();
  const storage = { uploadObject: vi.fn(), getObjectMetadata: vi.fn(), createSignedDownloadUrl: vi.fn(), removeObject: vi.fn() };
  return {
    client, admin, storage,
    service: createImportService({ client: client as never, admin: admin as never, storage, actorId: "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" }),
  };
}

const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });

async function code(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error instanceof ImportServiceError ? error.code : "UNEXPECTED"; }
  return null;
}

describe("T15 import service boundary", () => {
  it("rejects bad requests before any RPC or storage call", async () => {
    const { client, admin, storage, service: s } = service();
    const pdf = cvPdf();
    const base = { idempotencyKey: "8f14e45f-ea5e-4a0b-9c2b-000000000001", filename: "cv.pdf", contentType: PDF_MIME, contentLength: String(pdf.length) };
    expect(await code(s.upload({ ...base, idempotencyKey: "not-a-uuid", body: stream(pdf) }))).toBe("VALIDATION");
    expect(await code(s.upload({ ...base, filename: "%E0%A4%A", body: stream(pdf) }))).toBe("VALIDATION");
    expect(await code(s.upload({ ...base, filename: encodeURIComponent("\u0007"), body: stream(pdf) }))).toBe("VALIDATION");
    expect(await code(s.upload({ ...base, contentType: "text/plain", body: stream(pdf) }))).toBe("UNSUPPORTED_FORMAT");
    expect(await code(s.upload({ ...base, contentLength: "0", body: stream(pdf) }))).toBe("FILE_EMPTY");
    expect(await code(s.upload({ ...base, contentLength: String(11 * 1024 * 1024), body: stream(pdf) }))).toBe("FILE_TOO_LARGE");
    expect(await code(s.upload({ ...base, contentLength: "abc", body: stream(pdf) }))).toBe("UPLOAD_INCOMPLETE");
    expect(await code(s.upload({ ...base, contentType: DOCX_MIME, body: stream(pdf) }))).toBe("FILE_TYPE_MISMATCH");
    const docx = cvDocx();
    expect(await code(s.upload({ ...base, contentType: DOCX_MIME, contentLength: String(docx.length + 3), body: stream(docx) }))).toBe("UPLOAD_INCOMPLETE");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(storage.uploadObject).not.toHaveBeenCalled();
  });

  it("rejects malformed batch ids as not found without querying", async () => {
    const { client, service: s } = service();
    expect(await code(s.getView("../etc"))).toBe("NOT_FOUND");
    expect(await code(s.cancel("x"))).toBe("NOT_FOUND");
    expect(await code(s.retry(""))).toBe("NOT_FOUND");
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("maps database codes without distinguishing a foreign batch from a missing one", () => {
    expect(mapImportDatabaseError({ message: "IMPORT_NOT_FOUND" }).code).toBe("NOT_FOUND");
    expect(mapImportDatabaseError({ message: "CONSENT_REQUIRED" }).code).toBe("CONSENT_REQUIRED");
    expect(mapImportDatabaseError({ message: "IDEMPOTENCY_KEY_REUSED" }).code).toBe("CONFLICT");
    expect(mapImportDatabaseError({ message: "IMPORT_RETRY_EXHAUSTED" }).code).toBe("RETRY_EXHAUSTED");
    expect(mapImportDatabaseError({ message: "IMPORT_EXPIRED" }).code).toBe("EXPIRED");
    expect(mapImportDatabaseError({ message: "IMPORT_NOT_RETRIABLE" }).code).toBe("NOT_RETRIABLE");
    expect(mapImportDatabaseError({ message: "IMPORT_NOT_CANCELLABLE" }).code).toBe("NOT_CANCELLABLE");
    expect(mapImportDatabaseError({ code: "42501" }).code).toBe("UNAUTHENTICATED");
    expect(mapImportDatabaseError({ message: "something else with cv-secret.pdf" }).code).toBe("UNAVAILABLE");
    const error = new ImportServiceError("NOT_FOUND");
    expect(error.status).toBe(404);
    expect(error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(error.message).not.toContain("cv");
  });
});
