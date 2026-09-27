# Handoff T13 Durable AI jobs dan consent — eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan, buat implementasi minimal, jalankan ulang, lalu commit. Jangan membuat sub-agent.

- Tanggal: 27 September 2026
- Status saat plan ditulis: **TODO**. T13 belum dimulai.
- Dependensi: T05 dan T06 sudah **DONE**. Gate M2 **PASSED** untuk acceptance lokal (`docs/verification/M2-gate-review.md`).
- Eksekutor: satu agent **GPT-6 Luna**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude**. Gate review read-only wajib dilakukan setelah Fase 6. Checkpoint setelah Fase 3 bersifat opsional.
- Acuan:
  - PRD R04/R05, §3 *Content and AI behavior*, dan §4 *AI disclosure / Data minimization / Failures*.
  - User Flow F02 (langkah 3 serta catatan tanpa consent) dan state transition job.
  - Wireframe §1 (AI controls, shared dialogs) dan S12 (*AI consent can be withdrawn*).
  - Database Schema §2 (consent pada `profiles`), §3 (`ai_jobs` dan *worker rules*), serta §6.
  - `IMPLEMENTATION_PLAN.md` §1/§2/§3 *Jobs dan data privat*, §4 (lease), dan T13; `Design.md` §32.

**Goal:** Setiap analisis AI berjalan sebagai job PostgreSQL yang durable. Job di-claim atomik dengan lease 120 detik, attempt token, dan maksimal tiga attempt. Consent (versi dan timestamp) diperiksa pada saat enqueue, sebelum teks dikirim, dan sebelum hasil disimpan. Hasil divalidasi terhadap skema terstruktur dan disimpan di `ai_jobs.result`. Hasil tidak pernah diterapkan ke Achievement; itu tugas T14. Adapter OpenAI nyata sudah terbukti lewat satu smoke live. Jalur manual tetap berfungsi tanpa consent dan tanpa AI.

**Architecture:** Tabel `public.ai_jobs` dilindungi RLS: owner hanya dapat SELECT, dan client tidak memiliki hak write. Enqueue dan retry dilakukan melalui RPC `SECURITY DEFINER` untuk `authenticated`, yang memeriksa sesi, consent, `deleting_at`, dan `expected_revision`. Worker Node memakai RPC khusus `service_role` untuk expire, claim, input, complete, dan fail. Guard CAS pada `attempt_token` dan `lease_expires_at` mencegah worker terlambat menulis. Provider dibungkus interface `AIProvider`. Adapter OpenAI memanggil Responses API dengan `fetch` langsung, tanpa SDK baru, memakai `store: false` dan structured output JSON Schema strict. Fake adapter deterministic hanya boleh dipakai di `NODE_ENV=test|development` dengan penanda yang jelas.

**Tech stack:** Next.js App Router, TypeScript strict, Supabase PostgreSQL/RLS, Zod 4, worker Node 24 (`.ts` type stripping), Vitest, pgTAP, Playwright + Axe, dan pnpm dari lockfile.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, bagian authoritative `IMPLEMENTATION_STATUS.md`, `IMPLEMENTATION_PLAN.md` §1–§4/T13/T14, dan `docs/verification/M2-gate-review.md`. Ekstrak PRD §3/§4, F02, Wireframe §1/S12, dan DB §2/§3/§6 memakai alat ekstraksi DOCX; jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD §4 AI disclosure:** sebelum aksi AI pertama, jelaskan bahwa teks terpilih dikirim ke pemroses eksternal. Catat versi dan timestamp consent. Pengguna yang menolak tetap dapat memakai entri manual dan pengeditan CV.
- **PRD §4 Data minimization:** kirim hanya teks yang dibutuhkan operasi. Evidence tidak pernah dikirim.
- **PRD §4 Failures:** job AI memiliki state queued, running, succeeded, dan failed. Timeout 120 detik dan tersedia retry eksplisit. Save dipertahankan dan job tidak boleh terduplikasi.
- **DB §2:** `profiles.ai_consent_at` dan `ai_consent_version` diisi bersamaan atau NULL bersamaan. Keduanya sudah ada sejak T02.
- **DB §3 ai_jobs:** kolom `kind`, target `activity_id`/`import_batch_id` (tepat satu), `input_revision`, `status`, `idempotency_key` UNIQUE per user, `result`, `error_code`, `attempt`, `consent_version`, `started_at`, dan `finished_at`. Retry maksimal 3 attempt. Error code disimpan tanpa teks sumber.
- **DB §3 worker rules:** claim atomik dengan lease, set running, dan gagalkan lease 120 detik yang kedaluwarsa. Otorisasi akun tetap dilakukan meski memakai kredensial worker. Validasi output terstruktur sebelum disimpan. Revisi sumber yang tidak cocok menghasilkan `STALE_INPUT`. Reanalysis tidak pernah menulis Achievement confirmed.
- **DB §6:** client tidak boleh menulis worker state atau hasil AI mentah. Delete activity ikut menghapus job AI targetnya. Worker memeriksa state deleting sebelum retry.
- **F02:** save tanpa consent menghasilkan activity biasa dengan `analysis_state = not_requested`. Kegagalan AI membiarkan activity tersimpan dengan Retry. Edit note menaikkan revisi dan membatalkan hasil yang masih pending.
- **Wireframe §1/S12:** dialog consent menawarkan *Allow AI* dan *Continue manually*. Consent dapat ditarik untuk request berikutnya.

Pertahankan perubahan lokal pengguna. Jangan menandai T13 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T13-phaseN-<slug>.md`. Receipt berisi tujuan, file yang berubah, command beserta hasil aktual (exit code dan angka), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya.

## 1. Acceptance inti T13

T13 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata. Poin 11 menjadi pengecualian karena membutuhkan satu panggilan live:

1. **Duplicate request memakai job yang sama.** Request berurutan maupun bersamaan (`Promise.all` ×5) untuk activity dan revisi yang sama menghasilkan satu row dan `job_id` yang identik.
2. **Stale source menghasilkan `STALE_INPUT`.** Edit activity saat job queued atau running membuat job gagal dengan `STALE_INPUT` dan `result` NULL. Request baru untuk revisi baru membuat job baru.
3. **Worker terlambat tidak bisa menulis.** Setelah lease kedaluwarsa, attempt yang lama ditandai gagal (`AI_TIMEOUT`). Complete atau fail dengan token lama mengembalikan false tanpa mengubah row.
4. **Maksimal tiga attempt.** Setiap claim dihitung satu attempt. Retry eksplisit hanya berlaku untuk job failed dengan `attempt_count < 3`. Setelah itu responsnya `AI_RETRY_EXHAUSTED`.
5. **Consent ditegakkan tiga kali:**
   - Enqueue tanpa consent versi terkini ditolak `CONSENT_REQUIRED` tanpa membuat job.
   - Job queued yang consent-nya sudah ditarik gagal saat claim atau input, tanpa panggilan provider.
   - Consent yang ditarik ketika job running membuat complete menyimpan `CONSENT_WITHDRAWN` dengan `result` NULL.
6. **Akun deleting diblokir.** RPC user menolak, dan worker menggagalkan job dengan `ACCOUNT_DELETING` tanpa memanggil provider.
7. **Validasi terstruktur.** Output yang tidak sesuai skema, refusal, atau output incomplete menghasilkan `AI_OUTPUT_INVALID`/`AI_REFUSED` dengan `result` NULL. Metric yang nilainya tidak muncul di teks sumber juga dianggap invalid.
8. **Tanpa secret atau teks sumber di log.** Sentinel pada `raw_text` dan API key tidak muncul di stdout, stderr, pesan error, `error_code`, maupun receipt.
9. **Minimisasi.** Payload ke provider hanya berisi `raw_text`, `role`, `scope`, `outcome`, dan locale. Nama, email, evidence, filename, project/employer, dan ID tidak ikut. Ini dibuktikan dengan snapshot payload fake atau stub.
10. **Jalur manual utuh.** Tanpa consent, dan setelah consent ditolak atau ditarik, capture activity serta create/confirm Achievement tetap berjalan. Regresi `m2-manual-journey` tetap lulus.
11. **Smoke live OpenAI.** Satu request nyata dengan fixture sintetis menghasilkan result yang valid terhadap skema. Model, latency, dan status dicatat tanpa key.
12. **Consent UI S12 aksesibel.** Allow melalui dialog dan Withdraw berfungsi. Versi dan tanggal tampil. Konflik revisi ditangani. Kontrol dapat dioperasikan dengan keyboard dan focus kembali ke pemicu. Axe WCAG 2.2 A/AA bersih. Tidak ada overflow pada 360/1440 light/dark. Copy tersedia dalam en/id.
13. **Isolasi dua akun.** Akun B tidak dapat membaca job A, tidak dapat me-request analisis pada activity A, dan tidak dapat me-retry job A. Error yang diterima generik sehingga keberadaan record tidak bocor.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration forward-only untuk `public.ai_jobs`, RPC user (consent, request, retry), RPC worker, reset `analysis_state` saat revisi naik, dan pgTAP.
- `src/domain/ai/`: contracts, error code, versi consent, skema hasil `detect.v1`, minimisasi input, dan grounding metric.
- `src/server/ai/`: interface `AIProvider`, adapter OpenAI (fetch), fake deterministic, dan resolver mode dengan guard production.
- `workers/ai-worker.ts` dan `workers/supabase-ai-gateway.ts`, integrasi ke `workers/run.ts`, serta registrasi di `bootstrap.ts`.
- `src/features/ai/`: `consent-service.ts`, `ai-job-service.ts` (request, retry, dan status terbaru untuk activity; dipakai T14), serta server action consent.
- UI: kartu *AI processing* di S12 dan komponen `AiConsentDialog` bersama.
- Copy en/id, `.env.example`, README bagian Worker/AI, test unit/pgTAP/integration/E2E, script live smoke, decision 0019, dan receipt.

### 2.2 Keputusan implementasi

1. **Tabel di `public`, write hanya lewat RPC.** Tabel memakai RLS `select` untuk owner. Hak `SELECT` authenticated diberikan per kolom dan **mengecualikan** `attempt_token`, `lease_expires_at`, dan `payload_hash`. `INSERT/UPDATE/DELETE` dicabut dari `anon`, `authenticated`, dan `service_role`, sehingga semua perubahan melewati fungsi.
2. **Kind T13 hanya `detect`.** Constraint `kind in ('detect')` merupakan subset kontrak DB §3. `refine` ditambahkan T14 bersama semantik follow-up, dan `import` beserta `import_batch_id` ditambahkan T15 setelah `import_batches` ada. Target `activity_id` bersifat NOT NULL untuk kind `detect`, dengan composite FK `(user_id, activity_id) → activities(user_id, id) ON DELETE CASCADE` sesuai DB §6.
3. **Idempotency key diturunkan server:** `detect:<activity_id>:r<input_revision>` dengan `UNIQUE(user_id, idempotency_key)`. `payload_hash` berisi sha256 atas input yang sudah diminimalkan. Bila key sama tetapi hash berbeda, request gagal dengan `IDEMPOTENCY_KEY_REUSED` sebagai defense in depth. Request identik mengembalikan job lama dalam status apa pun. Job yang failed tidak dibuat ulang; pemanggil memakai retry.
4. **Tidak ada retry otomatis.** Setiap claim dihitung satu attempt. Error dari provider membuat job langsung `failed` dengan kode tertentu. Retry eksplisit (`failed → queued`) mempertahankan `input_revision` dan menolak bila revisi activity sudah berubah (`STALE_INPUT`) atau `attempt_count >= 3` (`AI_RETRY_EXHAUSTED`). Alasannya, PRD dan F02 meminta retry yang eksplisit dan lebih mudah diaudit.
5. **Lease 120 detik yang kedaluwarsa menjadi `failed/AI_TIMEOUT`**, bukan di-reclaim. Aturan ini mengikuti DB §3 (*fail an expired lease*). `public.expire_ai_job_leases()` dipanggil worker di awal setiap iterasi, dan `claim_ai_jobs` juga memanggilnya secara internal. Fetch ke provider memakai timeout **90 detik** agar selesai sebelum lease habis.
6. **Consent version bersumber tunggal di SQL.** `internal.current_ai_consent_version()` mengembalikan `'ai-processing-v1'`. Konstanta TypeScript `AI_CONSENT_VERSION` wajib sama, dan hal ini dibuktikan oleh unit test serta pgTAP. Grant hanya menerima versi terkini. Bila versi nanti naik, consent lama dianggap tidak cukup. Withdraw mengosongkan kedua kolom lewat `internal.set_ai_consent` yang sudah ada.
7. **Consent diperiksa tiga kali:**
   - `request_ai_analysis` memeriksa consent sebelum enqueue.
   - `get_ai_job_input` memeriksa consent sebelum teks diserahkan ke worker. Jika consent gagal, job dibuat failed `CONSENT_REQUIRED`.
   - `complete_ai_job` memeriksa consent sebelum hasil disimpan. Jika consent gagal, job dibuat failed `CONSENT_WITHDRAWN` dengan `result` NULL.

   Recheck sebelum *apply* ke Achievement adalah tugas T14.
8. **Input worker diambil terpisah dari claim.** `claim_ai_jobs` hanya mengembalikan `id`, `user_id`, `kind`, `input_revision`, `attempt_count`, dan `attempt_token`. Teks diambil lewat `get_ai_job_input(job_id, token)`. Fungsi ini mengunci profil dan activity, memeriksa `deleting_at`, consent, revisi, dan guard token/lease, lalu mengembalikan `raw_text`, `role`, `scope`, `outcome`, dan `locale`. Teks hanya hidup di memori worker.
9. **`analysis_state` hanya diperbarui oleh fungsi job**, dan hanya ketika `activities.revision = job.input_revision`. Transisinya `queued` → `running` → `done`/`failed`. Trigger `internal.guard_activity_row` diperluas: ketika revisi naik, `analysis_state` di-reset menjadi `not_requested`. Salin body T06 persis, lalu tambahkan satu cabang; body lama tidak ditulis ulang. Mengubah `analysis_state` tidak menaikkan revisi, sesuai perilaku T06.
10. **Skema hasil `detect.v1`** (Zod dan JSON Schema strict dari satu sumber):

    ```ts
    {
      schema_version: "detect.v1",
      potential: boolean,
      suggestion: null | {
        title, contribution, outcome,   // string nonblank
        role, scope,                    // string | null
        cv_bullet,                      // string nonblank
        metrics: { label, value, unit }[] (≤5),
        skills: string[] (≤8),
      },
      questions: { field: "role" | "scope" | "outcome", text: string }[] (≤3),
    }
    ```

    - Batas panjang disamakan dengan kontrak Achievement T09 (`src/domain/achievement/`) dan dicatat di receipt.
    - `potential=false` mewajibkan `suggestion=null`.
    - Grounding: setiap `metrics[].value` harus muncul (dinormalisasi) di input. Bila tidak, output dianggap `AI_OUTPUT_INVALID`.
    - Validasi di worker (Zod) dan di SQL (`jsonb_typeof = 'object'`, `schema_version`, ukuran ≤ 32 KiB).
11. **Adapter OpenAI memakai `fetch` tanpa SDK.** Pilihan ini konsisten dengan gateway worker yang sudah ada, tidak menambah dependensi, dan memberi kontrol penuh atas timeout dan pesan error.
    - Request: `POST {WORKPULSE_OPENAI_BASE_URL}/responses` dengan `model`, `instructions` (prompt `detect.prompt.v1` yang diversi di kode), `input` (JSON input minimal), `text.format = { type: "json_schema", name: "detect_v1", strict: true, schema }`, `store: false`, dan `max_output_tokens`.
    - Pemetaan status: 401/403 → `AI_CONFIG_INVALID`; 429 → `AI_RATE_LIMITED`; 5xx/jaringan → `AI_PROVIDER_UNAVAILABLE`; abort 90 detik → `AI_PROVIDER_TIMEOUT`; refusal → `AI_REFUSED`; `status: "incomplete"` atau JSON invalid → `AI_OUTPUT_INVALID`.
    - Isi respons provider tidak pernah dimasukkan ke pesan error.
    - **Fase 0 wajib memverifikasi bentuk request/response dan dukungan structured output model pada dokumentasi resmi OpenAI terkini.** Catat URL dokumentasi dan tanggal aksesnya di receipt.
12. **Konfigurasi (server/worker only):**
    - `WORKPULSE_AI_MODE=unavailable|openai|fake`, default `unavailable`. `fake` dilempar `FAKE_AI_NOT_ALLOWED_IN_PRODUCTION` bila `NODE_ENV` bukan test/development, mengikuti pola `resolveMalwareScanner`.
    - `WORKPULSE_OPENAI_API_KEY` dan `WORKPULSE_AI_MODEL` wajib pada mode `openai`, tanpa default. Snapshot model yang dipin dipilih di Fase 0 dari model yang mendukung structured outputs, lalu dicatat di decision 0019.
    - `WORKPULSE_OPENAI_BASE_URL` default `https://api.openai.com/v1`. `http` hanya diizinkan untuk localhost (stub test).
    - Mode `unavailable` tetap meng-claim job lalu menggagalkannya dengan `AI_UNAVAILABLE`. Dengan begitu UI T14 menampilkan Retry, bukan status queued selamanya.
13. **Secret hanya di proses worker.** Variabel AI disimpan di `.env.ai.local`. Pastikan file ini tercakup `.gitignore`; bila belum, tambahkan pola tersebut. Script `worker:run`/`worker:once` menambahkan `--env-file-if-exists=.env.ai.local`. Web server tidak membutuhkan key karena enqueue tidak memanggil provider. Konsekuensinya, assertion env AI-free pada `m2-manual-journey.spec.ts` tetap valid dan **tidak boleh dilemahkan**.
14. **Consent UI:**
    - Kartu *AI processing* berada di `ProfileWorkspace`, di antara `ProfileEditor` dan `FoundationEditors`.
    - Status *Not allowed* atau *Allowed since <tanggal, timezone profil> · version ai-processing-v1*.
    - Tombol *Allow AI…* membuka `AiConsentDialog`. Isi dialog: apa yang dikirim (teks catatan beserta role/scope/outcome), apa yang tidak dikirim (evidence, file, nama, dan email), nama pemroses (OpenAI), bahwa manual tetap berfungsi, dan bahwa consent dapat ditarik kapan saja. Tombolnya *Allow AI* (primer) dan *Continue manually*.
    - *Withdraw* langsung melakukan submit dengan konfirmasi inline, karena withdraw bersifat reversibel dan tidak merusak.
    - Action memakai `expected_revision` profil. Konflik mengikuti pola `saveProfileAction`.
    - Dialog memakai primitive `src/components/ui/dialog.tsx`. Escape dan *Continue manually* menutup dialog tanpa perubahan, dan focus kembali ke pemicu.
    - Hindari sparkle dan gradient. Label AI kecil diperbolehkan sesuai Design §32.
15. **Nomor decision:** `docs/decisions/0019-t13-ai-jobs-consent.md`. Nomor 0017 tetap dicadangkan dan tidak dibuat.
16. **Migration:** `supabase/migrations/20260928090000_t13_ai_jobs_consent.sql`. Timestamp-nya lebih besar dari `20260927090000`. Parity menjadi 22/22.

### 2.3 Di luar scope

Hal berikut tidak dikerjakan di T13:

- Tombol Analyze/Retry dan status Analyzing di S05/S06/S08 (T14).
- Apply atau review hasil ke Achievement (T14).
- Follow-up question counter dan suppression (T14).
- Kind `refine` (T14) dan `import`/`import_batch_id` (T15).
- Consent pada import (T15/T17).
- Rate limit atau kuota AI per user, penerjemahan, evidence AI, streaming, maupun chat assistant.
- Pengubahan perilaku T06–T12 selain reset `analysis_state` saat revisi naik.

## 3. Kontrak teknis

### 3.1 Migration

Tabel `public.ai_jobs`:

| Kolom | Definisi |
| --- | --- |
| `id` | uuid PK, default `gen_random_uuid()` |
| `user_id` | uuid not null, FK `profiles(id)` on delete cascade |
| `kind` | text not null, check `in ('detect')` |
| `activity_id` | uuid not null; composite FK `(user_id, activity_id)` → `activities(user_id, id)` on delete cascade |
| `input_revision` | integer not null, `> 0` |
| `idempotency_key` | text not null; `unique (user_id, idempotency_key)`; check pola `^detect:[0-9a-f-]{36}:r[1-9][0-9]*$` |
| `payload_hash` | bytea not null, `octet_length = 32` |
| `consent_version` | text not null |
| `status` | text not null default `'queued'`, check `queued/running/succeeded/failed` |
| `attempt_count` | integer not null default 0, check `between 0 and 3` |
| `attempt_token` | uuid |
| `lease_expires_at` | timestamptz |
| `result` | jsonb |
| `error_code` | text, check `^[A-Z][A-Z0-9_]{0,63}$` |
| `started_at`, `finished_at` | timestamptz |
| `created_at`, `updated_at` | timestamptz not null default `clock_timestamp()` |
| `revision` | integer not null default 1 |

- Tambahkan `unique (user_id, id)`.
- **State check** meniru `internal.storage_jobs`:
  - `queued`: token, lease, finished, dan result NULL.
  - `running`: `attempt_count > 0`, token dan lease terisi, `result` NULL.
  - `succeeded`: `result` terisi, lease NULL, `finished_at` terisi, `error_code` NULL.
  - `failed`: `error_code` terisi, `result` NULL, lease NULL, `finished_at` terisi.
- Tambahkan check result: `result is null or (jsonb_typeof(result)='object' and result->>'schema_version'='detect.v1' and pg_column_size(result) <= 32768)`.
- Index: `(status, created_at)` (DB §3) dan `(user_id, activity_id, created_at desc)`.
- RLS enable dan policy `ai_jobs_owner_select` (`user_id = (select auth.uid())`). Grant `select` per kolom untuk authenticated sesuai §2.2.1. Revoke semua write, termasuk dari `service_role`.
- Trigger `touch_mutable_row` dipasang untuk `updated_at`/`revision` bila polanya sesuai. Bila tidak, dokumentasikan alasannya.

Fungsi baru, semuanya `security definer`, `set search_path = ''` atau `pg_catalog, internal` sesuai pola T10, dengan identifier ter-qualify:

| Fungsi | Grant | Perilaku |
| --- | --- | --- |
| `internal.current_ai_consent_version()` | internal | Mengembalikan `'ai-processing-v1'` (immutable). |
| `public.set_ai_consent(p_expected_revision int, p_consented boolean)` | authenticated | `auth.uid()` wajib, profil tidak deleting. Memanggil `internal.set_ai_consent(uid, rev, consented, case when consented then current_version end)`. Mengembalikan `revision`, `ai_consent_at`, dan `ai_consent_version`. `STALE_REVISION` diteruskan apa adanya. |
| `public.request_ai_analysis(p_activity_id uuid, p_expected_revision int)` | authenticated | Urutan lock: profil (`deleting_at is null`, bila tidak `AUTH_REQUIRED`), lalu activity `for update` (bukan milik caller → `ACTIVITY_UNAVAILABLE`). Consent harus versi terkini (`CONSENT_REQUIRED`). Revisi harus cocok (`STALE_INPUT`). Hitung hash input, lalu insert dengan `on conflict (user_id, idempotency_key) do nothing`. Bila konflik, bandingkan hash (`IDEMPOTENCY_KEY_REUSED`) dan kembalikan job lama. Job baru mengubah `analysis_state` menjadi `queued`. Mengembalikan receipt: `job_id`, `status`, `input_revision`, `attempt_count`, `error_code`. |
| `public.retry_ai_job(p_job_id uuid)` | authenticated | Owner (bila tidak, `AI_JOB_UNAVAILABLE`) dan status `failed` (bila tidak, `AI_JOB_NOT_RETRYABLE`). Consent terkini, revisi activity sama dengan `input_revision` (`STALE_INPUT`), `attempt_count < 3` (`AI_RETRY_EXHAUSTED`). Kemudian `queued` dengan token, lease, error, dan finished dikosongkan, serta `analysis_state` menjadi `queued`. |
| `public.expire_ai_job_leases()` | service_role | Mengubah job `running` dengan lease `<= clock_timestamp()` menjadi `failed/AI_TIMEOUT` dan `analysis_state` menjadi `failed` (bila revisi cocok). Mengembalikan jumlah row. |
| `public.claim_ai_jobs(p_limit int default 1)` | service_role | Memanggil expire lebih dulu. Kandidat berstatus `queued`, diurutkan `created_at, id`, dengan `for update skip locked`, lalu diubah ke `running`: `attempt_count+1`, token baru, lease `+120 seconds`, `started_at` bila NULL, dan `analysis_state` `running`. `p_limit` 1–10. |
| `public.get_ai_job_input(p_job_id uuid, p_attempt_token uuid)` | service_role | Lock profil, activity, lalu job. Guard: status running, token cocok, lease belum habis (bila gagal, mengembalikan 0 row). Profil deleting → fail `ACCOUNT_DELETING`. Consent tidak terkini → fail `CONSENT_REQUIRED`. Revisi berubah → fail `STALE_INPUT`. Pada ketiga kasus ini fungsi mengembalikan 0 row. Bila lolos, mengembalikan `raw_text`, `role`, `scope`, `outcome`, `locale`, `input_revision`. |
| `public.complete_ai_job(p_job_id uuid, p_attempt_token uuid, p_result jsonb)` | service_role | Urutan lock sama. Mengembalikan `text`: `'succeeded'`, `'stale'` (guard token/lease gagal, tanpa perubahan), `'failed:<CODE>'` untuk `STALE_INPUT`, `CONSENT_WITHDRAWN`, atau `ACCOUNT_DELETING` (job failed, result NULL), atau `'invalid'` bila result gagal check SQL (job failed `AI_OUTPUT_INVALID`). Pada sukses, `analysis_state` menjadi `done`. |
| `public.fail_ai_job(p_job_id uuid, p_attempt_token uuid, p_error_code text)` | service_role | Dijaga oleh token dan lease. Mengubah job menjadi `failed` dan `analysis_state` menjadi `failed` bila revisi cocok. Kode divalidasi dengan pola regex. Mengembalikan boolean. |

- Perluas `internal.guard_activity_row`: ketika revisi naik, set `new.analysis_state := 'not_requested'`.
- Revoke `execute` dari `public` dan `anon` pada semua fungsi di atas. Fungsi user diberi grant ke `authenticated`, fungsi worker ke `service_role`.
- Tambahkan `comment on` untuk tabel dan setiap fungsi.

Catatan eksekutor:

- `supabase/config.toml` hanya meng-expose schema `public`, sehingga `internal.set_ai_consent` tidak dapat dipanggil via PostgREST. Karena itu wrapper public diperlukan. Jangan mengubah daftar schema yang di-expose.
- `supabase/tests/database/activity.test.sql:50-56` saat ini mengasersi `to_regclass('public.ai_jobs') is null`. Ubah assertion tersebut menjadi `is not null` dan catat di receipt.
- Seluruh kesalahan memakai `raise exception '<CODE>' using errcode = ...` mengikuti pola T06/T09. Pesan tidak boleh memuat teks sumber.

### 3.2 Domain dan server

**`src/domain/ai/contracts.ts`** berisi:

- `AI_CONSENT_VERSION = "ai-processing-v1"`
- `AI_MAX_ATTEMPTS = 3`
- `AI_LEASE_SECONDS = 120`
- `AI_PROVIDER_TIMEOUT_MS = 90_000`
- `AiJobStatus`
- `AiErrorCode`, sebuah union dari: `CONSENT_REQUIRED`, `CONSENT_WITHDRAWN`, `STALE_INPUT`, `ACCOUNT_DELETING`, `AI_TIMEOUT`, `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_CONFIG_INVALID`, `AI_REFUSED`, `AI_OUTPUT_INVALID`, `AI_UNAVAILABLE`, `AI_RETRY_EXHAUSTED`.

**`src/domain/ai/detect-result.ts`** berisi `detectResultSchema` (Zod strict), `detectResultJsonSchema` (JSON Schema strict dengan `additionalProperties: false` dan seluruh properti required, nullable lewat union), serta `validateDetectResult(raw, input)`. Fungsi validasi memeriksa skema dan grounding metric. Unit test mengecek bahwa kedua skema setara pada fixture valid dan invalid.

**`src/domain/ai/minimize.ts`** berisi `buildDetectInput({raw_text, role, scope, outcome, locale})`. Fungsi ini mengembalikan objek dengan kunci tetap, tanpa ID atau nama, serta `hashDetectInput()` (sha256 hex, dipakai untuk parity dengan SQL; bila hash dihitung di SQL, dokumentasikan kanonikalisasinya).

**`src/server/ai/provider.ts`**:

```ts
export type AIProviderResult =
  | { status: "ok"; output: unknown; model: string }
  | { status: "error"; code: AiErrorCode };

export interface AIProvider {
  readonly kind: "openai" | "fake" | "unavailable";
  detect(input: DetectInput, signal: AbortSignal): Promise<AIProviderResult>;
}
```

Implementasi:

- `openai-provider.ts` (§2.2.11)
- `fake-provider.ts` (`ExplicitTestFakeAIProvider`, deterministic berdasarkan input, dengan mode skenario `valid | malformed | refusal | ungrounded | slow`)
- `unavailable-provider.ts`
- `resolve-provider.ts` (§2.2.12)

Semua file `src/server/ai/*` diawali `import "server-only"`, kecuali file yang juga diimpor worker. Ikuti cara `malware-scanner.ts` diimpor worker dan dokumentasikan pilihannya.

**`src/features/ai/`**:

- `consent-service.ts`: `setAiConsent(client, {expectedRevision, consented})`.
- `ai-job-service.ts`: `requestAnalysis`, `retryJob`, dan `getLatestJobForActivity`.
- `AiServiceError` mengikuti bentuk `ActivityServiceError`: `code` dari himpunan `VALIDATION | UNAUTHENTICATED | NOT_FOUND | CONFLICT | STALE_INPUT | CONSENT_REQUIRED | RETRY_EXHAUSTED | UNAVAILABLE`, plus `messageKey` dan `correlationId`.
- Pemetaan error DB: `ACTIVITY_UNAVAILABLE`/`AI_JOB_UNAVAILABLE` → `NOT_FOUND` generik.
- `actions.ts` berisi `setAiConsentAction` dengan pola `saveProfileAction`: Zod, `expected_revision`, pemetaan konflik ke `latestRecord`, lalu `revalidatePath("/settings/profile")`.

### 3.3 Worker

`workers/ai-worker.ts` memuat `runAiWorkerOnce({ db, provider, now })` dengan alur berikut:

1. `expireAiJobLeases`, lalu `claimAiJobs(1)`.
2. Validasi row. UUID yang tidak valid dicatat sebagai `stale`.
3. `getAiJobInput`. Hasil 0 row berarti `skipped` (job sudah digagalkan DB).
4. `buildDetectInput`, lalu `provider.detect` dengan `AbortSignal.timeout(AI_PROVIDER_TIMEOUT_MS)`.
5. Error provider diteruskan ke `failAiJob(code)`. Output yang ok divalidasi dengan `validateDetectResult`. Bila tidak valid, panggil `failAiJob("AI_OUTPUT_INVALID")`; bila valid, panggil `completeAiJob`.

Worker hanya mengembalikan ringkasan berupa angka dan kode: `claimed`, `succeeded`, `failed{code:count}`, `stale`, `skipped`. Tidak ada teks.

`workers/supabase-ai-gateway.ts` menyalin pola `supabase-evidence-gateway.ts`: `rpc()` fetch dengan secret key, timeout 15 detik, parsing defensif, dan kegagalan menjadi `AiWorkerGatewayError("WORKER_BACKEND_UNAVAILABLE")` dengan pesan tetap.

`workers/run.ts` menambahkan satu pass AI per iterasi setelah evidence. Error AI tidak boleh menghentikan evidence, dan sebaliknya. `bootstrap.ts` `registeredJobs` bertambah `"ai-detect"`. Perbarui `tests/unit/worker-bootstrap.test.ts`.

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20260928090000_t13_ai_jobs_consent.sql`, `supabase/tests/database/ai_jobs.test.sql` |
| Modify | `supabase/tests/database/activity.test.sql` (assertion `ai_jobs`), `src/server/supabase/database.types.ts` (`db:types`) |
| Create | `src/domain/ai/{contracts,detect-result,minimize}.ts` |
| Create | `src/server/ai/{provider,openai-provider,fake-provider,unavailable-provider,resolve-provider,detect-prompt}.ts` |
| Create | `src/features/ai/{consent-service,ai-job-service,actions}.ts` |
| Create | `src/features/profile/ai-consent-card.tsx`, `src/components/ui/ai-consent-dialog.tsx` |
| Modify | `src/features/profile/profile-workspace.tsx`, `src/app/(workspace)/settings/profile/page.tsx` (profil beserta kolom consent), `src/i18n/messages.ts` (`ai.*`, `error.staleInput`, `error.consentRequired`, en dan id), `src/app/globals.css` |
| Create | `workers/ai-worker.ts`, `workers/supabase-ai-gateway.ts` |
| Modify | `workers/run.ts`, `workers/bootstrap.ts`, `package.json`, `.env.example`, `.gitignore` (bila perlu), `README.md` |
| Create | `tests/unit/{ai-contracts,detect-result,ai-minimize,openai-provider,ai-provider-resolve,ai-worker,ai-job-service,ai-consent-action}.test.ts` |
| Create | `tests/integration/ai-jobs.test.ts`, `tests/integration/openai-stub.ts` (HTTP stub 127.0.0.1) |
| Create | `tests/live/openai-smoke.test.ts`, `vitest.live.config.ts` |
| Create | `tests/e2e/ai-consent.spec.ts`, `playwright.ai.config.ts` (PORT **3007**) |
| Create (Fase 7) | `docs/decisions/0019-t13-ai-jobs-consent.md`, `docs/verification/T13-ai-jobs-consent.md` |

Script baru:

- `test:integration:ai`
- `test:e2e:ai`
- `test:ai:live`, dengan pola `vitest run --config vitest.live.config.ts`. Test di-*skip* dengan pesan jelas bila `WORKPULSE_AI_LIVE !== "1"`, dan tidak termasuk dalam `pnpm test`.

## 5. Fase eksekusi

### Fase 0 — Baseline dan verifikasi provider (tanpa edit kode)

- [ ] Catat `git status --short --branch` dan HEAD. Working tree harus bersih kecuali `.claude/`. Jika ada perubahan lain yang belum di-commit, **stop**.
- [ ] Jalankan `pnpm install --frozen-lockfile`, `pnpm db:status`, dan `pnpm exec supabase migration list --local`. Parity harus **21/21** dengan migration terakhir `20260927090000`.
- [ ] Jalankan baseline `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan 44 file/203 test), dan `pnpm db:test` (harapan 7 file/386 assertion).
- [ ] Verifikasi dari source dan catat file:baris untuk:
  - `internal.set_ai_consent` dan grant-nya;
  - `lock_profile_revision`;
  - body `internal.guard_activity_row`;
  - check `analysis_state`;
  - pola `claim_evidence_scan_jobs`/`complete_evidence_scan_job`;
  - `touch_mutable_row`;
  - `.gitignore` untuk `.env*.local`;
  - assertion env pada `m2-manual-journey.spec.ts:147`.
- [ ] Buka dokumentasi resmi OpenAI (Responses API, Structured Outputs, `store`, dan status error) dan catat URL serta tanggal aksesnya. Pilih snapshot model yang mendukung `json_schema` strict, lalu catat alasan pemilihan (biaya, latency, dan dukungan bahasa id/en). **Jangan memanggil API di fase ini.**
- [ ] Tanyakan kepada pengguna apakah `WORKPULSE_OPENAI_API_KEY` akan disediakan di `.env.ai.local` untuk Fase 6. Jangan meminta key ditempel di chat dan jangan mencetaknya.
- [ ] Tulis receipt Fase 0.

### Fase 1 — Database (TDD pgTAP)

- [ ] Tulis `supabase/tests/database/ai_jobs.test.sql` yang gagal lebih dulu, memakai pola `begin; … no_plan(); … finish(); rollback;` dan `pg_temp.set_jwt_subject`. Assertion minimum:
  1. `has_table`, kolom, dan constraint. `authenticated` tidak memiliki INSERT/UPDATE/DELETE. `SELECT` pada `attempt_token`/`lease_expires_at`/`payload_hash` ditolak (`has_column_privilege`). `service_role` juga tidak memiliki write langsung.
  2. Grant fungsi: fungsi user untuk authenticated dan bukan anon; fungsi worker hanya untuk service_role. `prosecdef = true`.
  3. `set_ai_consent`: grant mengisi versi `ai-processing-v1` dan timestamp. Withdraw mengosongkan keduanya. Revisi lama menghasilkan `STALE_REVISION`. `current_ai_consent_version()` mengembalikan versi yang sama.
  4. `request_ai_analysis`: tanpa consent → `CONSENT_REQUIRED` dan 0 row job. Revisi salah → `STALE_INPUT`. Activity akun B → `ACTIVITY_UNAVAILABLE`. Profil deleting → `AUTH_REQUIRED`. Request pertama membuat job dan `analysis_state` menjadi `queued`. Request kedua mengembalikan id yang sama.
  5. `claim_ai_jobs` sebagai service_role: status running, attempt 1, token terisi, dan lease sekitar `now()+120s`.
  6. `get_ai_job_input` mengembalikan teks. Dengan token salah hasilnya 0 row. Setelah `update activities` (superuser) menaikkan revisi, hasilnya 0 row, job failed `STALE_INPUT`, dan `analysis_state` bernilai `not_requested` karena trigger.
  7. `complete_ai_job` dengan result valid menghasilkan `succeeded` dan `done`. Token lama menghasilkan `stale`. Result `{"schema_version":"x"}` menghasilkan `invalid`/`AI_OUTPUT_INVALID`. Consent yang ditarik sebelum complete menghasilkan `failed:CONSENT_WITHDRAWN` dengan result NULL.
  8. Lease: set `lease_expires_at = now() - interval '1 second'` sebagai superuser, lalu jalankan `expire_ai_job_leases()`. Hasilnya `failed/AI_TIMEOUT`. Complete dengan token tersebut menghasilkan `stale` tanpa perubahan.
  9. `retry_ai_job`: failed → queued. Setelah tiga kali claim dan fail, retry menghasilkan `AI_RETRY_EXHAUSTED`. Retry setelah edit → `STALE_INPUT`. Job akun B → `AI_JOB_UNAVAILABLE`.
  10. Delete activity: job ikut terhapus (cascade), dan complete dengan token lama mengembalikan `stale`.
  11. RLS: B tidak melihat job A. Edit activity tetap menaikkan revisi, sedangkan perubahan `analysis_state` saja tidak menaikkan revisi.
- [ ] Pastikan `pnpm db:test` **FAIL**. Tulis migration §3.1, lalu `pnpm exec supabase migration up --local`. **Dilarang** `db reset`.
- [ ] Jalankan `pnpm db:test` (PASS; catat total), `pnpm db:lint`, `pnpm db:types`, dan migration list (22/22).
- [ ] Commit `feat(t13): add durable ai_jobs queue and consent RPCs`, lalu tulis receipt.

### Fase 2 — Domain dan provider (TDD unit)

- [ ] Tulis unit test yang gagal lebih dulu:
  - `ai-contracts`: parity versi consent dan konstanta.
  - `detect-result`: fixture valid dan invalid, `potential=false` dengan suggestion ditolak, `questions > 3` ditolak, metric ungrounded ditolak, dan Zod setara dengan JSON Schema.
  - `ai-minimize`: kunci tetap, dan sentinel nama/email/ID tidak ada di payload.
  - `openai-provider`: memakai `fetch` palsu dan memeriksa header `Authorization` tanpa pernah menulisnya ke output. Body berisi `store:false`, `strict:true`, dan model dari config. Pemetaan 401/429/500/abort/refusal/incomplete/JSON rusak sesuai §2.2.11. Error tidak memuat isi respons maupun key.
  - `ai-provider-resolve`: default `unavailable`; `fake` di production dilempar; `openai` tanpa key/model → `AI_CONFIG_INVALID`; base URL `http` non-localhost ditolak.
- [ ] Implementasikan hingga PASS. Jalankan `pnpm test`, `pnpm typecheck`, dan `pnpm lint`. Commit, lalu tulis receipt.

### Fase 3 — Worker dan service (unit + integration nyata)

- [ ] Unit `ai-worker` dengan harness `vi.fn` (pola `evidence-worker.test.ts`) mencakup alur sukses, 0 row input, error provider, output invalid, complete `stale`, dan kegagalan gateway. Stdout/ringkasan tidak boleh memuat sentinel teks.
- [ ] Unit `ai-job-service` dan `ai-consent-action` memakai fake client untuk memetakan kode DB ke kode service dan message key, termasuk UUID `correlationId`.
- [ ] Buat `tests/integration/ai-jobs.test.ts` dengan setup `achievement-lifecycle.test.ts`: admin, owner A, dan owner B melalui sign-in nyata. Worker dijalankan dengan gateway nyata dan fake provider berpenghitung. Skenario wajib:
  1. Tanpa consent: request → `CONSENT_REQUIRED`, 0 job, dan `analysis_state = not_requested`. Create/confirm Achievement manual tetap berhasil.
  2. Grant, lalu request ×5 paralel: satu job dengan id yang sama.
  3. Drain worker: `succeeded`, result lolos `detectResultSchema`, `analysis_state = done`, dan provider dipanggil satu kali dengan payload yang persis sesuai minimisasi.
  4. Edit saat queued → `STALE_INPUT` dan provider tidak dipanggil. Request untuk revisi 2 membuat job baru.
  5. Edit setelah input diambil dan sebelum complete (fake provider menjalankan hook edit) → `failed:STALE_INPUT` dengan result NULL.
  6. Withdraw saat queued → `CONSENT_REQUIRED` dengan 0 panggilan provider. Withdraw saat running → `CONSENT_WITHDRAWN`.
  7. Akun deleting (via `internal.mark_account_deleting` wrapper admin bila tersedia; bila tidak, lewati dan catat bahwa pgTAP sudah menutupnya) → `ACCOUNT_DELETING` dengan 0 panggilan.
  8. Retry hingga exhausted → `AI_RETRY_EXHAUSTED`.
  9. Adapter OpenAI nyata terhadap `openai-stub.ts` (HTTP 127.0.0.1): respons valid → succeeded; 429 → `AI_RATE_LIMITED`; refusal → `AI_REFUSED`; delay melebihi timeout uji (timeout di-inject kecil) → `AI_PROVIDER_TIMEOUT`.
  10. Mode `unavailable` → `AI_UNAVAILABLE`, disusul retry yang berhasil setelah mode diganti fake.
  11. Isolasi: B tidak dapat select job A, request pada activity A menghasilkan `NOT_FOUND`, dan retry job A juga `NOT_FOUND`.
  12. Log hygiene: tangkap `process.stdout.write`/`stderr` selama drain dan seluruh pesan error. Sentinel teks sumber dan key palsu berjumlah 0.
- [ ] Tambahkan `test:integration:ai` dan jalankan. Regresi: `test:integration:activity`, `achievements`, dan `m2`.
- [ ] Integrasikan `run.ts`/`bootstrap.ts`, perbarui script `worker:*` (`.env.ai.local`), lalu jalankan `pnpm worker:check` dan `pnpm worker:once` dengan mode `unavailable`.
- [ ] Commit per kelompok, lalu tulis receipt. Checkpoint Claude opsional dilakukan di sini.

### Fase 4 — UI consent S12

- [ ] Implementasikan §2.2.14, copy en/id (`ai.consent.*`), dan CSS berbasis token. Profil yang dimuat halaman S12 harus menyertakan `ai_consent_at`/`ai_consent_version`.
- [ ] Bila pola render test tersedia (`tests/unit/evidence-attachments-ui.test.tsx`), tambahkan unit render: status Not allowed/Allowed, tombol dialog, dan tidak ada gradient atau klaim analisis.
- [ ] Jalankan `pnpm test`, `pnpm typecheck`, `pnpm lint`, dan `pnpm test:e2e:auth` (regresi S12). Commit, lalu tulis receipt.

### Fase 5 — Browser acceptance dan regresi penuh

- [ ] Buat `playwright.ai.config.ts` (PORT 3007) dan `tests/e2e/ai-consent.spec.ts` dengan helper dari `achievements-ui.spec.ts`. Skenario:
  1. User baru membuka S12 dan melihat *Not allowed*. Buka dialog, tekan Escape: dialog tertutup, focus kembali ke *Allow AI…*, dan DB tetap NULL. Buka lagi, pilih *Continue manually*: tidak ada perubahan.
  2. *Allow AI* (keyboard-only): status berubah menjadi versi `ai-processing-v1` dan tanggal. Reload mempertahankan status.
  3. *Withdraw*: status kembali *Not allowed*. Quick log masih dapat menyimpan note, dan detail activity tidak menampilkan klaim analisis.
  4. Konflik: dua tab, tab 1 melakukan withdraw, lalu tab 2 melakukan allow. Tab 2 menampilkan conflict dan reload tanpa data hilang.
  5. Locale `id`: copy dialog dalam Bahasa Indonesia dan menyebut OpenAI, evidence tidak dikirim, dan fitur manual tetap tersedia.
  6. Axe pada S12 dan dialog terbuka. Tanpa overflow pada 360×800 dan 1440×900, light dan dark. Screenshot dilampirkan.
- [ ] Jalankan suite §7 lengkap. `test:e2e:m2` wajib tetap lulus tanpa melemahkan assertion env. Suite ClamAV dijalankan bila container tersedia; bila tidak, catat sebagai tidak dijalankan beserta alasannya.
- [ ] Tulis receipt.

### Fase 6 — Smoke live OpenAI (wajib untuk DONE)

- [ ] Prasyarat: pengguna sudah menyediakan key di `.env.ai.local` dan menyetujui panggilan. Tanpa itu, **stop**. T13 akan dicatat reviewer sebagai PARTIAL, dengan poin §1.11 sebagai blocker.
- [ ] Jalankan `WORKPULSE_AI_LIVE=1 pnpm test:ai:live`. Test memuat `.env.ai.local` di dalam proses test dan mengirim **satu** fixture sintetis dalam dua bahasa:
  - en: "Led migration of 3 reports to the new pipeline; cut weekly prep from 5 to 2 hours."
  - id: padanannya.

  Test mengasersi bahwa hasil lolos `validateDetectResult` beserta grounding.
- [ ] Jalankan juga satu job end-to-end: `worker:once` dengan `WORKPULSE_AI_MODE=openai` atas activity fixture sintetis milik akun test lokal, lalu verifikasi status `succeeded` dan `result` valid.
- [ ] Receipt mencatat model yang dikembalikan, latency, token usage bila tersedia, dan hasil `potential`, **tanpa** key, header, atau isi prompt lengkap. Jalankan grep key pada seluruh file yang berubah dan receipt; hasilnya harus 0.
- [ ] Serahkan kepada Claude: hash commit, diff, receipt Fase 0–6, output command, screenshot, hasil Axe/keyboard, dan daftar acceptance yang belum terbukti.

### Fase 7 — Draft dokumen (setelah gate Claude dan perbaikan P0–P2)

- [ ] Buat `docs/decisions/0019-t13-ai-jobs-consent.md`. Isinya: pilihan provider/model beserta alasan dan URL dokumentasi, `store:false` beserta batas retensi provider (jangan menjanjikan zero retention), keputusan §2.2 poin 1–13, error code, dan seam T14/T15/T21.
- [ ] Buat `docs/verification/T13-ai-jobs-consent.md` berisi pass/fail/warning/tidak dijalankan, dengan trace ke PRD §3/§4, F02, S12, DB §2/§3/§6, dan setiap poin §1.
- [ ] Perbarui README (bagian Worker/AI dan tabel quality gates) serta `.env.example` (nama variabel dan placeholder saja).
- [ ] Jangan mengubah bagian authoritative `IMPLEMENTATION_STATUS.md` dan jangan mengklaim DONE.

## 6. Fixture

- Owner A: locale `en`, timezone `Asia/Jakarta`, consent NULL di awal. Activity `AA1` (note, revisi 1) dengan `raw_text` berisi sentinel `WP-PRIVATE-SENTINEL-<uuid>` beserta metric "3 reports" dan "5 to 2 hours". Activity `AA2` berupa chat, untuk memastikan hanya `raw_text` yang dikirim.
- Owner B memiliki activity dan consent sendiri.
- Fake provider `valid` mengembalikan suggestion dengan metric `3` (grounded). Skenario `ungrounded` mengembalikan metric `40%`.
- Key palsu untuk test log: `sk-test-WP-SENTINEL-KEY`.

## 7. Commands

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm exec supabase migration list --local
pnpm test:integration:ai
pnpm test:integration:activity
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:dashboard
pnpm test:integration:m2
pnpm test:integration:evidence
pnpm test:e2e:ai
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:achievements
pnpm test:e2e:m2
pnpm test:e2e:evidence
pnpm worker:check
pnpm worker:once
pnpm build
git diff --check
```

Live smoke (Fase 6): `WORKPULSE_AI_LIVE=1 pnpm test:ai:live`. Script baru hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan.

## 8. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree tidak bersih di Fase 0, atau parity bukan 21/21.
- Penyelesaian memerlukan `db reset`, rewrite migration lama, operasi destruktif, atau perubahan daftar schema yang di-expose.
- Body `guard_activity_row` saat ini tidak dapat diperluas tanpa mengubah perilaku T06.
- Dokumentasi OpenAI terkini tidak mendukung structured output strict atau `store:false` seperti §2.2.11. Laporkan alternatifnya kepada reviewer.
- Test membutuhkan key nyata di luar Fase 6, key muncul di output, atau `m2-manual-journey` gagal karena env AI.
- Implementasi terasa memerlukan apply ke Achievement, UI Analyze, follow-up counter, import, atau kuota. Semua itu milik T14/T15.
- Smoke live gagal karena akun, billing, atau kuota provider. Jangan mencoba model lain tanpa persetujuan.

## 9. Gate review Claude (setelah Fase 6)

Review read-only mencakup:

- Tidak ada write langsung ke `ai_jobs` (termasuk dari service_role), kolom lease/token tidak dapat dibaca client, dan RLS berfungsi.
- Guard CAS token dan lease ada pada input, complete, dan fail. Lease kedaluwarsa menjadi `AI_TIMEOUT`. Tidak ada retry otomatis. Batas 3 attempt diperiksa di DB.
- Consent diperiksa pada request, input, dan complete. Versi berasal dari satu sumber SQL dan parity dengan TypeScript terbukti.
- Revisi dicocokkan pada setiap langkah. Trigger reset `analysis_state` tidak mengubah semantik revisi T06.
- Idempotency: key diturunkan server, uji paralel lulus, dan key sama dengan hash berbeda ditolak.
- Minimisasi payload dibuktikan snapshot. Evidence dan identitas tidak dikirim.
- Tidak ada teks sumber atau key di log/error. Pesan gateway dan provider tetap.
- Fake provider tidak dapat aktif di production. Mode default `unavailable`.
- UI consent: dialog dengan dua pilihan, focus return, conflict, en/id, Axe, dan responsif. Tidak ada klaim analisis di halaman lain.
- Smoke live benar-benar dijalankan dan hasilnya dicatat tanpa secret.

Temuan **P0–P2** memblokir penerimaan. P3 dicatat sebagai follow-up. Hanya reviewer yang mengubah status authoritative.

## 10. Review Focus — risiko yang paling mungkin lolos

1. **Worker terlambat menulis:** complete tanpa pemeriksaan `lease_expires_at > now()` atau tanpa lock activity membuat hasil stale tersimpan. Dijaga oleh pgTAP poin 8/10 dan integration 5.
2. **Consent hanya dicek saat enqueue:** job queued tetap dikirim ke provider setelah withdraw. Dijaga oleh integration 6, dengan penghitung panggilan provider = 0.
3. **`analysis_state` menyesatkan:** job lama menimpa state activity yang revisinya sudah baru. Dijaga oleh aturan update hanya bila revisi cocok dan oleh pgTAP 6.
4. **Kebocoran teks:** error dari fetch/Zod ikut membawa isi respons atau input ke log. Dijaga oleh integration 12, unit provider, dan grep sentinel.
5. **Env AI bocor ke proses web/E2E:** assertion M2 gagal atau malah dilemahkan. Dijaga oleh keputusan `.env.ai.local` yang hanya dibaca worker dan regresi `test:e2e:m2`.
