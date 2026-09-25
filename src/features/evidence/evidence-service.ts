import { ReserveEvidenceInputSchema, EVIDENCE_DOWNLOAD_TTL_SECONDS, type EvidenceRecord } from "./contracts";
import { EvidenceError, toEvidenceError } from "./evidence-errors";
import { EvidenceFileValidationError, inspectEvidenceBytes, readBoundedBody, sha256Hex } from "./file-inspection";
import type { EvidenceRepository } from "@/server/storage/evidence-repository";
import { StorageObjectAlreadyExistsError, type StorageAdapter } from "@/server/storage/adapter";

export function createEvidenceService(options: {
  repository: EvidenceRepository;
  storage: StorageAdapter;
  resolveActor: () => Promise<{ id: string } | null>;
  now?: () => number;
}) {
  const { repository, storage } = options;
  const now = options.now ?? Date.now;
  async function actor() {
    const user = await options.resolveActor();
    if (!user) throw new EvidenceError("AUTH_REQUIRED");
    return user.id;
  }
  async function file(userId: string, id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new EvidenceError("EVIDENCE_NOT_FOUND");
    const record = await repository.get(userId, id);
    if (!record || record.userId !== userId || record.status === "deleting") throw new EvidenceError("EVIDENCE_NOT_FOUND");
    return record;
  }
  function usableUpload(record: EvidenceRecord) {
    if (record.status !== "uploading") throw new EvidenceError("CONFLICT");
    if (!record.reservationExpiresAt || Date.parse(record.reservationExpiresAt) <= now()) {
      throw new EvidenceError("RESERVATION_EXPIRED");
    }
  }
  async function fail(record: EvidenceRecord, code: string) {
    await repository.fail({ userId: record.userId, evidenceId: record.id, expectedRevision: record.revision, errorCode: code });
  }
  return {
    async reserve(input: unknown) {
      try {
        const parsed = ReserveEvidenceInputSchema.safeParse(input);
        if (!parsed.success) throw new EvidenceError("VALIDATION");
        return await repository.reserve(await actor(), parsed.data);
      } catch (error) { throw toEvidenceError(error); }
    },
    async get(id: string) {
      try { return await file(await actor(), id); }
      catch (error) { throw toEvidenceError(error); }
    },
    async upload(id: string, expectedRevision: number, contentType: string, body: ReadableStream<Uint8Array> | null) {
      try {
        const userId = await actor();
        const record = await file(userId, id);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new EvidenceError("VALIDATION");
        // A lost successful response may replay the original upload only with the same hash.
        const replay = record.status === "scanning" || record.status === "ready";
        if (!replay) {
          if (record.revision !== expectedRevision) throw new EvidenceError("CONFLICT");
          try { usableUpload(record); } catch (error) {
            if (error instanceof EvidenceError && error.code === "RESERVATION_EXPIRED") await fail(record, "RESERVATION_EXPIRED");
            throw error;
          }
        }
        let bytes: Buffer;
        let verifiedType: string;
        try {
          bytes = await readBoundedBody(body, record.expectedBytes);
          verifiedType = inspectEvidenceBytes(bytes);
          if (verifiedType !== record.contentType || contentType !== record.contentType) throw new EvidenceFileValidationError("FILE_TYPE_INVALID");
        } catch (error) {
          if (!replay) await fail(record, error instanceof EvidenceFileValidationError ? error.code : "UPLOAD_FAILED");
          throw new EvidenceError(error instanceof EvidenceFileValidationError ? error.code : "UPLOAD_INCOMPLETE");
        }
        const digest = sha256Hex(bytes);
        if (replay) {
          if (record.sha256 !== digest) throw new EvidenceError("IDEMPOTENCY_CONFLICT");
        } else {
          try { usableUpload(record); } catch (error) { await fail(record, "RESERVATION_EXPIRED"); throw error; }
          try {
            await storage.uploadObject(record.objectKey, bytes, { contentType: verifiedType, metadata: { sha256: digest } });
          } catch (error) {
            if (!(error instanceof StorageObjectAlreadyExistsError)) throw new EvidenceError("UPLOAD_INCOMPLETE");
            const metadata = await storage.getObjectMetadata(record.objectKey) as { size?: number; contentType?: string; customMetadata?: { sha256?: string } } | null;
            if (metadata?.size !== bytes.length || metadata.contentType !== verifiedType || metadata.customMetadata?.sha256 !== digest) {
              throw new EvidenceError("STORAGE_OBJECT_CONFLICT");
            }
          }
        }
        const finalized = await repository.finalize({ userId, evidenceId: id, expectedRevision, actualBytes: bytes.length, verifiedContentType: verifiedType, sha256: digest });
        if (finalized.status === "failed") throw new EvidenceError(finalized.failureCode === "RESERVATION_EXPIRED" ? "RESERVATION_EXPIRED" : "FILE_SIZE_MISMATCH");
        if (finalized.status !== "scanning" && finalized.status !== "ready") throw new EvidenceError("EVIDENCE_NOT_FOUND");
        return finalized;
      } catch (error) { throw toEvidenceError(error); }
    },
    async download(id: string, ttl = EVIDENCE_DOWNLOAD_TTL_SECONDS) {
      try {
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) throw new EvidenceError("VALIDATION");
        const record = await file(await actor(), id);
        if (record.status !== "ready") throw new EvidenceError("EVIDENCE_NOT_FOUND");
        return { url: await storage.createSignedDownloadUrl(record.objectKey, ttl), expiresInSeconds: ttl };
      } catch (error) { throw toEvidenceError(error); }
    },
    async remove(id: string, expectedRevision: number) {
      try {
        if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new EvidenceError("VALIDATION");
        const userId = await actor();
        await file(userId, id);
        return await repository.delete({ userId, evidenceId: id, expectedRevision });
      } catch (error) { throw toEvidenceError(error); }
    },
  };
}
