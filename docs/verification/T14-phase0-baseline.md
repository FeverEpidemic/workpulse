# T14 Fase 0 — Baseline

- Tanggal: 28 September 2026
- Pelaksana: Claude (atas permintaan eksplisit pengguna untuk mengeksekusi handoff T14 sendiri, sesi tunggal, tanpa sub-agent). Handoff: [T14-implementation-plan.md](T14-implementation-plan.md).
- Branch: `claude/clever-archimedes-gbu7qd`. HEAD awal `078b89b` (docs(t14): add implementation handoff plan), ahead 2 dari origin. Working tree bersih kecuali `.claude/` (sesuai stop condition §8).

## Tujuan

Memastikan baseline hijau, parity migration 22/22 dengan migration terakhir T13, tidak ada duplikat `ai_jobs` per revisi, dan asumsi file:baris di §0 rencana benar, sebelum menyentuh kode.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `git status --short --branch` | 0 | Bersih kecuali `.claude/` |
| `node --version` / `pnpm --version` | 0 | v24.18.0 / 11.19.0, sesuai pin |
| `pnpm install --frozen-lockfile` | 0 | Already up to date |
| `pnpm exec supabase migration list --local` | 0 | 22/22, local=remote untuk semua, terakhir `20260928090000_t13_ai_jobs_consent.sql` |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 51 file / 274 test (sesuai ekspektasi rencana) |
| `pnpm db:test` | 0 | 8 file / 470 assertion (sesuai ekspektasi rencana) |
| Query duplikat `(user_id, activity_id, input_revision)` pada `public.ai_jobs` | — | 0 baris |
| `pnpm test:integration:ai` | 0 | 13/13 test lulus (lihat catatan lingkungan di bawah) |

## Catatan lingkungan (Docker Desktop/WSL2, bukan bug kode)

Docker Desktop tidak berjalan di awal sesi; dijalankan dan ditunggu siap (~15 detik). Setelah itu, kunci
`sb_secret_...` yang dilaporkan `pnpm exec supabase status -o env` sebagai `SECRET_KEY` **tidak konsisten**
mengautentikasi panggilan RPC service-role lewat Kong (`/rest/v1/rpc/expire_ai_job_leases`): kadang `200`,
kadang `401 {"code":"42501","message":"permission denied for function ..."}`, dari klien PowerShell maupun
Node `fetch` secara terpisah — termasuk setelah `wsl --shutdown` penuh dan restart Docker Desktop bersih,
dan setelah seluruh container melaporkan `healthy`. Root cause diduga masalah sinkronisasi consumer API-key
Kong pada versi CLI lokal ini (v2.117.0, ada v2.118.0 lebih baru), bukan kesalahan grant di migration T13
(grant `service_role` pada `expire_ai_job_leases` sudah benar, dikonfirmasi dari source).

Mitigasi lingkungan yang dipakai untuk sesi ini: gunakan nilai `SERVICE_ROLE_KEY` (JWT legacy) dari
`pnpm exec supabase status -o env` sebagai `SUPABASE_SECRET_KEY` di env proses. Kode (`getSupabaseAdminConfig`,
`workers/supabase-ai-gateway.ts`) memperlakukan nilai ini sebagai string bearer/apikey opaque, jadi berfungsi
identik untuk keperluan admin/worker test; ini murni pilihan nilai environment test, bukan perubahan kode.
Didokumentasikan di memory sesi untuk fase-fase berikutnya. `SUPABASE_SECRET_KEY` tidak pernah dicetak ke log
atau disimpan ke file.

## Asumsi yang diverifikasi (file:baris)

- `internal.fail_ai_job_locked` ada di `supabase/migrations/20260928090000_t13_ai_jobs_consent.sql:228`.
- `public.request_ai_analysis` ada di `20260928090000_t13_ai_jobs_consent.sql:284`.
- `public.complete_ai_job` ada di `20260928090000_t13_ai_jobs_consent.sql:591`.
- `internal.update_activity` ada di `20260917160000_t06_activity_persistence.sql:496`, dipanggil oleh RPC lain pada baris 662; grant/revoke di 669-677.
- `internal.guard_chat_message_insert` ada di `20260917160000_t06_activity_persistence.sql:302`, dipasang sebagai trigger pada baris 330.
- `internal.is_valid_achievement_metrics` ada di `20260922100000_t09_achievements_skills.sql:52`, dipakai sebagai check constraint (174) dan validasi ulang di `create_achievement_idempotent` (651) serta di patch `20260922110000_t09_achievement_null_patch.sql:108`.
- `internal.guard_achievement_row` ada di `20260922100000_t09_achievements_skills.sql:235`, dipasang sebagai trigger pada baris 305.
- `public.create_achievement_idempotent` ada di `20260922100000_t09_achievements_skills.sql:336`. Urutan lock terverifikasi di baris 441-465: experience (`for update`) → project (`for update`) → activity (`for update`) → derived achievement lookup (`for update`), persis seperti dikutip rencana §3.1.
- `SkillTags` dan state `skills` terkontrol di `src/features/achievement/achievement-form.tsx:63` (`useState`) dan dirender terkontrol di baris 194 (`value={skills} onChange={setSkills}`).
- Redirect save non-edit ke `/activity/[id]` (S06) tanpa enqueue AI ada di `src/features/activity/activity-capture-form.tsx:260`.
- `EVIDENCE_POLL_DELAYS` ada di `src/features/evidence/evidence-attachments.tsx:17`, dipakai untuk backoff polling pada baris 176-178.
- `mapAiDatabaseError` di `src/features/ai/ai-errors.ts:74-97` memetakan kode DB T13 ke `AiServiceErrorCode`; struktur ini yang akan diperluas dengan kode T14 (§3.2 rencana), bukan ditulis ulang.
- Port 3008 belum dipakai: config Playwright yang ada memakai 3000 (auth/ui), 3001 (activity), 3002 (projects), 3003 (achievements), 3004 (evidence), 3005 (dashboard), 3006 (m2), 3007 (ai). Aman dipakai untuk `playwright.ai-review.config.ts`.

## Acceptance terbukti

Belum ada acceptance produk T14 yang terbukti di fase ini; fase ini hanya baseline dan verifikasi asumsi.

## Blocker dan langkah berikutnya

Tidak ada blocker produk. Satu catatan lingkungan (kunci RPC Kong, lihat di atas) didokumentasikan agar fase
berikutnya (integration nyata di Fase 3, E2E di Fase 5) memakai `SERVICE_ROLE_KEY` sebagai nilai
`SUPABASE_SECRET_KEY` di proses test, bukan `SECRET_KEY` format baru, pada mesin lokal ini.

Langkah berikutnya: Fase 1 — migration `20260929090000_t14_ai_review.sql` dan pgTAP `ai_review.test.sql` (TDD: tulis test gagal dulu).
