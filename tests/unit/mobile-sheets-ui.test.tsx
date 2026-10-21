import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/settings/profile",
}));

import { MoreMenuSheet, QuickLogSheet } from "@/components/layout/mobile-sheets";
import { mergeDraftValues } from "@/components/forms/session-draft";
import { ActivityCaptureForm } from "@/features/activity/activity-capture-form";

const OWNER = "d8edc2e3-618e-4f23-a1de-e9ae18cb9740";
const OPTIONS = {
  experiences: [],
  projects: [{ id: "0b6f3f5e-1b1c-4c55-9f83-1d1b2f1f6a10", title: "Riset Pelanggan", experience_id: null }],
};

function form(variant?: "full" | "sheet", returnTo = "/dashboard"): string {
  return renderToStaticMarkup(
    <ActivityCaptureForm
      locale="en"
      ownerId={OWNER}
      defaultOccurredOn="2026-10-20"
      options={OPTIONS as never}
      returnTo={returnTo}
      variant={variant}
    />,
  );
}

describe("T27 composer variant of the activity form", () => {
  it("renders only the note, the date, save and a link to the full form", () => {
    const html = form("sheet");
    expect(html).toContain('id="quick-log-note"');
    expect(html).toContain('name="occurred_on"');
    expect(html).toContain('value="2026-10-20"');
    expect(html).toContain('<input type="hidden" name="capture_mode" value="note"/>');
    expect(html).toContain('name="operation_key"');
    expect(html).toContain(">Save activity</button>");
    expect(html).not.toContain("activity-mode-fieldset");
    expect(html).not.toContain('name="project_id"');
    expect(html).not.toContain('name="experience_id"');
    expect(html).not.toContain("activity-details-disclosure");
    expect(html).not.toMatch(/>Cancel</);
  });

  it("links to the full form with the page the user came from", () => {
    expect(form("sheet", "/projects/abc")).toContain('href="/activity/new?returnTo=%2Fprojects%2Fabc"');
    expect(form("sheet")).toContain(">Open full form</a>");
  });

  it("shares the quick log form and field ids, so both use the same tab draft", () => {
    for (const html of [form("sheet"), form()]) {
      expect(html).toContain('id="quick-log-note-form"');
      expect(html).toContain('id="quick-log-note"');
    }
  });

  it("keeps the full form unchanged by default", () => {
    const html = form();
    expect(html).toBe(form("full"));
    expect(html).toContain("activity-mode-fieldset");
    expect(html).toContain('name="project_id"');
    expect(html).toContain("Riset Pelanggan");
    expect(html).toMatch(/<a class="button-secondary" href="\/dashboard">Cancel<\/a>/);
    expect(html).not.toContain("Open full form");
  });
});

describe("T27 shared draft", () => {
  it("keeps full-form fields the composer does not show when it saves its own", () => {
    const existing = { raw_text: "old", occurred_on: "2026-10-01", project_id: "p1", role: "Lead" };
    expect(mergeDraftValues(JSON.stringify(existing), { raw_text: "new", occurred_on: "2026-10-20" }))
      .toEqual({ raw_text: "new", occurred_on: "2026-10-20", project_id: "p1", role: "Lead" });
  });

  it("starts fresh from a missing or malformed draft", () => {
    expect(mergeDraftValues(null, { raw_text: "a" })).toEqual({ raw_text: "a" });
    expect(mergeDraftValues("not json", { raw_text: "a" })).toEqual({ raw_text: "a" });
    expect(mergeDraftValues("[1]", { raw_text: "a" })).toEqual({ raw_text: "a" });
  });
});

describe("T27 sheets", () => {
  const sheetProps = { locale: "en" as const, ownerId: OWNER, timezone: "Asia/Jakarta", returnTo: "/dashboard" };

  it("mounts the composer only while the sheet is open", () => {
    const closed = renderToStaticMarkup(<QuickLogSheet {...sheetProps} open={false} onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(closed).toContain('class="ui-dialog workspace-sheet-dialog"');
    expect(closed).not.toContain("quick-log-note");
    const open = renderToStaticMarkup(<QuickLogSheet {...sheetProps} open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(open).toContain(">Quick log</h2>");
    expect(open).toMatch(/<button aria-label="Close quick log" type="button" class="ui-icon-button workspace-sheet-close">/);
    expect(open).toContain('id="quick-log-note"');
  });

  it("lists Achievements, Timeline and CV, the theme and sign out, without repeating Profile", () => {
    const html = renderToStaticMarkup(
      <MoreMenuSheet locale="en" ownerId={OWNER} initialTheme="light" pathname="/settings/profile" open onOpenChange={vi.fn()} />,
    );
    expect(html).toContain(">More</h2>");
    expect(html).toContain('aria-label="Close more menu"');
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(([, href]) => href);
    expect(hrefs).toEqual(["/achievements", "/timeline", "/cv"]);
    expect(html).toContain("Switch to dark theme");
    expect(html).toContain(">Sign out</button>");
    expect(html).not.toContain("Profile and settings");
  });

  it("has Indonesian copy for both sheets", () => {
    const more = renderToStaticMarkup(
      <MoreMenuSheet locale="id" ownerId={OWNER} initialTheme="light" pathname="/settings/profile" open onOpenChange={vi.fn()} />,
    );
    expect(more).toContain(">Menu lainnya</h2>");
    expect(more).toContain('aria-label="Tutup menu lainnya"');
    const quick = renderToStaticMarkup(
      <QuickLogSheet {...sheetProps} locale="id" open onOpenChange={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(quick).toContain(">Catatan cepat</h2>");
    expect(quick).toContain('aria-label="Tutup catatan cepat"');
    expect(quick).toContain(">Detail lengkap</a>");
  });
});
