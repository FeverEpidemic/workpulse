import { sanitizeReturnTo } from "@/domain/routes/safe-return";

export type ProfileLifecycle = "anonymous" | "provisional" | "complete";
export type SignInMode = "sign-in" | "create-account";

/** T32: landing CTAs link to `/sign-in?mode=create-account`; any other value opens sign-in. */
export function signInModeFromQuery(value: unknown): SignInMode {
  return value === "create-account" ? "create-account" : "sign-in";
}

export function destinationForLifecycle(
  lifecycle: ProfileLifecycle,
  returnTo?: string | null,
): string {
  if (lifecycle === "anonymous") {
    const next = sanitizeReturnTo(returnTo);
    return next === "/dashboard" ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(next)}`;
  }

  if (lifecycle === "provisional") return "/onboarding/import";
  return sanitizeReturnTo(returnTo);
}
