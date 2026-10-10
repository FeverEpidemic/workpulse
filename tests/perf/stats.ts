export interface Summary {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

/** Nearest-rank percentile: sorted[ceil(p/100 × n) − 1], with p in [0, 100]. The input is not modified. */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error("percentile needs at least one sample");
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new Error("percentile must be between 0 and 100");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("samples must be finite numbers");
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((p * sorted.length) / 100);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function summarize(samples: readonly number[]): Summary {
  return {
    n: samples.length,
    p50: percentileNearestRank(samples, 50),
    p95: percentileNearestRank(samples, 95),
    max: percentileNearestRank(samples, 100),
  };
}
