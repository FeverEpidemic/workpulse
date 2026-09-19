import { describe, expect, it } from "vitest";

import { activityDateInTimeZone, isExactActivityDate } from "@/domain/activity/activity-date";

describe("exact Activity calendar dates", () => {
  it("accepts real ISO calendar dates and rejects overflow", () => {
    expect(isExactActivityDate("2024-02-29")).toBe(true);
    expect(isExactActivityDate("2026-02-28")).toBe(true);
    expect(isExactActivityDate("2026-02-29")).toBe(false);
    expect(isExactActivityDate("2026-02-30")).toBe(false);
    expect(isExactActivityDate("2026-13-01")).toBe(false);
    expect(isExactActivityDate("0000-01-01")).toBe(false);
    expect(isExactActivityDate("2026-2-01")).toBe(false);
    expect(isExactActivityDate("2026-02-01T00:00:00Z")).toBe(false);
  });

  it("uses the profile timezone at a date boundary without reading the machine timezone", () => {
    const instant = new Date("2026-01-01T00:30:00.000Z");
    expect(activityDateInTimeZone(instant, "Asia/Bangkok")).toBe("2026-01-01");
    expect(activityDateInTimeZone(instant, "America/Los_Angeles")).toBe("2025-12-31");
  });

  it("rejects invalid instants and timezone names", () => {
    expect(() => activityDateInTimeZone(new Date(Number.NaN), "UTC")).toThrow(RangeError);
    expect(() => activityDateInTimeZone(new Date(), "Mars/Phobos")).toThrow(RangeError);
  });
});

