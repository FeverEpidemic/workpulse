const HISTORY_INDEX_KEY = "__workpulse_history_index";

export function historyEntryIndex(state: unknown): number | null {
  if (state === null || typeof state !== "object" || Array.isArray(state)) return null;
  const index = (state as Record<string, unknown>)[HISTORY_INDEX_KEY];
  return typeof index === "number" && Number.isSafeInteger(index) ? index : null;
}

export function historyStateWithIndex(state: unknown, index: number): Record<string, unknown> {
  const base = state !== null && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  return { ...base, [HISTORY_INDEX_KEY]: index };
}

export function historyTraversalDelta(currentIndex: number, targetState: unknown): number {
  const targetIndex = historyEntryIndex(targetState);
  return targetIndex === null ? -1 : targetIndex - currentIndex;
}
