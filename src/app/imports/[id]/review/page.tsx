import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LocaleSwitcher } from "@/components/forms/locale-switcher";
import { UnsavedChangesProvider } from "@/components/ui/unsaved-changes";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { ImportServiceError } from "@/features/import/import-errors";
import { ImportReview } from "@/features/import/import-review";
import { createImportReviewViewService } from "@/features/import/import-review-view-service";
import { t } from "@/i18n/messages";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

/**
 * S03 lives outside the workspace frame: a provisional account (new user, onboarding not finished) must
 * reach it before S04, so the guard only requires a session and a profile, never a completed onboarding.
 */
export default async function ImportReviewPage({ params }: PageProps) {
  const { id } = await params;
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  if (!context.user) redirect("/sign-in?returnTo=" + encodeURIComponent(sanitizeReturnTo(`/imports/${id}/review`)));
  if (!context.profile || !context.client) redirect("/sign-in?notice=serviceUnavailable");

  let snapshot;
  try {
    snapshot = await createImportReviewViewService({ client: context.client, actorId: context.user.id }).getReviewView(id);
  } catch (error) {
    // A missing, malformed or foreign id is the same generic not-found page.
    if (error instanceof ImportServiceError && error.code === "NOT_FOUND") notFound();
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-12">
        <p role="alert" className="ui-message ui-message--danger">{t(locale, "error.unavailable")}</p>
        <Link className="button-secondary mt-4 inline-flex" href={`/imports/${id}/review`}>{t(locale, "common.retry")}</Link>
      </main>
    );
  }

  const onboarded = Boolean(context.profile.onboarding_completed_at);
  return (
    <UnsavedChangesProvider locale={locale}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={onboarded ? "/dashboard" : "/"} className="text-lg font-bold">WorkPulse</Link>
          <div className="flex flex-wrap items-center gap-3">
            {onboarded ? <Link className="text-sm underline underline-offset-4" href="/dashboard">{t(locale, "import.review.backToDashboard")}</Link> : null}
            <LocaleSwitcher locale={locale} />
          </div>
        </div>
        <ImportReview
          locale={locale}
          snapshot={snapshot}
          ownerId={context.user.id}
          defaults={{ locale, timezone: context.profile.timezone || "UTC" }}
          manualHref={onboarded ? "/settings/profile" : "/settings/profile?mode=onboarding"}
        />
      </main>
    </UnsavedChangesProvider>
  );
}
