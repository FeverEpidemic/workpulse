import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureAccount, removeAccount, setupHarness, type Harness, type PerfAccount,
} from "./perf-support";
import { countDataset, datasetMatches, EXPECTED_DATASET, MIN_CV_ITEMS, seedDataset } from "./seed";

let harness: Harness;
const accounts: PerfAccount[] = [];

describe("T24 performance dataset", () => {
  beforeAll(async () => {
    harness = setupHarness();
    accounts.push(await ensureAccount(harness, "p"));
    accounts.push(await ensureAccount(harness, "q"));
  });

  afterAll(async () => {
    for (const account of accounts) await removeAccount(harness, account.id);
  });

  it("seeds accounts P and Q through the user RPCs with the volumes of plan section 6", () => {
    for (const account of accounts) {
      const result = seedDataset(account.id);
      expect(datasetMatches(result.counts), `${account.label} dataset`).toBe(true);
    }
    for (const account of accounts) {
      const counts = countDataset(account.id);
      for (const key of Object.keys(EXPECTED_DATASET) as (keyof typeof EXPECTED_DATASET)[]) {
        expect(counts[key], `${account.label}.${key}`).toBe(EXPECTED_DATASET[key]);
      }
      expect(counts.cv_items).toBeGreaterThanOrEqual(MIN_CV_ITEMS);
    }
  });

  it("does not duplicate data when the same account is seeded again", () => {
    for (const account of accounts) {
      const before = countDataset(account.id);
      const again = seedDataset(account.id);
      expect(again.seeded).toBe(false);
      expect(countDataset(account.id)).toEqual(before);
    }
  });
});
