# Rencana Remediasi Review T21 — Immutable export backend

Status plan: **OPEN** — menunggu persetujuan pengguna atas verdict dan klasifikasi, lalu eksekusi RV1.

- Tanggal: 6 Oktober 2026.
- Reviewer: Claude (Opus), gate review read-only setelah Fase 7 (`T21-implementation-plan.md` §9–§10).
- HEAD yang direview: `c0f5d41` (branch `claude/clever-archimedes-gbu7qd`, baseline `5ebf1b2`, sepuluh commit T21 `d8ac9ff..c0f5d41`).
- Verdict: **BELUM LULUS — 1 temuan P2 terbuka (RV1).** Tidak ada P0 atau P1. T21 tetap **PARTIAL** (bagian authoritative `IMPLEMENTATION_STATUS.md` tidak diubah sampai review ulang).
- Eksekutor remediasi: satu agent, tanpa sub-agent, TDD (test gagal → perbaikan minimal → lulus). Tanpa migration, tanpa perubahan RPC/SQL T18–T21, tanpa `db reset`, tanpa dependency baru. Setelah review ulang lulus, lanjut Fase 8 plan (decision 0027, `T21-cv-export-backend.md`, runbook final, README).

## 1. Ringkasan temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | Verifikasi nama di worker menolak PDF sah untuk nama beraksara CJK, Arab, Ibrani, Devanagari, atau berkarakter kompatibilitas (ligatur): setiap attempt dan setiap request baru berakhir `EXPORT_RENDER_INVALID`, sehingga pengguna tersebut tidak pernah dapat mengekspor | OPEN |
| N1 | P3 | Tidak ada export sukses di integration yang memuat item skill atau certification; snapshot worker strict sehingga mismatch SQL↔Zod untuk dua tipe ini akan menjadi kegagalan permanen tanpa terdeteksi. Probe reviewer (fake + Chromium nyata) lulus dan URL kredensial tidak tercetak | Kerjakan bersama RV1 (test saja) |
| N2 | P3 | Retry export lama tidak memvalidasi ulang (sesuai keputusan §2.2.9/§2.4.4 yang disetujui), termasuk setelah sumber di dalam snapshot dihapus; PDF baru dapat memuat teks sumber yang sudah dihapus. Baris `cv_exports` (dan snapshot-nya) tidak pernah dipurge, hanya objeknya | Diterima; catat di decision 0027. T22: tawarkan *Retry* hanya bila `cv_revision` export = revision CV saat ini, selain itu *Regenerate*. T23: tinjau retensi snapshot |
| N3 | P3 | Pemilik dapat membaca `snapshot`, `object_key`, `attempt_token`, `idempotency_key` export miliknya lewat PostgREST (grant select T18 dipertahankan). Policy restriktif `workpulse_private_server_only` (`20260917134500_t05_storage_policy_hardening.sql`) menutup bucket untuk `anon`/`authenticated`, jadi key tidak berguna tanpa signed URL; kalimat §2.2.13 "object key tidak pernah sampai ke browser" hanya berlaku di lapisan aplikasi | Diterima; catat di decision 0027 (grant kolom = perubahan grant T18, di luar scope) |
| N4 | P3 | Kualitas teks PDF untuk aksara non-Latin tertentu: CJK diekstrak sebagai radikal Kangxi (`小` → `⼩`), Arab/Ibrani dalam urutan visual, Devanagari kehilangan karakter. Ini batas ToUnicode Chromium/font image, bukan bug template | T22 (QA PDF Unicode) mencatat cakupan "searchable text": terverifikasi untuk Latin (termasuk Indonesia/Vietnam), Yunani, Sirilik, Thai, Hangul |
| N5 | P3 | Hardening renderer untuk T25: container `workpulse-t21-pdf` masih membuka rute LibreOffice (`/health` melaporkan `libreoffice: up`) yang tidak dipakai export; `WORKPULSE_PDF_RENDER_TIMEOUT_MS` menerima sampai 90.000 ms sedangkan anggaran render worker 80.000 ms (`EXPORT_RENDER_BUDGET_MS`) | Follow-up runbook final (Fase 8) dan T25 |
| N6 | P3 | Dedup mengembalikan export `succeeded` revision sama walau sisa umurnya tinggal beberapa detik; unduhan berikutnya dapat langsung `CV_EXPORT_EXPIRED` | T22: setelah `reused` + `EXPORT_EXPIRED`, tawarkan *Regenerate* tanpa langkah ekstra |
| N7 | P3 | `reconcile_orphan_export_objects` dijalankan setiap pass worker dan memakai `not exists` atas `cv_exports.object_key` tanpa index; biaya tumbuh dengan jumlah objek export < 24 jam | T24 (ukur; pertimbangkan index parsial `object_key`) |
| N8 | P3 | Nama efektif SQL hanya men-trim spasi ASCII (`E' \t\r\n'`), sedangkan `effectiveExportName` men-trim whitespace Unicode. Nama yang hanya berisi NBSP (hanya dapat dibuat lewat RPC langsung; constraint profil memakai `btrim`) lolos `NAME_REQUIRED` tetapi gagal permanen `EXPORT_SNAPSHOT_INVALID` di worker | Follow-up; catat di decision 0027 |

## 2. RV1 — Verifikasi nama menolak PDF sah untuk aksara non-Latin tertentu (P2)

**Gejala.** CV siap ekspor dengan nama efektif non-Latin dirender Chromium nyata menjadi PDF A4 yang valid, tetapi worker menggagalkannya dengan `EXPORT_RENDER_INVALID`. Kode itu retriable namun deterministik: tiga attempt gagal, `retry_cv_export` lalu `CV_EXPORT_NOT_RETRYABLE`, dan request baru gagal dengan cara yang sama. Pengguna tidak punya jalan keluar selain mengganti nama. Ini melanggar PRD R10 (*export the saved CV revision … failure … supports retry*) dan F07 (export CV yang valid), dan acceptance §1.11 hanya menguji nama Latin.

Probe reviewer (template + `GotenbergPdfRenderer` nyata `workpulse-t21-pdf` + `parseInThread("pdf-export")`, aturan cocok worker saat ini):

| Nama | Teks yang diekstrak | Hasil cek nama |
| --- | --- | --- |
| `李小龙`, `山田太郎`, `陈大文`, `王小明` | `李⼩⻰`, `⼭⽥太郎`, `陈⼤⽂`, `王⼩明` (radikal Kangxi/CJK) | gagal |
| `محمد عبدالله` | `ﻪﻠﻟاﺪﺒﻋ ﺪﻤﺤﻣ` (presentation forms, urutan visual) | gagal |
| `דוד כהן` | `כהן דוד` (urutan kata visual) | gagal |
| `प्रिया शर्मा` | `या शमा` (karakter hilang) | gagal |
| `ﬁona ﬂores` (ligatur diketik pengguna) | `fiona flores` | gagal |
| Latin berdiakritik (`Ç Ñ ś`, Vietnam, NFD), Yunani, Sirilik, Thai, Hangul, emoji, `O'Brien & <Co>` | identik | lulus |

**Penyebab.** `workers/export-worker.ts:86-89` (`normalizeForMatch`: NFC + whitespace) dan `:143` (substring nama terhadap teks pdf.js). Teks pdf.js mengikuti ToUnicode dan urutan glyph yang ditulis Chromium untuk font di image; NFC tidak melipat radikal/presentation form/ligatur, aksara RTL keluar dalam urutan visual, dan shaping Devanagari tidak dapat dipetakan balik. Plan §2.2.16 mewajibkan cek nama tanpa memperhitungkan kasus ini; unit `tests/unit/export-worker.test.ts:241` hanya menguji pemecahan baris dan NFD.

**Perbaikan minimal (worker/domain saja; tanpa SQL).**

1. Pindahkan pencocokan ke fungsi murni yang diuji (mis. `exportTextShowsName(text, name, headings)` di `src/domain/cv/export.ts`, import relatif). Bandingkan setelah NFKC di kedua sisi dan setelah membuang semua whitespace. Nama dianggap ada bila muncul maju, atau terbalik per code point (RTL visual), atau setiap token nama (dipisah whitespace, NFKC) muncul maju atau terbalik.
2. Bila tetap tidak cocok **dan** nama memuat setidaknya satu huruf di luar aksara Latin, Yunani, dan Sirilik (`\p{L}` yang bukan `\p{Script=Latin}|\p{Script=Greek}|\p{Script=Cyrillic}`), terima bila teks memuat heading lokal setiap section yang dirender (`model.sections[].heading` dengan entry; berasal dari `CV_LABELS` en/id sehingga selalu Latin). Ini tetap membuktikan PDF berlapis teks yang dapat dicari.
3. Nama yang seluruhnya Latin/Yunani/Sirilik tetap memakai cek ketat (perlindungan utama tidak dilemahkan). Teks kosong, heading hilang, atau nama Latin yang hilang tetap `EXPORT_RENDER_INVALID`.
4. Tidak ada perubahan kode error, SQL, template, atau renderer. Catat aturan dan batasnya (N4) di decision 0027 pada Fase 8 sebagai penyempurnaan §2.2.16 yang disetujui reviewer.

**Test regresi (gagal dulu, lalu lulus).**

- Unit (`tests/unit/export-worker.test.ts` atau file unit baru untuk fungsi murni): string ekstraksi persis dari tabel probe di atas → lulus untuk CJK (radikal), Arab (presentation form terbalik), Ibrani (urutan kata), ligatur; Devanagari lulus hanya lewat fallback heading; nama Latin yang tidak ada di teks → `EXPORT_RENDER_INVALID`; nama non-Latin dengan heading hilang → `EXPORT_RENDER_INVALID`; kasus lama (`:232`, `:241`) tetap lulus.
- Integration renderer nyata (`tests/integration/cv-export-renderer-real.test.ts`): test baru yang mengekspor CV dengan nama `李小龙`, `محمد عبدالله`, dan `प्रिया शर्मा` (satu akun per nama) → `succeeded`, `page_count` sesuai, tanpa `failed`. Tunjukkan test ini gagal (`EXPORT_RENDER_INVALID`) sebelum perbaikan.
- N1 (integration, fake renderer, `tests/integration/cv-export.test.ts`): CV siap dengan skill terpilih, certification terpilih (dengan `credential_url`), dan achievement ber-skill → export `succeeded`; teks PDF memuat nama skill dan certification, tidak memuat host `credential_url`.

## 3. Checks yang wajib diulang setelah remediasi

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
pnpm test:integration:cv-export
pnpm test:integration:import
git diff --check 5ebf1b2..HEAD
```

Muat `.env.local`, `SUPABASE_SECRET_KEY` (nilai `SERVICE_ROLE_KEY` dari `supabase status -o env`) dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` dalam command yang sama dengan suite. `test:integration:import` hanya wajib bila berkas parser bersama (`src/server/documents/*`) tersentuh. Tulis hasil aktual (exit code, angka pass/fail, bukti test gagal sebelum perbaikan) di `docs/verification/T21-phase7b-remediation.md` dan commit `fix(t21): accept non-Latin names in the export text check`.

## 4. Bukti gate review (dijalankan ulang reviewer, HEAD `c0f5d41`)

Environment: Docker Desktop + Supabase lokal (parity migration **31/31**, terakhir `20261005090000`), ClamAV `workpulse-t10-clamav`, Gotenberg T15 `workpulse-t15-gotenberg`, renderer T21 `workpulse-t21-pdf` (flag sesuai runbook, diverifikasi `docker inspect`: digest `sha256:f29984bd…c769`, JavaScript mati, allow-list `^file:///tmp/.*`, webhook ditolak, 2 GiB, loopback 13401). `supabase_vector` restart-loop (tidak dipakai). `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal di env proses saja; `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **97 file / 836 test** (cocok receipt Fase 7) |
| `pnpm worker:check` | 0 | 8 job, termasuk `cv-export`, `export-cleanup` |
| `pnpm build` | 0 | tanpa route baru |
| `pnpm db:test` | 0 | **15 file / 1290 assertion, PASS** (`cv_export.test.sql` 175) |
| `pnpm db:lint` | 0 | `{"results":[]}` |
| `supabase gen types typescript --local --schema public` vs `database.types.ts` | 0 | identik (79.545 karakter setelah normalisasi BOM/EOL) |
| `supabase migration list --local` | 0 | 31/31 |
| `git diff --check 5ebf1b2..HEAD` | 0 | bersih |
| `test:integration:cv-export` | 0 | **2 file / 23 test** (renderer fake + Chromium nyata) |
| `test:integration:{cv-freshness,cv-builder,cv,achievements,projects}` | 0 | 11, 7, 10, 5, 7 |
| `test:integration:{import,import-commit,m3}` | 0 | 21 (termasuk renderer T15 nyata; parser bersama), 11, 7 |
| `test:e2e:{m2,m3,cv,cv-freshness}` | 0 | 1, 2, 8, 10 |
| Probe nama (22 nama, renderer nyata) | 0 | lihat tabel RV1 |
| Probe skill + certification (test sementara, dihapus setelah run) | 0 | 2/2: export `succeeded` dengan fake dan Chromium nyata, URL kredensial tidak tercetak (N1) |
| Sisa data setelah semua suite | — | `cv_exports` 0, objek `*/export/*` 0, storage job export aktif 0 |

Tidak dijalankan ulang oleh reviewer (mengandalkan receipt Fase 7, semua exit 0): `test:integration:{activity,dashboard,import-review,m2,ai,ai-review,evidence,storage}` dan `test:e2e:{achievements,projects,dashboard,auth,ui,activity,import,import-review,ai,ai-review,evidence}`. Alasan: T21 tidak menyentuh UI, route, atau domain tersebut; berkas bersama yang berubah (parser, `cv-errors`, `actions`) sudah dicakup suite di atas. Stres race (`WORKPULSE_CV_EXPORT_RACE_ROUNDS=8`) tidak diulang; run resmi 5 × 3 putaran lulus di dalam `test:integration:cv-export`.

## 5. Hal yang sudah diverifikasi lulus (read-only)

- **Request** (`request_cv_export`): `security definer`, `search_path = pg_catalog`, execute hanya `authenticated`; urutan profil (`for share`) → onboarding → validasi input → `cv_documents for update` tanpa cek revision → idempotency → `STALE_REVISION` → sumber `for share` kanonik experience → project → achievement → education → skill → certification (urut id) → blocker (`internal.cv_item_state`/`cv_profile_state` T20) → dedup → insert, satu transaksi. Penyimpangan "dedup setelah validasi" (receipt Fase 1) benar: memenuhi §2.2.6 dan risiko §10.4. `detail` hanya kode + `item_id` milik pemanggil.
- **Deadlock**: jalur edit lama mengunci sumber dengan urutan kanonik yang sama (`update_project`: experience share → project update; `relink_achievement_project`: experience → project → achievement update; propagasi activity: experience → project → activity → achievement; `save_achievement`: achievement → skill); jalur delete mengunci CV lebih dulu (T20). Race 5 skenario × 3 putaran tanpa `40P01`.
- **Snapshot**: dibangun dari baris tersimpan (`internal.cv_export_snapshot`), sepuluh key, item lima key urut section/position/id, tanpa `raw_text`/`contribution`/`metrics`/activity/evidence; trigger `CV_EXPORT_IMMUTABLE`; ukuran ≤ 4 MiB; klien tanpa grant tulis; service key tidak dapat membaca tabel CV/career.
- **State machine dan CAS**: constraint `cv_exports_state_check`; claim `for update skip locked`, lease 120 detik, token baru per attempt, `attempt_count ≤ 3`; `complete`/`fail` hanya dengan token aktif dan lease hidup; key objek wajib `<user>/export/<token>`; worker lama → `stale` dan objeknya dihapus; lease lewat → `EXPORT_TIMEOUT`; retry hanya snapshot sama, kode permanen ditolak; akun deleting → `ACCOUNT_DELETING`.
- **Worker**: hanya `get_cv_export_input`; verifikasi `%PDF-`, ≤ 10 MiB, 1–20 halaman lewat parser thread (`pdf-export` aditif, jenis import tidak berubah), teks; upload `upsert:false`; ringkasan hanya hitungan; fake ditolak di production (`resolvePdfRenderer`), default `unavailable`, konfigurasi buruk fail closed.
- **Template/renderer**: semua nilai di-escape; CSP `default-src 'none'`; tanpa script, `url()`, `@import`, hyperlink, atau field di luar model; website hanya teks; respons dibatasi 10 MiB; timeout gabungan.
- **Retensi dan unduhan**: `expires_at = finished_at + 24 jam`; `expire_cv_exports` → storage job kategori `export` + `purged_at`; cleanup dan reconcile hanya kategori `export`; CV tidak pernah berubah; unduhan owner-only, TTL 300 lewat `PrivateStorageService.issueDownload` (owner + kategori dicek ulang), akun lain/ID acak tak terbedakan.
- **Scope**: migration hanya file T21 baru (22 fungsi bernama baru), grant `cv_exports` T18 tetap, tanpa UI/route, lockfile tidak berubah, tanpa `console.` di jalur export; i18n en/id lengkap.
- **Receipt**: angka unit, pgTAP, integration, dan E2E yang diulang cocok dengan receipt Fase 7.
