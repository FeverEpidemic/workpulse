import { describe, expect, it } from "vitest";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeAchievementReturnTo, sanitizeActivityReturnTo, sanitizeProjectDetailReturnTo, sanitizeProjectReturnTo, sanitizeReturnTo } from "@/domain/routes/safe-return";
import { encodeActivityCursor } from "@/domain/activity/activity-cursor";

describe("safe internal return routes", () => {
  it("allows product routes and only their supported filter parameters", () => {
    expect(sanitizeReturnTo("/projects?status=active")).toBe("/projects?status=active");
    expect(sanitizeReturnTo("/settings/profile?mode=onboarding")).toBe("/settings/profile?mode=onboarding");
    expect(sanitizeReturnTo("/activity/70d2c57c-46e8-4cda-9b3b-c47f342099da")).toBe(
      "/activity/70d2c57c-46e8-4cda-9b3b-c47f342099da",
    );
    const cursor = encodeActivityCursor({
      occurredOn: "2025-01-01",
      id: "70d2c57c-46e8-4cda-9b3b-c47f342099da",
    });
    const list = `/activity?from=2025-01-01&cursor=${cursor}`;
    expect(sanitizeReturnTo(list)).toBe(list);
    expect(sanitizeReturnTo(`/activity/new?returnTo=${encodeURIComponent(list)}`)).toBe(
      `/activity/new?returnTo=${encodeURIComponent(list)}`,
    );
    expect(sanitizeActivityReturnTo("/projects?status=active")).toBe("/activity");
    const projectDetail = "/projects/70d2c57c-46e8-4cda-9b3b-c47f342099da?returnTo=" + encodeURIComponent("/projects?status=active");
    expect(sanitizeActivityReturnTo(projectDetail)).toBe(projectDetail);
    expect(sanitizeProjectDetailReturnTo(projectDetail)).toBe(projectDetail);
    expect(sanitizeProjectReturnTo("/projects?status=completed&cursor=" + encodeURIComponent("bad"))).toBe("/projects");
  });

  it("preserves Achievement create context only when the source query is unambiguous", () => {
    const id = "70d2c57c-46e8-4cda-9b3b-c47f342099da";
    const activityCreate = `/achievements/new?${new URLSearchParams({ activity: id, returnTo: "/activity?from=2026-09-01" }).toString()}`;
    const projectDetail = `/projects/${id}?returnTo=${encodeURIComponent("/projects?status=active")}`;
    const projectCreate = `/achievements/new?${new URLSearchParams({ project: id, returnTo: projectDetail }).toString()}`;
    expect(sanitizeReturnTo(activityCreate)).toBe(activityCreate);
    expect(sanitizeReturnTo(projectCreate)).toBe(projectCreate);
    expect(sanitizeReturnTo(`/achievements/new?activity=${id}&project=${id}`)).toBe("/dashboard");
    expect(sanitizeReturnTo(`/achievements/new?activity=${id}&activity=${id}`)).toBe("/dashboard");
    expect(sanitizeReturnTo(`/achievements/new?project=${id}&returnTo=${encodeURIComponent("https://attacker.example")}`)).toBe("/dashboard");
    expect(sanitizeReturnTo(`/achievements/new?activity=not-a-uuid`)).toBe("/dashboard");
    expect(sanitizeReturnTo(`/achievements/new?activity=${id}&unknown=1`)).toBe("/dashboard");
  });

  it("round-trips Achievement detail through Activity with an explicit nesting limit", () => {
    const id = "70d2c57c-46e8-4cda-9b3b-c47f342099da";
    const achievementDetail = `/achievements/${id}?returnTo=${encodeURIComponent("/achievements?status=confirmed")}`;
    const activityDetail = `/activity/${id}?returnTo=${encodeURIComponent(achievementDetail)}`;
    expect(sanitizeActivityReturnTo(achievementDetail)).toBe(achievementDetail);
    expect(sanitizeReturnTo(activityDetail)).toBe(activityDetail);
    expect(sanitizeAchievementReturnTo(activityDetail)).toBe(activityDetail);

    let withinLimit = "/activity";
    let overLimit = "/activity";
    for (let index = 0; index < 4; index += 1) {
      withinLimit = `${index % 2 ? "/activity" : "/achievements"}/${id}?returnTo=${encodeURIComponent(withinLimit)}`;
      overLimit = `${index % 2 ? "/activity" : "/achievements"}/${id}?returnTo=${encodeURIComponent(overLimit)}`;
    }
    overLimit = `/activity/${id}?returnTo=${encodeURIComponent(overLimit)}`;
    expect(sanitizeReturnTo(withinLimit)).toBe(withinLimit);
    expect(sanitizeReturnTo(overLimit)).toBe("/dashboard");
  });

  it("rejects a return URL longer than 500 characters", () => {
    const oversized = `/activity/new?returnTo=${"a".repeat(500)}`;
    expect(oversized.length).toBeGreaterThan(500);
    expect(sanitizeReturnTo(oversized)).toBe("/dashboard");
  });

  it.each([
    "https://attacker.example",
    "//attacker.example/path",
    "/auth/confirm?code=secret",
    "/dashboard?next=https://attacker.example",
    "/%2f%2fattacker.example",
    "/projects/../sign-in",
    "/projects?q=%ZZ",
    "/achievements/new?activity=70d2c57c-46e8-4cda-9b3b-c47f342099da&returnTo=%2Factivity%5C%5C%2Foutside",
    "/achievements/new?activity=70d2c57c-46e8-4cda-9b3b-c47f342099da&other=1",
    "/unknown",
    "/activity?q=a&q=b",
    "/activity?from=2025-02-30",
    "/activity?project=not-a-uuid",
    "/activity?from=2025-02-01&to=2025-01-31",
    "/activity?cursor=broken",
    "/achievements/new?activity=70d2c57c-46e8-4cda-9b3b-c47f342099da&returnTo=%2Factivity%3Ffrom%3D2025-01-01%250a",
    "/achievements/new?activity=70d2c57c-46e8-4cda-9b3b-c47f342099da&activity=70d2c57c-46e8-4cda-9b3b-c47f342099da",
    "/achievements/new?activity=70d2c57c-46e8-4cda-9b3b-c47f342099da&project=70d2c57c-46e8-4cda-9b3b-c47f342099da",
  ])("rejects unsafe return route %s", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/dashboard");
  });
});

describe("profile lifecycle routing", () => {
  it("sends anonymous users to sign-in and retains an allowlisted deep link", () => {
    expect(destinationForLifecycle("anonymous")).toBe("/sign-in");
    expect(destinationForLifecycle("anonymous", "/projects?status=active")).toBe(
      "/sign-in?returnTo=%2Fprojects%3Fstatus%3Dactive",
    );
  });

  it("sends provisional profiles through manual onboarding", () => {
    expect(destinationForLifecycle("provisional", "/projects")).toBe("/onboarding/import");
  });

  it("sends complete profiles to the safe requested destination", () => {
    expect(destinationForLifecycle("complete", "/settings/profile")).toBe("/settings/profile");
    expect(destinationForLifecycle("complete", "//outside.example")).toBe("/dashboard");
  });
});
