# T21 Fase 7 — Regresi penuh

- Tanggal: 6 Oktober 2026
- Status: **PASSED** (semua command §7 lulus; tidak ada yang dilewati)
- Commit: `test(t21): record regression receipt`
- HEAD kode sebelum receipt ini: `525a9ee` (cabang `claude/clever-archimedes-gbu7qd`)

## Tujuan

Menjalankan seluruh daftar §7 plan terhadap stack lokal nyata dan membuktikan T02–T20, gate M2/M3, dan T21 lulus
bersama tanpa melemahkan assertion apa pun.

## Lingkungan

Supabase lokal (`supabase_db_WorkPulse` dkk., migration 31/31), ClamAV T10 (`workpulse-t10-clamav`, 127.0.0.1:13310),
Gotenberg T15 (`workpulse-t15-gotenberg`, 127.0.0.1:13400), renderer PDF T21 (`workpulse-t21-pdf`, 127.0.0.1:13401).
Env per command: `.env.local`, `SERVICE_ROLE_KEY` (JWT) dari `supabase status -o env` sebagai `SUPABASE_SECRET_KEY`
ke env proses saja, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`; untuk seluruh batch `AI_AGENT` dan
`ANTHROPIC_BASE_URL` dikosongkan (wajib untuk `test:e2e:m2/m3`). Key tidak dicetak ataupun disimpan. Catatan lingkungan:
container `supabase_vector_WorkPulse` berstatus *Restarting* selama sesi (komponen logging Supabase; tidak dipakai
suite mana pun dan tidak memengaruhi hasil).

## Hasil (exit code dan angka aktual)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | `Already up to date` |
| `pnpm lint` | 0 | tanpa warning (`--max-warnings 0`) |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm test` | 0 | **97 file / 836 test** (baseline Fase 0: 89 / 706) |
| `pnpm db:test` | 0 | **15 file / 1290 assertion, PASS** (baseline 14 / 1115; +`cv_export.test.sql` 175) |
| `pnpm db:lint` | 0 | `{"results":[]}` |
| `pnpm db:types` (regenerasi ke berkas sementara) | 0 | identik byte-per-byte dengan `src/server/supabase/database.types.ts` yang di-commit (79.547 byte, tanpa BOM), tanpa drift |
| `pnpm exec supabase migration list --local` | 0 | **31 local = 31 remote**, terakhir `20261005090000` |
| `pnpm test:integration:cv-export` | 0 | **2 file / 23 test** |
| `pnpm test:integration:cv-freshness` | 0 | 11 |
| `pnpm test:integration:cv-builder` | 0 | 7 |
| `pnpm test:integration:cv` | 0 | 10 |
| `pnpm test:integration:achievements` | 0 | 5 |
| `pnpm test:integration:projects` | 0 | 7 |
| `pnpm test:integration:activity` | 0 | 6 |
| `pnpm test:integration:dashboard` | 0 | 4 |
| `pnpm test:integration:import-commit` | 0 | 11 |
| `pnpm test:integration:import-review` | 0 | 6 |
| `pnpm test:integration:import` | 0 | 21 (2 file; termasuk `import-renderer-real` dengan Gotenberg T15) |
| `pnpm test:integration:m2` | 0 | 8 |
| `pnpm test:integration:m3` | 0 | 7 |
| `pnpm test:integration:ai` | 0 | 13 |
| `pnpm test:integration:ai-review` | 0 | 21 |
| `pnpm test:integration:evidence` | 0 | 14 (3 file; termasuk scanner ClamAV nyata) |
| `pnpm test:integration:storage` | 0 | 1 |
| `pnpm test:e2e:cv-freshness` | 0 | 10 passed |
| `pnpm test:e2e:cv` | 0 | 8 passed |
| `pnpm test:e2e:achievements` | 0 | 4 passed |
| `pnpm test:e2e:projects` | 0 | 1 passed |
| `pnpm test:e2e:dashboard` | 0 | 1 passed |
| `pnpm test:e2e:auth` | 0 | 1 passed |
| `pnpm test:e2e:ui` | 0 | 1 passed |
| `pnpm test:e2e:activity` | 0 | 1 passed (flaky bawaan `activity-ui.spec.ts:356` **tidak** muncul pada run ini) |
| `pnpm test:e2e:import` | 0 | 7 passed |
| `pnpm test:e2e:import-review` | 0 | 10 passed |
| `pnpm test:e2e:ai` | 0 | 2 passed |
| `pnpm test:e2e:ai-review` | 0 | 11 passed |
| `pnpm test:e2e:evidence` | 0 | 8 passed |
| `pnpm test:e2e:m2` | 0 | 1 passed |
| `pnpm test:e2e:m3` | 0 | 2 passed |
| `pnpm worker:check` | 0 | `registeredJobs` 8 entri, termasuk `cv-export` dan `export-cleanup` |
| `pnpm build` | 0 | build produksi sukses; tanpa route baru |
| `git diff --check` (working tree, index, dan `5ebf1b2..HEAD`) | 0 | tanpa kesalahan whitespace |

Total: integration **175 test** dalam 17 command, e2e **68 test** dalam 15 command, semuanya hijau pada run pertama.
Perintah dijalankan berurutan oleh satu runner (log per command di scratchpad sesi); tidak ada yang diulang.

## Pemeriksaan diff

- `git diff 5ebf1b2 --name-status -- supabase/migrations`: hanya `A  supabase/migrations/20261005090000_t21_cv_export_backend.sql`;
  tidak ada migration lama berubah. 22 fungsi T21 seluruhnya nama baru: tidak ada yang beririsan dengan fungsi
  migration lain (diperiksa terhadap seluruh `create [or replace] function` migration lama), sehingga fungsi T18–T20,
  RPC update/delete sumber, dan `get_dashboard_summary` tidak diubah. Grant tabel `cv_exports` T18 tidak diubah.
- Berkas sumber lama yang berubah hanya secara aditif (baris dihapus hanyalah baris yang diganti dengan versi yang diperluas):
  `contracts.ts`, `actions.ts`, `cv-errors.ts`, `messages.ts`, `parse-in-thread.ts`, `parser-thread.ts`, `pdf-text.ts`,
  `workers/{run,bootstrap}.ts`, `.env.example`, `package.json`, `database.types.ts`. Tidak ada berkas di `src/app/` atau
  `src/components/`: **tanpa UI atau route baru**; tanpa dependency npm baru (`pnpm-lock.yaml` tidak berubah).
- Suite lama yang disentuh: `tests/unit/cv-contracts.test.ts` (daftar kode error diperluas dan test T21 ditambah),
  `tests/unit/worker-bootstrap.test.ts` (dua job baru), `tests/unit/cv-fixtures.ts` (helper aditif). Tidak ada assertion
  yang dilemahkan atau dihapus.
- `docs/IMPLEMENTATION_STATUS.md` tidak disentuh oleh commit mana pun dari pelaksanaan ini (hanya commit plan
  `d8ac9ff`/`e3effde` sebelum pelaksanaan).
- `grep console.` pada `src/features/cv`, `src/server/export`, `workers/export-worker.ts`, `workers/supabase-export-gateway.ts`: 0.
- Sisa data uji setelah seluruh batch: `cv_exports` 0 baris, objek storage `/export/` 0, storage job export
  queued/running 0, akun uji `cve-*` 0.

## Acceptance §1 — status per poin

| Poin | Status | Bukti |
| --- | --- | --- |
| 1 Kesiapan dari satu definisi | Terbukti | pgTAP `cv_export.test.sql` (blocker per kode, `kept` lolos, skill/sertifikat saja tidak cukup); integration (`ITEM_CHANGED`, `ITEM_DELETED`, `CONTENT_REQUIRED`) |
| 2 Request atomik | Terbukti | pgTAP (baris `queued`, `CV_EXPORT_BLOCKED` tanpa write, error lain) dan integration (fingerprint CV tak berubah) |
| 3 Snapshot immutable dan lengkap | Terbukti | pgTAP (sepuluh kunci, lima kunci item, tanpa kunci privat, trigger `CV_EXPORT_IMMUTABLE`, tanpa grant tulis); integration (klien tidak dapat `update`/`delete`) |
| 4 Worker tidak membaca career rows | Terbukti | integration (edit setelah request dan edit setelah render tidak mengubah PDF); kredensial service tidak dapat membaca tabel CV/career; gateway hanya memakai RPC |
| 5 Race | Terbukti | 5 skenario × 3 putaran resmi + 40 putaran stres, tanpa `40P01`; kedua urutan teramati (lihat receipt Fase 6) |
| 6 Idempotency, tanpa job ganda | Terbukti | pgTAP + integration (dua request paralel → satu export) |
| 7 Durable job | Terbukti | pgTAP (claim, lease, token, CAS) + integration (worker kehilangan lease → stale, objek dihapus, timeout, retry) |
| 8 Render gagal mempertahankan CV | Terbukti | integration (fingerprint dan revision CV tetap; tanpa objek) |
| 9 Retry snapshot sama | Terbukti | pgTAP + integration (hash snapshot identik, batas tiga attempt, kode permanen) |
| 10 PDF A4 yang dapat dicari (renderer nyata) | Terbukti secara lokal | integration renderer nyata: A4 595 × 842 ± 1, teks `en`/`id`, bullet Indonesia, multipage ≤ 20, tanpa id/object key/`evidence`; gagal keras tanpa renderer |
| 11 Verifikasi output di worker | Terbukti | unit (non-PDF, kosong, > 10 MiB, 20/21 halaman, tanpa nama, parser gagal, nama terpecah baris) dan integration (`EXPORT_TOO_LONG` dengan parser nyata); sisi > 10 MiB hanya pada unit dengan renderer palsu (renderer nyata dibatasi 10 MiB pada adapter, diuji unit) |
| 12 Kedaluwarsa 24 jam | Terbukti | pgTAP + integration |
| 13 Unduhan ≤ 5 menit | Terbukti | integration (TTL dari klaim `exp` ≤ 305 detik, tanpa field key, akun lain/ID acak tak terbedakan) |
| 14 Orphan | Terbukti | pgTAP + integration |
| 15 Akun deleting | Terbukti | pgTAP + integration (sebelum claim dan di tengah job) |
| 16 Fake hanya dev/test | Terbukti | unit (`resolvePdfRenderer`) + proses worker nyata (`production` → `WORKER_UNAVAILABLE`, `test` → `explicit-test-fake`) |
| 17 Paritas preview–export | Terbukti | unit (`toEqual` dengan `buildCvPreviewModel`, `en`/`id`) |
| 18 Tanpa perubahan perilaku lama | Terbukti | regresi penuh di atas; migration hanya tambahan; tanpa UI |
| 19 Log hygiene | Terbukti | integration (sentinel 0), unit, grep `console.` = 0 |

## Acceptance atau hal yang **belum** terbukti, dan alasannya

- QA visual PDF (heading yatim, clipping per halaman, inspeksi gambar halaman) — sengaja milik T22 (`tests/pdf/`).
  Yang terbukti hanyalah A4, teks terekstrak, awal/akhir bullet utuh, dan jumlah halaman.
- Isolasi renderer di staging/produksi dan latensi render — T25 / T24; hasil di sini adalah container lokal.
- Tombol/halaman S14 (`/cv/preview`), polling status, nama file unduhan — T22.
- Pembersihan objek export saat penghapusan akun lintas kategori dan event analytics export — T23.
- Race hanya diuji dengan dua koneksi nyata per skenario (bukan beban banyak koneksi).
- Sisi > 10 MiB pada worker hanya diuji unit (renderer palsu); probe Fase 0 menunjukkan parser menerima PDF 9,26 MiB.
- Smoke live dengan penyedia AI tidak relevan untuk T21 (tanpa AI).

## Penyimpangan, keputusan, dan catatan untuk gate review

1. **Dedup setelah validasi** (receipt Fase 1): urutan §2.2.6 dipilih atas urutan butir daftar §2.2.4; lookup
   idempotency tetap sebelum cek revision.
2. **Jenis parse `pdf-export`** menyentuh `src/server/documents/{parse-in-thread,parser-thread,pdf-text}.ts` (berkas
   bersama T15) secara aditif agar CV pendek tidak ditolak sebagai `SCANNED_PDF` (receipt Fase 4); jenis lama tidak
   berubah dan seluruh suite import lulus.
3. **Owner dapat membaca snapshot dan `object_key` miliknya lewat PostgREST** karena grant `select` T18 pada
   `cv_exports` (RLS select-own) dipertahankan sesuai larangan mengubah grant T18. Aksi dan service tidak pernah
   mengembalikan key, dan key tidak dapat diunduh tanpa signed URL, tetapi kalimat §2.2.13 "object key tidak pernah
   sampai ke browser" hanya berlaku pada lapisan aplikasi. Mitigasi (grant kolom atau view) membutuhkan perubahan
   grant T18 → butuh keputusan reviewer/pengguna.
4. Dua helper murni (`cv_export_effective_name`, `is_permanent_export_error`) bukan `security definer` (immutable,
   hanya membaca argumen).
5. Kunci ringkasan worker `exportErrored` ditambahkan (hitungan kegagalan tak terduga); kunci lain sesuai plan.
6. `tests/unit/cv-contracts.test.ts` diperluas (bukan dilemahkan): daftar kode error pinned menjadi 23 kode.
7. Dalam dua request paralel dengan key berbeda hanya request yang membuat export menyimpan key-nya; request lain
   dijawab dengan export aktif (`reused: true`) tanpa menyimpan key (perilaku yang sesuai, didokumentasikan di test).
8. Signed URL memuat path objek `<user>/export/<attempt_token>` (mekanisme Storage); tidak ada field key terpisah.
9. Output `pnpm db:start`/`db:status` pada sesi ini mencetak key demo Supabase lokal ke konsol (key standar CLI lokal,
   bukan secret proyek); tidak disalin ke berkas atau receipt.
10. Fase 8 (decision 0027, `T21-cv-export-backend.md`, README, finalisasi runbook), penandaan DONE, dan bagian
    authoritative `IMPLEMENTATION_STATUS.md` **tidak dikerjakan** menunggu gate review Claude.

## Blocker

Tidak ada.

## Langkah berikutnya

Serah terima ke gate review Claude (read-only): ulangi command §7 yang relevan, tinjau checklist §9 plan, lalu — setelah
perbaikan P0–P2 bila ada — Fase 8 dan penutupan.
