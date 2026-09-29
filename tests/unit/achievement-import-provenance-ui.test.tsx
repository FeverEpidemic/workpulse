import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AchievementSourceCard } from "@/features/achievement/achievement-source-card";
import { t } from "@/i18n/messages";

const EXCERPT = "ACH|Menurunkan waktu laporan dari 5 ke 2 jam|PT Contoh";

const activity = {
  id: "8f14e45f-ea5e-4a0b-9c2b-000000000001", raw_text: "Catatan aktivitas asli", revision: 3, occurred_on: "2026-09-01",
  role: null, scope: null, outcome: null, experience_id: null, project_id: null,
} as never;

function render(locale: "en" | "id", achievement: { origin: "manual" | "activity" | "import"; source_excerpt: string | null; source_activity_revision: number | null }, source: typeof activity | null) {
  return renderToStaticMarkup(<AchievementSourceCard locale={locale} achievement={achievement} activity={source} detailReturn="/achievements/x" />);
}

describe("T16 S08 achievement provenance", () => {
  it.each(["en", "id"] as const)("labels an imported achievement as imported from the CV with its excerpt (%s)", (locale) => {
    const html = render(locale, { origin: "import", source_excerpt: EXCERPT, source_activity_revision: null }, null);
    expect(html).toContain(t(locale, "achievement.importedFromCv"));
    expect(html).toContain(t(locale, "achievement.importedHelp"));
    expect(html).toContain(t(locale, "achievement.sourceExcerpt"));
    expect(html).toContain("Menurunkan waktu laporan");
    expect(html).not.toContain(t(locale, "achievement.sourceUnavailable"));
    expect(html).not.toContain("/activity/");
  });

  it("keeps the retained-excerpt notice for an activity achievement whose activity was deleted", () => {
    const html = render("en", { origin: "activity", source_excerpt: "Catatan lama", source_activity_revision: 2 }, null);
    expect(html).toContain(t("en", "achievement.sourceUnavailable"));
    expect(html).toContain(t("en", "achievement.source"));
    expect(html).not.toContain(t("en", "achievement.importedFromCv"));
  });

  it("keeps the activity view unchanged, including the changed-source warning", () => {
    const html = render("en", { origin: "activity", source_excerpt: "Catatan lama", source_activity_revision: 2 }, activity);
    expect(html).toContain("Catatan aktivitas asli");
    expect(html).toContain(t("en", "achievement.sourceChanged"));
    expect(html).toContain("/activity/8f14e45f-ea5e-4a0b-9c2b-000000000001");
    expect(html).not.toContain(t("en", "achievement.sourceUnavailable"));
  });

  it("renders nothing for a manual achievement without a source", () => {
    expect(render("en", { origin: "manual", source_excerpt: null, source_activity_revision: null }, null)).toBe("");
  });
});
