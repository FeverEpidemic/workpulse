import { Skeleton } from "@/components/ui/skeleton";
import { SlowLoadingNotice } from "@/components/ui/slow-loading-notice";
import { getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function ProjectsLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="space-y-4" aria-busy="true" aria-label={t(locale, "project.description")}>
      <SlowLoadingNotice locale={locale} />
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}
      </div>
    </section>
  );
}
