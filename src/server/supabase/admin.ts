import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, SupabaseConfigurationError } from "@/server/supabase/config";

let adminClient: SupabaseClient<Database> | null = null;

/** Reuse one privileged, non-persistent client on the server only. */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (adminClient) return adminClient;

  const config = getSupabaseAdminConfig();
  if (!config) throw new SupabaseConfigurationError();

  adminClient = createClient<Database>(config.url, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  return adminClient;
}
