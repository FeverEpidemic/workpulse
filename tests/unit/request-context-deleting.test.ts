import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = { id: "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f", email: "ani@example.com" };
const getUser = vi.fn();
let profileRow: Record<string, unknown> | null = null;

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/server/supabase/config", () => ({ getSupabasePublicConfig: () => ({ url: "http://127.0.0.1:54321", publishableKey: "sb_publishable_test" }) }));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: () => getUser() },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRow, error: null }) }) }) }),
  }),
}));

import { getRequestContext } from "@/server/auth/context";

describe("T23 request context for a deleting account", () => {
  beforeEach(() => {
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
  });

  it("treats a deleting profile as signed out and says why", async () => {
    profileRow = { id: USER.id, deleting_at: "2026-10-09T00:00:00Z", onboarding_completed_at: "2026-09-01T00:00:00Z" };
    const context = await getRequestContext();
    expect(context.user).toBeNull();
    expect(context.profile).toBeNull();
    expect(context.accountDeleting).toBe(true);
    expect(context.profileUnavailable).toBe(false);
  });

  it("keeps an active profile signed in", async () => {
    profileRow = { id: USER.id, deleting_at: null, onboarding_completed_at: "2026-09-01T00:00:00Z" };
    const context = await getRequestContext();
    expect(context.user).toEqual(USER);
    expect(context.profile).toMatchObject({ id: USER.id });
    expect(context.accountDeleting).toBe(false);
  });

  it("is not deleting when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing!" } });
    const context = await getRequestContext();
    expect(context.user).toBeNull();
    expect(context.accountDeleting).toBe(false);
  });
});
