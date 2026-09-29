import * as z from "zod";

import { RecordUnavailable } from "@/components/ui/record-unavailable";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { sanitizeActivityReturnTo } from "@/domain/routes/safe-return";
import { ActivityDetailClient } from "@/features/activity/activity-detail";
import {
  activityContextIssueFromError,
  listActivityContextOptions,
  type ActivityContextIssue,
} from "@/features/activity/activity-context-service";
import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import { ActivityPageIssue } from "@/features/activity/activity-page-issue";
import { createAiReviewService } from "@/features/ai/ai-review-service";
import { hasCurrentAiConsent } from "@/features/ai/consent-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

type ActivityDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const emptyContextOptions: ActivityContextOptions = { experiences: [], projects: [] };

export default async function ActivityDetailPage({ params, searchParams }: ActivityDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const returnTo = sanitizeActivityReturnTo(typeof query.returnTo === "string" ? query.returnTo : null);
  const detailPath = `/activity/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo }).toString()}`;
  const { context, profile, locale } = await requireCompletedWorkspace(detailPath);

  if (!z.uuid().safeParse(id).success) {
    return <RecordUnavailable locale={locale} backHref={returnTo} />;
  }
  if (!context.client) {
    return (
      <ActivityPageIssue
        locale={locale}
        retryHref={detailPath}
        signInReturnTo={detailPath}
      />
    );
  }

  const service = createActivityService(context.client);
  const [activityResult, contextResult] = await Promise.all([
    service.getActivity(id).then(
      (detail) => ({ status: "ok" as const, detail }),
      (error: unknown) => ({ status: "error" as const, error }),
    ),
    listActivityContextOptions(context.client, profile.id).then(
      (options) => ({ status: "ok" as const, options }),
      (error: unknown) => ({ status: "error" as const, error, options: emptyContextOptions }),
    ),
  ]);

  if (activityResult.status === "error") {
    const error = activityResult.error;
    if (error instanceof ActivityServiceError && error.code === "NOT_FOUND") {
      return <RecordUnavailable locale={locale} backHref={returnTo} />;
    }
    return (
      <ActivityPageIssue
        locale={locale}
        messageKey={error instanceof ActivityServiceError ? error.messageKey : "error.unavailable"}
        correlationId={error instanceof ActivityServiceError ? error.correlationId : undefined}
        retryHref={detailPath}
        signInReturnTo={error instanceof ActivityServiceError && error.code === "UNAUTHENTICATED" ? detailPath : undefined}
      />
    );
  }

  const contextIssue: ActivityContextIssue | undefined = contextResult.status === "error"
    ? activityContextIssueFromError(contextResult.error)
    : undefined;
  const initialAnalysis = await createAiReviewService(context.client).getAnalysisView(id).catch(() => null);

  return (
    <ActivityDetailClient
      locale={locale}
      ownerId={profile.id}
      activity={activityResult.detail.activity}
      chatMessages={activityResult.detail.chatMessages}
      achievement={activityResult.detail.achievement}
      options={contextResult.options}
      contextIssue={contextIssue}
      returnTo={returnTo}
      consent={{ granted: hasCurrentAiConsent(profile), profileRevision: profile.revision }}
      initialAnalysis={initialAnalysis}
    />
  );
}
