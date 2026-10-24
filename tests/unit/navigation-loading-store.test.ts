import { describe, expect, it, vi } from "vitest";
import { createNavigationLoadingStore, matchesNavigationDestination } from "@/components/layout/navigation-loading-store";

describe("T30 fallback navigation lifecycle", () => {
  it.each([
    ["/activity", "/activity", true],
    ["/activity", "/activity/one", true],
    ["/activity", "/activities", false],
    ["/activity?from=2026-01-01", "/activity/one#note", true],
    ["/projects", "/activity", false],
    ["https://example.com/activity", "/activity", false],
  ])("matches %s against %s", (href, path, expected) => {
    expect(matchesNavigationDestination(href, path)).toBe(expected);
  });
  it("keeps a newer fallback registered when an older mount cleans up", () => {
    const store = createNavigationLoadingStore();
    const old = store.register("/activity");
    const current = store.register("/activity/new");
    old();
    expect(store.isLoading("/activity")).toBe(true);
    old();
    expect(store.isLoading("/activity")).toBe(true);
    current();
    expect(store.isLoading("/activity")).toBe(false);
  });
  it("notifies mounted subscribers and isolates destinations", () => {
    const store = createNavigationLoadingStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const finish = store.register("/projects");
    expect(store.isLoading("/projects")).toBe(true);
    expect(store.isLoading("/activity")).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    finish();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.isLoading("/projects")).toBe(false);
  });
});
