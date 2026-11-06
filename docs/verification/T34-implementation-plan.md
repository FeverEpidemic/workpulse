# Handoff T34 WorkPulse sebagai remote MCP server: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [x]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Fase 1 adalah spike yang kodenya dibuang dan berakhir dengan keputusan pemilik produk; jangan mulai Fase 2 sebelum itu. Langkah bertanda **[PEMILIK]** dikerjakan pemilik produk, bukan kamu: tulis instruksinya, berhenti, dan tunggu laporannya. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 6 November 2026
- Status saat plan ditulis: **TODO**.
- Dependensi: T03 (auth), T06 (activity), T09 (achievement), T11 (evidence), T23 (hapus akun), T24 (product events), T25 (guard release, `get_operational_health`), batas pemakaian AI (decision 0032) **DONE** di `main` (`f9a4681`). T33 sedang dikerjakan di worktree lain; lihat Fase 0 soal parity migration.
- Asal task: permintaan terarah pengguna. T34 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5 dan menambah permukaan baru di luar PRD v0.1 (akses pihak ketiga ke data karier). Pengguna memilih perubahan scope ini lewat interview 6 November 2026; decision 0044 mencatatnya.
- Spec yang mengikat: `docs/superpowers/specs/2026-11-06-mcp-server-design.md` (selanjutnya **Spec**). Bila plan dan Spec berbeda, plan ini yang dipakai (selisih yang disengaja ada di §2.2). Nomor fase plan berbeda dari Spec §10: Spec Fase 0 (spike) = plan Fase 1, Spec Fase 1 (skema) = plan Fase 2, Spec Fase 2 (endpoint) = plan Fase 3, Spec Fase 3 (consent dan S12) = plan Fase 4–5, Spec Fase 4 (staging) = plan Fase 6. Plan Fase 0 adalah baseline dan Fase 7 draft dokumen.
- Eksekutor: **Claude Sonnet 5.5**, satu agent, semua fase berurutan tanpa delegasi.
- Reviewer: **Claude Opus**. Gate review read-only wajib setelah Fase 5 (lokal) dan setelah Fase 6 (staging). Fase 7 (draft dokumen) setelah gate kedua.
- antislop: mode **during** (session override, dipilih pengguna 6 November 2026). Jangan tanya ulang soal mode. Baca `antislop`, `antislop-ui`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile` dari `.claude/skills/<nama>/SKILL.md`. Delivery Gate dijalankan di Fase 4 (copy dan UI) dan Fase 5.
- Acuan kode (dicek 6 November 2026; verifikasi ulang di Fase 0):
  - `supabase/config.toml:384-390` blok `[auth.oauth_server]` (`enabled = false`, `authorization_url_path = "/oauth/consent"`, `allow_dynamic_registration = false`).
  - `supabase/migrations/20260917160000_t06_activity_persistence.sql:105` constraint `capture_mode in ('note','form','chat')`, `:100` `raw_text` 1–10.000, `:610` `create_activity_idempotent` (memanggil `internal.create_activity`).
  - `supabase/migrations/20260922100000_t09_achievements_skills.sql:336` `create_achievement_idempotent`, `:151-160` batas field achievement; `supabase/migrations/20260922110000_t09_achievement_null_patch.sql:3` `save_achievement` versi terakhir.
  - `supabase/migrations/20260926100000_t11_evidence_lifecycle.sql:4` `list_evidence_files`; `supabase/migrations/20260927090000_t12_dashboard_timeline.sql:130` `list_demonstrated_skills`.
  - `supabase/migrations/20261009090000_t23_account_deletion.sql:140` `begin_account_deletion`, `:277` `purge_account_data`.
  - `supabase/migrations/20261011090000_t24_product_events.sql:93` `internal.product_events`, `:129` `internal.pilot_participants`, `:321` `set_pilot_participant`.
  - `supabase/migrations/20261012090000_t25_operational_health.sql:20` `get_operational_health`.
  - `supabase/migrations/20261018090000_ai_usage_limits.sql:61` `internal.ai_usage`, `:115` `add_ai_usage_unit`, `:142` `charge_ai_usage`.
  - `supabase/tests/database/release_catalog.test.sql` (guard release yang membaca katalog).
  - `src/server/supabase/server.ts:8` `createSupabaseServerClient`, `src/server/supabase/config.ts:97` pola flag server (`WORKPULSE_AUTH_GOOGLE_ENABLED`).
  - `src/server/auth/actions.ts:253` contoh `auth.getClaims()`.
  - `src/features/profile/profile-workspace.tsx:73-76` kartu S12 (`AiConsentCard`, `DeleteAccountCard`).
  - `src/i18n/messages.ts` (copy `id` memakai "Anda").

**Goal:** User pilot bisa menambahkan WorkPulse sebagai connector di claude.ai dan ChatGPT, login, memberi izin baca (dan opsional izin menambah), lalu dari chat meminta AI membaca data kariernya atau mencatat Activity dan draft Achievement. Token yang diberikan ke client tidak bisa membaca CV, kontak profil, isi file evidence, atau data akun lain, baik lewat `/api/mcp` maupun langsung ke API Supabase. Memutuskan aplikasi di S12 menghentikan akses pada request berikutnya.

**Architecture:** OAuth 2.1 server bawaan Supabase Auth (dynamic client registration, authorization code + PKCE) dengan halaman consent milik WorkPulse di `/oauth/consent`. Endpoint MCP `POST /api/mcp` adalah route handler Next.js (Streamable HTTP, stateless) yang memvalidasi JWT dan memanggil RPC `public.mcp_*` dengan token user. Database adalah otoritas: hook `db-pre-request` PostgREST menolak token ber-`client_id` di luar `/rpc/mcp_*`, policy restrictive di `storage.objects` menolak token itu, dan setiap `mcp_*` memanggil `internal.require_mcp_call` (grant, scope, akses pilot, rate limit). Tabel baru `public.mcp_grants`, `internal.mcp_access`, `internal.mcp_usage`, `internal.mcp_settings`. UI: kartu S12 "Aplikasi terhubung" dan label sumber di Activity/Achievement. Semua di balik flag `WORKPULSE_MCP_ENABLED`.

**Tech stack:** Next.js 16.3.5 App Router, React 19.3.0, TypeScript strict, Zod 4.6.5, `@supabase/supabase-js` 2.116.0 dan `@supabase/ssr` 0.12.7, Supabase CLI 2.117.0, Vitest (env `node`), pgTAP, Playwright + axe-core. **Satu dependency baru**: `@modelcontextprotocol/sdk`, versi exact (`save-exact=true`). Validasi JWT memakai `auth.getClaims` dari supabase-js; jangan menambah `jose` atau library JWT lain.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca Spec seluruhnya, `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, `docs/decisions/0029-t23-account-deletion-retention.md`, `docs/decisions/0030-t24-instrumentation-performance.md`, `docs/decisions/0032-*.md` (batas AI), file antislop di atas, lalu `docs/verification/T32-implementation-plan.md` dan `docs/verification/T32-phase5-e2e-regression.md` sebagai contoh gaya receipt.

Kutipan sumber yang mengikat (parafrase ringkas):

- **Spec §2 (keputusan interview):** WorkPulse jadi MCP server untuk claude.ai dan ChatGPT; baca dan tulis; tulis hanya Activity dan draft Achievement, confirm hanya di app; scope `career:read` (wajib) dan `career:write` (opsional); boleh dibaca: Activity, Achievement, Project, Experience, Education, Skill, metadata evidence; tidak boleh: isi CV dan wording, kontak profil, isi file evidence; di balik flag, staging dan akun pilot dulu.
- **Spec §3.1:** database yang menentukan. Token OAuth tidak boleh bisa membaca tabel, memanggil RPC app biasa, atau menyentuh Storage secara langsung.
- **Spec §4:** sepuluh tool, kontrak field output, pagination 30, `app_url`, deskripsi tool berbahasa Inggris.
- **Spec §8:** kartu S12, tanda sumber, copy consent en/id (draft; review copy di Fase 4).
- **Spec §14:** peran eksekutor/reviewer/pemilik, langkah yang tidak boleh kamu kerjakan, kondisi berhenti.
- **AGENTS.md:** identitas user dari session server, bukan payload; RLS dan ownership di database; error tidak membocorkan keberadaan record akun lain; tidak ada auto-confirm; jangan mencatat teks catatan, nama file, atau secret ke log; WCAG 2.2 AA, 360 dan 1440 px, light/dark.

Pertahankan perubahan lokal pengguna. Checkout utama `D:\Project\WorkPulse` punya `.claude/launch.json` dan `.claude/setting.local.json` yang belum di-commit; jangan di-commit. Kerjakan T34 di worktree terpisah dari `main` (Fase 0). Jangan push, jangan buka PR, jangan menandai T34 DONE, dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.

Pada akhir setiap fase, tulis **receipt** di `docs/verification/T34-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

### 0.1 Quirk lingkungan lokal (wajib dibaca)

Mesin ini Windows + PowerShell 5.1 + Docker Desktop. Hal-hal berikut sudah berkali-kali membuat test gagal palsu:

1. **Secret key.** `.env.local` tidak berisi `SUPABASE_SECRET_KEY`. Ambil `SERVICE_ROLE_KEY` (JWT legacy, bukan `sb_secret_…`) dari `pnpm exec supabase status -o env` dan set sebagai `$env:SUPABASE_SECRET_KEY` di proses yang sama dengan suite. Jangan pernah mencetak atau menyimpan nilainya. Output `db:status`/`db:start` memuat key lokal; selalu filter.
2. **Env tidak bertahan antar tool call.** Muat `.env.local` dan secret key di command yang sama dengan suite. Buat helper scratch `envload.ps1` (ASCII saja) lalu dot-source.
3. **Variabel harness.** Kosongkan `$env:AI_AGENT = $null; $env:ANTHROPIC_BASE_URL = $null` sebelum suite E2E (`m2-manual-journey.spec.ts` menolak env AI). Jangan melemahkan assertion itu.
4. **Pipeline.** Jangan pipe suite pnpm ke `Select-Object -First` (membunuh proses). Tangkap dengan `Out-String`, lalu filter.
5. **Encoding.** File `.ps1` tanpa BOM dibaca sebagai ANSI; jaga ASCII. `Get-Content -Raw` + `Set-Content` merusak karakter non-ASCII; edit file dengan tool Edit. Commit message dengan tanda kutip ganda: pakai `git commit -F <file>`.
6. **Stack Supabase dipakai bersama semua worktree.** Jalankan `pnpm db:start`/`db:stop` **hanya dari checkout utama**. Sebelum restart dari worktree, salin `supabase/.temp/{storage,postgres,gotrue,rest}-version` dan `storage-migration` dari checkout utama, atau upload gagal `42P10`. Cek `docker ps --format "{{.Names}} {{.Image}}"` memuat `storage-api:v1.80.2`. Jangan pernah `db:reset`.
7. **Config Auth.** Perubahan `supabase/config.toml` (OAuth server) baru berlaku setelah `pnpm db:stop` lalu `pnpm db:start` dari checkout utama. Restart dari checkout yang `config.toml`-nya berbeda mengubah Auth untuk semua sesi lain. Koordinasikan lewat §8.
8. **Container pendukung.** `test:e2e:release` butuh `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` (`docker start`). Setelah Docker restart, cek `docker ps` dulu.
9. **Screenshot terlacak.** Suite release/UI menulis ulang screenshot T25/T27/T30/T31; kembalikan dengan `git checkout` setelah run kecuali memang bukti T34.
10. **Worktree baru** butuh `pnpm install --frozen-lockfile` sendiri dan mengambil Google Fonts saat build (gagal offline). `pnpm lint` di checkout yang punya `.claude/worktrees/*/.next` bisa gagal; jalankan dengan `--ignore-pattern ".claude/**"` dan catat.
11. **Line ending.** `core.autocrlf=true` tanpa `.gitattributes`: perbandingan teks di test harus menormalkan `\r\n`.
12. **Hapus akun test** lewat `begin_account_deletion` + `runUntilCompleted` dari `tests/integration/account-deletion-support.ts`, bukan `admin.deleteUser` langsung.
13. **Sesi lain** bisa memakai port 3000, menjalankan worker panjang, atau commit di checkout bersama. Pakai port sendiri; jangan hentikan proses milik sesi lain tanpa tanya; commit hanya file milikmu, per path.
14. **Project hosted `Workpulse`** dipakai bersama oleh staging dan pilot `myworkpulse.my.id`. Web dan worker pilot berjalan di server privat yang tidak bisa kamu jangkau. Jangan menyentuh project hosted kecuali langkah itu tercantum di plan dan pemilik produk sudah menyetujuinya.

## 1. Acceptance inti T34

T34 lulus hanya jika setiap poin berikut dibuktikan dengan hasil nyata:

1. **Flag mati.** Dengan `WORKPULSE_MCP_ENABLED` tidak `true`, `POST /api/mcp`, `GET /.well-known/oauth-protected-resource`, dan `GET /oauth/consent` membalas 404; kartu S12 tidak dirender. Dibuktikan integrasi (route handler) dan E2E.
2. **Discovery.** Flag menyala: `POST /api/mcp` tanpa bearer membalas 401 dengan `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`; dokumen metadata memuat `resource`, `authorization_servers` (issuer Supabase Auth), `scopes_supported` (`career:read`, `career:write`), `bearer_methods_supported: ["header"]`. Dibuktikan integrasi.
3. **Token web ditolak.** JWT sesi web biasa (tanpa `client_id`) ke `/api/mcp` membalas 401, dan memanggil `rpc/mcp_whoami` langsung ditolak database. Dibuktikan integrasi.
4. **Token OAuth terkurung.** JWT ber-`client_id` milik akun dengan grant aktif ditolak saat dipakai langsung ke PostgREST untuk `select` tabel (`activities`, `cv_documents`, `profiles`), untuk RPC app biasa (`create_activity_idempotent`, `get_cv_freshness`), dan ke Storage (signed URL dan download objek evidence milik akun itu). Dibuktikan integrasi (pemanggilan HTTP nyata ke stack lokal) dan pgTAP (policy, hook terdaftar).
5. **Tool baca.** Dengan grant `career:read`, tujuh tool baca dan `whoami` mengembalikan field persis seperti Spec §4 (tidak lebih), pagination 30 dengan `next_cursor`, dan `app_url` absolut. `whoami` tidak memuat email. Field CV, wording override, dan kontak profil tidak pernah muncul, termasuk saat ada di data. Dibuktikan unit (serializer) dan integrasi.
6. **Scope.** Grant baca saja: `tools/list` tidak mencantumkan `create_activity`/`create_draft_achievement`, dan memanggilnya menghasilkan tool error `OUT_OF_SCOPE`. Dibuktikan integrasi dan pgTAP (`require_mcp_call('write')`).
7. **Tulis Activity.** `create_activity` membuat Activity dengan `capture_mode = 'mcp'` dan `source_grant_id` grant pemanggil; panjang di luar batas menghasilkan `INVALID_INPUT` dengan `field` dan `limit`; `request_id` yang sama dari client yang sama menghasilkan satu record; `request_id` sama dari client berbeda menghasilkan dua record. Dibuktikan pgTAP dan integrasi.
8. **Draft Achievement.** `create_draft_achievement` selalu menghasilkan `status = 'draft'` dengan field terisi dalam satu transaksi; kegagalan validasi di tengah (misalnya skill ke-21) tidak meninggalkan achievement apa pun; `activity_id` yang sudah punya derived achievement menghasilkan error yang sama dengan app (satu derived per activity). Tidak ada jalur MCP yang bisa confirm. Dibuktikan pgTAP dan integrasi.
9. **Isolasi.** Id milik akun B (activity, achievement, project, experience, evidence parent) yang dipakai akun A menghasilkan `NOT_FOUND` yang identik dengan id acak (isi dan bentuk respons). Dibuktikan integrasi dua akun.
10. **Pencabutan.** Setelah `revoke_mcp_grant`, request berikutnya dengan access token yang belum kedaluwarsa membalas 401. Connect ulang client yang sama memperbarui baris grant yang sama. Dibuktikan integrasi dan pgTAP.
11. **Hapus akun.** `begin_account_deletion` mencabut semua grant dalam transaksi yang sama; request MCP berikutnya 401; purge menghapus baris `mcp_grants` dan `mcp_usage`; `mcp_access` dibersihkan. Dibuktikan pgTAP dan integrasi lewat alur T23.
12. **Akses pilot.** Akun tanpa baris `internal.mcp_access` ditolak di `approve_mcp_grant` dan di `require_mcp_call`. Hanya service role yang bisa `set_mcp_access` dan `set_mcp_settings`. Dibuktikan pgTAP.
13. **Rate limit.** Melewati batas baca/tulis per grant atau tulis per akun menghasilkan `RATE_LIMITED` dengan `retry_after_seconds` > 0; nilai batas dibaca dari `internal.mcp_settings`; client tidak bisa mengirim nilai batas. Dibuktikan pgTAP dan integrasi.
14. **Consent.** Halaman `/oauth/consent`: belum login diarahkan ke sign-in lalu kembali; belum onboarding, non-pilot, dan host di luar allowlist menampilkan layar penjelasan tanpa tombol Izinkan; pilihan tulis tidak tercentang secara default dan tidak tampil bila client tidak memintanya; Izinkan menulis grant lalu approve ke Supabase; Tolak mengirim `access_denied`. Dibuktikan E2E (dengan Supabase OAuth server lokal) dan unit (keputusan layar).
15. **S12 dan label sumber.** Kartu "Aplikasi terhubung" sesuai Spec §8.1 (kosong + salin URL dengan live region, satu baris per grant aktif, dialog Putuskan dengan keyboard dan pengembalian fokus); label "Dari {name}" di list dan "Dari {name} · {host}" di detail; record MCP tanpa grant memakai "Dari aplikasi terhubung"; `{name}` dirender sebagai teks. Copy en/id dari copy deck yang disetujui di Fase 4. Dibuktikan E2E dan unit markup.
16. **Log dan event.** Log `/api/mcp` hanya memuat nama tool, kode hasil, durasi, `client_id`, jumlah item; sentinel teks privat di argumen dan hasil tidak muncul di log. Product event simpan activity dan pembuatan achievement dari MCP membawa `source = 'mcp'`; dari app `source = 'app'`. `get_operational_health()` memuat `mcp_rate_limited_last_hour`. Dibuktikan integrasi dan pgTAP.
17. **Guard release tetap lulus.** `release_catalog.test.sql` dan `test:integration:release` lulus tanpa pengecualian baru selain yang dicatat dengan alasan di receipt (misalnya fungsi `mcp_*` sebagai RPC ber-record-id baru yang wajib ikut diuji isolasi).
18. **Aksesibilitas dan responsif.** Consent dan kartu S12 tanpa pelanggaran axe WCAG 2.2 AA di 360 dan 1440 px, light dan dark, en dan id; target sentuh ≥ 44 px; masuk matriks `test:e2e:release`.
19. **Client asli (staging).** Akun pilot menyambungkan claude.ai dan ChatGPT ke staging, menjalankan `whoami`, satu tool baca, `create_activity`, lalu memutuskan di S12 dan melihat panggilan berikutnya gagal. Dibuktikan receipt Fase 6 dengan screenshot dari pemilik produk.
20. **Tidak ada regresi.** `pnpm test`, `pnpm db:test`, `test:e2e:release`, `test:e2e:auth`, `test:e2e:ui`, `test:integration:release`, `test:integration:account-deletion`, `test:integration:product-events`, `test:integration:activity`, `test:integration:achievements` lulus tanpa assertion dilemahkan. `pnpm test:perf` dijalankan sebelum dan sesudah hook pre-request; p95 tidak naik lebih dari 20% pada operasi mana pun.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration §3.1 (tabel, kolom, fungsi, hook, policy) dan pgTAP.
- `/.well-known/oauth-protected-resource`, `/api/mcp` dengan sepuluh tool.
- `/oauth/consent` (route dan UI), `approve_mcp_grant`, `revoke_mcp_grant`.
- Kartu S12 "Aplikasi terhubung", label sumber di list dan detail Activity/Achievement.
- Copy en/id (`mcp.*`, `connectedApps.*`, `consent.*`, `source.*`).
- Flag `WORKPULSE_MCP_ENABLED` dan `.env.example`.
- Suite baru `test:integration:mcp` dan `test:e2e:mcp`.
- Spike Fase 1 (dibuang) dan smoke staging Fase 6 (dikerjakan pemilik produk).
- Decision 0044, verification doc, README, runbook operator.

### 2.2 Keputusan implementasi

1. **Satu-satunya pintu.** Endpoint tidak pernah memanggil RPC app biasa atau tabel. Setiap tool memanggil tepat satu RPC `public.mcp_*`. Fungsi `mcp_*` memanggil fungsi `internal.*` yang sudah dipakai RPC app (misalnya `internal.create_activity`), tidak menyalin logikanya. Bila logika yang dibutuhkan hanya ada di dalam RPC `public.*` dan tidak di `internal.*`, ekstrak ke `internal.*` dalam migration yang sama tanpa mengubah perilaku RPC lama (dibuktikan suite lama). Alasan: Spec §3.1.
2. **Hook pre-request.** `internal.reject_oauth_outside_mcp()` didaftarkan sebagai `pgrst.db_pre_request` untuk role `authenticator` lewat migration (`alter role authenticator set pgrst.db_pre_request = 'internal.reject_oauth_outside_mcp'` diikuti `notify pgrst, 'reload config'`). Isinya: bila `internal.is_oauth_token()` dan `current_setting('request.path', true)` tidak diawali `/rpc/mcp_`, raise `42501` dengan pesan `MCP_TOKEN_SCOPE`. Fungsi harus murah (tanpa query tabel). Bila hook tidak bisa didaftarkan dengan cara ini di lokal, **stop** (§8). Alasan: Spec §3.1, risiko terbesar T34.
3. **Storage.** Policy `as restrictive` untuk `select, insert, update, delete` di `storage.objects`, role `authenticated`, `using/with check (not internal.is_oauth_token())`. Policy lama tidak diubah. pgTAP memastikan publikasi `supabase_realtime` tidak berisi tabel.
4. **Operation key di database.** Berbeda dari Spec §4.3 (uuid v5 di kode): `operation_key` diturunkan di dalam `mcp_create_activity`/`mcp_create_draft_achievement` dari `extensions.digest(client_id || ':' || p_request_id, 'sha256')` dipotong menjadi uuid (versi/variant di-set). `client_id` diambil dari `auth.jwt()`, bukan parameter. Tanpa `p_request_id`, pakai `gen_random_uuid()`. Alasan: client tidak bisa memalsukan key client lain, dan tidak ada konstanta di kode yang harus dijaga.
5. **Draft atomik.** `mcp_create_draft_achievement` memanggil jalur `create_achievement_idempotent` lalu `save_achievement` (aksi simpan draft) di dalam satu fungsi, sehingga satu transaksi. Status selalu `draft`; fungsi tidak menerima status. Bila `save_achievement` tidak bisa dipanggil dari fungsi lain tanpa mengubah perilakunya, ekstrak bagian yang dibutuhkan ke `internal.*` (keputusan 1).
6. **Grant dan scope di tabel kita.** Scope tidak bergantung pada scope Supabase. `approve_mcp_grant` dipanggil server consent dengan sesi web user (token tanpa `client_id`; fungsi menolak token ber-`client_id`). Nilai `client_name` dibersihkan (karakter kontrol dibuang, dipotong 120). `client_host` adalah host redirect URI dari detail otorisasi Supabase dan harus ada di allowlist `internal.mcp_settings`.
7. **`require_mcp_call(p_tool_class)`.** Urutan cek: token punya `client_id` → profil ada dan bukan `deleting` → baris `mcp_access` → grant aktif `(auth.uid(), client_id)` → scope cocok (`identity` dan `read` butuh `career:read`, `write` butuh `career:write`) → tagih rate limit → update `last_used_at` bila lebih lama dari 5 menit. Error memakai `errcode` `P0001` dengan pesan `MCP_NO_GRANT`, `MCP_OUT_OF_SCOPE`, atau `MCP_RATE_LIMITED` (detik retry di `detail`). Profil `deleting` memakai `MCP_NO_GRANT` agar endpoint menjawab 401.
8. **Rate limit.** `internal.mcp_usage(scope_kind, scope_id, window_kind, window_start, count)` dengan upsert atomik (`insert … on conflict … do update … returning count`), pola `charge_ai_usage`. Window: menit untuk baca, jam untuk tulis per grant, hari UTC untuk tulis per akun. Panggilan `identity` (`whoami`, dipakai `tools/list`) dihitung sebagai baca.
9. **Settings.** `internal.mcp_settings` satu baris (`id boolean primary key default true check (id)`), kolom `redirect_hosts text[]` (default `{claude.ai,chatgpt.com}`), `read_per_minute 120`, `write_per_hour 30`, `write_per_day 100`. `set_mcp_settings` service role saja, memvalidasi host (huruf kecil, tanpa skema, tanpa path) dan angka > 0.
10. **Akses pilot terpisah.** `internal.mcp_access` tidak memakai `internal.pilot_participants`. Alasan: enroll metrik dan akses fitur adalah dua persetujuan berbeda (Spec §5.1).
11. **Sumber.** `source_grant_id uuid null references public.mcp_grants(id) on delete set null` di `activities` dan `achievements`. Hanya `mcp_*` yang mengisinya; RPC app lama tidak berubah. Read model list/detail app ikut membaca `client_name`/`client_host` lewat join yang dibatasi RLS milik sendiri.
12. **Product events.** Tambah properti `source` (`app`/`mcp`) di trigger event simpan activity dan pembuatan achievement, diturunkan dari `capture_mode = 'mcp'` atau `source_grant_id is not null`. Allowlist properti T24 diperluas; tidak ada teks atau id.
13. **Endpoint.** `src/app/api/mcp/route.ts` mengekspor `POST` (dan `GET`/`DELETE` yang membalas 405 dalam mode stateless). Transport `StreamableHTTPServerTransport` dari `@modelcontextprotocol/sdk` dengan `sessionIdGenerator: undefined` dan respons JSON (`enableJsonResponse: true`). Server MCP dibuat per request. Validasi token: `createClient(url, publishableKey, { global: { headers: { Authorization: "Bearer …" } } })` lalu `auth.getClaims(token)`; tolak bila error, tanpa `client_id`, atau `iss` tidak cocok. Klaim `aud` dicek sesuai temuan Fase 1. Supabase client yang sama dipakai untuk RPC `mcp_*`, sehingga RLS dan `auth.uid()` berlaku.
14. **Pemetaan error.** Satu fungsi murni `mapMcpDbError(error)` → `{ kind: "http401" } | { kind: "tool", code, message, data }` yang diuji unit. Pesan tool berbahasa Inggris, satu kalimat, dari Spec §7. `NOT_FOUND` dipakai untuk "tidak ada" dan "milik akun lain" dengan pesan yang sama.
15. **Serializer allowlist.** Tiap tool punya skema output Zod yang `strict()`; RPC mengembalikan `jsonb` yang sudah dibentuk, dan endpoint mem-parse dengan skema itu sebelum mengirim. Field asing membuat test gagal, bukan diteruskan diam-diam.
16. **Consent server.** `src/app/oauth/consent/page.tsx` (Server Component) membaca `authorization_id`, memakai API OAuth server supabase-js (nama method diverifikasi di Fase 1 dan dicatat di receipt) untuk mengambil detail, approve, dan deny. Action approve: `approve_mcp_grant` dulu, lalu approve ke Supabase, lalu redirect ke URL yang dikembalikan Supabase. Tidak pernah redirect ke URL dari query string.
17. **Pencabutan di Supabase.** Bila Fase 1 menemukan API revoke otorisasi/refresh token per user+client, `revoke_mcp_grant` diikuti panggilan itu dari server action. Bila tidak ada, catat keterbatasan di decision; perilaku 401 tetap dijamin `require_mcp_call`.
18. **Flag.** `isMcpEnabled()` di `src/server/supabase/config.ts` mengikuti pola `:97`. Lokal dan CI: `[auth.oauth_server] enabled = true` dan `allow_dynamic_registration = true` di `supabase/config.toml` (stack lokal saja); flag web tetap default `false` dan dinyalakan per suite. Hosted: tidak diubah oleh migration; Fase 6.
19. **Copy.** Copy deck `docs/verification/T34-copy-deck.md` (en/id berdampingan) dari Spec §8 ditulis dan direview antislop-copywriting di Fase 4, lalu disetujui pengguna sebelum masuk `messages.ts`. `id` memakai "Anda".
20. **Nomor.** Decision memakai nomor bebas berikutnya saat Fase 7 (0043 terakhir di `main`, perkiraan **0044**). Migration memakai timestamp setelah migration terakhir di `main` **dan** di branch T33 bila sudah ada (lihat Fase 0).

### 2.3 Di luar scope

- Edit, hapus, atau confirm record lewat MCP; semua tool CV; upload/download isi evidence.
- Memicu analisis AI internal dari MCP.
- Pencarian full-text, MCP resources, MCP prompts, notifikasi server-ke-client.
- Client lokal stdio dan personal access token.
- Editor scope di S12 (ganti izin = putuskan lalu sambung ulang).
- Menyalakan MCP di production (menunggu blocker T25).
- Pendekatan B (OAuth server sendiri): hanya bila pemilik produk memutuskannya setelah Fase 1, sebagai plan baru.

## 3. Kontrak teknis

### 3.1 Migration (satu file, Fase 2)

- `public.mcp_grants` (Spec §5.1) dengan unique `(user_id, client_id)`, RLS select-own, tanpa grant tulis untuk `anon`/`authenticated`, trigger `zz_guard_account_writable`.
- `internal.mcp_access`, `internal.mcp_usage`, `internal.mcp_settings` (§2.2.8–10).
- `activities.capture_mode` constraint diperluas dengan `'mcp'`; `source_grant_id` di `activities` dan `achievements`.
- Fungsi `internal.is_oauth_token`, `internal.reject_oauth_outside_mcp`, `internal.require_mcp_call`; RPC `public.mcp_whoami`, `mcp_list_activities`, `mcp_get_activity`, `mcp_list_achievements`, `mcp_get_achievement`, `mcp_list_career_context`, `mcp_list_skills`, `mcp_list_evidence`, `mcp_create_activity`, `mcp_create_draft_achievement`, `approve_mcp_grant`, `revoke_mcp_grant`, `set_mcp_access`, `set_mcp_settings`. Semua `security definer`, `set search_path = pg_catalog`, `revoke all … from public, anon` lalu grant eksplisit.
- Hook pre-request (§2.2.2), policy storage (§2.2.3).
- `begin_account_deletion`: tambah `update public.mcp_grants set revoked_at = now() where user_id = p_user_id and revoked_at is null`. `purge_account_data`: hapus `mcp_usage`, `mcp_grants`, `mcp_access` milik akun pada posisi yang benar (sebelum profil tombstone, setelah tabel yang mereferensikan grant). Ubah lewat `create or replace` dari versi terakhir fungsi itu (cek migration terbaru yang mendefinisikannya di Fase 0).
- Trigger product event: properti `source` (§2.2.12).
- `get_operational_health`: hitungan `mcp_rate_limited_last_hour` dari `mcp_usage` (window yang melewati batas). Ambangnya `WORKPULSE_ALERT_MCP_RATE_LIMITED` di `workers/ops-check.ts`, mengikuti pola ambang `WORKPULSE_ALERT_*` yang ada di sana, dan ditambahkan ke `.env.example`.

### 3.2 Server dan domain

- `src/domain/mcp/`: `tool-classes.ts` (nama tool → kelas), `errors.ts` (`mapMcpDbError`), `output-schemas.ts` (skema Zod strict per tool), `input-schemas.ts` (batas dari constraint DB).
- `src/server/mcp/`: `auth.ts` (bearer → claims → client Supabase), `server.ts` (registrasi tool), `log.ts` (log satu baris dengan allowlist), `metadata.ts` (dokumen protected resource).
- `src/server/supabase/config.ts`: `isMcpEnabled()`.
- `src/app/api/mcp/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`.
- `src/app/oauth/consent/page.tsx` dan `actions.ts`; `src/domain/mcp/consent-screen.ts` (fungsi murni: data otorisasi + profil + akses + allowlist → layar).

### 3.3 UI

- `src/features/connected-apps/`: `connected-apps-card.tsx` (Server Component pembungkus) dan `connected-apps-client.tsx` (salin, dialog Putuskan), `actions.ts` (`revokeConnectedApp`).
- `src/features/profile/profile-workspace.tsx`: kartu baru setelah `AiConsentCard` bila flag menyala dan akun punya akses.
- `src/features/activity/*` dan `src/features/achievement/*`: label sumber di row list dan header detail (komponen kecil `SourceLabel` bersama di `src/components/ui/`).
- `src/features/oauth-consent/`: komponen layar consent (form Izinkan/Tolak, layar penjelasan).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/<timestamp>_t34_mcp_server.sql`, `supabase/tests/database/mcp.test.sql` |
| Modify | `supabase/config.toml` (`[auth.oauth_server]` lokal), `supabase/tests/database/release_catalog.test.sql` (hanya bila perlu, dengan alasan), `src/server/supabase/database.types.ts` (`pnpm db:types`) |
| Create | `src/domain/mcp/*`, `src/server/mcp/*`, `src/app/api/mcp/route.ts`, `src/app/.well-known/oauth-protected-resource/route.ts`, `src/app/oauth/consent/{page,actions}.tsx`, `src/features/connected-apps/*`, `src/features/oauth-consent/*`, `src/components/ui/source-label.tsx` |
| Modify | `workers/ops-check.ts`, `src/server/supabase/config.ts`, `src/features/profile/profile-workspace.tsx`, read model dan row/detail Activity dan Achievement, `src/i18n/messages.ts`, `src/proxy.ts` (hanya bila `/oauth/consent` perlu refresh sesi), `.env.example`, `package.json` (dependency SDK, dua script baru), `pnpm-lock.yaml`, `playwright.release.config.ts` |
| Create | `tests/unit/mcp-{errors,output-schemas,input-schemas,consent-screen,log,source-label,connected-apps-markup}.test.ts`, `tests/integration/mcp.test.ts`, `tests/integration/mcp-support.ts` (mint token, fixture), `tests/e2e/mcp.spec.ts`, `playwright.mcp.config.ts` |
| Create | `docs/verification/T34-phase{0..6}-*.md`, `docs/verification/T34-copy-deck.md`, `docs/verification/T34-screenshots/`, `docs/verification/T34-mcp-runbook.md` (operator: enroll, settings, cabut), `docs/verification/T34-mcp-server.md`, `docs/decisions/0044-t34-mcp-server.md` (nomor dicek di Fase 7) |
| Modify | `README.md` (Fase 7) |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] Worktree baru dari `origin/main` (`f9a4681` atau lebih baru), sebaiknya `claude/t34-mcp`. `git status` bersih. Gabungkan commit spec dan plan ini dari `claude/t34-mcp-spec` bila belum ada di `main` (cherry-pick dua commit docs, tanpa konflik).
- [ ] `pnpm install --frozen-lockfile` di worktree.
- [ ] Parity migration lokal. Harapan di `main`: **38** file, terakhir `20261019090000_t26_import_rules_extraction.sql`. Cek juga branch `claude/t33-cv-multi-select` (`git log origin/main..claude/t33-cv-multi-select -- supabase/migrations` dan migration yang sudah diterapkan di stack bersama lewat `pnpm exec supabase migration list --local`). Catat timestamp tertinggi; migration T34 harus lebih besar dari semuanya.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm db:lint`, `pnpm worker:check`. Harapan kasar: unit sekitar **163 file / 1558 test** (closeout T32, bisa lebih karena commit setelahnya), pgTAP **≥ 21 file**. Catat angka aktual sebagai baseline.
- [ ] `pnpm test:e2e:release` (harapan sekitar **80**: 79 lulus + 1 skip video) dan `pnpm test:integration:release`; catat angka.
- [ ] `pnpm test:perf` sendirian, simpan hasil ke `docs/verification/T34-perf-before.json` (`WORKPULSE_PERF_OUT`).
- [ ] Inventaris: versi terakhir `purge_account_data`, `begin_account_deletion`, `save_achievement`, `get_operational_health`, dan trigger event activity/achievement (migration mana yang terakhir mendefinisikannya); nama kolom experience/education/project untuk `list_career_context`; tempat read model list/detail Activity dan Achievement; tipe TS `capture_mode` di `src/`.
- [ ] Cek apakah stack lokal sudah bisa menyalakan OAuth server: baca dokumentasi Supabase CLI 2.117 soal `[auth.oauth_server]` dan `pgrst.db_pre_request` (tanpa mengubah config). Catat sumbernya.
- [ ] Verifikasi rujukan file:baris di bagian metadata; selisih dicatat.
- [ ] Receipt `T34-phase0-baseline.md`, commit.

### Fase 1: Spike OAuth dengan client asli (kode dibuang)

Tujuan: menjawab Spec §10.1 sebelum ada kode produk. Kode spike tinggal di branch `claude/t34-spike` yang tidak pernah di-merge.

**Lingkungan (diputuskan pemilik produk 6 November 2026): Supabase lokal di belakang satu tunnel HTTPS.** claude.ai dan ChatGPT harus menjangkau endpoint MCP dan Supabase Auth lewat HTTPS publik, dan Supabase mengarahkan consent ke `site_url + authorization_url_path`. Project hosted `Workpulse` (staging sekaligus pilot) **tidak disentuh** di fase ini.

Susunannya satu tunnel ke Next dev server spike. Next yang meneruskan Auth ke stack lokal:

```
internet ──HTTPS──> tunnel ──> Next spike (127.0.0.1:<port>)
                                 ├─ /api/mcp, /.well-known/oauth-protected-resource, /oauth/consent
                                 └─ /auth/v1/*  ──proxy──> 127.0.0.1:54321/auth/v1/*  (kecuali /auth/v1/admin/*)
```

Alasan hanya `/auth/v1` yang diteruskan: kunci default stack lokal (termasuk `service_role` legacy) adalah nilai demo yang publik. Kalau Kong 54321 dibuka utuh ke internet, siapa pun yang tahu URL tunnel bisa membaca seluruh database lokal. Proxy spike **wajib** menolak `/auth/v1/admin/*`, `/rest/v1/*`, `/storage/v1/*`, `/realtime/*`, dan semua path lain dengan 404. Studio (54323) dan Mailpit (54324) tidak pernah di-tunnel.

- [ ] **Koordinasi stack bersama.** Fase ini me-restart stack lokal dua kali dengan `config.toml` berbeda, dan ini mengubah Auth untuk semua sesi lain (§0.1 nomor 6–7). Sebelum mulai, tulis di receipt sesi/worktree lain yang terlihat aktif (`git worktree list`, proses `next`/`workers/run.ts`, `docker ps`), lalu **stop** dan minta pemilik produk memastikan tidak ada sesi lain (termasuk T33) yang memakai stack selama spike.
- [ ] Branch `claude/t34-spike` di worktree sendiri. Salin lima file pin dari checkout utama (`supabase/.temp/{storage,postgres,gotrue,rest}-version`, `storage-migration`; **bukan** `project-ref`/`linked-project.json`) supaya restart dari worktree ini tidak memicu `42P10`.
- [ ] **[PEMILIK]** jalankan quick tunnel ke port Next spike, misalnya `cloudflared tunnel --url http://127.0.0.1:<port>`, lalu tempel URL `https://<acak>.trycloudflare.com` di chat. URL ini berubah setiap tunnel dijalankan ulang, jadi tunnel dibiarkan hidup sampai spike selesai.
- [ ] Di `config.toml` worktree spike saja (tidak pernah di-commit ke `claude/t34-mcp` atau `main`):
  - `[auth] site_url = "<tunnel>"`
  - `external_url = "<tunnel>/auth/v1"`
  - `additional_redirect_urls` ditambah `<tunnel>/auth/confirm`
  - `[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true`

  Biarkan `jwt_issuer` mengikuti `external_url`. Lalu `pnpm db:stop` + `pnpm db:start` dari worktree spike (tanpa reset). Cek `docker ps` memuat `storage-api:v1.80.2`.
- [ ] Spike Next (`WORKPULSE_SITE_URL=<tunnel>`):
  - route proxy `/auth/v1/[...path]` dengan allowlist di atas, meneruskan method, header, dan body apa adanya, termasuk header `Location`, yang ditulis ulang dari `127.0.0.1:54321` ke URL tunnel bila ada;
  - `/.well-known/oauth-protected-resource` dengan `authorization_servers: ["<tunnel>/auth/v1"]`;
  - `/api/mcp` minimal dengan satu tool `whoami` (dari claims saja);
  - `/oauth/consent` seadanya (Izinkan/Tolak memakai API OAuth server supabase-js).

  Uji sendiri dulu dengan `curl` lewat URL tunnel: metadata authorization server Supabase terbaca, issuer di dalamnya = `<tunnel>/auth/v1`, dan `/auth/v1/admin/users`, `/rest/v1/profiles` membalas 404.
- [ ] **[PEMILIK]** buat satu akun test di app spike lewat URL tunnel (email konfirmasi tertangkap Mailpit lokal), selesaikan onboarding, lalu tambahkan connector di claude.ai dan ChatGPT ke `<tunnel>/api/mcp`, login, consent, dan jalankan `whoami`. Kirim screenshot dan pesan error bila ada.
- [ ] Rekam di receipt jawaban Spec §10.1:
  - nomor 1: alur DCR tiap client;
  - nomor 2: isi claim (`client_id`, `aud`, `role`, `iss`);
  - nomor 3, bagian lokal: apakah token itu diterima langsung oleh PostgREST dan Storage lokal (`select` satu tabel dan signed URL, dari mesin lokal, bukan lewat tunnel), dan apakah `auth.uid()` bekerja;
  - nomor 4: method supabase-js untuk revoke;
  - nomor 5: method supabase-js untuk detail, approve, dan deny;
  - nomor 6: redirect URI tiap client;
  - nomor 7: perlakuan scope custom.

  Bagian hosted nomor 3 (apakah `pgrst.db_pre_request` bisa diset di hosted Supabase) tidak bisa dijawab di sini; itu langkah pertama Fase 6.
- [ ] **Bongkar.**
  - **[PEMILIK]** hentikan tunnel.
  - `pnpm db:stop` dari worktree spike, lalu `pnpm db:start` dari checkout utama, supaya Auth kembali ke `config.toml` utama.
  - Cek `site_url` aktif kembali `http://127.0.0.1:3000` lewat `GET 127.0.0.1:54321/auth/v1/settings` atau `pnpm test:e2e:auth`.
  - Hapus akun test spike lewat alur T23.
  - Catat semuanya di receipt.
- [ ] Receipt `T34-phase1-spike.md`, commit di branch spike saja (receipt di-cherry-pick ke `claude/t34-mcp`). **Stop: pemilik produk memutuskan lanjut dengan pendekatan A atau pindah ke B.** Bila nomor 1 atau 5 gagal, rekomendasikan B dengan alasan, tapi jangan mulai B. Token yang diterima langsung oleh PostgREST dan Storage (nomor 3) bukan kegagalan; itu justru alasan §2.2.2–3 ada, dan dibuktikan tertutup di Fase 2–3.

### Fase 2: Database (TDD pgTAP)

- [ ] `supabase/config.toml`: `[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true`. **Stop sebentar** sebelum restart stack: restart dari checkout utama mengubah Auth untuk sesi lain; tulis di receipt kapan dan dari mana restart dilakukan (§0.1 nomor 6–7).
- [ ] Test gagal `mcp.test.sql` untuk: RLS `mcp_grants` dua akun; `approve_mcp_grant` (non-pilot ditolak, host di luar allowlist ditolak, token ber-`client_id` ditolak, connect ulang memperbarui baris yang sama, `client_name` dibersihkan); `require_mcp_call` (semua cabang §2.2.7); rate limit tiga jenis window; `mcp_create_activity` (`capture_mode`, `source_grant_id`, idempotensi per client, batas panjang); `mcp_create_draft_achievement` (selalu draft, atomik, satu derived per activity); setiap `mcp_*` read mengembalikan kunci JSON persis Spec §4; id akun lain dijawab sama dengan id acak; `revoke_mcp_grant`; `begin_account_deletion` mencabut grant; purge menghapus baris MCP; `set_mcp_access`/`set_mcp_settings` hanya service role; hook pre-request terdaftar di `authenticator`; policy restrictive storage ada; publikasi realtime kosong; setiap fungsi `public.mcp_*` memanggil `require_mcp_call` (baca `pg_proc.prosrc`); product event `source`.
- [ ] Jalankan, lihat gagal. Tulis migration §3.1. `pnpm db:test` lulus termasuk semua suite lama tanpa perubahan assertion; `pnpm db:lint` exit 0; `pnpm db:types`.
- [ ] `release_catalog.test.sql` lulus. Bila gagal karena objek baru, perbaiki objeknya; ubah test hanya bila aturannya memang perlu daftar baru (misalnya fungsi ber-record-id), dengan alasan di receipt.
- [ ] `pnpm test:integration:release`, `test:integration:account-deletion`, `test:integration:product-events`, `test:integration:activity`, `test:integration:achievements` lulus.
- [ ] Receipt `T34-phase2-database.md`, commit.

### Fase 3: Endpoint MCP (TDD unit dan integrasi)

- [ ] Tambah `@modelcontextprotocol/sdk` versi exact terbaru yang stabil; catat versi dan alasan di receipt. Script baru di `package.json`: `test:integration:mcp` (pola script integrasi lain) dan `test:e2e:mcp` (Fase 5).
- [ ] Test unit gagal: `mcp-errors` (semua kode DB → hasil), `mcp-output-schemas` (strict, field CV/wording/kontak ditolak), `mcp-input-schemas` (batas sama dengan constraint DB), `mcp-log` (hanya field allowlist, sentinel tidak lolos), daftar tool per scope.
- [ ] Implementasi `src/domain/mcp/*` sampai unit lulus.
- [ ] `tests/integration/mcp-support.ts`: mint JWT bertanda tangan stack lokal dengan claim `client_id` untuk akun test (cara mint dicatat; JWT secret/kunci lokal dibaca dari `supabase status -o env` di proses, tidak pernah dicetak), fixture dua akun dengan data di semua tabel yang dibaca, satu objek evidence nyata.
- [ ] Test integrasi gagal untuk acceptance 1–13 dan 16 (lewat HTTP ke `next start` pada port sendiri dengan flag menyala, memakai client MCP dari SDK), termasuk pemanggilan langsung PostgREST dan Storage dengan token OAuth (acceptance 4).
- [ ] Implementasi `src/server/mcp/*`, route handler, dan dokumen metadata sampai lulus.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` lulus.
- [ ] Receipt `T34-phase3-endpoint.md`, commit.

### Fase 4: Copy, consent, S12, label sumber (TDD unit)

- [ ] Tulis `docs/verification/T34-copy-deck.md` dari Spec §8 (en/id berdampingan), termasuk deskripsi tool berbahasa Inggris dan pesan tool error. Jalankan Delivery Gate `antislop-copywriting` dengan PASS/FAIL dan bukti. **Stop: minta pengguna menyetujui copy deck.** Catat revisi; langkah berikutnya memakai versi yang disetujui.
- [ ] Copy ke `messages.ts` (paritas key en/id dicek test dictionary yang ada).
- [ ] Test unit gagal: `mcp-consent-screen` (semua layar §1 acceptance 14 dari input murni), `connected-apps-markup` (kosong, baris, label izin, tanpa HTML dari `client_name`), `source-label` (tiga varian).
- [ ] Implementasi `/oauth/consent`, kartu S12, `SourceLabel` di list dan detail, action `revokeConnectedApp` (+ revoke Supabase bila tersedia, §2.2.17).
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T34-phase4-ui.md`, commit.

### Fase 5: E2E, regresi, aksesibilitas, Delivery Gate

- [ ] `playwright.mcp.config.ts` (port sendiri, flag menyala) dan `tests/e2e/mcp.spec.ts`: consent end-to-end dengan Supabase OAuth server lokal (client didaftarkan lewat endpoint DCR lokal dari test, lalu alur authorize di browser sampai redirect ke callback stub), semua layar acceptance 14, kartu S12 dengan keyboard, label sumber, 360/1440 light/dark en/id dengan axe. Spec juga ditambahkan ke `testMatch` `playwright.release.config.ts`. Bila alur authorize lokal tidak bisa dijalankan di Playwright, **stop** (§8) sebelum menggantinya dengan mock.
- [ ] Screenshot `docs/verification/T34-screenshots/`: consent (izin baca+tulis, non-pilot, host ditolak) dan kartu S12 (kosong, dua baris, dialog) di 360 dan 1440, light dan dark, id dan en untuk consent utama.
- [ ] `pnpm build`, `pnpm test`, `pnpm db:test`, `pnpm test:integration:mcp`, `pnpm test:e2e:mcp`, dan semua suite acceptance 20; catat angka. Kembalikan screenshot lama yang tertulis ulang.
- [ ] `pnpm test:perf` sendirian ke `docs/verification/T34-perf-after.json`; bandingkan dengan Fase 0 di receipt (acceptance 20).
- [ ] Klik-tembus manual di dev server (360 dan 1440): consent dari awal sampai redirect, kartu S12 salin dan putuskan, label sumber di list dan detail.
- [ ] Delivery Gate antislop (core, `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting`) dengan PASS/FAIL dan bukti.
- [ ] Receipt `T34-phase5-e2e-regression.md`, commit. **Stop: gate review Claude (lokal).**

### Fase 6: Staging dengan client asli (setelah gate lokal lulus)

Project hosted `Workpulse` adalah staging sekaligus pilot. Semua langkah hosted dikerjakan atau disetujui pemilik produk. Ini pertama kalinya T34 menyentuh hosted, karena Fase 1 memakai stack lokal.

- [ ] **Cek hosted sebelum deploy (sisa Spec §10.1 nomor 3).** Tulis instruksi untuk **[PEMILIK]**: di SQL editor hosted, jalankan `select rolname, rolconfig from pg_roles where rolname = 'authenticator'` dan coba `alter role authenticator set pgrst.db_pre_request = 'internal.reject_oauth_outside_mcp'` pada fungsi dummy yang selalu lolos, lalu `notify pgrst, 'reload config'`, lalu kembalikan. Juga konfirmasi dashboard menyediakan OAuth server dan DCR. Bila hook tidak bisa diset di hosted, **stop**: T34 tidak boleh dinyalakan di hosted tanpa §2.2.2.
- [ ] Tulis `docs/verification/T34-mcp-runbook.md`: urutan deploy (migration lewat alur T25, bukan `apply_migration` dari connector), menyalakan `[auth.oauth_server]` dan DCR di dashboard hosted dengan `authorization_url_path = /oauth/consent`, set `WORKPULSE_MCP_ENABLED=true` di web pilot, enroll akun (`set_mcp_access`), isi allowlist (`set_mcp_settings`) dengan host dari Fase 1, cara mencabut semua grant darurat, dan cara mematikan (flag mati + OAuth server mati).
- [ ] **[PEMILIK]** jalankan runbook di staging/pilot dengan satu akun pilot.
- [ ] **[PEMILIK]** dari claude.ai dan ChatGPT: connect, `whoami`, `list_achievements`, `create_activity` dengan `request_id`, lihat label sumber di app, putuskan di S12, panggil tool lagi (harus gagal minta login). Kirim screenshot tiap langkah.
- [ ] Kamu memverifikasi lewat connector Supabase hanya hitungan (jumlah grant, jumlah activity `capture_mode = 'mcp'` untuk akun itu), tanpa membaca isi, dan hanya bila pemilik produk mengizinkan di chat.
- [ ] Receipt `T34-phase6-staging.md` dengan screenshot dan hal yang tidak terbukti. **Stop: gate review Claude (staging).**

### Fase 7: Draft dokumen (setelah gate kedua lulus)

- [ ] Draft decision `0044-t34-mcp-server.md` (nomor dicek): perubahan scope oleh pengguna, pendekatan A dan temuan Fase 1, penegakan di database (§2.2.1–3), grant di tabel sendiri, akses pilot terpisah, operation key di DB, rate limit, keterbatasan pencabutan refresh token bila ada.
- [ ] `docs/verification/T34-mcp-server.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] `README.md`: paragraf T34 dan dua script baru di tabel quality gates.
- [ ] Commit.

## 6. Fixture

- Akun A (pilot, onboarding selesai, data di semua tabel yang dibaca plus satu evidence `ready` dan baris CV dengan wording override serta kontak profil terisi sebagai sentinel), akun B (pilot, data sendiri), akun C (bukan pilot), akun D (provisional/belum onboarding). Semua dibuat dan dihapus oleh suite lewat alur T23.
- Sentinel privat: string unik di `raw_text` activity, wording override CV, dan telepon profil. Test memastikan sentinel CV dan kontak tidak pernah muncul di hasil tool, dan sentinel apa pun tidak muncul di log.
- Client OAuth test: `client_id` sintetis untuk integrasi (token di-mint); client yang didaftarkan lewat DCR lokal untuk E2E.
- Tidak ada AI, key live, atau data hosted.

## 7. Commands

Sudah ada di `package.json`:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm test:perf
pnpm test:integration:release
pnpm test:integration:account-deletion
pnpm test:integration:product-events
pnpm test:integration:activity
pnpm test:integration:achievements
pnpm test:e2e:release
pnpm test:e2e:auth
pnpm test:e2e:ui
```

Baru (Fase 3 dan 5):

```text
pnpm test:integration:mcp
pnpm test:e2e:mcp
```

`pnpm db:start`, `db:stop`, dan restart stack hanya dari checkout utama (§0.1).

## 8. Stop conditions

Berhenti dan laporkan ke pemilik produk, jangan improvisasi, bila:

- Working tree kotor di path yang akan diubah T34, atau sesi lain sedang memakai stack lokal dengan cara yang akan terganggu restart Auth.
- Fase 1 gagal di Spec §10.1 nomor 1 atau 5, atau cek hosted di awal Fase 6 menunjukkan hook pre-request tidak bisa diset. Pindah ke pendekatan B diputuskan pemilik produk.
- Proxy spike Fase 1 ternyata meneruskan path di luar `/auth/v1` (selain admin), atau tunnel perlu membuka Kong 54321 langsung.
- Ada sesi lain yang memakai stack lokal saat restart Auth Fase 1 diperlukan.
- Hook `db-pre-request` tidak bisa didaftarkan di lokal atau hosted, atau token OAuth masih bisa membaca tabel/Storage setelah §2.2.2–3.
- Implementasi menuntut pelonggaran Spec §3.1 (misalnya token OAuth harus boleh memanggil RPC app biasa).
- Perlu `db:reset`, menulis ulang migration lama, atau mengubah perilaku RPC lama (suite lama berubah hasil).
- Perlu dependency selain `@modelcontextprotocol/sdk`, atau SDK memaksa mode stateful.
- Alur authorize lokal tidak bisa diuji tanpa mock di Fase 5.
- Ada check yang masih gagal setelah dua kali perbaikan.
- Perlu perubahan di project hosted, login ke akun pihak ketiga, atau tindakan lain yang tidak tercantum sebagai langkah [PEMILIK].
- p95 `test:perf` naik lebih dari 20% setelah hook.
- Pengguna belum menyetujui copy deck (Fase 4).
- Scope bocor ke §2.3.

## 9. Gate review Claude

Read-only setelah Fase 5 (lokal) dan setelah Fase 6 (staging). P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–5 lengkap dengan angka aktual; ulang `lint`, `typecheck`, `test`, `db:test`, `test:integration:mcp`, `test:e2e:mcp`, `test:e2e:release`, `test:integration:release` di worktree bersih.
- [ ] Token OAuth tidak bisa membaca tabel, memanggil RPC app, atau menyentuh Storage; ulangi sendiri dengan token hasil mint.
- [ ] Setiap `public.mcp_*` memanggil `require_mcp_call` sebelum membaca atau menulis; urutan cek sesuai §2.2.7.
- [ ] Output tool persis kontrak Spec §4; tidak ada field CV, wording, kontak, atau URL file.
- [ ] Tidak ada jalur confirm; draft atomik; idempotensi per client.
- [ ] Id akun lain tidak bisa dibedakan dari id acak.
- [ ] Pencabutan dan hapus akun memutus akses pada request berikutnya; purge membersihkan baris MCP.
- [ ] Consent tidak pernah redirect ke URL dari query string; host di luar allowlist dan non-pilot tidak bisa approve.
- [ ] Log bebas argumen, hasil, dan token.
- [ ] Copy sama dengan copy deck yang disetujui; Delivery Gate tanpa FAIL; axe bersih.
- [ ] Staging (gate kedua): screenshot pemilik produk untuk acceptance 19 dan runbook bisa diikuti.

## 10. Review focus

1. **Token pihak ketiga dipakai langsung ke Supabase.** Ini satu-satunya jalan untuk membaca CV dan kontak lewat token MCP. Dijaga §2.2.2–3, acceptance 4, dan cek ulang reviewer.
2. **Fungsi `mcp_*` lupa memanggil `require_mcp_call`** atau memanggilnya dengan kelas yang salah, sehingga grant baca bisa menulis. Dijaga pgTAP yang membaca `prosrc` dan acceptance 6.
3. **Serializer meneruskan field baru diam-diam** saat tabel bertambah kolom. Dijaga skema output `strict()` dan acceptance 5.
4. **Pencabutan tidak berlaku sampai token kedaluwarsa** karena grant di-cache di endpoint. Dijaga §2.2.7 (cek per panggilan) dan acceptance 10.
5. **Consent bisa dipakai phishing** lewat DCR dengan nama palsu atau redirect ke host lain. Dijaga allowlist host, `client_host` ditampilkan, redirect hanya dari Supabase, acceptance 14.
6. **Hook pre-request memperlambat atau memutus app.** Salah kondisi path bisa menolak semua request web. Dijaga suite regresi penuh dan perbandingan `test:perf`.
