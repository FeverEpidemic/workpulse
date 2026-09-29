import { createHash } from "node:crypto";

import {
  IMPORT_DOCX_MIME,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_PAGES,
  IMPORT_MAX_TEXT_CHARS,
  IMPORT_MIME_TYPES,
  IMPORT_SCAN_MAX_ATTEMPTS,
  type ImportFileErrorCode,
} from "../src/domain/import/contracts.ts";
import type { DocxPageRenderer } from "../src/server/documents/docx-renderer.ts";
import type { ParseKind, ParseResult } from "../src/server/documents/parse-in-thread.ts";
import type { PrivateStorageMimeType } from "../src/server/storage/constants.ts";
import type { MalwareScanner, MalwareScanResult } from "../src/server/storage/malware-scanner.ts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_PATTERN = new RegExp(`^${UUID}$`);
const IMPORT_KEY_PATTERN = new RegExp(`^(${UUID})/import/(${UUID})$`);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const IMPORT_UPLOAD_GRACE_SECONDS = 15 * 60;
export const IMPORT_ORPHAN_MIN_AGE_SECONDS = 60 * 60;
export const IMPORT_RENDER_TIMEOUT_MS = 60_000;

export type ImportJob = {
  id: string;
  user_id: string;
  batch_id: string;
  object_key: string;
  expected_bytes: number;
  mime_type: string;
  sha256: string;
  attempt_count: number;
  attempt_token: string;
};

export type ImportCleanupJob = {
  id: string;
  user_id: string;
  object_key: string;
  attempt_count: number;
  attempt_token: string;
};

/** Service-role operations; every transition is compare-and-set in PostgreSQL. */
export interface ImportWorkerDatabase {
  expireImportUploads(limit: number, minAgeSeconds: number): Promise<number>;
  purgeExpiredImportBatches(limit: number): Promise<number>;
  reconcileOrphanImportObjects(minAgeSeconds: number, limit: number): Promise<number>;
  claimImportJobs(limit: number): Promise<ImportJob[]>;
  advanceImportJob(jobId: string, attemptToken: string): Promise<boolean>;
  completeImportParse(jobId: string, attemptToken: string, text: string, pageCount: number): Promise<string>;
  failImportJob(input: { jobId: string; attemptToken: string; errorCode: string; final: boolean; nextAttemptAt: string }): Promise<boolean>;
  claimImportCleanupJobs(limit: number): Promise<ImportCleanupJob[]>;
  completeImportCleanupJob(jobId: string, attemptToken: string): Promise<boolean>;
  retryImportCleanupJob(input: { jobId: string; attemptToken: string; errorCode: string; nextAttemptAt: string }): Promise<boolean>;
  failImportCleanupJob(jobId: string, attemptToken: string, errorCode: string): Promise<boolean>;
}

export interface ImportWorkerStorage {
  downloadObject(objectKey: string): Promise<Uint8Array>;
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  removeObject(objectKey: string): Promise<void>;
}

export type ImportWorkerOptions = {
  database: ImportWorkerDatabase;
  storage: ImportWorkerStorage;
  scanner: MalwareScanner;
  parse: (kind: ParseKind, bytes: Uint8Array) => Promise<ParseResult>;
  renderer: DocxPageRenderer;
  claimLimit?: number;
  housekeepingLimit?: number;
  uploadGraceSeconds?: number;
  orphanMinAgeSeconds?: number;
  now?: () => Date;
  /** Test seam: runs after the clean scan, before parsing (e.g. to cancel concurrently). */
  onScanned?: (job: ImportJob) => Promise<void> | void;
};

/** Counts and stable codes only; never file names, text, or object keys. */
export type ImportWorkerSummary = {
  importExpiredUploads: number;
  importPurged: number;
  importOrphansQueued: number;
  importJobsClaimed: number;
  importParsed: number;
  importFailed: Partial<Record<string, number>>;
  importRetried: number;
  importStale: number;
  importCleanupClaimed: number;
  importCleanupCompleted: number;
  importCleanupRetried: number;
};

function backoffIso(now: () => Date, attempt: number, capMs: number): string {
  return new Date(now().getTime() + Math.min(1_000 * 2 ** Math.max(0, Math.min(attempt - 1, 20)), capMs)).toISOString();
}

function validJob(job: ImportJob): boolean {
  const key = IMPORT_KEY_PATTERN.exec(job.object_key);
  return UUID_PATTERN.test(job.id) && UUID_PATTERN.test(job.attempt_token)
    && key?.[1] === job.user_id && key[2] === job.batch_id
    && Number.isInteger(job.expected_bytes) && job.expected_bytes > 0 && job.expected_bytes <= IMPORT_MAX_BYTES
    && (IMPORT_MIME_TYPES as readonly string[]).includes(job.mime_type)
    && SHA256_PATTERN.test(job.sha256)
    && Number.isInteger(job.attempt_count) && job.attempt_count >= 1 && job.attempt_count <= IMPORT_SCAN_MAX_ATTEMPTS;
}

function digestMatches(bytes: Uint8Array, job: ImportJob): boolean {
  return bytes.byteLength === job.expected_bytes && createHash("sha256").update(bytes).digest("hex") === job.sha256;
}

type Outcome = "parsed" | "retried" | "failed" | "stale";

async function processJob(job: ImportJob, options: ImportWorkerOptions, summary: ImportWorkerSummary): Promise<Outcome> {
  const now = options.now ?? (() => new Date());
  const fail = async (code: string, final: boolean): Promise<Outcome> => {
    const recorded = await options.database.failImportJob({
      jobId: job.id, attemptToken: job.attempt_token, errorCode: code, final,
      nextAttemptAt: backoffIso(now, job.attempt_count, 5 * 60_000),
    });
    if (!recorded) return "stale";
    if (final || job.attempt_count >= IMPORT_SCAN_MAX_ATTEMPTS) {
      summary.importFailed[code] = (summary.importFailed[code] ?? 0) + 1;
      return "failed";
    }
    return "retried";
  };

  if (!validJob(job)) {
    if (!UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) return "stale";
    return fail("INVALID_IMPORT_JOB", true);
  }

  let bytes: Uint8Array;
  try {
    bytes = await options.storage.downloadObject(job.object_key);
  } catch {
    return fail("STORAGE_UNAVAILABLE", false);
  }
  if (!digestMatches(bytes, job)) return fail("CORRUPT_FILE", true);

  // Screening first: nothing parses bytes that the scanner has not declared clean.
  let scan: MalwareScanResult;
  try {
    scan = await options.scanner.scan({ bytes, contentType: job.mime_type as PrivateStorageMimeType });
  } catch {
    scan = { status: "failed", errorCode: "SCANNER_FAILED" };
  }
  if (scan.status === "infected") return fail("MALWARE_DETECTED", true);
  if (scan.status !== "clean") return fail("SCANNER_UNAVAILABLE", false);
  if (!digestMatches(bytes, job)) return fail("CORRUPT_FILE", true);
  if (!await options.database.advanceImportJob(job.id, job.attempt_token)) return "stale";
  await options.onScanned?.(job);

  const parsed = await options.parse(job.mime_type === IMPORT_DOCX_MIME ? "docx" : "pdf", bytes);
  if (parsed.status === "error") return fail(parsed.code, true);
  const text = parsed.text ?? "";
  let pageCount = parsed.pageCount;
  if (job.mime_type === IMPORT_DOCX_MIME) {
    const rendered = await options.renderer.countPages(bytes, AbortSignal.timeout(IMPORT_RENDER_TIMEOUT_MS));
    if (rendered.status === "error") return fail(rendered.code, rendered.code !== "PAGE_COUNT_UNAVAILABLE");
    pageCount = rendered.pageCount;
  }
  if (pageCount === null || pageCount < 1) return fail("CORRUPT_FILE", true);
  if (pageCount > IMPORT_MAX_PAGES) return fail("TOO_MANY_PAGES" satisfies ImportFileErrorCode, true);
  if (text.length > IMPORT_MAX_TEXT_CHARS) return fail("IMPORT_TEXT_TOO_LONG", true);

  const outcome = await options.database.completeImportParse(job.id, job.attempt_token, text, pageCount);
  if (outcome === "succeeded") return "parsed";
  if (outcome.startsWith("failed:")) {
    const code = outcome.slice(7);
    summary.importFailed[code] = (summary.importFailed[code] ?? 0) + 1;
    return "failed";
  }
  return "stale";
}

async function processCleanup(job: ImportCleanupJob, options: ImportWorkerOptions): Promise<"completed" | "retried" | "stale"> {
  const now = options.now ?? (() => new Date());
  const key = IMPORT_KEY_PATTERN.exec(job.object_key);
  if (!key || key[1] !== job.user_id || !UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) {
    if (UUID_PATTERN.test(job.id) && UUID_PATTERN.test(job.attempt_token)) {
      await options.database.failImportCleanupJob(job.id, job.attempt_token, "INVALID_OBJECT_KEY");
    }
    return "stale";
  }
  const retry = async (code: string) => {
    const retried = await options.database.retryImportCleanupJob({
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
  return await options.database.completeImportCleanupJob(job.id, job.attempt_token) ? "completed" : "stale";
}

/** One bounded pass: housekeeping, one scan+parse job, and object cleanup. */
export async function runImportWorkerOnce(options: ImportWorkerOptions): Promise<ImportWorkerSummary> {
  const limit = options.claimLimit ?? 1;
  const housekeeping = options.housekeepingLimit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("INVALID_WORKER_CLAIM_LIMIT");
  if (!Number.isInteger(housekeeping) || housekeeping < 1 || housekeeping > 100) throw new Error("INVALID_WORKER_HOUSEKEEPING_LIMIT");

  const summary: ImportWorkerSummary = {
    importExpiredUploads: await options.database.expireImportUploads(housekeeping, options.uploadGraceSeconds ?? IMPORT_UPLOAD_GRACE_SECONDS),
    importPurged: await options.database.purgeExpiredImportBatches(housekeeping),
    importOrphansQueued: await options.database.reconcileOrphanImportObjects(options.orphanMinAgeSeconds ?? IMPORT_ORPHAN_MIN_AGE_SECONDS, housekeeping),
    importJobsClaimed: 0, importParsed: 0, importFailed: {}, importRetried: 0, importStale: 0,
    importCleanupClaimed: 0, importCleanupCompleted: 0, importCleanupRetried: 0,
  };

  const jobs = await options.database.claimImportJobs(limit);
  summary.importJobsClaimed = jobs.length;
  for (const job of jobs) {
    const outcome = await processJob(job, options, summary);
    if (outcome === "parsed") summary.importParsed += 1;
    else if (outcome === "retried") summary.importRetried += 1;
    else if (outcome === "stale") summary.importStale += 1;
  }

  const cleanups = await options.database.claimImportCleanupJobs(housekeeping);
  summary.importCleanupClaimed = cleanups.length;
  for (const job of cleanups) {
    const outcome = await processCleanup(job, options);
    if (outcome === "completed") summary.importCleanupCompleted += 1;
    else if (outcome === "retried") summary.importCleanupRetried += 1;
  }
  return summary;
}
