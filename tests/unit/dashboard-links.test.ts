import { describe, expect, it } from "vitest";

import { readAchievementQuery } from "@/domain/routes/achievement-filters";
import { readProjectQuery } from "@/domain/routes/project-filters";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { dashboardLinks } from "@/domain/dashboard/links";

const SKILL_ID = "70d2c57c-46e8-4cda-9b3b-c47f342099da";
const RECORD_ID = "36bb2b54-ec81-4e20-9306-93798d993fea";

function queryRecord(href: string): Record<string, string> {
  const url = new URL(href, "https://workpulse.invalid");
  return Object.fromEntries(url.searchParams.entries());
}

describe("Dashboard source links", () => {
  it("round-trips every list link through its URL reader and the safe-return allowlist", () => {
    const confirmedHref = dashboardLinks.confirmedAchievements();
    const missingEvidenceHref = dashboardLinks.missingEvidence();
    const skillHref = dashboardLinks.skill(SKILL_ID);
    const activeProjectsHref = dashboardLinks.activeProjects();
    const missingOutcomeHref = dashboardLinks.missingOutcome();

    expect(readAchievementQuery(queryRecord(confirmedHref)).filters).toEqual({
      status: "confirmed", project: "", evidence: "", skill: "",
    });
    expect(readAchievementQuery(queryRecord(missingEvidenceHref)).filters).toEqual({
      status: "confirmed", project: "", evidence: "missing", skill: "",
    });
    expect(readAchievementQuery(queryRecord(skillHref)).filters).toEqual({
      status: "confirmed", project: "", evidence: "", skill: SKILL_ID,
    });
    expect(readProjectQuery(queryRecord(activeProjectsHref)).filters).toEqual({ status: "active", outcome: "" });
    expect(readProjectQuery(queryRecord(missingOutcomeHref)).filters).toEqual({ status: "completed", outcome: "missing" });

    for (const href of [confirmedHref, missingEvidenceHref, skillHref, activeProjectsHref, missingOutcomeHref]) {
      expect(sanitizeReturnTo(href)).toBe(href);
    }
    for (const href of [
      dashboardLinks.activity(RECORD_ID),
      dashboardLinks.project(RECORD_ID),
      dashboardLinks.allActivity(),
      dashboardLinks.newActivity(),
      dashboardLinks.profile(),
    ]) {
      expect(sanitizeReturnTo(href)).toBe(href);
    }
  });
});
