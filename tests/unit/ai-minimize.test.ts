import { describe, expect, it } from "vitest";

import { buildDetectInput } from "@/domain/ai/minimize";

describe("AI input minimization", () => {
  it("sends only the note, role, scope, outcome and locale", () => {
    const source = {
      raw_text: "Shipped the onboarding flow",
      role: "Engineer",
      scope: null,
      outcome: "Launched",
      locale: "id",
      id: "7c1a3f0e-0000-4000-8000-000000000001",
      user_id: "SENTINEL-USER-ID",
      display_name: "SENTINEL-NAME",
      email: "sentinel@example.test",
      project_title: "SENTINEL-PROJECT",
      organization: "SENTINEL-EMPLOYER",
      filename: "SENTINEL-EVIDENCE.pdf",
    };
    const input = buildDetectInput(source);

    expect(Object.keys(input).sort()).toEqual(["locale", "outcome", "raw_text", "role", "scope"]);
    expect(input).toEqual({ locale: "id", raw_text: "Shipped the onboarding flow", role: "Engineer", scope: null, outcome: "Launched" });
    expect(JSON.stringify(input)).not.toMatch(/SENTINEL|7c1a3f0e/);
  });

  it("falls back to English for an unsupported locale", () => {
    expect(buildDetectInput({ raw_text: "x", role: null, scope: null, outcome: null, locale: "fr" }).locale).toBe("en");
    expect(buildDetectInput({ raw_text: "x", role: null, scope: null, outcome: null, locale: null }).locale).toBe("en");
  });
});
