import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { activityExcerpt, formatActivityDate, resolveActivityContext } from "@/domain/activity/activity-display";
import type { ActivityListItem } from "@/domain/activity/contracts";
import type { ActivityFilters } from "@/domain/routes/url-filters";
import { activityListHref } from "@/domain/routes/url-filters";
import { t, type Locale } from "@/i18n/messages";

function activityReturnQuery(returnTo: string): string {
  return new URLSearchParams({ returnTo }).toString();
}

export function ActivityList({
  items,
  options,
  filters,
  returnTo,
  nextCursor,
  hasCursor,
  locale,
}: {
  items: ActivityListItem[];
  options: ActivityContextOptions;
  filters: ActivityFilters;
  returnTo: string;
  nextCursor: string | null;
  hasCursor: boolean;
  locale: Locale;
}) {
  const hasFilters = Boolean(filters.from || filters.to || filters.project || hasCursor);

  if (items.length === 0) {
    return hasFilters ? (
      <EmptyState
        title={t(locale, "activity.noMatchTitle")}
        description={t(locale, "activity.noMatchDescription")}
        action={{ href: "/activity", label: t(locale, "activity.clearFilters") }}
      />
    ) : (
      <EmptyState
        title={t(locale, "activity.emptyTitle")}
        description={t(locale, "activity.emptyDescription")}
        action={{
          href: `/activity/new?${activityReturnQuery(returnTo)}`,
          label: t(locale, "activity.addActivity"),
        }}
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="activity-results-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="activity-results-title" className="sr-only">{t(locale, "activity.description")}</h2>
        <p className="field-help" role="status">{t(locale, "activity.pageCount", { count: items.length })}</p>
        <Link className="button-primary" href={`/activity/new?${activityReturnQuery(returnTo)}`}>
          {t(locale, "activity.addActivity")}
        </Link>
      </div>
      <ul className="activity-list" aria-label={t(locale, "activity.description")}>
        {items.map((activity) => {
          const excerpt = activityExcerpt(activity.raw_text);
          const context = resolveActivityContext(activity, options);
          const detailHref = `/activity/${activity.id}?${activityReturnQuery(returnTo)}`;
          return (
            <li key={activity.id}>
              <Link className="activity-list-row" href={detailHref}>
                <span className="activity-list-meta">
                  <time dateTime={activity.occurred_on}>{formatActivityDate(activity.occurred_on, locale)}</time>
                  <Badge>{t(locale, `activity.${activity.capture_mode === "note" ? "noteMode" : activity.capture_mode === "form" ? "formMode" : "chatMode"}`)}</Badge>
                  <Badge variant="success">{t(locale, "activity.savedBadge")}</Badge>
                </span>
                <span className="activity-list-excerpt">{excerpt}</span>
                {(context.projectLabel || context.experienceLabel || context.projectUnavailable || context.experienceUnavailable) ? (
                  <span className="activity-list-context">
                    {context.projectLabel ? <span>{t(locale, "activity.project")}: {context.projectLabel}</span> : null}
                    {context.experienceLabel ? <span>{t(locale, "activity.experience")}: {context.experienceLabel}</span> : null}
                    {context.projectUnavailable || context.experienceUnavailable ? (
                      <span>{t(locale, "activity.contextUnavailable")}</span>
                    ) : null}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {nextCursor ? (
        <nav className="activity-pagination" aria-label={t(locale, "activity.nextPage")}>
          <Link className="button-secondary" href={activityListHref(filters, nextCursor)} rel="next">
            {t(locale, "activity.nextPage")}
          </Link>
        </nav>
      ) : null}
    </section>
  );
}
