import { describe, expect, it } from "vitest";

import { ACTIVITY_FIELD_LIMITS } from "@/domain/activity/contracts";
import { activityCreateSchema, activityListFilterSchema, activityUpdateSchema } from "@/features/activity/schemas";

const baseCreate = {
  operationKey: "11111111-1111-4111-8111-111111111111",
  captureMode: "note" as const,
  rawText: "  Kept exactly\n😀  ",
  occurredOn: "2026-02-28",
};

describe("Activity input validation", () => {
  it("preserves raw text exactly while canonicalizing optional fields", () => {
    const parsed = activityCreateSchema.parse({
      ...baseCreate,
      role: "  Engineer  ",
      scope: " \n ",
      outcome: null,
    });

    expect(parsed.rawText).toBe(baseCreate.rawText);
    expect(parsed.role).toBe("Engineer");
    expect(parsed.scope).toBeNull();
    expect(parsed.outcome).toBeNull();
    expect(parsed.experienceId).toBeNull();
    expect(parsed.projectId).toBeNull();
  });

  it("rejects blank text, 10,001 Unicode code points, invalid dates, and unknown fields", () => {
    expect(activityCreateSchema.safeParse({ ...baseCreate, rawText: " \t\n " }).success).toBe(false);
    expect(activityCreateSchema.safeParse({
      ...baseCreate,
      rawText: "😀".repeat(ACTIVITY_FIELD_LIMITS.rawText + 1),
    }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ ...baseCreate, occurredOn: "2026-02-30" }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ ...baseCreate, userId: "22222222-2222-4222-8222-222222222222" }).success).toBe(false);
  });

  it("accepts 10,000 Unicode code points, including astral symbols", () => {
    const result = activityCreateSchema.safeParse({
      ...baseCreate,
      rawText: "😀".repeat(ACTIVITY_FIELD_LIMITS.rawText),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(Array.from(result.data.rawText)).toHaveLength(10_000);
  });

  it("enforces the structured field limits consistently", () => {
    expect(activityCreateSchema.safeParse({ ...baseCreate, role: "r".repeat(201) }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ ...baseCreate, scope: "s".repeat(5_001) }).success).toBe(false);
    expect(activityCreateSchema.safeParse({ ...baseCreate, outcome: "o".repeat(5_001) }).success).toBe(false);
  });

  it("requires complete canonical editable state and a positive expected revision", () => {
    const valid = {
      activityId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
      rawText: "Updated note",
      occurredOn: "2026-03-01",
      role: null,
      scope: null,
      outcome: null,
      experienceId: null,
      projectId: null,
    };
    expect(activityUpdateSchema.safeParse(valid).success).toBe(true);
    expect(activityUpdateSchema.safeParse({ ...valid, expectedRevision: 0 }).success).toBe(false);
    expect(activityUpdateSchema.safeParse({ ...valid, captureMode: "chat" }).success).toBe(false);
  });

  it("validates inclusive date filters, owner project UUIDs, and cursors before queries", () => {
    expect(activityListFilterSchema.safeParse({
      from: "2026-02-01",
      to: "2026-02-28",
      projectId: "33333333-3333-4333-8333-333333333333",
    }).success).toBe(true);
    expect(activityListFilterSchema.safeParse({ from: "2026-03-01", to: "2026-02-28" }).success).toBe(false);
    expect(activityListFilterSchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(activityListFilterSchema.safeParse({ projectId: "invalid" }).success).toBe(false);
    expect(activityListFilterSchema.safeParse({ cursor: "tampered" }).success).toBe(false);
  });
});
