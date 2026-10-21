import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProfileRow } from "@/domain/database-types";
import { DeleteAccountCard } from "@/features/account/delete-account-card";
import { deletionReauthView } from "@/features/account/delete-account-state";
import { SignInClient } from "@/features/auth/sign-in-client";
import { OnboardingForm } from "@/features/profile/onboarding-form";
import { actionFailure, IDLE_ACTION_STATE } from "@/server/action-result";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/settings/profile" }));
vi.mock("@/server/auth/actions", () => ({
  signInAction: vi.fn(),
  signUpAction: vi.fn(),
  requestRecoveryAction: vi.fn(),
  signInWithGoogleAction: vi.fn(),
  startGoogleReauthAction: vi.fn(),
}));
vi.mock("@/features/account/actions", () => ({ deleteAccountAction: vi.fn(), getAccountDeletionPreviewAction: vi.fn() }));
vi.mock("@/features/profile/actions", () => ({ completeOnboardingAction: vi.fn() }));

const EMAIL = "rina@example.com";

function signIn(googleEnabled: boolean, locale: "en" | "id" = "en") {
  return renderToStaticMarkup(<SignInClient locale={locale} returnTo="/projects" configured googleEnabled={googleEnabled} />);
}

describe("T29 S01 Google button", () => {
  it("is absent while the flag is off", () => {
    const html = signIn(false);
    expect(html).not.toContain("Continue with Google");
    expect(html).not.toContain('id="google-sign-in-form"');
  });

  it("is a real form with the return path, above the email form, when the flag is on", () => {
    const html = signIn(true);
    expect(html).toContain('id="google-sign-in-form"');
    expect(html).toMatch(/<form id="google-sign-in-form"[^>]*>.*name="returnTo" value="\/projects".*Continue with Google.*<\/form>/s);
    expect(html.indexOf("google-sign-in-form")).toBeLessThan(html.indexOf('id="sign-in-form"'));
    expect(html).toContain("or use your email");
  });

  it("uses the secondary button so email sign-in keeps the one primary action", () => {
    const html = signIn(true);
    const google = html.slice(html.indexOf('id="google-sign-in-form"'), html.indexOf("</form>", html.indexOf('id="google-sign-in-form"')));
    expect(google).toContain("button-secondary");
    expect(google).not.toContain("button-primary");
  });

  it("has Indonesian copy", () => {
    const html = signIn(true, "id");
    expect(html).toContain("Lanjutkan dengan Google");
    expect(html).toContain("atau pakai email");
  });
});

const PROFILE = {
  id: "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f",
  display_name: "Pending onboarding",
  locale: "en",
  timezone: "UTC",
  revision: 1,
} as unknown as ProfileRow;

describe("T29 onboarding name from Google", () => {
  it("prefills the display name and says where it came from", () => {
    const html = renderToStaticMarkup(<OnboardingForm profile={PROFILE} locale="en" initialDisplayName="Rina Hartono" />);
    expect(html).toMatch(/id="onboarding-display-name"[^>]*value="Rina Hartono"/);
    expect(html).toContain("Filled in from your Google account. You can change it.");
    expect(html).toMatch(/aria-describedby="[^"]*onboarding-display-name-source/);
  });

  it("keeps the empty field and no note without a Google name", () => {
    const html = renderToStaticMarkup(<OnboardingForm profile={PROFILE} locale="en" />);
    expect(html).toMatch(/id="onboarding-display-name"[^>]*value=""/);
    expect(html).not.toContain("Google");
  });
});

describe("T29 delete account reauthentication view", () => {
  const reauthRequired = actionFailure("VALIDATION", "account.delete.error.reauthRequired");

  it("keeps the password path for a password account", () => {
    expect(deletionReauthView({ method: "password" }, IDLE_ACTION_STATE)).toEqual({ password: true, googleButton: false, finish: true });
  });

  it("asks a Google-only account to confirm with Google first", () => {
    expect(deletionReauthView({ method: "google", fresh: false }, IDLE_ACTION_STATE)).toEqual({ password: false, googleButton: true, finish: false });
  });

  it("lets a freshly confirmed Google account finish with the email", () => {
    expect(deletionReauthView({ method: "google", fresh: true }, IDLE_ACTION_STATE)).toEqual({ password: false, googleButton: false, finish: true });
  });

  it("goes back to the Google button when the server says the confirmation expired", () => {
    expect(deletionReauthView({ method: "google", fresh: true }, reauthRequired)).toEqual({ password: false, googleButton: true, finish: false });
  });
});

describe("T29 S12 delete dialog for a Google-only account", () => {
  function card(reauth: Parameters<typeof deletionReauthView>[0]) {
    return renderToStaticMarkup(<DeleteAccountCard accountEmail={EMAIL} locale="en" reauth={reauth} />);
  }

  it("shows no password field and offers Confirm with Google before the email step", () => {
    const html = card({ method: "google", fresh: false });
    expect(html).not.toContain('id="delete-account-password"');
    expect(html).toContain("Confirm with Google");
    expect(html).toContain('id="delete-account-google-form"');
    expect(html).not.toContain('id="delete-account-confirmation"');
    expect(html).not.toContain("Delete account permanently");
  });

  it("after a fresh confirmation, asks for the email and submits the Google method", () => {
    const html = card({ method: "google", fresh: true });
    expect(html).not.toContain('id="delete-account-password"');
    expect(html).toContain('id="delete-account-confirmation"');
    expect(html).toMatch(/<input type="hidden" name="method" value="google"\/>/);
    expect(html).toContain("Google confirmed it is you.");
    expect(html).toContain("Delete account permanently");
    expect(html).not.toContain('id="delete-account-google-form"');
  });

  it("keeps the password dialog unchanged for a password account", () => {
    const html = card({ method: "password" });
    expect(html).toContain('id="delete-account-password"');
    expect(html).not.toContain("Google");
  });
});
