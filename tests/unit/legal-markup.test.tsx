import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LegalPage, legalPageSignedIn } from "@/features/legal/legal-page";
import { legalMetadata } from "@/features/legal/documents";

vi.mock("@/server/locale/actions", () => ({ saveLocalePreference: vi.fn() }));

function render(kind: "privacy" | "terms", locale: "en" | "id" = "en") {
  return renderToStaticMarkup(<LegalPage kind={kind} locale={locale} />);
}

describe("T32 legal page markup", () => {
  it.each([
    ["privacy", "en", "Privacy Policy"],
    ["terms", "en", "Terms of Service"],
    ["privacy", "id", "Kebijakan Privasi"],
    ["terms", "id", "Syarat Layanan"],
  ] as const)("renders %s in %s with one h1 and twelve numbered h2s", (kind, locale, title) => {
    const html = render(kind, locale);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain(`>${title}</h1>`);
    const headings = [...html.matchAll(/<h2 id="section-(\d+)"[^>]*>(\d+)\./g)].map((match) => [Number(match[1]), Number(match[2])]);
    expect(headings).toEqual(Array.from({ length: 12 }, (_, index) => [index + 1, index + 1]));
    expect(html).not.toMatch(/<h[3-6][\s>]/);
  });

  it("shows the draft notice and highlights every blank", () => {
    const html = render("privacy");
    expect(html).toMatch(/<div[^>]*role="note"[^>]*>.*Draft, not yet in effect\./s);
    expect(html).toContain("<mark");
    expect(html).toMatch(/<mark[^>]*>\[CITY\]<\/mark>/);
    expect(html).toMatch(/Effective from <mark[^>]*>\[EFFECTIVE DATE\]<\/mark>/);
  });

  it("lists every section in the page contents", () => {
    const html = render("terms", "id");
    expect(html).toMatch(/<nav[^>]*aria-label="Di halaman ini"/);
    for (let index = 1; index <= 12; index++) expect(html).toContain(`href="#section-${index}"`);
  });

  it("renders the retention table with column headers", () => {
    const html = render("privacy");
    expect(html).toContain("<table");
    expect(html.match(/<th scope="col"/g)).toHaveLength(2);
    expect(html).toContain("<caption");
  });

  it("links the contact address and the other legal page", () => {
    expect(render("privacy")).toContain('href="mailto:halo@myworkpulse.my.id"');
    expect(render("terms")).toMatch(/<a[^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/);
  });

  it("marks the current page in the footer and keeps the landing header", () => {
    const html = render("terms");
    const footer = html.slice(html.indexOf("<footer"));
    expect(footer).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/terms"|<a[^>]*href="\/terms"[^>]*aria-current="page"/);
    expect(html).toContain('href="/sign-in?mode=create-account"');
    expect(html).toContain('href="#main-content"');
  });
});

describe("T32 RV1 legal header for a signed-in account", () => {
  it.each(["en", "id"] as const)("offers the dashboard instead of the language toggle and sign-in links in %s", (locale) => {
    const html = renderToStaticMarkup(<LegalPage kind="privacy" locale={locale} signedIn />);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toMatch(new RegExp(`<a[^>]*href="/dashboard"[^>]*>${locale === "en" ? "Open dashboard" : "Buka dashboard"}</a>`));
    expect(header).not.toContain('name="locale"');
    expect(header).not.toContain('href="/sign-in');
  });

  it("treats only an onboarded account as signed in; a provisional one keeps the working toggle", () => {
    const user = { id: "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" };
    expect(legalPageSignedIn({ user, profile: { onboarding_completed_at: "2026-10-01T00:00:00Z" } })).toBe(true);
    expect(legalPageSignedIn({ user, profile: { onboarding_completed_at: null } })).toBe(false);
    expect(legalPageSignedIn({ user, profile: null })).toBe(false);
    expect(legalPageSignedIn({ user: null, profile: null })).toBe(false);
  });

  it("keeps the guest header unchanged", () => {
    const header = render("privacy").slice(0, render("privacy").indexOf("</header>"));
    expect(header.match(/name="locale"/g)).toHaveLength(2);
    expect(header).toContain('href="/sign-in"');
    expect(header).toContain('href="/sign-in?mode=create-account"');
    expect(header).not.toContain('href="/dashboard"');
  });
});

describe("T32 legal metadata", () => {
  it.each(["privacy", "terms"] as const)("keeps %s out of search engines while it is a draft", (kind) => {
    for (const locale of ["en", "id"] as const) {
      const metadata = legalMetadata(kind, locale);
      expect(metadata.robots).toEqual({ index: false, follow: true });
      expect(metadata.title).toBeTruthy();
      expect(metadata.description).toBeTruthy();
    }
  });
});
