import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { runEvidenceWorkerOnce, type EvidenceScanJob, type EvidenceWorkerDatabase, type EvidenceWorkerStorage } from "../../workers/evidence-worker.ts";

function harness() {
  const bytes = Buffer.from("%PDF-1.7\nfixture\n"); const user = randomUUID(); const evidence = randomUUID();
  const job: EvidenceScanJob = { id: randomUUID(), user_id: user, evidence_id: evidence, object_key: `${user}/evidence/${evidence}`, expected_bytes: bytes.length, content_type: "application/pdf", sha256: createHash("sha256").update(bytes).digest("hex"), attempt_count: 1, attempt_token: randomUUID(), lease_expires_at: new Date(Date.now() + 120_000).toISOString() };
  const database = {
    isEvidenceScanCurrent: vi.fn(async () => true),
    claimEvidenceScanJobs: vi.fn(async () => [job]),
    completeEvidenceScanJob: vi.fn(async () => true),
    retryEvidenceScanJob: vi.fn(async () => true),
    claimEvidenceCleanupJobs: vi.fn(async () => []),
    completeEvidenceCleanupJob: vi.fn(async () => true),
    failEvidenceCleanupJob: vi.fn(async () => true),
    retryEvidenceCleanupJob: vi.fn(async () => true),
    expireEvidenceUploads: vi.fn(async () => 0),
    reconcileOrphanEvidenceObjects: vi.fn(async () => 0),
  } satisfies EvidenceWorkerDatabase;
  const storage = { downloadObject: vi.fn(async () => bytes), getObjectMetadata: vi.fn(async (): Promise<unknown | null> => null), removeObject: vi.fn(async () => undefined) } satisfies EvidenceWorkerStorage;
  const scanner = { scan: vi.fn(async () => ({ status: "clean" as const })) };
  return { job, database, storage, scanner };
}
describe("evidence worker fences", () => {
  it("does not read or scan after source/account becomes unavailable", async () => {
    const h = harness(); h.database.isEvidenceScanCurrent.mockResolvedValue(false);
    expect((await runEvidenceWorkerOnce(h)).scanJobsRejected).toBe(1);
    expect(h.storage.downloadObject).not.toHaveBeenCalled(); expect(h.scanner.scan).not.toHaveBeenCalled();
  });
  it("detects changed object bytes before calling scanner", async () => {
    const h = harness(); h.storage.downloadObject.mockResolvedValue(Buffer.from("different bytes"));
    expect((await runEvidenceWorkerOnce(h)).scanJobsRejected).toBe(1);
    expect(h.scanner.scan).not.toHaveBeenCalled();
    expect(h.database.completeEvidenceScanJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "OBJECT_CONTENT_MISMATCH", attemptToken: h.job.attempt_token }));
  });
  it("rechecks authorization after download and before scanner submission", async () => {
    const h = harness(); h.database.isEvidenceScanCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await runEvidenceWorkerOnce(h); expect(h.scanner.scan).not.toHaveBeenCalled();
  });
  it("persists transient retry and never reports stale completion as clean", async () => {
    const h = harness();
    const unavailable = { scan: async () => ({ status: "unavailable" as const, errorCode: "SCANNER_UNAVAILABLE" as const }) };
    expect((await runEvidenceWorkerOnce({ ...h, scanner: unavailable })).scanJobsRetried).toBe(1);
    expect(h.database.retryEvidenceScanJob).toHaveBeenCalledWith(expect.objectContaining({ attemptToken: h.job.attempt_token, errorCode: "SCANNER_UNAVAILABLE" }));
    h.database.completeEvidenceScanJob.mockResolvedValue(false);
    const stale = await runEvidenceWorkerOnce(h);
    expect(stale.scanJobsClean).toBe(0); expect(stale.staleCompletions).toBe(1);
  });
  it("requires confirmed object absence before cleanup completion", async () => {
    const h = harness(); h.database.claimEvidenceScanJobs.mockResolvedValue([]);
    const database: EvidenceWorkerDatabase = { ...h.database, claimEvidenceCleanupJobs: async () => [h.job] };
    h.storage.getObjectMetadata.mockResolvedValue({ size: 1 });
    const result = await runEvidenceWorkerOnce({ ...h, database });
    expect(result.cleanupJobsRetried).toBe(1);
    expect(h.database.completeEvidenceCleanupJob).not.toHaveBeenCalled();
    expect(h.database.retryEvidenceCleanupJob).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "OBJECT_DELETE_UNVERIFIED" }));
  });
});
