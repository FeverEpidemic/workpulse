import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UpdatePasswordForm } from "@/features/auth/update-password-form";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import { hasRecentRecoveryProof } from "@/server/auth/recovery-session";
import { t } from "@/i18n/messages";

export default async function UpdatePasswordPage() {
  const cookieStore = await cookies();
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);
  if (cookieStore.get("wp-recovery-flow")?.value !== "1" || !context.user || context.profileUnavailable) {
    redirect("/sign-in?notice=invalidRecovery");
  }
  const { data: claimsData, error: claimsError } = await context.client!.auth.getClaims();
  if (claimsError || !hasRecentRecoveryProof(claimsData?.claims.amr)) {
    redirect("/sign-in?notice=invalidRecovery");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-5 py-10">
      <section className="app-card space-y-5">
        <Link href="/sign-in" className="text-lg font-bold">WorkPulse</Link>
        <div>
          <h1 className="text-2xl font-semibold">{t(locale, "auth.passwordResetTitle")}</h1>
          <p className="mt-2 text-sm text-[var(--wp-muted)]">{t(locale, "auth.passwordResetDescription")}</p>
        </div>
        <UpdatePasswordForm locale={locale} />
        <p className="text-xs text-[var(--wp-muted)]">{t(locale, "auth.invalidRecovery")}</p>
      </section>
    </main>
  );
}
