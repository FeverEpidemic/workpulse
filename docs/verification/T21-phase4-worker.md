# T21 Fase 4 — Worker export

- Tanggal: 6 Oktober 2026
- Status: **PASSED**
- Commit: `feat(t21): add CV export worker`

## Tujuan

Worker yang mengklaim export dengan lease 120 detik, membaca **hanya** snapshot tersimpan, merender template cetak
lewat `PdfRenderer`, memverifikasi hasilnya, mengunggah ke `<user>/export/<attempt_token>`, menyelesaikan job dengan CAS,
dan membersihkan objek kedaluwarsa/yatim; terdaftar di proses worker tanpa menghentikan pass lain.

## File berubah

- `workers/export-worker.ts` (baru: `runExportWorkerOnce`, tipe gateway/storage/ringkasan)
- `workers/supabase-export-gateway.ts` (baru: RPC service-role dan Storage privat)
- `workers/run.ts` (pass export terisolasi, ringkasan `exportWorker`, penanda `pdfRenderer: "explicit-test-fake"`),
  `workers/bootstrap.ts` (`cv-export`, `export-cleanup`), `.env.example` (tiga env renderer PDF, default `unavailable`)
- `src/server/documents/{parse-in-thread,parser-thread,pdf-text}.ts` — tambahan **aditif** jenis parse `pdf-export`
  (lihat Keputusan 1)
- `tests/unit/{export-worker,export-pdf-verify}.test.ts` (baru), `tests/unit/worker-bootstrap.test.ts` (daftar job)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 4), receipt ini

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `vitest run … export-worker export-pdf-verify worker-bootstrap` (sebelum implementasi) | 1 | **FAIL**: 3 file gagal (modul dan jenis parse belum ada) |
| idem (setelah implementasi, run pertama) | 1 | 16 failed — fixture test: revision job default 8 ≠ revision dokumen fixture 1 (kesalahan test) |
| idem (setelah perbaikan fixture) | 0 | 3 file, **34 passed** (29 + 4 + 1) |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm lint` | 0 | tanpa warning |
| `pnpm worker:check` | 0 | `registeredJobs` memuat `cv-export` dan `export-cleanup` (8 entri) |
| `pnpm test` | 0 | **94 file / 786 test passed** (Fase 3: 92 / 753) |
| `node workers/run.ts --once` (mode `gotenberg`, DB lokal nyata) | 0 | ringkasan JSON memuat seluruh hitungan export = 0; RPC housekeeping (`expire_cv_exports`, `reconcile_orphan_export_objects`, `claim_cv_export_jobs`, `claim_export_cleanup_jobs`) berhasil terhadap database nyata |
| idem dengan `WORKPULSE_PDF_RENDERER_MODE=fake`, `NODE_ENV=production` | 1 | `WORKER_UNAVAILABLE` (fake ditolak) |
| idem dengan `NODE_ENV=test` | 0 | ringkasan memuat `"pdfRenderer":"explicit-test-fake"` |

## Acceptance yang terbukti pada fase ini (unit + proses worker)

- Jalur sukses: claim → input → render → verifikasi → upload ke `<user>/export/<attempt_token>` (`application/pdf`,
  metadata tanpa nama) → `completeCvExport` dengan halaman dan byte aktual; HTML yang dirender berasal dari snapshot
  tersimpan (nama non-ASCII, wording override, `lang`).
- §1.11 verifikasi: bukan `%PDF-`, kosong, > 10 MiB → `EXPORT_RENDER_INVALID`; 20 halaman diterima dan 21 →
  `EXPORT_TOO_LONG` (juga dengan parser nyata dan PDF 22+ halaman); teks tanpa nama efektif atau kegagalan parser →
  `EXPORT_RENDER_INVALID`; nama yang dipecah baris/terdekomposisi tetap cocok (NFC + whitespace); semua lewat parser thread
  terisolasi (`pdf-export`).
- Snapshot tidak valid (key asing, revision berbeda dari claim, tanpa nama, baris claim dengan owner rusak) →
  `EXPORT_SNAPSHOT_INVALID` tanpa render; input kosong (lease basi/akun deleting) → stale tanpa render dan tanpa
  report; id/token rusak → stale tanpa aksi.
- Renderer gagal → kode renderer diteruskan tanpa upload; upload gagal → `STORAGE_UNAVAILABLE` tanpa complete;
  `complete` = `stale` atau `failed:ACCOUNT_DELETING` → objek attempt sendiri dihapus; `complete` melempar → objek
  dipertahankan (commit mungkin terjadi) dan dihitung `exportErrored`; laporan gagal yang basi dihitung stale.
- Satu job gagal tidak menghentikan job lain; limit claim 1–10 dan housekeeping 1–100 divalidasi; seam `onRendered`
  dipanggil setelah render dan sebelum complete; housekeeping berurutan (`expire`, `orphans`, `claim`).
- Cleanup: hapus objek lalu verifikasi hilang lalu complete; objek sudah hilang → complete tanpa delete; gagal
  verifikasi/storage → retry dengan backoff (`OBJECT_DELETE_UNVERIFIED`, `STORAGE_UNAVAILABLE`); key bukan
  `<owner>/export/<uuid>` → `INVALID_OBJECT_KEY` tanpa menyentuh storage.
- Ringkasan hanya hitungan dan kode; test sentinel membuktikan tidak ada nama, teks, token, ID, atau key.
- §1.16 (bagian proses): fake ditolak di production dan ditandai `explicit-test-fake` di test/development.
- Short CV (< 200 karakter teks) lolos verifikasi worker, padahal parser import menolaknya sebagai `SCANNED_PDF`.

## Keputusan implementasi / penyimpangan (untuk gate review)

1. **Jenis parse `pdf-export` (menyentuh berkas bersama T15).** `parseInThread("pdf")` menerapkan ambang import 200
   karakter dan batas 20 halaman, sehingga CV pendek yang sah akan ditolak sebagai `SCANNED_PDF` (temuan Fase 0).
   Ditambah `readExportPdf` di `pdf-text.ts`, kondisi `pdf-export` di `parser-thread.ts`, dan anggota union `ParseKind`.
   Jenis `pdf`, `docx`, `pdf-pages` **tidak berubah** (test `leaves the import kinds unchanged` dan seluruh test import
   lama lulus). PDF di atas batas halaman export hanya dilaporkan jumlah halamannya tanpa ekstraksi teks. Tidak ada
   dependency baru; perubahan tambahan ini memenuhi perintah plan "verifikasi lewat parser thread terisolasi" tanpa
   melanggar perilaku import.
2. **`exportErrored`** ditambahkan ke ringkasan (satu hitungan) agar kegagalan tak terduga tidak tersamar; kunci
   ringkasan lain sesuai plan.
3. Anggaran render worker 80 detik (`EXPORT_RENDER_BUDGET_MS`) agar verifikasi, upload, dan complete tetap muat dalam
   lease 120 detik; lease habis → `complete` mengembalikan `stale` dan objek dihapus.
4. Gateway memakai klien Supabase langsung untuk Storage (alias `@/` tidak tersedia bagi worker); `upload` dengan
   `upsert: false` pada key per attempt.
5. Variabel di `run.ts` dinamai `exportPass` (bukan `exports`) agar tidak ambigu dalam modul ESM.

## Belum dibuktikan (fase berikutnya)

Gateway Supabase terhadap Storage dan RPC nyata saat ada job (Fase 6); race; renderer nyata di dalam worker; lease
dan retry end-to-end.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 5: service `src/features/cv/export-service.ts`, pemetaan error, server action, kunci i18n en/id.
