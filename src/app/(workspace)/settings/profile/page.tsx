import { redirect } from "next/navigation";
import Link from "next/link";
import * as z from "zod";

import { OnboardingForm } from "@/features/profile/onboarding-form";
import { ProfileWorkspace } from "@/features/profile/profile-workspace";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { t } from "@/i18n/messages";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [context, locale, params] = await Promise.all([getRequestContext(), getRequestLocale(), searchParams]);
  const recordParam = typeof params.record === "string" ? params.record : "";
  const openRecordId = z.uuid().safeParse(recordParam).success ? recordParam : undefined;
  if (!context.user) redirect("/sign-in?returnTo=%2Fsettings%2Fprofile");
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");

  if (!context.profile.onboarding_completed_at) {
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-4xl content-center gap-8 px-5 py-10 md:grid-cols-[1fr_440px]">
        <section className="space-y-4">
          <Link href="/" className="text-lg font-bold">WorkPulse</Link>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t(locale, "profile.onboardingTitle")}</h1>
          <p className="max-w-lg text-[var(--wp-muted)]">{t(locale, "profile.onboardingDescription")}</p>
        </section>
        <section className="app-card space-y-5">
          <OnboardingForm profile={context.profile} locale={locale} />
        </section>
      </main>
    );
  }

  return <ProfileWorkspace client={context.client!} profile={context.profile} userEmail={context.user.email ?? ""} locale={locale} openRecordId={openRecordId} />;
}
