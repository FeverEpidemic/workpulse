import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SignInClient } from "@/features/auth/sign-in-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/sign-in" }));
vi.mock("@/server/auth/actions", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  requestRecoveryAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
}));

function render(initialMode?: "sign-in" | "create-account", locale: "en" | "id" = "en") {
  return renderToStaticMarkup(<SignInClient locale={locale} returnTo="/dashboard" configured initialMode={initialMode} />);
}

describe("T32 sign-in initial mode", () => {
  it("opens the create-account form straight away", () => {
    const html = render("create-account");
    expect(html).toContain('id="sign-up-form"');
    expect(html).toContain('id="sign-up-email"');
    expect(html).not.toContain('id="sign-in-form"');
    expect(html).toMatch(/<h2 id="auth-heading"[^>]*>Create account<\/h2>/);
  });

  it("keeps the sign-in form as the default", () => {
    for (const html of [render(), render("sign-in")]) {
      expect(html).toContain('id="sign-in-form"');
      expect(html).not.toContain('id="sign-up-form"');
    }
  });

  it("links the terms and privacy policy under the create-account form, without a checkbox", () => {
    const html = render("create-account");
    const form = html.slice(html.indexOf('id="sign-up-form"'), html.indexOf("</form>", html.indexOf('id="sign-up-form"')));
    expect(form).toMatch(/By creating an account, you agree to the <a[^>]*href="\/terms"[^>]*>Terms of Service<\/a> and <a[^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>\./);
    expect(form).not.toContain('type="checkbox"');
  });

  it("has the Indonesian note", () => {
    const html = render("create-account", "id");
    expect(html).toMatch(/Dengan membuat akun, kamu setuju dengan <a[^>]*href="\/terms"[^>]*>Syarat Layanan<\/a> dan <a[^>]*href="\/privacy"[^>]*>Kebijakan Privasi<\/a>\./);
  });

  it("does not show the note on the sign-in form", () => {
    expect(render()).not.toContain('href="/terms"');
  });
});
