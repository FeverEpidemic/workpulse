import Link from "next/link";

import { achievementListHref, readAchievementQuery } from "@/domain/routes/achievement-filters";
import type { AchievementListPage } from "@/domain/achievement/contracts";
import { AchievementList } from "@/features/achievement/achievement-list";
import { AchievementPageIssue } from "@/features/achievement/achievement-page-issue";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t, type Locale } from "@/i18n/messages";

type AchievementsPageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AchievementsPage({ searchParams }: AchievementsPageProps) {
  const query = readAchievementQuery(await searchParams);
  const returnTo = achievementListHref(query.filters, query.errors.cursor ? undefined : query.cursor || undefined);
  const { context, locale } = await requireCompletedWorkspace(returnTo);
  return (
    <section className="space-y-6">
      <header className="workspace-page-header flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">{t(locale, "workspace.achievements")}</h1><p>{t(locale, "achievement.description")}</p></div>
        <Link className="button-primary" href={`/achievements/new?${new URLSearchParams({ returnTo }).toString()}`}>{t(locale, "achievement.add")}</Link>
      </header>
      {!query.isValid ? (
        <p className="ui-message ui-message--warning" role="alert">{query.errors.cursor ? t(locale, "achievement.invalidCursor") : t(locale, "achievement.invalidFilters")} <Link className="font-semibold underline underline-offset-4" href="/achievements">{t(locale, "achievement.clearFilters")}</Link></p>
      ) : !context.client ? <AchievementPageIssue locale={locale} retryHref={returnTo} signInReturnTo={returnTo} /> : <AchievementResults locale={locale} client={context.client} query={query} returnTo={returnTo} />}
    </section>
  );
}

function StatusNav({ locale, active, project }: { locale: Locale; active: string; project: string }) {
  const tabs = [{ value: "", label: t(locale, "achievement.all") }, { value: "draft", label: t(locale, "achievement.draft") }, { value: "confirmed", label: t(locale, "achievement.confirmed") }, { value: "dismissed", label: t(locale, "achievement.dismissed") }];
  return <nav className="project-filter-tabs" aria-label={t(locale, "achievement.filters")}>{tabs.map((tab) => { const href = achievementListHref({ status: tab.value as "" | "draft" | "confirmed" | "dismissed", project }, null); return <Link key={tab.value || "all"} className={active === tab.value ? "is-selected" : ""} href={href} aria-current={active === tab.value ? "page" : undefined}>{tab.label}</Link>; })}</nav>;
}

async function AchievementResults({ locale, client, query, returnTo }: { locale: Locale; client: NonNullable<Awaited<ReturnType<typeof requireCompletedWorkspace>>["context"]["client"]>; query: ReturnType<typeof readAchievementQuery>; returnTo: string }) {
  let result: { page?: AchievementListPage; projects?: { id: string; title: string }[]; error?: unknown };
  try {
    const service = createAchievementService(client);
    const [page, options] = await Promise.all([service.listAchievements({ status: query.filters.status || undefined, projectId: query.filters.project || undefined, cursor: query.cursor || undefined }), service.listContextOptions()]);
    result = { page, projects: options.projects };
  } catch (error) {
    result = { error };
  }
  if (result.error) {
    const error = result.error instanceof AchievementServiceError ? result.error : null;
    return <AchievementPageIssue locale={locale} messageKey={error?.messageKey} correlationId={error?.correlationId} retryHref={returnTo} signInReturnTo={error?.code === "UNAUTHENTICATED" ? returnTo : undefined} />;
  }
  return <><StatusNav locale={locale} active={query.filters.status} project={query.filters.project} /><form method="get" action="/achievements" className="workspace-filter-form"><label className="field-label" htmlFor="achievement-filter-project">{t(locale, "achievement.project")}<select id="achievement-filter-project" name="project" defaultValue={query.filters.project} className="field-input"><option value="">{t(locale, "achievement.projectPlaceholder")}</option>{(result.projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><input type="hidden" name="status" value={query.filters.status} /><button className="button-secondary" type="submit">{t(locale, "activity.applyFilters")}</button></form><AchievementList items={result.page?.items ?? []} filters={query.filters} returnTo={returnTo} nextCursor={result.page?.nextCursor ?? null} hasCursor={Boolean(query.cursor)} locale={locale} /></>;
}
