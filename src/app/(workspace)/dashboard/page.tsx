import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { OnboardingDraftCleanup } from "@/features/profile/onboarding-draft-cleanup";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function DashboardPage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  if (!context.user) redirect("/sign-in?returnTo=%2Fdashboard");
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");
  if (!context.profile.onboarding_completed_at) redirect("/onboarding/import");

  return (
    <section className="space-y-6" aria-labelledby="dashboard-title">
      <OnboardingDraftCleanup ownerId={context.profile.id} />
      <Card className="max-w-3xl space-y-3" aria-labelledby="dashboard-title">
        <p className="text-sm font-semibold text-[var(--color-action-primary)]">{context.profile.display_name}</p>
        <h1 id="dashboard-title" className="text-3xl font-semibold tracking-tight">{t(locale, "dashboard.title")}</h1>
        <p className="text-[var(--color-text-secondary)]">{t(locale, "dashboard.description")}</p>
      </Card>
    </section>
  );
}
