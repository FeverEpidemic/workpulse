export type ProgressKind = "ai" | "import" | "export";
export type ProgressStage = "queued" | "running";

// Local pilot hypotheses, not completion estimates.
export const PROGRESS_SLOW_MS: Record<ProgressKind, number> = { ai: 30_000, export: 45_000, import: 60_000 };

export function progressStatusView(nowMs: number, startedAt: number, kind: ProgressKind, _stage: ProgressStage) {
  const elapsedMs = Math.max(0, nowMs - startedAt);
  return { showElapsed: elapsedMs >= 3000, elapsedSeconds: Math.floor(elapsedMs / 1000), slow: elapsedMs >= PROGRESS_SLOW_MS[kind] };
}

export function progressIntervalMs(visible: boolean, mounted: boolean): number | null {
  return visible && mounted ? 1000 : null;
}
