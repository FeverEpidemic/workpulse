import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

import type { Database } from "../../../src/server/supabase/database.types";
import { drainUntilCompleted } from "./account-deletion-worker";

// Accounts and career data for the T25 release specs. Rows are made through the same RPCs the product uses, so each
// screen shows what a real account shows. One account per spec keeps the run inside the local Auth rate limit
// (30 sign-ins per 5 minutes per address).

export type Client = SupabaseClient<Database>;
export interface User { id: string; email: string; password: string; client: Client; name: string }
export interface Career {
  experienceId: string;
  educationId: string;
  projectId: string;
  emptyProjectId: string;
  activityId: string;
  achievementId: string;
  draftAchievementId: string;
  skillId: string;
}

const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };
const nul = null as never;

export function config(): { url: string; secretKey: string; publicKey: string } {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const url = process.env["SUPABASE_URL"]?.trim();
  const secretKey = process.env["SUPABASE_SECRET_KEY"]?.trim();
  const publicKey = process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]?.trim();
  if (!url || !secretKey || !publicKey) throw new Error("Local Supabase fixture credentials are required.");
  return { url, secretKey, publicKey };
}

let adminClient: Client | null = null;
export function admin(): Client {
  const { url, secretKey } = config();
  adminClient ??= createClient<Database>(url, secretKey, options);
  return adminClient;
}

export async function createUser(label: string, settings: { name?: string; locale?: "en" | "id" } = {}): Promise<User> {
  const { url, publicKey } = config();
  const email = `t25-${label}-${randomUUID().replaceAll("-", "")}@workpulse.test`;
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  const id = created.data.user?.id;
  if (created.error || !id) throw new Error(`T25 fixture user failed: ${label}`);
  const client = createClient<Database>(url, publicKey, options);
  if ((await client.auth.signInWithPassword({ email, password })).error) throw new Error(`T25 fixture sign-in failed: ${label}`);
  const profile = await client.from("profiles").select("revision").eq("id", id).single();
  const name = settings.name ?? "Ani Contoh";
  const done = await client.rpc("complete_onboarding", {
    p_display_name: name, p_locale: settings.locale ?? "en", p_timezone: "Asia/Jakarta", p_expected_revision: profile.data!.revision,
  });
  if (done.error) throw new Error(`T25 fixture onboarding failed: ${label}`);
  return { id, email, password, client, name };
}

function first<T>(data: unknown, key: string, label: string): T {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  const value = row?.[key];
  if (value === undefined || value === null) throw new Error(`T25 fixture failed: ${label}`);
  return value as T;
}

/** Experience, education, certification, skill, two projects, three activities and two achievements. */
export async function seedCareer(user: User): Promise<Career> {
  const c = user.client;
  const experience = await c.rpc("create_experience_idempotent", {
    p_operation_key: randomUUID(), p_organization: "Perusahaan Contoh", p_role_title: "Analis Data", p_description: nul, p_kind: "employment",
    p_start_date: "2024-02-01", p_start_precision: "month", p_end_date: nul, p_end_precision: nul, p_is_current: true,
  });
  const experienceId = first<string>(experience.data, "id", "experience");
  const education = await c.rpc("create_education_idempotent", {
    p_operation_key: randomUUID(), p_institution: "Universitas Contoh", p_qualification: "S1", p_field_of_study: "Informatika",
    p_description: nul, p_start_date: "2019-08-01", p_start_precision: "month", p_end_date: "2023-07-01", p_end_precision: "month", p_is_current: false,
  });
  const educationId = first<string>(education.data, "id", "education");
  const certification = await c.rpc("create_certification_idempotent", {
    p_operation_key: randomUUID(), p_name: "Sertifikat Analisis Data", p_issuer: "Lembaga Contoh", p_credential_url: nul,
    p_issued_date: "2024-06-01", p_issued_precision: "month",
  });
  first<string>(certification.data, "id", "certification");
  const skill = await c.rpc("create_skill_idempotent", { p_operation_key: randomUUID(), p_name: "SQL" });
  const skillId = first<string>(skill.data, "id", "skill");

  const project = await c.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: "Dasbor Penjualan", p_description: "Dasbor untuk tim penjualan.", p_user_role: "Analis",
    p_outcome: "Laporan mingguan selesai dalam satu jam.", p_status: "completed", p_start_date: "2025-01-01", p_start_precision: "month",
    p_end_date: "2025-06-01", p_end_precision: "month", p_is_current: false, p_experience_id: experienceId,
  });
  const projectId = first<string>(project.data, "project_id", "project");
  const emptyProject = await c.rpc("create_project_idempotent", {
    p_operation_key: randomUUID(), p_title: "Riset Pelanggan", p_description: nul, p_user_role: nul, p_outcome: nul, p_status: "completed",
    p_start_date: nul, p_start_precision: nul, p_end_date: nul, p_end_precision: nul, p_is_current: false, p_experience_id: nul,
  });
  const emptyProjectId = first<string>(emptyProject.data, "project_id", "project without outcome");

  const activities: string[] = [];
  const specs = [
    { mode: "note", text: "Menyusun laporan penjualan mingguan dan membagikannya ke tim.", day: "2026-10-01", project: projectId, experience: experienceId },
    { mode: "form", text: "Merapikan kueri laporan sehingga waktu muat turun.", day: "2026-10-03", project: nul, experience: nul },
    { mode: "chat", text: "Menjelaskan hasil analisis kepada manajer produk.", day: "2026-10-05", project: nul, experience: nul },
  ] as const;
  for (const spec of specs) {
    const activity = await c.rpc("create_activity_idempotent", {
      p_operation_key: randomUUID(), p_raw_text: spec.text, p_occurred_on: spec.day, p_capture_mode: spec.mode,
      p_role: spec.mode === "form" ? "Analis" : nul, p_scope: spec.mode === "form" ? "Tim penjualan" : nul,
      p_outcome: spec.mode === "form" ? "Waktu muat turun dari dua menit menjadi 20 detik." : nul,
      p_experience_id: spec.experience, p_project_id: spec.project,
    });
    activities.push(first<string>(activity.data, "activity_id", `activity ${spec.mode}`));
  }

  const changes = {
    title: "Mempercepat laporan mingguan", contribution: "Menulis ulang kueri dan menjadwalkan laporan.",
    scope: "Tim penjualan", outcome: "Laporan siap dalam satu jam.", cv_bullet: "Mempercepat laporan penjualan mingguan hingga satu jam.",
    achieved_on: "2026-10-02", metrics: [],
  };
  const created = await c.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: activities[0]!, p_project_id: nul, p_experience_id: nul,
  });
  const achievementId = first<string>(created.data, "achievement_id", "achievement");
  const draft = await c.rpc("save_achievement", {
    p_achievement_id: achievementId, p_expected_revision: first<number>(created.data, "revision", "achievement revision"),
    p_action: "save_draft", p_changes: changes, p_skill_names: ["SQL"],
  } as never);
  if (draft.error) throw new Error("T25 fixture failed: achievement draft");
  const row = await c.from("achievements").select("revision").eq("id", achievementId).single();
  const confirmed = await c.rpc("save_achievement", {
    p_achievement_id: achievementId, p_expected_revision: row.data!.revision, p_action: "confirm", p_changes: changes, p_skill_names: ["SQL"],
  } as never);
  if (confirmed.error) throw new Error("T25 fixture failed: achievement confirm");

  const standalone = await c.rpc("create_achievement_idempotent", {
    p_operation_key: randomUUID(), p_activity_id: nul, p_project_id: nul, p_experience_id: nul,
  });
  const draftAchievementId = first<string>(standalone.data, "achievement_id", "draft achievement");
  const draftRevision = first<number>(standalone.data, "revision", "draft revision");
  const savedDraft = await c.rpc("save_achievement", {
    p_achievement_id: draftAchievementId, p_expected_revision: draftRevision, p_action: "save_draft",
    p_changes: { title: "Pelatihan tim baru", contribution: "Menyusun materi pelatihan.", scope: "", outcome: "", cv_bullet: "", achieved_on: nul, metrics: [] },
    p_skill_names: [],
  } as never);
  if (savedDraft.error) throw new Error("T25 fixture failed: draft achievement save");

  return { experienceId, educationId, projectId, emptyProjectId, activityId: activities[0]!, achievementId, draftAchievementId, skillId };
}

/** Puts education, the project and the confirmed achievement on the CV and returns the saved revision. */
export async function seedCv(user: User, career: Career): Promise<number> {
  const c = user.client;
  const ensured = await c.rpc("ensure_cv_document");
  if (ensured.error) throw new Error("T25 fixture failed: CV open");
  const sources: [string, string][] = [
    ["education", career.educationId], ["project", career.projectId], ["achievement", career.achievementId],
  ];
  for (const [type, id] of sources) {
    const doc = await c.from("cv_documents").select("revision").eq("user_id", user.id).single();
    const added = await c.rpc("select_cv_source", { p_expected_revision: doc.data!.revision, p_source_type: type, p_source_id: id });
    if (added.error) throw new Error(`T25 fixture failed: CV select ${type}`);
  }
  const doc = await c.from("cv_documents").select("revision").eq("user_id", user.id).single();
  return doc.data!.revision;
}

export async function requestExport(user: User, revision: number): Promise<void> {
  const requested = await user.client.rpc("request_cv_export", { p_expected_revision: revision, p_idempotency_key: randomUUID() });
  if (requested.error) throw new Error("T25 fixture failed: export request");
}

export async function consent(user: User): Promise<void> {
  const profile = await user.client.from("profiles").select("revision").eq("id", user.id).single();
  const done = await user.client.rpc("set_ai_consent", { p_expected_revision: profile.data!.revision, p_consented: true });
  if (done.error) throw new Error("T25 fixture failed: AI consent");
}

export async function signIn(page: Page, user: User, returnTo: string): Promise<void> {
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').first().fill(user.password);
  await page.getByRole("button", { name: /^(Sign in|Masuk)$/ }).click();
  await expect(page).toHaveURL(new RegExp(returnTo.replace(/[?/=#]/g, "\\$&") + "$"));
}

/** Removes the accounts through the real deletion path: a plain user delete fails on accounts with a project and experience. */
export async function removeUsers(users: User[]): Promise<void> {
  for (const user of users) {
    await admin().rpc("begin_account_deletion", { p_user_id: user.id });
    await drainUntilCompleted(user.id);
  }
}
