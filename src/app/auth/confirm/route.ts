import { NextResponse, type NextRequest } from "next/server";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { cookies } from "next/headers";

import { hasRecentRecoveryMethod, hasRecentRecoveryProof } from "@/server/auth/recovery-session";
import { createAuthAdapter, type ConfirmEmailType } from "@/server/auth/adapter";
import { clearAuthCookies } from "@/server/auth/clear-cookies";
import {
  OAUTH_RETURN_COOKIE,
  REAUTH_INTENT_COOKIE,
  hasRecentOAuthProof,
  readOAuthReturn,
  readReauthIntent,
} from "@/server/auth/oauth-session";
import { persistLocaleCookie } from "@/server/locale/cookie";
import { parseLocale } from "@/i18n/messages";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getTrustedSiteUrl } from "@/server/supabase/config";

const validTypes = new Set<ConfirmEmailType>(["email", "signup", "recovery"]);

/** Every callback outcome also ends the Google flow, so its cookies never outlive one attempt. */
function redirectTo(path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, getTrustedSiteUrl()), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  for (const name of [OAUTH_RETURN_COOKIE, REAUTH_INTENT_COOKIE]) {
    response.cookies.set(name, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  }
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const code = request.nextUrl.searchParams.get("code");
  const rawType = request.nextUrl.searchParams.get("type");
  const type = rawType && validTypes.has(rawType as ConfirmEmailType) ? rawType as ConfirmEmailType : null;

  const usableTokenHash = Boolean(tokenHash && type && tokenHash.length <= 2048);
  const usableCode = Boolean(code && code.length <= 2048);
  if (!usableTokenHash && !usableCode) {
    // Supabase Auth returns `error` here when Google sign-in is cancelled or fails; its description is not shown.
    const notice = request.nextUrl.searchParams.has("error") ? "oauthFailed" : "verificationFailed";
    return redirectTo(`/sign-in?notice=${notice}`);
  }

  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    const result = usableTokenHash && tokenHash && type
      ? await auth.verifyEmail(tokenHash, type)
      : usableCode && code
        ? await auth.exchangeCode(code)
        : { error: new Error("invalid callback") };
    if (result.error) return redirectTo("/sign-in?notice=verificationFailed");

    const { user, error: userError } = await auth.getUser();
    if (userError || !user) return redirectTo("/sign-in?notice=verificationFailed");

    const { data: claimsData, error: claimsError } = await client.auth.getClaims();
    const hasRecoveryClaim = !claimsError && hasRecentRecoveryMethod(claimsData?.claims.amr);
    const hasRecoveryProof = !claimsError && hasRecentRecoveryProof(claimsData?.claims.amr);
    const isRecoverySession = type === "recovery" || (!type && usableCode && hasRecoveryClaim);
    if (type === "recovery" && !hasRecoveryProof) {
      return redirectTo("/sign-in?notice=verificationFailed");
    }

    const isOAuthSession = !type && usableCode && !isRecoverySession && !claimsError && hasRecentOAuthProof(claimsData?.claims.amr);

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("locale, onboarding_completed_at, deleting_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return redirectTo("/sign-in?notice=verificationFailed");

    if (isOAuthSession && profile.deleting_at) {
      await auth.signOutLocal();
      clearAuthCookies(await cookies());
      return redirectTo("/sign-in?notice=accountDeleting");
    }

    if (isRecoverySession) {
      const response = redirectTo("/update-password");
      // Lax, not Strict: the link is opened from a mail client, and browsers withhold
      // Strict cookies for the whole cross-site navigation, including this redirect.
      response.cookies.set("wp-recovery-flow", "1", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 15 * 60,
      });
      return response;
    }

    if (profile.onboarding_completed_at) {
      try {
        await persistLocaleCookie(parseLocale(profile.locale));
      } catch {
        // Locale remains available from the canonical profile row.
      }
    }
    if (isOAuthSession) {
      const reauth = readReauthIntent(request.cookies.get(REAUTH_INTENT_COOKIE)?.value, user.id);
      if (reauth && profile.onboarding_completed_at) return redirectTo("/settings/profile?reauth=delete-account");
      const next = readOAuthReturn(request.cookies.get(OAUTH_RETURN_COOKIE)?.value);
      return redirectTo(destinationForLifecycle(profile.onboarding_completed_at ? "complete" : "provisional", next));
    }

    const next = sanitizeReturnTo(request.nextUrl.searchParams.get("next"));
    const destination = destinationForLifecycle(profile.onboarding_completed_at ? "complete" : "provisional", next);
    return redirectTo(destination);
  } catch {
    return redirectTo("/sign-in?notice=verificationFailed");
  }
}
