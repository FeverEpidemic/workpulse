import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";

import {
  commitImportInput,
  commitResultSchema,
  toItemErrors,
  updateImportItemInput,
  type ImportCommitResult,
  type ImportItemError,
} from "@/domain/import/commit-contracts";
import type { Database } from "@/server/supabase/database.types";

import { ImportServiceError, mapImportDatabaseError, toImportServiceError } from "./import-errors";

type Client = SupabaseClient<Database>;

const updateReceiptSchema = z.object({
  item_id: z.uuid(),
  item_revision: z.number().int(),
  batch_revision: z.number().int(),
});

export type ImportItemUpdate = { itemId: string; itemRevision: number; batchRevision: number };

/**
 * Review and commit boundary for S03 (UI in T17). The owner always comes from the session inside the
 * RPCs; another account's batch or item is indistinguishable from a missing one. Errors carry codes and
 * ids only, never candidate text.
 */
export function createImportReviewService(deps: { client: Client }) {
  const { client } = deps;

  return {
    /** Persist one review choice (action, map target, payload patch, confirm request). */
    async updateItem(input: unknown): Promise<ImportItemUpdate> {
      try {
        const parsed = updateImportItemInput.safeParse(input);
        if (!parsed.success) throw new ImportServiceError("VALIDATION");
        const { data, error } = await client.rpc("update_import_item", {
          p_item_id: parsed.data.item_id,
          p_expected_revision: parsed.data.expected_revision,
          p_action: parsed.data.action ?? (null as never),
          p_target_id: parsed.data.target_id ?? (null as never),
          p_payload_patch: (parsed.data.payload_patch ?? null) as never,
          p_confirm_requested: parsed.data.confirm_requested ?? (null as never),
        });
        if (error) throw mapImportDatabaseError(error);
        const receipt = updateReceiptSchema.safeParse(Array.isArray(data) ? data[0] : data);
        if (!receipt.success) throw new ImportServiceError("UNAVAILABLE");
        return { itemId: receipt.data.item_id, itemRevision: receipt.data.item_revision, batchRevision: receipt.data.batch_revision };
      } catch (error) { throw toImportServiceError(error); }
    },

    /** Dry-run of the commit validation for the selected items. */
    async validate(batchId: string): Promise<ImportItemError[]> {
      try {
        if (!z.uuid().safeParse(batchId).success) throw new ImportServiceError("NOT_FOUND");
        const { data, error } = await client.rpc("validate_import_batch", { p_batch_id: batchId });
        if (error) throw mapImportDatabaseError(error);
        const errors = toItemErrors(data ?? []);
        if (!errors) throw new ImportServiceError("UNAVAILABLE");
        return errors;
      } catch (error) { throw toImportServiceError(error); }
    },

    /** Atomic, idempotent commit. A repeated call returns the first result. */
    async commit(input: unknown): Promise<ImportCommitResult> {
      try {
        const parsed = commitImportInput.safeParse(input);
        if (!parsed.success) throw new ImportServiceError("VALIDATION");
        const { data, error } = await client.rpc("commit_import_batch", {
          p_batch_id: parsed.data.batch_id,
          p_expected_revision: parsed.data.expected_revision,
          p_onboarding: (parsed.data.onboarding ?? null) as never,
        });
        if (error) throw mapImportDatabaseError(error);
        const result = commitResultSchema.safeParse(data);
        if (!result.success) throw new ImportServiceError("UNAVAILABLE");
        return result.data;
      } catch (error) { throw toImportServiceError(error); }
    },
  };
}

export type ImportReviewService = ReturnType<typeof createImportReviewService>;
