import type { ActionState, ErrorCode } from "@/server/action-result";
import { actionFailure } from "@/server/action-result";

export interface AuthErrorShape {
  status?: number;
  code?: string;
  message?: string;
}

export interface MappedAuthError {
  code: ErrorCode;
  messageKey:
    | "auth.invalidCredentials"
    | "auth.verificationPending"
    | "auth.rateLimited"
    | "error.validation"
    | "error.unavailable";
}

export function mapSupabaseAuthError(error: AuthErrorShape): MappedAuthError {
  const code = error.code?.toLowerCase() ?? "";
  const message = error.message?.toLowerCase() ?? "";

  if (error.status === 429 || /rate.?limit|too many|over_email_send_rate_limit/.test(`${code} ${message}`)) {
    return { code: "RATE_LIMITED", messageKey: "auth.rateLimited" };
  }
  if (/email_not_confirmed|email not confirmed/.test(`${code} ${message}`)) {
    return { code: "UNAUTHENTICATED", messageKey: "auth.verificationPending" };
  }
  // Auth checks the ban before the password, so a banned account looks the same as a wrong password.
  if (/invalid_credentials|invalid login credentials|invalid password|user_banned|user is banned/.test(`${code} ${message}`)) {
    return { code: "UNAUTHENTICATED", messageKey: "auth.invalidCredentials" };
  }
  if (/weak_password|password should be|password is too/.test(`${code} ${message}`)) {
    return { code: "VALIDATION", messageKey: "error.validation" };
  }
  return { code: "UNAVAILABLE", messageKey: "error.unavailable" };
}

export function authFailureState(error: AuthErrorShape): ActionState {
  const mapped = mapSupabaseAuthError(error);
  return actionFailure(mapped.code, mapped.messageKey);
}
