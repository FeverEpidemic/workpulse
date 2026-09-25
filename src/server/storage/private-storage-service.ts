import { randomUUID } from "node:crypto";

import type { StorageAdapter } from "@/server/storage/adapter";
import { validatePrivateStorageMetadata } from "@/server/storage/metadata";
import { isCanonicalStorageUuid, parseStorageObjectKey } from "@/server/storage/object-key";

export type PrivateStorageErrorCode =
  | "AUTH_REQUIRED"
  | "STORAGE_OBJECT_UNAVAILABLE"
  | "STORAGE_TTL_INVALID"
  | "STORAGE_METADATA_INVALID"
  | "STORAGE_PROVIDER_UNAVAILABLE";

export class PrivateStorageError extends Error {
  constructor(
    readonly code: PrivateStorageErrorCode,
    readonly correlationId = randomUUID(),
  ) {
    super("Private storage request could not be completed");
    this.name = "PrivateStorageError";
  }
}

export interface StorageActor {
  id: string;
}

export type StorageActorResolver = () => Promise<StorageActor | null>;

export interface PrivateStorageService {
  issueDownload(objectKey: string, expiresInSeconds?: number): Promise<{ url: string; expiresInSeconds: number }>;
  deleteObject(objectKey: string): Promise<void>;
}

export function createPrivateStorageService(
  adapter: StorageAdapter,
  resolveActor: StorageActorResolver,
): PrivateStorageService {
  async function authorize(objectKey: string) {
    let actor: StorageActor | null;
    try {
      actor = await resolveActor();
    } catch {
      throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE");
    }
    if (!actor) throw new PrivateStorageError("AUTH_REQUIRED");

    const parts = parseStorageObjectKey(objectKey);
    if (
      !parts ||
      !isCanonicalStorageUuid(actor.id) ||
      parts.ownerId !== actor.id ||
      // Evidence must pass its domain lifecycle checks (ready, active owner and
      // parent) and deletion must retain a durable cleanup receipt. This generic
      // foundation service is not an alternate route around those checks.
      parts.category === "evidence"
    ) {
      throw new PrivateStorageError("STORAGE_OBJECT_UNAVAILABLE");
    }

    return { actor, parts };
  }

  async function requireExistingMetadata(objectKey: string) {
    let rawMetadata: unknown | null;
    try {
      rawMetadata = await adapter.getObjectMetadata(objectKey);
    } catch {
      throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE");
    }
    if (rawMetadata === null) throw new PrivateStorageError("STORAGE_OBJECT_UNAVAILABLE");

    const metadata = validatePrivateStorageMetadata(rawMetadata, objectKey);
    if (!metadata) throw new PrivateStorageError("STORAGE_METADATA_INVALID");
    return metadata;
  }

  return {
    async issueDownload(objectKey, expiresInSeconds = 300) {
      await authorize(objectKey);
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > 300
      ) {
        throw new PrivateStorageError("STORAGE_TTL_INVALID");
      }

      await requireExistingMetadata(objectKey);
      let url: string;
      try {
        url = await adapter.createSignedDownloadUrl(objectKey, expiresInSeconds);
      } catch {
        throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE");
      }
      return { url, expiresInSeconds };
    },

    async deleteObject(objectKey) {
      await authorize(objectKey);
      await requireExistingMetadata(objectKey);
      try {
        await adapter.removeObject(objectKey);
      } catch {
        throw new PrivateStorageError("STORAGE_PROVIDER_UNAVAILABLE");
      }
    },
  };
}
