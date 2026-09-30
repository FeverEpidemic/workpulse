import { describe, expect, it } from "vitest";

import { hasOverride, resolveItemText, resolveProfile, resolveSummary, supportsOverride } from "@/domain/cv/resolve";

import { achievementSnapshot, certificationSnapshot, documentRow, educationSnapshot, skillSnapshot, uuid } from "./cv-fixtures";

describe("T19 CV resolve", () => {
  it("prefers the override and falls back to the source wording", () => {
    const snapshot = achievementSnapshot(uuid(1));
    expect(resolveItemText({ override_text: null, source_snapshot: snapshot })).toBe("Bullet 001");
    expect(resolveItemText({ override_text: "Custom", source_snapshot: snapshot })).toBe("Custom");
    expect(hasOverride({ override_text: "Custom" })).toBe(true);
    expect(hasOverride({ override_text: null })).toBe(false);
    expect(resolveItemText({ override_text: null, source_snapshot: educationSnapshot(uuid(2)) })).toBeNull();
    expect(resolveItemText({ override_text: null, source_snapshot: skillSnapshot(uuid(3)) })).toBeNull();
  });

  it("supports overrides for wording items only", () => {
    expect(supportsOverride(achievementSnapshot(uuid(1)))).toBe(true);
    expect(supportsOverride(educationSnapshot(uuid(2)))).toBe(true);
    expect(supportsOverride(skillSnapshot(uuid(3)))).toBe(false);
    expect(supportsOverride(certificationSnapshot(uuid(4)))).toBe(false);
  });

  it("merges profile overrides per key over the copied source", () => {
    const document = documentRow();
    expect(resolveProfile(document).headline).toBe("Graduate");
    const overridden = documentRow({ profile_snapshot: { ...document.profile_snapshot, display_overrides: { headline: "Analyst" } } });
    expect(resolveProfile(overridden)).toMatchObject({ display_name: "Ani Contoh", headline: "Analyst", phone: null });
  });

  it("uses the summary override, else the source summary", () => {
    expect(resolveSummary(documentRow())).toBe("Source summary");
    expect(resolveSummary(documentRow({ summary_override: "Mine" }))).toBe("Mine");
    expect(resolveSummary(documentRow({ profile_snapshot: {} }))).toBeNull();
  });
});
