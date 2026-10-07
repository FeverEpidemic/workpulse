import { randomUUID } from "node:crypto";

import { isAuthError, isAuthRetryableFetchError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";

import {
  CV_EXPORT_STATUSES,
  cvExportReadinessSchema,
  cvExportRowSchema,
  downloadCvExportInput,
  requestCvExportInput,
  retryCvExportInput,
  type CvExportReadiness,
  type CvExportRow,
} from "@/domain/cv/contracts";
import { CV_EXPORT_DOWNLOAD_TTL_SECONDS } from "@/domain/cv/export";
import { exportDownloadName } from "@/domain/cv/export-view";
import type { Database } from "@/server/supabase/database.types";
import type { SignedDownloadOptions } from "@/server/storage/adapter";
import { parseStorageObjectKey } from "@/server/storage/object-key";
import type { PrivateStorageService } from "@/server/storage/private-storage-service";

import { CvServiceError, mapCvDatabaseError, toCvServiceError } from "./cv-errors";

type Client = SupabaseClient<Database>;

const INVALID_SESSION_AUTH_CODES = new Set(["bad_jwt", "invalid_jwt", "no_authorization", "session_expired", "session_not_found"]);

/** Safe columns only: never the snapshot, the attempt token, the lease, the object key or the idempotency key. */
const EXPORT_COLUMNS =
  "id, cv_id, cv_revision, status, error_code, attempt_count, page_count, byte_size, started_at, finished_at, expires_at, purged_at, created_at, updated_at, revision";
const LIST_LIMIT = 10;

const requestReceiptSchema = z.object({
  export_id: z.uuid(),
  status: z.enum(CV_EXPORT_STATUSES),
  cv_revision: z.number().int().min(1),
  reused: z.boolean(),
});
const retryReceiptSchema = z.object({
  export_id: z.uuid(),
  status: z.enum(CV_EXPORT_STATUSES),
  attempt_count: z.number().int().min(0).max(3),
});

/**
 * Export boundary (UI in T22). The owner always comes from the session inside the RPCs; another account's export is
 * indistinguishable from a missing one. Errors carry codes and ids only; the object key never leaves the server.
 * The storage service is built only when a download is requested.
 */
export function createCvExportService(deps: { supabase: Client; getStorage: () => PrivateStorageService; correlationId?: string }) {
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

  /** The caller's own export row (RLS plus an explicit owner filter), strictly parsed so no private column passes. */
  async function readExport(exportId: string, actorId: string): Promise<CvExportRow | null> {
    const { data, error } = await supabase.from("cv_exports").select(EXPORT_COLUMNS).eq("id", exportId).eq("user_id", actorId).limit(1);
    if (error) throw fail("UNAVAILABLE");
    const row = (data ?? [])[0];
    if (row === undefined) return null;
    const parsed = cvExportRowSchema.safeParse(row);
    if (!parsed.success) throw fail("UNAVAILABLE");
    return parsed.data;
  }

  /** The generic attachment name from finished_at; never fails the download: any trouble gives the undated name. */
  async function attachmentName(exportId: string, actorId: string): Promise<string> {
    try {
      return exportDownloadName((await readExport(exportId, actorId))?.finished_at);
    } catch {
      return exportDownloadName(null);
    }
  }

  return {
    /** Whether the saved CV can be exported now, with the blockers (codes and item ids) when it cannot. */
    getReadiness(): Promise<CvExportReadiness> {
      return guarded(async () => {
        await requireActorId();
        const { data, error } = await supabase.rpc("get_cv_export_readiness");
        if (error) throw fail("UNAVAILABLE");
        const row = first(data);
        // No row means the account cannot use the CV (no session or deleting).
        if (row === undefined || row === null) throw fail("UNAUTHENTICATED");
        const parsed = cvExportReadinessSchema.safeParse(row);
        if (!parsed.success) throw fail("UNAVAILABLE");
        return parsed.data;
      });
    },

    /** The caller's latest exports (at most ten, newest first) with the safe columns only. */
    listExports(limit: number = LIST_LIMIT): Promise<CvExportRow[]> {
      return guarded(async () => {
        const actorId = await requireActorId();
        const count = Math.max(1, Math.min(Number.isFinite(limit) ? Math.trunc(limit) : LIST_LIMIT, LIST_LIMIT));
        const { data, error } = await supabase
          .from("cv_exports")
          .select(EXPORT_COLUMNS)
          .eq("user_id", actorId)
          .order("created_at", { ascending: false })
          .limit(count);
        if (error) throw fail("UNAVAILABLE");
        const rows = z.array(cvExportRowSchema).safeParse(data ?? []);
        if (!rows.success) throw fail("UNAVAILABLE");
        return rows.data;
      });
    },

    /** Validates the saved CV and queues an export bound to an immutable snapshot (idempotent per key and revision). */
    requestExport(input: unknown): Promise<{ exportId: string; status: z.infer<typeof requestReceiptSchema>["status"]; cvRevision: number; reused: boolean }> {
      return guarded(async () => {
        const parsed = requestCvExportInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("request_cv_export", {
          p_expected_revision: parsed.data.expected_revision,
          p_idempotency_key: parsed.data.idempotency_key,
        });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = requestReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { exportId: receipt.data.export_id, status: receipt.data.status, cvRevision: receipt.data.cv_revision, reused: receipt.data.reused };
      });
    },

    /** Explicit retry of a failed export with the same snapshot (at most three attempts). */
    retryExport(input: unknown): Promise<{ exportId: string; status: z.infer<typeof retryReceiptSchema>["status"]; attemptCount: number }> {
      return guarded(async () => {
        const parsed = retryCvExportInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        await requireActorId();
        const { data, error } = await supabase.rpc("retry_cv_export", { p_export_id: parsed.data.export_id });
        if (error) throw mapCvDatabaseError(error, correlationId);
        const receipt = retryReceiptSchema.safeParse(first(data));
        if (!receipt.success) throw fail("UNAVAILABLE");
        return { exportId: receipt.data.export_id, status: receipt.data.status, attemptCount: receipt.data.attempt_count };
      });
    },

    /** One export of the caller (safe columns only); null for an id that is not a UUID, a foreign export or none. */
    getExport(id: string): Promise<CvExportRow | null> {
      return guarded(async () => {
        const exportId = z.uuid().safeParse(id);
        if (!exportId.success) return null;
        return readExport(exportId.data, await requireActorId());
      });
    },

    /**
     * A signed URL (at most 300 seconds) for a finished, unexpired export of the caller. An attachment is named
     * `WorkPulse-CV-<UTC day>.pdf`; an inline URL (S14 page rendering) carries no name and no download header.
     */
    issueDownload(input: unknown): Promise<{ url: string; expiresInSeconds: number }> {
      return guarded(async () => {
        const parsed = downloadCvExportInput.safeParse(input);
        if (!parsed.success) throw fail("VALIDATION");
        const actorId = await requireActorId();
        const { data, error } = await supabase.rpc("get_cv_export_download", { p_export_id: parsed.data.export_id });
        if (error) throw mapCvDatabaseError(error, correlationId);
        // The key is server-only. It must be an export object of the caller; anything else is a server fault.
        const key = parseStorageObjectKey(data);
        if (!key || key.category !== "export" || key.ownerId !== actorId) throw fail("UNAVAILABLE");
        const options: SignedDownloadOptions = parsed.data.disposition === "inline"
          ? { disposition: "inline" }
          : { disposition: "attachment", filename: await attachmentName(parsed.data.export_id, actorId) };
        let issued: { url: string; expiresInSeconds: number };
        try {
          issued = await deps.getStorage().issueDownload(`${key.ownerId}/${key.category}/${key.objectId}`, CV_EXPORT_DOWNLOAD_TTL_SECONDS, options);
        } catch {
          throw fail("UNAVAILABLE");
        }
        return { url: issued.url, expiresInSeconds: issued.expiresInSeconds };
      });
    },
  };
}

export type CvExportService = ReturnType<typeof createCvExportService>;
