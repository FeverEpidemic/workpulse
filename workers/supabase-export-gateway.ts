import { createClient } from "@supabase/supabase-js";

import { CV_EXPORT_MAX_BYTES } from "../src/domain/cv/export.ts";
import { PRIVATE_STORAGE_BUCKET } from "../src/server/storage/constants.ts";
import type { ExportCleanupJob, ExportInput, ExportJob, ExportWorkerDatabase, ExportWorkerStorage } from "./export-worker.ts";

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/export\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RPC_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 30_000;

export type SupabaseExportWorkerConfig = { url: string; secretKey: string };

export class ExportWorkerGatewayError extends Error {
  readonly code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE";
  constructor(code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE") {
    super("Export worker backend operation failed");
    this.code = code;
    this.name = "ExportWorkerGatewayError";
  }
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
function integer(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return Number.NaN;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value.filter(isRow);
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value;
}

function normalizedOrigin(value: string): string {
  try {
    const url = new URL(value);
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if ((url.protocol !== "https:" && !(isLocal && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new Error("WORKER_CONFIG_INVALID");
  }
}

function assertKey(objectKey: string): void {
  if (!KEY_PATTERN.test(objectKey)) throw new ExportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
}

function isNotFound(error: unknown): boolean {
  return isRow(error) && (error.status === 404 || error.statusCode === 404 || error.statusCode === "404" || error.message === "Object not found");
}

/**
 * Service-role RPC and private Storage adapters for the export pass. The only data read for an export is the
 * stored snapshot returned by get_cv_export_input; no career or CV table is queried here. Errors never carry bodies.
 */
export function createSupabaseExportWorkerGateway(
  config: SupabaseExportWorkerConfig,
  fetcher: typeof fetch = fetch,
): { database: ExportWorkerDatabase; storage: ExportWorkerStorage } {
  const origin = normalizedOrigin(config.url);
  if (!config.secretKey.trim()) throw new Error("WORKER_CONFIG_INVALID");
  const client = createClient(origin, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetcher(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(STORAGE_TIMEOUT_MS) }),
    },
  });

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, origin), {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    try {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    } catch {
      throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
  }

  const database: ExportWorkerDatabase = {
    async expireCvExports(limit) {
      return count(await rpc("expire_cv_exports", { p_limit: limit }));
    },
    async reconcileOrphanExportObjects(minAgeSeconds, limit) {
      return count(await rpc("reconcile_orphan_export_objects", { p_min_age_seconds: minAgeSeconds, p_limit: limit }));
    },
    async claimCvExportJobs(limit) {
      return rows(await rpc("claim_cv_export_jobs", { p_limit: limit })).map((row): ExportJob => ({
        id: text(row.id), user_id: text(row.user_id), cv_revision: integer(row.cv_revision),
        attempt_count: integer(row.attempt_count), attempt_token: text(row.attempt_token),
      }));
    },
    async getCvExportInput(exportId, attemptToken) {
      const [row] = rows(await rpc("get_cv_export_input", { p_export_id: exportId, p_attempt_token: attemptToken }));
      if (!row) return null;
      return { snapshot: row.snapshot, cv_revision: integer(row.cv_revision) } satisfies ExportInput;
    },
    async completeCvExport(input) {
      const data = await rpc("complete_cv_export", {
        p_export_id: input.exportId, p_attempt_token: input.attemptToken, p_object_key: input.objectKey,
        p_page_count: input.pageCount, p_byte_size: input.byteSize,
      });
      if (typeof data !== "string") throw new ExportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
      return data;
    },
    async failCvExport(exportId, attemptToken, errorCode) {
      return bool(await rpc("fail_cv_export", { p_export_id: exportId, p_attempt_token: attemptToken, p_error_code: errorCode }));
    },
    async claimExportCleanupJobs(limit) {
      return rows(await rpc("claim_export_cleanup_jobs", { p_limit: limit })).map((row): ExportCleanupJob => ({
        id: text(row.id), user_id: text(row.user_id), object_key: text(row.object_key),
        attempt_count: integer(row.attempt_count), attempt_token: text(row.attempt_token),
      }));
    },
    async completeExportCleanupJob(jobId, attemptToken) {
      return bool(await rpc("complete_export_cleanup_job", { p_job_id: jobId, p_attempt_token: attemptToken }));
    },
    async retryExportCleanupJob(input) {
      return bool(await rpc("retry_export_cleanup_job", {
        p_job_id: input.jobId, p_attempt_token: input.attemptToken, p_error_code: input.errorCode, p_next_attempt_at: input.nextAttemptAt,
      }));
    },
    async failExportCleanupJob(jobId, attemptToken, errorCode) {
      return bool(await rpc("fail_export_cleanup_job", { p_job_id: jobId, p_attempt_token: attemptToken, p_error_code: errorCode }));
    },
  };

  const storage: ExportWorkerStorage = {
    async uploadObject(objectKey, bytes, options) {
      assertKey(objectKey);
      if (bytes.byteLength < 1 || bytes.byteLength > CV_EXPORT_MAX_BYTES) throw new ExportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      const { error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).upload(objectKey, bytes, {
        contentType: options.contentType,
        cacheControl: "no-store",
        upsert: false,
        metadata: options.metadata,
      });
      if (error) throw new ExportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
    },
    async getObjectMetadata(objectKey) {
      assertKey(objectKey);
      const { data, error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      if (error) {
        if (isNotFound(error)) return null;
        throw new ExportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      return data ?? null;
    },
    async removeObject(objectKey) {
      assertKey(objectKey);
      const { error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
      if (error) throw new ExportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
    },
  };

  return { database, storage };
}
