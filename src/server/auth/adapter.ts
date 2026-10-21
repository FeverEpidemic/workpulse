import type { AuthError, EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

import { PROFILE_FIELD_LIMITS } from "@/domain/profile/field-contract";
import { googleDisplayNameSuggestion } from "@/server/auth/oauth-session";
import type { Database } from "@/server/supabase/database.types";

export type ConfirmEmailType = Extract<EmailOtpType, "email" | "signup" | "recovery">;

export interface AuthUser {
  id: string;
  email: string | undefined;
  /** Linked sign-in methods, e.g. `email` and `google`. */
  providers: string[];
  /** Name suggested by Google for onboarding; never saved automatically. */
  fullName: string | null;
}

export interface AuthAdapter {
  getUser(): Promise<{ user: AuthUser | null; error: AuthError | null }>;
  signInWithGoogle(input: { redirectTo: string; selectAccount: boolean }): Promise<{ url: string | null; error: AuthError | null }>;
  signUp(email: string, password: string, redirectTo: string): Promise<{ userId: string | null; sessionCreated: boolean; error: AuthError | null }>;
  signIn(email: string, password: string): Promise<{ userId: string | null; error: AuthError | null }>;
  signOutLocal(): Promise<{ error: AuthError | null }>;
  signOutGlobal(): Promise<{ error: AuthError | null }>;
  requestRecovery(email: string, redirectTo: string): Promise<{ error: AuthError | null }>;
  verifyEmail(tokenHash: string, type: ConfirmEmailType): Promise<{ error: AuthError | null }>;
  exchangeCode(code: string): Promise<{ error: AuthError | null }>;
  updatePassword(password: string): Promise<{ error: AuthError | null }>;
}

/** Linked sign-in methods of a Supabase user, from `identities`, else `app_metadata.providers`. */
export function authProviders(user: { identities?: { provider?: unknown }[] | null; app_metadata?: { providers?: unknown } | null }): string[] {
  const fromIdentities = (user.identities ?? []).map((identity) => identity.provider).filter((p): p is string => typeof p === "string");
  if (fromIdentities.length > 0) return fromIdentities;
  const fromMetadata = user.app_metadata?.providers;
  return Array.isArray(fromMetadata) ? fromMetadata.filter((p): p is string => typeof p === "string") : [];
}

export function createAuthAdapter(client: SupabaseClient<Database>): AuthAdapter {
  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return {
        user: data.user
          ? {
              id: data.user.id,
              email: data.user.email,
              providers: authProviders(data.user),
              fullName: googleDisplayNameSuggestion(data.user.user_metadata, PROFILE_FIELD_LIMITS.displayName),
            }
          : null,
        error,
      };
    },
    async signInWithGoogle({ redirectTo, selectAccount }) {
      const { data, error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          ...(selectAccount ? { queryParams: { prompt: "select_account" } } : {}),
        },
      });
      return { url: data?.url ?? null, error };
    },
    async signUp(email, password, redirectTo) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      return { userId: data.user?.id ?? null, sessionCreated: data.session !== null, error };
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      return { userId: data.user?.id ?? null, error };
    },
    async signOutLocal() {
      const { error } = await client.auth.signOut({ scope: "local" });
      return { error };
    },
    async signOutGlobal() {
      const { error } = await client.auth.signOut({ scope: "global" });
      return { error };
    },
    async requestRecovery(email, redirectTo) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      return { error };
    },
    async verifyEmail(tokenHash, type) {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      return { error };
    },
    async exchangeCode(code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      return { error };
    },
    async updatePassword(password) {
      const { error } = await client.auth.updateUser({ password });
      return { error };
    },
  };
}
