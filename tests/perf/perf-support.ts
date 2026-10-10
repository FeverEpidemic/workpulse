import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdminConfig, getSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/server/supabase/database.types";

import { runAccountDeletionWorkerOnce } from "../../workers/account-deletion-worker.ts";
import { createSupabaseAccountDeletionWorkerGateway } from "../../workers/supabase-account-deletion-gateway.ts";

export type Client = SupabaseClient<Database>;

const CONTAINER = process.env.WORKPULSE_TEST_DB_CONTAINER ?? "supabase_db_WorkPulse";
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

export const DEFAULT_RESULTS_PATH = "docs/verification/T24-perf-results.json";

/** Statements run as the database owner. The SQL goes through stdin, so large seed blocks are fine. */
export function sql(statement: string): string {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`T24 perf SQL failed: ${result.stderr.trim().slice(0, 300)}`);
  return result.stdout.trim();
}

/** Runs a block as the `authenticated` role with a JWT subject, so RPCs, triggers and constraints behave as for a user. */
export function sqlAsUser(userId: string, body: string): string {
  return sql(
    `begin;\nset local role authenticated;\n` +
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);\n${body}\ncommit;\n`,
  );
}

export interface Harness {
  admin: Client;
  url: string;
  publishableKey: string;
  secretKey: string;
}

export function setupHarness(): Harness {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const adminConfig = getSupabaseAdminConfig();
  const publicConfig = getSupabasePublicConfig();
  if (!adminConfig || !publicConfig) throw new Error("Set local Supabase URL, publishable key, and server secret key before running T24 perf");
  return {
    admin: createClient<Database>(adminConfig.url, adminConfig.secretKey, clientOptions),
    url: adminConfig.url,
    publishableKey: publicConfig.publishableKey,
    secretKey: adminConfig.secretKey,
  };
}

export interface PerfAccount {
  id: string;
  email: string;
  password: string;
  label: string;
}

export const perfEmail = (label: string) => `t24-perf-${label}@example.test`;

/**
 * Creates the account once through the Admin API (or reuses one a crashed run left behind, with a new password) and
 * marks its profile onboarded in Asia/Jakarta. The password is random per run and never printed.
 */
export async function ensureAccount(harness: Harness, label: string): Promise<PerfAccount> {
  const email = perfEmail(label);
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const existing = sql(`select id from auth.users where email = '${email}'`);
  let id = existing;
  if (existing) {
    const updated = await harness.admin.auth.admin.updateUserById(existing, { password });
    if (updated.error) throw new Error(`T24 perf setup failed: reuse account ${label}`);
  } else {
    const created = await harness.admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`T24 perf setup failed: create account ${label}`);
    id = created.data.user.id;
  }
  const profile = await harness.admin.from("profiles").update({
    display_name: `T24 perf ${label.toUpperCase()}`, locale: "en", timezone: "Asia/Jakarta", onboarding_completed_at: new Date().toISOString(),
  }).eq("id", id);
  if (profile.error) throw new Error(`T24 perf setup failed: profile ${label}`);
  return { id, email, password, label };
}

export async function signInClient(harness: Harness, account: PerfAccount): Promise<Client> {
  const client = createClient<Database>(harness.url, harness.publishableKey, clientOptions);
  const result = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (result.error || !result.data.user) throw new Error(`T24 perf setup failed: sign in ${account.label}`);
  return client;
}

/** A new client object that reuses an existing session, so a "cold" sample costs no extra password sign-in. */
export async function clientFromSession(harness: Harness, source: Client): Promise<Client> {
  const session = (await source.auth.getSession()).data.session;
  if (!session) throw new Error("T24 perf setup failed: no session to reuse");
  const client = createClient<Database>(harness.url, harness.publishableKey, clientOptions);
  const restored = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (restored.error) throw new Error("T24 perf setup failed: restore session");
  return client;
}

/**
 * Removes an account through the T23 deletion path (a populated account cannot be removed with a plain user delete):
 * begin, deletion worker passes until the receipt is completed, then the receipt row of this fixture is dropped.
 */
export async function removeAccount(harness: Harness, userId: string): Promise<void> {
  const exists = sql(`select count(1) from auth.users where id = '${userId}'::uuid`) !== "0";
  if (exists) {
    await harness.admin.rpc("begin_account_deletion", { p_user_id: userId });
    const gateway = createSupabaseAccountDeletionWorkerGateway({ url: harness.url, secretKey: harness.secretKey });
    for (let pass = 0; pass < 8; pass += 1) {
      await runAccountDeletionWorkerOnce({ ...gateway });
      const status = sql(`select coalesce((select status from internal.account_deletions where user_id = '${userId}'::uuid), 'none')`);
      if (status === "completed" || status === "none") break;
    }
    await harness.admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
  sql(`delete from internal.account_deletions where user_id = '${userId}'::uuid`);
}

export interface Environment {
  os: string;
  cpu: string | undefined;
  cores: number;
  ramGiB: number;
  docker: string;
  postgres: string;
  node: string;
  supabaseCli: string;
  head: string;
}

export function environmentInfo(): Environment {
  const cpus = os.cpus();
  const cli = spawnSync("pnpm exec supabase --version", { shell: true, encoding: "utf8" });
  return {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: cpus[0]?.model.trim(),
    cores: cpus.length,
    ramGiB: Math.round(os.totalmem() / 2 ** 30),
    docker: execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).trim(),
    postgres: sql("select version();"),
    node: process.version,
    supabaseCli: (cli.stdout ?? "").split("\n").map((line) => line.trim()).find((line) => /^\d+\.\d+\.\d+/.test(line)) ?? "unknown",
    head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(),
  };
}

export function writeResults(results: unknown, target = process.env.WORKPULSE_PERF_OUT ?? DEFAULT_RESULTS_PATH): string {
  mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  writeFileSync(target, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  return target;
}
