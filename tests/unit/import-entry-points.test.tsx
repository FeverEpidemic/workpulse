import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("server-only", () => ({}));

import type { DashboardData } from "@/domain/dashboard/contracts";
import type { ProfileRow } from "@/domain/database-types";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { ProfileWorkspace } from "@/features/profile/profile-workspace";

const emptyDashboard = { summary: { hasCareerRecords: false } } as unknown as DashboardData;

function fakeClient() {
  const chain: Record<string, unknown> = {
    select: () => chain, eq: () => chain, order: () => chain, not: () => chain,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }),
  };
  return { from: () => chain };
}

const profile = {
  id: "b3604674-f6d4-4382-a253-ec8af2560a86", display_name: "Rina", locale: "en", timezone: "Asia/Jakarta", revision: 1,
  headline: null, summary: null, contact_email: null, phone: null, location: null, website: null,
  ai_consent_at: null, ai_consent_version: null, onboarding_completed_at: "2026-09-01T00:00:00Z",
} as unknown as ProfileRow;

describe("T17 import entry points", () => {
  it("links Import CV from the empty dashboard, in English and Indonesian, with no disabled placeholder", () => {
    const en = renderToStaticMarkup(<DashboardView data={emptyDashboard} displayName="Rina" locale="en" />);
    expect(en).toMatch(/<a class="button-secondary" href="\/onboarding\/import">Import CV<\/a>/);
    expect(en).not.toContain("not available yet");
    expect(en).not.toContain("dashboard-import-unavailable");
    const id = renderToStaticMarkup(<DashboardView data={emptyDashboard} displayName="Rina" locale="id" />);
    expect(id).toMatch(/<a class="button-secondary" href="\/onboarding\/import">Impor CV<\/a>/);
  });

  it("offers an Import CV card in S12 that opens S02", async () => {
    const element = await ProfileWorkspace({ client: fakeClient() as never, profile, userEmail: "rina@example.test", locale: "en" });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Import from a CV");
    expect(html).toMatch(/<a class="button-secondary inline-flex" href="\/onboarding\/import">Import CV<\/a>/);
    const id = renderToStaticMarkup(await ProfileWorkspace({ client: fakeClient() as never, profile, userEmail: "rina@example.test", locale: "id" }));
    expect(id).toContain("Impor dari CV");
  });
});
