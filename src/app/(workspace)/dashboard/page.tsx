import { OnboardingDraftCleanup } from "@/features/profile/onboarding-draft-cleanup";
import { DashboardIssue } from "@/features/dashboard/dashboard-issue";
import { DashboardHeader, DashboardView } from "@/features/dashboard/dashboard-view";
import { DashboardServiceError, createDashboardService } from "@/features/dashboard/dashboard-service";
import { requireCompletedWorkspace } from "@/server/auth/workspace-page";

export default async function DashboardPage() {
  const { context, profile, locale } = await requireCompletedWorkspace("/dashboard");
  let dashboard;
  let issue: DashboardServiceError | null = null;
  try {
    dashboard = await createDashboardService(context.client!).getDashboard();
  } catch (error) {
    issue = error instanceof DashboardServiceError ? error : new DashboardServiceError("UNAVAILABLE");
  }

  return (
    <section className="dashboard-page-shell" aria-labelledby="dashboard-title">
      <OnboardingDraftCleanup ownerId={profile.id} />
      {dashboard ? <DashboardView data={dashboard} displayName={profile.display_name} locale={locale} /> : (
        <div className="dashboard-page">
          <DashboardHeader displayName={profile.display_name} locale={locale} />
          <DashboardIssue
            locale={locale}
            titleKey="dashboard.unavailableTitle"
            messageKey={issue?.messageKey ?? "error.unavailable"}
            correlationId={issue?.correlationId}
            retryHref="/dashboard"
            signInReturnTo={issue?.code === "UNAUTHENTICATED" ? "/dashboard" : undefined}
          />
        </div>
      )}
    </section>
  );
}
