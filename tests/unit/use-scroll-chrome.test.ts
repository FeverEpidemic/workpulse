import { describe, expect, it } from "vitest";

import {
  CHROME_DELTA,
  CHROME_TOP,
  expandedChrome,
  headerShouldHide,
  nextChrome,
  type ChromeState,
} from "@/components/layout/use-scroll-chrome";

function scrollThrough(positions: number[], start: ChromeState = expandedChrome(0)): ChromeState {
  return positions.reduce(nextChrome, start);
}

describe("T27 scroll chrome state", () => {
  it("uses the thresholds from the plan", () => {
    expect(CHROME_TOP).toBe(24);
    expect(CHROME_DELTA).toBe(8);
  });

  it("stays expanded at the top of the page", () => {
    expect(scrollThrough([10, 20, 24]).compact).toBe(false);
  });

  it("compacts after scrolling down past the top by at least the delta", () => {
    expect(scrollThrough([40]).compact).toBe(true);
    expect(scrollThrough([30, 40]).compact).toBe(true);
  });

  it("ignores small moves and adds them up until they pass the delta", () => {
    const start = expandedChrome(100);
    expect(nextChrome(start, 105).compact).toBe(false);
    expect(scrollThrough([103, 106, 109], start).compact).toBe(true);
  });

  it("expands on an upward scroll of at least the delta, but not on a small bounce", () => {
    const compact = scrollThrough([200]);
    expect(compact.compact).toBe(true);
    expect(nextChrome(compact, 195).compact).toBe(true);
    expect(nextChrome(compact, 192).compact).toBe(false);
  });

  it("expands when the page returns to the top even with a small delta", () => {
    const compact = scrollThrough([30]);
    expect(compact.compact).toBe(true);
    expect(nextChrome(compact, 24).compact).toBe(false);
  });

  it("returns the same object when nothing changes, so React can skip a render", () => {
    const state = expandedChrome(100);
    expect(nextChrome(state, 102)).toBe(state);
  });

  it("starts a new page expanded from its own scroll position", () => {
    expect(expandedChrome(0)).toEqual({ compact: false, lastY: 0 });
  });
});

describe("T27 header visibility", () => {
  it("hides the header only while the bar is compact", () => {
    expect(headerShouldHide({ compact: true, focusWithin: false, sheetOpen: false })).toBe(true);
    expect(headerShouldHide({ compact: false, focusWithin: false, sheetOpen: false })).toBe(false);
  });

  it("never hides while keyboard focus is inside it or a sheet is open", () => {
    expect(headerShouldHide({ compact: true, focusWithin: true, sheetOpen: false })).toBe(false);
    expect(headerShouldHide({ compact: true, focusWithin: false, sheetOpen: true })).toBe(false);
  });
});
