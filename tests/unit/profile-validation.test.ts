import { describe, expect, it } from "vitest";

import { resolveLocale } from "@/i18n/messages";
import { displayNameSchema, onboardingFormSchema, profileFormSchema } from "@/features/profile/schemas";

describe("profile validation and locale resolution", () => {
  it("requires only the onboarding display name among career and profile information", () => {
    expect(onboardingFormSchema.safeParse({
      display_name: "Sam",
      locale: "en",
      timezone: "UTC",
      expected_revision: "1",
    }).success).toBe(true);
    expect(displayNameSchema.safeParse(" Pending onboarding ").success).toBe(false);
    expect(displayNameSchema.safeParse("   ").success).toBe(false);
  });

  it("normalizes empty optional profile fields to null", () => {
    const result = profileFormSchema.parse({
      display_name: "Sam",
      headline: "",
      summary: "",
      contact_email: "",
      phone: "",
      location: "",
      website: "",
      locale: "id",
      timezone: "Asia/Jakarta",
      expected_revision: "4",
    });
    expect(result).toMatchObject({
      headline: null,
      summary: null,
      contact_email: null,
      phone: null,
      location: null,
      website: null,
      locale: "id",
      expected_revision: 4,
    });
  });

  it("uses a completed profile locale first and a valid cookie before login", () => {
    expect(resolveLocale("id", "en")).toBe("id");
    expect(resolveLocale(null, "id")).toBe("id");
    expect(resolveLocale(null, "unknown")).toBe("en");
  });
});
