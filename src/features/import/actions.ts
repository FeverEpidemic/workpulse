"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { commitImportInput, updateImportItemInput } from "@/domain/import/commit-contracts";
import { actionFailure, actionSuccess, type ActionState, type ErrorCode } from "@/server/action-result";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { getSupabaseAdminClient } from "@/server/supabase/admin";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

import { ImportServiceError } from "./import-errors";
import { createImportReviewService } from "./import-review-service";
import { createImportService } from "./import-service";

const batchFormSchema = z.object({ batch_id: z.uuid() }).strict();

function mapCode(code: ImportServiceError["code"]): ErrorCode {
  switch (code) {
    case "VALIDATION":
    case "ITEM_INVALID":
    case "TARGET_INVALID":
    case "ONBOARDING_REQUIRED":
    case "ONBOARDING_INVALID": return "VALIDATION";
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

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function failure(error: unknown): ActionState {
  if (!(error instanceof ImportServiceError)) return actionFailure("UNAVAILABLE", "error.unavailable");
  const details = error.code === "ITEM_INVALID" ? { latestRecord: { itemErrors: error.itemErrors } } : {};
  return actionFailure(mapCode(error.code), error.messageKey, details);
}

async function reviewService() {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ImportServiceError("UNAUTHENTICATED");
  return createImportReviewService({ client });
}

/** S03 review choice (T17 renders it): one persisted, revision-guarded change of a candidate. */
export async function updateImportItemAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let patch: unknown;
  try {
    const raw = text(formData, "payload_patch");
    patch = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return actionFailure("VALIDATION", "error.validation");
  }
  const confirm = text(formData, "confirm_requested");
  const parsed = updateImportItemInput.safeParse({
    item_id: text(formData, "item_id"),
    expected_revision: Number(text(formData, "expected_revision")),
    action: text(formData, "action"),
    target_id: text(formData, "target_id"),
    payload_patch: patch,
    confirm_requested: confirm === undefined ? undefined : confirm === "true" ? true : confirm === "false" ? false : confirm,
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const service = await reviewService();
    const update = await service.updateItem(parsed.data);
    return actionSuccess("import.review.saved", update);
  } catch (error) {
    return failure(error);
  }
}

/** S03: dry-run of the commit validation; returns item ids, fields and codes only. */
export async function validateImportAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = batchFormSchema.safeParse({ batch_id: text(formData, "batch_id") ?? "" });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const service = await reviewService();
    return actionSuccess(undefined, await service.validate(parsed.data.batch_id));
  } catch (error) {
    return failure(error);
  }
}

/** S03 "Confirm import": one atomic commit; a repeated submit returns the first result. */
export async function commitImportAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const displayName = text(formData, "onboarding_display_name");
  const locale = text(formData, "onboarding_locale");
  const timezone = text(formData, "onboarding_timezone");
  const parsed = commitImportInput.safeParse({
    batch_id: text(formData, "batch_id"),
    expected_revision: Number(text(formData, "expected_revision")),
    onboarding: displayName === undefined && locale === undefined && timezone === undefined
      ? undefined
      : { display_name: displayName, locale, timezone },
  });
  if (!parsed.success) return actionFailure("VALIDATION", "error.validation");
  try {
    const service = await reviewService();
    const result = await service.commit(parsed.data);
    revalidatePath("/dashboard");
    revalidatePath("/timeline");
    revalidatePath("/settings/profile");
    return actionSuccess("import.committed", result);
  } catch (error) {
    return failure(error);
  }
}
