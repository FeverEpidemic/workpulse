import type { SupabaseClient } from "@supabase/supabase-js";
import * as z from "zod";

import {
  IMPORT_ENTITY_TYPES,
  IMPORT_MAX_BYTES,
  IMPORT_MIME_TYPES,
  ImportFileError,
  type ImportEntityType,
} from "@/domain/import/contracts";
import { toImportView, type ImportBatchRow, type ImportView } from "@/domain/import/import-view";
import { AI_CONSENT_VERSION } from "@/domain/ai/contracts";
import { EvidenceFileValidationError, readBoundedBody, sha256Hex } from "@/features/evidence/file-inspection";
import { inspectImportBytes } from "@/server/documents/import-file-inspection";
import { StorageObjectAlreadyExistsError, type StorageAdapter } from "@/server/storage/adapter";
import type { Database } from "@/server/supabase/database.types";

import { ImportServiceError, mapImportDatabaseError, toImportServiceError } from "./import-errors";

type Client = SupabaseClient<Database>;

const BATCH_COLUMNS = "id, filename, status, stage, error_code, retry_count, page_count, expires_at, purged_at, created_at, revision, sha256";

const batchRowSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  status: z.enum(["queued", "running", "review", "committed", "failed", "cancelled"]),
  stage: z.enum(["uploading", "screening", "parsing", "extracting", "done"]),
  error_code: z.string().nullable(),
  retry_count: z.number().int(),
  page_count: z.number().int().nullable(),
  expires_at: z.string().nullable(),
  purged_at: z.string().nullable(),
  created_at: z.string(),
  revision: z.number().int(),
  sha256: z.string(),
});

const beginReceiptSchema = z.object({
  batch_id: z.uuid(),
  status: z.string(),
  stage: z.string(),
  file_key: z.string().nullable(),
});

export type ImportUploadRequest = {
  idempotencyKey: string | null;
  filename: string | null;
  contentType: string | null;
  contentLength: string | null;
  body: ReadableStream<Uint8Array> | null;
};

export type ImportServiceDependencies = {
  /** Session-scoped client: owner comes from auth.uid() in every RPC. */
  client: Client;
  /** Service client for finalize only; never exposed to the browser. */
  admin: Client;
  storage: StorageAdapter;
  actorId: string;
};

function cleanFilename(raw: string | null): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw ?? "");
  } catch {
    throw new ImportServiceError("VALIDATION");
  }
  // Keep only the base name; the path a browser may send is irrelevant and never stored.
  const base = decoded.split(/[\\/]/).pop() ?? "";
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (name.length < 1 || name.length > 255) throw new ImportServiceError("VALIDATION");
  return name;
}

function inspectionError(error: unknown): ImportServiceError {
  if (error instanceof ImportFileError) {
    switch (error.code) {
      case "FILE_EMPTY":
      case "FILE_TOO_LARGE":
      case "UNSUPPORTED_FORMAT":
      case "ENCRYPTED_FILE":
      case "CORRUPT_FILE":
        return new ImportServiceError(error.code);
      default:
        return new ImportServiceError("UNSUPPORTED_FORMAT");
    }
  }
  if (error instanceof EvidenceFileValidationError) {
    if (error.code === "FILE_TOO_LARGE") return new ImportServiceError("FILE_TOO_LARGE");
    if (error.code === "FILE_TYPE_INVALID") return new ImportServiceError("UNSUPPORTED_FORMAT");
    return new ImportServiceError("UPLOAD_INCOMPLETE");
  }
  return new ImportServiceError("UPLOAD_INCOMPLETE");
}

export function createImportService(deps: ImportServiceDependencies) {
  const { client, admin, storage, actorId } = deps;

  async function consent(): Promise<boolean> {
    const { data, error } = await client.from("profiles").select("ai_consent_at, ai_consent_version").eq("id", actorId).maybeSingle();
    if (error) throw new ImportServiceError("UNAVAILABLE");
    return Boolean(data?.ai_consent_at && data.ai_consent_version === AI_CONSENT_VERSION);
  }

  async function viewFor(row: z.infer<typeof batchRowSchema> | null): Promise<ImportView> {
    const hasConsent = await consent();
    if (!row) return toImportView({ batch: null, consent: hasConsent });
    const counts: Partial<Record<ImportEntityType, number>> = {};
    const { data: items, error: itemsError } = await client.from("import_items").select("entity_type").eq("batch_id", row.id);
    if (itemsError) throw new ImportServiceError("UNAVAILABLE");
    for (const item of items ?? []) {
      if ((IMPORT_ENTITY_TYPES as readonly string[]).includes(item.entity_type)) {
        const type = item.entity_type as ImportEntityType;
        counts[type] = (counts[type] ?? 0) + 1;
      }
    }
    const { data: previous, error: previousError } = await client.from("import_batches")
      .select("created_at, status")
      .eq("sha256", row.sha256)
      .neq("id", row.id)
      .lte("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(1);
    if (previousError) throw new ImportServiceError("UNAVAILABLE");
    const duplicate = previous?.[0] ? { createdAt: previous[0].created_at, status: previous[0].status } : null;
    const batch: ImportBatchRow = { ...row };
    return toImportView({ batch, counts, consent: hasConsent, duplicate });
  }

  async function loadBatch(batchId: string) {
    if (!z.uuid().safeParse(batchId).success) throw new ImportServiceError("NOT_FOUND");
    const { data, error } = await client.from("import_batches").select(BATCH_COLUMNS).eq("id", batchId).maybeSingle();
    if (error) throw new ImportServiceError("UNAVAILABLE");
    if (!data) throw new ImportServiceError("NOT_FOUND");
    const parsed = batchRowSchema.safeParse(data);
    if (!parsed.success) throw new ImportServiceError("UNAVAILABLE");
    return parsed.data;
  }

  return {
    async getView(batchId: string): Promise<ImportView> {
      try {
        return await viewFor(await loadBatch(batchId));
      } catch (error) { throw toImportServiceError(error); }
    },

    /** Latest batch the user can still act on (leave-return), or the chooser. */
    async getActiveView(): Promise<ImportView> {
      try {
        const { data, error } = await client.from("import_batches")
          .select(BATCH_COLUMNS)
          .or("status.in.(queued,running,review),and(status.eq.failed,purged_at.is.null)")
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw new ImportServiceError("UNAVAILABLE");
        const parsed = data?.[0] ? batchRowSchema.safeParse(data[0]) : null;
        if (parsed && !parsed.success) throw new ImportServiceError("UNAVAILABLE");
        return await viewFor(parsed ? parsed.data : null);
      } catch (error) { throw toImportServiceError(error); }
    },

    async upload(request: ImportUploadRequest): Promise<ImportView> {
      try {
        const key = z.uuid().safeParse(request.idempotencyKey ?? "");
        if (!key.success) throw new ImportServiceError("VALIDATION");
        const filename = cleanFilename(request.filename);
        const contentType = (request.contentType ?? "").split(";")[0]!.trim();
        if (!(IMPORT_MIME_TYPES as readonly string[]).includes(contentType)) throw new ImportServiceError("UNSUPPORTED_FORMAT");
        const length = Number(request.contentLength);
        if (!Number.isSafeInteger(length) || length < 0) throw new ImportServiceError("UPLOAD_INCOMPLETE");
        if (length === 0) throw new ImportServiceError("FILE_EMPTY");
        if (length > IMPORT_MAX_BYTES) throw new ImportServiceError("FILE_TOO_LARGE");

        let bytes: Buffer;
        let mime: string;
        try {
          bytes = await readBoundedBody(request.body, length);
          mime = inspectImportBytes(bytes);
        } catch (error) {
          throw inspectionError(error);
        }
        if (mime !== contentType) throw new ImportServiceError("FILE_TYPE_MISMATCH");
        const sha256 = sha256Hex(bytes);

        const { data, error } = await client.rpc("begin_import_batch", {
          p_idempotency_key: key.data, p_filename: filename, p_bytes: bytes.length, p_mime_type: mime, p_sha256: sha256,
        });
        if (error) throw mapImportDatabaseError(error);
        const receipt = beginReceiptSchema.safeParse(Array.isArray(data) ? data[0] : data);
        if (!receipt.success) throw new ImportServiceError("UNAVAILABLE");

        if (receipt.data.status === "queued" && receipt.data.stage === "uploading") {
          if (!receipt.data.file_key) throw new ImportServiceError("UNAVAILABLE");
          try {
            await storage.uploadObject(receipt.data.file_key, bytes, { contentType: mime, metadata: { sha256 } });
          } catch (uploadError) {
            if (!(uploadError instanceof StorageObjectAlreadyExistsError)) throw new ImportServiceError("UNAVAILABLE");
            // A replay after a lost response: the immutable object must be the same bytes.
            const metadata = await storage.getObjectMetadata(receipt.data.file_key) as
              { size?: number; contentType?: string; customMetadata?: { sha256?: string } } | null;
            if (metadata?.size !== bytes.length || metadata.customMetadata?.sha256 !== sha256) {
              throw new ImportServiceError("CONFLICT");
            }
          }
          const { error: finalizeError } = await admin.rpc("finalize_import_upload", { p_user_id: actorId, p_batch_id: receipt.data.batch_id });
          if (finalizeError) throw mapImportDatabaseError(finalizeError);
        }
        return await viewFor(await loadBatch(receipt.data.batch_id));
      } catch (error) { throw toImportServiceError(error); }
    },

    async cancel(batchId: string): Promise<ImportView> {
      try {
        if (!z.uuid().safeParse(batchId).success) throw new ImportServiceError("NOT_FOUND");
        const { error } = await client.rpc("cancel_import_batch", { p_batch_id: batchId });
        if (error) throw mapImportDatabaseError(error);
        return await viewFor(await loadBatch(batchId));
      } catch (error) { throw toImportServiceError(error); }
    },

    async retry(batchId: string): Promise<ImportView> {
      try {
        if (!z.uuid().safeParse(batchId).success) throw new ImportServiceError("NOT_FOUND");
        const { error } = await client.rpc("retry_import_batch", { p_batch_id: batchId });
        if (error) throw mapImportDatabaseError(error);
        return await viewFor(await loadBatch(batchId));
      } catch (error) { throw toImportServiceError(error); }
    },
  };
}

export type ImportService = ReturnType<typeof createImportService>;
