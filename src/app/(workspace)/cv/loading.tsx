import { Skeleton } from "@/components/ui/skeleton";
import { SlowLoadingNotice } from "@/components/ui/slow-loading-notice";
import { getRequestLocale } from "@/server/auth/context";

export default async function CvLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="space-y-5" aria-busy="true">
      <SlowLoadingNotice locale={locale} />
      <Skeleton className="app-card h-20" />
      <div className="cv-layout">
        <div className="space-y-4">
          <Skeleton className="app-card h-40" />
          <Skeleton className="app-card h-64" />
        </div>
        <Skeleton className="app-card h-96" />
      </div>
    </section>
  );
}
