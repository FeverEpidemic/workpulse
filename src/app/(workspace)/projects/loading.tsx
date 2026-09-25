import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/i18n/messages";

export default function ProjectsLoading() {
  return (
    <section className="space-y-4" aria-label={t("en", "project.description")}>
      <Skeleton className="h-10 w-48" />
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 w-full" />)}
      </div>
    </section>
  );
}
