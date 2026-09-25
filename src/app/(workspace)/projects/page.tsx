import Link from "next/link";

import { projectListHref, readProjectQuery } from "@/domain/routes/project-filters";
import { ProjectList } from "@/features/project/project-list";
import { ProjectPageIssue } from "@/features/project/project-page-issue";
import { ProjectServiceError, createProjectService, type ProjectListPage } from "@/features/project/project-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t, type Locale } from "@/i18n/messages";

type ProjectsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectsPage({ searchParams }: ProjectsPageProps) {
  const query = readProjectQuery(await searchParams);
  const returnTo = projectListHref(query.filters, query.errors.cursor ? undefined : query.cursor || undefined);
  const { context, locale } = await requireCompletedWorkspace(returnTo);

  return (
    <section className="space-y-6">
      <ProjectsHeader locale={locale} returnTo={returnTo} />
      <ProjectFilterNav locale={locale} activeStatus={query.filters.status} returnTo={returnTo} />
      {!query.isValid ? (
        <p className="ui-message ui-message--warning" role="alert">
          {query.errors.cursor ? t(locale, "project.invalidCursor") : t(locale, "project.invalidFilters")} {" "}
          <Link className="font-semibold underline underline-offset-4" href="/projects">{t(locale, "project.clearFilters")}</Link>
        </p>
      ) : !context.client ? (
        <ProjectPageIssue locale={locale} retryHref={returnTo} signInReturnTo={returnTo} />
      ) : (
        <ProjectResults locale={locale} client={context.client} query={query} returnTo={returnTo} />
      )}
    </section>
  );
}

function ProjectsHeader({ locale, returnTo }: { locale: Locale; returnTo: string }) {
  return (
    <header className="workspace-page-header flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "workspace.projects")}</h1>
        <p>{t(locale, "project.description")}</p>
      </div>
      <Link className="button-primary" href={`/projects/new?${new URLSearchParams({ returnTo }).toString()}`}>{t(locale, "project.new")}</Link>
    </header>
  );
}

function ProjectFilterNav({ locale, activeStatus, returnTo: _returnTo }: { locale: Locale; activeStatus: string; returnTo: string }) {
  const tabs = [
    { value: "", label: t(locale, "project.all") },
    { value: "planned", label: t(locale, "project.planned") },
    { value: "active", label: t(locale, "project.active") },
    { value: "completed", label: t(locale, "project.completed") },
  ];
  return (
    <nav className="project-filter-tabs" aria-label={t(locale, "project.filters")}>
      {tabs.map((tab) => {
        const href = tab.value ? `/projects?status=${tab.value}` : "/projects";
        return <Link key={tab.value || "all"} className={activeStatus === tab.value ? "is-selected" : ""} href={href} aria-current={activeStatus === tab.value ? "page" : undefined}>{tab.label}</Link>;
      })}
    </nav>
  );
}

async function ProjectResults({ locale, client, query, returnTo }: {
  locale: Locale;
  client: NonNullable<Awaited<ReturnType<typeof requireCompletedWorkspace>>["context"]["client"]>;
  query: ReturnType<typeof readProjectQuery>;
  returnTo: string;
}) {
  let result: { page?: ProjectListPage; error?: unknown };
  try {
    const page = await createProjectService(client).listProjects({
      status: query.filters.status || undefined,
      cursor: query.cursor || undefined,
    });
    result = { page };
  } catch (error) {
    result = { error };
  }
  if (result.error) {
    const error = result.error instanceof ProjectServiceError ? result.error : null;
    return <ProjectPageIssue locale={locale} messageKey={error?.messageKey} correlationId={error?.correlationId} retryHref={returnTo} signInReturnTo={error?.code === "UNAUTHENTICATED" ? returnTo : undefined} />;
  }
  return <ProjectList items={result.page?.items ?? []} filters={query.filters} returnTo={returnTo} nextCursor={result.page?.nextCursor ?? null} hasCursor={Boolean(query.cursor)} locale={locale} />;
}
