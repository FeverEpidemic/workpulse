import { createClient } from "@supabase/supabase-js";

import { PRIVATE_STORAGE_BUCKET } from "../src/server/storage/constants.ts";
import { MALWARE_SCAN_MAX_BYTES } from "../src/server/storage/malware-scanner.ts";
import {
  type EvidenceCleanupJob,
  type EvidenceScanJob,
  type EvidenceWorkerDatabase,
  type EvidenceWorkerStorage,
} from "./evidence-worker.ts";

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/evidence\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RPC_TIMEOUT_MS = 15_000;
const STORAGE_TIMEOUT_MS = 15_000;

export type SupabaseEvidenceWorkerConfig = {
  url: string;
  secretKey: string;
};

export class EvidenceWorkerGatewayError extends Error {
  readonly code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE";
  constructor(code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_STORAGE_UNAVAILABLE") {
    super("Evidence worker backend operation failed");
    this.code = code;
    this.name = "EvidenceWorkerGatewayError";
  }
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
  }
  return Number.NaN;
}

function parseRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new EvidenceWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value.filter(isRow);
}

function readScanJob(row: Row): EvidenceScanJob {
  return {
    id: text(row.id),
    user_id: text(row.user_id),
    evidence_id: text(row.evidence_id),
    object_key: text(row.object_key),
    expected_bytes: integer(row.expected_bytes),
    content_type: text(row.mime_type) as EvidenceScanJob["content_type"],
    sha256: text(row.sha256),
    attempt_count: integer(row.attempt_count),
    attempt_token: text(row.attempt_token),
    lease_expires_at: text(row.lease_expires_at),
  };
}

function readCleanupJob(row: Row): EvidenceCleanupJob {
  return {
    id: text(row.id),
    user_id: text(row.user_id),
    object_key: text(row.object_key),
    attempt_count: integer(row.attempt_count),
    attempt_token: text(row.attempt_token),
    lease_expires_at: text(row.lease_expires_at),
  };
}

function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (
      (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new Error("WORKER_CONFIG_INVALID");
  }
}

function assertObjectKey(objectKey: string): void {
  if (!KEY_PATTERN.test(objectKey)) throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
}

function storageErrorIsNotFound(error: unknown): boolean {
  if (!isRow(error)) return false;
  return (
    error.status === 404 ||
    error.statusCode === 404 ||
    error.statusCode === "404" ||
    error.message === "Object not found"
  );
}

/** Build the service-role RPC and private Storage adapters used by the standalone worker. */
export function createSupabaseEvidenceWorkerGateway(
  config: SupabaseEvidenceWorkerConfig,
  fetcher: typeof fetch = fetch,
): { database: EvidenceWorkerDatabase; storage: EvidenceWorkerStorage } {
  const origin = normalizedUrl(config.url);
  if (!config.secretKey.trim()) throw new Error("WORKER_CONFIG_INVALID");

  const client = createClient(origin, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetcher(input, {
        ...init,
        cache: "no-store",
        signal: init?.signal ?? AbortSignal.timeout(STORAGE_TIMEOUT_MS),
      }),
    },
  });

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
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
      throw new EvidenceWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    if (!response.ok) throw new EvidenceWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    try {
      const body = await response.text();
      return (body ? JSON.parse(body) : null) as T;
    } catch {
      throw new EvidenceWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
  }

  const database: EvidenceWorkerDatabase = {
    async isEvidenceScanCurrent(job) {
      const rows = parseRows(await rpc<unknown>("get_evidence_file", { p_user_id: job.user_id, p_evidence_id: job.evidence_id }));
      const file = rows[0];
      return Boolean(file && file.status === "scanning" && file.scan_job_id === job.id && file.sha256 === job.sha256 && file.object_key === job.object_key);
    },
    async claimEvidenceScanJobs(limit) {
      const data = await rpc<unknown>("claim_evidence_scan_jobs", { p_limit: limit });
      return parseRows(data).map(readScanJob);
    },
    completeEvidenceScanJob(input) {
      return rpc<boolean>("complete_evidence_scan_job", {
        p_job_id: input.jobId,
        p_attempt_token: input.attemptToken,
        p_result: input.result,
        p_error_code: input.errorCode,
      });
    },
    retryEvidenceScanJob(input) {
      return rpc<boolean>("retry_evidence_scan_job", {
        p_job_id: input.jobId,
        p_attempt_token: input.attemptToken,
        p_error_code: input.errorCode,
        p_next_attempt_at: input.nextAttemptAt,
      });
    },
    async claimEvidenceCleanupJobs(limit) {
      const data = await rpc<unknown>("claim_evidence_cleanup_jobs", { p_limit: limit });
      return parseRows(data).map(readCleanupJob);
    },
    completeEvidenceCleanupJob(jobId, attemptToken) {
      return rpc<boolean>("complete_evidence_cleanup_job", {
        p_job_id: jobId,
        p_attempt_token: attemptToken,
      });
    },
    failEvidenceCleanupJob(jobId, attemptToken, errorCode) {
      return rpc<boolean>("fail_evidence_cleanup_job", {
        p_job_id: jobId,
        p_attempt_token: attemptToken,
        p_error_code: errorCode,
      });
    },
    retryEvidenceCleanupJob(input) {
      return rpc<boolean>("retry_evidence_cleanup_job", {
        p_job_id: input.jobId,
        p_attempt_token: input.attemptToken,
        p_error_code: input.errorCode,
        p_next_attempt_at: input.nextAttemptAt,
      });
    },
    async expireEvidenceUploads(limit) {
      const data = await rpc<unknown>("expire_evidence_uploads", { p_limit: limit });
      if (typeof data !== "number" || !Number.isInteger(data) || data < 0) {
        throw new EvidenceWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE");
      }
      return data;
    },
    async reconcileOrphanEvidenceObjects(minAgeSeconds, limit) {
      const data = await rpc<unknown>("reconcile_orphan_evidence_objects", {
        p_min_age_seconds: minAgeSeconds,
        p_limit: limit,
      });
      return parseRows(data).length;
    },
  };

  const storage: EvidenceWorkerStorage = {
    async downloadObject(objectKey) {
      assertObjectKey(objectKey);
      const { data: metadata, error: infoError } = await client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      if (infoError || !metadata || typeof metadata.size !== "number" || metadata.size <= 0 || metadata.size > MALWARE_SCAN_MAX_BYTES) {
        throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      const { data, error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).download(objectKey);
      if (error || !data) throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      const arrayBuffer = await data.arrayBuffer();
      if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > MALWARE_SCAN_MAX_BYTES) {
        throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      return new Uint8Array(arrayBuffer);
    },
    async getObjectMetadata(objectKey) {
      assertObjectKey(objectKey);
      const { data, error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      if (error) {
        if (storageErrorIsNotFound(error)) return null;
        throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
      }
      return data ?? null;
    },
    async removeObject(objectKey) {
      assertObjectKey(objectKey);
      const { error } = await client.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
      if (error) throw new EvidenceWorkerGatewayError("WORKER_STORAGE_UNAVAILABLE");
    },
  };

  return { database, storage };
}
