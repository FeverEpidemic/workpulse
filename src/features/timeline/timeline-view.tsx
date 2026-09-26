import Link from "next/link";

import { formatActivityDate } from "@/domain/activity/activity-display";
import { formatProjectDateRange } from "@/domain/project/project-display";
import { timelineListHref, type TimelineQuery } from "@/domain/routes/timeline-filters";
import type { TimelineEvent, TimelineEventType, TimelineGroup } from "@/domain/timeline/timeline";
import { t, type Locale, type MessageKey } from "@/i18n/messages";
import { TimelineFilterForm } from "@/features/timeline/timeline-filter-form";

const TYPE_KEYS: Record<TimelineEventType, MessageKey> = {
  experience: "timeline.type.experience",
  education: "timeline.type.education",
  project: "timeline.type.project",
  achievement: "timeline.type.achievement",
};

function eventDateLabel(event: TimelineEvent, locale: Locale): string {
  const notSet = t(locale, "timeline.dateNotSet");
  const present = t(locale, "timeline.present");
  if (event.type === "achievement" && event.anchor) return formatActivityDate(event.anchor.date, locale);

  const range = formatProjectDateRange({
    start_date: event.start?.date ?? null,
    start_precision: event.start?.precision ?? null,
    end_date: event.type === "project" ? null : event.end?.date ?? null,
    end_precision: event.type === "project" ? null : event.end?.precision ?? null,
    is_current: event.type === "project" ? false : event.isCurrent,
  }, locale, notSet, present);

  return event.type === "project" ? t(locale, "timeline.started", { date: range }) : range;
}

function TimelineEventRow({ event, locale }: { event: TimelineEvent; locale: Locale }) {
  const context = event.context ?? (event.type === "project" || event.type === "achievement" ? t(locale, "timeline.independent") : null);
  return (
    <li className="timeline-event" key={`${event.type}-${event.id}`}>
      <div className="timeline-event-heading">
        <span className="timeline-event-type">{t(locale, TYPE_KEYS[event.type])}</span>
        <Link className="timeline-event-title" href={event.href}>{event.title}</Link>
      </div>
      {context ? <p className="timeline-event-context">{context}</p> : null}
      <p className="timeline-event-date">{eventDateLabel(event, locale)}</p>
    </li>
  );
}

function TimelineGroups({ groups, locale }: { groups: TimelineGroup[]; locale: Locale }) {
  return (
    <ol className="timeline-groups">
      {groups.map((group) => {
        const title = group.year === null ? t(locale, "timeline.dateNotSet") : String(group.year);
        const headingId = `timeline-year-${group.key}`;
        return (
          <li key={group.key}>
            <section className="timeline-year-group" aria-labelledby={headingId}>
              <h2 id={headingId} className="timeline-year">{title}</h2>
              <ol className="timeline-events" aria-label={title}>
                {group.events.map((event) => <TimelineEventRow key={`${event.type}-${event.id}`} event={event} locale={locale} />)}
              </ol>
            </section>
          </li>
        );
      })}
    </ol>
  );
}

export function TimelineView({
  groups,
  projectOptions,
  truncated,
  query,
  locale,
}: {
  groups: TimelineGroup[];
  projectOptions: { id: string; title: string }[];
  truncated: boolean;
  query: TimelineQuery;
  locale: Locale;
}) {
  const { filters } = query;
  const hasFilter = Boolean(filters.type || filters.project);
  const hasQueryIssues = !query.isValid;

  return (
    <div className="timeline-page">
      <header className="timeline-header">
        <h1 id="timeline-title">{t(locale, "timeline.title")}</h1>
        <p>{t(locale, "timeline.description")}</p>
      </header>

      <section className="timeline-filter-panel" aria-label={t(locale, "timeline.description")}>
        <TimelineFilterForm key={`${filters.type}:${filters.project}`} filters={filters} projectOptions={projectOptions} clearVisible={hasFilter || hasQueryIssues} locale={locale} />
        {hasQueryIssues ? <p className="timeline-notice" role="status">{t(locale, "timeline.invalidFilters")}</p> : null}
      </section>

      {truncated ? <p className="timeline-notice" role="status">{t(locale, "timeline.truncated")}</p> : null}

      {groups.length ? <TimelineGroups groups={groups} locale={locale} /> : (
        <section className="timeline-empty" aria-live="polite">
          <p>{hasFilter || hasQueryIssues ? t(locale, "timeline.emptyFiltered") : t(locale, "timeline.empty")}</p>
          {hasFilter || hasQueryIssues ? (
            <Link className="button-secondary" href={timelineListHref({ type: "", project: "" })}>{t(locale, "timeline.clear")}</Link>
          ) : (
            <div className="timeline-empty-actions">
              <Link className="button-secondary" href="/settings/profile">{t(locale, "dashboard.addCareerHistory")}</Link>
              <Link className="button-secondary" href="/activity/new">{t(locale, "dashboard.addFirstActivity")}</Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
