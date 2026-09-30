import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args), auth: { getUser: () => getUser() } }),
}));
vi.mock("@/server/supabase/admin", () => ({ getSupabaseAdminClient: () => ({}) }));
vi.mock("@/server/storage/supabase-storage-adapter", () => ({ SupabaseStorageAdapter: class {} }));

import { commitImportAction, updateImportItemAction, validateImportAction } from "@/features/import/actions";

const BATCH = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const ITEM = "2f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";

const RESULT = {
  schema_version: "import-commit.v1",
  counts: {
    profile: { created: 0, mapped: 0, skipped: 0 }, experience: { created: 1, mapped: 0, skipped: 0 }, education: { created: 0, mapped: 0, skipped: 0 },
    certification: { created: 0, mapped: 0, skipped: 0 }, skill: { created: 0, mapped: 0, skipped: 0 }, achievement: { created: 0, mapped: 0, skipped: 0 },
  },
  confirmed_achievements: 0, profile_fields_applied: 0, onboarding_completed: false, batch_id: BATCH, committed_at: "2026-10-01T09:00:00.000000Z",
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("T16 import review actions", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" } }, error: null });
  });

  it("commits with the session identity and revalidates the dashboard only after success", async () => {
    rpc.mockResolvedValue({ data: RESULT, error: null });
    const state = await commitImportAction({ status: "idle" }, form({ batch_id: BATCH, expected_revision: "4" }));
    expect(state.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("commit_import_batch", { p_batch_id: BATCH, p_expected_revision: 4, p_onboarding: null });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("passes onboarding fields through to the commit", async () => {
    rpc.mockResolvedValue({ data: RESULT, error: null });
    await commitImportAction({ status: "idle" }, form({
      batch_id: BATCH, expected_revision: "4", onboarding_display_name: "Dewi Nyata", onboarding_locale: "id", onboarding_timezone: "Asia/Jakarta",
    }));
    expect(rpc).toHaveBeenCalledWith("commit_import_batch", {
      p_batch_id: BATCH, p_expected_revision: 4, p_onboarding: { display_name: "Dewi Nyata", locale: "id", timezone: "Asia/Jakarta" },
    });
  });

  it("rejects malformed input without a database call or revalidation", async () => {
    const state = await commitImportAction({ status: "idle" }, form({ batch_id: "nope", expected_revision: "4" }));
    expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    const other = await updateImportItemAction({ status: "idle" }, form({ item_id: ITEM, expected_revision: "1", payload_patch: "{not json" }));
    expect(other).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not revalidate when the commit fails and reports item errors as ids and codes", async () => {
    const detail = JSON.stringify([{ item_id: ITEM, field: "role_title", code: "REQUIRED" }]);
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "IMPORT_ITEM_INVALID", details: detail } });
    const state = await commitImportAction({ status: "idle" }, form({ batch_id: BATCH, expected_revision: "4" }));
    expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION", latestRecord: { itemErrors: [{ item_id: ITEM, field: "role_title", code: "REQUIRED" }] } } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await commitImportAction({ status: "idle" }, form({ batch_id: BATCH, expected_revision: "4" }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("revalidates the record surfaces a commit changes, never on failure", async () => {
    rpc.mockResolvedValue({ data: RESULT, error: null });
    await commitImportAction({ status: "idle" }, form({ batch_id: BATCH, expected_revision: "4" }));
    expect(revalidatePath.mock.calls.map((call) => call[0]).sort()).toEqual(["/dashboard", "/settings/profile", "/timeline"]);
  });

  it("validates a batch as the session user without revalidating anything", async () => {
    rpc.mockResolvedValue({ data: [{ item_id: ITEM, field: "role_title", code: "REQUIRED", existing_id: null }], error: null });
    const state = await validateImportAction({ status: "idle" }, form({ batch_id: BATCH }));
    expect(state).toMatchObject({ status: "success", data: [{ item_id: ITEM, field: "role_title", code: "REQUIRED" }] });
    expect(rpc).toHaveBeenCalledWith("validate_import_batch", { p_batch_id: BATCH });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await validateImportAction({ status: "idle" }, form({ batch_id: "nope" }))).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await validateImportAction({ status: "idle" }, form({ batch_id: BATCH }))).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
  });

  it("saves one review choice with a parsed payload patch", async () => {
    rpc.mockResolvedValue({ data: [{ item_id: ITEM, item_revision: 2, batch_revision: 5 }], error: null });
    const state = await updateImportItemAction({ status: "idle" }, form({
      item_id: ITEM, expected_revision: "1", action: "create", payload_patch: JSON.stringify({ role_title: "Lead" }), confirm_requested: "true",
    }));
    expect(state.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("update_import_item", {
      p_item_id: ITEM, p_expected_revision: 1, p_action: "create", p_target_id: null, p_payload_patch: { role_title: "Lead" }, p_confirm_requested: true,
    });
  });

  it("maps a stale revision to a conflict", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    const state = await updateImportItemAction({ status: "idle" }, form({ item_id: ITEM, expected_revision: "1" }));
    expect(state).toMatchObject({ status: "error", error: { code: "CONFLICT" } });
  });
});
