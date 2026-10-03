import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: (...args: unknown[]) => rpc(...args), auth: { getUser: () => getUser() } }),
}));

import {
  ensureCvAction,
  removeCvItemAction,
  reorderCvSectionAction,
  resolveCvFreshnessAction,
  saveCvEditsAction,
  selectCvSourceAction,
  updateCvLayoutAction,
} from "@/features/cv/actions";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SOURCE = "a5000000-0000-4000-8000-000000000001";
const ITEM_A = "a7000000-0000-4000-8000-000000000001";
const ITEM_B = "a7000000-0000-4000-8000-000000000002";
const IDLE = { status: "idle" } as const;

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(key, entry);
  }
  return data;
}

describe("T18 CV actions", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  });

  it("selects a source, then revalidates /cv only after success", async () => {
    rpc.mockResolvedValue({ data: [{ cv_revision: 2, item_ids: [ITEM_A], parent_item_ids: [] }], error: null });
    const state = await selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "skill", source_id: SOURCE }));
    expect(state.status).toBe("success");
    expect(rpc).toHaveBeenCalledWith("select_cv_source", { p_expected_revision: 1, p_source_type: "skill", p_source_id: SOURCE });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
  });

  it("opens the CV on ensure", async () => {
    rpc.mockResolvedValue({ data: [{ cv_id: SOURCE, revision: 1, created: true }], error: null });
    const state = await ensureCvAction(IDLE);
    expect(state).toMatchObject({ status: "success", data: { cvId: SOURCE, created: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
  });

  it("rejects malformed input without a database call or revalidation", async () => {
    const results = await Promise.all([
      selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "hobby", source_id: SOURCE })),
      selectCvSourceAction(IDLE, form({ expected_revision: "abc", source_type: "skill", source_id: SOURCE })),
      removeCvItemAction(IDLE, form({ expected_revision: "1", item_id: ITEM_A })),
      removeCvItemAction(IDLE, form({ expected_revision: "1", item_id: ITEM_A, remove_children: "maybe" })),
      reorderCvSectionAction(IDLE, form({ expected_revision: "1", section_key: "skills", item_id: [ITEM_A, ITEM_A] })),
      reorderCvSectionAction(IDLE, form({ expected_revision: "1", section_key: "hobbies", item_id: [ITEM_A] })),
      updateCvLayoutAction(IDLE, form({ expected_revision: "1" })),
      updateCvLayoutAction(IDLE, form({ expected_revision: "1", section: ["skills", "education"] })),
    ]);
    for (const state of results) expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("passes an explicit child decision and item order through", async () => {
    rpc.mockResolvedValue({ data: [{ cv_revision: 3, removed_item_ids: [ITEM_A] }], error: null });
    await removeCvItemAction(IDLE, form({ expected_revision: "2", item_id: ITEM_A, remove_children: "true" }));
    expect(rpc).toHaveBeenLastCalledWith("remove_cv_item", { p_expected_revision: 2, p_item_id: ITEM_A, p_remove_children: true });
    rpc.mockResolvedValue({ data: 4, error: null });
    await reorderCvSectionAction(IDLE, form({ expected_revision: "3", section_key: "skills", item_id: [ITEM_B, ITEM_A] }));
    expect(rpc).toHaveBeenLastCalledWith("reorder_cv_section", { p_expected_revision: 3, p_section_key: "skills", p_item_ids: [ITEM_B, ITEM_A] });
    await updateCvLayoutAction(IDLE, form({ expected_revision: "4", locale: "en" }));
    expect(rpc).toHaveBeenLastCalledWith("update_cv_layout", { p_expected_revision: 4, p_locale: "en", p_section_order: null });
  });

  it("does not revalidate on failure and returns safe codes", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    const stale = await selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "skill", source_id: SOURCE }));
    expect(stale).toMatchObject({ status: "error", error: { code: "CONFLICT", messageKey: "error.conflict" } });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_SOURCE_INELIGIBLE" } });
    const draft = await selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "achievement", source_id: SOURCE }));
    expect(draft).toMatchObject({ status: "error", error: { code: "VALIDATION", messageKey: "cv.error.sourceIneligible" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports the child item ids of a parent removal that needs a decision", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_CHILD_ITEMS_EXIST", details: JSON.stringify([ITEM_B]) } });
    const state = await removeCvItemAction(IDLE, form({ expected_revision: "2", item_id: ITEM_A, remove_children: "false" }));
    expect(state).toMatchObject({ status: "error", error: { code: "CONFLICT", latestRecord: { childItemIds: [ITEM_B] } } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "skill", source_id: SOURCE }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an unexpected failure to unavailable", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    const state = await ensureCvAction(IDLE);
    expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("T19 CV save action and correlation ids", () => {
  beforeEach(() => {
    revalidatePath.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  });

  it("saves the changed fields and revalidates /cv after success only", async () => {
    rpc.mockResolvedValue({ data: 6, error: null });
    const state = await saveCvEditsAction(IDLE, form({ expected_revision: "5", edits: JSON.stringify({ title: "CV Ani", item_overrides: [{ item_id: ITEM_A, override_text: null }] }) }));
    expect(state).toMatchObject({ status: "success", data: { cvRevision: 6 } });
    expect(rpc).toHaveBeenCalledWith("save_cv_edits", {
      p_expected_revision: 5, p_edits: { title: "CV Ani", item_overrides: [{ item_id: ITEM_A, override_text: null }] },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
  });

  it("ignores a client-supplied revision inside edits and rejects malformed payloads without a call", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await saveCvEditsAction(IDLE, form({ expected_revision: "2", edits: JSON.stringify({ title: "x", expected_revision: 99 }) }));
    expect(rpc).toHaveBeenLastCalledWith("save_cv_edits", { p_expected_revision: 2, p_edits: { title: "x" } });
    rpc.mockClear();
    revalidatePath.mockClear();
    const results = await Promise.all([
      saveCvEditsAction(IDLE, form({ expected_revision: "2", edits: "not json" })),
      saveCvEditsAction(IDLE, form({ expected_revision: "2", edits: "[]" })),
      saveCvEditsAction(IDLE, form({ expected_revision: "2", edits: "{}" })),
      saveCvEditsAction(IDLE, form({ expected_revision: "abc", edits: JSON.stringify({ title: "x" }) })),
      saveCvEditsAction(IDLE, form({ expected_revision: "2" })),
      saveCvEditsAction(IDLE, form({ expected_revision: "2", edits: JSON.stringify({ user_id: USER, title: "x" }) })),
    ]);
    for (const state of results) expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a stale save as a conflict and an unsupported override as validation", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    const stale = await saveCvEditsAction(IDLE, form({ expected_revision: "1", edits: JSON.stringify({ title: "x" }) }));
    expect(stale).toMatchObject({ status: "error", error: { code: "CONFLICT" } });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_OVERRIDE_UNSUPPORTED" } });
    const unsupported = await saveCvEditsAction(IDLE, form({ expected_revision: "1", edits: JSON.stringify({ item_overrides: [{ item_id: ITEM_A, override_text: "x" }] }) }));
    expect(unsupported).toMatchObject({ status: "error", error: { code: "VALIDATION", messageKey: "cv.error.overrideUnsupported" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the same correlation id for the service and the returned error (P3 F2)", async () => {
    const service = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const spy = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(service).mockReturnValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    rpc.mockRejectedValue(new Error("network down"));
    const unexpected = await ensureCvAction(IDLE);
    expect(unexpected).toMatchObject({ status: "error", error: { code: "UNAVAILABLE", correlationId: service } });
    spy.mockReturnValueOnce(service).mockReturnValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    const stale = await selectCvSourceAction(IDLE, form({ expected_revision: "1", source_type: "skill", source_id: SOURCE }));
    expect(stale).toMatchObject({ status: "error", error: { correlationId: service } });
    spy.mockRestore();
  });
});
describe("T20 CV freshness action", () => {
  const ITEM = "a7000000-0000-4000-8000-0000000000f1";
  const RESOLUTIONS = [{ target: "item", item_id: ITEM, source_revision: 4, action: "refresh" }, { target: "profile", source_revision: 2, action: "keep" }];

  beforeEach(() => {
    revalidatePath.mockReset();
    rpc.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  });

  it("resolves the batch, reports parent items and revalidates /cv and the dashboard after success only", async () => {
    rpc.mockResolvedValue({ data: [{ cv_revision: 7, added_parent_item_ids: [ITEM] }], error: null });
    const state = await resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify(RESOLUTIONS) }));
    expect(state).toMatchObject({ status: "success", data: { cvRevision: 7, addedParentItemIds: [ITEM] } });
    expect(rpc).toHaveBeenCalledWith("resolve_cv_freshness", { p_expected_revision: 6, p_resolutions: RESOLUTIONS });
    expect(revalidatePath).toHaveBeenCalledWith("/cv");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects malformed payloads without a database call or revalidation", async () => {
    const results = await Promise.all([
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: "not json" })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: "{}" })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: "[]" })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "abc", resolutions: JSON.stringify(RESOLUTIONS) })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6" })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify([{ ...RESOLUTIONS[0], user_id: USER }]) })),
      resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify([{ ...RESOLUTIONS[0], action: "merge" }]) })),
    ]);
    for (const state of results) expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a changed source to a conflict the editor can reload from, and an invalid resolution to validation", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_SOURCE_CHANGED" } });
    const changed = await resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify(RESOLUTIONS) }));
    expect(changed).toMatchObject({ status: "error", error: { code: "CONFLICT", messageKey: "cv.error.sourceChanged" } });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_RESOLUTION_INVALID" } });
    const invalid = await resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify(RESOLUTIONS) }));
    expect(invalid).toMatchObject({ status: "error", error: { code: "VALIDATION", messageKey: "cv.error.resolutionInvalid" } });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "STALE_REVISION" } });
    const stale = await resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify(RESOLUTIONS) }));
    expect(stale).toMatchObject({ status: "error", error: { code: "CONFLICT", messageKey: "error.conflict" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the service correlation id for the returned error", async () => {
    const service = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const spy = vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(service).mockReturnValue("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "CV_SOURCE_CHANGED" } });
    const state = await resolveCvFreshnessAction(IDLE, form({ expected_revision: "6", resolutions: JSON.stringify(RESOLUTIONS) }));
    expect(state).toMatchObject({ status: "error", error: { correlationId: service } });
    spy.mockRestore();
  });
});