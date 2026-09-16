import { Skeleton } from "@/components/ui/skeleton";
import { getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function WorkspaceLoading() {
  const locale = await getRequestLocale();
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <span className="sr-only">{t(locale, "workspace.loading")}</span>
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-5 w-80 max-w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
