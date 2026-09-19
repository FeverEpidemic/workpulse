import Link from "next/link";

import { Card } from "@/components/ui/card";
import { activityDateInTimeZone } from "@/domain/activity/activity-date";
import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import { sanitizeActivityReturnTo } from "@/domain/routes/safe-return";
import { ActivityCaptureForm } from "@/features/activity/activity-capture-form";
import { listActivityContextOptions } from "@/features/activity/activity-context-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

type NewActivityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const emptyContextOptions: ActivityContextOptions = { experiences: [], projects: [] };

export default async function NewActivityPage({ searchParams }: NewActivityPageProps) {
  const params = await searchParams;
  const returnTo = sanitizeActivityReturnTo(typeof params.returnTo === "string" ? params.returnTo : null);
  const { context, profile, locale } = await requireCompletedWorkspace(
    `/activity/new?${new URLSearchParams({ returnTo }).toString()}`,
  );
  let options = emptyContextOptions;
  let contextOptionsAvailable = false;

  if (context.client) {
    try {
      options = await listActivityContextOptions(context.client, profile.id);
      contextOptionsAvailable = true;
    } catch {
      // Manual capture stays usable without optional context selectors.
    }
  }

  return (
    <section className="space-y-6">
      <header className="workspace-page-header">
        <Link className="button-secondary mb-4" href={returnTo}>{t(locale, "activity.back")}</Link>
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "quickLog.title")}</h1>
        <p>{t(locale, "quickLog.description")}</p>
      </header>
      <Card className="activity-capture-card">
        <ActivityCaptureForm
          locale={locale}
          ownerId={profile.id}
          defaultOccurredOn={activityDateInTimeZone(new Date(), profile.timezone)}
          options={options}
          contextOptionsAvailable={contextOptionsAvailable}
          returnTo={returnTo}
        />
      </Card>
    </section>
  );
}
