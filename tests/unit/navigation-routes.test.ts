import { describe, expect, it } from "vitest";

import {
  isCurrent,
  mobileTabCurrent,
  mobileTabFor,
  mobileTabs,
  mobileTitleKey,
  navigation,
} from "@/components/layout/navigation-routes";

describe("T27 sidebar routes stay as they were", () => {
  it("keeps the six sidebar destinations in order", () => {
    expect(navigation.map(({ href }) => href)).toEqual([
      "/dashboard", "/activity", "/achievements", "/projects", "/timeline", "/cv",
    ]);
  });

  it("matches the dashboard exactly and other sections by prefix", () => {
    expect(isCurrent("/dashboard", "/dashboard")).toBe(true);
    expect(isCurrent("/dashboard/x", "/dashboard")).toBe(false);
    expect(isCurrent("/projects/abc", "/projects")).toBe(true);
    expect(isCurrent("/projectsx", "/projects")).toBe(false);
  });
});

describe("T27 mobile tabs", () => {
  it("has five slots in a fixed order with Quick log in the middle", () => {
    expect(mobileTabs.map(({ id }) => id)).toEqual(["dashboard", "activity", "quickLog", "projects", "profile"]);
  });

  it.each([
    ["/dashboard", "dashboard"],
    ["/activity", "activity"],
    ["/activity/0b6f3f5e-1b1c-4c55-9f83-1d1b2f1f6a10", "activity"],
    ["/projects", "projects"],
    ["/projects/new", "projects"],
    ["/projects/0b6f3f5e-1b1c-4c55-9f83-1d1b2f1f6a10", "projects"],
    ["/settings/profile", "profile"],
    ["/achievements", "profile"],
    ["/achievements/new", "profile"],
    ["/timeline", "profile"],
    ["/cv", "profile"],
    ["/cv/preview", "profile"],
  ])("maps %s to the %s tab", (pathname, tab) => {
    expect(mobileTabFor(pathname)).toBe(tab);
  });

  it.each(["/activity/new", "/dashboard/extra", "/imports/x/review", "/"])("activates no tab on %s", (pathname) => {
    expect(mobileTabFor(pathname)).toBeNull();
  });

  it("marks only the exact route as the page and a child route as current", () => {
    expect(mobileTabCurrent("/projects", "projects")).toBe("page");
    expect(mobileTabCurrent("/projects/abc", "projects")).toBe("true");
    expect(mobileTabCurrent("/settings/profile", "profile")).toBe("page");
    expect(mobileTabCurrent("/achievements", "profile")).toBe("true");
    expect(mobileTabCurrent("/dashboard", "projects")).toBeUndefined();
    expect(mobileTabCurrent("/activity/new", "activity")).toBeUndefined();
  });
});

describe("T27 mobile header titles", () => {
  it.each([
    ["/dashboard", "workspace.dashboard"],
    ["/activity", "workspace.activity"],
    ["/activity/new", "quickLog.title"],
    ["/activity/abc", "workspace.activity"],
    ["/projects/abc", "workspace.projects"],
    ["/achievements/new", "workspace.achievements"],
    ["/timeline", "workspace.timeline"],
    ["/cv/preview", "workspace.cv"],
    ["/settings/profile", "profile.title"],
  ])("titles %s with %s", (pathname, key) => {
    expect(mobileTitleKey(pathname)).toBe(key);
  });

  it("falls back to the logo for routes without a title", () => {
    expect(mobileTitleKey("/settings/other")).toBeNull();
    expect(mobileTitleKey("/")).toBeNull();
  });
});
