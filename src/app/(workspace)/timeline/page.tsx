import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { DashboardIssue } from "@/features/dashboard/dashboard-issue";
import { createTimelineService, TimelineServiceError } from "@/features/timeline/timeline-service";
import { TimelineView } from "@/features/timeline/timeline-view";
import { readTimelineQuery, timelineListHref } from "@/domain/routes/timeline-filters";
import { t } from "@/i18n/messages";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function TimelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ context, locale }, params] = await Promise.all([requireCompletedWorkspace("/timeline"), searchParams]);
  const query = readTimelineQuery(params);
  let timeline: Awaited<ReturnType<ReturnType<typeof createTimelineService>["getTimeline"]>> | null = null;
  let issue: TimelineServiceError | null = null;
  try {
    timeline = await createTimelineService(context.client!).getTimeline(query.filters);
  } catch (error) {
    issue = error instanceof TimelineServiceError ? error : new TimelineServiceError("UNAVAILABLE");
  }

  if (timeline) {
    return <TimelineView groups={timeline.groups} projectOptions={timeline.projectOptions} truncated={timeline.truncated} query={query} locale={locale} />;
  }

  return (
    <section className="timeline-page" aria-labelledby="timeline-title">
      <header className="timeline-header">
        <h1 id="timeline-title">{t(locale, "timeline.title")}</h1>
        <p>{t(locale, "timeline.description")}</p>
      </header>
      <DashboardIssue
        locale={locale}
        titleKey="timeline.unavailableTitle"
        messageKey={issue?.messageKey ?? "error.unavailable"}
        correlationId={issue?.correlationId}
        retryHref={timelineListHref(query.filters)}
        signInReturnTo={issue?.code === "UNAUTHENTICATED" ? "/timeline" : undefined}
      />
    </section>
  );
}
