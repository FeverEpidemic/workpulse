# T25 Fase 0 — Baseline dan inventaris

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `6e861f2` (`docs(t25): record user approval of frozen decisions`), branch `claude/clever-archimedes-gbu7qd`
- Tidak ada edit kode atau migration di fase ini. File baru hanya receipt ini; satu merge `origin/main` (lihat Penyimpangan).

## Penyimpangan dari plan (diputuskan pengguna)

| ID | Temuan | Keputusan |
| --- | --- | --- |
| P-1 | Parity lokal **bukan 34/34** (stop condition §8). Database lokal sudah menerapkan `20261011100000_t24_pilot_metrics_as_of.sql` (fix T24 G1, PR #16, sudah di `origin/main`) yang tidak ada di branch ini (base `3c16211`). | Pengguna memilih **merge `origin/main`** (10 Oktober 2026). Commit merge `9acab90`. Dua commit lokal sebelumnya hanya dokumen. Setelah merge: 35 file migration, parity 35/35, 18 file pgTAP. |
| P-2 | Konsekuensi P-1 pada angka plan: migration T25 menjadi **36/36** (bukan 35/35); clean rebuild Fase 5 mengharapkan **36** migration dan **20** file pgTAP (18 + `release_catalog` + `operational_health`). Nama file migration T25 tetap `20261012090000_t25_operational_health.sql` (lebih baru dari `20261011100000`). | Dipakai di seluruh fase berikutnya. |
| P-3 | Plan menyebut token warna di `src/app/globals.css`; token sebenarnya di `src/styles/tokens.css` (di-import `globals.css:2`). Tema dark dipilih lewat `[data-theme="dark"]`, bukan `prefers-color-scheme`. | `theme-contrast.test.ts` membaca `src/styles/tokens.css`. |

## Pemeriksaan awal

| Item | Hasil |
| --- | --- |
| Working tree | bersih kecuali `.claude/setting.local.json` (untracked, diizinkan) |
| `pnpm install --frozen-lockfile` | exit 0 ("Already up to date") |
| `supabase migration list --local` | sebelum merge 34 local / 35 applied (P-1); sesudah merge **35/35**, terakhir `20261011100000` |
| Container | Supabase hidup kecuali `supabase_vector_WorkPulse` (restart-loop, sudah ada sebelum T24, tidak berdampak); `workpulse-t10-clamav` healthy, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` hidup |
| Port blok rebuild 55320–55329 | tidak tereservasi (`netsh`: hanya 5357, 49732, 49735, 50000–50059) |
| Persetujuan §2.4 | **Tercatat.** Enam keputusan disetujui 10 Oktober 2026 ("Setuju semua"). Staging **belum disediakan** sejak itu, jadi Fase 7 berstatus BLOCKED kecuali pengguna menyediakannya. |
| Mode antislop | **during**; dikonfirmasi pengguna di sesi ini lewat pertanyaan mode (10 Oktober 2026). |

## Baseline (command nyata)

`SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` hasil `supabase status -o env` ke env proses saja dan tidak dicetak. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

| Command | Hasil | Harapan plan |
| --- | --- | --- |
| `pnpm lint` | exit 0 | lulus |
| `pnpm typecheck` | exit 0 | lulus |
| `pnpm worker:check` | exit 0 (`status: ready`, 9 job terdaftar) | lulus |
| `pnpm test` | exit 0, **114 file / 1041 test** | 114 / 1041 |
| `pnpm db:test` | exit 0, **18 file / 1577 assertion**, `Result: PASS` | 18 / 1573 (selisih +4 assertion dari `product_events.test.sql` fix G1, P-1) |
| `pnpm test:integration:product-events` | exit 0, **1 file / 9 test** | 9 |
| `pnpm test:integration:account-deletion` | exit 0, **2 file / 14 test** | 14 |

## Inventaris dari source dan katalog

### Route S01–S14 (dari `src/app/**/page.tsx`)

| Layar | Route | File |
| --- | --- | --- |
| S01 sign-in (+ recovery) | `/sign-in`, `/update-password`, `/` | `src/app/sign-in/page.tsx`, `src/app/update-password/page.tsx`, `src/app/page.tsx` |
| S02 onboarding import | `/onboarding/import` | `src/app/onboarding/import/page.tsx` |
| S03 import review | `/imports/[id]/review` | `src/app/imports/[id]/review/page.tsx` |
| S04 dashboard | `/dashboard` | `src/app/(workspace)/dashboard/page.tsx` |
| S05 activity baru | `/activity/new` | `src/app/(workspace)/activity/new/page.tsx` |
| S06 daftar activity | `/activity`, `/activity/[id]` | `.../activity/page.tsx`, `.../activity/[id]/page.tsx` |
| S07 daftar achievement | `/achievements`, `/achievements/new` | `.../achievements/page.tsx`, `.../achievements/new/page.tsx` |
| S08 detail achievement | `/achievements/[id]` | `.../achievements/[id]/page.tsx` |
| S09 daftar project | `/projects`, `/projects/new` | `.../projects/page.tsx`, `.../projects/new/page.tsx` |
| S10 detail project | `/projects/[id]` | `.../projects/[id]/page.tsx` |
| S11 timeline | `/timeline` | `.../timeline/page.tsx` |
| S12 settings/profile | `/settings/profile` | `.../settings/profile/page.tsx` |
| S13 CV builder | `/cv` | `.../cv/page.tsx` |
| S14 preview | `/cv/preview` | `.../cv/preview/page.tsx` |

Dialog (delete bernama, unsaved, konflik revisi, penghapusan akun) tidak punya route sendiri; diperiksa bersama layar induknya.

### Tabel `public` (query `pg_class`, database lokal)

18 tabel, semuanya `relrowsecurity = true`, semuanya punya trigger `zz_guard_account_writable`. **17** punya kolom `user_id`; `profiles` memakai `id` (FK ke `auth.users`).

`achievement_skills, achievements, activities, ai_jobs, ai_suggestion_reviews, certifications, chat_messages, cv_documents, cv_exports, cv_items, education, evidence_files, experiences, import_batches, import_items, profiles, projects, skills`.

Privilege tabel (`information_schema.role_table_grants`): **`anon` tidak punya privilege apa pun**. `authenticated` hanya `SELECT`, dan hanya pada 15 tabel; **tanpa** grant untuk `ai_jobs` dan `import_batches` (tulis semua lewat RPC `security definer`). `service_role` punya grant luas pada `profiles/experiences/education/certifications/skills/projects` dan `SELECT` pada `ai_jobs`, `evidence_files`, `import_batches`, `import_items`.

Implikasi untuk `release-ownership.test.ts`: pada tabel tanpa grant `authenticated`, akun B memperoleh **error `42501`**, bukan nol baris. Pemeriksaan menerima "nol baris **atau** permission denied" dan mencatat mana yang terjadi per tabel.

### Tabel `internal`

9 tabel, semuanya RLS aktif, **tanpa privilege tabel untuk `anon`/`authenticated`/`service_role`**: `account_deletions, evidence_reservation_requests, evidence_scan_jobs, import_jobs, operation_requests, pilot_participants, product_event_epoch, product_events, storage_jobs`.

### Fungsi (query `pg_proc`)

| Skema | Hasil |
| --- | --- |
| `public` | 115 fungsi. **Nol** dapat dieksekusi `anon`. 59 hanya `service_role`; 43 hanya `authenticated`; 9 keduanya; 4 `SECURITY INVOKER` (`authenticated` + `service_role`). Semua `SECURITY DEFINER` punya `search_path`. |
| `internal` | 108 fungsi. Semua `SECURITY DEFINER` punya `search_path`. |
| RPC `public` yang menerima ID record | sekitar 34 dari 56 RPC `authenticated`; daftar pasti dibaca dari katalog oleh test Fase 2 (mis. `delete_*`, `update_*`, `save_achievement`, `get_cv_export_download`, `cancel/retry/commit/validate_import_batch`, `retry_ai_job`, `retry_cv_export`, `update_import_item`, `relink_*`) |
| RPC worker `public` (hanya `service_role`) | 59 (`claim_*`, `complete_*`, `fail_*`, `advance_import_job`, dan sejenisnya) |

Catatan **O1 (P3)**: 13 fungsi `internal` dapat dieksekusi `anon` lewat default `PUBLIC` (helper murni seperti `is_valid_timezone`, `normalize_skill_name`, dan fungsi trigger). Skema `internal` **tidak** memberi `USAGE` ke `anon`, dan `internal` tidak diekspos PostgREST, jadi tidak dapat dicapai. Bukan pelanggaran aturan §1.3; dicatat sebagai risiko yang diterima.

### Storage

Satu bucket `workpulse-private`, `public = false`, `file_size_limit = 52428800`. Kunci objek `{owner_id}/{import|evidence|export}/{object_uuid}` (`src/server/storage/object-key.ts:8`). `authenticated` dan `anon` tidak punya privilege di `storage.objects`/`storage.buckets` (`20260917090000_t05_private_storage_foundation.sql:53`); seluruh akses objek lewat service role di server.

### Kolom status dan waktu untuk metrik §2.2.8 (diverifikasi terhadap migration nyata)

| Tabel | Status (check constraint) | Kolom waktu relevan |
| --- | --- | --- |
| `internal.account_deletions` | `queued, running, purged, completed` | `requested_at`, `lease_expires_at`, `completed_at` |
| `internal.storage_jobs` | `queued, running, succeeded, failed` | `created_at`, `finished_at`, `lease_expires_at` |
| `public.import_batches` | `queued, running, review, committed, failed, cancelled` | `expires_at`, `committed_at`, `failed_at`, `cancelled_at`, `purged_at` |
| `internal.import_jobs`, `internal.evidence_scan_jobs` | `queued, running, succeeded, failed, (cancelled)` | `lease_expires_at`, `finished_at` |
| `public.cv_exports` | `queued, running, succeeded, failed` | `finished_at`, `expires_at` (= `finished_at + 24 jam`), `purged_at`, `lease_expires_at` |
| `public.evidence_files` | `uploading, scanning, ready, failed, deleting` | `created_at`, `updated_at`, `reserved_until` |
| `public.ai_jobs` | `queued, running, succeeded, failed` | `finished_at`, `lease_expires_at` |

`get_account_deletion_backlog()` (`20261009090000_t23_account_deletion.sql`): `pending = count(status <> 'completed')`, `overdue = count(status <> 'completed' and requested_at <= clock_timestamp() - interval '24 hours')`. `account_deletion_overdue` memakai definisi yang sama dengan `p_now` sebagai pengganti `clock_timestamp()`.

**Semua delapan metrik dapat dihitung dari kolom yang ada**; tidak perlu kolom baru (stop condition §8 tidak terpicu). Definisi yang akan dipakai Fase 3:

- `import_purge_overdue`: `status in ('failed','cancelled','committed')`, `purged_at is null`, `coalesce(failed_at, cancelled_at, committed_at) <= p_now - 24 jam`.
- `export_purge_overdue`: `status = 'succeeded'`, `purged_at is null`, `finished_at <= p_now - 24 jam`.
- `storage_cleanup_overdue`: `storage_jobs.status in ('queued','running')` dan `created_at <= p_now - 24 jam`.
- `evidence_stuck`: `evidence_files.status in ('uploading','scanning')` dan `updated_at <= p_now - 1 jam`.
- `jobs_failed_24h`: `ai_jobs` + `cv_exports` dengan `status = 'failed'` dan `finished_at > p_now - 24 jam`, ditambah `import_batches` dengan `failed_at > p_now - 24 jam`.
- `jobs_expired_lease`: baris `status = 'running'` dengan `lease_expires_at <= p_now - 10 menit` di `ai_jobs`, `cv_exports`, `internal.import_jobs`, `internal.evidence_scan_jobs`, `internal.storage_jobs`, `internal.account_deletions`.

### Cakupan aksesibilitas yang ada

19 spec memakai `expectNoWcagViolations` atau viewport/tema: `account-deletion`, `m4-cv-journey`, `cv-freshness`, `cv-export`, `m2-manual-journey`, `cv-builder`, `m3-assisted-journey`, `import-review`, `import-onboarding`, `dashboard-timeline`, `ai-review`, `activity-ui`, `ai-consent`, `achievements-ui`, `evidence-ui`, `projects-ui`, `auth-profile`, `app-frame` (+ helper `helpers/accessibility.ts`). Matriks lintas semua layar × 360/1440 × light/dark belum ada sebagai satu suite; itu isi Fase 4.

### Token warna (`src/styles/tokens.css`)

Light (`:root`, `[data-theme="light"]`) dan dark (`[data-theme="dark"]`). Dark hanya menimpa token warna; spacing/typography diwarisi. Teks tersier light `#657168` pada kanvas `#f7faf6`, dan border kontrol light `#7b897e`, adalah pasangan dengan margin tipis yang harus diukur Fase 4.

## Temuan Fase 0

| ID | Prioritas | Temuan |
| --- | --- | --- |
| P-1 | — | Base drift; diselesaikan dengan merge (di atas). |
| O1 | P3 | 13 fungsi `internal` dapat dieksekusi `anon` via `PUBLIC` default; tidak dapat dicapai (tanpa `USAGE` skema). |
| O2 | P3 | `supabase_vector_WorkPulse` restart-loop; tidak berdampak pada suite. |
| O3 | P3 | Database lokal berisi 229 profil (kebocoran akun suite lama, T24 T6). `ops:check` Fase 3 mungkin melaporkan metrik non-nol dari data lama; dicatat apa adanya. |

## Acceptance Fase 0

- Baseline: terbukti, angka sesuai harapan plan setelah penyesuaian P-1.
- Inventaris route, tabel, fungsi, bucket, kolom status, token: terbukti.
- Persetujuan §2.4: tercatat. Staging: belum tersedia.
- Stop condition §8: satu terpicu (parity) dan diselesaikan atas keputusan pengguna.

## Langkah berikutnya

Fase 1: audit acceptance dan `T25-release-matrix.md` (tanpa edit kode), lalu checkpoint reviewer sebelum Fase 2.
