import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { projectCreateSchema, projectUpdateSchema } from "@/features/project/schemas";
import { normalizeProjectInput } from "@/features/project/project-service";

const base = {
  title: "  Launch portfolio  ",
  description: "  A concise project description  ",
  userRole: null,
  outcome: null,
  status: "planned" as const,
  experienceId: null,
  startDate: "2024-01-01",
  startPrecision: "year" as const,
  endDate: null,
  endPrecision: null,
  isCurrent: false,
};

describe("Project field validation", () => {
  it("normalizes title whitespace and accepts standalone unknown-date projects", () => {
    const result = projectCreateSchema.safeParse({
      ...base,
      operationKey: randomUUID(),
      startDate: null,
      startPrecision: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("Launch portfolio");
      expect(result.data.experienceId).toBeNull();
    }
  });

  it("allows completed projects without an outcome", () => {
    const result = projectCreateSchema.safeParse({
      ...base,
      operationKey: randomUUID(),
      status: "completed",
      outcome: null,
    });
    expect(result.success).toBe(true);
  });

  it("keeps a valid completed end date while forcing the project to non-current", () => {
    const result = projectCreateSchema.safeParse({
      ...base,
      operationKey: randomUUID(),
      status: "completed",
      endDate: "2024-06-01",
      endPrecision: "month",
      isCurrent: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const normalized = normalizeProjectInput(result.data);
      expect(normalized.isCurrent).toBe(false);
      expect(normalized.endDate).toBe("2024-06-01");
      expect(normalized.endPrecision).toBe("month");
    }
  });

  it("rejects partial pairs, current end dates, and definite reversed ranges", () => {
    expect(projectCreateSchema.safeParse({ ...base, operationKey: randomUUID(), startDate: "2024-01-01", startPrecision: null }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ ...base, operationKey: randomUUID(), isCurrent: true, endDate: "2024-02-01", endPrecision: "day" }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ ...base, operationKey: randomUUID(), startDate: "2024-04-01", startPrecision: "day", endDate: "2024-03-01", endPrecision: "month" }).success).toBe(false);
  });

  it("enforces the same range contract for edits", () => {
    const result = projectUpdateSchema.safeParse({
      ...base,
      projectId: "22222222-2222-4222-8222-222222222222",
      expectedRevision: 2,
      startDate: "2024-01-01",
      startPrecision: "year",
      endDate: "2023-12-01",
      endPrecision: "month",
    });
    expect(result.success).toBe(false);
  });
});
