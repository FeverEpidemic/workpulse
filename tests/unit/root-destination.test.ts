import { describe, expect, it } from "vitest";

import { signInModeFromQuery } from "@/domain/auth/route-state";
import { rootDestination } from "@/domain/routes/root-destination";

const USER = { id: "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" };

describe("T32 root destination", () => {
  it("shows the landing page to a guest", () => {
    expect(rootDestination({ user: null, profile: null })).toEqual({ kind: "landing" });
  });

  it("sends an onboarded account to the dashboard", () => {
    expect(rootDestination({ user: USER, profile: { onboarding_completed_at: "2026-10-01T00:00:00Z" } })).toEqual({ kind: "redirect", to: "/dashboard" });
  });

  it("sends a provisional account to import onboarding", () => {
    expect(rootDestination({ user: USER, profile: { onboarding_completed_at: null } })).toEqual({ kind: "redirect", to: "/onboarding/import" });
  });

  it("keeps the service notice for a session without a profile", () => {
    expect(rootDestination({ user: USER, profile: null })).toEqual({ kind: "redirect", to: "/sign-in?notice=serviceUnavailable" });
  });
});

describe("T32 sign-in mode from the query", () => {
  it("opens the create-account form only for mode=create-account", () => {
    expect(signInModeFromQuery("create-account")).toBe("create-account");
  });

  it.each([undefined, "", "sign-in", "recovery", "CREATE-ACCOUNT", ["create-account"]])("falls back to sign-in for %j", (value) => {
    expect(signInModeFromQuery(value)).toBe("sign-in");
  });
});
