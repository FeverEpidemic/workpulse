import { describe, expect, it, vi } from "vitest";

import {
  runAccountDeletionWorkerOnce,
  type AccountDeletionJob,
  type AccountDeletionWorkerDatabase,
  type AccountDeletionWorkerOptions,
} from "../../workers/account-deletion-worker.ts";

const USER = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const OTHER = "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const TOKEN = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const NOW = new Date("2026-10-09T12:00:00.000Z");

function job(overrides: Partial<AccountDeletionJob> = {}): AccountDeletionJob {
  return { user_id: USER, attempt_count: 1, attempt_token: TOKEN, ...overrides };
}

function setup(jobs: AccountDeletionJob[], overrides: Partial<AccountDeletionWorkerDatabase> = {}) {
  const order: string[] = [];
  const database = {
    verifyAccountPurges: vi.fn(async () => { order.push("verify"); return 0; }),
    pruneAccountDeletionReceipts: vi.fn(async () => { order.push("prune"); return 0; }),
    claimAccountDeletionJobs: vi.fn(async () => { order.push("claim"); return jobs; }),
    purgeAccountData: vi.fn(async (userId: string) => { order.push(`purge:${userId}`); return 3; }),
    markAccountAuthDeleted: vi.fn(async (userId: string) => { order.push(`mark:${userId}`); return true; }),
    retryAccountDeletionJob: vi.fn(async () => { order.push("retry"); return true; }),
    ...overrides,
  } satisfies AccountDeletionWorkerDatabase;
  const auth = {
    deleteUser: vi.fn(async (userId: string): Promise<"deleted" | "not_found"> => { order.push(`delete:${userId}`); return "deleted"; }),
  };
  const options = (extra: Partial<AccountDeletionWorkerOptions> = {}): AccountDeletionWorkerOptions => ({ database, auth, now: () => NOW, ...extra });
  return { database, auth, order, options };
}

describe("T23 account deletion worker", () => {
  it("verifies and prunes receipts, claims, then purges, deletes the Auth user and marks it", async () => {
    const h = setup([job()]);
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(h.order).toEqual(["verify", "prune", "claim", `purge:${USER}`, `delete:${USER}`, `mark:${USER}`]);
    expect(h.database.purgeAccountData).toHaveBeenCalledWith(USER, TOKEN);
    expect(h.database.markAccountAuthDeleted).toHaveBeenCalledWith(USER, TOKEN);
    expect(summary).toEqual({
      accountPurgesVerified: 0, accountReceiptsPruned: 0, accountDeletionsClaimed: 1, accountDeletionsPurged: 1,
      accountDeletionsRetried: 0, accountDeletionsStale: 0, accountDeletionsErrored: 0,
    });
  });

  it("reports the housekeeping counts and passes the configured limits", async () => {
    const h = setup([], {
      verifyAccountPurges: vi.fn(async () => 4),
      pruneAccountDeletionReceipts: vi.fn(async () => 2),
    });
    const summary = await runAccountDeletionWorkerOnce(h.options({ claimLimit: 3, housekeepingLimit: 50 }));
    expect(h.database.verifyAccountPurges).toHaveBeenCalledWith(50);
    expect(h.database.pruneAccountDeletionReceipts).toHaveBeenCalledWith(50);
    expect(h.database.claimAccountDeletionJobs).toHaveBeenCalledWith(3);
    expect(summary).toMatchObject({ accountPurgesVerified: 4, accountReceiptsPruned: 2, accountDeletionsClaimed: 0 });
  });

  it("counts an Auth user that is already gone as deleted", async () => {
    const h = setup([job()]);
    h.auth.deleteUser.mockResolvedValue("not_found");
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(summary).toMatchObject({ accountDeletionsPurged: 1, accountDeletionsRetried: 0 });
    expect(h.database.markAccountAuthDeleted).toHaveBeenCalledTimes(1);
  });

  it("retries a failed purge with ACCOUNT_PURGE_FAILED and does not touch Auth", async () => {
    const h = setup([job({ attempt_count: 1 })], { purgeAccountData: vi.fn(async () => { throw new Error("db text WP-SECRET"); }) });
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(h.auth.deleteUser).not.toHaveBeenCalled();
    expect(h.database.markAccountAuthDeleted).not.toHaveBeenCalled();
    expect(h.database.retryAccountDeletionJob).toHaveBeenCalledWith({
      userId: USER, attemptToken: TOKEN, errorCode: "ACCOUNT_PURGE_FAILED", nextAttemptAt: "2026-10-09T12:01:00.000Z",
    });
    expect(summary).toMatchObject({ accountDeletionsRetried: 1, accountDeletionsPurged: 0 });
    expect(JSON.stringify(summary)).not.toContain("WP-SECRET");
  });

  it("retries a failed Auth delete with AUTH_DELETE_FAILED and does not mark it", async () => {
    const h = setup([job({ attempt_count: 2 })]);
    h.auth.deleteUser.mockRejectedValue(new Error("auth down"));
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(h.database.markAccountAuthDeleted).not.toHaveBeenCalled();
    expect(h.database.retryAccountDeletionJob).toHaveBeenCalledWith({
      userId: USER, attemptToken: TOKEN, errorCode: "AUTH_DELETE_FAILED", nextAttemptAt: "2026-10-09T12:05:00.000Z",
    });
    expect(summary.accountDeletionsRetried).toBe(1);
  });

  it("reports a failing backend as WORKER_BACKEND_UNAVAILABLE", async () => {
    const error = Object.assign(new Error("x"), { code: "WORKER_BACKEND_UNAVAILABLE" });
    const h = setup([job()], { purgeAccountData: vi.fn(async () => { throw error; }) });
    await runAccountDeletionWorkerOnce(h.options());
    expect(h.database.retryAccountDeletionJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "WORKER_BACKEND_UNAVAILABLE" }));
  });

  it("backs off 1, 5, 15 and 60 minutes, then stays at 60", async () => {
    const delays: number[] = [];
    for (const attempt of [1, 2, 3, 4, 5, 9]) {
      const h = setup([job({ attempt_count: attempt })], { purgeAccountData: vi.fn(async () => { throw new Error("x"); }) });
      await runAccountDeletionWorkerOnce(h.options());
      const call = vi.mocked(h.database.retryAccountDeletionJob).mock.calls[0]![0];
      delays.push((Date.parse(call.nextAttemptAt) - NOW.getTime()) / 60_000);
    }
    expect(delays).toEqual([1, 5, 15, 60, 60, 60]);
  });

  it("does not finish a job whose step crashes, so the lease can expire and a later pass resumes it", async () => {
    const steps: string[] = [];
    for (const crashAt of ["claimed", "purged", "auth_deleted"] as const) {
      const h = setup([job()]);
      const summary = await runAccountDeletionWorkerOnce(h.options({
        onStep: (step) => { steps.push(step); if (step === crashAt) throw new Error("crash"); },
      }));
      expect(summary).toMatchObject({ accountDeletionsErrored: 1, accountDeletionsPurged: 0, accountDeletionsRetried: 0 });
      expect(h.database.markAccountAuthDeleted).not.toHaveBeenCalled();
      expect(h.database.retryAccountDeletionJob).not.toHaveBeenCalled();
    }
    expect(steps).toEqual(["claimed", "claimed", "purged", "claimed", "purged", "auth_deleted"]);
  });

  it("resumes a re-claimed job from the start: purge and Auth delete are repeated safely", async () => {
    const first = setup([job()]);
    await runAccountDeletionWorkerOnce(first.options({ onStep: (step) => { if (step === "purged") throw new Error("crash"); } }));
    const second = setup([job({ attempt_count: 2, attempt_token: OTHER })]);
    const summary = await runAccountDeletionWorkerOnce(second.options());
    expect(second.database.purgeAccountData).toHaveBeenCalledWith(USER, OTHER);
    expect(second.database.markAccountAuthDeleted).toHaveBeenCalledWith(USER, OTHER);
    expect(summary).toMatchObject({ accountDeletionsPurged: 1 });
  });

  it("counts a job as stale when the lease was lost before the Auth user was marked", async () => {
    const h = setup([job()], { markAccountAuthDeleted: vi.fn(async () => false) });
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(summary).toMatchObject({ accountDeletionsStale: 1, accountDeletionsPurged: 0 });
  });

  it("skips a job without a usable id or token and keeps processing the others", async () => {
    const h = setup([job({ user_id: "not-a-uuid" }), job({ attempt_token: "" }), job({ user_id: OTHER })]);
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(h.database.purgeAccountData).toHaveBeenCalledTimes(1);
    expect(h.database.purgeAccountData).toHaveBeenCalledWith(OTHER, TOKEN);
    expect(summary).toMatchObject({ accountDeletionsClaimed: 3, accountDeletionsStale: 2, accountDeletionsPurged: 1 });
  });

  it("isolates jobs: one that throws unexpectedly does not stop the next", async () => {
    const h = setup([job(), job({ user_id: OTHER })], {
      retryAccountDeletionJob: vi.fn(async () => { throw new Error("backend down"); }),
      purgeAccountData: vi.fn(async (userId: string) => { if (userId === USER) throw new Error("purge fault"); return 1; }),
    });
    const summary = await runAccountDeletionWorkerOnce(h.options());
    expect(summary).toMatchObject({ accountDeletionsClaimed: 2, accountDeletionsErrored: 1, accountDeletionsPurged: 1 });
  });

  it("rejects invalid claim and housekeeping limits", async () => {
    const h = setup([]);
    await expect(runAccountDeletionWorkerOnce(h.options({ claimLimit: 0 }))).rejects.toThrow("INVALID_WORKER_CLAIM_LIMIT");
    await expect(runAccountDeletionWorkerOnce(h.options({ claimLimit: 11 }))).rejects.toThrow("INVALID_WORKER_CLAIM_LIMIT");
    await expect(runAccountDeletionWorkerOnce(h.options({ housekeepingLimit: 0 }))).rejects.toThrow("INVALID_WORKER_HOUSEKEEPING_LIMIT");
    await expect(runAccountDeletionWorkerOnce(h.options({ housekeepingLimit: 501 }))).rejects.toThrow("INVALID_WORKER_HOUSEKEEPING_LIMIT");
  });

  it("returns counts only: no user id, email, object key or token", async () => {
    const h = setup([job()]);
    const summary = await runAccountDeletionWorkerOnce(h.options());
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(USER);
    expect(serialized).not.toContain(TOKEN);
    expect(Object.values(summary).every((value) => typeof value === "number")).toBe(true);
  });
});
