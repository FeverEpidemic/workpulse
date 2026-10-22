import { Skeleton } from "@/components/ui/skeleton";
import { SlowLoadingNotice } from "@/components/ui/slow-loading-notice";
import { getRequestLocale } from "@/server/auth/context";

export default async function CvPreviewLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="space-y-5" aria-busy="true" data-testid="cv-export-loading">
      <SlowLoadingNotice locale={locale} />
      <Skeleton className="app-card h-20" />
      <div className="cv-export-layout">
        <div className="space-y-4">
          <div className="app-card space-y-3">
            <Skeleton className="block h-6 w-48" />
            <Skeleton className="block h-4 w-72" />
            <Skeleton className="block h-11 w-40" />
          </div>
          <Skeleton className="app-card h-40" />
        </div>
        <Skeleton className="app-card h-96" />
      </div>
    </section>
  );
}
