import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SENTINEL,
  authUserExists,
  createAccount,
  deleteThroughService,
  expireLease,
  getAdmin,
  getDeletionGateway,
  objectCount,
  profileExists,
  receipt,
  rowsLeft,
  runPasses,
  runUntilCompleted,
  seedAccount,
  sentinelHits,
  setupHarness,
  sql,
  storageJobs,
  teardownHarness,
} from "./account-deletion-support";

const LONG = 150_000;
const durations: number[] = [];

beforeAll(() => setupHarness());
afterAll(async () => {
  await teardownHarness();
  if (durations.length > 0) process.stdout.write(`ACCOUNT-DELETION-DURATION-SECONDS ${JSON.stringify(durations)}\n`);
});

describe("T23 account deletion: full path with real Auth, Storage and workers", () => {
  it("deletes rows, objects and the Auth user, keeps the queue, and leaves another account untouched", async () => {
    const a = await createAccount("full-a");
    const b = await createAccount("full-b");
    const seededA = await seedAccount(a);
    const seededB = await seedAccount(b);
    const bRowsBefore = rowsLeft(b.id);
    const bObjectsBefore = objectCount(b.id);
    expect(Object.keys(rowsLeft(a.id)).length).toBeGreaterThanOrEqual(8);
    expect(objectCount(a.id)).toBe(4);

    const result = await deleteThroughService(a);
    expect(result).toEqual({ revokeDeferred: false });
    expect(receipt(a.id)).toMatchObject({ status: "queued", attempt_count: 0 });
    expect(sql(`select deleting_at is not null from public.profiles where id = '${a.id}'`)).toBe("t");

    const rounds = await runUntilCompleted(a.id);
    expect(rounds).toBeLessThan(12);

    const done = receipt(a.id)!;
    expect(done.status).toBe("completed");
    expect(done.requested_at).not.toBeNull();
    expect(done.objects_enqueued_at).not.toBeNull();
    expect(done.rows_purged_at).not.toBeNull();
    expect(done.auth_deleted_at).not.toBeNull();
    expect(done.completed_at).not.toBeNull();
    expect(done.last_error_code).toBeNull();
    durations.push(Math.round((done.seconds ?? 0) * 10) / 10);
    expect(done.seconds ?? Number.POSITIVE_INFINITY).toBeLessThan(24 * 3600);

    expect(rowsLeft(a.id)).toEqual({});
    expect(profileExists(a.id)).toBe(false);
    expect(authUserExists(a.id)).toBe(false);
    expect(objectCount(a.id)).toBe(0);
    expect(storageJobs(a.id)).toMatchObject({ open: 0 });
    expect(storageJobs(a.id).total).toBeGreaterThanOrEqual(4);
    expect(Object.values(seededA)).toHaveLength(6);

    // The private sentinel of account A is gone from every public table; account B still holds its own.
    expect(sentinelHits()).toBeGreaterThan(0);
    expect(sql(`select count(*) from public.activities where user_id = '${a.id}' and raw_text like '%${SENTINEL}%'`)).toBe("0");
    expect(sql(`select count(*) from public.evidence_files where user_id = '${a.id}'`)).toBe("0");

    // Account B: rows, objects and its own sentinel survive; its sessions still work.
    expect(rowsLeft(b.id)).toEqual(bRowsBefore);
    expect(objectCount(b.id)).toBe(bObjectsBefore);
    expect(sql(`select count(*) from public.activities where user_id = '${b.id}' and raw_text like '%${SENTINEL}%'`)).toBe("1");
    expect((await b.client.auth.getUser()).data.user?.id).toBe(b.id);
    expect(Object.values(seededB)).toHaveLength(6);
  }, LONG);

  it("never marks a receipt completed while an object or an open cleanup job is left", async () => {
    const a = await createAccount("hold");
    const seeded = await seedAccount(a);
    await deleteThroughService(a);
    // One pass purges and queues cleanup, but the cleanup passes have not yet removed every object.
    await getDeletionGateway().database.verifyAccountPurges(100);
    expect(receipt(a.id)?.status).toBe("queued");
    await runPasses();
    const during = receipt(a.id)!;
    if (objectCount(a.id) > 0 || storageJobs(a.id).open > 0) expect(during.status).not.toBe("completed");
    await runUntilCompleted(a.id);
    expect(receipt(a.id)?.status).toBe("completed");
    expect(objectCount(a.id)).toBe(0);
    expect(seeded.orphanKey).toContain(a.id);
  }, LONG);
});

describe("T23 account deletion: a restarted worker loses nothing", () => {
  async function crashAt(step: "claimed" | "purged" | "auth_deleted", label: string) {
    const account = await createAccount(label);
    await seedAccount(account);
    await deleteThroughService(account);

    let oldToken = "";
    const crashed = await runPasses({
      onStep: (reached, job) => {
        oldToken = job.attempt_token;
        if (reached === step) throw new Error("simulated crash");
      },
    });
    expect(crashed.accountDeletionsErrored).toBe(1);
    expect(receipt(account.id)).toMatchObject({ status: "running", has_token: true });
    expect(receipt(account.id)?.auth_deleted_at).toBeNull();

    // While the lease is alive nobody else may take the job.
    const parallel = await getDeletionGateway().database.claimAccountDeletionJobs(5);
    expect(parallel.filter((job) => job.user_id === account.id)).toHaveLength(0);

    expireLease(account.id);
    const rounds = await runUntilCompleted(account.id);
    expect(rounds).toBeLessThan(12);
    expect(receipt(account.id)).toMatchObject({ status: "completed" });
    expect(rowsLeft(account.id)).toEqual({});
    expect(authUserExists(account.id)).toBe(false);
    expect(objectCount(account.id)).toBe(0);

    // The token of the crashed attempt can no longer finish or retry anything.
    expect(await getDeletionGateway().database.markAccountAuthDeleted(account.id, oldToken)).toBe(false);
    expect(await getDeletionGateway().database.retryAccountDeletionJob({
      userId: account.id, attemptToken: oldToken, errorCode: "AUTH_DELETE_FAILED", nextAttemptAt: new Date().toISOString(),
    })).toBe(false);
    return receipt(account.id)!;
  }

  it("resumes after a crash right after the claim", async () => {
    const done = await crashAt("claimed", "crash-claim");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
  }, LONG);

  it("resumes after a crash right after the purge: the second purge is a no-op", async () => {
    const done = await crashAt("purged", "crash-purge");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
  }, LONG);

  it("resumes after a crash right after the Auth user was deleted: a 404 counts as done", async () => {
    const done = await crashAt("auth_deleted", "crash-auth");
    expect(done.attempt_count).toBeGreaterThanOrEqual(2);
    expect(done.auth_deleted_at).not.toBeNull();
  }, LONG);
});

describe("T23 account deletion: the Auth admin adapter", () => {
  it("treats a user that does not exist as not_found and rejects a malformed id", async () => {
    const { auth } = getDeletionGateway();
    await expect(auth.deleteUser("5f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f")).resolves.toBe("not_found");
    await expect(auth.deleteUser("not-a-uuid")).rejects.toMatchObject({ code: "WORKER_AUTH_UNAVAILABLE" });
    expect(getAdmin()).toBeDefined();
  });
});
