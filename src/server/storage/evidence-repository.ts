import "server-only";

import { z } from "zod";

import {
  EvidenceMimeTypeSchema,
  EvidenceParentKindSchema,
  EvidenceStatusSchema,
  type EvidenceRecord,
  type EvidenceParentKind,
  type MoveEvidenceInput,
  type ReserveEvidenceInput,
} from "@/features/evidence/contracts";
import { EvidenceRepositoryError, type EvidenceRepositoryErrorCode } from "@/features/evidence/evidence-errors";
import { isCanonicalStorageUuid, parseStorageObjectKey } from "@/server/storage/object-key";

export interface EvidenceRpcClient {
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface EvidenceRepository {
  reserve(userId: string, input: ReserveEvidenceInput & { filename: string }): Promise<EvidenceRecord>;
  get(userId: string, evidenceId: string): Promise<EvidenceRecord | null>;
  list(userId: string, parentKind: EvidenceParentKind, parentId: string): Promise<EvidenceRecord[]>;
  moveToAchievement(userId: string, evidenceId: string, input: MoveEvidenceInput): Promise<EvidenceRecord | null>;
  finalize(input: {
    userId: string;
    evidenceId: string;
    expectedRevision: number;
    actualBytes: number;
    verifiedContentType: string;
    sha256: string;
  }): Promise<EvidenceRecord>;
  fail(input: {
    userId: string;
    evidenceId: string;
    expectedRevision: number;
    errorCode: string;
  }): Promise<EvidenceRecord>;
  delete(input: { userId: string; evidenceId: string; expectedRevision: number }): Promise<EvidenceRecord>;
}

const EvidenceRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  parent_kind: EvidenceParentKindSchema,
  parent_id: z.string(),
  filename: z.string(),
  content_type: EvidenceMimeTypeSchema,
  expected_bytes: z.union([z.number(), z.string()]),
  actual_bytes: z.union([z.number(), z.string()]).nullable().optional(),
  sha256: z.string().nullable().optional(),
  object_key: z.string(),
  status: EvidenceStatusSchema,
  revision: z.number().int().positive(),
  parent_revision: z.number().int().positive().nullable().optional(),
  reservation_expires_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  failure_code: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  scan_job_id: z.string().nullable().optional(),
});

const SafeDatabaseErrors = new Set([
  "STALE_REVISION",
  "IDEMPOTENCY_KEY_REUSED",
  "RESERVATION_EXPIRED",
  "AUTH_REQUIRED",
  "EVIDENCE_SLOT_LIMIT",
  "EVIDENCE_QUOTA_EXCEEDED",
  "INVALID_EVIDENCE_SIZE",
  "EVIDENCE_MIME_MISMATCH",
  "INVALID_EVIDENCE_HASH",
  "EVIDENCE_STATE_CONFLICT",
  "EVIDENCE_MOVE_STATE_CONFLICT",
]);

function safeDatabaseToken(error: unknown): EvidenceRepositoryErrorCode | null {
  if (typeof error !== "object" || error === null) return null;
  const details = error as { message?: unknown; details?: unknown; hint?: unknown };
  for (const value of [details.message, details.details, details.hint]) {
    if (typeof value === "string" && SafeDatabaseErrors.has(value)) return value as EvidenceRepositoryErrorCode;
  }
  return null;
}

function safeBytes(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toEvidenceRecord(value: unknown): EvidenceRecord {
  const parsed = EvidenceRowSchema.safeParse(value);
  if (!parsed.success) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");

  const row = parsed.data;
  const expectedBytes = safeBytes(row.expected_bytes);
  const actualBytes = safeBytes(row.actual_bytes);
  if (
    !expectedBytes ||
    !isCanonicalStorageUuid(row.id) ||
    !isCanonicalStorageUuid(row.user_id) ||
    !isCanonicalStorageUuid(row.parent_id) ||
    (row.actual_bytes !== undefined && row.actual_bytes !== null && actualBytes === null)
  ) {
    throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
  }

  const key = parseStorageObjectKey(row.object_key);
  if (!key || key.ownerId !== row.user_id || key.category !== "evidence" || key.objectId !== row.id) {
    throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
  }

  return {
    id: row.id,
    userId: row.user_id,
    parentKind: row.parent_kind,
    parentId: row.parent_id,
    filename: row.filename,
    contentType: row.content_type,
    expectedBytes,
    actualBytes,
    sha256: row.sha256 ?? null,
    objectKey: row.object_key,
    status: row.status,
    revision: row.revision,
    parentRevision: row.parent_revision ?? null,
    reservationExpiresAt: row.reservation_expires_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    failureCode: row.failure_code ?? row.error_code ?? null,
    scanJobId: row.scan_job_id ?? null,
  };
}

function firstRow(data: unknown): unknown | null {
  if (Array.isArray(data)) return data.length > 0 ? data[0] : null;
  return data ?? null;
}

export class SupabaseEvidenceRepository implements EvidenceRepository {
  constructor(private readonly client: EvidenceRpcClient) {}

  private async call(functionName: string, args: Record<string, unknown>): Promise<unknown | null> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc(functionName, args);
    } catch {
      throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    }
    if (result.error) {
      const token = safeDatabaseToken(result.error);
      throw new EvidenceRepositoryError(token ?? "PROVIDER_UNAVAILABLE");
    }
    return firstRow(result.data);
  }

  private async callAll(functionName: string, args: Record<string, unknown>): Promise<unknown[]> {
    let result: { data: unknown; error: unknown };
    try {
      result = await this.client.rpc(functionName, args);
    } catch {
      throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    }
    if (result.error) {
      const token = safeDatabaseToken(result.error);
      throw new EvidenceRepositoryError(token ?? "PROVIDER_UNAVAILABLE");
    }
    if (!Array.isArray(result.data)) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    return result.data;
  }

  async reserve(userId: string, input: ReserveEvidenceInput & { filename: string }): Promise<EvidenceRecord> {
    const row = await this.call("reserve_evidence_upload", {
      p_user_id: userId,
      p_parent_kind: input.parentKind,
      p_parent_id: input.parentId,
      p_filename: input.filename,
      p_content_type: input.contentType,
      p_expected_bytes: input.expectedBytes,
      p_idempotency_key: input.idempotencyKey,
      p_expected_revision: input.expectedRevision,
    });
    if (!row) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    return toEvidenceRecord(row);
  }

  async get(userId: string, evidenceId: string): Promise<EvidenceRecord | null> {
    const row = await this.call("get_evidence_file", {
      p_user_id: userId,
      p_evidence_id: evidenceId,
    });
    return row === null ? null : toEvidenceRecord(row);
  }

  async list(userId: string, parentKind: EvidenceParentKind, parentId: string): Promise<EvidenceRecord[]> {
    const rows = await this.callAll("list_evidence_files", {
      p_user_id: userId,
      p_parent_kind: parentKind,
      p_parent_id: parentId,
    });
    return rows.map(toEvidenceRecord);
  }

  async moveToAchievement(userId: string, evidenceId: string, input: MoveEvidenceInput): Promise<EvidenceRecord | null> {
    const row = await this.call("move_activity_evidence_to_achievement", {
      p_user_id: userId,
      p_evidence_id: evidenceId,
      p_target_achievement_id: input.targetAchievementId,
      p_expected_revision: input.expectedRevision,
      p_expected_target_revision: input.expectedTargetRevision,
    });
    return row === null ? null : toEvidenceRecord(row);
  }

  async finalize(input: {
    userId: string;
    evidenceId: string;
    expectedRevision: number;
    actualBytes: number;
    verifiedContentType: string;
    sha256: string;
  }): Promise<EvidenceRecord> {
    const row = await this.call("finalize_evidence_upload", {
      p_user_id: input.userId,
      p_evidence_id: input.evidenceId,
      p_expected_revision: input.expectedRevision,
      p_actual_bytes: input.actualBytes,
      p_verified_content_type: input.verifiedContentType,
      p_sha256: input.sha256,
    });
    if (!row) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    return toEvidenceRecord(row);
  }

  async fail(input: {
    userId: string;
    evidenceId: string;
    expectedRevision: number;
    errorCode: string;
  }): Promise<EvidenceRecord> {
    const row = await this.call("fail_evidence_upload", {
      p_user_id: input.userId,
      p_evidence_id: input.evidenceId,
      p_expected_revision: input.expectedRevision,
      p_error_code: input.errorCode,
    });
    if (!row) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    return toEvidenceRecord(row);
  }

  async delete(input: { userId: string; evidenceId: string; expectedRevision: number }): Promise<EvidenceRecord> {
    const row = await this.call("delete_evidence_file", {
      p_user_id: input.userId,
      p_evidence_id: input.evidenceId,
      p_expected_revision: input.expectedRevision,
    });
    if (!row) throw new EvidenceRepositoryError("PROVIDER_UNAVAILABLE");
    return toEvidenceRecord(row);
  }
}
