import { createClient } from "@supabase/supabase-js";

import type { AccountDeletionJob, AccountDeletionWorkerAuth, AccountDeletionWorkerDatabase } from "./account-deletion-worker.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RPC_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 30_000;

export type SupabaseAccountDeletionWorkerConfig = { url: string; secretKey: string };

export class AccountDeletionGatewayError extends Error {
  readonly code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_AUTH_UNAVAILABLE";
  constructor(code: "WORKER_BACKEND_UNAVAILABLE" | "WORKER_AUTH_UNAVAILABLE") {
    super("Account deletion worker backend operation failed");
    this.code = code;
    this.name = "AccountDeletionGatewayError";
  }
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
function integer(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return Number.NaN;
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value.filter(isRow);
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
  return value;
}

function normalizedOrigin(value: string): string {
  try {
    const url = new URL(value);
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if ((url.protocol !== "https:" && !(isLocal && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new Error("WORKER_CONFIG_INVALID");
  }
}

function isUserNotFound(error: unknown): boolean {
  return isRow(error) && (error.status === 404 || error.code === "user_not_found");
}

/**
 * Service-role RPC and Auth Admin adapters for the account deletion pass. Nothing here reads career data; the RPCs
 * return counts, booleans and receipt tokens only. Errors never carry bodies.
 */
export function createSupabaseAccountDeletionWorkerGateway(
  config: SupabaseAccountDeletionWorkerConfig,
  fetcher: typeof fetch = fetch,
): { database: AccountDeletionWorkerDatabase; auth: AccountDeletionWorkerAuth } {
  const origin = normalizedOrigin(config.url);
  if (!config.secretKey.trim()) throw new Error("WORKER_CONFIG_INVALID");
  const client = createClient(origin, config.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetcher(input, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS) }),
    },
  });

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, origin), {
        method: "POST",
        headers: {
          apikey: config.secretKey,
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
    try {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    } catch {
      throw new AccountDeletionGatewayError("WORKER_BACKEND_UNAVAILABLE");
    }
  }

  const database: AccountDeletionWorkerDatabase = {
    async verifyAccountPurges(limit) {
      return count(await rpc("verify_account_purges", { p_limit: limit }));
    },
    async pruneAccountDeletionReceipts(limit) {
      return count(await rpc("prune_account_deletion_receipts", { p_limit: limit }));
    },
    async claimAccountDeletionJobs(limit) {
      return rows(await rpc("claim_account_deletion_jobs", { p_limit: limit })).map((row): AccountDeletionJob => ({
        user_id: text(row.user_id), attempt_count: integer(row.attempt_count), attempt_token: text(row.attempt_token),
      }));
    },
    async purgeAccountData(userId, attemptToken) {
      return count(await rpc("purge_account_data", { p_user_id: userId, p_attempt_token: attemptToken }));
    },
    async markAccountAuthDeleted(userId, attemptToken) {
      return bool(await rpc("mark_account_auth_deleted", { p_user_id: userId, p_attempt_token: attemptToken }));
    },
    async retryAccountDeletionJob(input) {
      return bool(await rpc("retry_account_deletion_job", {
        p_user_id: input.userId, p_attempt_token: input.attemptToken, p_error_code: input.errorCode, p_next_attempt_at: input.nextAttemptAt,
      }));
    },
  };

  const auth: AccountDeletionWorkerAuth = {
    async deleteUser(userId) {
      if (!UUID_PATTERN.test(userId)) throw new AccountDeletionGatewayError("WORKER_AUTH_UNAVAILABLE");
      let result: Awaited<ReturnType<typeof client.auth.admin.deleteUser>>;
      try {
        // Hard delete: the profile tombstone goes with the user through the foreign key.
        result = await client.auth.admin.deleteUser(userId, false);
      } catch {
        throw new AccountDeletionGatewayError("WORKER_AUTH_UNAVAILABLE");
      }
      if (!result.error) return "deleted";
      if (isUserNotFound(result.error)) return "not_found";
      throw new AccountDeletionGatewayError("WORKER_AUTH_UNAVAILABLE");
    },
  };

  return { database, auth };
}
