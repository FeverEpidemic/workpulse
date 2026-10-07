import { describe, expect, it, vi } from "vitest";

import type { StorageAdapter } from "@/server/storage/adapter";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { formatStorageObjectKey } from "@/server/storage/object-key";
import { createPrivateStorageService } from "@/server/storage/private-storage-service";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";

const OWNER = "11111111-1111-4111-8111-111111111111";
const KEY = formatStorageObjectKey(OWNER, "export", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const METADATA = { bucketId: PRIVATE_STORAGE_BUCKET, objectKey: KEY, size: 12, contentType: "application/pdf" };

function signingClient() {
  const createSignedUrl = vi.fn(async (..._args: unknown[]) => ({ data: { signedUrl: "http://storage.local/signed" }, error: null }));
  const from = vi.fn(() => ({ createSignedUrl }));
  return { adapter: new SupabaseStorageAdapter({ storage: { from } } as never), createSignedUrl, from };
}

describe("T22 storage adapter download options", () => {
  it("keeps the default of a plain attachment: exactly two arguments plus { download: true }", async () => {
    const { adapter, createSignedUrl, from } = signingClient();
    await expect(adapter.createSignedDownloadUrl(KEY, 300)).resolves.toBe("http://storage.local/signed");
    expect(from).toHaveBeenCalledWith(PRIVATE_STORAGE_BUCKET);
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 300, { download: true });
  });

  it("treats an explicit attachment without a name like the default", async () => {
    const { adapter, createSignedUrl } = signingClient();
    await adapter.createSignedDownloadUrl(KEY, 300, { disposition: "attachment" });
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 300, { download: true });
    await adapter.createSignedDownloadUrl(KEY, 300, {});
    expect(createSignedUrl).toHaveBeenLastCalledWith(KEY, 300, { download: true });
  });

  it("names an attachment with a generic file name", async () => {
    const { adapter, createSignedUrl } = signingClient();
    await adapter.createSignedDownloadUrl(KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV-2026-10-07.pdf" });
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 300, { download: "WorkPulse-CV-2026-10-07.pdf" });
  });

  it("signs an inline URL without any download option, and ignores a file name there", async () => {
    const { adapter, createSignedUrl } = signingClient();
    await adapter.createSignedDownloadUrl(KEY, 300, { disposition: "inline" });
    expect(createSignedUrl).toHaveBeenLastCalledWith(KEY, 300);
    await adapter.createSignedDownloadUrl(KEY, 300, { disposition: "inline", filename: "WorkPulse-CV.pdf" });
    expect(createSignedUrl).toHaveBeenLastCalledWith(KEY, 300);
  });

  it("refuses an unsafe file name before asking the provider", async () => {
    const { adapter, createSignedUrl } = signingClient();
    for (const filename of ["", "cv.pdf ", "../cv.pdf", "a/b.pdf", "a\\b.pdf", "Ani Contoh.pdf", "Aniç.pdf", "cv.docx", "cv.PDF", `${"a".repeat(81)}.pdf`, "x\r\nSet-Cookie: a=b.pdf", ".pdf"]) {
      await expect(adapter.createSignedDownloadUrl(KEY, 300, { disposition: "attachment", filename }), JSON.stringify(filename)).rejects.toMatchObject({ name: "StorageAdapterUnavailableError" });
    }
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("accepts the longest and the shortest safe names", async () => {
    const { adapter } = signingClient();
    await expect(adapter.createSignedDownloadUrl(KEY, 300, { disposition: "attachment", filename: `${"a".repeat(80)}.pdf` })).resolves.toBeTruthy();
    await expect(adapter.createSignedDownloadUrl(KEY, 300, { disposition: "attachment", filename: "a.pdf" })).resolves.toBeTruthy();
  });
});

function adapterStub(overrides: Partial<StorageAdapter> = {}) {
  return {
    getObjectMetadata: vi.fn(async () => METADATA),
    uploadObject: vi.fn(async () => undefined),
    createSignedDownloadUrl: vi.fn(async (..._args: unknown[]) => "http://storage.local/signed/download"),
    removeObject: vi.fn(async () => undefined),
    ...overrides,
  } satisfies StorageAdapter;
}

describe("T22 private storage service download options", () => {
  const serviceFor = (adapter: StorageAdapter, owner = OWNER) => createPrivateStorageService(adapter, async () => ({ id: owner }));

  it("passes no third argument to the adapter when the caller gives no options (older callers are unchanged)", async () => {
    const adapter = adapterStub();
    await serviceFor(adapter).issueDownload(KEY);
    expect(adapter.createSignedDownloadUrl).toHaveBeenCalledWith(KEY, 300);
    await serviceFor(adapter).issueDownload(KEY, 120);
    expect(adapter.createSignedDownloadUrl).toHaveBeenLastCalledWith(KEY, 120);
  });

  it("forwards the disposition and file name", async () => {
    const adapter = adapterStub();
    await expect(serviceFor(adapter).issueDownload(KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV-2026-10-07.pdf" }))
      .resolves.toEqual({ url: "http://storage.local/signed/download", expiresInSeconds: 300 });
    expect(adapter.createSignedDownloadUrl).toHaveBeenCalledWith(KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV-2026-10-07.pdf" });
    await serviceFor(adapter).issueDownload(KEY, 300, { disposition: "inline" });
    expect(adapter.createSignedDownloadUrl).toHaveBeenLastCalledWith(KEY, 300, { disposition: "inline" });
  });

  it("rejects an invalid file name or disposition before any provider access", async () => {
    const adapter = adapterStub();
    const service = serviceFor(adapter);
    await expect(service.issueDownload(KEY, 300, { filename: "Ani Contoh.pdf" })).rejects.toMatchObject({ code: "STORAGE_DOWNLOAD_OPTIONS_INVALID" });
    await expect(service.issueDownload(KEY, 300, { filename: "../x.pdf" })).rejects.toMatchObject({ code: "STORAGE_DOWNLOAD_OPTIONS_INVALID" });
    await expect(service.issueDownload(KEY, 300, { disposition: "download" as never })).rejects.toMatchObject({ code: "STORAGE_DOWNLOAD_OPTIONS_INVALID" });
    expect(adapter.getObjectMetadata).not.toHaveBeenCalled();
    expect(adapter.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("still enforces the 300 second ceiling and the owner check with options present", async () => {
    const adapter = adapterStub();
    await expect(serviceFor(adapter).issueDownload(KEY, 301, { disposition: "inline" })).rejects.toMatchObject({ code: "STORAGE_TTL_INVALID" });
    await expect(serviceFor(adapter).issueDownload(KEY, 0, { disposition: "inline" })).rejects.toMatchObject({ code: "STORAGE_TTL_INVALID" });
    await expect(serviceFor(adapter, "22222222-2222-4222-8222-222222222222").issueDownload(KEY, 300, { disposition: "inline" }))
      .rejects.toMatchObject({ code: "STORAGE_OBJECT_UNAVAILABLE" });
    expect(adapter.createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
