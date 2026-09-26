import { describe, expect, it, vi } from "vitest";
import { createEvidenceService } from "@/features/evidence/evidence-service";
import { toPublicEvidenceRecord, type EvidenceRecord } from "@/features/evidence/contracts";
import type { EvidenceRepository } from "@/server/storage/evidence-repository";
import type { StorageAdapter } from "@/server/storage/adapter";

const ownerId = "11111111-1111-4111-8111-111111111111";
const activityId = "22222222-2222-4222-8222-222222222222";
const achievementId = "33333333-3333-4333-8333-333333333333";
const evidenceId = "44444444-4444-4444-8444-444444444444";

const source: EvidenceRecord = {
  id: evidenceId, userId: ownerId, parentKind: "activity", parentId: activityId,
  filename: "proof.pdf", contentType: "application/pdf", expectedBytes: 100, actualBytes: 100,
  sha256: "a".repeat(64), objectKey: `${ownerId}/evidence/${evidenceId}`, status: "ready",
  revision: 3, parentRevision: 1, reservationExpiresAt: null, createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: "2026-09-25T00:01:00.000Z", failureCode: null, scanJobId: achievementId,
};

function makeService(repository: Partial<EvidenceRepository>) {
  return createEvidenceService({
    repository: repository as EvidenceRepository,
    storage: {} as StorageAdapter,
    resolveActor: async () => ({ id: ownerId }),
  });
}

describe("Evidence lifecycle service", () => {
  it("lists only records matching the requested owner and exact direct parent", async () => {
    const list = vi.fn(async () => [source]);
    const service = makeService({ list });
    const result = await service.list("activity", activityId);
    expect(list).toHaveBeenCalledWith(ownerId, "activity", activityId);
    expect(result).toEqual([source]);
    const publicRecord = toPublicEvidenceRecord(result[0]!);
    expect(publicRecord).not.toHaveProperty("userId");
    expect(publicRecord).not.toHaveProperty("objectKey");
    expect(publicRecord).not.toHaveProperty("sha256");
  });

  it("passes the authenticated owner and optimistic revisions to the move repository call", async () => {
    const moveToAchievement = vi.fn(async () => ({ ...source, parentKind: "achievement" as const, parentId: achievementId, parentRevision: 4, revision: 4 }));
    const service = makeService({ moveToAchievement });
    const result = await service.moveToAchievement(evidenceId, { targetAchievementId: achievementId, expectedRevision: 3, expectedTargetRevision: 4 });
    expect(moveToAchievement).toHaveBeenCalledWith(ownerId, evidenceId, { targetAchievementId: achievementId, expectedRevision: 3, expectedTargetRevision: 4 });
    expect(result.parentId).toBe(achievementId);
    await expect(service.moveToAchievement(evidenceId, { targetAchievementId: achievementId, expectedRevision: 3, expectedTargetRevision: -1 })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(moveToAchievement).toHaveBeenCalledTimes(1);
  });
});
