import Link from "next/link";

import { Card } from "@/components/ui/card";
import { QuickLogCapture } from "@/features/activity/quick-log-capture";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";
import { t } from "@/i18n/messages";

export default async function QuickLogPage() {
  const { locale, profile } = await requireCompletedWorkspace("/activity/new");

  return (
    <section>
      <header className="workspace-page-header">
        <h1 className="text-3xl font-semibold tracking-tight">{t(locale, "quickLog.title")}</h1>
        <p>{t(locale, "quickLog.description")}</p>
      </header>
      <Card className="space-y-5">
        <QuickLogCapture key={profile.id} locale={locale} ownerId={profile.id} />
        <Link className="button-secondary inline-flex" href="/activity">
          {t(locale, "quickLog.backToActivity")}
        </Link>
      </Card>
    </section>
  );
}
