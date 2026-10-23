import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAuthAdapter } from "@/server/auth/adapter";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const SUPABASE = "http://127.0.0.1:54321";
const AUTHORIZE = `${SUPABASE}/auth/v1/authorize?provider=google&code_challenge=abc&code_challenge_method=s256`;
const IDLE = { status: "idle" } as const;

const signInWithOAuth = vi.fn();
const getUser = vi.fn();
const setCookie = vi.fn();
const deleteCookie = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    get: () => undefined,
    set: (...args: unknown[]) => setCookie(...args),
    delete: (name: string) => deleteCookie(name),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
      getUser: () => getUser(),
    },
  }),
}));

import { signInWithGoogleAction, startGoogleReauthAction } from "@/server/auth/actions";

const saved = {
  flag: process.env.WORKPULSE_AUTH_GOOGLE_ENABLED,
  publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serverUrl: process.env.SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  site: process.env.WORKPULSE_SITE_URL,
};

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

async function redirectOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    return typeof digest === "string" ? digest.split(";")[2] ?? null : null;
  }
  return null;
}

function googleUser(providers: string[]) {
  return {
    data: {
      user: {
        id: USER,
        email: "rina@example.com",
        identities: providers.map((provider) => ({ provider })),
        app_metadata: { provider: providers[0], providers },
        user_metadata: { full_name: "Rina Hartono" },
      },
    },
    error: null,
  };
}

beforeEach(() => {
  for (const mock of [signInWithOAuth, getUser, setCookie, deleteCookie]) mock.mockReset();
  process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = "true";
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  process.env.SUPABASE_URL = SUPABASE;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  process.env.WORKPULSE_SITE_URL = "http://127.0.0.1:3000";
  signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: AUTHORIZE }, error: null });
  getUser.mockResolvedValue(googleUser(["google"]));
});

afterAll(() => {
  restore("WORKPULSE_AUTH_GOOGLE_ENABLED", saved.flag);
  restore("NEXT_PUBLIC_SUPABASE_URL", saved.publicUrl);
  restore("SUPABASE_URL", saved.serverUrl);
  restore("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", saved.key);
  restore("WORKPULSE_SITE_URL", saved.site);
});

describe("T29 Google sign-in action", () => {
  it("is unavailable while the flag is off and never calls Auth", async () => {
    process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = "false";
    const state = await signInWithGoogleAction(IDLE, form({ returnTo: "/projects" }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE", messageKey: "error.unavailable" } });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("starts PKCE with the exact callback URL and redirects to the Supabase authorize URL", async () => {
    const target = await redirectOf(signInWithGoogleAction(IDLE, form({ returnTo: "/projects" })));
    expect(target).toBe(AUTHORIZE);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://127.0.0.1:3000/auth/confirm", skipBrowserRedirect: true },
    });
  });

  it("stores the sanitized return path in a short-lived HttpOnly cookie and clears a stale reauth intent", async () => {
    await redirectOf(signInWithGoogleAction(IDLE, form({ returnTo: "/projects" })));
    expect(setCookie).toHaveBeenCalledWith("wp-oauth-return", "/projects", {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 600,
    });
    expect(deleteCookie).toHaveBeenCalledWith("wp-reauth");
  });

  it("replaces an unsafe return path with the safe fallback", async () => {
    await redirectOf(signInWithGoogleAction(IDLE, form({ returnTo: "https://evil.example/x" })));
    expect(setCookie).toHaveBeenCalledWith("wp-oauth-return", "/dashboard", expect.any(Object));
  });

  it("refuses an authorize URL on another origin", async () => {
    for (const url of ["https://evil.example/auth/v1/authorize", "javascript:alert(1)", "/relative", null]) {
      setCookie.mockReset();
      signInWithOAuth.mockResolvedValue({ data: { provider: "google", url }, error: null });
      const state = await signInWithGoogleAction(IDLE, form({ returnTo: "/projects" }));
      expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE" } });
      expect(setCookie).not.toHaveBeenCalled();
    }
  });

  it("fails closed when the server Supabase URL is not the browser one", async () => {
    process.env.SUPABASE_URL = "http://kong:8000";
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "http://kong:8000/auth/v1/authorize?provider=google" }, error: null });
    const state = await signInWithGoogleAction(IDLE, form({ returnTo: "/projects" }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE" } });
  });

  it("maps an Auth error without leaking its message", async () => {
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: null }, error: { status: 429, message: "secret detail" } });
    const state = await signInWithGoogleAction(IDLE, form({ returnTo: "/projects" }));
    expect(state).toMatchObject({ status: "error", error: { code: "RATE_LIMITED", messageKey: "auth.rateLimited" } });
    expect(JSON.stringify(state)).not.toContain("secret detail");
  });
});

describe("T29 Google reauthentication action", () => {
  it("binds the delete intent to the session user, asks Google to choose an account, and redirects", async () => {
    const target = await redirectOf(startGoogleReauthAction(IDLE, form({})));
    expect(target).toBe(AUTHORIZE);
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://127.0.0.1:3000/auth/confirm",
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(setCookie).toHaveBeenCalledWith("wp-reauth", `delete-account.${USER}`, expect.objectContaining({ httpOnly: true, maxAge: 600 }));
    expect(deleteCookie).toHaveBeenCalledWith("wp-oauth-return");
  });

  it("works while the sign-in flag is off, so a Google-only account can still be deleted", async () => {
    process.env.WORKPULSE_AUTH_GOOGLE_ENABLED = "false";
    await expect(redirectOf(startGoogleReauthAction(IDLE, form({})))).resolves.toBe(AUTHORIZE);
  });

  it("requires a session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await startGoogleReauthAction(IDLE, form({}));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED", messageKey: "auth.signInRequired" } });
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });

  it("refuses an account without a Google identity", async () => {
    getUser.mockResolvedValue(googleUser(["email"]));
    const state = await startGoogleReauthAction(IDLE, form({}));
    expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION" } });
    expect(signInWithOAuth).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("refuses an authorize URL on another origin", async () => {
    signInWithOAuth.mockResolvedValue({ data: { provider: "google", url: "https://evil.example/" }, error: null });
    const state = await startGoogleReauthAction(IDLE, form({}));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAVAILABLE" } });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

describe("T29 AuthAdapter user shape", () => {
  function adapterFor(user: unknown) {
    const client = { auth: { getUser: async () => ({ data: { user }, error: null }) } };
    return createAuthAdapter(client as never);
  }

  it("reads providers from identities and the Google display name", async () => {
    const { user } = await adapterFor(googleUser(["email", "google"]).data.user).getUser();
    expect(user).toEqual({ id: USER, email: "rina@example.com", providers: ["email", "google"], fullName: "Rina Hartono" });
  });

  it("falls back to app_metadata.providers and tolerates missing metadata", async () => {
    const { user } = await adapterFor({ id: USER, email: "rina@example.com", app_metadata: { providers: ["google"] } }).getUser();
    expect(user).toEqual({ id: USER, email: "rina@example.com", providers: ["google"], fullName: null });
  });
});
