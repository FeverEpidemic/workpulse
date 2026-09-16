import { sanitizeReturnTo } from "@/domain/routes/safe-return";

export type ProfileLifecycle = "anonymous" | "provisional" | "complete";

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
