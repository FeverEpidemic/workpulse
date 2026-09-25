import Link from "next/link";
import { redirect } from "next/navigation";
import * as z from "zod";

import { sanitizeAchievementReturnTo } from "@/domain/routes/safe-return";
import type { AchievementDetail } from "@/domain/achievement/contracts";
import { AchievementForm } from "@/features/achievement/achievement-form";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import { AchievementPageIssue } from "@/features/achievement/achievement-page-issue";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewAchievementPage({ searchParams }: Props) {
  const query = await searchParams;
  const returnTo = sanitizeAchievementReturnTo(typeof query.returnTo === "string" ? query.returnTo : null);
  const unknownKeys = Object.keys(query).some((key) => !["activity", "project", "returnTo"].includes(key));
  const activityValue = query.activity;
  const projectValue = query.project;
  const requestedActivity = typeof activityValue === "string" && z.uuid().safeParse(activityValue).success ? activityValue : null;
  const requestedProject = typeof projectValue === "string" && z.uuid().safeParse(projectValue).success ? projectValue : null;
  const invalidSource = (activityValue !== undefined && !requestedActivity)
    || (projectValue !== undefined && !requestedProject)
    || Boolean(requestedActivity && requestedProject)
    || unknownKeys
    || (query.returnTo !== undefined && typeof query.returnTo !== "string");
  if (invalidSource) redirect("/achievements");
  const createQuery = new URLSearchParams();
  if (requestedActivity) createQuery.set("activity", requestedActivity);
  if (requestedProject) createQuery.set("project", requestedProject);
  createQuery.set("returnTo", returnTo);
  const createPath = `/achievements/new?${createQuery.toString()}`;
  const { context, profile, locale } = await requireCompletedWorkspace(createPath);
  if (!context.client) return <AchievementPageIssue locale={locale} retryHref={createPath} signInReturnTo={createPath} />;
  let options: Awaited<ReturnType<ReturnType<typeof createAchievementService>["listContextOptions"]>> | null = null;
  let sourceActivity: AchievementDetail["activity"] = null;
  let sourceActivityId: string | null = null;
  let initialProjectId = "";
  let initialExperienceId = "";
  let loadError: unknown = null;
  let existingAchievementId: string | null = null;
  try {
    const achievementService = createAchievementService(context.client);
    options = await achievementService.listContextOptions();
    if (requestedActivity) {
      const activityDetail = await createActivityService(context.client).getActivity(requestedActivity);
      existingAchievementId = activityDetail.achievement?.id ?? null;
      sourceActivity = activityDetail.activity;
      sourceActivityId = activityDetail.activity.id;
    } else if (requestedProject) {
      const project = options.projects.find((item) => item.id === requestedProject);
      if (!project) throw new AchievementServiceError("NOT_FOUND");
      initialProjectId = project.id;
      initialExperienceId = project.experience_id ?? "";
    }
  } catch (error) {
    loadError = error;
  }
  if (existingAchievementId) redirect(`/achievements/${existingAchievementId}?${new URLSearchParams({ returnTo }).toString()}`);
  if (loadError || !options) {
    const serviceError = loadError instanceof AchievementServiceError || loadError instanceof ActivityServiceError ? loadError : null;
    return <AchievementPageIssue locale={locale} messageKey={serviceError?.messageKey} correlationId={serviceError?.correlationId} retryHref={createPath} signInReturnTo={serviceError?.code === "UNAUTHENTICATED" ? createPath : undefined} />;
  }
  return <section className="space-y-6"><header className="workspace-page-header"><Link className="button-secondary mb-4" href={returnTo}>{t(locale, "achievement.back")}</Link><h1 className="text-3xl font-semibold tracking-tight">{t(locale, "achievement.new")}</h1></header><AchievementForm locale={locale} ownerId={profile.id} contextOptions={options} returnTo={returnTo} createPath={createPath} activityId={sourceActivityId} sourceActivity={sourceActivity} initialProjectId={initialProjectId} initialExperienceId={initialExperienceId} /></section>;
}
