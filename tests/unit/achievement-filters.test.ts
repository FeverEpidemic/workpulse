import { describe, expect, it } from "vitest";

import {
  achievementListHref,
  EMPTY_ACHIEVEMENT_FILTERS,
  readAchievementQuery,
} from "@/domain/routes/achievement-filters";

const SKILL_ID = "70d2c57c-46e8-4cda-9b3b-c47f342099da";

describe("Achievement list filters", () => {
  it("accepts missing evidence and a UUID skill filter", () => {
    expect(readAchievementQuery(`status=confirmed&evidence=missing&skill=${SKILL_ID}`).filters).toEqual({
      status: "confirmed",
      project: "",
      evidence: "missing",
      skill: SKILL_ID,
    });
  });

  it("rejects unsupported values, duplicates, and non-UUID skills independently", () => {
    expect(readAchievementQuery("evidence=yes")).toMatchObject({
      filters: { evidence: "" },
      errors: { evidence: "invalid" },
      isValid: false,
    });
    expect(readAchievementQuery("evidence=missing&evidence=missing").errors.evidence).toBe("invalid");
    expect(readAchievementQuery("skill=not-a-uuid")).toMatchObject({
      filters: { skill: "" },
      errors: { skill: "invalid" },
      isValid: false,
    });
    expect(readAchievementQuery(`skill=${SKILL_ID}&skill=${SKILL_ID}`).errors.skill).toBe("invalid");
  });

  it("writes filters in a stable order and omits empty values", () => {
    expect(achievementListHref({
      status: "confirmed",
      project: SKILL_ID,
      evidence: "missing",
      skill: SKILL_ID,
    }, "cursor-value")).toBe(
      `/achievements?status=confirmed&project=${SKILL_ID}&evidence=missing&skill=${SKILL_ID}&cursor=cursor-value`,
    );
    expect(achievementListHref(EMPTY_ACHIEVEMENT_FILTERS)).toBe("/achievements");
    expect(EMPTY_ACHIEVEMENT_FILTERS).toEqual({ status: "", project: "", evidence: "", skill: "" });
  });
});
