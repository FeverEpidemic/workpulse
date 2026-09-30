import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n/messages";
import { getRequestLocale } from "@/server/auth/context";

export default async function ImportReviewLoading() {
  const locale = await getRequestLocale();
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-5 py-8" role="status" aria-live="polite">
      <span className="sr-only">{t(locale, "workspace.loading")}</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-5 w-96 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </main>
  );
}
