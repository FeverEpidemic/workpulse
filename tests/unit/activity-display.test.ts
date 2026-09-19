import { describe, expect, it } from "vitest";

import { activityExcerpt, formatActivityDate, resolveActivityContext } from "@/domain/activity/activity-display";

const EXPERIENCE_ID = "69d5940d-288c-4d5b-a9a7-41954870c1b8";
const PROJECT_ID = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";

describe("Activity display helpers", () => {
  it("formats exact calendar dates for English and Indonesian without timezone shifts", () => {
    expect(formatActivityDate("2025-12-31", "en")).toBe("Dec 31, 2025");
    expect(formatActivityDate("2025-12-31", "id")).toBe("31 Des 2025");
    expect(formatActivityDate("2025-02-30", "en")).toBe("2025-02-30");
  });

  it("creates a compact presentation excerpt by code point without editing the source", () => {
    const source = "  First line\n\nSecond line " + "🌱".repeat(5);
    const excerpt = activityExcerpt(source, 18);
    expect(excerpt).toBe("First line Second…");
    expect(source).toBe("  First line\n\nSecond line " + "🌱".repeat(5));
    expect(Array.from(activityExcerpt("🌱🌱🌱", 2))).toEqual(["🌱", "🌱", "…"]);
  });

  it("resolves owned labels while representing missing or foreign context uniformly", () => {
    const options = {
      projects: [{ id: PROJECT_ID, title: "Launch", experience_id: EXPERIENCE_ID }],
      experiences: [{ id: EXPERIENCE_ID, role_title: "Analyst", organization: "North" }],
    };
    expect(resolveActivityContext({ project_id: PROJECT_ID, experience_id: EXPERIENCE_ID }, options)).toEqual({
      projectLabel: "Launch",
      experienceLabel: "Analyst · North",
      projectUnavailable: false,
      experienceUnavailable: false,
    });
    expect(resolveActivityContext({ project_id: "foreign", experience_id: "missing" }, options)).toEqual({
      projectLabel: null,
      experienceLabel: null,
      projectUnavailable: true,
      experienceUnavailable: true,
    });
  });
});
