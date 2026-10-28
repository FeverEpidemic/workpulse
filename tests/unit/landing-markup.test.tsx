import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LandingPage } from "@/features/marketing/landing-page";

vi.mock("@/server/locale/actions", () => ({ saveLocalePreference: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/" }));

function render(locale: "en" | "id" = "en") {
  return renderToStaticMarkup(<LandingPage locale={locale} />);
}

function between(html: string, start: string, end: string) {
  const from = html.indexOf(start);
  return html.slice(from, html.indexOf(end, from));
}

const SIGN_UP = "/sign-in?mode=create-account";

describe("T32 landing markup", () => {
  it("has one h1, the landmarks, and a skip link to the content", () => {
    const html = render();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>You sit down to update your CV and can(&#x27;|')t remember what you did last year\.<\/h1>/);
    expect(html).toMatch(/<a[^>]*class="skip-link"[^>]*href="#main-content"|<a[^>]*href="#main-content"[^>]*class="skip-link"/);
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain("<header");
    expect(html).toContain("<footer");
  });

  it("follows the section order of the brief", () => {
    const html = render();
    const order = ["landing-hero", "landing-how", "landing-import", "landing-data", "landing-maker", "landing-closing"].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf("<header")).toBeLessThan(order[0]!);
    expect(html.indexOf("<footer")).toBeGreaterThan(order[5]!);
  });

  it("points every sign-up CTA at the create-account form and sign-in at /sign-in", () => {
    const html = render();
    const signUpLinks = [...html.matchAll(/href="\/sign-in\?mode=create-account"/g)];
    expect(signUpLinks.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('href="/sign-in"');
  });

  it("only links to public routes and the contact address inside the page", () => {
    const main = between(render(), '<main id="main-content"', "</main>");
    const hrefs = [...main.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!.replaceAll("&amp;", "&"));
    for (const href of hrefs) expect([SIGN_UP, "/sign-in", "mailto:halo@myworkpulse.my.id"], href).toContain(href);
  });

  it("keeps the sample UI free of forms and submit buttons", () => {
    const main = between(render(), '<main id="main-content"', "</main>");
    expect(main).not.toContain("<form");
    expect(main).not.toContain('type="submit"');
    for (const [button] of main.matchAll(/<button[^>]*>/g)) expect(button).toContain('role="tab"');
  });

  it("labels every sample UI piece as an example and makes it inert", () => {
    const html = render();
    const frames = [...html.matchAll(/<div[^>]*data-example="true"[^>]*>/g)].map((match) => match[0]);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    for (const frame of frames) {
      expect(frame).toContain('role="group"');
      expect(frame).toMatch(/aria-label="[^"]{20,}"/);
    }
    expect(html.match(/ inert=""/g)?.length).toBe(frames.length);
    expect(html.match(/>Example</g)?.length).toBeGreaterThanOrEqual(frames.length);
  });

  it("renders app components with the sample data", () => {
    const html = render();
    expect(html).toContain('class="activity-list-row"');
    expect(html).toContain('data-testid="cv-preview-paper"');
    expect(html).toContain("Rani Prameswari");
    expect(html).toContain("PT Contoh Logistik");
  });

  it("server-renders the tablist with all three panels readable", () => {
    const html = render();
    expect(html).toMatch(/role="tablist"[^>]*aria-label="WorkPulse steps"|aria-label="WorkPulse steps"[^>]*role="tablist"/);
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    const panels = [...html.matchAll(/<div[^>]*role="tabpanel"[^>]*>/g)].map((match) => match[0]);
    expect(panels).toHaveLength(3);
    for (const panel of panels) expect(panel).not.toMatch(/ hidden/);
  });

  it("shows the step dots with a text status, separate from the logo", () => {
    const html = render();
    const dots = between(html, 'class="landing-steps"', "</div>");
    expect(dots.match(/class="landing-step-dot"/g)).toHaveLength(5);
    expect(dots).toContain("Step 1 of 5");
    expect(dots).not.toContain("brand-symbol");
  });

  it("names the maker and the contact address, and links the legal pages in the footer", () => {
    const html = render();
    expect(html).toContain("Ilham Aisy Rasyid");
    expect(html).toContain('href="mailto:halo@myworkpulse.my.id"');
    const footer = between(html, "<footer", "</footer>");
    expect(footer).toContain('href="/privacy"');
    expect(footer).toContain('href="/terms"');
    expect(footer).toContain('href="mailto:halo@myworkpulse.my.id"');
  });

  it("offers both languages, named in their own language", () => {
    const html = render("id");
    const buttons = [...html.matchAll(/<button[^>]*name="locale"[^>]*>/g)].map((match) => match[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons.find((button) => button.includes('value="id"'))).toContain('aria-pressed="true"');
    expect(buttons.find((button) => button.includes('value="en"'))).toContain('aria-pressed="false"');
    expect(html).toMatch(/lang="en"[^>]*aria-label="English"|aria-label="English"[^>]*lang="en"/);
    expect(html).toMatch(/lang="id"[^>]*aria-label="Bahasa Indonesia"|aria-label="Bahasa Indonesia"[^>]*lang="id"/);
  });

  it("renders Indonesian copy", () => {
    const html = render("id");
    expect(html).toContain("Mau update CV. Terus lupa setahun kemarin ngerjain apa aja.");
    expect(html).toContain(">Contoh<");
    expect(html).toContain("Daftar pilot gratis");
  });

  it("has no video, FAQ, or testimonial section", () => {
    const html = render().toLowerCase();
    expect(html).not.toContain("<video");
    expect(html).not.toContain("faq");
    expect(html).not.toContain("testimon");
  });
});
