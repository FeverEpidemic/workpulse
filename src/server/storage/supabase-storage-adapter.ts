import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/supabase/database.types";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import {
  StorageAdapterUnavailableError,
  StorageObjectAlreadyExistsError,
  isValidSignedDownloadOptions,
  type SignedDownloadOptions,
  type StorageAdapter,
} from "@/server/storage/adapter";

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; statusCode?: unknown };
  return details.status === 404 || details.statusCode === 404 || details.statusCode === "404";
}

function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; statusCode?: unknown; error?: unknown };
  return (
    details.status === 409 ||
    details.statusCode === 409 ||
    details.statusCode === "409" ||
    details.error === "Duplicate"
  );
}

export class SupabaseStorageAdapter implements StorageAdapter {
  constructor(private readonly client: Pick<SupabaseClient<Database>, "storage">) {}

  async getObjectMetadata(objectKey: string): Promise<unknown | null> {
    const { data, error } = await this.client.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
    if (error) {
      if (isNotFound(error)) return null;
      throw new StorageAdapterUnavailableError();
    }
    if (!data) return null;

    return {
      bucketId: data.bucketId,
      objectKey: data.name,
      size: data.size,
      contentType: data.contentType,
      customMetadata: data.metadata,
    };
  }

  async uploadObject(
    objectKey: string,
    bytes: Uint8Array,
    options: { contentType: string; metadata: Record<string, string> },
  ): Promise<void> {
    const { error } = await this.client.storage.from(PRIVATE_STORAGE_BUCKET).upload(objectKey, bytes, {
      contentType: options.contentType,
      cacheControl: "no-store",
      upsert: false,
      metadata: options.metadata,
    });
    if (!error) return;
    if (isAlreadyExists(error)) throw new StorageObjectAlreadyExistsError();
    throw new StorageAdapterUnavailableError();
  }

  async createSignedDownloadUrl(objectKey: string, expiresInSeconds: number, options: SignedDownloadOptions = {}): Promise<string> {
    if (!isValidSignedDownloadOptions(options)) throw new StorageAdapterUnavailableError();
    const bucket = this.client.storage.from(PRIVATE_STORAGE_BUCKET);
    // Inline: no download option, so the response carries no content-disposition and a page may read the bytes.
    // Attachment: { download: true } as before, or { download: <generic name> } to name the saved file.
    const { data, error } = options.disposition === "inline"
      ? await bucket.createSignedUrl(objectKey, expiresInSeconds)
      : await bucket.createSignedUrl(objectKey, expiresInSeconds, { download: options.filename ?? true });
    if (error || !data?.signedUrl) throw new StorageAdapterUnavailableError();
    return data.signedUrl;
  }

  async removeObject(objectKey: string): Promise<void> {
    const { error } = await this.client.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
    if (error) throw new StorageAdapterUnavailableError();
  }
}
