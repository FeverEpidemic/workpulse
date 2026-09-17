import { describe, expect, it } from "vitest";

import { historyEntryIndex, historyStateWithIndex, historyTraversalDelta } from "@/domain/routes/unsaved-navigation";

describe("same-document history guard state", () => {
  it("adds a stable index without dropping App Router state", () => {
    const state = historyStateWithIndex({ __NA: true, tree: ["root"] }, 4);
    expect(state).toEqual({ __NA: true, tree: ["root"], __workpulse_history_index: 4 });
    expect(historyEntryIndex(state)).toBe(4);
  });

  it("computes Back and Forward deltas and uses a Back fallback for legacy entries", () => {
    expect(historyTraversalDelta(5, { __workpulse_history_index: 2 })).toBe(-3);
    expect(historyTraversalDelta(2, { __workpulse_history_index: 5 })).toBe(3);
    expect(historyTraversalDelta(0, null)).toBe(-1);
  });
});
