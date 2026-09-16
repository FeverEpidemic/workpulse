import Link from "next/link";
import { redirect } from "next/navigation";

import { LocaleSwitcher } from "@/components/forms/locale-switcher";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

export default async function OnboardingImportPage() {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  if (!context.user) redirect("/sign-in?returnTo=%2Fonboarding%2Fimport");
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");
  if (context.profile.onboarding_completed_at) redirect("/dashboard");

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-5xl content-center gap-6 px-5 py-10 lg:grid-cols-[1fr_440px]">
      <section className="space-y-4">
        <Link href="/" className="text-lg font-bold">WorkPulse</Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t(locale, "onboarding.importTitle")}</h1>
        <p className="max-w-xl text-[var(--wp-muted)]">{t(locale, "onboarding.importUnavailable")}</p>
        <LocaleSwitcher locale={locale} />
      </section>
      <section className="app-card space-y-5">
        <div>
          <h2 className="text-xl font-semibold">{t(locale, "onboarding.importTitle")}</h2>
          <p className="mt-2 text-sm text-[var(--wp-muted)]">{t(locale, "onboarding.importUnavailable")}</p>
        </div>
        <button className="button-secondary w-full cursor-not-allowed opacity-70" type="button" disabled aria-disabled="true">
          {t(locale, "onboarding.importUnavailableLabel")}
        </button>
        <Link className="button-primary w-full" href="/settings/profile?mode=onboarding">
          {t(locale, "onboarding.startManually")}
        </Link>
      </section>
    </main>
  );
}
