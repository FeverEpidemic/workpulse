import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const OTHER = "9a9c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const NOW = () => Math.floor(Date.now() / 1000);

const exchangeCodeForSession = vi.fn();
const verifyOtp = vi.fn();
const getUser = vi.fn();
const getClaims = vi.fn();
const signOut = vi.fn();
const profile = vi.fn();
const deleteCookie = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "sb-local-auth-token" }],
    get: () => undefined,
    set: vi.fn(),
    delete: (name: string) => deleteCookie(name),
  }),
}));
vi.mock("@/server/locale/cookie", () => ({ persistLocaleCookie: async () => undefined }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSession(...args),
      verifyOtp: (...args: unknown[]) => verifyOtp(...args),
      getUser: () => getUser(),
      getClaims: () => getClaims(),
      signOut: (...args: unknown[]) => signOut(...args),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => profile() }) }) }),
  }),
}));

import { GET } from "@/app/auth/confirm/route";

function request(query: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("; ");
  return new NextRequest(`http://127.0.0.1:3000/auth/confirm${query}`, cookie ? { headers: { cookie } } : undefined);
}

function location(response: Response): string {
  const value = response.headers.get("location") ?? "";
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function cleared(response: Awaited<ReturnType<typeof GET>>, name: string): boolean {
  const cookie = response.cookies.get(name);
  return cookie !== undefined && cookie.value === "" && cookie.maxAge === 0;
}

function signedIn(amr: unknown[]) {
  getUser.mockResolvedValue({ data: { user: { id: USER, email: "rina@example.com", identities: [{ provider: "google" }] } }, error: null });
  getClaims.mockResolvedValue({ data: { claims: { amr } }, error: null });
}

beforeEach(() => {
  for (const mock of [exchangeCodeForSession, verifyOtp, getUser, getClaims, signOut, profile, deleteCookie]) mock.mockReset();
  process.env.WORKPULSE_SITE_URL = "http://127.0.0.1:3000";
  exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  verifyOtp.mockResolvedValue({ data: {}, error: null });
  signOut.mockResolvedValue({ error: null });
  signedIn([{ method: "oauth", timestamp: NOW() }]);
  profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: "2026-10-01T00:00:00Z", deleting_at: null }, error: null });
});

describe("T29 OAuth callback", () => {
  it("sends a cancelled or failed Google sign-in to a neutral notice without the provider's description", async () => {
    const response = await GET(request("?error=access_denied&error_description=The+user+denied+access", { "wp-oauth-return": "/projects" }));
    expect(location(response)).toBe("/sign-in?notice=oauthFailed");
    expect(response.headers.get("location")).not.toContain("denied");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(cleared(response, "wp-oauth-return")).toBe(true);
    expect(cleared(response, "wp-reauth")).toBe(true);
  });

  it("sends a new Google user with a provisional profile to onboarding", async () => {
    profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: null, deleting_at: null }, error: null });
    const response = await GET(request("?code=abc", { "wp-oauth-return": "/projects" }));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(location(response)).toBe("/onboarding/import");
    expect(cleared(response, "wp-oauth-return")).toBe(true);
  });

  it("sends a returning Google user to the stored return path, sanitized again", async () => {
    await expect(GET(request("?code=abc", { "wp-oauth-return": "/projects" })).then(location)).resolves.toBe("/projects");
    await expect(GET(request("?code=abc", { "wp-oauth-return": "https://evil.example/x" })).then(location)).resolves.toBe("/dashboard");
    await expect(GET(request("?code=abc")).then(location)).resolves.toBe("/dashboard");
  });

  it("keeps no credential or provider data in the final URL", async () => {
    const response = await GET(request("?code=abc&state=xyz", { "wp-oauth-return": "/projects" }));
    const target = response.headers.get("location") ?? "";
    for (const fragment of ["code=", "state=", "error", "token"]) expect(target).not.toContain(fragment);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses an account that is being deleted, signs it out and clears the Auth cookies", async () => {
    profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: "2026-10-01T00:00:00Z", deleting_at: "2026-10-20T00:00:00Z" }, error: null });
    const response = await GET(request("?code=abc", { "wp-oauth-return": "/projects" }));
    expect(location(response)).toBe("/sign-in?notice=accountDeleting");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(deleteCookie).toHaveBeenCalledWith("sb-local-auth-token");
  });

  it("opens the delete dialog only for the user who asked to reauthenticate", async () => {
    const own = await GET(request("?code=abc", { "wp-reauth": `delete-account.${USER}` }));
    expect(location(own)).toBe("/settings/profile?reauth=delete-account");
    expect(cleared(own, "wp-reauth")).toBe(true);

    const other = await GET(request("?code=abc", { "wp-reauth": `delete-account.${OTHER}` }));
    expect(location(other)).toBe("/dashboard");
  });

  it("does not open the delete dialog for a provisional profile", async () => {
    profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: null, deleting_at: null }, error: null });
    const response = await GET(request("?code=abc", { "wp-reauth": `delete-account.${USER}` }));
    expect(location(response)).toBe("/onboarding/import");
  });
});

describe("T29 callback keeps the email and recovery paths", () => {
  it("still verifies a signup token hash and ignores the OAuth cookies' return path", async () => {
    signedIn([{ method: "otp", timestamp: NOW() }]);
    const response = await GET(request("?token_hash=hash&type=signup&next=/activity", { "wp-oauth-return": "/projects" }));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "hash", type: "signup" });
    expect(location(response)).toBe("/activity");
  });

  it("still routes a recovery callback to the password form", async () => {
    signedIn([{ method: "otp", timestamp: NOW() }]);
    const response = await GET(request("?token_hash=hash&type=recovery"));
    expect(location(response)).toBe("/update-password");
  });

  it("treats a PKCE code with a recovery claim as recovery, not as Google sign-in", async () => {
    signedIn([{ method: "recovery", timestamp: NOW() }, { method: "oauth", timestamp: NOW() - 3600 }]);
    const response = await GET(request("?code=abc", { "wp-reauth": `delete-account.${USER}` }));
    expect(location(response)).toBe("/update-password");
  });

  it("does not check deleting_at on an email confirmation, as before", async () => {
    signedIn([{ method: "otp", timestamp: NOW() }]);
    profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: "2026-10-01T00:00:00Z", deleting_at: "2026-10-20T00:00:00Z" }, error: null });
    const response = await GET(request("?token_hash=hash&type=email"));
    expect(location(response)).toBe("/dashboard");
    expect(signOut).not.toHaveBeenCalled();
  });

  it("still reports a failed exchange as verificationFailed", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: { message: "bad code" } });
    await expect(GET(request("?code=abc")).then(location)).resolves.toBe("/sign-in?notice=verificationFailed");
  });
});

describe("RV1 older OAuth callback claims", () => {
  it("still rejects a deleting account with oauth 400 seconds old", async () => {
    signedIn([{ method: "oauth", timestamp: NOW() - 400 }]);
    profile.mockResolvedValue({ data: { locale: "en", onboarding_completed_at: "2026-10-01T00:00:00Z", deleting_at: "2026-10-20T00:00:00Z" }, error: null });
    const response = await GET(request("?code=abc"));
    expect(location(response)).toBe("/sign-in?notice=accountDeleting");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("still reads the return cookie with oauth 400 seconds old", async () => {
    signedIn([{ method: "oauth", timestamp: NOW() - 400 }]);
    const response = await GET(request("?code=abc", { "wp-oauth-return": "/projects" }));
    expect(location(response)).toBe("/projects");
  });
});
