import * as z from "zod";

import { RecordUnavailable } from "@/components/ui/record-unavailable";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { sanitizeActivityReturnTo } from "@/domain/routes/safe-return";
import { ActivityDetailClient } from "@/features/activity/activity-detail";
import { listActivityContextOptions } from "@/features/activity/activity-context-service";
import { ActivityServiceError, createActivityService } from "@/features/activity/activity-service";
import { ActivityPageIssue } from "@/features/activity/activity-page-issue";
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
      () => ({ status: "error" as const, options: emptyContextOptions }),
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

  return (
    <ActivityDetailClient
      locale={locale}
      ownerId={profile.id}
      activity={activityResult.detail.activity}
      chatMessages={activityResult.detail.chatMessages}
      options={contextResult.options}
      contextOptionsAvailable={contextResult.status === "ok"}
      returnTo={returnTo}
    />
  );
}
