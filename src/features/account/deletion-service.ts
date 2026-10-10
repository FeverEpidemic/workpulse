import { randomUUID } from "node:crypto";

import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";

import {
  accountDeletionInputSchema,
  accountDeletionPreviewSchema,
  confirmationMatches,
  type AccountDeletionErrorCode,
  type AccountDeletionPreview,
} from "@/domain/account/deletion";
import type { MessageKey } from "@/i18n/messages";
import type { AuthAdapter } from "@/server/auth/adapter";
import type { PasswordVerification } from "@/server/auth/reauthenticate";
import type { Database } from "@/server/supabase/database.types";

type Client = SupabaseClient<Database>;

/** Ban applied before the worker deletes the Auth user: about a hundred years. */
const BAN_DURATION = "876000h";

export const ACCOUNT_DELETION_MESSAGE_KEYS: Record<AccountDeletionErrorCode, MessageKey> = {
  VALIDATION: "error.validation",
  CONFIRMATION_MISMATCH: "account.delete.error.confirmationMismatch",
  INVALID_PASSWORD: "account.delete.error.invalidPassword",
  RATE_LIMITED: "auth.rateLimited",
  UNAUTHENTICATED: "auth.signInRequired",
  UNAVAILABLE: "error.unavailable",
};

/** Safe, localized deletion error with a correlation ID. It never carries the password, the email or any record text. */
export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;
  readonly messageKey: MessageKey;
  readonly correlationId: string;

  constructor(code: AccountDeletionErrorCode, correlationId: string = randomUUID()) {
    super("Account deletion could not be completed.");
    this.name = "AccountDeletionError";
    this.code = code;
    this.messageKey = ACCOUNT_DELETION_MESSAGE_KEYS[code];
    this.correlationId = correlationId;
  }
}

export interface AccountDeletionDeps {
  client: Pick<Client, "rpc"> & { auth: Pick<Client["auth"], "getUser"> };
  admin: Pick<Client, "rpc"> & { auth: { admin: Pick<Client["auth"]["admin"], "updateUserById"> } };
  auth: Pick<AuthAdapter, "signOutGlobal" | "signOutLocal">;
  verifyPassword: (input: { email: string; password: string; expectedUserId: string }) => Promise<PasswordVerification>;
  correlationId?: string;
}

export interface AccountDeletionResult {
  /** True when the ban or the global sign-out failed; the worker still deletes the Auth user. */
  revokeDeferred: boolean;
}

export function createAccountDeletionService(deps: AccountDeletionDeps) {
  const correlationId = deps.correlationId ?? randomUUID();
  const fail = (code: AccountDeletionErrorCode) => new AccountDeletionError(code, correlationId);

  async function sessionUser(): Promise<{ id: string; email: string }> {
    const { data, error } = await deps.client.auth.getUser();
    if (error) throw fail(isAuthRetryableFetchError(error) ? "UNAVAILABLE" : "UNAUTHENTICATED");
    const user = data?.user;
    if (!user?.id || !user.email) throw fail("UNAUTHENTICATED");
    return { id: user.id, email: user.email };
  }

  return {
    /** Counts of the data a deletion removes, for the confirmation dialog. */
    async preview(): Promise<AccountDeletionPreview> {
      await sessionUser();
      const { data, error } = await deps.client.rpc("get_account_deletion_preview");
      if (error) throw fail(error.code === "42501" ? "UNAUTHENTICATED" : "UNAVAILABLE");
      const parsed = accountDeletionPreviewSchema.safeParse(Array.isArray(data) ? data[0] : data);
      if (!parsed.success) throw fail("UNAVAILABLE");
      return parsed.data;
    },

    /**
     * Failures before `begin_account_deletion` change nothing. After it, the deletion is committed: a failed ban or
     * global sign-out is reported as deferred instead of an error.
     */
    async deleteAccount(input: unknown): Promise<AccountDeletionResult> {
      const parsed = accountDeletionInputSchema.safeParse(input);
      if (!parsed.success) throw fail("VALIDATION");
      const user = await sessionUser();
      if (!confirmationMatches(user.email, parsed.data.confirmation)) throw fail("CONFIRMATION_MISMATCH");

      const verification = await deps.verifyPassword({ email: user.email, password: parsed.data.password, expectedUserId: user.id });
      if (verification === "invalid") throw fail("INVALID_PASSWORD");
      if (verification === "rate_limited") throw fail("RATE_LIMITED");
      if (verification !== "ok") throw fail("UNAVAILABLE");

      const begun = await deps.admin.rpc("begin_account_deletion", { p_user_id: user.id });
      if (begun.error) throw fail("UNAVAILABLE");

      let revokeDeferred = false;
      try {
        const ban = await deps.admin.auth.admin.updateUserById(user.id, { ban_duration: BAN_DURATION });
        if (ban.error) revokeDeferred = true;
      } catch {
        revokeDeferred = true;
      }
      try {
        const signedOut = await deps.auth.signOutGlobal();
        if (signedOut.error) revokeDeferred = true;
      } catch {
        revokeDeferred = true;
      }
      try {
        await deps.auth.signOutLocal();
      } catch {
        revokeDeferred = true;
      }
      return { revokeDeferred };
    },
  };
}

export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
