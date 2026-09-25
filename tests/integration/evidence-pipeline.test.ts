import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Database } from "@/server/supabase/database.types";
import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import { SupabaseEvidenceRepository } from "@/server/storage/evidence-repository";
import { SupabaseStorageAdapter } from "@/server/storage/supabase-storage-adapter";
import { createEvidenceService } from "@/features/evidence/evidence-service";
import { createProjectService } from "@/features/project/project-service";
import { resolveMalwareScanner } from "@/server/storage/malware-scanner";
import { sha256Hex } from "@/features/evidence/file-inspection";
import { createSupabaseEvidenceWorkerGateway } from "../../workers/supabase-evidence-gateway.ts";
import { runEvidenceWorkerOnce } from "../../workers/evidence-worker.ts";
import { docxFixture, DOCX_MIME } from "../evidence-fixtures";

let admin: SupabaseClient;
let owner: SupabaseClient<Database>;
let userId = "";
let service: ReturnType<typeof createEvidenceService>;
let gateway: ReturnType<typeof createSupabaseEvidenceWorkerGateway>;
let storage: SupabaseStorageAdapter;
const scanner = resolveMalwareScanner({ mode: "clamav", clamdHost: "127.0.0.1", clamdPort: 13310 });
const cleanBytes = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");
const body = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });

async function drain() {
  for (let n = 0; n < 150; n++) {
    const result = await runEvidenceWorkerOnce({ ...gateway, scanner });
    if (!result.scanJobsClaimed && !result.cleanupJobsClaimed) return;
  }
  throw new Error("Evidence fixture queue did not drain");
}
async function reserve(bytes: Buffer = cleanBytes, contentType = "application/pdf") {
  const parent = await createProjectService(owner).createProject({ operationKey: randomUUID(), title: "Evidence pipeline", description: null, userRole: null, outcome: null, status: "active", experienceId: null, startDate: null, startPrecision: null, endDate: null, endPrecision: null, isCurrent: false });
  const file = await service.reserve({ parentKind: "project", parentId: parent.projectId, filename: contentType === DOCX_MIME ? "fixture.docx" : "fixture.pdf", contentType, expectedBytes: bytes.length, idempotencyKey: randomUUID(), expectedRevision: parent.revision });
  return { file, parent };
}

describe("T10 real Storage → finalize → ClamAV → download → cleanup", () => {
  beforeAll(async () => {
    const config = getSupabaseAdminConfig(); const pub = getSupabasePublicConfig();
    if (!config || !pub) throw new Error("Local Supabase environment required");
    admin = createClient(config.url, config.secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const email = `pipeline-${randomUUID()}@workpulse.test`; const password = randomBytes(18).toString("base64url") + "Aa1!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Pipeline fixture creation failed");
    userId = created.data.user.id;
    owner = createClient<Database>(pub.url, pub.publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    if ((await owner.auth.signInWithPassword({ email, password })).error) throw new Error("Pipeline fixture sign-in failed");
    storage = new SupabaseStorageAdapter(admin);
    service = createEvidenceService({ repository: new SupabaseEvidenceRepository(admin), storage, resolveActor: async () => ({ id: userId }) });
    gateway = createSupabaseEvidenceWorkerGateway(config);
    await drain();
  });
  afterAll(async () => {
    await owner?.auth.signOut();
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (gateway) await drain();
  });

  it("blocks quarantine download, survives upload replay and restart, and downloads exact clean bytes", async () => {
    const { file } = await reserve();
    await expect(service.download(file.id)).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
    const uploaded = await service.upload(file.id, file.revision, "application/pdf", body(cleanBytes));
    expect(uploaded.status).toBe("scanning");
    expect((await service.upload(file.id, file.revision, "application/pdf", body(cleanBytes))).id).toBe(file.id);
    await expect(service.download(file.id)).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
    // Recreate the gateway to prove no in-memory queue state is required.
    gateway = createSupabaseEvidenceWorkerGateway(getSupabaseAdminConfig()!);
    await drain();
    expect((await service.get(file.id)).status).toBe("ready");
    const link = await service.download(file.id, 3);
    const response = await fetch(link.url);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(cleanBytes);
    const foreign = createEvidenceService({ repository: new SupabaseEvidenceRepository(admin), storage, resolveActor: async () => ({ id: randomUUID() }) });
    await expect(foreign.download(file.id)).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
    await expect(service.download(file.id, 301)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("recovers an immutable object uploaded before a lost finalize response", async () => {
    const { file } = await reserve();
    await storage.uploadObject(file.objectKey, cleanBytes, { contentType: "application/pdf", metadata: { sha256: sha256Hex(cleanBytes) } });
    expect((await service.upload(file.id, file.revision, "application/pdf", body(cleanBytes))).status).toBe("scanning");
    await drain();
    expect((await service.get(file.id)).status).toBe("ready");
  });

  it("rejects MIME spoofing before object upload and persists failure", async () => {
    const bytes = Buffer.from("not-a-pdf"); const { file } = await reserve(bytes);
    await expect(service.upload(file.id, file.revision, "application/pdf", body(bytes))).rejects.toMatchObject({ code: "FILE_TYPE_INVALID" });
    expect((await service.get(file.id)).status).toBe("failed");
    expect(await storage.getObjectMetadata(file.objectKey)).toBeNull();
    await drain();
  });

  it("real malware screening prevents ready and physically cleans the rejected file", async () => {
    const signature = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
    const bytes = docxFixture({ "test-signature.txt": signature });
    const { file } = await reserve(bytes, DOCX_MIME);
    await service.upload(file.id, file.revision, DOCX_MIME, body(bytes));
    const scan = await runEvidenceWorkerOnce({ ...gateway, scanner });
    expect(scan.scanJobsRejected).toBe(1);
    await expect(service.download(file.id)).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
    await drain();
    expect(await storage.getObjectMetadata(file.objectKey)).toBeNull();
  });

  it("persists outage retry and cleans files after parent removal", async () => {
    const { file, parent } = await reserve();
    await service.upload(file.id, file.revision, "application/pdf", body(cleanBytes));
    const result = await runEvidenceWorkerOnce({ ...gateway, scanner: resolveMalwareScanner({ mode: "unavailable" }) });
    expect(result.scanJobsRetried).toBe(1);
    expect((await service.get(file.id)).status).toBe("scanning");
    await createProjectService(owner).deleteProject({ projectId: parent.projectId, expectedRevision: parent.revision });
    await expect(service.download(file.id)).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
    await drain();
    expect(await storage.getObjectMetadata(file.objectKey)).toBeNull();
  });
});
