import { Skeleton } from "@/components/ui/skeleton";
import { getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function TimelineLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="timeline-page timeline-loading" aria-busy="true" aria-label={t(locale, "workspace.loading")}>
      <header className="timeline-header">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </header>
      <div className="timeline-filter-panel" aria-hidden="true">
        <div className="timeline-filter-form">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-32" />
        </div>
      </div>
      <ol className="timeline-groups" aria-hidden="true">
        {[0, 1, 2].map((group) => (
          <li key={group}>
            <div className="timeline-year-group">
              <Skeleton className="mb-4 h-7 w-20" />
              {[0, 1].map((event) => <Skeleton className="mb-3 h-24 w-full" key={event} />)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
