import { execFileSync } from "node:child_process";

const CONTAINER = process.env.WORKPULSE_TEST_DB_CONTAINER ?? "supabase_db_WorkPulse";

/** Statements run as the database owner; the AI usage tables are reachable from no API role. */
export function usageSql(statement: string): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement],
    { stdio: "pipe", encoding: "utf8" },
  ).trim();
}

/**
 * Puts a fixture account on an AI plan (decision 0032). Suites that exercise job mechanics rather than the usage
 * limit use 'unlimited', which is also outside the shared daily capacity, so repeated local runs never trip it.
 */
export function assignAiPlan(userId: string, plan: "free" | "unlimited"): void {
  usageSql(
    `insert into internal.ai_plan_assignments (user_id, plan) values ('${userId}'::uuid, '${plan}') ` +
    `on conflict (user_id) do update set plan = excluded.plan, assigned_at = clock_timestamp()`,
  );
}
