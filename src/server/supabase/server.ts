import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/server/supabase/database.types";
import { getSupabasePublicConfig, SupabaseConfigurationError } from "@/server/supabase/config";

/** Create a fresh cookie-bound Supabase client for each request or Server Action. */
export async function createSupabaseServerClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new SupabaseConfigurationError();

  const cookieStore = await cookies();
  return createServerClient<Database>(config.url, config.publishableKey, {
    global: {
      // Profile and career rows are private mutable data; never put Supabase
      // responses in Next's persistent Data Cache.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. The request proxy performs
          // refresh and cookie updates before a page is rendered.
        }
      },
    },
  });
}
