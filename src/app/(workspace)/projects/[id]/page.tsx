import Link from "next/link";
import * as z from "zod";

import { RecordUnavailable } from "@/components/ui/record-unavailable";
import type { AchievementRelinkCandidatePage } from "@/domain/achievement/contracts";
import type { ProjectDetail as ProjectDetailData, ProjectExperienceSummary, ProjectRelinkCandidatePage } from "@/domain/project/contracts";
import { sanitizeProjectDetailReturnTo, sanitizeProjectReturnTo } from "@/domain/routes/safe-return";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { ProjectDetail } from "@/features/project/project-detail";
import { ProjectForm } from "@/features/project/project-form";
import { ProjectPageIssue } from "@/features/project/project-page-issue";
import { ProjectServiceError, createProjectService } from "@/features/project/project-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type ProjectDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ProjectDetailPage({ params, searchParams }: ProjectDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const rawReturnTo = typeof query.returnTo === "string" ? query.returnTo : null;
  const returnTo = sanitizeProjectReturnTo(rawReturnTo);
  const detailReturnTo = sanitizeProjectDetailReturnTo(rawReturnTo, id);
  const { context, profile, locale } = await requireCompletedWorkspace(detailReturnTo);
  if (!z.uuid().safeParse(id).success || !context.client) return <RecordUnavailable locale={locale} backHref={returnTo} backLabel={t(locale, "project.back")} />;
  let loaded: {
    detail: ProjectDetailData;
    experiences: ProjectExperienceSummary[];
    candidates: ProjectRelinkCandidatePage;
    achievementCandidates: AchievementRelinkCandidatePage;
  } | null = null;
  let loadError: unknown = null;
  try {
    const service = createProjectService(context.client);
    const achievementService = createAchievementService(context.client);
    const detail = await service.getProject(id);
    const [experiences, candidates, achievementCandidates] = await Promise.all([
      service.listExperienceOptions(),
      service.listRelinkCandidates(id),
      achievementService.listRelinkCandidates(id),
    ]);
    loaded = { detail, experiences, candidates, achievementCandidates };
  } catch (error) {
    loadError = error;
  }
  const serviceError = loadError instanceof ProjectServiceError || loadError instanceof AchievementServiceError ? loadError : null;
  if (serviceError?.code === "NOT_FOUND") return <RecordUnavailable locale={locale} backHref={returnTo} backLabel={t(locale, "project.back")} />;
  if (loadError || !loaded) return <ProjectPageIssue locale={locale} messageKey={serviceError?.messageKey} correlationId={serviceError?.correlationId} retryHref={detailReturnTo} signInReturnTo={serviceError?.code === "UNAUTHENTICATED" ? detailReturnTo : undefined} />;
  const { detail, experiences, candidates, achievementCandidates } = loaded;
  return (
    <section className="space-y-6">
      <header className="workspace-page-header">
        <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "project.back")}</Link>
        <p>{t(locale, "project.description")}</p>
      </header>
      <ProjectForm locale={locale} ownerId={profile.id} experiences={experiences} project={detail.project} linkedActivityCount={detail.dependencyCount} returnTo={returnTo} />
      <ProjectDetail locale={locale} ownerId={profile.id} detail={detail} candidates={candidates} achievementCandidates={achievementCandidates} returnTo={returnTo} />
    </section>
  );
}
