export type RootDestination = { kind: "landing" } | { kind: "redirect"; to: string };

/** T32: guests get the landing page at `/`; a signed-in account keeps its old redirects. */
export function rootDestination(context: {
  user: unknown;
  profile: { onboarding_completed_at: string | null } | null;
}): RootDestination {
  if (!context.user) return { kind: "landing" };
  if (!context.profile) return { kind: "redirect", to: "/sign-in?notice=serviceUnavailable" };
  return { kind: "redirect", to: context.profile.onboarding_completed_at ? "/dashboard" : "/onboarding/import" };
}
