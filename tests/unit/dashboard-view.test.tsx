import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DashboardData } from "@/domain/dashboard/contracts";
import { DashboardView } from "@/features/dashboard/dashboard-view";

function data(over: Partial<DashboardData> = {}): DashboardData {
  return {
    summary: {
      confirmedAchievementCount: 4, activeProjectCount: 1, demonstratedSkillCount: 2, missingEvidenceCount: 0,
      completedMissingOutcomeCount: 0, hasCareerRecords: true,
    },
    cvReview: { hasCv: true, reviewCount: 0, availableCount: 0 },
    recentActivities: [],
    activeProjects: [],
    skills: [],
    ...over,
  };
}

const render = (value: DashboardData, locale: "en" | "id" = "en") =>
  renderToStaticMarkup(<DashboardView data={value} displayName="Ani" locale={locale} />);

describe("T20 dashboard CV checks", () => {
  it("shows no CV check and keeps the empty message when both counts are zero", () => {
    const html = render(data());
    expect(html).not.toContain("/cv#");
    expect(html).toContain("No checks need attention.");
  });

  it("shows two separate checks with their own counts and links", () => {
    const html = render(data({ cvReview: { hasCv: true, reviewCount: 3, availableCount: 2 } }));
    expect(html).toContain("3 CV items need review.");
    expect(html).toContain("2 confirmed achievements are not on your CV.");
    expect(html).toContain('href="/cv#cv-review"');
    expect(html).toContain('href="/cv#cv-pool-achievements"');
    expect(html).not.toContain("No checks need attention.");
  });

  it("uses the singular form and hides a check whose count is zero", () => {
    const review = render(data({ cvReview: { hasCv: true, reviewCount: 1, availableCount: 0 } }));
    expect(review).toContain("1 CV item needs review.");
    expect(review).toContain('href="/cv#cv-review"');
    expect(review).not.toContain("/cv#cv-pool-achievements");
    const available = render(data({ cvReview: { hasCv: false, reviewCount: 0, availableCount: 1 } }));
    expect(available).toContain("1 confirmed achievement is not on your CV.");
    expect(available).not.toContain("/cv#cv-review");
  });

  it("keeps the existing checks beside the CV checks", () => {
    const html = render(data({
      summary: { ...data().summary, missingEvidenceCount: 2, completedMissingOutcomeCount: 1 },
      cvReview: { hasCv: true, reviewCount: 1, availableCount: 1 },
    }));
    expect(html).toContain("2 confirmed achievements have no ready evidence.");
    expect(html).toContain("1 completed project has no outcome.");
    expect(html.match(/<li><a[^>]*>/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("localizes both checks in Indonesian", () => {
    const html = render(data({ cvReview: { hasCv: true, reviewCount: 2, availableCount: 5 } }), "id");
    expect(html).toContain("2 item CV perlu ditinjau.");
    expect(html).toContain("5 pencapaian terkonfirmasi belum ada di CV Anda.");
  });
});
