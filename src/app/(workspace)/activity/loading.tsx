import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n/messages";
import { getRequestLocale } from "@/server/auth/context";

export default async function ActivityLoading() {
  const locale = await getRequestLocale();
  return (
    <section className="space-y-6" aria-busy="true" aria-live="polite">
      <h1 className="sr-only">{t(locale, "activity.loading")}</h1>
      <div className="workspace-page-header">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-3 h-4 w-full max-w-md" />
      </div>
      <div className="app-card grid grid-cols-1 gap-3 md:grid-cols-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
      <div className="grid gap-3" role="status">
        <span className="sr-only">{t(locale, "activity.loading")}</span>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </section>
  );
}
