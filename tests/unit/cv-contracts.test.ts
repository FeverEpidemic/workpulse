import { describe, expect, it } from "vitest";

import {
  CV_ERROR_CODES,
  CV_SECTION_KEYS,
  CV_SOURCE_TYPES,
  SECTION_FOR_SOURCE_TYPE,
  cvSourceSnapshotSchema,
  parseChildItemsDetail,
  removeCvItemInput,
  reorderCvSectionInput,
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

  it("lists the twelve database error codes", () => {
    expect([...CV_ERROR_CODES].sort()).toEqual([
      "AUTH_REQUIRED", "CV_CHILD_ITEMS_EXIST", "CV_ITEM_IMMUTABLE", "CV_ITEM_NOT_FOUND", "CV_NOT_FOUND", "CV_REORDER_INVALID",
      "CV_SOURCE_DUPLICATE", "CV_SOURCE_INELIGIBLE", "CV_SOURCE_NOT_FOUND", "INVALID_CV_INPUT", "ONBOARDING_REQUIRED", "STALE_REVISION",
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
