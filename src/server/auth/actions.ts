"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as z from "zod";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeReturnTo } from "@/domain/routes/safe-return";
import { parseLocale, type MessageKey } from "@/i18n/messages";
import { emailSchema, passwordSchema } from "@/features/profile/schemas";
import { actionFailure, actionSuccess, type ActionState } from "@/server/action-result";
import { authFailureState } from "@/server/auth/errors";
import { createAuthAdapter } from "@/server/auth/adapter";
import { clearAuthCookies } from "@/server/auth/clear-cookies";
import { hasRecentRecoveryProof } from "@/server/auth/recovery-session";
import { getAuthCallbackUrl } from "@/server/supabase/config";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { persistLocaleCookie } from "@/server/locale/cookie";

const actionInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function isNextRedirect(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT;"),
  );
}

function validationState(error: z.ZodError): ActionState {
  const fieldErrors: Partial<Record<string, MessageKey>> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    const key = issue.message.startsWith("validation.") ? issue.message as MessageKey : "error.validation";
    fieldErrors[field] = key;
  }
  return actionFailure("VALIDATION", "error.validation", { fieldErrors });
}

export async function signInAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = actionInputSchema.safeParse({
    email: formText(formData, "email"),
    password: formText(formData, "password"),
  });
  if (!parsed.success) return validationState(parsed.error);

  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    const result = await auth.signIn(parsed.data.email, parsed.data.password);
    if (result.error || !result.userId) return authFailureState(result.error ?? { message: "missing user" });

    const { data: profile, error } = await client
      .from("profiles")
      .select("locale, onboarding_completed_at, deleting_at")
      .eq("id", result.userId)
      .maybeSingle();
    if (error || !profile) return actionFailure("UNAVAILABLE", "error.unavailable");

    if (profile.deleting_at) {
      await auth.signOutLocal();
      clearAuthCookies(await cookies());
      return actionFailure("UNAUTHENTICATED", "auth.accountDeleting");
    }

    if (profile.onboarding_completed_at) {
      try {
        await persistLocaleCookie(parseLocale(profile.locale));
      } catch {
        // A saved profile locale is canonical; cookie persistence is only a fallback.
      }
    }
    const lifecycle = profile.onboarding_completed_at ? "complete" : "provisional";
    redirect(destinationForLifecycle(lifecycle, sanitizeReturnTo(formText(formData, "returnTo"))));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function signUpAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = actionInputSchema.safeParse({
    email: formText(formData, "email"),
    password: formText(formData, "password"),
  });
  if (!parsed.success) return validationState(parsed.error);
  const password = passwordSchema.safeParse(parsed.data.password);
  if (!password.success) {
    return actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { password: "validation.passwordMin" },
    });
  }

  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    const result = await auth.signUp(parsed.data.email, password.data, getAuthCallbackUrl());
    if (result.error) {
      const errorIdentity = `${result.error.code ?? ""} ${result.error.message ?? ""}`.toLowerCase();
      if (/user_already_exists|email_exists|user already registered/.test(errorIdentity)) {
        // Keep signup responses indistinguishable for existing email addresses.
        return actionSuccess("auth.verificationPending");
      }
      return authFailureState(result.error);
    }

    if (!result.sessionCreated || !result.userId) return actionSuccess("auth.verificationPending");

    const { data: profile, error } = await client
      .from("profiles")
      .select("onboarding_completed_at")
      .eq("id", result.userId)
      .maybeSingle();
    if (error || !profile) return actionFailure("UNAVAILABLE", "error.unavailable");
    redirect(destinationForLifecycle(profile.onboarding_completed_at ? "complete" : "provisional"));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function requestRecoveryAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsedEmail = emailSchema.safeParse(formText(formData, "email"));
  if (!parsedEmail.success) {
    return actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { email: "validation.email" },
    });
  }

  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    const result = await auth.requestRecovery(parsedEmail.data, getAuthCallbackUrl());
    if (result.error) return authFailureState(result.error);
    // Supabase intentionally gives the same successful response for an unknown address.
    return actionSuccess("auth.recoverySent");
  } catch {
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}

export async function signOutAction(_formData: FormData): Promise<void> {
  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    await auth.signOutLocal();
  } catch {
    // Remove this browser's cookie session even when the Auth service is offline.
  }

  const cookieStore = await cookies();
  clearAuthCookies(cookieStore);
  redirect("/sign-in");
}

export async function updatePasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const cookieStore = await cookies();
  if (cookieStore.get("wp-recovery-flow")?.value !== "1") {
    return actionFailure("UNAUTHENTICATED", "auth.invalidRecovery");
  }

  const password = passwordSchema.safeParse(formText(formData, "password"));
  if (!password.success) {
    return actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { password: "validation.passwordMin" },
    });
  }
  if (password.data !== formText(formData, "confirm_password")) {
    return actionFailure("VALIDATION", "error.validation", {
      fieldErrors: { confirm_password: "validation.passwordMismatch" },
    });
  }

  try {
    const client = await createSupabaseServerClient();
    const auth = createAuthAdapter(client);
    const { data: claimsData, error: claimsError } = await client.auth.getClaims();
    if (claimsError || !hasRecentRecoveryProof(claimsData?.claims.amr)) {
      return actionFailure("UNAUTHENTICATED", "auth.invalidRecovery");
    }
    const { user, error: userError } = await auth.getUser();
    if (userError || !user) return actionFailure("UNAUTHENTICATED", "auth.signInRequired");
    const result = await auth.updatePassword(password.data);
    if (result.error) return authFailureState(result.error);

    await auth.signOutLocal();
    clearAuthCookies(cookieStore);
    redirect("/sign-in?notice=passwordUpdated");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return actionFailure("UNAVAILABLE", "error.unavailable");
  }
}
