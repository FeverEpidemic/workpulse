import { randomUUID } from "node:crypto";

import { isAuthError, isAuthRetryableFetchError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";

import {
  cvDocumentRowSchema,
  cvFreshnessRowSchema,
  cvItemRowSchema,
  removeCvItemInput,
  reorderCvSectionInput,
  resolveCvFreshnessInput,
  saveCvEditsInput,
  selectCvSourceInput,
  updateCvLayoutInput,
  type CvDocumentRow,
  type CvFreshnessRow,
  type CvItemRow,
} from "@/domain/cv/contracts";
import { buildCvOutline, type CvOutline } from "@/domain/cv/outline";
import type { Database } from "@/server/supabase/database.types";

import { CvServiceError, mapCvDatabaseError, toCvServiceError } from "./cv-errors";

type Client = SupabaseClient<Database>;
type TableRow<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);

const ensureReceiptSchema = z.object({ cv_id: z.uuid(), revision: z.number().int().min(1), created: z.boolean() });
const selectReceiptSchema = z.object({
  cv_revision: z.number().int().min(1),
  item_ids: z.array(z.uuid()),
  parent_item_ids: z.array(z.uuid()),
});
const removeReceiptSchema = z.object({ cv_revision: z.number().int().min(1), removed_item_ids: z.array(z.uuid()) });
const resolveReceiptSchema = z.object({ cv_revision: z.number().int().min(1), added_parent_item_ids: z.array(z.uuid()) });
const revisionSchema = z.number().int().min(1);

export interface CvView {
  document: CvDocumentRow;
  items: CvItemRow[];
  outline: CvOutline<CvItemRow>;
}

export interface PoolEntry<Row> {
  row: Row;
  /** True when the source already has an item on the CV. */
  selected: boolean;
}

/** Display columns only; an achievement's contribution, scope, metrics, source excerpt and activity link stay private. */
type PoolAchievement = Pick<TableRow<"achievements">, "id" | "title" | "cv_bullet" | "achieved_on" | "experience_id" | "project_id" | "revision">;

export interface CvSelectionPool {
  experience: PoolEntry<TableRow<"experiences">>[];
  projects: PoolEntry<TableRow<"projects">>[];
  achievements: PoolEntry<PoolAchievement>[];
  education: PoolEntry<TableRow<"education">>[];
  skills: PoolEntry<TableRow<"skills">>[];
  certifications: PoolEntry<TableRow<"certifications">>[];
}

const ACHIEVEMENT_COLUMNS = "id, title, cv_bullet, achieved_on, experience_id, project_id, revision";

/**
 * Master CV boundary (UI in T19). The owner always comes from the session inside the RPCs; another
 * account's source or item is indistinguishable from a missing one. Errors carry codes and ids only.
 */
export function createCvService(deps: { supabase: Client; correlationId?: string }) {
  const { supabase } = deps;
  const correlationId = deps.correlationId ?? randomUUID();
  const fail = (code: CvServiceError["code"]) => new CvServiceError(code, { correlationId });

  async function requireActorId(): Promise<string> {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (data?.user || isAuthRetryableFetchError(error)) throw fail("UNAVAILABLE");
      const unauthenticated = isAuthSessionMissingError(error) ||
        (isAuthError(error) && (error.status === 401 || error.status === 403 || (typeof error.code === "string" && INVALID_SESSION_AUTH_CODES.has(error.code))));
      throw fail(unauthenticated ? "UNAUTHENTICATED" : "UNAVAILABLE");
    }
    if (!data?.user) throw fail("UNAUTHENTICATED");
    if (!z.uuid().safeParse(data.user.id).success) throw fail("UNAVAILABLE");
    return data.user.id;
  }

  async function read<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
    const { data, error } = await query;
    if (error) throw fail("UNAVAILABLE");
    return data;
  }

  function first(data: unknown): unknown {
    return Array.isArray(data) ? data[0] : data;
  }

  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw toCvServiceError(error, correlationId);
    }
  }

  return {
    /** First open: one CV per account, also when opened concurrently. */
    ensure(): Promise<{ cvId: string; revision: number; created: boolean }> {
      return guarded(async () => {
        await requireActorId();
        const { data, error } = await supabase.rpc("ensure_cv_document");
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = ensureReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { cvId: receipt.data.cv_id, revision: receipt.data.revision, created: receipt.data.created };
      });
    },

    /** The CV document, its items in section/position order, and the render outline; null before the first open. */
    getCv(): Promise<CvView | null> {
      return guarded(async () => {
        const actorId = await requireActorId();
        const document = await read(supabase.from("cv_documents").select("*").eq("user_id", actorId).maybeSingle());
        if (!document) return null;
        const parsedDocument = cvDocumentRowSchema.safeParse(document);
        if (!parsedDocument.success) throw fail("UNAVAILABLE");
        const rows = await read(
          supabase.from("cv_items").select("*").eq("user_id", actorId).order("section_key").order("position"),
        );
        const parsedItems = z.array(cvItemRowSchema).safeParse(rows ?? []);
        if (!parsedItems.success) throw fail("UNAVAILABLE");
        const outline = buildCvOutline({ sectionOrder: parsedDocument.data.section_order, items: parsedItems.data });
        return { document: parsedDocument.data, items: parsedItems.data, outline };
      });
    },

    /** Everything the user may select: all career records, but only confirmed achievements. */
    getSelectionPool(): Promise<CvSelectionPool> {
      return guarded(async () => {
        const actorId = await requireActorId();
        const items = (await read(
          supabase
            .from("cv_items")
            .select("experience_id, project_id, achievement_id, education_id, skill_id, certification_id")
            .eq("user_id", actorId),
        )) ?? [];
        const selected = (column: "experience_id" | "project_id" | "achievement_id" | "education_id" | "skill_id" | "certification_id") =>
          new Set(items.map((item) => item[column]).filter((id): id is string => typeof id === "string"));
        const pool = <Row extends { id: string }>(rows: Row[] | null, ids: Set<string>): PoolEntry<Row>[] =>
          (rows ?? []).map((row) => ({ row, selected: ids.has(row.id) }));

        const [experiences, projects, achievements, education, skills, certifications] = await Promise.all([
          read(supabase.from("experiences").select("*").eq("user_id", actorId).order("id")),
          read(supabase.from("projects").select("*").eq("user_id", actorId).order("id")),
          read(supabase.from("achievements").select(ACHIEVEMENT_COLUMNS).eq("user_id", actorId).eq("status", "confirmed").order("id")),
          read(supabase.from("education").select("*").eq("user_id", actorId).order("id")),
          read(supabase.from("skills").select("*").eq("user_id", actorId).order("id")),
          read(supabase.from("certifications").select("*").eq("user_id", actorId).order("id")),
        ]);
        return {
          experience: pool(experiences, selected("experience_id")),
          projects: pool(projects, selected("project_id")),
          achievements: pool(achievements as PoolAchievement[] | null, selected("achievement_id")),
          education: pool(education, selected("education_id")),
          skills: pool(skills, selected("skill_id")),
          certifications: pool(certifications, selected("certification_id")),
        };
      });
    },

    /** Add a source; an achievement adds its required parent in the same transaction. */
    select(input: unknown): Promise<{ cvRevision: number; itemIds: string[]; parentItemIds: string[] }> {
      return guarded(async () => {
        const parsed = selectCvSourceInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("select_cv_source", {
          p_expected_revision: parsed.data.expected_revision,
          p_source_type: parsed.data.source_type,
          p_source_id: parsed.data.source_id,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = selectReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { cvRevision: receipt.data.cv_revision, itemIds: receipt.data.item_ids, parentItemIds: receipt.data.parent_item_ids };
      });
    },

    /** Remove an item; a parent with child achievements needs an explicit remove_children decision. */
    remove(input: unknown): Promise<{ cvRevision: number; removedItemIds: string[] }> {
      return guarded(async () => {
        const parsed = removeCvItemInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("remove_cv_item", {
          p_expected_revision: parsed.data.expected_revision,
          p_item_id: parsed.data.item_id,
          p_remove_children: parsed.data.remove_children,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = removeReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { cvRevision: receipt.data.cv_revision, removedItemIds: receipt.data.removed_item_ids };
      });
    },

    /** Rewrite the order of one section; the ids must be exactly the section's current items. */
    reorder(input: unknown): Promise<{ cvRevision: number }> {
      return guarded(async () => {
        const parsed = reorderCvSectionInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("reorder_cv_section", {
          p_expected_revision: parsed.data.expected_revision,
          p_section_key: parsed.data.section_key,
          p_item_ids: parsed.data.item_ids,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const revision = revisionSchema.safeParse(data);
        if (!revision.success) throw fail("UNAVAILABLE");
        return { cvRevision: revision.data };
      });
    },

    /**
     * Save title, summary, profile display values and item wording together with one revision step.
     * Nothing here touches the source snapshot or the canonical records; null or blank clears an override.
     */
    saveEdits(input: unknown): Promise<{ cvRevision: number }> {
      return guarded(async () => {
        const parsed = saveCvEditsInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { expected_revision: expectedRevision, ...edits } = parsed.data;
        const { data, error } = await supabase.rpc("save_cv_edits", { p_expected_revision: expectedRevision, p_edits: edits });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const revision = revisionSchema.safeParse(data);
        if (!revision.success) throw fail("UNAVAILABLE");
        return { cvRevision: revision.data };
      });
    },

    /**
     * Freshness of every item and of the CV profile, computed in the database from live source revisions.
     * Reading never writes; the live snapshots carry display fields only.
     */
    getFreshness(): Promise<CvFreshnessRow[]> {
      return guarded(async () => {
        await requireActorId();
        const { data, error } = await supabase.rpc("get_cv_freshness");
        if (error) throw fail("UNAVAILABLE");
        const rows = z.array(cvFreshnessRowSchema).safeParse(data ?? []);
        if (!rows.success) throw fail("UNAVAILABLE");
        return rows.data;
      });
    },

    /**
     * Keep, refresh or replace changed sources in one transaction and one revision step. Refresh never
     * touches wording overrides; replace is the only action that clears them.
     */
    resolveFreshness(input: unknown): Promise<{ cvRevision: number; addedParentItemIds: string[] }> {
      return guarded(async () => {
        const parsed = resolveCvFreshnessInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("resolve_cv_freshness", {
          p_expected_revision: parsed.data.expected_revision,
          p_resolutions: parsed.data.resolutions,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = resolveReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { cvRevision: receipt.data.cv_revision, addedParentItemIds: receipt.data.added_parent_item_ids };
      });
    },

    /** Set the label locale and/or the section order. Never translates source content. */
    updateLayout(input: unknown): Promise<{ cvRevision: number }> {
      return guarded(async () => {
        const parsed = updateCvLayoutInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("update_cv_layout", {
          p_expected_revision: parsed.data.expected_revision,
          p_locale: (parsed.data.locale ?? null) as never,
          p_section_order: (parsed.data.section_order ?? null) as never,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const revision = revisionSchema.safeParse(data);
        if (!revision.success) throw fail("UNAVAILABLE");
        return { cvRevision: revision.data };
      });
    },
  };
}

export type CvService = ReturnType<typeof createCvService>;
