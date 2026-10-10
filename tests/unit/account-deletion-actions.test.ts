import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "3f3c2a4e-1d2b-4c5d-8e6f-7a8b9c0d1e2f";
const EMAIL = "ani@example.com";
const PASSWORD = "correct-horse-battery-1A!";
const IDLE = { status: "idle" } as const;

const getUser = vi.fn();
const signOut = vi.fn();
const clientRpc = vi.fn();
const adminRpc = vi.fn();
const updateUserById = vi.fn();
const verifyAccountPassword = vi.fn();
const deleteCookie = vi.fn();
const setCookie = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [{ name: "sb-local-auth-token" }, { name: "wp-locale" }],
    delete: (name: string) => deleteCookie(name),
    set: (...args: unknown[]) => setCookie(...args),
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: () => getUser(), signOut: (...args: unknown[]) => signOut(...args) },
    rpc: (...args: unknown[]) => clientRpc(...args),
  }),
}));
vi.mock("@/server/supabase/admin", () => ({
  getSupabaseAdminClient: () => ({
    rpc: (...args: unknown[]) => adminRpc(...args),
    auth: { admin: { updateUserById: (...args: unknown[]) => updateUserById(...args) } },
  }),
}));
vi.mock("@/server/auth/reauthenticate", () => ({
  verifyAccountPassword: (...args: unknown[]) => verifyAccountPassword(...args),
}));

import { deleteAccountAction, getAccountDeletionPreviewAction } from "@/features/account/actions";

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

describe("T23 account deletion actions", () => {
  beforeEach(() => {
    for (const mock of [getUser, signOut, clientRpc, adminRpc, updateUserById, verifyAccountPassword, deleteCookie, setCookie]) mock.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: USER, email: EMAIL } }, error: null });
    signOut.mockResolvedValue({ error: null });
    adminRpc.mockResolvedValue({ data: [{ requested_at: "2026-10-09T00:00:00Z", already_requested: false }], error: null });
    updateUserById.mockResolvedValue({ data: {}, error: null });
    verifyAccountPassword.mockResolvedValue("ok");
  });

  it("deletes with the session user, ignores an email in the form, and redirects to sign-in", async () => {
    const target = await redirectOf(deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL, email: "intruder@example.com", user_id: "x" })));
    expect(target).toBe("/sign-in?notice=accountDeleted");
    expect(verifyAccountPassword).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD, expectedUserId: USER });
    expect(adminRpc).toHaveBeenCalledWith("begin_account_deletion", { p_user_id: USER });
    expect(updateUserById).toHaveBeenCalledWith(USER, { ban_duration: "876000h" });
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears the Auth cookies of this browser and leaves the locale cookie alone", async () => {
    await redirectOf(deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL })));
    expect(deleteCookie).toHaveBeenCalledWith("sb-local-auth-token");
    expect(deleteCookie).not.toHaveBeenCalledWith("wp-locale");
  });

  it("returns the password error on the password field without changing anything", async () => {
    verifyAccountPassword.mockResolvedValue("invalid");
    const state = await deleteAccountAction(IDLE, form({ password: "wrong", confirmation: EMAIL }));
    expect(state).toMatchObject({
      status: "error",
      error: { code: "VALIDATION", messageKey: "account.delete.error.invalidPassword", fieldErrors: { password: "account.delete.error.invalidPassword" } },
    });
    expect(adminRpc).not.toHaveBeenCalled();
    expect(updateUserById).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("returns the confirmation error on the confirmation field", async () => {
    const state = await deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: "budi@example.com" }));
    expect(state).toMatchObject({ status: "error", error: { fieldErrors: { confirmation: "account.delete.error.confirmationMismatch" } } });
    expect(verifyAccountPassword).not.toHaveBeenCalled();
  });

  it("asks for the password when the field is empty", async () => {
    const state = await deleteAccountAction(IDLE, form({ password: "", confirmation: EMAIL }));
    expect(state).toMatchObject({ status: "error", error: { code: "VALIDATION", fieldErrors: { password: "account.delete.error.passwordRequired" } } });
    expect(verifyAccountPassword).not.toHaveBeenCalled();
  });

  it("returns a recoverable message on a rate limit", async () => {
    verifyAccountPassword.mockResolvedValue("rate_limited");
    const state = await deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL }));
    expect(state).toMatchObject({ status: "error", error: { code: "RATE_LIMITED", messageKey: "auth.rateLimited" } });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("maps a missing session to UNAUTHENTICATED", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL }));
    expect(state).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
  });

  it("still leaves the workspace when the ban fails, because the deletion is committed", async () => {
    updateUserById.mockResolvedValue({ data: null, error: { message: "ban failed" } });
    await expect(redirectOf(deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL })))).resolves.toBe("/sign-in?notice=accountDeleted");
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("does not leak the password into an error state", async () => {
    verifyAccountPassword.mockResolvedValue("invalid");
    const state = await deleteAccountAction(IDLE, form({ password: PASSWORD, confirmation: EMAIL }));
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
    expect(JSON.stringify(state)).not.toContain(EMAIL);
  });

  it("returns the preview counts for the dialog", async () => {
    const preview = { activities: 2, achievements: 1, projects: 1, evidence_files: 3, import_batches: 0, has_cv: true, cv_exports: 1 };
    clientRpc.mockResolvedValue({ data: [preview], error: null });
    const state = await getAccountDeletionPreviewAction();
    expect(state).toMatchObject({ status: "success", data: preview });
    expect(clientRpc).toHaveBeenCalledWith("get_account_deletion_preview");
  });

  it("returns an unavailable state when the preview cannot be read", async () => {
    clientRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(getAccountDeletionPreviewAction()).resolves.toMatchObject({ status: "error", error: { code: "UNAVAILABLE" } });
  });
});
