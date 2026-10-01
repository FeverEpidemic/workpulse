import { describe, expect, it } from "vitest";

import type { CvSourceSnapshot } from "@/domain/cv/contracts";
import { isValidReorder, isValidSectionOrder, requiredParent } from "@/domain/cv/selection";

const P = "a6000000-0000-4000-8000-000000000001";
const E = "a1000000-0000-4000-8000-000000000001";

function achievement(experience: string | null, project: string | null): CvSourceSnapshot {
  return {
    schema_version: "cv-source.v1", source_type: "achievement", source_id: "a5000000-0000-4000-8000-000000000001",
    title: "Hasil", cv_bullet: "Bullet", achieved_on: "2024-01-01", experience_id: experience, project_id: project,
  };
}

describe("T18 CV selection rules", () => {
  describe("requiredParent", () => {
    it("prefers the project over the experience", () => {
      expect(requiredParent(achievement(E, P))).toEqual({ type: "project", id: P });
    });

    it("falls back to the experience", () => {
      expect(requiredParent(achievement(E, null))).toEqual({ type: "experience", id: E });
    });

    it("has no parent without context", () => {
      expect(requiredParent(achievement(null, null))).toBeNull();
    });

    it("has no parent for any other source type", () => {
      expect(requiredParent({ schema_version: "cv-source.v1", source_type: "skill", source_id: E, name: "SQL" })).toBeNull();
      expect(requiredParent({
        schema_version: "cv-source.v1", source_type: "project", source_id: P, title: "T", description: null, user_role: null, outcome: null,
        status: "active", start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false, experience_id: E,
      })).toBeNull();
    });
  });

  describe("isValidSectionOrder", () => {
    const valid = ["skills", "education", "experience", "projects", "achievements", "certifications"];

    it("accepts every permutation of the six keys", () => {
      expect(isValidSectionOrder(valid)).toBe(true);
      expect(isValidSectionOrder(["experience", "projects", "achievements", "education", "skills", "certifications"])).toBe(true);
    });

    it("rejects missing, duplicated, foreign and non-string entries", () => {
      expect(isValidSectionOrder(valid.slice(1))).toBe(false);
      expect(isValidSectionOrder([...valid.slice(1), "education"])).toBe(false);
      expect(isValidSectionOrder([...valid.slice(1), "hobbies"])).toBe(false);
      expect(isValidSectionOrder([...valid.slice(1), 7])).toBe(false);
      expect(isValidSectionOrder("skills")).toBe(false);
      expect(isValidSectionOrder(null)).toBe(false);
    });
  });

  describe("isValidReorder", () => {
    it("accepts the same set in any order", () => {
      expect(isValidReorder(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
      expect(isValidReorder([], [])).toBe(true);
    });

    it("rejects missing, extra, duplicated and foreign ids", () => {
      expect(isValidReorder(["a", "b"], ["a"])).toBe(false);
      expect(isValidReorder(["a", "b"], ["a", "b", "c"])).toBe(false);
      expect(isValidReorder(["a", "b"], ["a", "a"])).toBe(false);
      expect(isValidReorder(["a", "b"], ["a", "x"])).toBe(false);
    });
  });
});
