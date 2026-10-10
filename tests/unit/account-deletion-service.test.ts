import { describe, expect, it, vi } from "vitest";

import { AccountDeletionError, createAccountDeletionService, type AccountDeletionDeps } from "@/features/account/deletion-service";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const EMAIL = "ani@example.com";
const PASSWORD = "correct-horse-battery-1A!";
const INPUT = { password: PASSWORD, confirmation: EMAIL };
const PREVIEW = { activities: 2, achievements: 1, projects: 1, evidence_files: 3, import_batches: 0, has_cv: true, cv_exports: 1 };

function setup(overrides: { verify?: string; begin?: unknown; ban?: unknown; global?: unknown; user?: unknown } = {}) {
  const calls: string[] = [];
  const verifyPassword = vi.fn(async () => {
    calls.push("verify");
    return (overrides.verify ?? "ok") as "ok";
  });
  const adminRpc = vi.fn(async (name: string) => {
    calls.push(name);
    return overrides.begin ?? { data: [{ requested_at: "2026-10-09T00:00:00Z", already_requested: false }], error: null };
  });
  const updateUserById = vi.fn(async () => {
    calls.push("ban");
    return overrides.ban ?? { data: {}, error: null };
  });
  const signOutGlobal = vi.fn(async () => {
    calls.push("signOutGlobal");
    return (overrides.global ?? { error: null }) as { error: null };
  });
  const signOutLocal = vi.fn(async () => {
    calls.push("signOutLocal");
    return { error: null };
  });
  const clientRpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [PREVIEW], error: null }));
  const deps = {
    client: {
      auth: { getUser: async () => overrides.user ?? { data: { user: { id: USER, email: EMAIL } }, error: null } },
      rpc: clientRpc,
    },
    admin: { rpc: adminRpc, auth: { admin: { updateUserById } } },
    auth: { signOutGlobal, signOutLocal },
    verifyPassword,
    correlationId: "11111111-1111-4111-8111-111111111111",
  } as unknown as AccountDeletionDeps;
  return { service: createAccountDeletionService(deps), calls, verifyPassword, adminRpc, updateUserById, signOutGlobal, signOutLocal, clientRpc };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AccountDeletionError) return error.code;
    throw error;
  }
  return "no error";
}

describe("T23 account deletion service", () => {
  it("runs verify, begin, ban, global sign-out and local sign-out in that order", async () => {
    const { service, calls, updateUserById, adminRpc, verifyPassword } = setup();
    await expect(service.deleteAccount(INPUT)).resolves.toEqual({ revokeDeferred: false });
    expect(calls).toEqual(["verify", "begin_account_deletion", "ban", "signOutGlobal", "signOutLocal"]);
    expect(verifyPassword).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD, expectedUserId: USER });
    expect(adminRpc).toHaveBeenCalledWith("begin_account_deletion", { p_user_id: USER });
    expect(updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
  });

  it("uses the session email for the check, never an email supplied with the input", async () => {
    const { service, verifyPassword } = setup();
    await expect(codeOf(service.deleteAccount({ ...INPUT, email: "other@example.com" }))).resolves.toBe("VALIDATION");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("refuses a wrong confirmation before the password is checked", async () => {
    const { service, calls } = setup();
    await expect(codeOf(service.deleteAccount({ password: PASSWORD, confirmation: "budi@example.com" }))).resolves.toBe("CONFIRMATION_MISMATCH");
    expect(calls).toEqual([]);
  });

  it("accepts the confirmation in another case with surrounding spaces", async () => {
    const { service } = setup();
    await expect(service.deleteAccount({ password: PASSWORD, confirmation: " ANI@Example.com " })).resolves.toEqual({ revokeDeferred: false });
  });

  it("changes nothing when the password check fails", async () => {
    for (const [verify, code] of [["invalid", "INVALID_PASSWORD"], ["rate_limited", "RATE_LIMITED"], ["unavailable", "UNAVAILABLE"]] as const) {
      const { service, calls } = setup({ verify });
      await expect(codeOf(service.deleteAccount(INPUT))).resolves.toBe(code);
      expect(calls).toEqual(["verify"]);
    }
  });

  it("neither bans nor signs out when begin_account_deletion fails", async () => {
    const { service, calls } = setup({ begin: { data: null, error: { code: "XX000", message: "boom" } } });
    await expect(codeOf(service.deleteAccount(INPUT))).resolves.toBe("UNAVAILABLE");
    expect(calls).toEqual(["verify", "begin_account_deletion"]);
  });

  it("reports the deletion as committed when the ban or the global sign-out fails", async () => {
    const banFails = setup({ ban: { data: null, error: { message: "ban failed" } } });
    await expect(banFails.service.deleteAccount(INPUT)).resolves.toEqual({ revokeDeferred: true });
    expect(banFails.signOutGlobal).toHaveBeenCalled();
    const signOutFails = setup({ global: { error: { message: "offline" } } });
    await expect(signOutFails.service.deleteAccount(INPUT)).resolves.toEqual({ revokeDeferred: true });
    expect(signOutFails.signOutLocal).toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    const { service } = setup({ user: { data: { user: null }, error: null } });
    await expect(codeOf(service.deleteAccount(INPUT))).resolves.toBe("UNAUTHENTICATED");
    const missing = setup({ user: { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400, message: "Auth session missing!" } } });
    await expect(codeOf(missing.service.deleteAccount(INPUT))).resolves.toBe("UNAUTHENTICATED");
  });

  it("parses the preview counts and refuses a malformed row", async () => {
    const { service } = setup();
    await expect(service.preview()).resolves.toEqual(PREVIEW);
    const bad = setup();
    bad.clientRpc.mockResolvedValueOnce({ data: [{ ...PREVIEW, activities: "many" }], error: null });
    await expect(codeOf(bad.service.preview())).resolves.toBe("UNAVAILABLE");
    const denied = setup();
    denied.clientRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "ACCOUNT_DELETING" } });
    await expect(codeOf(denied.service.preview())).resolves.toBe("UNAUTHENTICATED");
  });

  it("keeps the password, the email and the record counts out of the error", async () => {
    const { service } = setup({ verify: "invalid" });
    try {
      await service.deleteAccount(INPUT);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AccountDeletionError);
      const serialized = JSON.stringify({ message: (error as Error).message, ...(error as object) });
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain(EMAIL);
      expect((error as AccountDeletionError).messageKey).toBe("account.delete.error.invalidPassword");
      expect((error as AccountDeletionError).correlationId).toBe("11111111-1111-4111-8111-111111111111");
    }
  });
});
