import { afterEach, describe, expect, it } from "vitest";

import { getSupabaseAdminConfig } from "@/server/supabase/config";

const originalUrl = process.env.SUPABASE_URL;
const originalSecretKey = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalSecretKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSecretKey;
});

describe("Supabase admin configuration", () => {
  it("requires a server URL and a server-only secret key", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SECRET_KEY;
    expect(getSupabaseAdminConfig()).toBeNull();

    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    expect(getSupabaseAdminConfig()).toBeNull();
  });

  it("accepts a plain HTTP local Supabase URL without exposing configuration on error", () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";

    expect(getSupabaseAdminConfig()).toEqual({
      url: "http://127.0.0.1:54321",
      secretKey: "sb_secret_test",
    });
  });

  it.each([
    "not-a-url",
    "javascript:alert(1)",
    "https://user:password@example.supabase.co",
    "https://example.supabase.co/path",
    "https://example.supabase.co?token=secret",
    "https://example.supabase.co#token",
  ])("rejects invalid server URL %s", (url) => {
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    expect(getSupabaseAdminConfig()).toBeNull();
  });
});
