import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatActivityDate } from "@/domain/activity/activity-display";
import { achievementListHref, type AchievementFilters } from "@/domain/routes/achievement-filters";
import type { AchievementListItem } from "@/domain/achievement/contracts";
import { t, type Locale } from "@/i18n/messages";

export function AchievementList({
  items,
  filters,
  returnTo,
  nextCursor,
  hasCursor,
  locale,
}: {
  items: AchievementListItem[];
  filters: AchievementFilters;
  returnTo: string;
  nextCursor: string | null;
  hasCursor: boolean;
  locale: Locale;
}) {
  const hasFilters = Boolean(filters.status || filters.project || filters.evidence || filters.skill || hasCursor);
  if (items.length === 0) {
    return hasFilters ? (
      <EmptyState title={t(locale, "achievement.noMatchTitle")} description={t(locale, "achievement.noMatchDescription")} action={{ href: "/achievements", label: t(locale, "achievement.clearFilters") }} />
    ) : (
      <EmptyState title={t(locale, "achievement.emptyTitle")} description={t(locale, "achievement.emptyDescription")} action={{ href: `/achievements/new?${new URLSearchParams({ returnTo }).toString()}`, label: t(locale, "achievement.add") }} />
    );
  }
  return (
    <section className="space-y-4" aria-labelledby="achievement-results-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="achievement-results-title" className="sr-only">{t(locale, "achievement.description")}</h2>
        <p className="field-help" role="status">{t(locale, "achievement.pageCount", { count: items.length })}</p>
        <Link className="button-primary" href={`/achievements/new?${new URLSearchParams({ returnTo }).toString()}`}>{t(locale, "achievement.add")}</Link>
      </div>
      <ul className="achievement-list" aria-label={t(locale, "achievement.description")}>
        {items.map(({ achievement, projectTitle, experienceLabel, skills }) => {
          const detailHref = `/achievements/${achievement.id}?${new URLSearchParams({ returnTo }).toString()}`;
          return (
            <li key={achievement.id}>
              <Link className="achievement-list-row" href={detailHref}>
                <span className="achievement-list-main">
                  <span className="achievement-list-title">{achievement.title ?? t(locale, "achievement.untitledDraft")}</span>
                  <span className="achievement-list-meta">
                    <Badge>{t(locale, `achievement.${achievement.status}`)}</Badge>
                    <span>{achievement.achieved_on ? formatActivityDate(achievement.achieved_on, locale) : t(locale, "achievement.dateNotSet")}</span>
                  </span>
                </span>
                <span className="achievement-list-context">
                  {achievement.outcome ? <span>{achievement.outcome}</span> : null}
                  <span>{projectTitle ?? t(locale, "achievement.noProject")}</span>
                  <span>{experienceLabel ?? t(locale, "achievement.noExperience")}</span>
                  {skills.length ? <span>{skills.map((skill) => skill.name).join(", ")}</span> : null}
                  {achievement.status === "confirmed" ? <span>{t(locale, "achievement.cvEligible")}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {nextCursor ? <nav className="achievement-pagination" aria-label={t(locale, "achievement.nextPage")}><Link className="button-secondary" href={achievementListHref(filters, nextCursor)} rel="next">{t(locale, "achievement.nextPage")}</Link></nav> : null}
    </section>
  );
}
