import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { resolveLocale, type Locale } from "@/i18n/messages";
import type { ProfileRow } from "@/domain/database-types";
import { getSupabasePublicConfig } from "@/server/supabase/config";
import { createSupabaseServerClient } from "@/server/supabase/server";

export interface RequestContext {
  configured: boolean;
  client: Awaited<ReturnType<typeof createSupabaseServerClient>> | null;
  user: User | null;
  profile: ProfileRow | null;
  profileUnavailable: boolean;
  /** The signed-in account is being deleted: treated as signed out so no workspace page redirects in a loop. */
  accountDeleting: boolean;
}

export async function getRequestContext(): Promise<RequestContext> {
  if (!getSupabasePublicConfig()) {
    return { configured: false, client: null, user: null, profile: null, profileUnavailable: false, accountDeleting: false };
  }

  const client = await createSupabaseServerClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) {
    return { configured: true, client, user: null, profile: null, profileUnavailable: false, accountDeleting: false };
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("*")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profile?.deleting_at) {
    return { configured: true, client, user: null, profile: null, profileUnavailable: false, accountDeleting: true };
  }

  return {
    configured: true,
    client,
    user: authData.user,
    profile: profile as ProfileRow | null,
    profileUnavailable: Boolean(profileError || !profile),
    accountDeleting: false,
  };
}

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("wp-locale")?.value;
  try {
    const context = await getRequestContext();
    const profileLocale = context.profile?.onboarding_completed_at ? context.profile.locale : null;
    return resolveLocale(profileLocale, cookieLocale);
  } catch {
    return resolveLocale(null, cookieLocale);
  }
}
