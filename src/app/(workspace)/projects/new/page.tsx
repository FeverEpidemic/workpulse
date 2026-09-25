import Link from "next/link";

import { Card } from "@/components/ui/card";
import type { ProjectExperienceSummary } from "@/domain/project/contracts";
import { sanitizeProjectReturnTo } from "@/domain/routes/safe-return";
import { ProjectForm } from "@/features/project/project-form";
import { ProjectServiceError, createProjectService } from "@/features/project/project-service";
import { ProjectPageIssue } from "@/features/project/project-page-issue";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type NewProjectPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewProjectPage({ searchParams }: NewProjectPageProps) {
  const params = await searchParams;
  const returnTo = sanitizeProjectReturnTo(typeof params.returnTo === "string" ? params.returnTo : null);
  const { context, profile, locale } = await requireCompletedWorkspace(`/projects/new?${new URLSearchParams({ returnTo }).toString()}`);
  if (!context.client) return <ProjectPageIssue locale={locale} retryHref={returnTo} signInReturnTo={returnTo} />;
  let experiences: ProjectExperienceSummary[] = [];
  let loadError: unknown = null;
  try {
    experiences = await createProjectService(context.client).listExperienceOptions();
  } catch (error) {
    loadError = error;
  }
  if (loadError) {
    const serviceError = loadError instanceof ProjectServiceError ? loadError : null;
    return <ProjectPageIssue locale={locale} messageKey={serviceError?.messageKey} correlationId={serviceError?.correlationId} retryHref={`/projects/new?${new URLSearchParams({ returnTo }).toString()}`} />;
  }
  return (
    <section className="space-y-6">
      <header className="workspace-page-header">
        <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "project.back")}</Link>
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "project.createTitle")}</h1>
        <p>{t(locale, "project.description")}</p>
      </header>
      <Card className="project-form-card">
        <ProjectForm locale={locale} ownerId={profile.id} experiences={experiences} returnTo={returnTo} />
      </Card>
    </section>
  );
}
