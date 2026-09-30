import Link from "next/link";
import { redirect } from "next/navigation";

import { LocaleSwitcher } from "@/components/forms/locale-switcher";
import { AI_CONSENT_VERSION } from "@/domain/ai/contracts";
import { toImportView, type ImportView } from "@/domain/import/import-view";
import { createImportService } from "@/features/import/import-service";
import { ImportStart } from "@/features/import/import-start";
import { t } from "@/i18n/messages";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { getSupabaseAdminClient } from "@/server/supabase/admin";

export const dynamic = "force-dynamic";

export default async function OnboardingImportPage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  if (!context.user) redirect("/sign-in?returnTo=%2Fonboarding%2Fimport");
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");
  // Returning users reach S02 from S12 and the empty dashboard, so an onboarded account is no longer redirected.
  const onboarded = Boolean(context.profile.onboarding_completed_at);

  const granted = Boolean(context.profile.ai_consent_at && context.profile.ai_consent_version === AI_CONSENT_VERSION);
  // Leave-return: resume the latest saved batch from server state only.
  let initialView: ImportView = toImportView({ batch: null, consent: granted });
  try {
    const admin = getSupabaseAdminClient();
    initialView = await createImportService({
      client: context.client!, admin, storage: new SupabaseStorageAdapter(admin), actorId: context.user.id,
    }).getActiveView();
  } catch {
    // The chooser still works; the upload itself reports an unavailable service.
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl content-center gap-6 px-5 py-10 lg:grid-cols-[1fr_480px]">
      <section className="space-y-4">
        <Link href="/" className="text-lg font-bold">WorkPulse</Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">
          {t(locale, onboarded ? "import.titleReturning" : "onboarding.importTitle")}
        </h1>
        <p className="max-w-xl text-[var(--wp-muted)]">{t(locale, "import.intro")}</p>
        {onboarded ? <Link className="text-sm underline underline-offset-4" href="/dashboard">{t(locale, "import.review.backToDashboard")}</Link> : null}
        <LocaleSwitcher locale={locale} />
      </section>
      <section className="app-card">
        <ImportStart
          locale={locale}
          initialView={initialView}
          consent={{ granted, profileRevision: context.profile.revision }}
          onboarded={onboarded}
        />
      </section>
    </main>
  );
}
