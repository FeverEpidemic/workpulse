import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { ExplicitTestFakeDocxRenderer, UnavailableDocxRenderer } from "@/server/documents/docx-renderer";
import type { ParseResult } from "@/server/documents/parse-in-thread";

import { runImportWorkerOnce, type ImportJob, type ImportWorkerDatabase, type ImportWorkerOptions } from "../../workers/import-worker.ts";
import { CV_LINES, cvDocx, cvPdf } from "../import-fixtures";

const USER = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const BATCH = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";

function jobFor(bytes: Uint8Array, mime = "application/pdf", attempt = 1): ImportJob {
  return {
    id: "0f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f", user_id: USER, batch_id: BATCH, object_key: `${USER}/import/${BATCH}`,
    expected_bytes: bytes.byteLength, mime_type: mime, sha256: createHash("sha256").update(bytes).digest("hex"),
    attempt_count: attempt, attempt_token: "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f",
  };
}

function database(job: ImportJob | null, overrides: Partial<ImportWorkerDatabase> = {}) {
  return {
    expireImportUploads: vi.fn(async () => 0),
    purgeExpiredImportBatches: vi.fn(async () => 0),
    reconcileOrphanImportObjects: vi.fn(async () => 0),
    claimImportJobs: vi.fn(async () => (job ? [job] : [])),
    advanceImportJob: vi.fn(async () => true),
    completeImportParse: vi.fn(async () => "succeeded"),
    failImportJob: vi.fn(async () => true),
    claimImportCleanupJobs: vi.fn(async () => []),
    completeImportCleanupJob: vi.fn(async () => true),
    retryImportCleanupJob: vi.fn(async () => true),
    failImportCleanupJob: vi.fn(async () => true),
    ...overrides,
  } satisfies ImportWorkerDatabase;
}

function options(bytes: Uint8Array, db: ImportWorkerDatabase, overrides: Partial<ImportWorkerOptions> = {}): ImportWorkerOptions {
  return {
    database: db,
    storage: { downloadObject: vi.fn(async () => bytes), getObjectMetadata: vi.fn(async () => null), removeObject: vi.fn(async () => undefined) },
    scanner: { scan: vi.fn(async () => ({ status: "clean" as const })) },
    parse: vi.fn(async (): Promise<ParseResult> => ({ status: "ok", text: CV_LINES.join("\n"), pageCount: 2 })),
    renderer: new ExplicitTestFakeDocxRenderer(),
    ...overrides,
  };
}

describe("T15 import worker", () => {
  it("scans before parsing, then stores text and page count", async () => {
    const bytes = cvPdf();
    const db = database(jobFor(bytes));
    const opts = options(bytes, db);
    const summary = await runImportWorkerOnce(opts);
    expect(summary).toMatchObject({ importJobsClaimed: 1, importParsed: 1, importFailed: {} });
    expect(vi.mocked(opts.scanner.scan).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(opts.parse).mock.invocationCallOrder[0]!);
    expect(db.completeImportParse).toHaveBeenCalledWith(expect.any(String), expect.any(String), CV_LINES.join("\n"), 2);
    expect(JSON.stringify(summary)).not.toContain("Sentinel");
  });

  it("uses the renderer page count for DOCX and rejects more than 20 pages", async () => {
    const small = cvDocx(CV_LINES, { pages: 3, appPages: 1 });
    const db = database(jobFor(small, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    await runImportWorkerOnce(options(small, db, { parse: vi.fn(async (): Promise<ParseResult> => ({ status: "ok", text: "x", pageCount: null })) }));
    expect(db.completeImportParse).toHaveBeenCalledWith(expect.any(String), expect.any(String), "x", 3);

    const large = cvDocx(CV_LINES, { pages: 21, appPages: 1 });
    const db2 = database(jobFor(large, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    const summary = await runImportWorkerOnce(options(large, db2, { parse: vi.fn(async (): Promise<ParseResult> => ({ status: "ok", text: "x", pageCount: null })) }));
    expect(summary.importFailed).toEqual({ TOO_MANY_PAGES: 1 });
    expect(db2.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "TOO_MANY_PAGES", final: true }));
  });

  it("treats an unavailable renderer as transient", async () => {
    const docx = cvDocx();
    const db = database(jobFor(docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    const summary = await runImportWorkerOnce(options(docx, db, {
      renderer: new UnavailableDocxRenderer(),
      parse: vi.fn(async (): Promise<ParseResult> => ({ status: "ok", text: "x", pageCount: null })),
    }));
    expect(summary.importRetried).toBe(1);
    expect(db.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "PAGE_COUNT_UNAVAILABLE", final: false }));
  });

  it("never parses infected or unscanned bytes", async () => {
    const bytes = cvPdf();
    for (const [scan, code, final] of [
      [{ status: "infected", errorCode: "MALWARE_DETECTED" }, "MALWARE_DETECTED", true],
      [{ status: "unavailable", errorCode: "SCANNER_UNAVAILABLE" }, "SCANNER_UNAVAILABLE", false],
    ] as const) {
      const db = database(jobFor(bytes));
      const opts = options(bytes, db, { scanner: { scan: vi.fn(async () => scan) } });
      await runImportWorkerOnce(opts);
      expect(opts.parse).not.toHaveBeenCalled();
      expect(db.advanceImportJob).not.toHaveBeenCalled();
      expect(db.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: code, final }));
    }
  });

  it("rejects changed bytes and invalid claims, and stops when the lease moved on", async () => {
    const bytes = cvPdf();
    const tampered = Buffer.from(bytes); tampered.writeUInt8(tampered.readUInt8(20) ^ 1, 20);
    const db = database(jobFor(bytes));
    await runImportWorkerOnce(options(tampered, db));
    expect(db.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "CORRUPT_FILE", final: true }));

    const invalid = database({ ...jobFor(bytes), object_key: `${USER}/evidence/${BATCH}` });
    await runImportWorkerOnce(options(bytes, invalid));
    expect(invalid.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "INVALID_IMPORT_JOB", final: true }));

    const stale = database(jobFor(bytes), { advanceImportJob: vi.fn(async () => false) });
    const opts = options(bytes, stale);
    expect((await runImportWorkerOnce(opts)).importStale).toBe(1);
    expect(opts.parse).not.toHaveBeenCalled();
  });

  it("maps parser failures to final codes and storage outages to retries", async () => {
    const bytes = cvPdf();
    const db = database(jobFor(bytes));
    await runImportWorkerOnce(options(bytes, db, { parse: vi.fn(async (): Promise<ParseResult> => ({ status: "error", code: "ENCRYPTED_FILE" })) }));
    expect(db.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "ENCRYPTED_FILE", final: true }));

    const outage = database(jobFor(bytes));
    const summary = await runImportWorkerOnce(options(bytes, outage, {
      storage: { downloadObject: vi.fn(async () => { throw new Error("down"); }), getObjectMetadata: vi.fn(async () => null), removeObject: vi.fn() },
    }));
    expect(summary.importRetried).toBe(1);
    expect(outage.failImportJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "STORAGE_UNAVAILABLE", final: false }));
  });

  it("deletes import objects and verifies absence before completing cleanup", async () => {
    const bytes = cvPdf();
    const cleanup = { id: "4f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f", user_id: USER, object_key: `${USER}/import/${BATCH}`, attempt_count: 1, attempt_token: "5f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" };
    const db = database(null, { claimImportCleanupJobs: vi.fn(async () => [cleanup]) });
    let present = true;
    const storage = {
      downloadObject: vi.fn(async () => bytes),
      getObjectMetadata: vi.fn(async () => (present ? { size: 1 } : null)),
      removeObject: vi.fn(async () => { present = false; }),
    };
    expect((await runImportWorkerOnce(options(bytes, db, { storage }))).importCleanupCompleted).toBe(1);
    expect(storage.removeObject).toHaveBeenCalledWith(cleanup.object_key);

    const stuck = database(null, { claimImportCleanupJobs: vi.fn(async () => [cleanup]) });
    const sticky = { ...storage, getObjectMetadata: vi.fn(async () => ({ size: 1 })), removeObject: vi.fn(async () => undefined) };
    expect((await runImportWorkerOnce(options(bytes, stuck, { storage: sticky }))).importCleanupRetried).toBe(1);
    expect(stuck.completeImportCleanupJob).not.toHaveBeenCalled();
  });
});
