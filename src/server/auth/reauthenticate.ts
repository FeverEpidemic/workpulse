import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { mapSupabaseAuthError } from "@/server/auth/errors";
import { getSupabasePublicConfig } from "@/server/supabase/config";

export type PasswordVerification = "ok" | "invalid" | "rate_limited" | "unavailable";

/** Builds the throwaway client; replaced in tests. It never persists a session or touches cookies. */
export type OneShotAuthClientFactory = () => Pick<SupabaseClient["auth"], "signInWithPassword" | "signOut"> | null;

const defaultFactory: OneShotAuthClientFactory = () => {
  const config = getSupabasePublicConfig();
  if (!config) return null;
  return createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  }).auth;
};

/**
 * Checks the current password of the signed-in account. The email comes from the session, never from a form, and the
 * sign-in runs on a throwaway client so the browser session is neither replaced nor extended.
 */
export async function verifyAccountPassword(
  input: { email: string; password: string; expectedUserId: string },
  createAuthClient: OneShotAuthClientFactory = defaultFactory,
): Promise<PasswordVerification> {
  const auth = createAuthClient();
  if (!auth) return "unavailable";
  try {
    const { data, error } = await auth.signInWithPassword({ email: input.email, password: input.password });
    if (error) {
      const mapped = mapSupabaseAuthError(error);
      if (mapped.code === "RATE_LIMITED") return "rate_limited";
      return mapped.messageKey === "auth.invalidCredentials" ? "invalid" : "unavailable";
    }
    if (data.user?.id !== input.expectedUserId) return "invalid";
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    try {
      await auth.signOut({ scope: "local" });
    } catch {
      // The throwaway client holds nothing the browser depends on.
    }
  }
}
