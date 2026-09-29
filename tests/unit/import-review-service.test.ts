import { describe, expect, it, vi } from "vitest";

import { ImportServiceError, mapImportDatabaseError } from "@/features/import/import-errors";
import { createImportReviewService } from "@/features/import/import-review-service";

const BATCH = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const ITEM = "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";

const COMMIT_RESULT = {
  schema_version: "import-commit.v1",
  counts: {
    profile: { created: 0, mapped: 0, skipped: 0 }, experience: { created: 2, mapped: 0, skipped: 0 }, education: { created: 0, mapped: 0, skipped: 0 },
    certification: { created: 0, mapped: 0, skipped: 0 }, skill: { created: 1, mapped: 0, skipped: 0 }, achievement: { created: 1, mapped: 0, skipped: 0 },
  },
  confirmed_achievements: 1, profile_fields_applied: 0, onboarding_completed: false, batch_id: BATCH, committed_at: "2026-10-01T09:00:00.000000Z",
};

function setup(reply: { data?: unknown; error?: { code?: string; message?: string; details?: string } | null }) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }));
  const client = { rpc, from: vi.fn() };
  return { rpc, client, service: createImportReviewService({ client: client as never }) };
}

async function failure(promise: Promise<unknown>): Promise<ImportServiceError> {
  try { await promise; } catch (error) { if (error instanceof ImportServiceError) return error; throw error; }
  throw new Error("expected failure");
}

describe("T16 import review service", () => {
  it("rejects malformed input before any RPC", async () => {
    const { rpc, service } = setup({});
    expect((await failure(service.updateItem({ item_id: "x", expected_revision: 1 }))).code).toBe("VALIDATION");
    expect((await failure(service.updateItem({ item_id: ITEM, expected_revision: 1, user_id: ITEM }))).code).toBe("VALIDATION");
    expect((await failure(service.commit({ batch_id: BATCH, expected_revision: 0 }))).code).toBe("VALIDATION");
    expect((await failure(service.validate("../etc"))).code).toBe("NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes review choices to update_import_item with nulls for omitted values", async () => {
    const { rpc, service } = setup({ data: [{ item_id: ITEM, item_revision: 3, batch_revision: 7 }] });
    const result = await service.updateItem({
      item_id: ITEM, expected_revision: 2, action: "create", payload_patch: { role_title: "Lead" }, confirm_requested: true,
    });
    expect(result).toEqual({ itemId: ITEM, itemRevision: 3, batchRevision: 7 });
    expect(rpc).toHaveBeenCalledWith("update_import_item", {
      p_item_id: ITEM, p_expected_revision: 2, p_action: "create", p_target_id: null,
      p_payload_patch: { role_title: "Lead" }, p_confirm_requested: true,
    });
  });

  it("returns validation errors as ids and codes only", async () => {
    const rows = [{ item_id: ITEM, field: "role_title", code: "REQUIRED", existing_id: null }];
    const { service } = setup({ data: rows });
    expect(await service.validate(BATCH)).toEqual([{ item_id: ITEM, field: "role_title", code: "REQUIRED" }]);
  });

  it("commits with the expected revision and optional onboarding, and repeats the same result", async () => {
    const { rpc, service } = setup({ data: COMMIT_RESULT });
    const onboarding = { display_name: "Dewi Nyata", locale: "id", timezone: "Asia/Jakarta" };
    const first = await service.commit({ batch_id: BATCH, expected_revision: 5, onboarding });
    const second = await service.commit({ batch_id: BATCH, expected_revision: 5, onboarding });
    expect(second).toEqual(first);
    expect(first.counts.experience.created).toBe(2);
    expect(rpc).toHaveBeenCalledWith("commit_import_batch", { p_batch_id: BATCH, p_expected_revision: 5, p_onboarding: onboarding });
    await service.commit({ batch_id: BATCH, expected_revision: 5 });
    expect(rpc).toHaveBeenLastCalledWith("commit_import_batch", { p_batch_id: BATCH, p_expected_revision: 5, p_onboarding: null });
  });

  it("treats a result of an unexpected shape as unavailable", async () => {
    const { service } = setup({ data: { schema_version: "other" } });
    expect((await failure(service.commit({ batch_id: BATCH, expected_revision: 1 }))).code).toBe("UNAVAILABLE");
  });

  it("maps every database code to a stable service code, message key and correlation id", () => {
    const expectations: Array<[string, string, number]> = [
      ["AUTH_REQUIRED", "UNAUTHENTICATED", 401],
      ["IMPORT_NOT_FOUND", "NOT_FOUND", 404],
      ["STALE_REVISION", "STALE", 409],
      ["IMPORT_NOT_COMMITTABLE", "NOT_COMMITTABLE", 409],
      ["IMPORT_NOT_REVIEWABLE", "NOT_REVIEWABLE", 409],
      ["IMPORT_TARGET_INVALID", "TARGET_INVALID", 422],
      ["INVALID_IMPORT_ITEM_INPUT", "VALIDATION", 400],
      ["ONBOARDING_REQUIRED", "ONBOARDING_REQUIRED", 422],
      ["INVALID_DISPLAY_NAME", "ONBOARDING_INVALID", 422],
      ["INVALID_LOCALE", "ONBOARDING_INVALID", 422],
      ["INVALID_TIMEZONE", "ONBOARDING_INVALID", 422],
      ["IMPORT_ITEM_INVALID", "ITEM_INVALID", 422],
    ];
    for (const [message, code, status] of expectations) {
      const error = mapImportDatabaseError({ message });
      expect(error.code, message).toBe(code);
      expect(error.status, message).toBe(status);
      expect(error.messageKey.length).toBeGreaterThan(0);
      expect(error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(mapImportDatabaseError({ code: "40001", message: `raw ${SENTINEL}` }).code).toBe("UNAVAILABLE");
  });

  it("attaches item errors to IMPORT_ITEM_INVALID and drops details with extra properties", async () => {
    const good = JSON.stringify([{ item_id: ITEM, field: "role_title", code: "REQUIRED" }]);
    const { service } = setup({ error: { code: "22023", message: "IMPORT_ITEM_INVALID", details: good } });
    const error = await failure(service.commit({ batch_id: BATCH, expected_revision: 1 }));
    expect(error.code).toBe("ITEM_INVALID");
    expect(error.itemErrors).toEqual([{ item_id: ITEM, field: "role_title", code: "REQUIRED" }]);

    const leaky = JSON.stringify([{ item_id: ITEM, field: "role_title", code: "REQUIRED", value: SENTINEL }]);
    const { service: other } = setup({ error: { code: "22023", message: "IMPORT_ITEM_INVALID", details: leaky } });
    const second = await failure(other.commit({ batch_id: BATCH, expected_revision: 1 }));
    expect(second.code).toBe("ITEM_INVALID");
    expect(second.itemErrors).toEqual([]);
    expect(JSON.stringify(second)).not.toContain(SENTINEL);
    expect(second.message).not.toContain(SENTINEL);
  });

  it("never echoes database text in service errors", async () => {
    const { service } = setup({ error: { code: "XX000", message: `boom ${SENTINEL} cv-WP-FILENAME.pdf`, details: SENTINEL } });
    const error = await failure(service.commit({ batch_id: BATCH, expected_revision: 1 }));
    expect(error.code).toBe("UNAVAILABLE");
    expect(JSON.stringify({ code: error.code, message: error.message, key: error.messageKey })).not.toMatch(/WP-PRIVATE|WP-FILENAME/);
  });
});
