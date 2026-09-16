import { redirect } from "next/navigation";

import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { getRequestContext, getRequestLocale } from "@/server/auth/context";

export async function requireCompletedWorkspace(returnTo: string) {
  const [context, locale] = await Promise.all([getRequestContext(), getRequestLocale()]);

  if (!context.user) {
    redirect("/sign-in?returnTo=" + encodeURIComponent(sanitizeReturnTo(returnTo)));
  }
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");
  if (!context.profile.onboarding_completed_at) redirect("/onboarding/import");

  return { context, profile: context.profile, user: context.user, locale };
}
