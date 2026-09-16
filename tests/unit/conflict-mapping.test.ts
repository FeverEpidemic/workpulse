import { describe, expect, it } from "vitest";

import { conflictDatePrefixes, conflictFieldUpdates } from "@/components/forms/conflict-controls";

describe("conflict reload field mapping", () => {
  it("copies only editable profile fields and excludes server identity", () => {
    const latest = {
      id: "foreign-or-current-row",
      user_id: "account-id",
      display_name: "Server name",
      headline: "Server headline",
      summary: null,
      revision: 8,
      created_at: "2026-01-01T00:00:00Z",
      unexpected: "must not reach the form",
    };

    expect(conflictFieldUpdates("profile", latest)).toEqual({
      display_name: "Server name",
      headline: "Server headline",
      summary: null,
    });
  });

  it("maps the experience kind to its editable select and preserves date-field routing", () => {
    const latest = {
      id: "experience-id",
      user_id: "account-id",
      kind: "internship",
      revision: 5,
      organization: "Server Org",
      role_title: "Server Role",
      is_current: false,
      description: null,
      start_date: "2022-01-01",
      start_precision: "year",
      end_date: null,
      end_precision: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    expect(conflictFieldUpdates("experience", latest)).toEqual({
      organization: "Server Org",
      role_title: "Server Role",
      experience_kind: "internship",
      is_current: false,
      description: null,
    });
    expect(conflictDatePrefixes("experience")).toEqual(["start", "end"]);
  });

  it("uses the exact editor-specific allowlist for education, certification, skill, and delete", () => {
    const latest = {
      id: "record-id",
      user_id: "account-id",
      kind: "experience",
      revision: 4,
      name: "Name",
      issuer: "Issuer",
      credential_url: null,
      institution: "Institution",
      qualification: "Qualification",
      field_of_study: "Field",
      status: "completed",
      updated_at: "2026-01-01T00:00:00Z",
    };

    expect(conflictFieldUpdates("education", latest)).toEqual({
      institution: "Institution",
      qualification: "Qualification",
      field_of_study: "Field",
    });
    expect(conflictFieldUpdates("certification", latest)).toEqual({
      name: "Name",
      issuer: "Issuer",
      credential_url: null,
    });
    expect(conflictFieldUpdates("skill", latest)).toEqual({ name: "Name" });
    expect(conflictFieldUpdates("delete", latest)).toEqual({});
    expect(conflictDatePrefixes("certification")).toEqual(["issued"]);
    expect(conflictDatePrefixes("profile")).toEqual([]);
  });
});
