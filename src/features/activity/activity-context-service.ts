import * as z from "zod";

import type { ActivityContextOptions } from "@/domain/activity/activity-display";
import type { Database } from "@/server/supabase/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";

export class ActivityContextServiceError extends Error {
  constructor() {
    super("Activity context options are unavailable.");
    this.name = "ActivityContextServiceError";
  }
}

/** Read only the minimum context fields needed by Activity capture and labels. */
export async function listActivityContextOptions(
  client: SupabaseClient<Database>,
  ownerId: string,
): Promise<ActivityContextOptions> {
  if (!z.uuid().safeParse(ownerId).success) throw new ActivityContextServiceError();

  try {
    const [experienceResult, projectResult] = await Promise.all([
      client
        .from("experiences")
        .select("id, organization, role_title")
        .eq("user_id", ownerId)
        .order("organization", { ascending: true })
        .order("role_title", { ascending: true })
        .order("id", { ascending: true }),
      client
        .from("projects")
        .select("id, title, experience_id")
        .eq("user_id", ownerId)
        .order("title", { ascending: true })
        .order("id", { ascending: true }),
    ]);

    if (experienceResult.error || projectResult.error) throw new ActivityContextServiceError();

    return {
      experiences: experienceResult.data ?? [],
      projects: projectResult.data ?? [],
    };
  } catch {
    throw new ActivityContextServiceError();
  }
}
