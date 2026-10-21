import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MobileHeader } from "@/components/layout/mobile-header";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

type TabBarProps = Parameters<typeof MobileTabBar>[0];

function tabBarProps(extra: Partial<TabBarProps> = {}): TabBarProps {
  return {
    locale: "en",
    pathname: "/dashboard",
    compact: false,
    displayName: "Rina Wulandari",
    email: "rina@example.test",
    onExpand: vi.fn(),
    onQuickLog: vi.fn(),
    ...extra,
  };
}

function tabBar(extra: Partial<TabBarProps> = {}): string {
  return renderToStaticMarkup(<MobileTabBar {...tabBarProps(extra)} />);
}

function controls(html: string): string[] {
  return [...html.matchAll(/<(a|button)\b[^>]*>/g)].map(([tag]) => tag);
}

function labels(html: string): string[] {
  return [...html.matchAll(/<span class="([^"]*workspace-tab-label[^"]*)">([^<]+)<\/span>/g)]
    .map(([, className, text]) => `${text}|${className}`);
}

describe("T27 mobile tab bar", () => {
  it("is a labelled navigation with exactly five controls in a fixed order", () => {
    const html = tabBar();
    expect(html).toMatch(/^<nav class="workspace-tab-bar" aria-label="Main tabs" data-compact="false">/);
    const tags = controls(html);
    expect(tags).toHaveLength(5);
    expect(tags[0]).toContain('href="/dashboard"');
    expect(tags[1]).toContain('href="/activity"');
    expect(tags[2]).toMatch(/^<button type="button"[^>]*aria-haspopup="dialog"/);
    expect(tags[3]).toContain('href="/projects"');
    expect(tags[4]).toContain('href="/settings/profile"');
    expect(labels(html).map((entry) => entry.split("|")[0])).toEqual(["Dashboard", "Activity", "Quick log", "Projects", "Profile"]);
  });

  it("uses the Indonesian labels", () => {
    expect(labels(tabBar({ locale: "id" })).map((entry) => entry.split("|")[0]))
      .toEqual(["Dashboard", "Aktivitas", "Catatan cepat", "Proyek", "Profil"]);
  });

  it("marks the exact route as the page and a child route as current, with a weight change beside the colour", () => {
    const onDashboard = controls(tabBar({ pathname: "/dashboard" }));
    expect(onDashboard[0]).toContain('class="workspace-tab is-current"');
    expect(onDashboard[0]).toContain('aria-current="page"');
    expect(onDashboard[3]).not.toContain("aria-current");

    const onProjectDetail = controls(tabBar({ pathname: "/projects/abc" }));
    expect(onProjectDetail[3]).toContain('aria-current="true"');
    expect(onProjectDetail[0]).not.toContain("aria-current");

    const onTimeline = controls(tabBar({ pathname: "/timeline" }));
    expect(onTimeline[4]).toContain('aria-current="true"');
    expect(tabBar({ pathname: "/dashboard" })).toMatch(/is-current"[^>]*>[\s\S]*?stroke-width="2.4"/);
  });

  it("keeps every label in the DOM and only hides it visually when compact", () => {
    const expanded = labels(tabBar());
    const compact = labels(tabBar({ compact: true }));
    expect(compact).toHaveLength(5);
    for (const entry of compact) expect(entry).toMatch(/\|workspace-tab-label sr-only$/);
    expect(expanded.filter((entry) => entry.endsWith("sr-only"))).toEqual(["Quick log|workspace-tab-label sr-only"]);
    expect(tabBar({ compact: true })).toContain('data-compact="true"');
  });

  it("draws the Profile tab as an initials circle hidden from screen readers", () => {
    const html = tabBar();
    expect(html).toContain('<span class="initials-avatar" aria-hidden="true">RW</span>');
    expect(html).not.toMatch(/<img/);
  });

  it("expands the bar on a tap outside the controls but not on a tab", () => {
    const onExpand = vi.fn();
    const nav = MobileTabBar(tabBarProps({ compact: true, onExpand })) as ReactElement<{ onClick: (event: unknown) => void }>;
    nav.props.onClick({ target: { closest: () => null } });
    expect(onExpand).toHaveBeenCalledTimes(1);
    nav.props.onClick({ target: { closest: () => ({}) } });
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});

type HeaderProps = Parameters<typeof MobileHeader>[0];

function header(extra: Partial<HeaderProps> = {}): string {
  return renderToStaticMarkup(
    <MobileHeader locale="en" pathname="/dashboard" compact={false} sheetOpen={false} onOpenMore={vi.fn()} {...extra} />,
  );
}

describe("T27 mobile header", () => {
  it("shows the page title as plain text, not a heading", () => {
    const html = header({ pathname: "/projects/abc" });
    expect(html).toContain('<p class="workspace-mobile-title">Projects</p>');
    expect(html).not.toMatch(/<h1/);
  });

  it("falls back to the logo on a route without a title", () => {
    const html = header({ pathname: "/settings/other" });
    expect(html).toContain('class="brand-logo workspace-mobile-brand"');
    expect(html).not.toContain("workspace-mobile-title");
  });

  it("shows the labelled More button only on Profile", () => {
    expect(header()).not.toContain("Open more menu");
    const html = header({ pathname: "/settings/profile" });
    expect(html).toMatch(/<button type="button"[^>]*aria-label="Open more menu"[^>]*aria-haspopup="dialog"/);
    expect(html).toContain(">More</span>");
    expect(header({ pathname: "/achievements" })).not.toContain("Open more menu");
  });

  it("hides while compact, but never while a sheet is open", () => {
    expect(header({ compact: true })).toContain('data-hidden="true"');
    expect(header({ compact: false })).toContain('data-hidden="false"');
    expect(header({ compact: true, sheetOpen: true })).toContain('data-hidden="false"');
  });
});
