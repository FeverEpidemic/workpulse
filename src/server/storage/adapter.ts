/**
 * How a signed URL presents the object. Without options a URL is a plain attachment (the original behaviour).
 * `inline` is for a page that reads the bytes itself (S14 renders the PDF pages); `filename` names an attachment.
 */
export interface SignedDownloadOptions {
  disposition?: "attachment" | "inline";
  filename?: string;
}

/** A generic file name: it travels in the URL, so it never carries personal data (T22). */
export const DOWNLOAD_FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,80}\.pdf$/;

export function isValidSignedDownloadOptions(options: SignedDownloadOptions): boolean {
  if (options.disposition !== undefined && options.disposition !== "attachment" && options.disposition !== "inline") return false;
  return options.filename === undefined || (typeof options.filename === "string" && DOWNLOAD_FILENAME_PATTERN.test(options.filename));
}

export interface StorageAdapter {
  getObjectMetadata(objectKey: string): Promise<unknown | null>;
  uploadObject(
    objectKey: string,
    bytes: Uint8Array,
    options: { contentType: string; metadata: Record<string, string> },
  ): Promise<void>;
  createSignedDownloadUrl(objectKey: string, expiresInSeconds: number, options?: SignedDownloadOptions): Promise<string>;
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
