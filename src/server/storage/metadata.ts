import { z } from "zod";

import {
  PRIVATE_STORAGE_BUCKET,
  PRIVATE_STORAGE_MIME_TYPES,
  type PrivateStorageMimeType,
} from "@/server/storage/constants";
import { StorageObjectKeySchema } from "@/server/storage/object-key";

export const PrivateStorageMetadataSchema = z
  .object({
    bucketId: z.literal(PRIVATE_STORAGE_BUCKET),
    objectKey: StorageObjectKeySchema,
    size: z.number().int().nonnegative(),
    contentType: z.enum(PRIVATE_STORAGE_MIME_TYPES),
  })
  .strict();

export type PrivateStorageMetadata = {
  bucketId: typeof PRIVATE_STORAGE_BUCKET;
  objectKey: string;
  size: number;
  contentType: PrivateStorageMimeType;
};

export function validatePrivateStorageMetadata(
  value: unknown,
  expectedObjectKey: string,
): PrivateStorageMetadata | null {
  const parsed = PrivateStorageMetadataSchema.safeParse(value);
  if (!parsed.success || parsed.data.objectKey !== expectedObjectKey) return null;
  return parsed.data;
}
