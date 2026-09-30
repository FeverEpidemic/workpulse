import { describe, expect, it } from "vitest";

import {
  IMPORT_FIELD_ERROR_CODES,
  IMPORT_ITEM_ACTIONS,
  IMPORT_PATCH_FIELDS,
  IMPORT_PROFILE_SELECTABLE_FIELDS,
  commitImportInput,
  commitResultSchema,
  parseItemErrorsDetail,
  updateImportItemInput,
} from "@/domain/import/commit-contracts";

const ID = "1f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";

describe("T16 import commit contracts", () => {
  it("keeps the patch allowlist identical to the SQL allowlist", () => {
    expect(IMPORT_PATCH_FIELDS).toEqual({
      experience: ["organization", "role_title", "kind", "description", "start_date", "start_precision", "end_date", "end_precision", "is_current"],
      education: ["institution", "qualification", "field_of_study", "description", "start_date", "start_precision", "end_date", "end_precision", "is_current"],
      certification: ["name", "issuer", "issued_date", "issued_precision", "credential_url"],
      skill: ["name"],
      achievement: ["title", "contribution", "outcome", "cv_bullet", "achieved_on", "metrics", "experience_item_id"],
      profile: ["headline", "summary", "contact_email", "phone", "location", "website", "selected_fields", "display_name"],
    });
    expect(IMPORT_PROFILE_SELECTABLE_FIELDS).toEqual(["headline", "summary", "contact_email", "phone", "location", "website"]);
    expect(IMPORT_ITEM_ACTIONS).toEqual(["create", "map", "skip"]);
    expect(IMPORT_FIELD_ERROR_CODES).toEqual(["REQUIRED", "INVALID", "TOO_LONG", "DATE_RANGE", "DUPLICATE", "TARGET_UNAVAILABLE", "INVALID_ACTION"]);
  });

  it("accepts a minimal update and rejects foreign keys, bad ids and non-boolean confirm", () => {
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 1 }).success).toBe(true);
    expect(updateImportItemInput.safeParse({
      item_id: ID, expected_revision: 3, action: "map", target_id: ID, payload_patch: { role_title: "Lead", is_current: false }, confirm_requested: true,
    }).success).toBe(true);
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 1, user_id: ID }).success).toBe(false);
    expect(updateImportItemInput.safeParse({ item_id: "nope", expected_revision: 1 }).success).toBe(false);
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 0 }).success).toBe(false);
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 1, action: "delete" }).success).toBe(false);
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 1, confirm_requested: "yes" }).success).toBe(false);
    expect(updateImportItemInput.safeParse({ item_id: ID, expected_revision: 1, target_id: "x" }).success).toBe(false);
  });

  it("validates the commit input and the optional onboarding block", () => {
    expect(commitImportInput.safeParse({ batch_id: ID, expected_revision: 4 }).success).toBe(true);
    expect(commitImportInput.safeParse({
      batch_id: ID, expected_revision: 4, onboarding: { display_name: "Dewi Nyata", locale: "id", timezone: "Asia/Jakarta" },
    }).success).toBe(true);
    expect(commitImportInput.safeParse({ batch_id: ID, expected_revision: 4, onboarding: { display_name: "", locale: "id", timezone: "Asia/Jakarta" } }).success).toBe(false);
    expect(commitImportInput.safeParse({ batch_id: ID, expected_revision: 4, onboarding: { display_name: "Dewi", locale: "fr", timezone: "Asia/Jakarta" } }).success).toBe(false);
    expect(commitImportInput.safeParse({ batch_id: ID, expected_revision: 4, user_id: ID }).success).toBe(false);
  });

  it("parses only the small commit result shape", () => {
    const result = {
      schema_version: "import-commit.v1",
      counts: {
        profile: { created: 1, mapped: 0, skipped: 0 }, experience: { created: 2, mapped: 1, skipped: 0 }, education: { created: 0, mapped: 0, skipped: 0 },
        certification: { created: 0, mapped: 0, skipped: 0 }, skill: { created: 1, mapped: 1, skipped: 1 }, achievement: { created: 2, mapped: 0, skipped: 0 },
      },
      confirmed_achievements: 1, profile_fields_applied: 2, onboarding_completed: false, batch_id: ID, committed_at: "2026-10-01T09:00:00.000000Z",
    };
    expect(commitResultSchema.safeParse(result).success).toBe(true);
    expect(commitResultSchema.safeParse({ ...result, title: "leak" }).success).toBe(false);
    expect(commitResultSchema.safeParse({ ...result, confirmed_achievements: -1 }).success).toBe(false);
  });

  it("accepts item error details with ids and codes only", () => {
    const ok = JSON.stringify([
      { item_id: ID, field: "role_title", code: "REQUIRED" },
      { item_id: ID, field: "name", code: "DUPLICATE", existing_id: ID },
    ]);
    expect(parseItemErrorsDetail(ok)).toEqual([
      { item_id: ID, field: "role_title", code: "REQUIRED" },
      { item_id: ID, field: "name", code: "DUPLICATE", existing_id: ID },
    ]);
    expect(parseItemErrorsDetail(JSON.stringify([{ item_id: ID, field: "role_title", code: "REQUIRED", value: "WP-PRIVATE" }]))).toBeNull();
    expect(parseItemErrorsDetail(JSON.stringify([{ item_id: ID, field: "role_title", code: "OTHER" }]))).toBeNull();
    expect(parseItemErrorsDetail(JSON.stringify([{ item_id: ID, field: "Role Title", code: "REQUIRED" }]))).toBeNull();
    expect(parseItemErrorsDetail("not json")).toBeNull();
    expect(parseItemErrorsDetail(null)).toBeNull();
    expect(parseItemErrorsDetail(undefined)).toBeNull();
  });
});
