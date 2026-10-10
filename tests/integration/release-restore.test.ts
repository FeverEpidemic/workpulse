import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  authUserExists,
  createAccount,
  getAdmin,
  objectCount,
  profileExists,
  receipt,
  rowsLeft,
  runUntilCompleted,
  seedAccount,
  setupHarness,
  sql,
  teardownHarness,
} from "./account-deletion-support";

// T25 plan section 2.2.9, runbook step "restore without a separate ledger": the deletion receipt is kept 30 days, the
// same bound as the backup retention. Before a restore the operator exports the user ids requested after the restore
// point from the running database; after the restore it calls begin_account_deletion for each id.

const LONG = 240_000;

describe("T25 restore: a deletion requested after the restore point is applied again", () => {
  beforeAll(() => setupHarness());
  afterAll(teardownHarness, LONG);

  it("exports only the receipts after the restore point, and re-applies the deletion to a restored account", async () => {
    // Before the restore point: an account that was already deleted for good.
    const earlier = await createAccount("restore-earlier");
    await seedAccount(earlier);
    expect((await getAdmin().rpc("begin_account_deletion", { p_user_id: earlier.id })).error).toBeNull();
    await runUntilCompleted(earlier.id);
    expect(receipt(earlier.id)?.status).toBe("completed");

    const restorePoint = sql("select clock_timestamp()");

    // After the restore point: an account with data asks to be deleted.
    const restored = await createAccount("restore-after");
    await seedAccount(restored);
    expect(objectCount(restored.id)).toBeGreaterThan(0);
    expect((await getAdmin().rpc("begin_account_deletion", { p_user_id: restored.id })).error).toBeNull();

    // The operator's export, taken from the running database before the restore.
    const exported = sql(
      `select user_id from internal.account_deletions where requested_at > '${restorePoint}'::timestamptz order by requested_at, user_id`,
    ).split("\n").filter((line) => line !== "");
    expect(exported).toEqual([restored.id]);

    // The restore brings the state of the restore point back: data and objects present, no receipt, not marked deleting.
    sql(`delete from internal.account_deletions where user_id = '${restored.id}'::uuid`);
    sql(
      `begin; alter table public.profiles disable trigger zz_guard_account_writable; ` +
      `update public.profiles set deleting_at = null where id = '${restored.id}'::uuid; ` +
      `alter table public.profiles enable trigger zz_guard_account_writable; commit`,
    );
    expect(receipt(restored.id)).toBeNull();
    expect(sql(`select deleting_at is null from public.profiles where id = '${restored.id}'::uuid`)).toBe("t");
    expect(Object.keys(rowsLeft(restored.id)).length).toBeGreaterThan(0);

    // After the restore the operator calls the same RPC for every exported id.
    for (const userId of exported) {
      const begun = await getAdmin().rpc("begin_account_deletion", { p_user_id: userId });
      expect(begun.error, "begin_account_deletion after a restore").toBeNull();
    }
    expect(receipt(restored.id)?.status).toBe("queued");
    await runUntilCompleted(restored.id);

    expect(receipt(restored.id)?.status).toBe("completed");
    expect(rowsLeft(restored.id)).toEqual({});
    expect(objectCount(restored.id)).toBe(0);
    expect(authUserExists(restored.id)).toBe(false);
    expect(profileExists(restored.id)).toBe(false);

    // An id that is no longer in the database (a second run of the procedure, or an account absent from the backup)
    // answers P0002 and changes nothing; the runbook tells the operator to skip it.
    const again = await getAdmin().rpc("begin_account_deletion", { p_user_id: restored.id });
    expect(again.error?.code).toBe("P0002");
    expect(receipt(restored.id)?.status).toBe("completed");
  }, LONG);
});
