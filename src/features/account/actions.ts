"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createAuthAdapter } from "@/server/auth/adapter";
import { clearAuthCookies } from "@/server/auth/clear-cookies";
import { verifyAccountPassword } from "@/server/auth/reauthenticate";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

import { AccountDeletionError, createAccountDeletionService } from "./deletion-service";

function isNextRedirect(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "digest" in error &&
      typeof error.digest === "string" &&
      error.digest.startsWith("NEXT_REDIRECT;"),
  );
}

function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function buildService() {
  const client = await createSupabaseServerClient();
  const admin = getSupabaseAdminClient();
  return {
    service: createAccountDeletionService({
      client,
      admin,
      auth: createAuthAdapter(client),
      verifyPassword: (input) => verifyAccountPassword(input),
    }),
  };
}

function failure(error: unknown): ActionState {
  if (!(error instanceof AccountDeletionError)) return actionFailure("UNAVAILABLE", "error.unavailable");
  if (error.code === "INVALID_PASSWORD") {
    return actionFailure("VALIDATION", error.messageKey, { fieldErrors: { password: error.messageKey } });
  }
  if (error.code === "CONFIRMATION_MISMATCH") {
    return actionFailure("VALIDATION", error.messageKey, { fieldErrors: { confirmation: error.messageKey } });
  }
  const code: ErrorCode = error.code === "RATE_LIMITED" ? "RATE_LIMITED"
    : error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED"
    : error.code === "VALIDATION" ? "VALIDATION"
    : "UNAVAILABLE";
  return actionFailure(code, error.messageKey);
}

/** S12 "Delete account": reauthenticate, mark the account deleting, revoke every session, then leave the workspace. */
export async function deleteAccountAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const password = formText(formData, "password");
  const confirmation = formText(formData, "confirmation");
  if (password === "") {
    return actionFailure("VALIDATION", "error.validation", { fieldErrors: { password: "account.delete.error.passwordRequired" } });
  }

  try {
    const { service } = await buildService();
    await service.deleteAccount({ password, confirmation });
    clearAuthCookies(await cookies());
    redirect("/sign-in?notice=accountDeleted");
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return failure(error);
  }
}

/** Counts shown when the confirmation dialog opens. */
export async function getAccountDeletionPreviewAction(): Promise<ActionState> {
  try {
    const { service } = await buildService();
    return actionSuccess(undefined, await service.preview());
  } catch (error) {
    return failure(error);
  }
}
