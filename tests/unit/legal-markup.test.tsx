import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LegalPage } from "@/features/legal/legal-page";
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
