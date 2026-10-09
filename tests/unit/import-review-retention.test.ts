import { describe, expect, it } from "vitest";

import { ABANDONED_REVIEW_DAYS, abandonedReviewDeadline } from "@/domain/import/review-retention";

describe("T23 abandoned review deadline", () => {
  it("is 30 days after the last activity, in UTC", () => {
    expect(ABANDONED_REVIEW_DAYS).toBe(30);
    expect(abandonedReviewDeadline("2026-10-01T10:00:00.000Z")?.toISOString()).toBe("2026-10-31T10:00:00.000Z");
    expect(abandonedReviewDeadline(new Date("2026-02-01T00:00:00.000Z"))?.toISOString()).toBe("2026-03-03T00:00:00.000Z");
  });

  it("returns null for a missing or unreadable time", () => {
    expect(abandonedReviewDeadline(null)).toBeNull();
    expect(abandonedReviewDeadline(undefined)).toBeNull();
    expect(abandonedReviewDeadline("not a date")).toBeNull();
    expect(abandonedReviewDeadline("")).toBeNull();
  });
});
