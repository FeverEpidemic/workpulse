import { z } from "zod";

import { PRIVATE_STORAGE_MIME_TYPES, type PrivateStorageMimeType } from "@/server/storage/constants";

export const EVIDENCE_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EVIDENCE_DOWNLOAD_TTL_SECONDS = 300;

export const EvidenceParentKindSchema = z.enum(["activity", "achievement", "project"]);
export type EvidenceParentKind = z.infer<typeof EvidenceParentKindSchema>;

export const EvidenceMimeTypeSchema = z.enum(PRIVATE_STORAGE_MIME_TYPES);
export type EvidenceMimeType = PrivateStorageMimeType;

export const EvidenceStatusSchema = z.enum(["uploading", "scanning", "ready", "failed", "deleting"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

const CanonicalUuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const ReserveEvidenceInputSchema = z
  .object({
    parentKind: EvidenceParentKindSchema,
    parentId: CanonicalUuidSchema,
    filename: z.string().trim().min(1).max(255).refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
    contentType: EvidenceMimeTypeSchema,
    expectedBytes: z.number().int().positive().max(EVIDENCE_MAX_FILE_BYTES),
    idempotencyKey: z.string().uuid().transform((value) => value.toLowerCase()),
    expectedRevision: z.number().int().positive(),
  })
  .strict();

export type ReserveEvidenceInput = z.infer<typeof ReserveEvidenceInputSchema>;

export const MoveEvidenceInputSchema = z.object({
  targetAchievementId: CanonicalUuidSchema,
  expectedRevision: z.number().int().positive(),
  expectedTargetRevision: z.number().int().positive(),
}).strict();

export type MoveEvidenceInput = z.infer<typeof MoveEvidenceInputSchema>;

export interface EvidenceRecord {
  id: string;
  userId: string;
  parentKind: EvidenceParentKind;
  parentId: string;
  filename: string;
  contentType: EvidenceMimeType;
  expectedBytes: number;
  actualBytes: number | null;
  sha256: string | null;
  objectKey: string;
  status: EvidenceStatus;
  revision: number;
  parentRevision: number | null;
  reservationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  failureCode: string | null;
  scanJobId: string | null;
}

export interface EvidencePublicRecord {
  id: string;
  filename: string;
  contentType: EvidenceMimeType;
  bytes: number;
  status: EvidenceStatus;
  revision: number;
  reservationExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  failureCode: string | null;
}

export function toPublicEvidenceRecord(record: EvidenceRecord): EvidencePublicRecord {
  return {
    id: record.id,
    filename: record.filename,
    contentType: record.contentType,
    bytes: record.actualBytes ?? record.expectedBytes,
    status: record.status,
    revision: record.revision,
    reservationExpiresAt: record.status === "uploading" ? record.reservationExpiresAt : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    failureCode: record.failureCode,
  };
}
