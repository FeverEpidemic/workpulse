import { describe, expect, it } from "vitest";

import {
  activityFilterQuery,
  readActivityFilters,
  setActivityFilter,
} from "@/domain/routes/url-filters";

describe("activity filters in the URL", () => {
  it("reads only valid dates and a normalized project term", () => {
    expect(readActivityFilters(
      "?from=2024-02-29&to=2024-03-01&project=%20Launch%20&returnTo=https%3A%2F%2Fevil.example",
    )).toEqual({ from: "2024-02-29", to: "2024-03-01", project: "Launch" });

    expect(readActivityFilters({ from: "2023-02-29", to: "2024-13-01", project: " " }))
      .toEqual({ from: "", to: "", project: "" });
  });

  it("changes an allowlisted key, removes empty values, and bounds project text", () => {
    const first = setActivityFilter("from=2025-01-01&to=2025-02-01&returnTo=%2Fdashboard", "from", "");
    expect(new URLSearchParams(first).get("from")).toBeNull();
    expect(new URLSearchParams(first).get("to")).toBe("2025-02-01");
    expect(new URLSearchParams(first).get("returnTo")).toBe("/dashboard");

    const withLongProject = setActivityFilter("", "project", "x".repeat(140));
    expect(new URLSearchParams(withLongProject).get("project")).toHaveLength(120);
    expect(setActivityFilter("from=2025-01-01", "from", "2025-02-30")).toBe("");
  });

  it("serializes only filter state so unknown keys cannot become application state", () => {
    const filters = readActivityFilters("from=2025-01-01&admin=true&returnTo=https%3A%2F%2Fevil.example");
    const query = activityFilterQuery(filters);
    expect(query).toBe("from=2025-01-01");
    expect(readActivityFilters(query)).toEqual({ from: "2025-01-01", to: "", project: "" });
    expect(activityFilterQuery({ from: "", to: "", project: "  " })).toBe("");
  });
});
