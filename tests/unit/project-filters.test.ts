import { describe, expect, it } from "vitest";

import { encodeProjectCursor } from "@/domain/project/project-cursor";
import { projectListHref, readProjectQuery } from "@/domain/routes/project-filters";

const cursor = encodeProjectCursor({
  updatedAt: "2026-09-20T12:00:00.000Z",
  id: "22222222-2222-4222-8222-222222222222",
});

describe("Project list filters", () => {
  it("accepts only the status and cursor query contract", () => {
    expect(readProjectQuery({ status: "active", cursor })).toEqual({
      filters: { status: "active", outcome: "" },
      cursor,
      errors: {},
      isValid: true,
    });
    expect(readProjectQuery({ status: "paused" }).isValid).toBe(false);
    expect(readProjectQuery({ q: "search" }).errors.unknown).toBe(true);
    expect(readProjectQuery({ cursor: "tampered" }).errors.cursor).toBe("invalid");
  });

  it("serializes a stable list URL and drops the cursor when the filter changes", () => {
    expect(projectListHref({ status: "active", outcome: "" }, cursor)).toBe(`/projects?status=active&cursor=${cursor}`);
    expect(projectListHref({ status: "completed", outcome: "missing" })).toBe("/projects?status=completed&outcome=missing");
  });

  it("accepts only the missing outcome value and marks duplicate or invalid filters", () => {
    expect(readProjectQuery({ outcome: "missing" }).filters.outcome).toBe("missing");
    expect(readProjectQuery({ outcome: "x" }).errors.outcome).toBe("invalid");
    expect(readProjectQuery({ outcome: ["missing", "missing"] }).errors.outcome).toBe("invalid");
    expect(readProjectQuery({ outcome: "missing", unknown: "1" }).errors.unknown).toBe(true);
  });
});
