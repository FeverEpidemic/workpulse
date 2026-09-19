import { describe, expect, it } from "vitest";

import { encodeActivityCursor } from "@/domain/activity/activity-cursor";
import {
  activityFilterQuery,
  activityListHref,
  readActivityFilters,
  readActivityQuery,
  setActivityFilter,
} from "@/domain/routes/url-filters";

const PROJECT_ID = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";
const CURSOR = encodeActivityCursor({
  occurredOn: "2025-02-01",
  id: "69d5940d-288c-4d5b-a9a7-41954870c1b8",
});

describe("Activity filters and cursor in the URL", () => {
  it("reads exact dates, an owned-project-shaped UUID, and the separate opaque cursor", () => {
    expect(readActivityQuery(
      `?from=2024-02-29&to=2024-03-01&project=${PROJECT_ID}&cursor=${CURSOR}&unknown=1`,
    )).toEqual({
      filters: { from: "2024-02-29", to: "2024-03-01", project: PROJECT_ID },
      cursor: CURSOR,
      errors: {},
      isValid: true,
    });
  });

  it("retains fixable values and reports invalid date, range, project, duplicate, and cursor state", () => {
    const invalidDate = readActivityQuery({ from: "2023-02-29", to: "", project: "not-an-id" });
    expect(invalidDate.filters).toEqual({ from: "2023-02-29", to: "", project: "not-an-id" });
    expect(invalidDate.errors).toEqual({ from: "invalid", project: "invalid" });
    expect(invalidDate.isValid).toBe(false);

    expect(readActivityQuery("from=2025-03-02&to=2025-03-01").errors).toEqual({ to: "range" });
    expect(readActivityQuery("from=2025-01-01&from=2025-01-02").errors).toEqual({ from: "invalid" });
    expect(readActivityQuery("cursor=bad").errors).toEqual({ cursor: "invalid" });
  });

  it("changes only an allowlisted filter and removes invalid dates", () => {
    const first = setActivityFilter("from=2025-01-01&to=2025-02-01&unknown=true", "from", "");
    expect(new URLSearchParams(first).get("from")).toBeNull();
    expect(new URLSearchParams(first).get("to")).toBe("2025-02-01");
    expect(setActivityFilter("from=2025-01-01", "from", "2025-02-30")).toBe("");
  });

  it("serializes only filter state and preserves cursor only in the list URL", () => {
    const filters = readActivityFilters(`from=2025-01-01&project=${PROJECT_ID}&cursor=${CURSOR}&admin=true`);
    expect(activityFilterQuery(filters)).toBe(`from=2025-01-01&project=${PROJECT_ID}`);
    expect(activityListHref(filters, CURSOR)).toBe(
      `/activity?from=2025-01-01&project=${PROJECT_ID}&cursor=${CURSOR}`,
    );
    expect(activityListHref({ from: "", to: "", project: "" })).toBe("/activity");
  });
});
