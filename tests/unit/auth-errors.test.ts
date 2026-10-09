import { describe, expect, it } from "vitest";

import { mapSupabaseAuthError } from "@/server/auth/errors";

describe("safe Supabase auth error mapping", () => {
  it("maps credentials and rate limits without exposing provider messages", () => {
    expect(mapSupabaseAuthError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toEqual({
      code: "UNAUTHENTICATED",
      messageKey: "auth.invalidCredentials",
    });
    expect(mapSupabaseAuthError({ status: 429, message: "too many requests" })).toEqual({
      code: "RATE_LIMITED",
      messageKey: "auth.rateLimited",
    });
  });

  it("shows a banned account, which Auth reports before checking the password, as a credentials error", () => {
    expect(mapSupabaseAuthError({ status: 400, code: "user_banned", message: "User is banned" })).toEqual({
      code: "UNAUTHENTICATED",
      messageKey: "auth.invalidCredentials",
    });
  });

  it("does not pass through arbitrary provider error text", () => {
    const mapped = mapSupabaseAuthError({ status: 503, code: "internal_error", message: "database password=secret" });
    expect(mapped).toEqual({ code: "UNAVAILABLE", messageKey: "error.unavailable" });
    expect(JSON.stringify(mapped)).not.toContain("secret");
  });
});
