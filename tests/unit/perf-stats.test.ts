import { describe, expect, it } from "vitest";

import { percentileNearestRank, summarize } from "../perf/stats";

const ramp = (n: number) => Array.from({ length: n }, (_, index) => index + 1);

describe("T24 nearest-rank percentile", () => {
  it("returns the only sample for n = 1", () => {
    expect(percentileNearestRank([42], 95)).toBe(42);
    expect(percentileNearestRank([42], 50)).toBe(42);
  });

  it("uses sorted[ceil(p/100 × n) − 1]", () => {
    // n = 20: ceil(19) = 19 -> the 19th value
    expect(percentileNearestRank(ramp(20), 95)).toBe(19);
    // n = 50: ceil(47.5) = 48
    expect(percentileNearestRank(ramp(50), 95)).toBe(48);
    // n = 51: ceil(48.45) = 49
    expect(percentileNearestRank(ramp(51), 95)).toBe(49);
    expect(percentileNearestRank(ramp(100), 95)).toBe(95);
    expect(percentileNearestRank(ramp(20), 50)).toBe(10);
  });

  it("does not depend on the input order and does not mutate the input", () => {
    const values = [9, 1, 7, 3, 5, 2, 8, 4, 6, 10];
    const copy = [...values];
    expect(percentileNearestRank(values, 90)).toBe(9);
    expect(percentileNearestRank(values, 100)).toBe(10);
    expect(percentileNearestRank(values, 0)).toBe(1);
    expect(values).toEqual(copy);
  });

  it("rejects an empty list, a percentile outside 0 to 100 and non-finite input", () => {
    expect(() => percentileNearestRank([], 95)).toThrow();
    expect(() => percentileNearestRank([1, 2], -1)).toThrow();
    expect(() => percentileNearestRank([1, 2], 100.5)).toThrow();
    expect(() => percentileNearestRank([1, 2], Number.NaN)).toThrow();
    expect(() => percentileNearestRank([1, Number.NaN], 50)).toThrow();
    expect(() => percentileNearestRank([1, Number.POSITIVE_INFINITY], 50)).toThrow();
  });
});

describe("T24 summarize", () => {
  it("reports n, p50, p95 and max", () => {
    expect(summarize([5, 1, 3])).toEqual({ n: 3, p50: 3, p95: 5, max: 5 });
    expect(summarize(ramp(50))).toEqual({ n: 50, p50: 25, p95: 48, max: 50 });
  });

  it("rejects an empty sample set", () => {
    expect(() => summarize([])).toThrow();
  });
});
