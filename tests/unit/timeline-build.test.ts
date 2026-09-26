import { describe, expect, it } from "vitest";

import {
  buildTimelineEvents,
  filterTimelineEvents,
  groupTimelineEvents,
  timelineHref,
  type TimelineSources,
} from "@/domain/timeline/timeline";

const E1 = "10000000-0000-4000-8000-000000000001";
const E2 = "10000000-0000-4000-8000-000000000002";
const ED1 = "10000000-0000-4000-8000-000000000011";
const ED2 = "10000000-0000-4000-8000-000000000012";
const P1 = "10000000-0000-4000-8000-000000000021";
const P2 = "10000000-0000-4000-8000-000000000022";
const P3 = "10000000-0000-4000-8000-000000000023";
const P4 = "10000000-0000-4000-8000-000000000024";
const C1 = "10000000-0000-4000-8000-000000000031";
const C2 = "10000000-0000-4000-8000-000000000032";
const C3 = "10000000-0000-4000-8000-000000000033";
const C4 = "10000000-0000-4000-8000-000000000034";
const C5 = "10000000-0000-4000-8000-000000000035";
const D1 = "10000000-0000-4000-8000-000000000036";
const X1 = "10000000-0000-4000-8000-000000000037";
const NO_DATE = "10000000-0000-4000-8000-000000000038";

const sources: TimelineSources = {
  experiences: [
    { id: E1, organization: "Northwind", role_title: "Analyst", start_date: "2021-03-01", start_precision: "month", end_date: "2023-06-01", end_precision: "month", is_current: false },
    { id: E2, organization: "Contoso", role_title: "Consultant", start_date: "2022-01-01", start_precision: "month", end_date: null, end_precision: null, is_current: true },
  ],
  education: [
    { id: ED1, institution: "Universitas Indonesia", qualification: "S.Kom", start_date: "2016-01-01", start_precision: "year", end_date: "2020-01-01", end_precision: "year", is_current: false },
    { id: ED2, institution: "Online Academy", qualification: "Certificate", start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false },
  ],
  projects: [
    { id: P1, title: "Platform revamp", experience_id: E2, start_date: "2024-02-01", start_precision: "month", end_date: null, end_precision: null, is_current: true },
    { id: P2, title: "Thesis prototype", experience_id: null, start_date: "2023-01-01", start_precision: "year", end_date: null, end_precision: null, is_current: false },
    { id: P3, title: "Migration", experience_id: null, start_date: null, start_precision: null, end_date: null, end_precision: null, is_current: false },
    { id: P4, title: "Next initiative", experience_id: null, start_date: "2025-01-15", start_precision: "day", end_date: null, end_precision: null, is_current: false },
  ],
  achievements: [
    { id: C1, title: "Revamped platform", status: "confirmed", achieved_on: "2026-08-10", project_id: P1, experience_id: null },
    { id: C2, title: "Wrote documentation", status: "confirmed", achieved_on: "2026-07-01", project_id: null, experience_id: null },
    { id: C3, title: "Improved analysis", status: "confirmed", achieved_on: "2023-05-20", project_id: null, experience_id: E1 },
    { id: C4, title: "Resolved an issue", status: "confirmed", achieved_on: "2025-11-03", project_id: null, experience_id: null },
    { id: C5, title: "Completed thesis prototype", status: "confirmed", achieved_on: "2023-09-09", project_id: P2, experience_id: null },
    { id: D1, title: "Unconfirmed draft", status: "draft", achieved_on: "2026-09-01", project_id: null, experience_id: null },
    { id: X1, title: "Dismissed item", status: "dismissed", achieved_on: "2026-09-02", project_id: null, experience_id: null },
    { id: NO_DATE, title: "Confirmed without a date", status: "confirmed", achieved_on: null, project_id: null, experience_id: null },
  ],
};

describe("Career timeline domain builder", () => {
  it("groups reverse chronologically, keeps overlapping roles, and sorts unknown events last", () => {
    const groups = groupTimelineEvents(buildTimelineEvents(sources));

    expect(groups.map((group) => group.key)).toEqual([
      "2026", "2025", "2024", "2023", "2022", "2021", "2016", "undated",
    ]);
    expect(groups.map((group) => group.events.map((event) => event.id))).toEqual([
      [C1, C2],
      [C4, P4],
      [P1],
      [C5, C3, P2],
      [E2],
      [E1],
      [ED1],
      [P3, ED2],
    ]);
    expect(groups.flatMap((group) => group.events).filter((event) => event.id === E1 || event.id === E2)).toHaveLength(2);
    expect(groups.flatMap((group) => group.events).find((event) => event.id === E2)?.isCurrent).toBe(true);
    expect(groups.flatMap((group) => group.events).map((event) => event.id)).not.toContain(D1);
    expect(groups.flatMap((group) => group.events).map((event) => event.id)).not.toContain(X1);
    expect(groups.flatMap((group) => group.events).map((event) => event.id)).not.toContain(NO_DATE);
  });

  it("adds source context only when a canonical relationship exists", () => {
    const events = buildTimelineEvents(sources);
    expect(events.find((event) => event.id === P1)?.context).toBe("Consultant · Contoso");
    expect(events.find((event) => event.id === P2)?.context).toBeNull();
    expect(events.find((event) => event.id === C1)?.context).toBe("Platform revamp");
    expect(events.find((event) => event.id === C2)?.context).toBeNull();
  });

  it("filters by event type or project without inferring experience membership", () => {
    const events = buildTimelineEvents(sources);
    expect(filterTimelineEvents(events, { type: "project", project: "" }).map((event) => event.id).sort()).toEqual([P1, P2, P3, P4].sort());
    expect(filterTimelineEvents(events, { type: "", project: P1 }).map((event) => event.id).sort()).toEqual([P1, C1].sort());
    expect(filterTimelineEvents(events, { type: "", project: "10000000-0000-4000-8000-000000000099" })).toEqual([]);
  });

  it("builds canonical deep links and does not create an event for an undated Achievement", () => {
    expect(timelineHref("experience", E1)).toBe(`/settings/profile?record=${E1}#experience-${E1}`);
    expect(timelineHref("education", ED1)).toBe(`/settings/profile?record=${ED1}#education-${ED1}`);
    expect(timelineHref("project", P1)).toBe(`/projects/${P1}`);
    expect(timelineHref("achievement", C1)).toBe(`/achievements/${C1}`);
    expect(buildTimelineEvents(sources).some((event) => event.id === NO_DATE)).toBe(false);
  });
});
