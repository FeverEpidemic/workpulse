import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { PRIVATE_STORAGE_BUCKET } from "@/server/storage/constants";
import { createStorageObjectKey } from "@/server/storage/object-key";
import { createPrivateStorageService, PrivateStorageError } from "@/server/storage/private-storage-service";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

let adminClient: SupabaseClient | null = null;
let ownerClient: SupabaseClient | null = null;
let otherClient: SupabaseClient | null = null;
let ownerId: string | null = null;
let otherId: string | null = null;
let ownerEmail: string | null = null;
let otherEmail: string | null = null;
let ownerPassword: string | null = null;
let otherPassword: string | null = null;
const createdObjectKeys: string[] = [];

function requireResult<T>(data: T | null, error: unknown, label: string): T {
  if (error || data === null) throw new Error("Local storage integration setup failed: " + label);
  return data;
}

function readErrorCode(error: unknown): string | null {
  return error instanceof PrivateStorageError ? error.code : null;
}

describe("local private Storage integration", () => {
  beforeAll(async () => {
    const adminConfig = getSupabaseAdminConfig();
    const publicConfig = getSupabasePublicConfig();
    if (!adminConfig || !publicConfig) {
      throw new Error("Set local Supabase URL, publishable key, and server secret key before running this test");
    }

    adminClient = createClient(adminConfig.url, adminConfig.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const suffix = randomUUID().replaceAll("-", "");
    ownerEmail = "storage-owner-" + suffix + "@workpulse.test";
    otherEmail = "storage-other-" + suffix + "@workpulse.test";
    ownerPassword = randomBytes(18).toString("base64url") + "Aa1!";
    otherPassword = randomBytes(18).toString("base64url") + "Bb2!";

    const ownerResult = await adminClient.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { display_name: "Storage owner" },
    });
    const owner = requireResult(ownerResult.data.user, ownerResult.error, "owner creation");

    ownerId = owner.id;
    const otherResult = await adminClient.auth.admin.createUser({
      email: otherEmail,
      password: otherPassword,
      email_confirm: true,
      user_metadata: { display_name: "Storage other" },
    });
    const other = requireResult(otherResult.data.user, otherResult.error, "second account creation");
    otherId = other.id;

    ownerClient = createClient(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    otherClient = createClient(publicConfig.url, publicConfig.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const ownerSignIn = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    requireResult(ownerSignIn.data.user, ownerSignIn.error, "owner sign-in");

    const otherSignIn = await otherClient.auth.signInWithPassword({
      email: otherEmail,
      password: otherPassword,
    });
    requireResult(otherSignIn.data.user, otherSignIn.error, "second account sign-in");
  });

  afterAll(async () => {
    if (adminClient) {
      if (createdObjectKeys.length > 0) {
        await adminClient.storage.from(PRIVATE_STORAGE_BUCKET).remove(createdObjectKeys);
      }
      if (ownerId) await adminClient.auth.admin.deleteUser(ownerId);
      if (otherId) await adminClient.auth.admin.deleteUser(otherId);
    }
    await ownerClient?.auth.signOut();
    await otherClient?.auth.signOut();
  });

  it("authorizes two accounts, returns an attachment URL, blocks direct access, and enforces expiry", async () => {
    if (!adminClient || !ownerClient || !otherClient || !ownerId || !otherId) {
      throw new Error("Local storage integration clients are unavailable");
    }

    const ownerUserResult = await ownerClient.auth.getUser();
    const ownerUser = requireResult(ownerUserResult.data.user, ownerUserResult.error, "owner session lookup");
    expect(ownerUser.id).toBe(ownerId);

    // T10 evidence authorization is exercised by the evidence integration suite.
    // This foundation test deliberately uses the independent import category.
    const objectKey = createStorageObjectKey(ownerId, "import");
    const fixture = Buffer.from("%PDF-1.7\nWorkPulse storage test fixture\n%%EOF\n");
    const cleanupKeys: string[] = [];

    try {
      const upload = await adminClient.storage.from(PRIVATE_STORAGE_BUCKET).upload(objectKey, fixture, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upload.error) throw new Error("Local storage integration setup failed: privileged fixture upload");
      cleanupKeys.push(objectKey);
      createdObjectKeys.push(objectKey);

      const ownerService = createPrivateStorageService(
        new SupabaseStorageAdapter(adminClient),
        async () => ({ id: ownerUser.id }),
      );

      const issued = await ownerService.issueDownload(objectKey, 3);
      expect(issued.expiresInSeconds).toBe(3);
      const usableResponse = await fetch(issued.url, { cache: "no-store" });
      expect(usableResponse.ok).toBe(true);
      expect(usableResponse.headers.get("content-disposition")?.toLowerCase()).toContain("attachment");
      expect(Buffer.from(await usableResponse.arrayBuffer()).equals(fixture)).toBe(true);

      const otherUserResult = await otherClient.auth.getUser();
      const otherUser = requireResult(otherUserResult.data.user, otherUserResult.error, "second session lookup");
      expect(otherUser.id).toBe(otherId);

      const otherService = createPrivateStorageService(
        new SupabaseStorageAdapter(adminClient),
        async () => ({ id: otherUser.id }),
      );
      const foreignError = await otherService.issueDownload(objectKey).catch((error: unknown) => error);
      expect(readErrorCode(foreignError)).toBe("STORAGE_OBJECT_UNAVAILABLE");

      const ownerDirectSigning = await ownerClient.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .createSignedUrl(objectKey, 3600);
      expect(ownerDirectSigning.error).not.toBeNull();

      const foreignDirectSigning = await otherClient.storage
        .from(PRIVATE_STORAGE_BUCKET)
        .createSignedUrl(objectKey, 3600);
      expect(foreignDirectSigning.error).not.toBeNull();

      await ownerClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
      const afterOwnerDelete = await adminClient.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      expect(afterOwnerDelete.error).toBeNull();
      expect(afterOwnerDelete.data?.name).toBe(objectKey);

      await otherClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([objectKey]);
      const afterForeignDelete = await adminClient.storage.from(PRIVATE_STORAGE_BUCKET).info(objectKey);
      expect(afterForeignDelete.error).toBeNull();
      expect(afterForeignDelete.data?.name).toBe(objectKey);

      const unauthorizedObjectKey = createStorageObjectKey(ownerId, "evidence");
      const directUpload = await ownerClient.storage.from(PRIVATE_STORAGE_BUCKET).upload(
        unauthorizedObjectKey,
        fixture,
        { contentType: "application/pdf", upsert: false },
      );
      expect(directUpload.error).not.toBeNull();
      if (!directUpload.error) {
        cleanupKeys.push(unauthorizedObjectKey);
        createdObjectKeys.push(unauthorizedObjectKey);
      }

      const publicUrl = adminClient.storage.from(PRIVATE_STORAGE_BUCKET).getPublicUrl(objectKey).data.publicUrl;
      const publicResponse = await fetch(publicUrl, { cache: "no-store" });
      expect(publicResponse.ok).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 3_500));
      const expiredResponse = await fetch(issued.url, { cache: "no-store" });
      expect(expiredResponse.ok).toBe(false);
    } finally {
      for (const key of cleanupKeys) {
        const removal = await adminClient.storage.from(PRIVATE_STORAGE_BUCKET).remove([key]);
        if (removal.error) throw new Error("Local storage integration fixture cleanup failed");
        const index = createdObjectKeys.indexOf(key);
        if (index >= 0) createdObjectKeys.splice(index, 1);
      }
    }
  });
});
