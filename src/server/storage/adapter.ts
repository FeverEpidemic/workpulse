export interface StorageAdapter {
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  uploadObject(
    objectKey: string,
    bytes: Uint8Array,
    options: { contentType: string; metadata: Record<string, string> },
  ): Promise<void>;
  createSignedDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  removeObject(objectKey: string): Promise<void>;
}

export class StorageAdapterUnavailableError extends Error {
  constructor() {
    super("Storage provider is unavailable");
    this.name = "StorageAdapterUnavailableError";
  }
}

/** The immutable key already contains an object; callers may verify its metadata before retrying. */
export class StorageObjectAlreadyExistsError extends Error {
  constructor() {
    super("Storage object already exists");
    this.name = "StorageObjectAlreadyExistsError";
  }
}
