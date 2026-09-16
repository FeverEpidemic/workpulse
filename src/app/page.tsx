import { redirect } from "next/navigation";

import { getRequestContext } from "@/server/auth/context";

export default async function HomePage() {
  const context = await getRequestContext();
  if (!context.user) redirect("/sign-in");
  if (!context.profile) redirect("/sign-in?notice=serviceUnavailable");
  redirect(context.profile.onboarding_completed_at ? "/dashboard" : "/onboarding/import");
}
