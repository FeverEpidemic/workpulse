import { EmptyState } from "@/components/ui/empty-state";
import { ActivityFiltersForm } from "@/features/activity/activity-filters";
import { Card } from "@/components/ui/card";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { readActivityFilters } from "@/domain/routes/url-filters";
import { t } from "@/i18n/messages";

type ActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const { locale } = await requireCompletedWorkspace("/activity");
  const filters = readActivityFilters(await searchParams);

  return (
    <section className="space-y-6">
      <header className="workspace-page-header">
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "workspace.activity")}</h1>
        <p>{t(locale, "activity.description")}</p>
      </header>
      <Card>
        <ActivityFiltersForm filters={filters} locale={locale} />
      </Card>
      <EmptyState
        title={t(locale, "activity.unavailableTitle")}
        description={t(locale, "activity.unavailableDescription")}
        action={{ href: "/activity/new", label: t(locale, "workspace.quickLog") }}
      />
    </section>
  );
}
