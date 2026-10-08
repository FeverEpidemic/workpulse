# T21 Fase 7b — Remediasi gate review (RV1, N1)

- Tanggal: 6 Oktober 2026
- Status: **PASSED** — RV1 (P2) diperbaiki, N1 (P3) ditutup dengan test.
- Rencana: [`T21-review-remediation-plan.md`](T21-review-remediation-plan.md); persetujuan pengguna 6 Oktober 2026 ("Setuju semua, kamu kerjakan RV1 sendiri").
- Eksekutor: Claude (Opus), reviewer yang sama. Review ulang karena itu tidak independen penuh; ditopang test yang terbukti gagal tanpa perbaikan dan lulus dengan perbaikan.
- Baseline kode: `561362e` (gate review), sebelum itu `c0f5d41`.

## Perubahan

- `src/domain/cv/export.ts`: fungsi murni `exportTextShowsName(text, name, headings)`.
  - Nama yang seluruh hurufnya Latin, Yunani, atau Sirilik tetap dicek ketat: NFKC, whitespace diciutkan, substring maju. Dibanding sebelumnya hanya NFC diganti NFKC, sehingga ligatur yang diketik pengguna ikut cocok.
  - Nama dengan huruf aksara lain (dibandingkan setelah whitespace dibuang) diterima bila muncul maju atau terbalik per code point (Arab), atau semua kata muncul maju/terbalik (Ibrani). Bila tetap tidak cocok, diterima hanya bila teks memuat setiap heading section yang dirender (label en/id `CV_LABELS`); ini kasus radikal Han dan Devanagari yang lossy.
  - Teks kosong, nama kosong, atau heading yang hilang tetap ditolak.
- `workers/export-worker.ts`: `normalizeForMatch` dihapus. Worker menyimpan heading section yang dicetak template (section dengan entry tidak terhapus) dari model yang sama, lalu memakai `exportTextShowsName`. Kode error, SQL, template, renderer, dan parser tidak berubah.
- Test:
  - `tests/unit/export-name-match.test.ts` (baru, 8 test): string ekstraksi persis dari probe Chromium nyata (code point dicatat), aturan ketat Latin/Yunani/Sirilik (nama terbalik, urutan kata tertukar, atau heading saja tetap ditolak), fallback heading, kasus kosong.
  - `tests/unit/export-worker.test.ts` (+1): nama `李小龙` yang dicetak sebagai radikal lolos bila semua heading ada, dan gagal `EXPORT_RENDER_INVALID` bila satu heading hilang.
  - `tests/integration/cv-export-renderer-real.test.ts` (+3): CV bernama `李小龙`, `محمد عبدالله`, `प्रिया शर्मा` diekspor lewat Chromium nyata → `succeeded`, A4, jumlah halaman = `page_count`.
  - `tests/integration/cv-export.test.ts` (+1, N1): CV siap dengan skill, certification ber-`credential_url`, dan achievement ber-skill terpilih → `succeeded`. Teks memuat skill, certification, dan bullet, tanpa host URL kredensial.

## Bukti gagal → lulus

| Command | Exit | Hasil |
| --- | --- | --- |
| `vitest run tests/unit/export-name-match.test.ts tests/unit/export-worker.test.ts` (sebelum perbaikan) | 1 | test RV1 worker gagal (`李小龙` ditolak); file `export-name-match` gagal (fungsi belum ada) |
| `vitest … cv-export-renderer-real.test.ts -t "script"` (sebelum perbaikan, Chromium nyata) | 1 | 3 gagal: `succeeded: 0` untuk Han, Arab, dan Devanagari |
| `vitest run tests/unit/export-name-match.test.ts tests/unit/export-worker.test.ts` (sesudah perbaikan) | 0 | 2 file / 38 test |

## Checks ulang (§3 rencana remediasi)

Env: `.env.local`, `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (hanya env proses), `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`; container `workpulse-t21-pdf`, ClamAV T10, dan Gotenberg T15 hidup.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **98 file / 845 test** (sebelumnya 97 / 836: +8 name-match, +1 worker) |
| `pnpm worker:check` | 0 | 8 job termasuk `cv-export`, `export-cleanup` |
| `pnpm build` | 0 | tanpa route baru |
| `pnpm test:integration:cv-export` | 0 | **2 file / 27 test** (sebelumnya 23: +3 nama non-Latin nyata, +1 N1) |
| `git diff --check` (working tree) dan `git diff --check 5ebf1b2..HEAD` | 0 | bersih |

`test:integration:import` tidak diulang: berkas parser bersama (`src/server/documents/*`) tidak disentuh remediasi ini. Migration, pgTAP, dan E2E tidak diulang: tidak ada perubahan SQL atau UI. Hasil gate review di `561362e` tetap berlaku untuk keduanya.

## Batas

- Fallback heading membuktikan bahwa PDF berlapis teks, bukan bahwa nama non-Latin dapat dicari dengan benar. Untuk Han, teks berisi radikal; untuk Devanagari, sebagian karakter hilang (N4, milik QA PDF T22).
- Nama Latin, Yunani, dan Sirilik tetap memakai cek ketat.

## Langkah berikutnya

Review ulang: tidak ada P0–P2 terbuka. Lanjut Fase 8 plan: decision 0027 (catat aturan cek nama ini sebagai penyempurnaan §2.2.16, serta N2, N3, N8), `T21-cv-export-backend.md`, runbook final (N5), dan README. Setelah itu closeout.
