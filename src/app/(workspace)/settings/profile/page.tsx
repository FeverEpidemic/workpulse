import { redirect } from "next/navigation";
import Link from "next/link";
import * as z from "zod";

import { BrandLogo } from "@/components/ui/brand-logo";
import { PROFILE_FIELD_LIMITS } from "@/domain/profile/field-contract";
import type { DeletionReauth } from "@/features/account/delete-account-state";
import { authProviders } from "@/server/auth/adapter";
import { googleDisplayNameSuggestion, hasRecentOAuthProof } from "@/server/auth/oauth-session";
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

  const providers = authProviders(context.user);
  const googleOnly = providers.includes("google") && !providers.includes("email");

  if (!context.profile.onboarding_completed_at) {
    const initialDisplayName = providers.includes("google")
      ? googleDisplayNameSuggestion(context.user.user_metadata, PROFILE_FIELD_LIMITS.displayName)
      : null;
    return (
      <main className="mx-auto grid min-h-screen w-full max-w-4xl content-center gap-8 px-5 py-10 md:grid-cols-[1fr_440px]">
        <section className="space-y-4">
          <Link href="/" className="brand-logo"><BrandLogo /></Link>
          <h1 className="mt-8 text-3xl font-semibold tracking-tight">{t(locale, "profile.onboardingTitle")}</h1>
          <p className="max-w-lg text-[var(--wp-muted)]">{t(locale, "profile.onboardingDescription")}</p>
        </section>
        <section className="app-card space-y-5">
          <OnboardingForm profile={context.profile} locale={locale} initialDisplayName={initialDisplayName} />
        </section>
      </main>
    );
  }

  // The server action checks freshness again; this only decides which step the dialog shows.
  let deletionReauth: DeletionReauth = { method: "password" };
  if (googleOnly) {
    const { data: claims, error: claimsError } = await context.client!.auth.getClaims();
    deletionReauth = { method: "google", fresh: !claimsError && hasRecentOAuthProof(claims?.claims.amr) };
  }

  return (
    <ProfileWorkspace
      client={context.client!}
      profile={context.profile}
      userEmail={context.user.email ?? ""}
      locale={locale}
      openRecordId={openRecordId}
      deletionReauth={deletionReauth}
      reauthNotice={params.reauth === "switched" ? "switched" : undefined}
      openDeleteDialog={params.reauth === "delete-account" && deletionReauth.method === "google" && deletionReauth.fresh}
    />
  );
}
