const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Retry delays after the first, second, third and fourth failure; later attempts keep the last delay. */
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;

export type AccountDeletionJob = {
  user_id: string;
  attempt_count: number;
  attempt_token: string;
};

/** Service-role operations; every transition is compare-and-set in PostgreSQL. */
export interface AccountDeletionWorkerDatabase {
  verifyAccountPurges(limit: number): Promise<number>;
  pruneAccountDeletionReceipts(limit: number): Promise<number>;
  claimAccountDeletionJobs(limit: number): Promise<AccountDeletionJob[]>;
  purgeAccountData(userId: string, attemptToken: string): Promise<number>;
  markAccountAuthDeleted(userId: string, attemptToken: string): Promise<boolean>;
  retryAccountDeletionJob(input: { userId: string; attemptToken: string; errorCode: string; nextAttemptAt: string }): Promise<boolean>;
}

/** Auth Admin API: a user that is already gone counts as deleted. */
export interface AccountDeletionWorkerAuth {
  deleteUser(userId: string): Promise<"deleted" | "not_found">;
}

export type AccountDeletionStep = "claimed" | "purged" | "auth_deleted";

export type AccountDeletionWorkerOptions = {
  database: AccountDeletionWorkerDatabase;
  auth: AccountDeletionWorkerAuth;
  claimLimit?: number;
  housekeepingLimit?: number;
  now?: () => Date;
  /** Test seam: runs after each step of a job. A throw simulates a crash; the lease then expires and the job is claimed again. */
  onStep?: (step: AccountDeletionStep, job: AccountDeletionJob) => Promise<void> | void;
};

/** Counts only; never a user id, an email, or an object key. */
export type AccountDeletionWorkerSummary = {
  accountPurgesVerified: number;
  accountReceiptsPruned: number;
  accountDeletionsClaimed: number;
  accountDeletionsPurged: number;
  accountDeletionsRetried: number;
  accountDeletionsStale: number;
  accountDeletionsErrored: number;
};

function nextAttemptIso(now: () => Date, attempt: number): string {
  const index = Math.min(Math.max(attempt, 1), BACKOFF_MINUTES.length) - 1;
  return new Date(now().getTime() + BACKOFF_MINUTES[index]! * 60_000).toISOString();
}

/** Safe code for a failed step; a failing backend is reported as such so it is not mistaken for a purge fault. */
function failureCode(error: unknown, fallback: "ACCOUNT_PURGE_FAILED" | "AUTH_DELETE_FAILED"): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code: unknown }).code : undefined;
  return code === "WORKER_BACKEND_UNAVAILABLE" ? code : fallback;
}

type Outcome = "purged" | "retried" | "stale";

async function processJob(job: AccountDeletionJob, options: AccountDeletionWorkerOptions): Promise<Outcome> {
  const now = options.now ?? (() => new Date());
  // Without a usable id and token nothing can be reported; the lease expiry returns the job to the queue.
  if (!UUID_PATTERN.test(job.user_id) || !UUID_PATTERN.test(job.attempt_token)) return "stale";

  const retry = async (code: string): Promise<Outcome> => {
    const recorded = await options.database.retryAccountDeletionJob({
      userId: job.user_id, attemptToken: job.attempt_token, errorCode: code, nextAttemptAt: nextAttemptIso(now, job.attempt_count),
    });
    return recorded ? "retried" : "stale";
  };

  await options.onStep?.("claimed", job);

  try {
    await options.database.purgeAccountData(job.user_id, job.attempt_token);
  } catch (error) {
    return retry(failureCode(error, "ACCOUNT_PURGE_FAILED"));
  }
  await options.onStep?.("purged", job);

  try {
    await options.auth.deleteUser(job.user_id);
  } catch (error) {
    return retry(failureCode(error, "AUTH_DELETE_FAILED"));
  }
  await options.onStep?.("auth_deleted", job);

  return await options.database.markAccountAuthDeleted(job.user_id, job.attempt_token) ? "purged" : "stale";
}

/** One bounded pass: receipt housekeeping, then the claimed deletions (purge, delete the Auth user, mark it). */
export async function runAccountDeletionWorkerOnce(options: AccountDeletionWorkerOptions): Promise<AccountDeletionWorkerSummary> {
  const limit = options.claimLimit ?? 5;
  const housekeeping = options.housekeepingLimit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("INVALID_WORKER_CLAIM_LIMIT");
  if (!Number.isInteger(housekeeping) || housekeeping < 1 || housekeeping > 500) throw new Error("INVALID_WORKER_HOUSEKEEPING_LIMIT");

  const summary: AccountDeletionWorkerSummary = {
    accountPurgesVerified: await options.database.verifyAccountPurges(housekeeping),
    accountReceiptsPruned: await options.database.pruneAccountDeletionReceipts(housekeeping),
    accountDeletionsClaimed: 0,
    accountDeletionsPurged: 0,
    accountDeletionsRetried: 0,
    accountDeletionsStale: 0,
    accountDeletionsErrored: 0,
  };

  const jobs = await options.database.claimAccountDeletionJobs(limit);
  summary.accountDeletionsClaimed = jobs.length;
  for (const job of jobs) {
    // One failing job never stops the others; an unexpected error leaves the lease to expire.
    const outcome = await processJob(job, options).catch(() => null);
    if (outcome === null) summary.accountDeletionsErrored += 1;
    else if (outcome === "purged") summary.accountDeletionsPurged += 1;
    else if (outcome === "retried") summary.accountDeletionsRetried += 1;
    else summary.accountDeletionsStale += 1;
  }
  return summary;
}
