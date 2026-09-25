import { createHash } from "node:crypto";

import { PRIVATE_STORAGE_MIME_TYPES, type PrivateStorageMimeType } from "../src/server/storage/constants.ts";
import { MALWARE_SCAN_MAX_BYTES, type MalwareScanner, type MalwareScanResult } from "../src/server/storage/malware-scanner.ts";

const EVIDENCE_KEY_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/evidence\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const EVIDENCE_SCAN_MAX_ATTEMPTS = 5;
export const EVIDENCE_WORKER_DEFAULT_LIMIT = 1;
export const EVIDENCE_ORPHAN_MIN_AGE_SECONDS = 60 * 60;

export type EvidenceScanJob = {
  id: string;
  user_id: string;
  evidence_id: string;
  object_key: string;
  expected_bytes: number;
  content_type: PrivateStorageMimeType;
  sha256: string;
  attempt_count: number;
  attempt_token: string;
  lease_expires_at: string;
};

export type EvidenceCleanupJob = {
  id: string;
  user_id: string;
  object_key: string;
  attempt_count: number;
  attempt_token: string;
  lease_expires_at: string;
};

export interface EvidenceWorkerDatabase {
  isEvidenceScanCurrent(job: EvidenceScanJob): Promise<boolean>;
  claimEvidenceScanJobs(limit: number): Promise<EvidenceScanJob[]>;
  completeEvidenceScanJob(input: {
    jobId: string;
    attemptToken: string;
    result: "clean" | "rejected";
    errorCode: string | null;
  }): Promise<boolean>;
  retryEvidenceScanJob(input: {
    jobId: string;
    attemptToken: string;
    errorCode: string;
    nextAttemptAt: string;
  }): Promise<boolean>;
  claimEvidenceCleanupJobs(limit: number): Promise<EvidenceCleanupJob[]>;
  completeEvidenceCleanupJob(jobId: string, attemptToken: string): Promise<boolean>;
  failEvidenceCleanupJob(jobId: string, attemptToken: string, errorCode: string): Promise<boolean>;
  retryEvidenceCleanupJob(input: {
    jobId: string;
    attemptToken: string;
    errorCode: string;
    nextAttemptAt: string;
  }): Promise<boolean>;
  expireEvidenceUploads(limit: number): Promise<number>;
  reconcileOrphanEvidenceObjects(minAgeSeconds: number, limit: number): Promise<number>;
}

export interface EvidenceWorkerStorage {
  downloadObject(objectKey: string): Promise<Uint8Array>;
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  removeObject(objectKey: string): Promise<void>;
}

export interface EvidenceWorkerOptions {
  database: EvidenceWorkerDatabase;
  storage: EvidenceWorkerStorage;
  scanner: MalwareScanner;
  claimLimit?: number;
  housekeepingLimit?: number;
  orphanMinAgeSeconds?: number;
  now?: () => Date;
}

export type EvidenceWorkerSummary = {
  expiredReservations: number;
  orphanReceiptsQueued: number;
  scanJobsClaimed: number;
  scanJobsClean: number;
  scanJobsRejected: number;
  scanJobsRetried: number;
  cleanupJobsClaimed: number;
  cleanupJobsCompleted: number;
  cleanupJobsRetried: number;
  cleanupJobsFailed: number;
  staleCompletions: number;
};

function backoffMs(attemptCount: number, capMs: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 20));
  return Math.min(1_000 * 2 ** exponent, capMs);
}

function safeAttemptTime(now: () => Date, attemptCount: number, capMs: number): string {
  return new Date(now().getTime() + backoffMs(attemptCount, capMs)).toISOString();
}

function validMime(value: unknown): value is PrivateStorageMimeType {
  return typeof value === "string" && (PRIVATE_STORAGE_MIME_TYPES as readonly string[]).includes(value);
}

function validScanJob(job: EvidenceScanJob): boolean {
  const key = EVIDENCE_KEY_PATTERN.exec(job.object_key);
  return (
    UUID_PATTERN.test(job.id) &&
    UUID_PATTERN.test(job.user_id) &&
    UUID_PATTERN.test(job.evidence_id) &&
    UUID_PATTERN.test(job.attempt_token) &&
    key?.[1] === job.user_id &&
    key[2] === job.evidence_id &&
    Number.isInteger(job.expected_bytes) &&
    job.expected_bytes > 0 &&
    job.expected_bytes <= MALWARE_SCAN_MAX_BYTES &&
    validMime(job.content_type) &&
    SHA256_PATTERN.test(job.sha256) &&
    Number.isInteger(job.attempt_count) &&
    job.attempt_count >= 1
  );
}

function validCleanupJob(job: EvidenceCleanupJob): boolean {
  const key = EVIDENCE_KEY_PATTERN.exec(job.object_key);
  return (
    UUID_PATTERN.test(job.id) &&
    UUID_PATTERN.test(job.user_id) &&
    UUID_PATTERN.test(job.attempt_token) &&
    key?.[1] === job.user_id &&
    Number.isInteger(job.attempt_count) &&
    job.attempt_count >= 1
  );
}

function isDigestValid(bytes: Uint8Array, expectedBytes: number, expectedHash: string): boolean {
  return bytes.byteLength === expectedBytes && createHash("sha256").update(bytes).digest("hex") === expectedHash;
}

async function retryScanJob(
  job: EvidenceScanJob,
  options: EvidenceWorkerOptions,
  errorCode: string,
): Promise<"retried" | "rejected" | "stale"> {
  if (job.attempt_count >= EVIDENCE_SCAN_MAX_ATTEMPTS) {
    const completed = await options.database.completeEvidenceScanJob({
      jobId: job.id,
      attemptToken: job.attempt_token,
      result: "rejected",
      errorCode,
    });
    return completed ? "rejected" : "stale";
  }

  const retried = await options.database.retryEvidenceScanJob({
    jobId: job.id,
    attemptToken: job.attempt_token,
    errorCode,
    nextAttemptAt: safeAttemptTime(options.now ?? (() => new Date()), job.attempt_count, 5 * 60_000),
  });
  return retried ? "retried" : "stale";
}

async function processScanJob(job: EvidenceScanJob, options: EvidenceWorkerOptions): Promise<"clean" | "rejected" | "retried" | "stale"> {
  if (!validScanJob(job)) {
    // A malformed claimed row must not produce a clean result. Keep a bounded durable
    // retry path when the lease identifiers themselves are valid; otherwise let the
    // lease expire and be reclaimed by the database.
    if (!UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) return "stale";
    const completed = await options.database.completeEvidenceScanJob({
      jobId: job.id,
      attemptToken: job.attempt_token,
      result: "rejected",
      errorCode: "INVALID_SCAN_JOB",
    });
    return completed ? "rejected" : "stale";
  }

  let bytes: Uint8Array;
  if (!await options.database.isEvidenceScanCurrent(job)) {
    const completed = await options.database.completeEvidenceScanJob({ jobId: job.id, attemptToken: job.attempt_token, result: "rejected", errorCode: "EVIDENCE_UNAVAILABLE" });
    return completed ? "rejected" : "stale";
  }
  try {
    bytes = await options.storage.downloadObject(job.object_key);
  } catch {
    return retryScanJob(job, options, "STORAGE_UNAVAILABLE");
  }

  if (!isDigestValid(bytes, job.expected_bytes, job.sha256)) {
    const completed = await options.database.completeEvidenceScanJob({
      jobId: job.id,
      attemptToken: job.attempt_token,
      result: "rejected",
      errorCode: "OBJECT_CONTENT_MISMATCH",
    });
    return completed ? "rejected" : "stale";
  }

  let result: MalwareScanResult;
  if (!await options.database.isEvidenceScanCurrent(job)) {
    const completed = await options.database.completeEvidenceScanJob({ jobId: job.id, attemptToken: job.attempt_token, result: "rejected", errorCode: "EVIDENCE_UNAVAILABLE" });
    return completed ? "rejected" : "stale";
  }
  try {
    result = await options.scanner.scan({ bytes, contentType: job.content_type });
  } catch {
    result = { status: "failed", errorCode: "SCANNER_FAILED" };
  }

  if (result.status === "infected") {
    const completed = await options.database.completeEvidenceScanJob({
      jobId: job.id,
      attemptToken: job.attempt_token,
      result: "rejected",
      errorCode: result.errorCode,
    });
    return completed ? "rejected" : "stale";
  }

  if (result.status !== "clean") {
    return retryScanJob(job, options, result.errorCode);
  }

  // Recheck the same byte buffer after the scanner returns. Only bytes that matched
  // the immutable finalize receipt both before and after scanning may become ready.
  if (!isDigestValid(bytes, job.expected_bytes, job.sha256)) {
    const completed = await options.database.completeEvidenceScanJob({
      jobId: job.id,
      attemptToken: job.attempt_token,
      result: "rejected",
      errorCode: "OBJECT_CONTENT_MISMATCH",
    });
    return completed ? "rejected" : "stale";
  }

  const completed = await options.database.completeEvidenceScanJob({
    jobId: job.id,
    attemptToken: job.attempt_token,
    result: "clean",
    errorCode: null,
  });
  return completed ? "clean" : "stale";
}

async function retryCleanupJob(
  job: EvidenceCleanupJob,
  options: EvidenceWorkerOptions,
  errorCode: string,
): Promise<"retried" | "failed" | "stale"> {
  const retried = await options.database.retryEvidenceCleanupJob({
    jobId: job.id,
    attemptToken: job.attempt_token,
    errorCode,
    nextAttemptAt: safeAttemptTime(options.now ?? (() => new Date()), job.attempt_count, 15 * 60_000),
  });
  return retried ? "retried" : "failed";
}

async function processCleanupJob(
  job: EvidenceCleanupJob,
  options: EvidenceWorkerOptions,
): Promise<"completed" | "retried" | "failed" | "stale"> {
  if (!validCleanupJob(job)) {
    if (!UUID_PATTERN.test(job.id) || !UUID_PATTERN.test(job.attempt_token)) return "stale";
    const failed = await options.database.failEvidenceCleanupJob(job.id, job.attempt_token, "INVALID_OBJECT_KEY");
    return failed ? "failed" : "stale";
  }

  try {
    const metadata = await options.storage.getObjectMetadata(job.object_key);
    if (metadata !== null) {
      await options.storage.removeObject(job.object_key);
      const remaining = await options.storage.getObjectMetadata(job.object_key);
      if (remaining !== null) return retryCleanupJob(job, options, "OBJECT_DELETE_UNVERIFIED");
    }
  } catch {
    return retryCleanupJob(job, options, "STORAGE_UNAVAILABLE");
  }

  const completed = await options.database.completeEvidenceCleanupJob(job.id, job.attempt_token);
  return completed ? "completed" : "stale";
}

/** Process one bounded housekeeping/queue pass; safe to call from once mode or a daemon. */
export async function runEvidenceWorkerOnce(options: EvidenceWorkerOptions): Promise<EvidenceWorkerSummary> {
  const limit = options.claimLimit ?? EVIDENCE_WORKER_DEFAULT_LIMIT;
  const housekeepingLimit = options.housekeepingLimit ?? 25;
  const orphanAge = options.orphanMinAgeSeconds ?? EVIDENCE_ORPHAN_MIN_AGE_SECONDS;
  if (!Number.isInteger(limit) || limit !== 1) throw new Error("INVALID_WORKER_CLAIM_LIMIT");
  if (!Number.isInteger(housekeepingLimit) || housekeepingLimit < 1 || housekeepingLimit > 100) {
    throw new Error("INVALID_WORKER_HOUSEKEEPING_LIMIT");
  }
  if (!Number.isInteger(orphanAge) || orphanAge < 60 * 60) throw new Error("INVALID_ORPHAN_MIN_AGE");

  const summary: EvidenceWorkerSummary = {
    expiredReservations: await options.database.expireEvidenceUploads(housekeepingLimit),
    orphanReceiptsQueued: await options.database.reconcileOrphanEvidenceObjects(orphanAge, housekeepingLimit),
    scanJobsClaimed: 0,
    scanJobsClean: 0,
    scanJobsRejected: 0,
    scanJobsRetried: 0,
    cleanupJobsClaimed: 0,
    cleanupJobsCompleted: 0,
    cleanupJobsRetried: 0,
    cleanupJobsFailed: 0,
    staleCompletions: 0,
  };

  const scanJobs = await options.database.claimEvidenceScanJobs(limit);
  summary.scanJobsClaimed = scanJobs.length;
  const scanResults = await Promise.all(scanJobs.map((job) => processScanJob(job, options)));
  for (const result of scanResults) {
    if (result === "clean") summary.scanJobsClean += 1;
    else if (result === "rejected") summary.scanJobsRejected += 1;
    else if (result === "retried") summary.scanJobsRetried += 1;
    else summary.staleCompletions += 1;
  }

  const cleanupJobs = await options.database.claimEvidenceCleanupJobs(limit);
  summary.cleanupJobsClaimed = cleanupJobs.length;
  const cleanupResults = await Promise.all(cleanupJobs.map((job) => processCleanupJob(job, options)));
  for (const result of cleanupResults) {
    if (result === "completed") summary.cleanupJobsCompleted += 1;
    else if (result === "retried") summary.cleanupJobsRetried += 1;
    else if (result === "failed") summary.cleanupJobsFailed += 1;
    else if (result === "stale") summary.staleCompletions += 1;
  }

  return summary;
}

export interface EvidenceWorker {
  runOnce(): Promise<EvidenceWorkerSummary>;
  run(input: { pollIntervalMs: number; signal?: AbortSignal }): Promise<void>;
}

export function createEvidenceWorker(options: EvidenceWorkerOptions): EvidenceWorker {
  return {
    runOnce: () => runEvidenceWorkerOnce(options),
    async run({ pollIntervalMs, signal }) {
      if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 250 || pollIntervalMs > 60_000) {
        throw new Error("INVALID_WORKER_POLL_INTERVAL");
      }
      while (!signal?.aborted) {
        try {
          await runEvidenceWorkerOnce(options);
        } catch { throw new Error("WORKER_UNAVAILABLE"); }
        if (signal?.aborted) break;
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", finish);
            resolve();
          };
          const timer = setTimeout(finish, pollIntervalMs);
          signal?.addEventListener("abort", finish, { once: true });
        });
      }
    },
  };
}
