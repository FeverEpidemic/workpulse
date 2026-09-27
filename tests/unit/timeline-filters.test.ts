import { describe, expect, it } from "vitest";

import { readTimelineQuery, timelineListHref } from "@/domain/routes/timeline-filters";

const PROJECT_ID = "70d2c57c-46e8-4cda-9b3b-c47f342099da";

describe("Timeline filters", () => {
  it("accepts the event type allowlist and an owned-project-shaped UUID", () => {
    expect(readTimelineQuery({ type: "project", project: PROJECT_ID, ignored: "value" })).toEqual({
      filters: { type: "project", project: PROJECT_ID },
      errors: {},
      isValid: true,
    });
  });

  it("rejects unsupported types, invalid projects, and duplicate values", () => {
    expect(readTimelineQuery({ type: "streak" })).toMatchObject({
      filters: { type: "" },
      errors: { type: "invalid" },
      isValid: false,
    });
    expect(readTimelineQuery({ project: "not-a-uuid" }).errors.project).toBe("invalid");
    expect(readTimelineQuery({ type: ["project", "project"] }).errors.type).toBe("invalid");
    expect(readTimelineQuery({ project: [PROJECT_ID, PROJECT_ID] }).errors.project).toBe("invalid");
  });

  it("serializes type before project and omits empty filters", () => {
    expect(timelineListHref({ type: "project", project: PROJECT_ID })).toBe(
      `/timeline?type=project&project=${PROJECT_ID}`,
    );
    expect(timelineListHref({ type: "", project: "" })).toBe("/timeline");
  });
});
