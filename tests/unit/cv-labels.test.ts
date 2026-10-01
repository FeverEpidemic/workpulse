import { describe, expect, it } from "vitest";

import { CV_LABELS, formatCvDateRange, formatCvPartialDate } from "@/domain/cv/labels";
import { CV_SECTION_KEYS } from "@/domain/cv/contracts";

describe("T19 CV labels", () => {
  it("has a heading for every section in en and id", () => {
    for (const locale of ["en", "id"] as const) {
      for (const key of CV_SECTION_KEYS) expect(CV_LABELS[locale].sections[key]).toBeTruthy();
    }
    expect(CV_LABELS.en.sections.education).toBe("Education");
    expect(CV_LABELS.id.sections.education).toBe("Pendidikan");
  });

  it("formats a partial date at its precision without shifting the day", () => {
    expect(formatCvPartialDate("2024-03-01", "year", "en")).toBe("2024");
    expect(formatCvPartialDate("2024-03-01", "month", "en")).toBe("Mar 2024");
    expect(formatCvPartialDate("2024-03-01", "day", "en")).toBe("Mar 1, 2024");
    expect(formatCvPartialDate("2024-03-01", "day", "id")).toContain("2024");
    expect(formatCvPartialDate("2024-12-31", "day", "en")).toBe("Dec 31, 2024");
  });

  it("never invents a placeholder for unknown dates", () => {
    expect(formatCvPartialDate(null, null, "en")).toBeNull();
    expect(formatCvPartialDate("2024-03-01", "unknown", "en")).toBeNull();
    expect(formatCvPartialDate("garbage", "day", "en")).toBeNull();
  });

  it("builds a range with Present or Sekarang for a current item", () => {
    const base = { start_date: "2023-03-01", start_precision: "month", end_date: null, end_precision: null, is_current: true };
    expect(formatCvDateRange(base, "en")).toBe("Mar 2023 – Present");
    expect(formatCvDateRange(base, "id")).toContain("Sekarang");
    expect(formatCvDateRange({ ...base, is_current: false, end_date: "2024-01-01", end_precision: "year" }, "en")).toBe("Mar 2023 – 2024");
    expect(formatCvDateRange({ ...base, is_current: false }, "en")).toBe("Mar 2023");
    expect(formatCvDateRange({ start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false }, "en")).toBeNull();
    expect(formatCvDateRange({ start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: true }, "en")).toBe("Present");
  });
});
