import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_RETURN_TO } from "@/domain/routes/safe-return";
import {
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_RETURN_COOKIE,
  REAUTH_INTENT_COOKIE,
  googleDisplayNameSuggestion,
  hasRecentOAuthProof,
  oauthCookieOptions,
  readOAuthReturn,
  readReauthIntent,
  reauthIntentValue,
} from "@/server/auth/oauth-session";
import { isGoogleAuthEnabled } from "@/server/supabase/config";

describe("fresh Google sign-in proof", () => {
  const now = 1_800_000_000;

  it("accepts an OAuth sign-in from the last five minutes", () => {
    expect(hasRecentOAuthProof([{ method: "oauth", timestamp: now - 300 }], now)).toBe(true);
    expect(hasRecentOAuthProof([{ method: "password", timestamp: now - 900 }, { method: "oauth", timestamp: now - 5 }], now)).toBe(true);
  });

  it("rejects an older OAuth sign-in, other methods, and malformed claims", () => {
    expect(hasRecentOAuthProof([{ method: "oauth", timestamp: now - 301 }], now)).toBe(false);
    expect(hasRecentOAuthProof([{ method: "oauth", timestamp: now + 61 }], now)).toBe(false);
    expect(hasRecentOAuthProof([{ method: "password", timestamp: now }], now)).toBe(false);
    expect(hasRecentOAuthProof([{ method: "otp", timestamp: now }], now)).toBe(false);
    expect(hasRecentOAuthProof(["oauth"], now)).toBe(false);
    expect(hasRecentOAuthProof([{ method: "oauth", timestamp: "now" }], now)).toBe(false);
    expect(hasRecentOAuthProof(null, now)).toBe(false);
  });

  it("tolerates up to a minute of clock skew", () => {
    expect(hasRecentOAuthProof([{ method: "oauth", timestamp: now + 60 }], now)).toBe(true);
  });
});

describe("Google display name suggestion", () => {
  it("prefers full_name and falls back to name", () => {
    expect(googleDisplayNameSuggestion({ full_name: "  Rina Hartono ", name: "Rina" }, 80)).toBe("Rina Hartono");
    expect(googleDisplayNameSuggestion({ full_name: "   ", name: "Rina" }, 80)).toBe("Rina");
    expect(googleDisplayNameSuggestion({ name: "Budi" }, 80)).toBe("Budi");
  });

  it("returns null for missing, blank, or non-string values", () => {
    expect(googleDisplayNameSuggestion({}, 80)).toBeNull();
    expect(googleDisplayNameSuggestion({ full_name: "  " }, 80)).toBeNull();
    expect(googleDisplayNameSuggestion({ full_name: 42, name: ["x"] }, 80)).toBeNull();
    expect(googleDisplayNameSuggestion(null, 80)).toBeNull();
    expect(googleDisplayNameSuggestion("Rina", 80)).toBeNull();
  });

  it("collapses inner whitespace and trims to the field limit without splitting characters", () => {
    expect(googleDisplayNameSuggestion({ full_name: "Rina \n\t Hartono" }, 80)).toBe("Rina Hartono");
    expect(googleDisplayNameSuggestion({ full_name: "a".repeat(90) }, 80)).toBe("a".repeat(80));
    const emoji = "\u{1F600}";
    expect(googleDisplayNameSuggestion({ full_name: emoji.repeat(3) }, 2)).toBe(emoji.repeat(2));
    expect(googleDisplayNameSuggestion({ full_name: `${"a".repeat(79)}  b` }, 80)).toBe("a".repeat(79));
  });
});

describe("OAuth flow cookies", () => {
  it("uses short-lived HttpOnly Lax cookies that are Secure in production", () => {
    expect(OAUTH_RETURN_COOKIE).toBe("wp-oauth-return");
    expect(REAUTH_INTENT_COOKIE).toBe("wp-reauth");
    expect(OAUTH_COOKIE_MAX_AGE_SECONDS).toBe(600);
    expect(oauthCookieOptions(false)).toEqual({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 600 });
    expect(oauthCookieOptions(true).secure).toBe(true);
  });

  it("sanitizes the stored return path again when it is read", () => {
    expect(readOAuthReturn("/projects")).toBe("/projects");
    expect(readOAuthReturn("https://evil.example/dashboard")).toBe(DEFAULT_RETURN_TO);
    expect(readOAuthReturn("//evil.example")).toBe(DEFAULT_RETURN_TO);
    expect(readOAuthReturn("/auth/confirm")).toBe(DEFAULT_RETURN_TO);
    expect(readOAuthReturn(undefined)).toBe(DEFAULT_RETURN_TO);
  });

  it("binds the delete-account intent to the user who started it", () => {
    const user = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
    const other = "9a9c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
    expect(reauthIntentValue(user)).toBe(`delete-account.${user}`);
    expect(readReauthIntent(reauthIntentValue(user), user)).toBe("delete-account");
    expect(readReauthIntent(reauthIntentValue(user), other)).toBeNull();
    expect(readReauthIntent("delete-account", user)).toBeNull();
    expect(readReauthIntent(`change-email.${user}`, user)).toBeNull();
    expect(readReauthIntent(undefined, user)).toBeNull();
  });
});

describe("Google sign-in feature flag", () => {
  const original = process.env.WORKPULSE_AUTH_GOOGLE_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.WORKPULSE_AUTH_GOOGLE_ENABLED;
    else process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = original;
  });

  it("is off unless the value is exactly true", () => {
    delete process.env.WORKPULSE_AUTH_GOOGLE_ENABLED;
    expect(isGoogleAuthEnabled()).toBe(false);
    for (const value of ["", "false", "1", "yes", "TRUE", " true "]) {
      process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = value;
      expect(isGoogleAuthEnabled()).toBe(false);
    }
    process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = "true";
    expect(isGoogleAuthEnabled()).toBe(true);
  });
});
