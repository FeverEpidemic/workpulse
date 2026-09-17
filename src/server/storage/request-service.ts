import "server-only";

import { getRequestContext } from "@/server/auth/context";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { PrivateStorageError, createPrivateStorageService } from "@/server/storage/private-storage-service";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

/** Bind storage authorization to the signed-in session; never accept a client owner ID. */
export function createRequestPrivateStorageService() {
  let adapter: SupabaseStorageAdapter;
  try {
    adapter = new SupabaseStorageAdapter(getSupabaseAdminClient());
  } catch {
    throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE");
  }

  return createPrivateStorageService(adapter, async () => {
    const context = await getRequestContext();
    return context.user ? { id: context.user.id } : null;
  });
}
