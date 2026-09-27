import type { AiJobClaim, AiJobSource, AiWorkerDatabase } from "./ai-worker.ts";

const RPC_TIMEOUT_MS = 15_000;

export type SupabaseAiWorkerConfig = {
  url: string;
  secretKey: string;
};

export class AiWorkerGatewayError extends Error {
  readonly code = "WORKER_BACKEND_UNAVAILABLE" as const;
  constructor() {
    super("AI worker backend operation failed");
    this.name = "AiWorkerGatewayError";
  }
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : Number.NaN;
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new AiWorkerGatewayError();
  return value.filter(isRow);
}

function origin(value: string): string {
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

/** Service-role RPC gateway for AI jobs. Failures never carry request or response bodies. */
export function createSupabaseAiWorkerGateway(
  config: SupabaseAiWorkerConfig,
  fetcher: typeof fetch = fetch,
): AiWorkerDatabase {
  const base = origin(config.url);
  if (!config.secretKey.trim()) throw new Error("WORKER_CONFIG_INVALID");

  async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(new URL(`/rest/v1/rpc/${name}`, base), {
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
      throw new AiWorkerGatewayError();
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AiWorkerGatewayError();
    }
    try {
      const body = await response.text();
      return body ? JSON.parse(body) : null;
    } catch {
      throw new AiWorkerGatewayError();
    }
  }

  return {
    async expireAiJobLeases() {
      const data = await rpc("expire_ai_job_leases", {});
      if (typeof data !== "number" || !Number.isInteger(data) || data < 0) throw new AiWorkerGatewayError();
      return data;
    },
    async claimAiJobs(limit) {
      return rows(await rpc("claim_ai_jobs", { p_limit: limit })).map((row): AiJobClaim => ({
        id: text(row.id),
        user_id: text(row.user_id),
        kind: text(row.kind),
        input_revision: integer(row.input_revision),
        attempt_count: integer(row.attempt_count),
        attempt_token: text(row.attempt_token),
      }));
    },
    async getAiJobInput(jobId, attemptToken) {
      const row = rows(await rpc("get_ai_job_input", { p_job_id: jobId, p_attempt_token: attemptToken }))[0];
      if (!row || typeof row.raw_text !== "string" || row.raw_text === "") return null;
      const source: AiJobSource = {
        raw_text: row.raw_text,
        role: nullableText(row.role),
        scope: nullableText(row.scope),
        outcome: nullableText(row.outcome),
        locale: nullableText(row.locale),
        input_revision: integer(row.input_revision),
      };
      return source;
    },
    async completeAiJob(jobId, attemptToken, result) {
      const data = await rpc("complete_ai_job", { p_job_id: jobId, p_attempt_token: attemptToken, p_result: result });
      if (typeof data !== "string") throw new AiWorkerGatewayError();
      return data;
    },
    async failAiJob(jobId, attemptToken, errorCode) {
      const data = await rpc("fail_ai_job", { p_job_id: jobId, p_attempt_token: attemptToken, p_error_code: errorCode });
      if (typeof data !== "boolean") throw new AiWorkerGatewayError();
      return data;
    },
  };
}
