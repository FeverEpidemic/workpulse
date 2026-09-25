import { describe, expect, it } from "vitest";

import { formatProjectDatePart, formatProjectDateRange, projectExperienceLabel, projectNeedsOutcome } from "@/domain/project/project-display";

describe("Project display rules", () => {
  it("renders year, month, day, and unknown dates without placeholder days", () => {
    expect(formatProjectDatePart("2024-01-01", "year", "en")).toBe("2024");
    expect(formatProjectDatePart("2024-02-01", "month", "en")).toMatch(/Feb 2024/);
    expect(formatProjectDatePart("2024-02-29", "day", "en")).toMatch(/Feb 29, 2024/);
    expect(formatProjectDatePart(null, null, "en")).toBeNull();
  });

  it("uses Date not set and Present as labels, and keeps standalone context explicit", () => {
    expect(formatProjectDateRange({ start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false }, "en", "Date not set", "Present")).toBe("Date not set");
    expect(formatProjectDateRange({ start_date: "2024-01-01", start_precision: "year", end_date: null, end_precision: null, is_current: true }, "en", "Date not set", "Present")).toBe("2024 – Present");
    expect(projectExperienceLabel(null, "Independent")).toBe("Independent");
    expect(projectNeedsOutcome({ status: "completed", outcome: null })).toBe(true);
    expect(projectNeedsOutcome({ status: "completed", outcome: "Shipped" })).toBe(false);
  });
});
