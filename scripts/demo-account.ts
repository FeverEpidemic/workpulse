// Creates the promo-video demo account on the LOCAL Supabase stack only (docs/marketing/reels-30s-v1.md).
// Every person, company, school and number in it is fictional demo data.
// Usage: node scripts/demo-account.ts
// The sign-in email and a fresh random password are written to the git-ignored .env.demo.local, never printed.
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

const CONTAINER = "supabase_db_WorkPulse";
const EMAIL = "demo-reels@example.test";

function sql(statement: string): string {
  const result = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
    { input: statement, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`demo SQL failed: ${result.stderr.trim().slice(0, 400)}`);
  return result.stdout.trim();
}

function sqlAsUser(userId: string, body: string): string {
  return sql(
    `begin;\nset local role authenticated;\n` +
    `select set_config('request.jwt.claims', '{"sub":"${userId}","role":"authenticated"}', true);\n${body}\ncommit;\n`,
  );
}

// The legacy service-role JWT authenticates reliably through Kong on this machine; the key stays in memory.
function localStack(): { url: string; serviceKey: string } {
  const env = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], { encoding: "utf8", shell: true });
  const read = (name: string) => env.split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .find((match) => match?.[1] === name)?.[2];
  const url = read("API_URL");
  const serviceKey = read("SERVICE_ROLE_KEY");
  if (typeof url !== "string" || typeof serviceKey !== "string") throw new Error("local Supabase is not running (pnpm db:start)");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) throw new Error(`refusing to seed a non-local stack: ${url}`);
  return { url, serviceKey };
}

const PROFILE_AND_HISTORY = `
do $$
declare
  v_lumbung uuid; v_kirim uuid; v_project uuid;
begin
  select x.id into v_kirim from public.create_experience_idempotent(
    p_operation_key => gen_random_uuid(), p_organization => 'Kirim Cepat Nusantara', p_role_title => 'Staf Data Entry',
    p_description => null, p_kind => 'employment', p_start_date => date '2021-08-01', p_start_precision => 'month',
    p_end_date => date '2023-02-01', p_end_precision => 'month', p_is_current => false) as x;
  select x.id into v_lumbung from public.create_experience_idempotent(
    p_operation_key => gen_random_uuid(), p_organization => 'Lumbung Logistik', p_role_title => 'Operations Analyst',
    p_description => null, p_kind => 'employment', p_start_date => date '2023-03-01', p_start_precision => 'month',
    p_end_date => null, p_end_precision => null, p_is_current => true) as x;
  perform public.create_education_idempotent(
    p_operation_key => gen_random_uuid(), p_institution => 'Universitas Kencana Raya', p_qualification => 'S1',
    p_field_of_study => 'Teknik Industri', p_description => null,
    p_start_date => date '2017-01-01', p_start_precision => 'year',
    p_end_date => date '2021-01-01', p_end_precision => 'year', p_is_current => false);
  select x.project_id into v_project from public.create_project_idempotent(
    p_operation_key => gen_random_uuid(), p_title => 'Dashboard Keterlambatan Pengiriman', p_description => null,
    p_user_role => 'Pemilik dashboard', p_outcome => null, p_status => 'active',
    p_start_date => date '2026-06-01', p_start_precision => 'month', p_end_date => null, p_end_precision => null,
    p_is_current => true, p_experience_id => v_lumbung) as x;

  -- Activities are written the way a user types them. The newest one stays without an achievement for the AI scene.
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Rapat sama tim gudang Cikarang, bahas kenapa paket ke Bekasi sering telat. Ternyata pickup kurir jam 3 sore, padahal packing baru beres jam 4. Gue usulin pickup digeser ke jam 5, tim gudang setuju dicoba minggu depan.',
    current_date - 2, 'note', null, null, null, v_lumbung, v_project);
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Bikin query SQL buat narik data keterlambatan per rute 3 bulan terakhir, terus masukin ke Looker Studio. Sekarang supervisor bisa lihat rute paling telat tanpa minta laporan manual tiap Senin.',
    current_date - 6, 'note', null, null, null, v_lumbung, v_project);
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Bantu onboarding 2 staf admin baru, jelasin cara input retur di sistem. Bikin cheat sheet satu halaman biar mereka nggak bolak-balik nanya.',
    current_date - 12, 'note', null, null, null, v_lumbung, null);
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Rekap retur bulan lalu. 38 retur gara-gara alamat salah. Usul ke tim CS buat konfirmasi alamat lewat WhatsApp sebelum paket dikirim.',
    current_date - 20, 'note', null, null, null, v_lumbung, null);
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Rapikan template laporan harian di Google Sheets, ganti formula yang error. Bikin laporan harian sekarang sekitar 20 menit, dulu hampir 1 jam.',
    current_date - 35, 'note', null, null, null, v_lumbung, null);
  perform public.create_activity_idempotent(gen_random_uuid(),
    'Ikut stock opname di gudang Cikarang, cek selisih stok 120 SKU bareng tim gudang.',
    current_date - 50, 'note', null, null, null, v_lumbung, null);
end $$;
`;

const ACHIEVEMENTS_AND_CV = `
do $$
declare
  v_ach record; v_rev integer; r record;
  v_kirim uuid := (select id from public.experiences where organization = 'Kirim Cepat Nusantara');
  v_act_dashboard uuid := (select id from public.activities where raw_text like 'Bikin query SQL%');
  v_act_retur uuid := (select id from public.activities where raw_text like 'Rekap retur%');
  v_act_template uuid := (select id from public.activities where raw_text like 'Rapikan template%');
begin
  select x.achievement_id, x.revision into v_ach from public.create_achievement_idempotent(gen_random_uuid(), v_act_dashboard, null, null) as x;
  perform public.save_achievement(v_ach.achievement_id, v_ach.revision, 'confirm', jsonb_build_object(
    'title', 'Dashboard keterlambatan pengiriman per rute',
    'contribution', 'Menyusun query SQL dan dashboard Looker Studio untuk data keterlambatan per rute selama 3 bulan.',
    'outcome', 'Supervisor memantau rute yang paling sering terlambat tanpa laporan manual mingguan.',
    'achieved_on', (current_date - 6)::text), '["SQL", "Looker Studio"]'::jsonb);

  select x.achievement_id, x.revision into v_ach from public.create_achievement_idempotent(gen_random_uuid(), v_act_retur, null, null) as x;
  perform public.save_achievement(v_ach.achievement_id, v_ach.revision, 'confirm', jsonb_build_object(
    'title', 'Analisis penyebab retur pengiriman',
    'contribution', 'Merekap data retur bulanan dan menemukan 38 retur akibat alamat salah.',
    'outcome', 'Mengusulkan konfirmasi alamat lewat WhatsApp sebelum pengiriman kepada tim CS.',
    'achieved_on', (current_date - 20)::text), '["Analisis Data"]'::jsonb);

  select x.achievement_id, x.revision into v_ach from public.create_achievement_idempotent(gen_random_uuid(), v_act_template, null, null) as x;
  perform public.save_achievement(v_ach.achievement_id, v_ach.revision, 'confirm', jsonb_build_object(
    'title', 'Template laporan harian yang lebih cepat',
    'contribution', 'Merapikan template laporan harian di Google Sheets dan memperbaiki formula yang error.',
    'outcome', 'Penyusunan laporan harian turun dari hampir 60 menit menjadi sekitar 20 menit.',
    'achieved_on', (current_date - 35)::text,
    'metrics', jsonb_build_array(jsonb_build_object('label', 'Waktu laporan harian', 'value', 20, 'unit', 'menit'))),
    '["Google Sheets", "Perbaikan Proses"]'::jsonb);

  select x.achievement_id, x.revision into v_ach from public.create_achievement_idempotent(gen_random_uuid(), null, null, v_kirim) as x;
  perform public.save_achievement(v_ach.achievement_id, v_ach.revision, 'confirm', jsonb_build_object(
    'title', 'Verifikasi data pengiriman harian',
    'contribution', 'Menginput dan memverifikasi data pengiriman harian untuk tim operasional.',
    'outcome', 'Data pengiriman harian lengkap sebelum rapat operasional pagi.',
    'achieved_on', '2022-11-30'), '["Google Sheets"]'::jsonb);

  select x.revision into v_rev from public.ensure_cv_document() as x;
  for r in select 'experience' as t, id from public.experiences
    union all select 'education', id from public.education
    union all select 'project', id from public.projects
    union all select 'skill', id from public.skills
    -- One achievement stays out of the CV so the video can show it being added.
    union all select 'achievement', id from public.achievements
      where status = 'confirmed' and title <> 'Analisis penyebab retur pengiriman'
  loop
    select x.cv_revision into v_rev from public.select_cv_source(v_rev, r.t, r.id) as x;
  end loop;
end $$;
`;

async function main(): Promise<void> {
  const stack = localStack();
  if (sql(`select count(1) from auth.users where email = '${EMAIL}'`) !== "0") {
    throw new Error(`${EMAIL} already exists; delete it from Studio (Authentication) before seeding again`);
  }
  const admin = createClient(stack.url, stack.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const password = randomBytes(18).toString("base64url") + "Aa1!";
  const created = await admin.auth.admin.createUser({ email: EMAIL, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`create user failed: ${created.error?.message ?? "no user"}`);
  const userId = created.data.user.id;

  try {
    sql(`update public.profiles set display_name = 'Raka Pratama', headline = 'Operations Analyst', location = 'Jakarta',
      contact_email = 'raka.pratama@example.com', summary = null, locale = 'id', timezone = 'Asia/Jakarta',
      onboarding_completed_at = now() where id = '${userId}'::uuid;`);
    sqlAsUser(userId, PROFILE_AND_HISTORY);
    sqlAsUser(userId, ACHIEVEMENTS_AND_CV);
  } catch (error) {
    // The failed block rolled back, so the account is still empty and a plain delete removes it.
    if (sql(`select count(1) from public.activities where user_id = '${userId}'::uuid`) === "0") {
      await admin.auth.admin.deleteUser(userId);
    }
    throw error;
  }

  writeFileSync(".env.demo.local", `# Local promo demo account (fictional data). Git-ignored.\nDEMO_EMAIL=${EMAIL}\nDEMO_PASSWORD=${password}\n`, "utf8");
  const counts = sql(`select (select count(1) from public.activities where user_id = '${userId}')
    || ' activities, ' || (select count(1) from public.achievements where user_id = '${userId}')
    || ' achievements, ' || (select count(1) from public.cv_items where user_id = '${userId}') || ' CV items'`);
  console.log(`Demo account ready (${counts}). Credentials in .env.demo.local.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
