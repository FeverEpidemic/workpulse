import { describe, expect, it } from "vitest";

import { destinationForLifecycle } from "@/domain/auth/route-state";
import { sanitizeActivityReturnTo, sanitizeReturnTo } from "@/domain/routes/safe-return";
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
  });

  it.each([
    "https://attacker.example",
    "//attacker.example/path",
    "/auth/confirm?code=secret",
    "/dashboard?next=https://attacker.example",
    "/%2f%2fattacker.example",
    "/projects/../sign-in",
    "/projects?q=%ZZ",
    "/unknown",
    "/activity?q=a&q=b",
    "/activity?from=2025-02-30",
    "/activity?project=not-a-uuid",
    "/activity?from=2025-02-01&to=2025-01-31",
    "/activity?cursor=broken",
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
