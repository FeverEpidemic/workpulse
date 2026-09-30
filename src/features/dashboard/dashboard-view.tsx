import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { activityExcerpt, formatActivityDate } from "@/domain/activity/activity-display";
import { dashboardLinks } from "@/domain/dashboard/links";
import type { DashboardData } from "@/domain/dashboard/contracts";
import type { Locale } from "@/i18n/messages";
import { t } from "@/i18n/messages";

function formatCount(count: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US").format(count);
}

export function DashboardHeader({ locale, displayName }: { locale: Locale; displayName: string }) {
  return (
    <header className="dashboard-header">
      <p className="dashboard-kicker">{displayName}</p>
      <h1 id="dashboard-title">{t(locale, "dashboard.title")}</h1>
      <p>{t(locale, "dashboard.description")}</p>
    </header>
  );
}

function CheckLink({ href, label, count, locale }: { href: string; label: string; count: number; locale: Locale }) {
  const key = count === 1 ? `${label}One` : `${label}Other`;
  return <li><Link href={href}>{t(locale, key as "dashboard.checkMissingEvidenceOne" | "dashboard.checkMissingEvidenceOther" | "dashboard.checkMissingOutcomeOne" | "dashboard.checkMissingOutcomeOther", { count: formatCount(count, locale) })}</Link></li>;
}

export function DashboardView({ data, displayName, locale }: { data: DashboardData; displayName: string; locale: Locale }) {
  if (!data.summary.hasCareerRecords) {
    return (
      <div className="dashboard-page">
        <DashboardHeader locale={locale} displayName={displayName} />
        <EmptyState
          title={t(locale, "dashboard.emptyTitle")}
          description={t(locale, "dashboard.emptyDescription")}
          action={{ href: dashboardLinks.newActivity(), label: t(locale, "dashboard.addFirstActivity") }}
        />
        <div className="dashboard-empty-actions">
          <Link className="button-secondary" href="/onboarding/import">{t(locale, "dashboard.importCv")}</Link>
          <Link className="button-secondary" href={dashboardLinks.profile()}>{t(locale, "dashboard.addCareerHistory")}</Link>
        </div>
      </div>
    );
  }

  const { summary } = data;
  const stats = [
    { label: t(locale, "dashboard.confirmedAchievements"), count: summary.confirmedAchievementCount, href: dashboardLinks.confirmedAchievements() },
    { label: t(locale, "dashboard.currentProjects"), count: summary.activeProjectCount, href: dashboardLinks.activeProjects() },
    { label: t(locale, "dashboard.demonstratedSkills"), count: summary.demonstratedSkillCount, href: null },
  ];

  return (
    <div className="dashboard-page">
      <DashboardHeader locale={locale} displayName={displayName} />

      <section className="dashboard-stats" aria-label={t(locale, "dashboard.title")}>
        {stats.map((stat) => {
          const content = <><span className="dashboard-stat-label">{stat.label}</span><strong className="dashboard-stat-value">{formatCount(stat.count, locale)}</strong></>;
          return stat.href ? (
            <Link className="dashboard-stat-card" href={stat.href} key={stat.label}>{content}</Link>
          ) : (
            <div className="dashboard-stat-card" key={stat.label}>{content}</div>
          );
        })}
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-attention-title">
        <h2 id="dashboard-attention-title">{t(locale, "dashboard.needsAttention")}</h2>
        {summary.missingEvidenceCount > 0 || summary.completedMissingOutcomeCount > 0 ? (
          <ul className="dashboard-check-list">
            {summary.missingEvidenceCount > 0 ? (
              <CheckLink href={dashboardLinks.missingEvidence()} label="dashboard.checkMissingEvidence" count={summary.missingEvidenceCount} locale={locale} />
            ) : null}
            {summary.completedMissingOutcomeCount > 0 ? (
              <CheckLink href={dashboardLinks.missingOutcome()} label="dashboard.checkMissingOutcome" count={summary.completedMissingOutcomeCount} locale={locale} />
            ) : null}
          </ul>
        ) : <p className="dashboard-status" role="status">{t(locale, "dashboard.noChecks")}</p>}
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-recent-title">
        <div className="dashboard-section-heading">
          <h2 id="dashboard-recent-title">{t(locale, "dashboard.recentActivity")}</h2>
          <Link href={dashboardLinks.allActivity()}>{t(locale, "dashboard.viewAllActivity")}</Link>
        </div>
        {data.recentActivities.length ? (
          <ol className="dashboard-rows" aria-labelledby="dashboard-recent-title">
            {data.recentActivities.map((activity) => (
              <li key={activity.id}>
                <Link className="dashboard-row" href={dashboardLinks.activity(activity.id)}>
                  <time dateTime={activity.occurred_on}>{formatActivityDate(activity.occurred_on, locale)}</time>
                  <span>{activityExcerpt(activity.raw_text, 140)}</span>
                </Link>
              </li>
            ))}
          </ol>
        ) : <p className="dashboard-status" role="status">{t(locale, "dashboard.noActivity")}</p>}
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-projects-title">
        <div className="dashboard-section-heading">
          <h2 id="dashboard-projects-title">{t(locale, "dashboard.currentProjects")}</h2>
          {data.activeProjects.length ? <Link href={dashboardLinks.activeProjects()}>{t(locale, "dashboard.viewAllCurrentProjects")}</Link> : null}
        </div>
        {data.activeProjects.length ? (
          <ul className="dashboard-rows" aria-labelledby="dashboard-projects-title">
            {data.activeProjects.map((project) => (
              <li key={project.id}><Link className="dashboard-row" href={dashboardLinks.project(project.id)}><span>{project.title}</span></Link></li>
            ))}
          </ul>
        ) : <p className="dashboard-status" role="status">{t(locale, "dashboard.noCurrentProjects")}</p>}
      </section>

      <section className="dashboard-section" aria-labelledby="dashboard-skills-title">
        <h2 id="dashboard-skills-title">{t(locale, "dashboard.demonstratedSkills")}</h2>
        {data.skills.length ? (
          <ul className="dashboard-skill-list" aria-labelledby="dashboard-skills-title">
            {data.skills.map((skill) => (
              <li key={skill.id}>
                <Link className="dashboard-skill-chip" href={dashboardLinks.skill(skill.id)} aria-label={t(locale, "dashboard.skillCount", { skill: skill.name, count: formatCount(skill.confirmedAchievementCount, locale) })}>
                  {skill.name} · {formatCount(skill.confirmedAchievementCount, locale)}
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="dashboard-status" role="status">{t(locale, "dashboard.noDemonstratedSkills")}</p>}
      </section>
    </div>
  );
}
