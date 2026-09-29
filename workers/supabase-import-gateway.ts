import { createClient } from "@supabase/supabase-js";

import { IMPORT_MAX_BYTES } from "../src/domain/import/contracts.ts";
import { PRIVATE_STORAGE_BUCKET } from "../src/server/storage/constants.ts";
import type { ImportCleanupJob, ImportJob, ImportWorkerDatabase, ImportWorkerStorage } from "./import-worker.ts";

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/import\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RPC_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 15_000;

export type SupabaseImportWorkerConfig = { url: string; secretKey: string };

export class ImportWorkerGatewayError extends Error {
  readonly code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE";
  constructor(code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE") {
    super("Import worker backend operation failed");
    this.code = code;
    this.name = "ImportWorkerGatewayError";
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
  if (!Array.isArray(value)) throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value.filter(isRow);
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
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
  if (!KEY_PATTERN.test(objectKey)) throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
}

function isNotFound(error: unknown): boolean {
  return isRow(error) && (error.status === 404 || error.statusCode === 404 || error.statusCode === "404" || error.message === "Object not found");
}

/** Service-role RPC and private Storage adapters for the import pass. Errors never carry bodies. */
export function createSupabaseImportWorkerGateway(
  config: SupabaseImportWorkerConfig,
  fetcher: typeof fetch = fetch,
): { database: ImportWorkerDatabase; storage: ImportWorkerStorage } {
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
      throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    try {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    } catch {
      throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
  }

  const database: ImportWorkerDatabase = {
    async expireImportUploads(limit, minAgeSeconds) {
      return count(await rpc("expire_import_uploads", { p_limit: limit, p_min_age_seconds: minAgeSeconds }));
    },
    async purgeExpiredImportBatches(limit) {
      return count(await rpc("purge_expired_import_batches", { p_limit: limit }));
    },
    async reconcileOrphanImportObjects(minAgeSeconds, limit) {
      return count(await rpc("reconcile_orphan_import_objects", { p_min_age_seconds: minAgeSeconds, p_limit: limit }));
    },
    async claimImportJobs(limit) {
      return rows(await rpc("claim_import_jobs", { p_limit: limit })).map((row): ImportJob => ({
        id: text(row.id), user_id: text(row.user_id), batch_id: text(row.batch_id), object_key: text(row.object_key),
        expected_bytes: integer(row.expected_bytes), mime_type: text(row.mime_type), sha256: text(row.sha256),
        attempt_count: integer(row.attempt_count), attempt_token: text(row.attempt_token),
      }));
    },
    async advanceImportJob(jobId, attemptToken) {
      return bool(await rpc("advance_import_job", { p_job_id: jobId, p_attempt_token: attemptToken }));
    },
    async completeImportParse(jobId, attemptToken, extracted, pageCount) {
      const data = await rpc("complete_import_parse", {
        p_job_id: jobId, p_attempt_token: attemptToken, p_text: extracted, p_page_count: pageCount,
      });
      if (typeof data !== "string") throw new ImportWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
      return data;
    },
    async failImportJob(input) {
      return bool(await rpc("fail_import_job", {
        p_job_id: input.jobId, p_attempt_token: input.attemptToken, p_error_code: input.errorCode,
        p_final: input.final, p_next_attempt_at: input.nextAttemptAt,
      }));
    },
    async claimImportCleanupJobs(limit) {
      return rows(await rpc("claim_import_cleanup_jobs", { p_limit: limit })).map((row): ImportCleanupJob => ({
        id: text(row.id), user_id: text(row.user_id), object_key: text(row.object_key),
        attempt_count: integer(row.attempt_count), attempt_token: text(row.attempt_token),
      }));
    },
    async completeImportCleanupJob(jobId, attemptToken) {
      return bool(await rpc("complete_import_cleanup_job", { p_job_id: jobId, p_attempt_token: attemptToken }));
    },
    async retryImportCleanupJob(input) {
      return bool(await rpc("retry_import_cleanup_job", {
        p_job_id: input.jobId, p_attempt_token: input.attemptToken, p_error_code: input.errorCode, p_next_attempt_at: input.nextAttemptAt,
      }));
    },
    async failImportCleanupJob(jobId, attemptToken, errorCode) {
      return bool(await rpc("fail_import_cleanup_job", { p_job_id: jobId, p_attempt_token: attemptToken, p_error_code: errorCode }));
    },
  };

  const storage: ImportWorkerStorage = {
    async downloadObject(objectKey) {
      assertKey(objectKey);
      const { data: info, error: infoError } = await client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      if (infoError || !info || typeof info.size !== "number" || info.size <= 0 || info.size > IMPORT_MAX_BYTES) {
        throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      const { data, error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).download(objectKey);
      if (error || !data) throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      const buffer = await data.arrayBuffer();
      if (buffer.byteLength <= 0 || buffer.byteLength > IMPORT_MAX_BYTES) throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      return new Uint8Array(buffer);
    },
    async getObjectMetadata(objectKey) {
      assertKey(objectKey);
      const { data, error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      if (error) {
        if (isNotFound(error)) return null;
        throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      return data ?? null;
    },
    async removeObject(objectKey) {
      assertKey(objectKey);
      const { error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
      if (error) throw new ImportWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
    },
  };

  return { database, storage };
}
