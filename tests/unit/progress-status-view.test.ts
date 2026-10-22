import { afterEach, describe, expect, it, vi } from "vitest";
import { progressIntervalMs, progressStatusView } from "@/components/ui/progress-status-view";

afterEach(() => vi.useRealTimers());
describe("T30 waiting time", () => {
  it("reveals elapsed time at three seconds using the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const startedAt = Date.now();
    vi.advanceTimersByTime(2999);
    expect(progressStatusView(Date.now(), startedAt, "ai", "queued").showElapsed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(progressStatusView(Date.now(), startedAt, "ai", "running")).toEqual({showElapsed: true, elapsedSeconds: 3, slow: false});
  });
  it.each([["ai",30_000],["export",45_000],["import",60_000]] as const)("warns at the %s threshold", (kind, threshold) => {
    expect(progressStatusView(threshold-1,0,kind,"running").slow).toBe(false);
    expect(progressStatusView(threshold,0,kind,"running").slow).toBe(true);
  });
  it("clamps a future start time",()=>{
    expect(progressStatusView(1000,5000,"import","queued")).toEqual({showElapsed:false,elapsedSeconds:0,slow:false});
  });
  it("suspends the interval while hidden or unmounted",()=>{
    expect(progressIntervalMs(true,true)).toBe(1000);
    expect(progressIntervalMs(false,true)).toBeNull();
    expect(progressIntervalMs(true,false)).toBeNull();
  });
  it("accepts only known job kinds",()=>{
    if (false) {
      // @ts-expect-error Unknown kinds must not silently get an arbitrary threshold.
      progressStatusView(0,0,"unknown","queued");
    }
    expect(progressStatusView(0,0,"ai","queued").elapsedSeconds).toBe(0);
  });
});
