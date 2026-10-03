import { describe, expect, it, vi } from "vitest";

import { CvServiceError, mapCvDatabaseError } from "@/features/cv/cv-errors";
import { createCvService } from "@/features/cv/cv-service";

const USER = "11111111-1111-4111-8111-111111111111";
const CV = "22222222-2222-4222-8222-222222222222";
const CORRELATION = "33333333-3333-4333-8333-333333333333";
const SENTINEL = "WP-PRIVATE-CV-SENTINEL-4d1f";
const ID_A = "a5000000-0000-4000-8000-000000000001";
const ID_B = "a5000000-0000-4000-8000-000000000002";
const PROJECT = "a6000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;

function fakeClient(options: {
  user?: { id: string } | null;
  authError?: unknown;
  tables?: Record<string, Row[]>;
  rpc?: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>;
} = {}) {
  const calls: { table: string; columns?: string }[] = [];
  const rpc = vi.fn(options.rpc ?? (async () => ({ data: null, error: null })));
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: options.user === undefined ? { id: USER } : options.user },
        error: options.authError ?? null,
      }),
    },
    rpc,
    from(table: string) {
      let rows = [...(options.tables?.[table] ?? [])];
      const query: Record<string, unknown> = {
        select(columns?: string) {
          calls.push({ table, columns });
          return query;
        },
        eq(column: string, value: unknown) {
          rows = rows.filter((row) => row[column] === value);
          return query;
        },
        order() {
          return query;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { client: client as never, rpc, calls };
}

function service(client: never) {
  return createCvService({ supabase: client, correlationId: CORRELATION });
}

function skillSnapshot(id: string, name: string) {
  return { schema_version: "cv-source.v1", source_type: "skill", source_id: id, name };
}

function itemRow(overrides: Row): Row {
  return {
    id: ID_A, user_id: USER, cv_id: CV, section_key: "skills", position: 1,
    experience_id: null, project_id: null, achievement_id: null, education_id: null, skill_id: ID_B, certification_id: null,
    source_snapshot: skillSnapshot(ID_B, "SQL"), source_revision: 1, override_text: null, acknowledged_revision: null,
    source_deleted: false, created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", revision: 1,
    ...overrides,
  };
}

const DOCUMENT: Row = {
  id: CV, user_id: USER, title: "Master CV", locale: "id", template_key: "single_column_v1", summary_override: null,
  profile_snapshot: { display_name: "Ani" }, profile_source_revision: 1, profile_ack_revision: null,
  section_order: ["experience", "projects", "achievements", "education", "skills", "certifications"],
  created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", revision: 3,
};

describe("T18 CV service", () => {
  it("reports an anonymous caller as unauthenticated without a database call", async () => {
    const { client, rpc } = fakeClient({ user: null });
    const svc = service(client);
    await expect(svc.ensure()).rejects.toMatchObject({ code: "UNAUTHENTICATED", messageKey: "auth.signInRequired", correlationId: CORRELATION });
    await expect(svc.select({ expected_revision: 1, source_type: "skill", source_id: ID_B })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("opens the CV through ensure_cv_document", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: [{ cv_id: CV, revision: 1, created: true }], error: null }) });
    await expect(service(client).ensure()).resolves.toEqual({ cvId: CV, revision: 1, created: true });
    expect(rpc).toHaveBeenCalledWith("ensure_cv_document");
  });

  it("selects a source with the session-owned RPC arguments only", async () => {
    const { client, rpc } = fakeClient({
      rpc: async () => ({ data: [{ cv_revision: 4, item_ids: [ID_A, ID_B], parent_item_ids: [ID_A] }], error: null }),
    });
    await expect(service(client).select({ expected_revision: 3, source_type: "achievement", source_id: ID_B })).resolves.toEqual({
      cvRevision: 4, itemIds: [ID_A, ID_B], parentItemIds: [ID_A],
    });
    expect(rpc).toHaveBeenCalledWith("select_cv_source", { p_expected_revision: 3, p_source_type: "achievement", p_source_id: ID_B });
  });

  it("removes an item and reports the removed ids", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: [{ cv_revision: 5, removed_item_ids: [ID_A] }], error: null }) });
    await expect(service(client).remove({ expected_revision: 4, item_id: ID_A, remove_children: true })).resolves.toEqual({
      cvRevision: 5, removedItemIds: [ID_A],
    });
    expect(rpc).toHaveBeenCalledWith("remove_cv_item", { p_expected_revision: 4, p_item_id: ID_A, p_remove_children: true });
  });

  it("reorders and updates the layout, returning the new revision", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: 6, error: null }) });
    const svc = service(client);
    await expect(svc.reorder({ expected_revision: 5, section_key: "skills", item_ids: [ID_B, ID_A] })).resolves.toEqual({ cvRevision: 6 });
    expect(rpc).toHaveBeenCalledWith("reorder_cv_section", { p_expected_revision: 5, p_section_key: "skills", p_item_ids: [ID_B, ID_A] });
    await expect(svc.updateLayout({ expected_revision: 6, locale: "en" })).resolves.toEqual({ cvRevision: 6 });
    expect(rpc).toHaveBeenLastCalledWith("update_cv_layout", { p_expected_revision: 6, p_locale: "en", p_section_order: null });
  });

  it("rejects invalid input before any database call", async () => {
    const { client, rpc } = fakeClient();
    const svc = service(client);
    await expect(svc.select({ expected_revision: 0, source_type: "skill", source_id: ID_B })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.select({ expected_revision: 1, source_type: "skill", source_id: ID_B, user_id: USER })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.remove({ expected_revision: 1, item_id: "nope", remove_children: false })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.reorder({ expected_revision: 1, section_key: "skills", item_ids: [ID_A, ID_A] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.updateLayout({ expected_revision: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("database error mapping", () => {
    it.each([
      ["AUTH_REQUIRED", "UNAUTHENTICATED", "auth.signInRequired"],
      ["ONBOARDING_REQUIRED", "ONBOARDING_REQUIRED", "cv.error.onboardingRequired"],
      ["INVALID_CV_INPUT", "VALIDATION", "error.validation"],
      ["CV_NOT_FOUND", "NOT_FOUND", "error.notFound"],
      ["CV_ITEM_NOT_FOUND", "NOT_FOUND", "error.notFound"],
      ["STALE_REVISION", "CONFLICT", "error.conflict"],
      ["CV_SOURCE_NOT_FOUND", "SOURCE_NOT_FOUND", "cv.error.sourceNotFound"],
      ["CV_SOURCE_INELIGIBLE", "SOURCE_INELIGIBLE", "cv.error.sourceIneligible"],
      ["CV_SOURCE_DUPLICATE", "SOURCE_DUPLICATE", "cv.error.sourceDuplicate"],
      ["CV_REORDER_INVALID", "REORDER_INVALID", "cv.error.reorderInvalid"],
      ["CV_CHILD_ITEMS_EXIST", "CHILD_ITEMS_EXIST", "cv.error.childItemsExist"],
      ["CV_ITEM_IMMUTABLE", "UNAVAILABLE", "error.unavailable"],
    ])("maps %s to %s", (message, code, messageKey) => {
      const error = mapCvDatabaseError({ code: "P0001", message }, CORRELATION);
      expect(error).toBeInstanceOf(CvServiceError);
      expect(error).toMatchObject({ code, messageKey, correlationId: CORRELATION });
    });

    it("falls back on the sqlstate and otherwise reports unavailable", () => {
      expect(mapCvDatabaseError({ code: "42501", message: "x" }, CORRELATION).code).toBe("UNAUTHENTICATED");
      expect(mapCvDatabaseError({ code: "22023", message: "x" }, CORRELATION).code).toBe("VALIDATION");
      expect(mapCvDatabaseError({ code: "XX000", message: "x" }, CORRELATION).code).toBe("UNAVAILABLE");
    });

    it("carries the child item ids of CV_CHILD_ITEMS_EXIST and nothing else", async () => {
      const { client } = fakeClient({
        rpc: async () => ({ data: null, error: { code: "P0001", message: "CV_CHILD_ITEMS_EXIST", details: JSON.stringify([ID_A, ID_B]) } }),
      });
      await expect(service(client).remove({ expected_revision: 2, item_id: PROJECT, remove_children: false })).rejects.toMatchObject({
        code: "CHILD_ITEMS_EXIST", childItemIds: [ID_A, ID_B], correlationId: CORRELATION,
      });
      expect(mapCvDatabaseError({ message: "CV_CHILD_ITEMS_EXIST", details: JSON.stringify([SENTINEL]) }, CORRELATION).childItemIds).toEqual([]);
    });

    it("never echoes database text in the error", async () => {
      const { client } = fakeClient({
        rpc: async () => ({ data: null, error: { code: "XX000", message: `boom ${SENTINEL}`, details: SENTINEL, hint: SENTINEL } }),
      });
      const error = await service(client).ensure().catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "UNAVAILABLE" });
      expect(JSON.stringify(error)).not.toContain(SENTINEL);
      expect((error as Error).message).not.toContain(SENTINEL);
    });

    it("reports a malformed RPC receipt as unavailable", async () => {
      const { client } = fakeClient({ rpc: async () => ({ data: [{ cv_revision: "four" }], error: null }) });
      await expect(service(client).select({ expected_revision: 1, source_type: "skill", source_id: ID_B })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    });
  });

  describe("getCv", () => {
    it("returns null before the first open", async () => {
      const { client } = fakeClient({ tables: { cv_documents: [] } });
      await expect(service(client).getCv()).resolves.toBeNull();
    });

    it("returns the document, items and an outline", async () => {
      const { client } = fakeClient({
        tables: {
          cv_documents: [DOCUMENT],
          cv_items: [
            itemRow({ id: ID_A, position: 2, skill_id: ID_A, source_snapshot: skillSnapshot(ID_A, "Python") }),
            itemRow({ id: ID_B, position: 1 }),
          ],
        },
      });
      const cv = await service(client).getCv();
      expect(cv?.document.revision).toBe(3);
      const skills = cv?.outline.sections.find((section) => section.key === "skills");
      expect(skills?.entries.map((entry) => entry.item.id)).toEqual([ID_B, ID_A]);
    });

    it("reports rows that do not match the contract as unavailable", async () => {
      const { client } = fakeClient({ tables: { cv_documents: [{ ...DOCUMENT, locale: "fr" }], cv_items: [] } });
      await expect(service(client).getCv()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    });
  });

  describe("getSelectionPool", () => {
    it("lists only confirmed achievements and marks selected sources", async () => {
      const { client, calls } = fakeClient({
        tables: {
          experiences: [{ id: "e1", user_id: USER, organization: "Org", role_title: "Role" }],
          projects: [], education: [], certifications: [],
          skills: [{ id: ID_B, user_id: USER, name: "SQL" }, { id: ID_A, user_id: USER, name: "Python" }],
          achievements: [
            { id: "a-confirmed", user_id: USER, status: "confirmed", title: "Hasil" },
            { id: "a-draft", user_id: USER, status: "draft", title: "Draf" },
            { id: "a-dismissed", user_id: USER, status: "dismissed", title: "Ditolak" },
          ],
          cv_items: [itemRow({ skill_id: ID_B })],
        },
      });
      const pool = await service(client).getSelectionPool();
      expect(pool.achievements.map((entry) => entry.row.id)).toEqual(["a-confirmed"]);
      expect(pool.skills.map((entry) => [entry.row.id, entry.selected])).toEqual([[ID_B, true], [ID_A, false]]);
      expect(pool.experience).toHaveLength(1);
      const achievementColumns = calls.find((call) => call.table === "achievements")?.columns ?? "";
      for (const forbidden of ["contribution", "source_excerpt", "scope", "metrics", "activity_id"]) {
        expect(achievementColumns).not.toContain(forbidden);
      }
    });
  });
});

describe("T19 CV saveEdits", () => {
  it("sends only the edits with the session-owned RPC arguments and returns the new revision", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: 8, error: null }) });
    await expect(
      service(client).saveEdits({
        expected_revision: 7, title: "CV Ani", summary_override: null,
        profile_overrides: { headline: "Analyst" }, item_overrides: [{ item_id: ID_A, override_text: "Custom" }],
      }),
    ).resolves.toEqual({ cvRevision: 8 });
    expect(rpc).toHaveBeenCalledWith("save_cv_edits", {
      p_expected_revision: 7,
      p_edits: { title: "CV Ani", summary_override: null, profile_overrides: { headline: "Analyst" }, item_overrides: [{ item_id: ID_A, override_text: "Custom" }] },
    });
  });

  it("rejects invalid or empty edits before any database call", async () => {
    const { client, rpc } = fakeClient();
    const svc = service(client);
    await expect(svc.saveEdits({ expected_revision: 1 })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.saveEdits({ expected_revision: 1, title: "x", user_id: USER })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.saveEdits({ expected_revision: 1, item_overrides: [{ item_id: "nope", override_text: "x" }] })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a stale revision to a conflict and an unsupported override to its own code", async () => {
    const stale = fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message: "STALE_REVISION" } }) });
    await expect(service(stale.client).saveEdits({ expected_revision: 1, title: "x" })).rejects.toMatchObject({
      code: "CONFLICT", messageKey: "error.conflict", correlationId: CORRELATION,
    });
    const unsupported = fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message: "CV_OVERRIDE_UNSUPPORTED" } }) });
    await expect(service(unsupported.client).saveEdits({ expected_revision: 1, item_overrides: [{ item_id: ID_A, override_text: "x" }] })).rejects.toMatchObject({
      code: "OVERRIDE_UNSUPPORTED", messageKey: "cv.error.overrideUnsupported",
    });
  });

  it("never echoes submitted text in an error and rejects a malformed receipt", async () => {
    const leaky = fakeClient({ rpc: async () => ({ data: null, error: { code: "XX000", message: `boom ${SENTINEL}`, details: SENTINEL } }) });
    const error = await service(leaky.client).saveEdits({ expected_revision: 1, title: SENTINEL }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "UNAVAILABLE" });
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
    const bad = fakeClient({ rpc: async () => ({ data: "eight", error: null }) });
    await expect(service(bad.client).saveEdits({ expected_revision: 1, title: "x" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});

describe("T20 CV freshness service", () => {
  const ITEM_RESOLUTION = { target: "item", item_id: ID_A, source_revision: 4, action: "refresh" } as const;
  const achievement = {
    schema_version: "cv-source.v1", source_type: "achievement", source_id: ID_B, title: "Hasil", cv_bullet: "Kalimat baru",
    achieved_on: "2024-01-01", experience_id: null, project_id: null,
  };

  it("reads the freshness rows of the caller only with the session-owned RPC", async () => {
    const rows = [
      { target: "item", item_id: ID_A, state: "changed", live_revision: 4, live_snapshot: achievement },
      { target: "profile", item_id: null, state: "fresh", live_revision: 2, live_snapshot: null },
    ];
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: rows, error: null }) });
    await expect(service(client).getFreshness()).resolves.toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("get_cv_freshness");
  });

  it("reports an anonymous caller, an RPC failure and malformed rows without leaking text", async () => {
    const anonymous = fakeClient({ user: null });
    await expect(service(anonymous.client).getFreshness()).rejects.toMatchObject({ code: "UNAUTHENTICATED", correlationId: CORRELATION });
    expect(anonymous.rpc).not.toHaveBeenCalled();
    const failing = fakeClient({ rpc: async () => ({ data: null, error: { code: "XX000", message: `boom ${SENTINEL}` } }) });
    const error = await service(failing.client).getFreshness().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "UNAVAILABLE", correlationId: CORRELATION });
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
    const malformed = fakeClient({ rpc: async () => ({ data: [{ target: "item", item_id: ID_A, state: "stale", live_revision: 1, live_snapshot: null }], error: null }) });
    await expect(service(malformed.client).getFreshness()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    const empty = fakeClient({ rpc: async () => ({ data: null, error: null }) });
    await expect(service(empty.client).getFreshness()).resolves.toEqual([]);
  });

  it("resolves a batch with the session-owned RPC arguments and returns the receipt", async () => {
    const { client, rpc } = fakeClient({ rpc: async () => ({ data: [{ cv_revision: 9, added_parent_item_ids: [ID_B] }], error: null }) });
    await expect(
      service(client).resolveFreshness({ expected_revision: 8, resolutions: [ITEM_RESOLUTION, { target: "profile", source_revision: 3, action: "keep" }] }),
    ).resolves.toEqual({ cvRevision: 9, addedParentItemIds: [ID_B] });
    expect(rpc).toHaveBeenCalledWith("resolve_cv_freshness", {
      p_expected_revision: 8,
      p_resolutions: [ITEM_RESOLUTION, { target: "profile", source_revision: 3, action: "keep" }],
    });
  });

  it("rejects invalid input before any database call", async () => {
    const { client, rpc } = fakeClient();
    const svc = service(client);
    await expect(svc.resolveFreshness({ expected_revision: 1, resolutions: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.resolveFreshness({ expected_revision: 0, resolutions: [ITEM_RESOLUTION] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.resolveFreshness({ expected_revision: 1, resolutions: [ITEM_RESOLUTION, { ...ITEM_RESOLUTION, action: "keep" }] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(svc.resolveFreshness({ expected_revision: 1, resolutions: [{ ...ITEM_RESOLUTION, user_id: USER }] })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["CV_SOURCE_CHANGED", "SOURCE_CHANGED", "cv.error.sourceChanged"],
    ["CV_RESOLUTION_INVALID", "RESOLUTION_INVALID", "cv.error.resolutionInvalid"],
    ["CV_SOURCE_INELIGIBLE", "SOURCE_INELIGIBLE", "cv.error.sourceIneligible"],
    ["CV_ITEM_NOT_FOUND", "NOT_FOUND", "error.notFound"],
    ["CV_SOURCE_NOT_FOUND", "SOURCE_NOT_FOUND", "cv.error.sourceNotFound"],
    ["STALE_REVISION", "CONFLICT", "error.conflict"],
    ["INVALID_CV_INPUT", "VALIDATION", "error.validation"],
  ])("maps %s to %s with a correlation id", async (message, code, messageKey) => {
    const { client } = fakeClient({ rpc: async () => ({ data: null, error: { code: "P0001", message, details: SENTINEL } }) });
    const error = await service(client).resolveFreshness({ expected_revision: 1, resolutions: [ITEM_RESOLUTION] }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code, messageKey, correlationId: CORRELATION });
    expect(JSON.stringify(error)).not.toContain(SENTINEL);
  });

  it("reports a malformed receipt as unavailable", async () => {
    const { client } = fakeClient({ rpc: async () => ({ data: [{ cv_revision: 9 }], error: null }) });
    await expect(service(client).resolveFreshness({ expected_revision: 1, resolutions: [ITEM_RESOLUTION] })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});