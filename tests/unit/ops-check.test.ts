import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  METRIC_NAMES,
  evaluateHealth,
  resolveThresholds,
  runOpsCheck,
  type HealthReading,
} from "../../workers/ops-check.ts";

const URL = "http://127.0.0.1:54321";
const KEY = "sb-test-secret-value-that-must-not-be-printed";
const baseEnv = { SUPABASE_URL: URL, SUPABASE_SECRET_KEY: KEY };

const zeroReadings = (): HealthReading[] => METRIC_NAMES.map((metric) => ({ metric, value: 0 }));
const reading = (metric: string, value: number): HealthReading[] =>
  zeroReadings().map((entry) => (entry.metric === metric ? { metric, value } : entry));

const respond = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;

describe("ops:check thresholds", () => {
  it("freezes the eight metrics, their order and their default thresholds", () => {
    expect([...METRIC_NAMES]).toEqual([
      "account_deletion_overdue", "storage_cleanup_failed", "storage_cleanup_overdue", "import_purge_overdue",
      "export_purge_overdue", "evidence_stuck", "jobs_failed_24h", "jobs_expired_lease",
    ]);
    expect(DEFAULT_THRESHOLDS).toEqual({
      account_deletion_overdue: 0, storage_cleanup_failed: 0, storage_cleanup_overdue: 0, import_purge_overdue: 0,
      export_purge_overdue: 0, evidence_stuck: 0, jobs_failed_24h: 20, jobs_expired_lease: 0,
    });
  });

  it("reads an override from the environment variable of each metric", () => {
    const thresholds = resolveThresholds({
      WORKPULSE_ALERT_DELETION_OVERDUE: "2", WORKPULSE_ALERT_CLEANUP_FAILED: "3", WORKPULSE_ALERT_CLEANUP_OVERDUE: "4",
      WORKPULSE_ALERT_IMPORT_PURGE_OVERDUE: "5", WORKPULSE_ALERT_EXPORT_PURGE_OVERDUE: "6", WORKPULSE_ALERT_EVIDENCE_STUCK: "7",
      WORKPULSE_ALERT_JOBS_FAILED_24H: "8", WORKPULSE_ALERT_JOBS_EXPIRED_LEASE: "9",
    });
    expect(thresholds).toEqual({
      account_deletion_overdue: 2, storage_cleanup_failed: 3, storage_cleanup_overdue: 4, import_purge_overdue: 5,
      export_purge_overdue: 6, evidence_stuck: 7, jobs_failed_24h: 8, jobs_expired_lease: 9,
    });
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS);
    expect(resolveThresholds({ WORKPULSE_ALERT_EVIDENCE_STUCK: "" })).toEqual(DEFAULT_THRESHOLDS);
  });

  it("rejects a value that is not a non-negative integer", () => {
    for (const bad of ["-1", "1.5", "abc", "1e3", " 3 ", "99999999999"]) {
      expect(() => resolveThresholds({ WORKPULSE_ALERT_JOBS_FAILED_24H: bad }), bad).toThrowError("OPS_CONFIG_INVALID");
    }
  });

  it("alerts only above the threshold, per metric", () => {
    const at = evaluateHealth(reading("jobs_failed_24h", 20), DEFAULT_THRESHOLDS);
    expect(at.status).toBe("ok");
    expect(at.metrics.find((entry) => entry.metric === "jobs_failed_24h")).toEqual({ metric: "jobs_failed_24h", value: 20, threshold: 20, alert: false });
    const above = evaluateHealth(reading("jobs_failed_24h", 21), DEFAULT_THRESHOLDS);
    expect(above.status).toBe("alert");
    expect(above.metrics.filter((entry) => entry.alert).map((entry) => entry.metric)).toEqual(["jobs_failed_24h"]);
    const one = evaluateHealth(reading("account_deletion_overdue", 1), DEFAULT_THRESHOLDS);
    expect(one.status).toBe("alert");
    expect(evaluateHealth(reading("account_deletion_overdue", 1), { ...DEFAULT_THRESHOLDS, account_deletion_overdue: 1 }).status).toBe("ok");
  });
});

describe("ops:check run", () => {
  it("exits 0 and prints one JSON line when every metric is within its threshold", async () => {
    const result = await runOpsCheck(baseEnv, respond(zeroReadings()));
    expect(result.exitCode).toBe(0);
    expect(result.output.endsWith("\n")).toBe(true);
    expect(result.output.trim().split("\n")).toHaveLength(1);
    const parsed = JSON.parse(result.output) as { status: string; metrics: unknown[] };
    expect(parsed.status).toBe("ok");
    expect(parsed.metrics).toHaveLength(8);
  });

  it("exits 2 when a metric is above its threshold", async () => {
    const result = await runOpsCheck(baseEnv, respond(reading("storage_cleanup_failed", 3)));
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.output)).toMatchObject({ status: "alert" });
  });

  it("exits 1, not 0, for every way the backend can fail to answer", async () => {
    const cases: [string, typeof fetch][] = [
      ["http error", respond({ message: "boom" }, 500)],
      ["unauthorized", respond({ message: "denied" }, 401)],
      ["network error", (async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:54321"); }) as typeof fetch],
      ["not an array", respond({ metric: "x", value: 0 })],
      ["missing metric", respond(zeroReadings().slice(1))],
      ["unknown metric", respond([...zeroReadings(), { metric: "surprise", value: 0 }])],
      ["negative value", respond(reading("evidence_stuck", -1))],
      ["fractional value", respond(reading("evidence_stuck", 1.5))],
      ["string value", respond(zeroReadings().map((entry) => ({ ...entry, value: "0" })))],
    ];
    for (const [label, fetcher] of cases) {
      const result = await runOpsCheck(baseEnv, fetcher);
      expect(result.exitCode, label).toBe(1);
      expect(JSON.parse(result.output), label).toMatchObject({ status: "unavailable", code: "OPS_BACKEND_UNAVAILABLE", metrics: [] });
    }
  });

  it("exits 1 with OPS_CONFIG_INVALID for a missing or malformed configuration, without calling the backend", async () => {
    const never = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    const envs: Record<string, string>[] = [
      {},
      { SUPABASE_URL: URL },
      { SUPABASE_SECRET_KEY: KEY },
      { SUPABASE_URL: "not a url", SUPABASE_SECRET_KEY: KEY },
      { SUPABASE_URL: "http://example.com", SUPABASE_SECRET_KEY: KEY },
      { SUPABASE_URL: `${URL}/path`, SUPABASE_SECRET_KEY: KEY },
      { ...baseEnv, WORKPULSE_ALERT_EVIDENCE_STUCK: "-5" },
    ];
    for (const env of envs) {
      const result = await runOpsCheck(env, never);
      expect(result.exitCode, JSON.stringify(Object.keys(env))).toBe(1);
      expect(JSON.parse(result.output)).toMatchObject({ status: "unavailable", code: "OPS_CONFIG_INVALID", metrics: [] });
    }
  });

  it("never prints the URL, the key, an error message or a stack", async () => {
    const outputs = [
      (await runOpsCheck(baseEnv, respond(zeroReadings()))).output,
      (await runOpsCheck(baseEnv, respond(reading("evidence_stuck", 4)))).output,
      (await runOpsCheck(baseEnv, (async () => { throw new Error(`connect failed ${URL} ${KEY}`); }) as typeof fetch)).output,
      (await runOpsCheck(baseEnv, respond({ message: `${KEY} ${URL}` }, 500))).output,
      (await runOpsCheck({ ...baseEnv, WORKPULSE_ALERT_JOBS_FAILED_24H: KEY })).output,
    ];
    for (const output of outputs) {
      expect(output).not.toContain(KEY);
      expect(output).not.toContain("127.0.0.1");
      expect(output).not.toContain("ECONNREFUSED");
      expect(output).not.toMatch(/\bat \w+/);
    }
  });

  it("calls the report once, as service role, with a POST and no argument", async () => {
    const seen: { url: string; method: string; body: string; headers: Record<string, string> }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input), method: String(init?.method), body: String(init?.body ?? ""),
        headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      });
      return new Response(JSON.stringify(zeroReadings()), { status: 200 });
    }) as typeof fetch;
    await runOpsCheck(baseEnv, fetcher);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(`${URL}/rest/v1/rpc/get_operational_health`);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.body).toBe("{}");
    expect(seen[0]!.headers["apikey"]).toBe(KEY);
  });
});
