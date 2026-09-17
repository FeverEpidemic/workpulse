import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "@/server/storage/adapter";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { formatStorageObjectKey } from "@/server/storage/object-key";
import { createPrivateStorageService, PrivateStorageError } from "@/server/storage/private-storage-service";

const ownerA = "11111111-1111-4111-8111-111111111111";
const ownerB = "22222222-2222-4222-8222-222222222222";
const keyA = formatStorageObjectKey(ownerA, "evidence", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const validMetadata = {
  bucketId: PRIVATE_STORAGE_BUCKET,
  objectKey: keyA,
  size: 12,
  contentType: "application/pdf",
};

function createAdapter(overrides: Partial<StorageAdapter> = {}) {
  return {
    getObjectMetadata: vi.fn(async () => validMetadata),
    createSignedDownloadUrl: vi.fn(async () => "http://storage.local/signed/download"),
    removeObject: vi.fn(async () => undefined),
    ...overrides,
  } satisfies StorageAdapter;
}

function errorCode(error: unknown) {
  return error instanceof PrivateStorageError ? error.code : null;
}

describe("private storage service", () => {
  it("uses the session actor and requests a default 300 second download", async () => {
    const adapter = createAdapter();
    const service = createPrivateStorageService(adapter, async () => ({ id: ownerA }));

    await expect(service.issueDownload(keyA)).resolves.toEqual({
      url: "http://storage.local/signed/download",
      expiresInSeconds: 300,
    });
    expect(adapter.getObjectMetadata).toHaveBeenCalledWith(keyA);
    expect(adapter.createSignedDownloadUrl).toHaveBeenCalledWith(keyA, 300);
  });

  it("does not call the provider for a foreign owner's key", async () => {
    const adapter = createAdapter();
    const service = createPrivateStorageService(adapter, async () => ({ id: ownerB }));

    await expect(service.issueDownload(keyA)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "STORAGE_OBJECT_UNAVAILABLE",
    );
    expect(adapter.getObjectMetadata).not.toHaveBeenCalled();
    expect(adapter.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("uses the same safe error for missing and foreign objects", async () => {
    const missingAdapter = createAdapter({
      getObjectMetadata: vi.fn(async () => null),
    });
    const missingService = createPrivateStorageService(missingAdapter, async () => ({ id: ownerA }));

    const missingError = await missingService.issueDownload(keyA).catch((error: unknown) => error);
    const foreignAdapter = createAdapter();
    const foreignService = createPrivateStorageService(foreignAdapter, async () => ({ id: ownerB }));
    const foreignError = await foreignService.issueDownload(keyA).catch((error: unknown) => error);

    expect(errorCode(missingError)).toBe("STORAGE_OBJECT_UNAVAILABLE");
    expect(errorCode(foreignError)).toBe("STORAGE_OBJECT_UNAVAILABLE");
    expect(foreignAdapter.getObjectMetadata).not.toHaveBeenCalled();
  });

  it.each([0, 301, 1.5, Number.NaN])("rejects unsafe expiry %s before provider access", async (ttl) => {
    const adapter = createAdapter();
    const service = createPrivateStorageService(adapter, async () => ({ id: ownerA }));

    await expect(service.issueDownload(keyA, ttl)).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === "STORAGE_TTL_INVALID",
    );
    expect(adapter.getObjectMetadata).not.toHaveBeenCalled();
    expect(adapter.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects missing, malformed, unsupported, or mismatched provider metadata", async () => {
    const invalidMetadata = [
      { ...validMetadata, size: -1 },
      { ...validMetadata, size: 12.5 },
      { ...validMetadata, size: undefined },
      { ...validMetadata, contentType: "text/plain" },
      { ...validMetadata, objectKey: ownerA + "/evidence/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { ...validMetadata, bucketId: "public" },
    ];

    for (const metadata of invalidMetadata) {
      const adapter = createAdapter({
        getObjectMetadata: vi.fn(async () => metadata),
      });
      const service = createPrivateStorageService(adapter, async () => ({ id: ownerA }));

      await expect(service.issueDownload(keyA)).rejects.toSatisfy(
        (error: unknown) => errorCode(error) === "STORAGE_METADATA_INVALID",
      );
      expect(adapter.createSignedDownloadUrl).not.toHaveBeenCalled();
    }
  });

  it("maps provider failures to a safe error with a correlation ID", async () => {
    const adapter = createAdapter({
      getObjectMetadata: vi.fn(async () => {
        throw new Error("provider-secret-and-object-details");
      }),
    });
    const service = createPrivateStorageService(adapter, async () => ({ id: ownerA }));

    const error = await service.issueDownload(keyA).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrivateStorageError);
    expect(errorCode(error)).toBe("STORAGE_PROVIDER_UNAVAILABLE");
    expect((error as Error).message).not.toContain("provider-secret");
    expect((error as PrivateStorageError).correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("authorizes deletion through the same owner and metadata checks", async () => {
    const adapter = createAdapter();
    const service = createPrivateStorageService(adapter, async () => ({ id: ownerA }));

    await expect(service.deleteObject(keyA)).resolves.toBeUndefined();
    expect(adapter.removeObject).toHaveBeenCalledWith(keyA);
  });
});
