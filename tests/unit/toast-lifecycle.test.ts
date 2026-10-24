import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleToastLifecycle } from "@/components/ui/toast";
afterEach(() => vi.useRealTimers());
describe("T30 toast lifecycle", () => {
  it("starts leaving 120 ms before removal at 4500 ms", () => {
    vi.useFakeTimers();
    const leaving = vi.fn(); const removed = vi.fn();
    scheduleToastLifecycle(leaving, removed);
    vi.advanceTimersByTime(4379); expect(leaving).not.toHaveBeenCalled(); expect(removed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(leaving).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(119); expect(removed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(removed).toHaveBeenCalledOnce();
  });
  it("cancels both timers on unmount", () => {
    vi.useFakeTimers(); const event = vi.fn();
    const cancel = scheduleToastLifecycle(event, event);
    cancel(); vi.advanceTimersByTime(5000); expect(event).not.toHaveBeenCalled();
  });
});
