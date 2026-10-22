import { Skeleton } from "@/components/ui/skeleton";
import { SlowLoadingNotice } from "@/components/ui/slow-loading-notice";
import { getRequestLocale } from "@/server/auth/context";

export default async function AchievementsLoading() {
  const locale = await getRequestLocale();
  return <section className="space-y-4" aria-busy="true"><SlowLoadingNotice locale={locale} /><Skeleton className="app-card h-24" /><Skeleton className="app-card h-56" /></section>;
}
