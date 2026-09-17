import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/server/supabase/database.types";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { StorageAdapterUnavailableError, type StorageAdapter } from "@/server/storage/adapter";

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const details = error as { status?: unknown; statusCode?: unknown };
  return details.status === 404 || details.statusCode === 404 || details.statusCode === "404";
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
    };
  }

  async createSignedDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .createSignedUrl(objectKey, expiresInSeconds, { download: true });
    if (error || !data?.signedUrl) throw new StorageAdapterUnavailableError();
    return data.signedUrl;
  }

  async removeObject(objectKey: string): Promise<void> {
    const { error } = await this.client.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
    if (error) throw new StorageAdapterUnavailableError();
  }
}
