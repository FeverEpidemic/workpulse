import { NextResponse, type NextRequest } from "next/server";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { hasRecentRecoveryMethod, hasRecentRecoveryProof } from "@/server/auth/recovery-session";
import { createAuthAdapter, type ConfirmEmailType } from "@/server/auth/adapter";
import { persistLocaleCookie } from "@/server/locale/cookie";
import { parseLocale } from "@/i18n/messages";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getTrustedSiteUrl } from "@/server/supabase/config";

const validTypes = new Set<ConfirmEmailType>(["email", "signup", "recovery"]);

function redirectTo(path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, getTrustedSiteUrl()), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
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
    return redirectTo("/sign-in?notice=verificationFailed");
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

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("locale, onboarding_completed_at")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError || !profile) return redirectTo("/sign-in?notice=verificationFailed");

    if (isRecoverySession) {
      const response = redirectTo("/update-password");
      response.cookies.set("wp-recovery-flow", "1", {
        httpOnly: true,
        sameSite: "strict",
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
    const next = sanitizeReturnTo(request.nextUrl.searchParams.get("next"));
    const destination = destinationForLifecycle(profile.onboarding_completed_at ? "complete" : "provisional", next);
    return redirectTo(destination);
  } catch {
    return redirectTo("/sign-in?notice=verificationFailed");
  }
}
