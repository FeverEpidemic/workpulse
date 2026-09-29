import { describe, expect, it } from "vitest";

import { suggestionToDraftFields } from "@/domain/ai/apply-mapping";
import type { DetectResult } from "@/domain/ai/detect-result";

function result(overrides: Partial<NonNullable<DetectResult["suggestion"]>> = {}): DetectResult {
  return {
    schema_version: "detect.v1",
    potential: true,
    suggestion: {
      title: "Migrated 3 reports",
      contribution: "Led the migration",
      outcome: "Reduced manual steps",
      role: "Tech lead",
      scope: "Reporting pipeline",
      cv_bullet: "Migrated 3 reports to the new pipeline",
      metrics: [{ label: "Reports migrated", value: 3, unit: "reports", baseline: null }],
      skills: ["Data migration"],
      ...overrides,
    },
    questions: [],
  };
}

describe("suggestionToDraftFields", () => {
  it("maps title/contribution/scope/outcome/cv_bullet directly and uses the activity's occurred_on", () => {
    const mapped = suggestionToDraftFields(result(), { occurredOn: "2026-09-20" });
    expect(mapped).toEqual({
      title: "Migrated 3 reports",
      contribution: "Led the migration",
      scope: "Reporting pipeline",
      outcome: "Reduced manual steps",
      cvBullet: "Migrated 3 reports to the new pipeline",
      achievedOn: "2026-09-20",
      metrics: [{ label: "Reports migrated", value: 3, unit: "reports" }],
    });
  });

  it("drops a null baseline instead of keeping it as null", () => {
    const mapped = suggestionToDraftFields(result({ metrics: [{ label: "x", value: 1, unit: "u", baseline: null }] }), { occurredOn: "2026-09-20" });
    expect(mapped.metrics[0]).not.toHaveProperty("baseline");
  });

  it("keeps a numeric baseline", () => {
    const mapped = suggestionToDraftFields(result({ metrics: [{ label: "x", value: 2, unit: "u", baseline: 5 }] }), { occurredOn: "2026-09-20" });
    expect(mapped.metrics[0]).toEqual({ label: "x", value: 2, unit: "u", baseline: 5 });
  });

  it("does not include suggestion.role anywhere in the mapped draft (achievements has no role column)", () => {
    const mapped = suggestionToDraftFields(result({ role: "Tech lead" }), { occurredOn: "2026-09-20" });
    expect(Object.values(mapped)).not.toContain("Tech lead");
    expect(mapped).not.toHaveProperty("role");
  });

  it("throws for a nonpotential result with no suggestion", () => {
    const nonpotential: DetectResult = { schema_version: "detect.v1", potential: false, suggestion: null, questions: [] };
    expect(() => suggestionToDraftFields(nonpotential, { occurredOn: "2026-09-20" })).toThrow();
  });
});
