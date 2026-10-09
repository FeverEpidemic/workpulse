import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CV_EXPORT_MAX_BYTES, buildExportRenderModel, cvExportSnapshotSchema } from "@/domain/cv/export";
import { ExplicitTestFakePdfRenderer, type PdfRenderer, type PdfRenderResult } from "@/server/export/pdf-renderer";
import {
  runExportWorkerOnce,
  type ExportCleanupJob,
  type ExportJob,
  type ExportWorkerDatabase,
  type ExportWorkerOptions,
  type ExportWorkerStorage,
} from "../../workers/export-worker.ts";
import { parseInThread, type ParseKind, type ParseResult } from "../../src/server/documents/parse-in-thread.ts";

import { documentRow, exportSnapshotFrom, graduateItems, richCvFixture } from "./cv-fixtures";

const USER = "11111111-1111-4111-8111-111111111111";
const NAME = "Siti Nurhaliza Ç. Ñuñez";

function snapshotOf(locale: "en" | "id" = "id") {
  const { document, items } = richCvFixture(locale);
  return exportSnapshotFrom(document, items);
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  // The fixture document is at revision 1, so the snapshot of every default job carries cv_revision 1.
  return { id: randomUUID(), user_id: USER, cv_revision: 1, attempt_count: 1, attempt_token: randomUUID(), ...overrides };
}

type Calls = {
  complete: { exportId: string; attemptToken: string; objectKey: string; pageCount: number; byteSize: number }[];
  fail: { exportId: string; attemptToken: string; errorCode: string }[];
  uploads: { key: string; size: number; contentType: string; metadata: Record<string, string> }[];
  removed: string[];
  cleanupRetry: { errorCode: string; nextAttemptAt: string }[];
  cleanupFail: string[];
  cleanupComplete: string[];
  housekeeping: string[];
  render: string[];
};

type Setup = {
  jobs?: ExportJob[];
  input?: (job: ExportJob) => { snapshot: unknown; cv_revision: number } | null;
  complete?: (call: Calls["complete"][number]) => string | Promise<string>;
  failResult?: boolean;
  cleanups?: ExportCleanupJob[];
  metadata?: (key: string, removed: boolean) => unknown | null;
  uploadError?: boolean;
  removeError?: boolean;
  expired?: number;
  redacted?: number;
  orphans?: number;
};

function harness(setup: Setup = {}) {
  const calls: Calls = { complete: [], fail: [], uploads: [], removed: [], cleanupRetry: [], cleanupFail: [], cleanupComplete: [], housekeeping: [], render: [] };
  const jobs = setup.jobs ?? [job()];
  const database: ExportWorkerDatabase = {
    async expireCvExports(limit) { calls.housekeeping.push(`expire:${limit}`); return setup.expired ?? 0; },
    async redactCvExportSnapshots(limit) { calls.housekeeping.push(`redact:${limit}`); return setup.redacted ?? 0; },
    async reconcileOrphanExportObjects(minAge, limit) { calls.housekeeping.push(`orphans:${minAge}:${limit}`); return setup.orphans ?? 0; },
    async claimCvExportJobs(limit) { calls.housekeeping.push(`claim:${limit}`); return jobs; },
    async getCvExportInput(exportId) {
      const found = jobs.find((candidate) => candidate.id === exportId)!;
      return setup.input ? setup.input(found) : { snapshot: snapshotOf(), cv_revision: found.cv_revision };
    },
    async completeCvExport(input) {
      calls.complete.push(input);
      return setup.complete ? setup.complete(input) : "succeeded";
    },
    async failCvExport(exportId, attemptToken, errorCode) { calls.fail.push({ exportId, attemptToken, errorCode }); return setup.failResult ?? true; },
    async claimExportCleanupJobs() { return setup.cleanups ?? []; },
    async completeExportCleanupJob(jobId) { calls.cleanupComplete.push(jobId); return true; },
    async retryExportCleanupJob(input) { calls.cleanupRetry.push({ errorCode: input.errorCode, nextAttemptAt: input.nextAttemptAt }); return true; },
    async failExportCleanupJob(_jobId, _token, errorCode) { calls.cleanupFail.push(errorCode); return true; },
  };
  const storage: ExportWorkerStorage = {
    async uploadObject(key, bytes, options) {
      if (setup.uploadError) throw new Error("boom WP-SECRET-STORAGE");
      calls.uploads.push({ key, size: bytes.byteLength, contentType: options.contentType, metadata: options.metadata });
    },
    async getObjectMetadata(key) {
      return setup.metadata ? setup.metadata(key, calls.removed.includes(key)) : (calls.removed.includes(key) ? null : { size: 1 });
    },
    async removeObject(key) {
      if (setup.removeError) throw new Error("boom");
      calls.removed.push(key);
    },
  };
  return { calls, database, storage };
}

const fake: PdfRenderer = new ExplicitTestFakePdfRenderer();

function options(h: ReturnType<typeof harness>, overrides: Partial<ExportWorkerOptions> = {}): ExportWorkerOptions {
  return { database: h.database, storage: h.storage, renderer: fake, parse: parseInThread, now: () => new Date("2026-10-06T12:00:00Z"), ...overrides };
}

const rendererReturning = (result: PdfRenderResult, htmlSink: string[] = []): PdfRenderer => ({
  kind: "fake",
  async render(html) { htmlSink.push(html); return result; },
});

const pdfBytes = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
  return bytes;
};

const parseReturning = (result: ParseResult) => async (_kind: ParseKind, _bytes: Uint8Array): Promise<ParseResult> => result;

describe("T21 export worker: success path", () => {
  it("claims, reads only the snapshot, renders, verifies, uploads under the attempt key and completes", async () => {
    const claimed = job();
    const h = harness({ jobs: [claimed] });
    const summary = await runExportWorkerOnce(options(h));
    expect(summary).toMatchObject({ exportJobsClaimed: 1, exportSucceeded: 1, exportStale: 0, exportFailed: {} });
    expect(h.calls.uploads).toHaveLength(1);
    const upload = h.calls.uploads[0]!;
    expect(upload.key).toBe(`${USER}/export/${claimed.attempt_token}`);
    expect(upload.contentType).toBe("application/pdf");
    expect(JSON.stringify(upload.metadata)).not.toContain(NAME);
    expect(h.calls.complete).toEqual([{
      exportId: claimed.id, attemptToken: claimed.attempt_token, objectKey: upload.key, pageCount: 1, byteSize: upload.size,
    }]);
    expect(h.calls.fail).toEqual([]);
    expect(h.calls.removed).toEqual([]);
  });

  it("renders the HTML of the stored snapshot, never anything read later", async () => {
    const html: string[] = [];
    const h = harness();
    const renderer: PdfRenderer = { kind: "fake", async render(source, signal) { html.push(source); return fake.render(source, signal); } };
    await runExportWorkerOnce(options(h, { renderer }));
    expect(html).toHaveLength(1);
    expect(html[0]).toContain("<h1>Siti Nurhaliza Ç. Ñuñez</h1>");
    expect(html[0]).toContain("Bullet yang ditulis ulang");
    expect(html[0]).toContain("<html lang=\"id\">");
  });

  it("runs housekeeping before claiming and reports counts only", async () => {
    const h = harness({ jobs: [], expired: 2, redacted: 4, orphans: 3 });
    const summary = await runExportWorkerOnce(options(h, { claimLimit: 2, housekeepingLimit: 7, orphanMinAgeSeconds: 1800 }));
    expect(h.calls.housekeeping).toEqual(["expire:7", "redact:7", "orphans:1800:7", "claim:2"]);
    expect(summary).toEqual({
      exportExpired: 2, exportSnapshotsRedacted: 4, exportOrphansQueued: 3, exportJobsClaimed: 0, exportSucceeded: 0, exportFailed: {}, exportStale: 0, exportErrored: 0,
      exportCleanupClaimed: 0, exportCleanupCompleted: 0, exportCleanupRetried: 0,
    });
  });

  it("rejects invalid claim and housekeeping limits", async () => {
    const h = harness();
    await expect(runExportWorkerOnce(options(h, { claimLimit: 0 }))).rejects.toThrow("INVALID_WORKER_CLAIM_LIMIT");
    await expect(runExportWorkerOnce(options(h, { claimLimit: 11 }))).rejects.toThrow("INVALID_WORKER_CLAIM_LIMIT");
    await expect(runExportWorkerOnce(options(h, { housekeepingLimit: 0 }))).rejects.toThrow("INVALID_WORKER_HOUSEKEEPING_LIMIT");
    await expect(runExportWorkerOnce(options(h, { housekeepingLimit: 101 }))).rejects.toThrow("INVALID_WORKER_HOUSEKEEPING_LIMIT");
  });

  it("calls the test seam after rendering and before completing", async () => {
    const order: string[] = [];
    const h = harness();
    const original = h.database.completeCvExport;
    h.database.completeCvExport = async (input) => { order.push("complete"); return original(input); };
    await runExportWorkerOnce(options(h, { onRendered: () => { order.push("rendered"); } }));
    expect(order).toEqual(["rendered", "complete"]);
  });
});

describe("T21 export worker: failures keep the CV and use safe codes", () => {
  const failedWith = async (h: ReturnType<typeof harness>, overrides: Partial<ExportWorkerOptions> = {}) => {
    const summary = await runExportWorkerOnce(options(h, overrides));
    expect(h.calls.complete).toEqual([]);
    return summary;
  };

  it("fails an invalid snapshot with EXPORT_SNAPSHOT_INVALID without rendering", async () => {
    const html: string[] = [];
    const h = harness({ input: (found) => ({ snapshot: { ...snapshotOf(), evidence: ["x"] }, cv_revision: found.cv_revision }) });
    const summary = await failedWith(h, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }, html) });
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_SNAPSHOT_INVALID"]);
    expect(summary.exportFailed).toEqual({ EXPORT_SNAPSHOT_INVALID: 1 });
    expect(html).toEqual([]);
  });

  it("fails a snapshot whose revision differs from the claim, and a snapshot without a name", async () => {
    const mismatch = harness({ input: (found) => ({ snapshot: snapshotOf(), cv_revision: found.cv_revision + 1 }) });
    await failedWith(mismatch);
    expect(mismatch.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_SNAPSHOT_INVALID"]);
    const nameless = exportSnapshotFrom(documentRow({ profile_snapshot: { display_name: " " } }), graduateItems());
    const h = harness({ input: (found) => ({ snapshot: nameless, cv_revision: found.cv_revision }) });
    await failedWith(h);
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_SNAPSHOT_INVALID"]);
  });

  it("treats a missing input (stale lease, deleting account) as stale and renders nothing", async () => {
    const html: string[] = [];
    const h = harness({ input: () => null });
    const summary = await failedWith(h, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }, html) });
    expect(summary).toMatchObject({ exportJobsClaimed: 1, exportStale: 1, exportSucceeded: 0 });
    expect(h.calls.fail).toEqual([]);
    expect(html).toEqual([]);
  });

  it.each(["RENDERER_UNAVAILABLE", "RENDERER_TIMEOUT", "EXPORT_RENDER_INVALID"] as const)("passes the renderer code %s through", async (code) => {
    const h = harness();
    const summary = await failedWith(h, { renderer: rendererReturning({ status: "error", code }) });
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual([code]);
    expect(summary.exportFailed).toEqual({ [code]: 1 });
    expect(h.calls.uploads).toEqual([]);
  });

  it("rejects output that is not a PDF, is empty or exceeds 10 MiB as EXPORT_RENDER_INVALID", async () => {
    for (const pdf of [new TextEncoder().encode("<html>no</html>"), new Uint8Array(0), pdfBytes(CV_EXPORT_MAX_BYTES + 1)]) {
      const h = harness();
      await failedWith(h, { renderer: rendererReturning({ status: "ok", pdf }), parse: parseReturning({ status: "ok", text: NAME, pageCount: 1 }) });
      expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_RENDER_INVALID"]);
      expect(h.calls.uploads).toEqual([]);
    }
  });

  it("accepts exactly 20 pages and rejects 21 as EXPORT_TOO_LONG", async () => {
    const ok = harness();
    await runExportWorkerOnce(options(ok, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }), parse: parseReturning({ status: "ok", text: NAME, pageCount: 20 }) }));
    expect(ok.calls.complete[0]!.pageCount).toBe(20);
    const h = harness();
    const summary = await failedWith(h, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }), parse: parseReturning({ status: "ok", text: NAME, pageCount: 21 }) });
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_TOO_LONG"]);
    expect(summary.exportFailed).toEqual({ EXPORT_TOO_LONG: 1 });
  });

  it("rejects text without the effective name and a parser failure as EXPORT_RENDER_INVALID", async () => {
    const noName = harness();
    await failedWith(noName, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }), parse: parseReturning({ status: "ok", text: "Pengalaman\nProyek", pageCount: 1 }) });
    expect(noName.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_RENDER_INVALID"]);
    const broken = harness();
    await failedWith(broken, { renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }), parse: parseReturning({ status: "error", code: "CORRUPT_FILE" }) });
    expect(broken.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_RENDER_INVALID"]);
  });

  it("finds the name when the PDF wraps it across lines or normalizes it differently", async () => {
    const h = harness();
    await runExportWorkerOnce(options(h, {
      renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }),
      parse: parseReturning({ status: "ok", text: "Siti\nNurhaliza   Ç.  Ñuñez\nPengalaman", pageCount: 1 }),
    }));
    expect(h.calls.complete).toHaveLength(1);
  });

  it("accepts a non-Latin name that the renderer prints as radicals when every section heading is searchable (RV1)", async () => {
    const snapshot = exportSnapshotFrom(documentRow({ profile_snapshot: { ...documentRow().profile_snapshot, display_name: "李小龙" } }), graduateItems());
    const headings = buildExportRenderModel(cvExportSnapshotSchema.parse(snapshot)).sections
      .filter((section) => section.entries.some((entry) => !entry.deleted))
      .map((section) => section.heading);
    expect(headings.length).toBeGreaterThan(0);
    const input = (found: ExportJob) => ({ snapshot, cv_revision: found.cv_revision });
    const accepted = harness({ input });
    await runExportWorkerOnce(options(accepted, {
      renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }),
      parse: parseReturning({ status: "ok", text: ["李⼩⻰", ...headings].join("\n"), pageCount: 1 }),
    }));
    expect(accepted.calls.fail).toEqual([]);
    expect(accepted.calls.complete).toHaveLength(1);
    // A heading missing from the text still fails: nothing proves the PDF is searchable.
    const missing = harness({ input });
    await failedWith(missing, {
      renderer: rendererReturning({ status: "ok", pdf: pdfBytes() }),
      parse: parseReturning({ status: "ok", text: ["李⼩⻰", ...headings.slice(1)].join("\n"), pageCount: 1 }),
    });
    expect(missing.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_RENDER_INVALID"]);
  });

  it("fails with STORAGE_UNAVAILABLE when the upload fails and never completes", async () => {
    const h = harness({ uploadError: true });
    const summary = await failedWith(h);
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["STORAGE_UNAVAILABLE"]);
    expect(summary.exportFailed).toEqual({ STORAGE_UNAVAILABLE: 1 });
  });

  it("deletes its own object when completion is stale or the account is being deleted", async () => {
    const stale = harness({ complete: () => "stale" });
    const staleSummary = await runExportWorkerOnce(options(stale));
    expect(staleSummary).toMatchObject({ exportSucceeded: 0, exportStale: 1 });
    expect(stale.calls.removed).toEqual([stale.calls.uploads[0]!.key]);
    const deleting = harness({ complete: () => "failed:ACCOUNT_DELETING" });
    const deletingSummary = await runExportWorkerOnce(options(deleting));
    expect(deletingSummary.exportFailed).toEqual({ ACCOUNT_DELETING: 1 });
    expect(deleting.calls.removed).toEqual([deleting.calls.uploads[0]!.key]);
  });

  it("keeps the object when completion throws (the commit may have happened) and counts an error", async () => {
    const h = harness({ complete: () => { throw new Error("network WP-SECRET"); } });
    const summary = await runExportWorkerOnce(options(h));
    expect(summary).toMatchObject({ exportJobsClaimed: 1, exportErrored: 1, exportSucceeded: 0 });
    expect(h.calls.removed).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain("WP-SECRET");
  });

  it("counts a stale failure report as stale", async () => {
    const h = harness({ failResult: false });
    const summary = await runExportWorkerOnce(options(h, { renderer: rendererReturning({ status: "error", code: "RENDERER_UNAVAILABLE" }) }));
    expect(summary).toMatchObject({ exportStale: 1, exportFailed: {} });
  });

  it("does not let one failing job stop the others", async () => {
    const first = job();
    const second = job();
    const h = harness({ jobs: [first, second] });
    let calls = 0;
    const renderer: PdfRenderer = {
      kind: "fake",
      async render(html, signal) {
        calls += 1;
        return calls === 1 ? { status: "error", code: "RENDERER_TIMEOUT" } : fake.render(html, signal);
      },
    };
    const summary = await runExportWorkerOnce(options(h, { renderer, claimLimit: 2 }));
    expect(summary).toMatchObject({ exportJobsClaimed: 2, exportSucceeded: 1, exportFailed: { RENDERER_TIMEOUT: 1 } });
    expect(h.calls.complete.map((call) => call.exportId)).toEqual([second.id]);
  });

  it("ignores a malformed claim row without acting on it", async () => {
    const h = harness({ jobs: [job({ id: "nope" }), job({ attempt_token: "nope" })] });
    const summary = await runExportWorkerOnce(options(h, { claimLimit: 2 }));
    expect(summary).toMatchObject({ exportJobsClaimed: 2, exportStale: 2 });
    expect(h.calls.fail).toEqual([]);
    expect(h.calls.uploads).toEqual([]);
  });

  it("fails a claim row with a foreign owner shape as EXPORT_SNAPSHOT_INVALID", async () => {
    const h = harness({ jobs: [job({ user_id: "not-a-uuid" })] });
    await runExportWorkerOnce(options(h));
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_SNAPSHOT_INVALID"]);
  });
});

describe("T21 export worker: real parser and fake renderer", () => {
  it("verifies a short CV that the import parser would call scanned", async () => {
    const short = exportSnapshotFrom(documentRow({ profile_snapshot: { display_name: "Ani", headline: null, summary: null } }), graduateItems().slice(4));
    const h = harness({ input: (found) => ({ snapshot: short, cv_revision: found.cv_revision }) });
    const summary = await runExportWorkerOnce(options(h));
    expect(summary.exportSucceeded).toBe(1);
    expect(h.calls.complete[0]!.pageCount).toBe(1);
  });

  it("fails a document over 20 pages with EXPORT_TOO_LONG", async () => {
    const lines = Array.from({ length: 1100 }, (_, n) => `Baris ${n}`);
    const renderer: PdfRenderer = { kind: "fake", async render(_html, signal) { return fake.render(`<p>${NAME}</p>${lines.map((line) => `<p>${line}</p>`).join("")}`, signal); } };
    const h = harness();
    const summary = await runExportWorkerOnce(options(h, { renderer }));
    expect(h.calls.fail.map((call) => call.errorCode)).toEqual(["EXPORT_TOO_LONG"]);
    expect(summary.exportFailed).toEqual({ EXPORT_TOO_LONG: 1 });
  });
});

describe("T21 export worker: cleanup", () => {
  const key = `${USER}/export/${randomUUID()}`;
  const cleanup = (overrides: Partial<ExportCleanupJob> = {}): ExportCleanupJob => ({ id: randomUUID(), user_id: USER, object_key: key, attempt_count: 1, attempt_token: randomUUID(), ...overrides });

  it("removes the object, verifies it is gone and completes", async () => {
    const claimed = cleanup();
    const h = harness({ jobs: [], cleanups: [claimed] });
    const summary = await runExportWorkerOnce(options(h));
    expect(h.calls.removed).toEqual([key]);
    expect(h.calls.cleanupComplete).toEqual([claimed.id]);
    expect(summary).toMatchObject({ exportCleanupClaimed: 1, exportCleanupCompleted: 1, exportCleanupRetried: 0 });
  });

  it("completes without a delete when the object is already gone", async () => {
    const h = harness({ jobs: [], cleanups: [cleanup()], metadata: () => null });
    await runExportWorkerOnce(options(h));
    expect(h.calls.removed).toEqual([]);
    expect(h.calls.cleanupComplete).toHaveLength(1);
  });

  it("retries with backoff when the delete cannot be verified or storage fails", async () => {
    const stuck = harness({ jobs: [], cleanups: [cleanup()], metadata: () => ({ size: 1 }) });
    const stuckSummary = await runExportWorkerOnce(options(stuck));
    expect(stuck.calls.cleanupRetry.map((call) => call.errorCode)).toEqual(["OBJECT_DELETE_UNVERIFIED"]);
    expect(stuck.calls.cleanupRetry[0]!.nextAttemptAt).toBe("2026-10-06T12:00:01.000Z");
    expect(stuckSummary.exportCleanupRetried).toBe(1);
    const down = harness({ jobs: [], cleanups: [cleanup({ attempt_count: 3 })], removeError: true });
    await runExportWorkerOnce(options(down));
    expect(down.calls.cleanupRetry.map((call) => call.errorCode)).toEqual(["STORAGE_UNAVAILABLE"]);
    expect(down.calls.cleanupRetry[0]!.nextAttemptAt).toBe("2026-10-06T12:00:04.000Z");
  });

  it("fails a job whose key is not an export key of its owner without touching storage", async () => {
    for (const bad of [cleanup({ object_key: `${USER}/import/${randomUUID()}` }), cleanup({ user_id: randomUUID() })]) {
      const h = harness({ jobs: [], cleanups: [bad] });
      await runExportWorkerOnce(options(h));
      expect(h.calls.cleanupFail).toEqual(["INVALID_OBJECT_KEY"]);
      expect(h.calls.removed).toEqual([]);
    }
  });
});

describe("T21 export worker: summary hygiene", () => {
  it("never carries CV text, names, object keys or tokens", async () => {
    const claimed = job();
    const h = harness({ jobs: [claimed], complete: () => "stale" });
    const summary = await runExportWorkerOnce(options(h));
    const text = JSON.stringify(summary);
    for (const secret of [NAME, "Siti", "Bullet", claimed.attempt_token, claimed.id, USER, "/export/", ".pdf"]) expect(text).not.toContain(secret);
  });
});
