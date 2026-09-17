export interface StorageAdapter {
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  createSignedDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectKey: string): Promise<void>;
}

export class StorageAdapterUnavailableError extends Error {
  constructor() {
    super("Storage provider is unavailable");
    this.name = "StorageAdapterUnavailableError";
  }
}
