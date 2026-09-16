import type { AuthError, EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/supabase/database.types";

export type ConfirmEmailType = Extract<EmailOtpType, "email" | "signup" | "recovery">;

export interface AuthAdapter {
  getUser(): Promise<{ user: { id: string; email: string | undefined } | null; error: AuthError | null }>;
  signUp(email: string, password: string, redirectTo: string): Promise<{ userId: string | null; sessionCreated: boolean; error: AuthError | null }>;
  signIn(email: string, password: string): Promise<{ userId: string | null; error: AuthError | null }>;
  signOutLocal(): Promise<{ error: AuthError | null }>;
  requestRecovery(email: string, redirectTo: string): Promise<{ error: AuthError | null }>;
  verifyEmail(tokenHash: string, type: ConfirmEmailType): Promise<{ error: AuthError | null }>;
  exchangeCode(code: string): Promise<{ error: AuthError | null }>;
  updatePassword(password: string): Promise<{ error: AuthError | null }>;
}

export function createAuthAdapter(client: SupabaseClient<Database>): AuthAdapter {
  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      return {
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        error,
      };
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
