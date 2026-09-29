"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

import { ImportServiceError } from "./import-errors";
import { createImportService } from "./import-service";

const batchFormSchema = z.object({ batch_id: z.uuid() }).strict();

function mapCode(code: ImportServiceError["code"]): ErrorCode {
  switch (code) {
    case "VALIDATION": return "VALIDATION";
    case "UNAUTHENTICATED": return "UNAUTHENTICATED";
    case "NOT_FOUND": return "NOT_FOUND";
    case "UNAVAILABLE": return "UNAVAILABLE";
    default: return "CONFLICT";
  }
}

async function run(formData: FormData, operation: "cancel" | "retry"): Promise<ActionState> {
  const raw = formData.get("batch_id");
  const parsed = batchFormSchema.safeParse({ batch_id: typeof raw === "string" ? raw : "" });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new ImportServiceError("UNAUTHENTICATED");
    const admin = getSupabaseAdminClient();
    const service = createImportService({ client, admin, storage: new SupabaseStorageAdapter(admin), actorId: data.user.id });
    const view = operation === "cancel" ? await service.cancel(parsed.data.batch_id) : await service.retry(parsed.data.batch_id);
    revalidatePath("/onboarding/import");
    return actionSuccess(operation === "cancel" ? "import.cancelled" : "import.retried", view);
  } catch (error) {
    if (!(error instanceof ImportServiceError)) return actionFailure("UNAVAILABLE", "error.unavailable");
    return actionFailure(mapCode(error.code), error.messageKey);
  }
}

/** S02 "Cancel import": queued/running/review -> cancelled; no career record exists to undo. */
export async function cancelImportAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, "cancel");
}

/** S02 "Retry": resume a transient failure on the same batch. */
export async function retryImportAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, "retry");
}
