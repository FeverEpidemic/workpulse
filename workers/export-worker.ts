import {
  CV_EXPORT_MAX_BYTES,
  CV_EXPORT_MAX_PAGES,
  buildExportRenderModel,
  cvExportSnapshotSchema,
  effectiveExportName,
  exportTextShowsName,
} from "../src/domain/cv/export.ts";
import type { CvExportErrorCode } from "../src/domain/cv/contracts.ts";
import type { ParseKind, ParseResult } from "../src/server/documents/parse-in-thread.ts";
import { renderCvPrintHtml } from "../src/server/export/cv-print-template.ts";
import type { PdfRenderer, PdfRenderResult } from "../src/server/export/pdf-renderer.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const EXPORT_KEY_PATTERN = new RegExp(`^(${UUID})/export/(${UUID})$`);

export const EXPORT_ORPHAN_MIN_AGE_SECONDS = 60 * 60;
/** The lease is 120 seconds; rendering gets most of it so that verification, upload and completion still fit. */
export const EXPORT_RENDER_BUDGET_MS = 80_000;

export type ExportJob = {
  id: string;
  user_id: string;
  cv_revision: number;
  attempt_count: number;
  attempt_token: string;
};

export type ExportCleanupJob = {
  id: string;
  user_id: string;
  object_key: string;
  attempt_count: number;
  attempt_token: string;
};

/** The only data an export job may read: the stored snapshot. No career table is reachable from here. */
export type ExportInput = { snapshot: unknown; cv_revision: number };

/** Service-role operations; every transition is compare-and-set in PostgreSQL. */
export interface ExportWorkerDatabase {
  expireCvExports(limit: number): Promise<number>;
  reconcileOrphanExportObjects(minAgeSeconds: number, limit: number): Promise<number>;
  claimCvExportJobs(limit: number): Promise<ExportJob[]>;
  getCvExportInput(exportId: string, attemptToken: string): Promise<ExportInput | null>;
  completeCvExport(input: { exportId: string; attemptToken: string; objectKey: string; pageCount: number; byteSize: number }): Promise<string>;
  failCvExport(exportId: string, attemptToken: string, errorCode: string): Promise<boolean>;
  claimExportCleanupJobs(limit: number): Promise<ExportCleanupJob[]>;
  completeExportCleanupJob(jobId: string, attemptToken: string): Promise<boolean>;
  retryExportCleanupJob(input: { jobId: string; attemptToken: string; errorCode: string; nextAttemptAt: string }): Promise<boolean>;
  failExportCleanupJob(jobId: string, attemptToken: string, errorCode: string): Promise<boolean>;
}

export interface ExportWorkerStorage {
  uploadObject(objectKey: string, bytes: Uint8Array, options: { contentType: string; metadata: Record<string, string> }): Promise<void>;
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  removeObject(objectKey: string): Promise<void>;
}

export type ExportWorkerOptions = {
  database: ExportWorkerDatabase;
  storage: ExportWorkerStorage;
  renderer: PdfRenderer;
  parse: (kind: ParseKind, bytes: Uint8Array) => Promise<ParseResult>;
  claimLimit?: number;
  housekeepingLimit?: number;
  orphanMinAgeSeconds?: number;
  renderTimeoutMs?: number;
  now?: () => Date;
  /** Test seam: runs after a successful render, before verification and completion (e.g. to mutate sources). */
  onRendered?: (job: ExportJob) => Promise<void> | void;
};

/** Counts and stable codes only; never CV text, names, object keys, or tokens. */
export type ExportWorkerSummary = {
  exportExpired: number;
  exportOrphansQueued: number;
  exportJobsClaimed: number;
  exportSucceeded: number;
  exportFailed: Partial<Record<string, number>>;
  exportStale: number;
  exportErrored: number;
  exportCleanupClaimed: number;
  exportCleanupCompleted: number;
  exportCleanupRetried: number;
};

function backoffIso(now: () => Date, attempt: number, capMs: number): string {
  return new Date(now().getTime() + Math.min(1_000 * 2 ** Math.max(0, Math.min(attempt - 1, 20)), capMs)).toISOString();
}

type Outcome = "succeeded" | "failed" | "stale";

async function processJob(job: ExportJob, options: ExportWorkerOptions, summary: ExportWorkerSummary): Promise<Outcome> {
  const fail = async (code: CvExportErrorCode): Promise<Outcome> => {
    const recorded = await options.database.failCvExport(job.id, job.attempt_token, code);
    if (!recorded) return "stale";
    summary.exportFailed[code] = (summary.exportFailed[code] ?? 0) + 1;
    return "failed";
  };

  // Without a usable id and token nothing can be reported; the lease expiry fails the job.
  if (!UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) return "stale";
  if (
    !UUID_PATTERN.test(job.user_id) || !Number.isInteger(job.cv_revision) || job.cv_revision < 1
    || !Number.isInteger(job.attempt_count) || job.attempt_count < 1 || job.attempt_count > 3
  ) {
    return fail("EXPORT_SNAPSHOT_INVALID");
  }

  const input = await options.database.getCvExportInput(job.id, job.attempt_token);
  if (input === null) return "stale";

  const parsed = cvExportSnapshotSchema.safeParse(input.snapshot);
  if (!parsed.success || input.cv_revision !== job.cv_revision || parsed.data.cv_revision !== job.cv_revision) {
    return fail("EXPORT_SNAPSHOT_INVALID");
  }
  const name = effectiveExportName(parsed.data);
  if (name === null) return fail("EXPORT_SNAPSHOT_INVALID");
  let html: string;
  let headings: string[];
  try {
    const model = buildExportRenderModel(parsed.data);
    html = renderCvPrintHtml(model);
    // The sections the template prints (it skips sections whose entries are all deleted).
    headings = model.sections.filter((section) => section.entries.some((entry) => !entry.deleted)).map((section) => section.heading);
  } catch {
    return fail("EXPORT_SNAPSHOT_INVALID");
  }

  let rendered: PdfRenderResult;
  try {
    rendered = await options.renderer.render(html, AbortSignal.timeout(options.renderTimeoutMs ?? EXPORT_RENDER_BUDGET_MS));
  } catch {
    return fail("RENDERER_UNAVAILABLE");
  }
  if (rendered.status === "error") return fail(rendered.code);
  await options.onRendered?.(job);

  // Verify what the renderer returned before anything is stored.
  const pdf = rendered.pdf;
  if (pdf.byteLength < 5 || pdf.byteLength > CV_EXPORT_MAX_BYTES || Buffer.from(pdf.subarray(0, 5)).toString("latin1") !== "%PDF-") {
    return fail("EXPORT_RENDER_INVALID");
  }
  const checked = await options.parse("pdf-export", pdf);
  if (checked.status === "error" || checked.pageCount === null || checked.pageCount < 1) return fail("EXPORT_RENDER_INVALID");
  if (checked.pageCount > CV_EXPORT_MAX_PAGES) return fail("EXPORT_TOO_LONG");
  if (!exportTextShowsName(checked.text ?? "", name, headings)) return fail("EXPORT_RENDER_INVALID");

  // One object per attempt: a worker from an older lease can never own the key of the current attempt.
  const objectKey = `${job.user_id}/export/${job.attempt_token}`;
  try {
    await options.storage.uploadObject(objectKey, pdf, { contentType: "application/pdf", metadata: { category: "export", schema: "cv-export.v1" } });
  } catch {
    return fail("STORAGE_UNAVAILABLE");
  }

  const outcome = await options.database.completeCvExport({
    exportId: job.id, attemptToken: job.attempt_token, objectKey, pageCount: checked.pageCount, byteSize: pdf.byteLength,
  });
  if (outcome === "succeeded") {
    summary.exportSucceeded += 1;
    return "succeeded";
  }
  // Not committed: this attempt no longer owns the export, so its object is garbage. Best effort; the orphan
  // reconciliation catches anything left behind.
  await options.storage.removeObject(objectKey).catch(() => undefined);
  if (outcome.startsWith("failed:")) {
    const code = outcome.slice(7);
    summary.exportFailed[code] = (summary.exportFailed[code] ?? 0) + 1;
    return "failed";
  }
  return "stale";
}

async function processCleanup(job: ExportCleanupJob, options: ExportWorkerOptions): Promise<"completed" | "retried" | "stale"> {
  const now = options.now ?? (() => new Date());
  const key = EXPORT_KEY_PATTERN.exec(job.object_key);
  if (!key || key[1] !== job.user_id || !UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) {
    if (UUID_PATTERN.test(job.id) && UUID_PATTERN.test(job.attempt_token)) {
      await options.database.failExportCleanupJob(job.id, job.attempt_token, "INVALID_OBJECT_KEY");
    }
    return "stale";
  }
  const retry = async (code: string) => {
    const retried = await options.database.retryExportCleanupJob({
      jobId: job.id, attemptToken: job.attempt_token, errorCode: code,
      nextAttemptAt: backoffIso(now, job.attempt_count, 15 * 60_000),
    });
    return retried ? "retried" as const : "stale" as const;
  };
  try {
    if (await options.storage.getObjectMetadata(job.object_key) !== null) {
      await options.storage.removeObject(job.object_key);
      if (await options.storage.getObjectMetadata(job.object_key) !== null) return retry("OBJECT_DELETE_UNVERIFIED");
    }
  } catch {
    return retry("STORAGE_UNAVAILABLE");
  }
  return await options.database.completeExportCleanupJob(job.id, job.attempt_token) ? "completed" : "stale";
}

/** One bounded pass: housekeeping, the claimed export jobs, and object cleanup. */
export async function runExportWorkerOnce(options: ExportWorkerOptions): Promise<ExportWorkerSummary> {
  const limit = options.claimLimit ?? 1;
  const housekeeping = options.housekeepingLimit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("INVALID_WORKER_CLAIM_LIMIT");
  if (!Number.isInteger(housekeeping) || housekeeping < 1 || housekeeping > 100) throw new Error("INVALID_WORKER_HOUSEKEEPING_LIMIT");

  const summary: ExportWorkerSummary = {
    exportExpired: await options.database.expireCvExports(housekeeping),
    exportOrphansQueued: await options.database.reconcileOrphanExportObjects(options.orphanMinAgeSeconds ?? EXPORT_ORPHAN_MIN_AGE_SECONDS, housekeeping),
    exportJobsClaimed: 0, exportSucceeded: 0, exportFailed: {}, exportStale: 0, exportErrored: 0,
    exportCleanupClaimed: 0, exportCleanupCompleted: 0, exportCleanupRetried: 0,
  };

  const jobs = await options.database.claimCvExportJobs(limit);
  summary.exportJobsClaimed = jobs.length;
  for (const job of jobs) {
    // One failing job never stops the others; an unexpected error leaves the lease to expire (EXPORT_TIMEOUT).
    const outcome = await processJob(job, options, summary).catch(() => null);
    if (outcome === null) summary.exportErrored += 1;
    else if (outcome === "stale") summary.exportStale += 1;
  }

  const cleanups = await options.database.claimExportCleanupJobs(housekeeping);
  summary.exportCleanupClaimed = cleanups.length;
  for (const job of cleanups) {
    const outcome = await processCleanup(job, options).catch(() => null);
    if (outcome === "completed") summary.exportCleanupCompleted += 1;
    else if (outcome === "retried") summary.exportCleanupRetried += 1;
  }
  return summary;
}
