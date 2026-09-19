import Link from "next/link";

import { Card } from "@/components/ui/card";
import { ActivityFiltersForm } from "@/features/activity/activity-filters";
import { ActivityList } from "@/features/activity/activity-list";
import { ActivityPageIssue } from "@/features/activity/activity-page-issue";
import { listActivityContextOptions } from "@/features/activity/activity-context-service";
import { ActivityServiceError, createActivityService, type ActivityListPage } from "@/features/activity/activity-service";
import { activityFilterQuery, activityListHref, readActivityQuery } from "@/domain/routes/url-filters";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type ActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const query = readActivityQuery(await searchParams);
  const returnTo = activityListHref(query.filters, query.cursor);
  const filterFormKey = activityFilterQuery(query.filters);
  const { context, profile, locale } = await requireCompletedWorkspace(returnTo);
  const client = context.client;

  if (!client) {
    return (
      <section className="space-y-6">
        <ActivityHeader locale={locale} />
        <ActivityPageIssue locale={locale} retryHref={returnTo} signInReturnTo={returnTo} />
      </section>
    );
  }

  const contextPromise = listActivityContextOptions(client, profile.id).then(
    (options) => ({ status: "ok" as const, options }),
    (error: unknown) => ({ status: "error" as const, error }),
  );
  const activityPromise: Promise<
    | { status: "ok"; page: ActivityListPage | null }
    | { status: "error"; error: unknown }
  > = query.isValid
    ? createActivityService(client).listActivities({
        from: query.filters.from || undefined,
        to: query.filters.to || undefined,
        projectId: query.filters.project || undefined,
        cursor: query.cursor || undefined,
      }).then(
        (page) => ({ status: "ok" as const, page }),
        (error: unknown) => ({ status: "error" as const, error }),
      )
    : Promise.resolve({ status: "ok", page: null });

  const [contextResult, activityResult] = await Promise.all([contextPromise, activityPromise]);

  if (contextResult.status === "error") {
    return (
      <section className="space-y-6">
        <ActivityHeader locale={locale} />
        <ActivityPageIssue locale={locale} retryHref={returnTo} signInReturnTo={returnTo} />
      </section>
    );
  }

  const selectedProjectUnavailable = Boolean(
    query.filters.project && !contextResult.options.projects.some((project) => project.id === query.filters.project),
  );
  const filterErrors: Partial<Record<"from" | "to" | "project", "invalid" | "range">> = {
    from: query.errors.from,
    to: query.errors.to,
    project: query.errors.project ?? (selectedProjectUnavailable ? "invalid" : undefined),
  };

  if (activityResult.status === "error") {
    const error = activityResult.error;
    const serviceError = error instanceof ActivityServiceError ? error : null;
    return (
      <section className="space-y-6">
        <ActivityHeader locale={locale} />
        <Card>
          <ActivityFiltersForm key={filterFormKey} filters={query.filters} errors={filterErrors} options={contextResult.options} locale={locale} />
        </Card>
        <ActivityPageIssue
          locale={locale}
          messageKey={serviceError?.messageKey ?? "error.unavailable"}
          correlationId={serviceError?.correlationId}
          retryHref={returnTo}
          signInReturnTo={serviceError?.code === "UNAUTHENTICATED" ? returnTo : undefined}
        />
      </section>
    );
  }

  const page = selectedProjectUnavailable ? null : activityResult.page;

  return (
    <section className="space-y-6">
      <ActivityHeader locale={locale} />
      <Card>
        <ActivityFiltersForm key={filterFormKey} filters={query.filters} errors={filterErrors} options={contextResult.options} locale={locale} />
      </Card>
      {query.errors.cursor ? (
        <p className="ui-message ui-message--danger" role="alert">
          {t(locale, "activity.invalidCursor")} {" "}
          <Link className="font-semibold underline underline-offset-4" href={activityListHref(query.filters)}>
            {t(locale, "activity.clearFilters")}
          </Link>
        </p>
      ) : null}
      {!query.isValid ? (
        <p className="ui-message ui-message--warning" role="alert">{t(locale, "activity.invalidFilters")}</p>
      ) : (
        <ActivityList
          items={page?.items ?? []}
          nextCursor={page?.nextCursor ?? null}
          options={contextResult.options}
          filters={query.filters}
          returnTo={returnTo}
          hasCursor={Boolean(query.cursor || query.errors.cursor)}
          locale={locale}
        />
      )}
    </section>
  );
}

function ActivityHeader({ locale }: { locale: Awaited<ReturnType<typeof requireCompletedWorkspace>>["locale"] }) {
  return (
    <header className="workspace-page-header">
      <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "workspace.activity")}</h1>
      <p>{t(locale, "activity.description")}</p>
    </header>
  );
}
