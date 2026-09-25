import * as z from "zod";

import { RecordUnavailable } from "@/components/ui/record-unavailable";
import { sanitizeAchievementReturnTo } from "@/domain/routes/safe-return";
import { AchievementDetail } from "@/features/achievement/achievement-detail";
import { AchievementPageIssue } from "@/features/achievement/achievement-page-issue";
import { AchievementServiceError, createAchievementService } from "@/features/achievement/achievement-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AchievementDetailPage({ params, searchParams }: Props) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnTo = sanitizeAchievementReturnTo(typeof query.returnTo === "string" ? query.returnTo : null);
  const detailPath = `/achievements/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo }).toString()}`;
  const { context, profile, locale } = await requireCompletedWorkspace(detailPath);
  if (!z.uuid().safeParse(id).success || !context.client) return <RecordUnavailable locale={locale} backHref={returnTo} backLabel={t(locale, "achievement.back")} />;
  let loaded: Awaited<ReturnType<ReturnType<typeof createAchievementService>["getAchievement"]>> | null = null;
  let options: Awaited<ReturnType<ReturnType<typeof createAchievementService>["listContextOptions"]>> | null = null;
  let loadError: unknown = null;
  try {
    const service = createAchievementService(context.client);
    [loaded, options] = await Promise.all([service.getAchievement(id), service.listContextOptions()]);
  } catch (error) {
    loadError = error;
  }
  if (loadError) {
    if (loadError instanceof AchievementServiceError && loadError.code === "NOT_FOUND") return <RecordUnavailable locale={locale} backHref={returnTo} backLabel={t(locale, "achievement.back")} />;
    const serviceError = loadError instanceof AchievementServiceError ? loadError : null;
    return <AchievementPageIssue locale={locale} messageKey={serviceError?.messageKey} correlationId={serviceError?.correlationId} retryHref={detailPath} signInReturnTo={serviceError?.code === "UNAUTHENTICATED" ? detailPath : undefined} />;
  }
  if (!loaded || !options) return <AchievementPageIssue locale={locale} retryHref={detailPath} />;
  return <AchievementDetail locale={locale} ownerId={profile.id} detail={loaded} contextOptions={options} returnTo={returnTo} />;
}
