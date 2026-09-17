import { randomUUID } from "node:crypto";
import { z } from "zod";

import { STORAGE_CATEGORIES, type StorageCategory } from "@/server/storage/constants";

const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORAGE_OBJECT_KEY_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(import|evidence|export)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export const StorageCategorySchema = z.enum(STORAGE_CATEGORIES);
export const StorageObjectKeySchema = z.string().regex(STORAGE_OBJECT_KEY_PATTERN);

export interface StorageObjectKeyParts {
  ownerId: string;
  category: StorageCategory;
  objectId: string;
}

export class StorageObjectKeyError extends Error {
  constructor() {
    super("Storage object key is invalid");
    this.name = "StorageObjectKeyError";
  }
}

export function isCanonicalStorageUuid(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_UUID_PATTERN.test(value);
}

export function formatStorageObjectKey(
  ownerId: string,
  category: StorageCategory,
  objectId: string,
): string {
  if (
    !isCanonicalStorageUuid(ownerId) ||
    !StorageCategorySchema.safeParse(category).success ||
    !isCanonicalStorageUuid(objectId)
  ) {
    throw new StorageObjectKeyError();
  }

  const key = [ownerId, category, objectId].join("/");
  if (!StorageObjectKeySchema.safeParse(key).success) throw new StorageObjectKeyError();
  return key;
}

/** Create a fresh object UUID on the server for every new storage object. */
export function createStorageObjectKey(ownerId: string, category: StorageCategory): string {
  return formatStorageObjectKey(ownerId, category, randomUUID());
}

export function parseStorageObjectKey(value: unknown): StorageObjectKeyParts | null {
  const parsed = StorageObjectKeySchema.safeParse(value);
  if (!parsed.success) return null;

  const [ownerId, category, objectId] = parsed.data.split("/");
  if (!ownerId || !category || !objectId) return null;

  return {
    ownerId,
    category: category as StorageCategory,
    objectId,
  };
}
