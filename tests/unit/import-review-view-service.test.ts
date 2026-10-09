import { describe, expect, it, vi } from "vitest";

import { ImportServiceError } from "@/features/import/import-errors";
import { createImportReviewViewService, REVIEW_TARGET_LIMIT } from "@/features/import/import-review-view-service";

const BATCH = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const ITEM = "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const OWNER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SKILL = "4f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SENTINEL = "WP-PRIVATE-IMPORT-SENTINEL";

type Reply = { data: unknown; error?: unknown };

function setup(replies: { batch?: Reply; items?: Reply; profile?: Reply; targets?: Record<string, Reply>; rpc?: Reply }) {
  const selects: { table: string; columns: string }[] = [];
  const limits: number[] = [];
  const rpc = vi.fn(async () => ({ data: replies.rpc?.data ?? [], error: replies.rpc?.error ?? null }));
  const from = vi.fn((table: string) => {
    const reply: Reply = table === "import_batches" ? (replies.batch ?? { data: null })
      : table === "import_items" ? (replies.items ?? { data: [] })
      : table === "profiles" ? (replies.profile ?? { data: { onboarding_completed_at: "2026-09-01T00:00:00Z" } })
      : (replies.targets?.[table] ?? { data: [] });
    const chain: Record<string, unknown> = {
      select: (columns: string) => { selects.push({ table, columns }); return chain; },
      eq: () => chain,
      order: () => chain,
      limit: (count: number) => { limits.push(count); return chain; },
      maybeSingle: async () => ({ data: reply.data, error: reply.error ?? null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: reply.data, error: reply.error ?? null }),
    };
    return chain;
  });
  const client = { from, rpc };
  return { from, rpc, selects, limits, service: createImportReviewViewService({ client: client as never, actorId: OWNER }) };
}

const batchRow = (status: string, extra: Record<string, unknown> = {}) => ({
  id: BATCH, filename: "cv.pdf", status, stage: "done", error_code: null, revision: 4, commit_result: null, ...extra,
});
const itemRow = (extra: Record<string, unknown> = {}) => ({
  id: ITEM, entity_type: "skill", ordinal: 1, action: "create", target_id: null, confirm_requested: false,
  payload: { name: "SQL" }, source_excerpt: "SKILL|SQL", revision: 1, ...extra,
});

async function failure(promise: Promise<unknown>): Promise<ImportServiceError> {
  try { await promise; } catch (error) { if (error instanceof ImportServiceError) return error; throw error; }
  throw new Error("expected failure");
}

describe("T17 import review view service", () => {
  it("treats a non-UUID or missing batch as the same generic NOT_FOUND without touching other tables", async () => {
    const { service, from } = setup({ batch: { data: null } });
    expect((await failure(service.getReviewView("../etc"))).code).toBe("NOT_FOUND");
    expect(from).not.toHaveBeenCalled();
    expect((await failure(service.getReviewView(BATCH))).code).toBe("NOT_FOUND");
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("reports unreadable or malformed rows as UNAVAILABLE, never a crash", async () => {
    expect((await failure(setup({ batch: { data: null, error: { message: "boom" } } }).service.getReviewView(BATCH))).code).toBe("UNAVAILABLE");
    expect((await failure(setup({ batch: { data: batchRow("bogus") } }).service.getReviewView(BATCH))).code).toBe("UNAVAILABLE");
    const badItem = setup({ batch: { data: batchRow("review") }, items: { data: [itemRow({ action: "explode" })] } });
    expect((await failure(badItem.service.getReviewView(BATCH))).code).toBe("UNAVAILABLE");
    const noProfile = setup({ batch: { data: batchRow("review") }, profile: { data: null } });
    expect((await failure(noProfile.service.getReviewView(BATCH))).code).toBe("UNAVAILABLE");
  });

  it("loads targets and validation only for a batch in review, limited to 200 owned rows per type", async () => {
    const { service, rpc, limits, selects } = setup({
      batch: { data: batchRow("review") },
      items: { data: [itemRow()] },
      targets: { skills: { data: [{ id: SKILL, name: "SQL", normalized_name: "sql" }] } },
      rpc: { data: [{ item_id: ITEM, field: "name", code: "DUPLICATE", existing_id: SKILL }] },
    });
    const snapshot = await service.getReviewView(BATCH);
    expect(REVIEW_TARGET_LIMIT).toBe(200);
    expect(limits).toEqual([200, 200, 200, 200, 200]);
    expect(rpc).toHaveBeenCalledWith("validate_import_batch", { p_batch_id: BATCH });
    expect(snapshot.targets.skill).toEqual([{ id: SKILL, label: "SQL", match: null }]);
    expect(snapshot.errors).toEqual([{ item_id: ITEM, field: "name", code: "DUPLICATE", existing_id: SKILL }]);
    expect(snapshot.profile.onboarded).toBe(true);
    // Only the columns the view needs are requested.
    expect(selects.find((s) => s.table === "import_batches")!.columns).toBe("id, filename, status, stage, error_code, revision, commit_result, updated_at");
    expect(selects.find((s) => s.table === "experiences")!.columns).toBe("id, organization, role_title, start_date, start_precision");
    expect(selects.find((s) => s.table === "skills")!.columns).toBe("id, name, normalized_name");
  });

  it("reports the latest of the batch and item update times as the last activity, and keeps item timestamps out of the snapshot", async () => {
    const { service } = setup({
      batch: { data: batchRow("review", { updated_at: "2026-09-01T10:00:00Z" }) },
      items: { data: [itemRow({ updated_at: "2026-09-20T08:30:00Z" }), itemRow({ id: "5f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f", updated_at: "2026-09-10T08:30:00Z" })] },
      targets: { skills: { data: [] } },
      rpc: { data: [] },
    });
    const snapshot = await service.getReviewView(BATCH);
    expect(snapshot.batch.last_activity_at).toBe("2026-09-20T08:30:00Z");
    expect(snapshot.items.every((item) => !("updated_at" in item))).toBe(true);
  });

  it("falls back to the batch time, and to null when no time is readable", async () => {
    const batchOnly = await setup({ batch: { data: batchRow("committed", { updated_at: "2026-09-01T10:00:00Z" }) }, items: { data: [] } }).service.getReviewView(BATCH);
    expect(batchOnly.batch.last_activity_at).toBe("2026-09-01T10:00:00Z");
    const none = await setup({ batch: { data: batchRow("committed", { updated_at: "not a date" }) }, items: { data: [] } }).service.getReviewView(BATCH);
    expect(none.batch.last_activity_at).toBeNull();
  });

  it("skips targets and validation for committed batches and reads the stored result", async () => {
    const stored = {
      schema_version: "import-commit.v1",
      counts: Object.fromEntries(["profile", "experience", "education", "certification", "skill", "achievement"].map((t) => [t, { created: 1, mapped: 0, skipped: 0 }])),
      confirmed_achievements: 0, profile_fields_applied: 0, onboarding_completed: true,
    };
    const { service, rpc, limits } = setup({ batch: { data: batchRow("committed", { commit_result: stored }) }, items: { data: [] } });
    const snapshot = await service.getReviewView(BATCH);
    expect(rpc).not.toHaveBeenCalled();
    expect(limits).toEqual([]);
    expect(snapshot.batch.commit_result).toEqual(stored);
    const legacy = await setup({ batch: { data: batchRow("committed") } }).service.getReviewView(BATCH);
    expect(legacy.batch.commit_result).toBeNull();
    const garbled = await setup({ batch: { data: batchRow("committed", { commit_result: { counts: "x" } }) } }).service.getReviewView(BATCH);
    expect(garbled.batch.commit_result).toBeNull();
  });

  it("labels owned records without ids or unrelated columns and builds duplicate keys", async () => {
    const { service } = setup({
      batch: { data: batchRow("review") },
      items: { data: [] },
      targets: {
        experiences: { data: [{ id: SKILL, organization: "PT Lama", role_title: "Staf", start_date: "2020-01-01", start_precision: "year", secret: SENTINEL }] },
        certifications: { data: [{ id: SKILL, name: "AWS", issuer: null }] },
      },
    });
    const snapshot = await service.getReviewView(BATCH);
    expect(snapshot.targets.experience).toEqual([{ id: SKILL, label: "Staf · PT Lama", match: "pt lama\u0000staf" }]);
    expect(snapshot.targets.certification).toEqual([{ id: SKILL, label: "AWS", match: "aws\u0000" }]);
    expect(JSON.stringify(snapshot)).not.toContain(SENTINEL);
  });

  it("never puts candidate text in a thrown error", async () => {
    const { service } = setup({ batch: { data: batchRow("review") }, items: { data: [itemRow({ payload: { name: SENTINEL }, source_excerpt: SENTINEL, action: "explode" })] } });
    const error = await failure(service.getReviewView(BATCH));
    expect(JSON.stringify({ message: error.message, code: error.code, key: error.messageKey })).not.toContain(SENTINEL);
  });
});
