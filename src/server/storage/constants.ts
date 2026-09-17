export const PRIVATE_STORAGE_BUCKET = "workpulse-private";

export const PRIVATE_STORAGE_MAX_BYTES = 52_428_800;

export const PRIVATE_STORAGE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const STORAGE_CATEGORIES = ["import", "evidence", "export"] as const;

export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];
export type PrivateStorageMimeType = (typeof PRIVATE_STORAGE_MIME_TYPES)[number];
