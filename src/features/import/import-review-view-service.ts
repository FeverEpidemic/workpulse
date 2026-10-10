import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";

import { IMPORT_ENTITY_TYPES, IMPORT_STATUSES } from "@/domain/import/contracts";
import { IMPORT_ITEM_ACTIONS, storedCommitResultSchema } from "@/domain/import/commit-contracts";
import {
  REVIEW_PROFILE_FIELDS,
  duplicateKey,
  type ImportReviewSnapshot,
  type ReviewTargetInput,
  type ReviewTargets,
  type ReviewTargetType,
} from "@/domain/import/review-view";
import type { Database } from "@/server/supabase/database.types";

import { ImportServiceError, toImportServiceError } from "./import-errors";
import { createImportReviewService } from "./import-review-service";

type Client = SupabaseClient<Database>;

/** Owned records offered by "Map to existing", per type. */
export const REVIEW_TARGET_LIMIT = 200;

const BATCH_COLUMNS = "id, filename, status, stage, error_code, revision, commit_result, updated_at";
const ITEM_COLUMNS = "id, entity_type, ordinal, action, target_id, confirm_requested, payload, source_excerpt, revision, updated_at";
const PROFILE_COLUMNS = `onboarding_completed_at, ${REVIEW_PROFILE_FIELDS.join(", ")}`;

const batchSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  status: z.enum(IMPORT_STATUSES),
  stage: z.string(),
  error_code: z.string().nullable(),
  revision: z.number().int(),
  commit_result: z.unknown(),
  updated_at: z.string().nullable().default(null),
});

const itemSchema = z.object({
  id: z.uuid(),
  entity_type: z.enum(IMPORT_ENTITY_TYPES),
  ordinal: z.number().int(),
  action: z.enum(IMPORT_ITEM_ACTIONS),
  target_id: z.uuid().nullable(),
  confirm_requested: z.boolean(),
  payload: z.record(z.string(), z.unknown()).nullable(),
  source_excerpt: z.string().nullable(),
  revision: z.number().int(),
  updated_at: z.string().nullable().default(null),
});

const profileSchema = z.object({ onboarding_completed_at: z.string().nullable() }).catchall(z.unknown());

type TargetSource = {
  table: "experiences" | "education" | "certifications" | "skills" | "achievements";
  columns: string;
  order: string;
  label: (row: Record<string, unknown>) => string | null;
  match: (row: Record<string, unknown>) => string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const joined = (parts: string[]): string | null => {
  const kept = parts.filter((part) => part !== "");
  return kept.length > 0 ? kept.join(" · ") : null;
};

const TARGET_SOURCES: Record<ReviewTargetType, TargetSource> = {
  experience: {
    table: "experiences", columns: "id, organization, role_title, start_date, start_precision", order: "organization",
    label: (row) => joined([text(row.role_title), text(row.organization)]),
    match: (row) => duplicateKey("experience", row),
  },
  education: {
    table: "education", columns: "id, institution, qualification", order: "institution",
    label: (row) => joined([text(row.qualification), text(row.institution)]),
    match: (row) => duplicateKey("education", row),
  },
  certification: {
    table: "certifications", columns: "id, name, issuer", order: "name",
    label: (row) => joined([text(row.name), text(row.issuer)]),
    match: (row) => duplicateKey("certification", row),
  },
  skill: {
    table: "skills", columns: "id, name, normalized_name", order: "normalized_name",
    label: (row) => text(row.name) || null,
    match: () => null,
  },
  achievement: {
    table: "achievements", columns: "id, title, status", order: "title",
    label: (row) => text(row.title) || null,
    match: (row) => duplicateKey("achievement", row),
  },
};

/**
 * Read model for S03. It uses the session client only, so ownership always comes from RLS and another
 * account's batch is indistinguishable from a missing one. Nothing here writes or logs candidate text.
 */
export function createImportReviewViewService(deps: { client: Client; actorId: string }) {
  const { client, actorId } = deps;
  const review = createImportReviewService({ client });
  // The generated table types are per literal name; targets are read generically by name.
  const from = client.from.bind(client) as unknown as (table: string) => {
    select: (columns: string) => {
      order: (column: string, options?: { ascending: boolean }) => {
        limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
      };
    };
  };

  async function loadTargets(): Promise<ReviewTargets> {
    const entries = await Promise.all((Object.keys(TARGET_SOURCES) as ReviewTargetType[]).map(async (type) => {
      const source = TARGET_SOURCES[type];
      const { data, error } = await from(source.table).select(source.columns).order(source.order, { ascending: true }).limit(REVIEW_TARGET_LIMIT);
      if (error || !data) throw new ImportServiceError("UNAVAILABLE");
      const options: ReviewTargetInput[] = [];
      for (const raw of data) {
        const row = raw as Record<string, unknown>;
        const id = z.uuid().safeParse(row.id);
        const label = source.label(row);
        if (!id.success || label === null) continue;
        options.push({ id: id.data, label, match: source.match(row) });
      }
      return [type, options] as const;
    }));
    return Object.fromEntries(entries) as ReviewTargets;
  }

  return {
    async getReviewView(batchId: string): Promise<ImportReviewSnapshot> {
      try {
        if (!z.uuid().safeParse(batchId).success) throw new ImportServiceError("NOT_FOUND");
        const { data: batchRow, error: batchError } = await client.from("import_batches").select(BATCH_COLUMNS).eq("id", batchId).maybeSingle();
        if (batchError) throw new ImportServiceError("UNAVAILABLE");
        if (!batchRow) throw new ImportServiceError("NOT_FOUND");
        const batch = batchSchema.safeParse(batchRow);
        if (!batch.success) throw new ImportServiceError("UNAVAILABLE");

        const [itemsResult, profileResult] = await Promise.all([
          client.from("import_items").select(ITEM_COLUMNS).eq("batch_id", batchId).order("ordinal", { ascending: true }),
          client.from("profiles").select(PROFILE_COLUMNS).eq("id", actorId).maybeSingle(),
        ]);
        if (itemsResult.error || profileResult.error) throw new ImportServiceError("UNAVAILABLE");
        const items = z.array(itemSchema).safeParse(itemsResult.data ?? []);
        const profile = profileSchema.safeParse(profileResult.data);
        if (!items.success || !profile.success) throw new ImportServiceError("UNAVAILABLE");

        const inReview = batch.data.status === "review";
        // Options and validation only matter while the batch can still be edited.
        const [targets, errors] = inReview
          ? await Promise.all([loadTargets(), review.validate(batchId)])
          : [{ experience: [], education: [], certification: [], skill: [], achievement: [] } as ReviewTargets, []];

        const current: ImportReviewSnapshot["profile"]["current"] = {};
        for (const name of REVIEW_PROFILE_FIELDS) {
          const value = profile.data[name];
          current[name] = typeof value === "string" ? value : null;
        }
        // A stored result that no longer parses is shown without numbers rather than with invented ones.
        const stored = storedCommitResultSchema.safeParse(batch.data.commit_result);
        const activity = [batch.data.updated_at, ...items.data.map((item) => item.updated_at)]
          .flatMap((value) => (value !== null && !Number.isNaN(Date.parse(value)) ? [value] : []))
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
        return {
          batch: {
            id: batch.data.id, filename: batch.data.filename, status: batch.data.status, stage: batch.data.stage,
            error_code: batch.data.error_code, revision: batch.data.revision, commit_result: stored.success ? stored.data : null,
            last_activity_at: activity,
          },
          items: items.data.map(({ updated_at: _updatedAt, ...item }) => item),
          targets,
          errors,
          profile: { onboarded: profile.data.onboarding_completed_at !== null, current },
        };
      } catch (error) { throw toImportServiceError(error); }
    },
  };
}

export type ImportReviewViewService = ReturnType<typeof createImportReviewViewService>;
