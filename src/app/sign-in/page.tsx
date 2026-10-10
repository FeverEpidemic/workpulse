import { redirect } from "next/navigation";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { SignInClient } from "@/features/auth/sign-in-client";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";
import type { MessageKey } from "@/i18n/messages";

type SignInSearchParams = Promise<Record<string, string | string[] | undefined>>;

const noticeKeys: Record<string, MessageKey> = {
  verificationFailed: "auth.verificationFailed",
  passwordUpdated: "auth.passwordUpdated",
  accountDeleted: "auth.accountDeleted",
  accountDeleting: "auth.accountDeleting",
  invalidRecovery: "auth.invalidRecovery",
  serviceUnavailable: "error.unavailable",
};

export default async function SignInPage({ searchParams }: { searchParams: SignInSearchParams }) {
  const query = await searchParams;
  const returnToValue = typeof query.returnTo === "string" ? query.returnTo : null;
  const returnTo = sanitizeReturnTo(returnToValue);
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);

  if (context.user && context.profile) {
    redirect(destinationForLifecycle(context.profile.onboarding_completed_at ? "complete" : "provisional", returnTo));
  }

  const noticeValue = typeof query.notice === "string" ? query.notice : "";
  return (
    <SignInClient
      locale={locale}
      returnTo={returnTo}
      notice={context.accountDeleting ? "auth.accountDeleting" : noticeKeys[noticeValue]}
      configured={context.configured}
    />
  );
}
