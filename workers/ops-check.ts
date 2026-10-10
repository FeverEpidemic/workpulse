import { pathToFileURL } from "node:url";

/**
 * `pnpm ops:check` (T25): one pass over `get_operational_health()` compared with alert thresholds.
 * Exit 0 when every count is within its threshold, 2 when one is above it, 1 when the check could not run
 * (missing or invalid configuration, backend unreachable, unexpected answer). Output is one JSON line with metric
 * names and numbers only: no URL, key, error message or stack.
 */

export const METRIC_NAMES = [
  "account_deletion_overdue",
  "storage_cleanup_failed",
  "storage_cleanup_overdue",
  "import_purge_overdue",
  "export_purge_overdue",
  "evidence_stuck",
  "jobs_failed_24h",
  "jobs_expired_lease",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];
export type Thresholds = Record<MetricName, number>;

export const DEFAULT_THRESHOLDS: Thresholds = {
  account_deletion_overdue: 0,
  storage_cleanup_failed: 0,
  storage_cleanup_overdue: 0,
  import_purge_overdue: 0,
  export_purge_overdue: 0,
  evidence_stuck: 0,
  jobs_failed_24h: 20,
  jobs_expired_lease: 0,
};

const THRESHOLD_ENV: Record<MetricName, string> = {
  account_deletion_overdue: "WORKPULSE_ALERT_DELETION_OVERDUE",
  storage_cleanup_failed: "WORKPULSE_ALERT_CLEANUP_FAILED",
  storage_cleanup_overdue: "WORKPULSE_ALERT_CLEANUP_OVERDUE",
  import_purge_overdue: "WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE",
  export_purge_overdue: "WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE",
  evidence_stuck: "WORKPULSE_ALERT_EVIDENCE_STUCK",
  jobs_failed_24h: "WORKPULSE_ALERT_JOBS_FAILED_24H",
  jobs_expired_lease: "WORKPULSE_ALERT_JOBS_EXPIRED_LEASE",
};

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_THRESHOLD = 1_000_000;

export interface HealthReading { metric: string; value: number }
export interface OpsMetric { metric: string; value: number; threshold: number; alert: boolean }
export interface OpsReport { status: "ok" | "alert"; metrics: OpsMetric[] }
export type OpsFailureCode = "OPS_CONFIG_INVALID" | "OPS_BACKEND_UNAVAILABLE";

class OpsError extends Error {
  constructor(message: OpsFailureCode) {
    super(message);
    this.name = "OpsError";
  }
}

/** Threshold per metric: the default, or the integer in the metric's environment variable (empty means default). */
export function resolveThresholds(env: Record<string, string | undefined>): Thresholds {
  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const metric of METRIC_NAMES) {
    const raw = env[THRESHOLD_ENV[metric]];
    if (raw === undefined || raw === "") continue;
    if (!/^\d{1,7}$/.test(raw) || Number(raw) > MAX_THRESHOLD) throw new OpsError("OPS_CONFIG_INVALID");
    thresholds[metric] = Number(raw);
  }
  return thresholds;
}

/** Pure comparison: a metric alerts only when its count is above the threshold. */
export function evaluateHealth(readings: HealthReading[], thresholds: Thresholds): OpsReport {
  const metrics = readings.map((entry): OpsMetric => {
    const threshold = thresholds[entry.metric as MetricName];
    return { metric: entry.metric, value: entry.value, threshold, alert: entry.value > threshold };
  });
  return { status: metrics.some((entry) => entry.alert) ? "alert" : "ok", metrics };
}

function origin(value: string | undefined): string {
  try {
    const url = new URL(value ?? "");
    const isLocal = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if ((url.protocol !== "https:" && !(isLocal && url.protocol === "http:"))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("invalid");
    }
    return url.origin;
  } catch {
    throw new OpsError("OPS_CONFIG_INVALID");
  }
}

function parseReadings(body: unknown): HealthReading[] {
  if (!Array.isArray(body) || body.length !== METRIC_NAMES.length) throw new OpsError("OPS_BACKEND_UNAVAILABLE");
  const seen = new Map<string, number>();
  for (const row of body) {
    if (typeof row !== "object" || row === null) throw new OpsError("OPS_BACKEND_UNAVAILABLE");
    const { metric, value } = row as { metric?: unknown; value?: unknown };
    if (typeof metric !== "string" || typeof value !== "number" || !Number.isInteger(value) || value < 0 || seen.has(metric)) {
      throw new OpsError("OPS_BACKEND_UNAVAILABLE");
    }
    seen.set(metric, value);
  }
  return METRIC_NAMES.map((metric) => {
    const value = seen.get(metric);
    if (value === undefined) throw new OpsError("OPS_BACKEND_UNAVAILABLE");
    return { metric, value };
  });
}

async function readHealth(baseUrl: string, secretKey: string, fetcher: typeof fetch): Promise<HealthReading[]> {
  let response: Response;
  try {
    response = await fetcher(new URL("/rest/v1/rpc/get_operational_health", baseUrl), {
      method: "POST",
      headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new OpsError("OPS_BACKEND_UNAVAILABLE");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new OpsError("OPS_BACKEND_UNAVAILABLE");
  }
  try {
    return parseReadings(JSON.parse(await response.text()) as unknown);
  } catch {
    throw new OpsError("OPS_BACKEND_UNAVAILABLE");
  }
}

export async function runOpsCheck(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
): Promise<{ exitCode: 0 | 1 | 2; output: string }> {
  try {
    const thresholds = resolveThresholds(env);
    const baseUrl = origin(env["SUPABASE_URL"]);
    const secretKey = env["SUPABASE_SECRET_KEY"] ?? "";
    if (secretKey.trim() === "") throw new OpsError("OPS_CONFIG_INVALID");
    const report = evaluateHealth(await readHealth(baseUrl, secretKey, fetcher), thresholds);
    return { exitCode: report.status === "alert" ? 2 : 0, output: `${JSON.stringify(report)}\n` };
  } catch (error) {
    const code: OpsFailureCode = error instanceof OpsError && error.message === "OPS_CONFIG_INVALID"
      ? "OPS_CONFIG_INVALID"
      : "OPS_BACKEND_UNAVAILABLE";
    return { exitCode: 1, output: `${JSON.stringify({ status: "unavailable", code, metrics: [] })}\n` };
  }
}

// Run as a script (`node workers/ops-check.ts`), not when a test imports the functions above.
if (import.meta.main && process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runOpsCheck(process.env);
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
