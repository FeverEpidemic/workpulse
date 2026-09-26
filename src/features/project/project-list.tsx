import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatProjectDateRange, projectExperienceLabel, projectNeedsOutcome } from "@/domain/project/project-display";
import { projectListHref, type ProjectFilters } from "@/domain/routes/project-filters";
import type { ProjectListItem } from "@/domain/project/contracts";
import { t, type Locale } from "@/i18n/messages";

export function ProjectList({
  items,
  filters,
  returnTo,
  nextCursor,
  hasCursor,
  locale,
}: {
  items: ProjectListItem[];
  filters: ProjectFilters;
  returnTo: string;
  nextCursor: string | null;
  hasCursor: boolean;
  locale: Locale;
}) {
  const hasFilters = Boolean(filters.status || filters.outcome || hasCursor);
  const filterNotice = filters.outcome ? (
    <p className="field-help" role="status">
      {t(locale, "project.filterOutcomeMissing")} {" "}
      <Link className="font-semibold underline underline-offset-4" href={projectListHref({ ...filters, outcome: "" })}>
        {t(locale, "project.clearFilters")}
      </Link>
    </p>
  ) : null;
  if (items.length === 0) {
    return hasFilters ? (
      <>{filterNotice}<EmptyState
        title={t(locale, "project.noMatchTitle")}
        description={t(locale, "project.noMatchDescription")}
        action={{ href: projectListHref({ ...filters, outcome: "" }), label: t(locale, "project.clearFilters") }}
      /></>
    ) : (
      <EmptyState
        title={t(locale, "project.emptyTitle")}
        description={t(locale, "project.emptyDescription")}
        action={{ href: `/projects/new?${new URLSearchParams({ returnTo }).toString()}`, label: t(locale, "project.new") }}
      />
    );
  }

  return (
    <section className="space-y-4" aria-labelledby="project-results-title">
      {filterNotice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="project-results-title" className="sr-only">{t(locale, "project.description")}</h2>
        <p className="field-help" role="status">{t(locale, "project.pageCount", { count: items.length })}</p>
        <Link className="button-primary" href={`/projects/new?${new URLSearchParams({ returnTo }).toString()}`}>
          {t(locale, "project.new")}
        </Link>
      </div>
      <ul className="project-list" aria-label={t(locale, "project.description")}>
        {items.map(({ project, experience, linkedActivityCount }) => {
          const detailReturn = `/projects/${project.id}?${new URLSearchParams({ returnTo }).toString()}`;
          return (
            <li key={project.id}>
              <Link className="project-list-row" href={detailReturn}>
                <span className="project-list-main">
                  <span className="project-list-title">{project.title}</span>
                  <span className="project-list-meta">
                    <Badge variant={project.status === "completed" ? "success" : project.status === "active" ? "warning" : undefined}>
                      {t(locale, `project.${project.status}`)}
                    </Badge>
                    <span>{formatProjectDateRange(project, locale, t(locale, "project.dateNotSet"), t(locale, "project.present"))}</span>
                  </span>
                </span>
                <span className="project-list-context">
                  {project.user_role ? <span>{project.user_role}</span> : null}
                  <span>{projectExperienceLabel(experience, t(locale, "project.independent"))}</span>
                  <span>{t(locale, "project.linkedCount", { count: linkedActivityCount })}</span>
                  {projectNeedsOutcome(project) ? <span className="project-needs-outcome">{t(locale, "project.needsOutcome")}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {nextCursor ? (
        <nav className="project-pagination" aria-label={t(locale, "project.nextPage")}>
          <Link className="button-secondary" href={projectListHref(filters, nextCursor)} rel="next">
            {t(locale, "project.nextPage")}
          </Link>
        </nav>
      ) : null}
    </section>
  );
}
