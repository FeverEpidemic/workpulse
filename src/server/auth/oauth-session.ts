import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { hasRecentMethod } from "@/server/auth/recovery-session";

/** Return path chosen before leaving for Google. The callback reads it instead of a query on the exact redirect URL. */
export const OAUTH_RETURN_COOKIE = "wp-oauth-return";
/** Set only by the S12 "Confirm with Google" action; it opens the delete dialog and grants nothing by itself. */
export const REAUTH_INTENT_COOKIE = "wp-reauth";
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const OAUTH_REAUTH_WINDOW_SECONDS = 5 * 60;

export type ReauthIntent = "delete-account";

/** Lax, not Strict: the callback arrives through a cross-site navigation from Google and Supabase Auth. */
export function oauthCookieOptions(production: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
  };
}

export function readOAuthReturn(value: string | null | undefined): string {
  return sanitizeReturnTo(value);
}

/** The intent names the user who asked, so choosing another Google account at Google does not open that account's delete dialog. */
export function reauthIntentValue(userId: string): string {
  return `delete-account.${userId}`;
}

export function readReauthIntent(value: string | null | undefined, userId: string): ReauthIntent | null {
  return value === reauthIntentValue(userId) ? "delete-account" : null;
}

export function hasOAuthMethod(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((entry) => entry && typeof entry === "object" && "method" in entry && entry.method === "oauth");
}

/** Account deletion for a Google-only account needs an OAuth sign-in recorded in the last five minutes. */
export function hasRecentOAuthProof(amr: unknown, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return hasRecentMethod(amr, ["oauth"], nowSeconds, OAUTH_REAUTH_WINDOW_SECONDS);
}

function cleanName(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  const clipped = Array.from(collapsed).slice(0, maxLength).join("").trimEnd();
  return clipped === "" ? null : clipped;
}

/** Onboarding prefill from Google profile metadata. The user still saves the name; nothing is written here. */
export function googleDisplayNameSuggestion(metadata: unknown, maxLength: number): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  return cleanName(record.full_name, maxLength) ?? cleanName(record.name, maxLength);
}
