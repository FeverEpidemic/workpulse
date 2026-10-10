import { describe, expect, it } from "vitest";

import {
  CV_ERROR_CODES,
  CV_SECTION_KEYS,
  CV_SOURCE_TYPES,
  SECTION_FOR_SOURCE_TYPE,
  cvProfileSnapshotSchema,
  cvSourceSnapshotSchema,
  parseChildItemsDetail,
  CV_FRESHNESS_STATES,
  cvFreshnessRowSchema,
  cvReviewSummarySchema,
  CV_EXPORT_BLOCKER_CODES,
  CV_EXPORT_ERROR_CODES,
  CV_EXPORT_STATUSES,
  cvExportReadinessSchema,
  cvExportRowSchema,
  downloadCvExportInput,
  removeCvItemInput,
  reorderCvSectionInput,
  requestCvExportInput,
  resolveCvFreshnessInput,
  retryCvExportInput,
  saveCvEditsInput,
  selectCvSourceInput,
  updateCvLayoutInput,
} from "@/domain/cv/contracts";

const ID = "a5000000-0000-4000-8000-000000000001";
const ID2 = "a5000000-0000-4000-8000-000000000002";

describe("T18 CV contracts", () => {
  it("pins the six section keys to the SQL default order", () => {
    expect([...CV_SECTION_KEYS]).toEqual(["experience", "projects", "achievements", "education", "skills", "certifications"]);
  });

  it("maps every source type to its section", () => {
    expect([...CV_SOURCE_TYPES]).toEqual(["experience", "project", "achievement", "education", "skill", "certification"]);
    expect(SECTION_FOR_SOURCE_TYPE).toEqual({
      experience: "experience",
      project: "projects",
      achievement: "achievements",
      education: "education",
      skill: "skills",
      certification: "certifications",
    });
  });

  it("lists the database error codes (T19 adds CV_OVERRIDE_UNSUPPORTED, T20 CV_SOURCE_CHANGED and CV_RESOLUTION_INVALID, T21 the export codes)", () => {
    expect([...CV_ERROR_CODES].sort()).toEqual([
      "AUTH_REQUIRED", "CV_CHILD_ITEMS_EXIST", "CV_EXPORT_BLOCKED", "CV_EXPORT_EXPIRED", "CV_EXPORT_IMMUTABLE", "CV_EXPORT_IN_PROGRESS",
      "CV_EXPORT_NOT_FOUND", "CV_EXPORT_NOT_READY", "CV_EXPORT_NOT_RETRYABLE", "CV_ITEM_IMMUTABLE", "CV_ITEM_NOT_FOUND", "CV_NOT_FOUND",
      "CV_OVERRIDE_UNSUPPORTED", "CV_REORDER_INVALID", "CV_RESOLUTION_INVALID", "CV_SOURCE_CHANGED", "CV_SOURCE_DUPLICATE", "CV_SOURCE_INELIGIBLE",
      "CV_SOURCE_NOT_FOUND", "EXPORT_RETRY_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED", "INVALID_CV_INPUT", "ONBOARDING_REQUIRED", "STALE_REVISION",
    ]);
  });

  describe("source snapshots", () => {
    const base = { schema_version: "cv-source.v1" as const, source_id: ID };
    const samples = {
      experience: {
        ...base, source_type: "experience", organization: "PT A", role_title: "Analis", kind: "employment", description: null,
        start_date: "2023-06-01", start_precision: "month", end_date: null, end_precision: null, is_current: true,
      },
      project: {
        ...base, source_type: "project", title: "Skripsi", description: null, user_role: null, outcome: null, status: "completed",
        start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false, experience_id: null,
      },
      achievement: {
        ...base, source_type: "achievement", title: "Hasil", cv_bullet: "Membangun dasbor", achieved_on: "2024-01-01",
        experience_id: null, project_id: ID2,
      },
      education: {
        ...base, source_type: "education", institution: "Universitas", qualification: "S1", field_of_study: null, description: null,
        start_date: "2019-01-01", start_precision: "year", end_date: "2023-01-01", end_precision: "year", is_current: false,
      },
      skill: { ...base, source_type: "skill", name: "SQL" },
      certification: {
        ...base, source_type: "certification", name: "Sertifikat", issuer: null, issued_date: null, issued_precision: null, credential_url: null,
      },
    } as const;

    it.each(Object.entries(samples))("accepts a %s snapshot with the documented fields", (_type, sample) => {
      expect(cvSourceSnapshotSchema.safeParse(sample).success).toBe(true);
    });

    it.each(["raw_text", "source_excerpt", "contribution", "scope", "metrics", "activity_id", "origin"])(
      "rejects the forbidden key %s",
      (key) => {
        expect(cvSourceSnapshotSchema.safeParse({ ...samples.achievement, [key]: "WP-PRIVATE" }).success).toBe(false);
      },
    );

    it("rejects a missing display field and an unknown type", () => {
      const { title: _title, ...missing } = samples.achievement;
      expect(cvSourceSnapshotSchema.safeParse(missing).success).toBe(false);
      expect(cvSourceSnapshotSchema.safeParse({ ...samples.skill, source_type: "hobby" }).success).toBe(false);
      expect(cvSourceSnapshotSchema.safeParse({ ...samples.skill, schema_version: "cv-source.v2" }).success).toBe(false);
    });
  });

  describe("inputs", () => {
    it("selectCvSourceInput requires a positive revision, a known type and a UUID", () => {
      expect(selectCvSourceInput.safeParse({ expected_revision: 1, source_type: "skill", source_id: ID }).success).toBe(true);
      expect(selectCvSourceInput.safeParse({ expected_revision: 0, source_type: "skill", source_id: ID }).success).toBe(false);
      expect(selectCvSourceInput.safeParse({ expected_revision: 1, source_type: "hobby", source_id: ID }).success).toBe(false);
      expect(selectCvSourceInput.safeParse({ expected_revision: 1, source_type: "skill", source_id: "nope" }).success).toBe(false);
      expect(selectCvSourceInput.safeParse({ expected_revision: 1, source_type: "skill", source_id: ID, user_id: ID }).success).toBe(false);
    });

    it("removeCvItemInput takes an explicit child decision", () => {
      expect(removeCvItemInput.safeParse({ expected_revision: 2, item_id: ID, remove_children: false }).success).toBe(true);
      expect(removeCvItemInput.safeParse({ expected_revision: 2, item_id: ID }).success).toBe(false);
      expect(removeCvItemInput.safeParse({ expected_revision: 2, item_id: "x", remove_children: true }).success).toBe(false);
    });

    it("reorderCvSectionInput rejects unknown sections and duplicate ids", () => {
      expect(reorderCvSectionInput.safeParse({ expected_revision: 3, section_key: "skills", item_ids: [ID, ID2] }).success).toBe(true);
      expect(reorderCvSectionInput.safeParse({ expected_revision: 3, section_key: "hobbies", item_ids: [ID] }).success).toBe(false);
      expect(reorderCvSectionInput.safeParse({ expected_revision: 3, section_key: "skills", item_ids: [ID, ID] }).success).toBe(false);
      expect(reorderCvSectionInput.safeParse({ expected_revision: 3, section_key: "skills", item_ids: ["nope"] }).success).toBe(false);
    });

    it("updateCvLayoutInput needs a locale or a full permutation", () => {
      const order = ["skills", "education", "experience", "projects", "achievements", "certifications"];
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1, locale: "id" }).success).toBe(true);
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1, section_order: order }).success).toBe(true);
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1 }).success).toBe(false);
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1, locale: "fr" }).success).toBe(false);
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1, section_order: order.slice(1) }).success).toBe(false);
      expect(updateCvLayoutInput.safeParse({ expected_revision: 1, section_order: [...order.slice(1), "education"] }).success).toBe(false);
    });
  });

  describe("parseChildItemsDetail", () => {
    it("accepts a JSON array of UUIDs only", () => {
      expect(parseChildItemsDetail(JSON.stringify([ID, ID2]))).toEqual([ID, ID2]);
      expect(parseChildItemsDetail("[]")).toEqual([]);
    });

    it("rejects anything else so no text can leak through the detail", () => {
      expect(parseChildItemsDetail(JSON.stringify(["WP-PRIVATE-CV-SENTINEL"]))).toBeNull();
      expect(parseChildItemsDetail(JSON.stringify([ID, 5]))).toBeNull();
      expect(parseChildItemsDetail(JSON.stringify({ id: ID }))).toBeNull();
      expect(parseChildItemsDetail("not json")).toBeNull();
      expect(parseChildItemsDetail(null)).toBeNull();
      expect(parseChildItemsDetail(undefined)).toBeNull();
    });
  });
});

describe("T19 CV edit contracts", () => {
  it("adds the override error code", () => {
    expect(CV_ERROR_CODES).toContain("CV_OVERRIDE_UNSUPPORTED");
  });

  it("requires at least one edit and accepts null as clear", () => {
    expect(saveCvEditsInput.safeParse({ expected_revision: 1 }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ expected_revision: 0, title: "x" }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ expected_revision: 1, summary_override: null }).success).toBe(true);
    expect(saveCvEditsInput.safeParse({ expected_revision: 1, item_overrides: [{ item_id: ID, override_text: null }] }).success).toBe(true);
  });

  it("enforces limits, key sets, uuids and duplicates", () => {
    const rev = { expected_revision: 1 };
    expect(saveCvEditsInput.safeParse({ ...rev, title: " " }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, title: "t".repeat(121) }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, summary_override: "s".repeat(5001) }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, profile_overrides: { nickname: "x" } }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, profile_overrides: { website: "ftp://example.com" } }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, profile_overrides: { website: "https://example.com", headline: null } }).success).toBe(true);
    expect(saveCvEditsInput.safeParse({ ...rev, profile_overrides: { contact_email: "bad" } }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, item_overrides: [{ item_id: "nope", override_text: "a" }] }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, item_overrides: [{ item_id: ID, override_text: "o".repeat(2001) }] }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, item_overrides: [{ item_id: ID, override_text: "a" }, { item_id: ID, override_text: "b" }] }).success).toBe(false);
    expect(saveCvEditsInput.safeParse({ ...rev, user_id: ID, title: "x" }).success).toBe(false);
  });

  it("accepts display overrides on the profile snapshot and rejects unknown keys", () => {
    const base = { schema_version: "cv-profile.v1", display_name: "Ani", summary: null };
    expect(cvProfileSnapshotSchema.safeParse({ ...base, display_overrides: { headline: "Analyst" } }).success).toBe(true);
    expect(cvProfileSnapshotSchema.safeParse({ ...base, display_overrides: { nickname: "x" } }).success).toBe(false);
    expect(cvProfileSnapshotSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(cvProfileSnapshotSchema.safeParse({ ...base, display_overrides: { website: "javascript:alert(1)" } }).success).toBe(false);
  });
});

describe("T20 CV freshness contracts", () => {
  const ITEM = "a5000000-0000-4000-8000-0000000000a1";
  const ITEM2 = "a5000000-0000-4000-8000-0000000000a2";
  const resolution = (overrides: Record<string, unknown> = {}) => ({ target: "item", item_id: ITEM, source_revision: 3, action: "refresh", ...overrides });
  const profileSnapshot = { display_name: "Ani", headline: null, summary: null, contact_email: null, phone: null, location: null, website: null };
  const achievement = {
    schema_version: "cv-source.v1", source_type: "achievement", source_id: ITEM2, title: "Hasil", cv_bullet: "Membangun dasbor",
    achieved_on: "2024-01-01", experience_id: null, project_id: null,
  };

  it("lists the five freshness states", () => {
    expect([...CV_FRESHNESS_STATES]).toEqual(["fresh", "changed", "kept", "deleted", "unconfirmed"]);
  });

  describe("resolveCvFreshnessInput", () => {
    it("accepts item and profile resolutions", () => {
      const parsed = resolveCvFreshnessInput.safeParse({
        expected_revision: 4,
        resolutions: [resolution(), resolution({ item_id: ITEM2, action: "keep" }), { target: "profile", source_revision: 2, action: "replace" }],
      });
      expect(parsed.success).toBe(true);
    });

    it("limits the batch to 1-200 entries", () => {
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [] }).success).toBe(false);
      const many = (count: number) => Array.from({ length: count }, (_, n) => resolution({ item_id: `a5000000-0000-4000-8000-${String(n).padStart(12, "0")}` }));
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: many(200) }).success).toBe(true);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: many(201) }).success).toBe(false);
    });

    it("rejects duplicate items, a second profile entry, unknown keys, actions and revisions below one", () => {
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [resolution(), resolution({ action: "keep" })] }).success).toBe(false);
      const profile = { target: "profile", source_revision: 1, action: "keep" };
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [profile, { ...profile, action: "refresh" }] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [resolution({ extra: true })] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [{ ...profile, item_id: ITEM }] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [resolution({ action: "merge" })] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [resolution({ source_revision: 0 })] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 0, resolutions: [resolution()] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1, resolutions: [resolution({ item_id: "nope" })] }).success).toBe(false);
      expect(resolveCvFreshnessInput.safeParse({ expected_revision: 1.5, resolutions: [resolution()] }).success).toBe(false);
    });
  });

  describe("cvFreshnessRowSchema", () => {
    it("accepts item and profile rows", () => {
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "fresh", live_revision: 2, live_snapshot: null }).success).toBe(true);
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "changed", live_revision: 3, live_snapshot: achievement }).success).toBe(true);
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "deleted", live_revision: null, live_snapshot: null }).success).toBe(true);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: null, state: "kept", live_revision: 5, live_snapshot: profileSnapshot }).success).toBe(true);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: null, state: "fresh", live_revision: 5, live_snapshot: null }).success).toBe(true);
    });

    it("rejects unknown states, keys and snapshot shapes", () => {
      const base = { target: "item", item_id: ITEM, state: "changed", live_revision: 3, live_snapshot: achievement };
      expect(cvFreshnessRowSchema.safeParse({ ...base, state: "stale" }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ ...base, live_snapshot: { ...achievement, raw_text: "private" } }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ ...base, item_id: null }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: ITEM, state: "changed", live_revision: 1, live_snapshot: profileSnapshot }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: null, state: "deleted", live_revision: 1, live_snapshot: null }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: null, state: "changed", live_revision: 1, live_snapshot: { ...profileSnapshot, display_overrides: {} } }).success).toBe(false);
    });

    it("requires a live snapshot for changed and kept rows only", () => {
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "changed", live_revision: 3, live_snapshot: null }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "kept", live_revision: 3, live_snapshot: null }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "item", item_id: ITEM, state: "fresh", live_revision: 3, live_snapshot: achievement }).success).toBe(false);
      expect(cvFreshnessRowSchema.safeParse({ target: "profile", item_id: null, state: "changed", live_revision: 3, live_snapshot: null }).success).toBe(false);
    });
  });

  it("validates the review summary counters", () => {
    expect(cvReviewSummarySchema.safeParse({ has_cv: true, review_count: 2, available_count: 0 }).success).toBe(true);
    expect(cvReviewSummarySchema.safeParse({ has_cv: false, review_count: 0, available_count: 3 }).success).toBe(true);
    expect(cvReviewSummarySchema.safeParse({ has_cv: true, review_count: -1, available_count: 0 }).success).toBe(false);
    expect(cvReviewSummarySchema.safeParse({ has_cv: true, review_count: 1, available_count: 0, extra: 1 }).success).toBe(false);
  });
});

describe("T21 CV export contracts", () => {
  const EXPORT = "a5000000-0000-4000-8000-0000000000e1";
  const CV_ID = "a5000000-0000-4000-8000-0000000000c1";
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: EXPORT, cv_id: CV_ID, cv_revision: 4, status: "queued", error_code: null, attempt_count: 0, page_count: null, byte_size: null,
    started_at: null, finished_at: null, expires_at: null, purged_at: null, created_at: "2026-10-06T10:00:00Z", updated_at: "2026-10-06T10:00:00Z", revision: 1,
    ...overrides,
  });

  it("pins blocker codes, statuses and the worker error allowlist", () => {
    expect([...CV_EXPORT_BLOCKER_CODES]).toEqual(["CV_NOT_FOUND", "NAME_REQUIRED", "CONTENT_REQUIRED", "ITEM_CHANGED", "ITEM_DELETED", "ITEM_UNCONFIRMED", "PROFILE_CHANGED"]);
    expect([...CV_EXPORT_STATUSES]).toEqual(["queued", "running", "succeeded", "failed"]);
    expect([...CV_EXPORT_ERROR_CODES].sort()).toEqual([
      "ACCOUNT_DELETING", "EXPORT_RENDER_INVALID", "EXPORT_SNAPSHOT_INVALID", "EXPORT_TIMEOUT", "EXPORT_TOO_LONG", "RENDERER_TIMEOUT", "RENDERER_UNAVAILABLE", "STORAGE_UNAVAILABLE",
    ]);
  });

  describe("cvExportReadinessSchema", () => {
    it("accepts a ready CV, a blocked CV and a missing CV", () => {
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: true, blockers: [] }).success).toBe(true);
      expect(cvExportReadinessSchema.safeParse({
        has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_CHANGED", item_id: ID }, { code: "NAME_REQUIRED" }],
      }).success).toBe(true);
      expect(cvExportReadinessSchema.safeParse({ has_cv: false, cv_revision: null, ready: false, blockers: [{ code: "CV_NOT_FOUND" }] }).success).toBe(true);
    });

    it("rejects an inconsistent ready flag, unknown codes and keys, and a non-UUID item", () => {
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: true, blockers: [{ code: "NAME_REQUIRED" }] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: false, blockers: [] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: false, cv_revision: null, ready: true, blockers: [] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_WEIRD" }] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_CHANGED", item_id: "nope" }] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: false, blockers: [{ code: "ITEM_CHANGED", text: "WP-PRIVATE" }] }).success).toBe(false);
      expect(cvExportReadinessSchema.safeParse({ has_cv: true, cv_revision: 8, ready: true, blockers: [], extra: 1 }).success).toBe(false);
    });
  });

  describe("cvExportRowSchema", () => {
    it("accepts the safe columns of each state", () => {
      expect(cvExportRowSchema.safeParse(row()).success).toBe(true);
      expect(cvExportRowSchema.safeParse(row({ status: "running", attempt_count: 1, started_at: "2026-10-06T10:00:01Z" })).success).toBe(true);
      expect(cvExportRowSchema.safeParse(row({
        status: "succeeded", attempt_count: 1, page_count: 2, byte_size: 54321, finished_at: "2026-10-06T10:00:05Z", expires_at: "2026-10-07T10:00:05Z",
      })).success).toBe(true);
      expect(cvExportRowSchema.safeParse(row({ status: "failed", attempt_count: 1, error_code: "RENDERER_TIMEOUT", finished_at: "2026-10-06T10:00:05Z" })).success).toBe(true);
    });

    it("rejects the private columns so they cannot reach the browser", () => {
      for (const key of ["snapshot", "attempt_token", "lease_expires_at", "object_key", "idempotency_key", "user_id"]) {
        expect(cvExportRowSchema.safeParse(row({ [key]: "WP-PRIVATE" })).success).toBe(false);
      }
    });

    it("rejects unknown statuses and error codes, and an error code outside a failed row", () => {
      expect(cvExportRowSchema.safeParse(row({ status: "done" })).success).toBe(false);
      expect(cvExportRowSchema.safeParse(row({ status: "failed", attempt_count: 1, error_code: "SECRET_TEXT" })).success).toBe(false);
      expect(cvExportRowSchema.safeParse(row({ status: "failed", attempt_count: 1, error_code: null })).success).toBe(false);
      expect(cvExportRowSchema.safeParse(row({ error_code: "EXPORT_TIMEOUT" })).success).toBe(false);
      expect(cvExportRowSchema.safeParse(row({ attempt_count: 4 })).success).toBe(false);
      expect(cvExportRowSchema.safeParse(row({ page_count: 21 })).success).toBe(false);
    });
  });

  describe("inputs", () => {
    it("requestCvExportInput needs a positive revision and a safe, trimmed key", () => {
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "req-1_A" }).success).toBe(true);
      expect(requestCvExportInput.parse({ expected_revision: 3, idempotency_key: "  req-1  " }).idempotency_key).toBe("req-1");
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "k".repeat(200) }).success).toBe(true);
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "k".repeat(201) }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "" }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "bad key" }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 3, idempotency_key: "bad/key" }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 0, idempotency_key: "ok" }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 1.5, idempotency_key: "ok" }).success).toBe(false);
      expect(requestCvExportInput.safeParse({ expected_revision: 1, idempotency_key: "ok", user_id: ID }).success).toBe(false);
    });

    it("retry and download take one export UUID and nothing else", () => {
      for (const schema of [retryCvExportInput, downloadCvExportInput]) {
        expect(schema.safeParse({ export_id: ID }).success).toBe(true);
        expect(schema.safeParse({ export_id: "nope" }).success).toBe(false);
        expect(schema.safeParse({ export_id: ID, object_key: "x" }).success).toBe(false);
        expect(schema.safeParse({}).success).toBe(false);
      }
    });
  });
});