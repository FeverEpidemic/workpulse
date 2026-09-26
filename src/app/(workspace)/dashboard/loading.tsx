import { Skeleton } from "@/components/ui/skeleton";
import { getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function DashboardLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="dashboard-page dashboard-loading" aria-busy="true" aria-label={t(locale, "workspace.loading")}>
      <header className="dashboard-header">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </header>
      <div className="dashboard-stats" aria-hidden="true">
        {[0, 1, 2].map((item) => <div className="dashboard-stat-card" key={item}><Skeleton className="h-4 w-36 max-w-full" /><Skeleton className="mt-3 h-8 w-16" /></div>)}
      </div>
      <div className="dashboard-loading-columns" aria-hidden="true">
        {[0, 1].map((list) => (
          <div className="dashboard-section" key={list}>
            <Skeleton className="mb-4 h-6 w-40" />
            {[0, 1, 2, 3, 4].map((row) => <Skeleton className="mb-3 h-12 w-full" key={row} />)}
          </div>
        ))}
      </div>
    </section>
  );
}
