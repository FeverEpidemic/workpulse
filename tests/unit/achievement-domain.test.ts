import { describe, expect, it } from "vitest";

import { buildFactualCvBullet } from "@/domain/achievement/cv-bullet";
import { decodeAchievementCursor, encodeAchievementCursor } from "@/domain/achievement/achievement-cursor";
import { parseAchievementMetrics } from "@/domain/achievement/metrics";
import { availableAchievementActions, nextAchievementStatus } from "@/domain/achievement/transition";
import { readAchievementQuery } from "@/domain/routes/achievement-filters";

describe("factual CV bullet", () => {
  it("preserves English and Indonesian text and trims only the edges", () => {
    expect(buildFactualCvBullet("  Built the intake flow", "Mengurangi waktu tunggu")).toEqual({ status: "ok", value: "Built the intake flow. Mengurangi waktu tunggu" });
  });

  it("uses one space after punctuation and does not duplicate identical outcome", () => {
    expect(buildFactualCvBullet("Built it.", "Reduced rework")).toEqual({ status: "ok", value: "Built it. Reduced rework" });
    expect(buildFactualCvBullet("Reduced rework", "Reduced rework")).toEqual({ status: "ok", value: "Reduced rework" });
  });

  it("does not truncate an over-limit result", () => {
    const result = buildFactualCvBullet("x".repeat(1_000), "y".repeat(1_100));
    expect(result.status).toBe("too_long");
    expect(result.value).toHaveLength(2_102);
  });
});

describe("achievement metrics", () => {
  it("accepts qualitative-free optional metric objects with negative decimals", () => {
    expect(parseAchievementMetrics([{ label: "Time", value: -1.5, unit: "hours", baseline: 2.25 }])).toEqual([
      { label: "Time", value: -1.5, unit: "hours", baseline: 2.25 },
    ]);
  });

  it("rejects additional keys and string numbers", () => {
    expect(() => parseAchievementMetrics([{ label: "x", value: "1", unit: "count" }])).toThrow();
    expect(() => parseAchievementMetrics([{ label: "x", value: 1, unit: "count", extra: true }])).toThrow();
  });

  it("rejects blank values without converting them to zero and accepts explicit zero or decimals", () => {
    expect(() => parseAchievementMetrics([{ label: "People", value: "", unit: "people" }])).toThrow();
    expect(() => parseAchievementMetrics([{ label: "People", value: "   ", unit: "people" }])).toThrow();
    expect(parseAchievementMetrics([])).toEqual([]);
    expect(parseAchievementMetrics([
      { label: "People", value: 0, unit: "people" },
      { label: "Hours", value: -1.25, unit: "hours" },
    ])).toEqual([
      { label: "People", value: 0, unit: "people" },
      { label: "Hours", value: -1.25, unit: "hours" },
    ]);
  });
});

describe("achievement lifecycle", () => {
  it("requires reopen before a dismissed achievement can confirm", () => {
    expect(nextAchievementStatus("dismissed", "confirm")).toBeNull();
    expect(nextAchievementStatus("dismissed", "reopen")).toBe("draft");
    expect(nextAchievementStatus("draft", "confirm")).toBe("confirmed");
    expect(nextAchievementStatus("confirmed", "save_changes")).toBe("confirmed");
    expect(availableAchievementActions("draft")).toEqual(["save_draft", "confirm", "dismiss"]);
    expect(availableAchievementActions("dismissed")).toContain("reopen");
    expect(availableAchievementActions("confirmed")).toContain("save_changes");
  });
});

describe("achievement cursor and URL", () => {
  it("keeps the nullable-date bucket explicit", () => {
    const dated = encodeAchievementCursor({ achievedOn: "2026-09-21", id: "00000000-0000-4000-8000-000000000001" });
    const empty = encodeAchievementCursor({ achievedOn: null, id: "00000000-0000-4000-8000-000000000002" });
    expect(decodeAchievementCursor(dated).bucket).toBe("dated");
    expect(decodeAchievementCursor(empty).bucket).toBe("null");
  });

  it("rejects duplicate or foreign filter values", () => {
    expect(readAchievementQuery("status=draft&status=confirmed").isValid).toBe(false);
    expect(readAchievementQuery("project=not-a-uuid").isValid).toBe(false);
    expect(readAchievementQuery("status=confirmed").filters.status).toBe("confirmed");
  });
});
