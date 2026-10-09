import { describe, expect, it, vi } from "vitest";

import { verifyAccountPassword, type OneShotAuthClientFactory } from "@/server/auth/reauthenticate";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const PASSWORD = "correct-horse-battery-1A!";
const INPUT = { email: "ani@example.com", password: PASSWORD, expectedUserId: USER };

function factory(signIn: ReturnType<typeof vi.fn>, signOut = vi.fn().mockResolvedValue({ error: null })) {
  const create = vi.fn(() => ({ signInWithPassword: signIn, signOut })) as unknown as OneShotAuthClientFactory;
  return { create, signOut };
}

describe("T23 reauthentication", () => {
  it("accepts the right password for the expected user and discards the throwaway session", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null });
    const { create, signOut } = factory(signIn);
    await expect(verifyAccountPassword(INPUT, create)).resolves.toBe("ok");
    expect(signIn).toHaveBeenCalledWith({ email: "ani@example.com", password: PASSWORD });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("builds a fresh throwaway client for every check", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null });
    const { create } = factory(signIn);
    await verifyAccountPassword(INPUT, create);
    await verifyAccountPassword(INPUT, create);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects a password that signs in as a different user", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: { id: "9f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f" } }, error: null });
    await expect(verifyAccountPassword(INPUT, factory(signIn).create)).resolves.toBe("invalid");
  });

  it("maps invalid credentials and a banned account to invalid", async () => {
    for (const error of [
      { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
      { status: 400, code: "user_banned", message: "User is banned" },
    ]) {
      const signIn = vi.fn().mockResolvedValue({ data: { user: null }, error });
      await expect(verifyAccountPassword(INPUT, factory(signIn).create)).resolves.toBe("invalid");
    }
  });

  it("maps a rate limit to rate_limited", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 429, code: "over_request_rate_limit", message: "Too many requests" } });
    await expect(verifyAccountPassword(INPUT, factory(signIn).create)).resolves.toBe("rate_limited");
  });

  it("maps a network failure, a server error and a missing configuration to unavailable", async () => {
    const thrown = vi.fn().mockRejectedValue(new Error("fetch failed"));
    await expect(verifyAccountPassword(INPUT, factory(thrown).create)).resolves.toBe("unavailable");
    const server = vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 500, code: "unexpected_failure", message: "boom" } });
    await expect(verifyAccountPassword(INPUT, factory(server).create)).resolves.toBe("unavailable");
    await expect(verifyAccountPassword(INPUT, (() => null) as OneShotAuthClientFactory)).resolves.toBe("unavailable");
  });

  it("still returns the result when discarding the throwaway session fails", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: { id: USER } }, error: null });
    const signOut = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(verifyAccountPassword(INPUT, factory(signIn, signOut).create)).resolves.toBe("ok");
  });

  it("never puts the password into the result", async () => {
    const signIn = vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 400, code: "invalid_credentials", message: `bad ${PASSWORD}` } });
    const result = await verifyAccountPassword(INPUT, factory(signIn).create);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
  });
});
