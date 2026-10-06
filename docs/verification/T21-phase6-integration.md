# T21 Fase 6 — Integration nyata

- Tanggal: 6 Oktober 2026
- Status: **PASSED**
- Commit: `test(t21): add CV export integration suites`

## Tujuan

Membuktikan backend export terhadap Supabase lokal nyata (Auth, PostgREST, Storage, dua koneksi paralel) dengan
worker dan gateway Supabase nyata, serta terhadap renderer Chromium nyata (`workpulse-t21-pdf`). Suite utama memakai
renderer **fake** yang ditandai eksplisit; suite renderer nyata gagal keras bila renderer tidak terjangkau dan tidak
pernah jatuh ke fake.

## File berubah

- `tests/integration/cv-export.test.ts` (19 test), `tests/integration/cv-export-renderer-real.test.ts` (4 test)
- `tests/integration/cv-export-support.ts` (helper bersama: akun nyata, sumber, `drain` worker, SQL pemilik database,
  pembacaan PDF; bukan file test)
- `package.json` (script `test:integration:cv-export`)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 6), receipt ini

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `vitest run … cv-export.test.ts` (run pertama) | 1 | 16 passed / 3 failed — kesalahan test (lihat "Perbaikan test") |
| `vitest run … cv-export.test.ts` (setelah perbaikan) | 0 | **19 passed** (98 s) |
| `vitest run … cv-export-renderer-real.test.ts` | 0 | **4 passed** (20 s) |
| idem dengan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:9` | 1 | **gagal keras** di `beforeAll` ("The PDF renderer is not reachable…"), 4 test dilewati; tidak ada fallback ke fake |
| `pnpm test:integration:cv-export` (script resmi, kedua file) | 0 | **2 file / 23 test passed** (109 s) |
| stres race: `WORKPULSE_CV_EXPORT_RACE_ROUNDS=8` (hanya 5 skenario race) | 0 | 5 test passed (98 s); 40 putaran, **0 deadlock** |
| `pnpm lint` / `pnpm typecheck` | 0 / 0 | tanpa warning / error |
| `pnpm test` | 0 | 97 file / 836 test passed (tidak berubah dari Fase 5) |
| `grep console.` di `src/features/cv`, `src/server/export`, `workers/export-worker.ts`, `workers/supabase-export-gateway.ts` | — | 0 kecocokan |

Env dimuat per command: `.env.local`, `SERVICE_ROLE_KEY` (JWT) dari `supabase status -o env` sebagai
`SUPABASE_SECRET_KEY` ke env proses saja, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`; container
`workpulse-t21-pdf`, ClamAV T10, dan Gotenberg T15 hidup. Key tidak dicetak.

## Hasil race (dua koneksi nyata; request vs mutasi; tanpa `40P01`/`40001`)

Run resmi, 3 putaran per skenario. Putaran 0: request dikirim lebih dulu; putaran 1 dan 2: mutasi dikirim lebih dulu
dan request menyusul 5 ms / 12 ms kemudian (agar request tiba saat mutasi memegang lock barisnya). Mutasi **selalu**
sukses (`{null,null}`); request berakhir pada salah satu hasil yang dinamai kontrak.

| Skenario | Putaran 0 | Putaran 1 | Putaran 2 |
| --- | --- | --- | --- |
| (a) edit sumber terpilih (`save_achievement`) | exported (snapshot sebelum mutasi) | `CV_EXPORT_BLOCKED` | `CV_EXPORT_BLOCKED` |
| (b) delete sumber terpilih | exported | `STALE_REVISION` | `STALE_REVISION` |
| (c) reopen ke draft | exported | `CV_EXPORT_BLOCKED` | `CV_EXPORT_BLOCKED` |
| (d) `save_cv_edits` | exported | `STALE_REVISION` | `STALE_REVISION` |
| (e) `update_profile` (nama) | exported | `CV_EXPORT_BLOCKED` | `CV_EXPORT_BLOCKED` |

Putaran dengan hasil `exported` memverifikasi isi PDF: wording lama ada, sentinel mutasi (`NEW-A-n`, `OVR-D-n`,
`Nama Baru n`) tidak ada. Putaran `CV_EXPORT_BLOCKED` memverifikasi `detail` memuat blocker yang tepat
(`ITEM_CHANGED`, `ITEM_UNCONFIRMED`, `PROFILE_CHANGED`) dan tidak ada baris export yang terbentuk.

Stres 8 putaran × 5 skenario (40 putaran; jeda start 0/5/12/20/3/8/0/15 ms), agregat hasil request:

| Skenario | request menang → exported | mutasi menang → blokir/stale | exported walau mutasi dikirim lebih dulu |
| --- | --- | --- | --- |
| (a) | 2 | 6 `CV_EXPORT_BLOCKED` | 0 |
| (b) | 2 | 5 `STALE_REVISION` | 1 |
| (c) | 2 | 5 `CV_EXPORT_BLOCKED` | 1 |
| (d) | 2 | 6 `STALE_REVISION` | 0 |
| (e) | 2 | 6 `CV_EXPORT_BLOCKED` | 0 |

Setiap export yang terbentuk memiliki snapshot konsisten dengan keadaan sebelum mutasi, dan setiap putaran tanpa export
tidak meninggalkan baris (`exportCount = 0`).

## Acceptance yang terbukti pada fase ini

- §1.1/§1.2 (integration): readiness `ready` dengan revision; `CV_EXPORT_BLOCKED` untuk `ITEM_CHANGED`, `ITEM_DELETED`,
  `CONTENT_REQUIRED` dengan blocker dan item id milik pemanggil; tanpa baris export dan fingerprint CV tidak berubah
  setelah request terblokir.
- §1.3/§1.4: edit sumber **dan** edit judul CV setelah request tidak mengubah PDF (wording lama ada, sentinel baru tidak
  ada); edit sumber yang masuk antara render dan complete (seam `onRendered`) juga tidak mengubah PDF; revision export
  lebih kecil dari revision CV terbaru.
- §1.5: lima skenario race × 3 putaran (+ stres 40 putaran) tanpa `40P01`; hasil konsisten (tabel di atas).
- §1.6: dua request paralel dengan key berbeda → satu export (`reused` tepat satu `true`, satu baris); key milik export
  dengan revision lain → `IDEMPOTENCY_KEY_REUSED` (pesan database asli); key dan revision sama → export asli;
  revision lebih baru saat aktif → `EXPORT_IN_PROGRESS`; setelah selesai revision baru mendapat export sendiri; request
  revision sama pada export sukses yang belum kedaluwarsa → `reused: true` tanpa job baru.
- §1.7: worker yang kehilangan lease (SQL memajukan lease saat render) → `complete` stale, objeknya terhapus, job
  `failed` `EXPORT_TIMEOUT` di pass berikutnya; retry → attempt ke-2 sukses dengan hash snapshot identik; key objek =
  `<user>/export/<attempt_token>` dan hanya satu objek tersisa.
- §1.8/§1.9: renderer `RENDERER_UNAVAILABLE`, `RENDERER_TIMEOUT`, `EXPORT_RENDER_INVALID` berturut-turut →
  export `failed` dengan kode aman, tanpa objek, fingerprint dan revision CV tidak berubah; retry memakai snapshot yang
  sama (hash identik); setelah tiga attempt `EXPORT_NOT_RETRYABLE`; request baru sukses; export lama tetap `failed`.
  Dokumen > 20 halaman → `EXPORT_TOO_LONG` permanen (tidak dapat di-retry, tanpa objek).
- §1.10 (PDF nyata): CV bahasa `en` dan `id` dengan nama `Siti Nurhaliza Ç. Ñuñez`, bullet
  `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, override dengan em dash dan kutip melengkung, summary: setiap
  halaman A4 (lebar 595 ± 1, tinggi 842 ± 1 pt), teks terekstrak memuat nama, heading sesuai locale, override, bullet
  Indonesia, dan tidak memuat teks sumber yang digantikan override; CV panjang (14 achievement, 12 bullet ≥ 640
  karakter) → > 1 halaman dan ≤ 20, jumlah halaman sama dengan `page_count` database, awal dan akhir setiap bullet utuh
  (tanpa clipping), nama di awal dokumen; teks tidak memuat id item, id akun, id export, object key, `http`, atau kata
  `evidence`. Renderer yang tidak terjangkau → job `failed` `RENDERER_UNAVAILABLE` tanpa objek, lalu retry dengan renderer
  nyata sukses; ringkasan worker tidak pernah menandai `pdfRenderer`.
- §1.12: `expires_at = finished_at + 24 jam`; setelah dimajukan, unduhan → `EXPORT_EXPIRED` (sebelum purge), pass worker
  mengantre dan menjalankan cleanup (`expired: 1`, `cleanupCompleted: 1`), objek terhapus, `purged_at` terisi, unduhan
  tetap `EXPORT_EXPIRED`; CV dan fingerprint tidak berubah; request baru dengan revision sama membuat export baru.
- §1.13: unduhan hanya untuk milik sendiri; `issueDownload` mengembalikan tepat `{url, expiresInSeconds: 300}`; JWT
  signed URL berumur ≤ 305 detik (diukur dari klaim `exp`); URL mengunduh `%PDF-` dengan ukuran sama dengan
  `byte_size`; akun lain dan ID acak → `EXPORT_NOT_FOUND` dengan `messageKey` sama; `listExports` dan `select` langsung
  oleh akun lain kosong; `update`/`delete`/`update snapshot` langsung oleh klien ditolak.
- §1.14: objek `export` yatim berumur 2 jam diantrekan dan dihapus; objek baru dibiarkan.
- §1.15: akun deleting: job queued → `failed` `ACCOUNT_DELETING` tanpa objek; request baru → `UNAUTHENTICATED`; akun mulai
  deleting saat job dirender → complete `failed:ACCOUNT_DELETING` dan objek terhapus.
- §1.19 (integration): sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` (nama, bullet, override) tidak muncul di error, blocker,
  `detail`, ringkasan worker, maupun log race; ringkasan hanya berisi sepuluh kunci hitungan; kredensial service tidak
  dapat membaca `cv_exports`, `cv_documents`, `cv_items`, atau `achievements` (worker hanya lewat RPC).
- Release scenario PRD: achievement ber-override → edit sumber → `ITEM_CHANGED` + `CV_EXPORT_BLOCKED` → Keep saved
  wording → export lolos dengan wording override (bukan teks sumber baru) → delete sumber → `ITEM_DELETED` diblokir →
  remove item → export baru lolos. Graduate: tanpa experience, dengan education + project akademik + achievement
  confirmed → export PDF berguna; hanya skill → `CONTENT_REQUIRED`.

## Perbaikan test setelah run pertama (kesalahan test, bukan implementasi)

1. Asersi "signed URL tidak memuat attempt token" terlalu keras: path objek memang bagian dari signed URL. Diganti
   dengan asersi bahwa hasil hanya memiliki kunci `url` dan `expiresInSeconds`.
2. Test dedup memakai key "pemenang" yang salah: dalam dua request paralel hanya request yang membuat export yang
   menyimpan key-nya; request lain dijawab dengan export aktif tanpa menyimpan key. Test kini membaca key tersimpan.
3. Test lease gagal sebagai efek berantai dari #2 (export aktif sisa ikut diklaim `drain`); hilang setelah #2 diperbaiki.

Pengamatan kualitas test: run awal menunjukkan request selalu menang karena RPC request jauh lebih ringan daripada
mutasi; urutan start/jeda kemudian divariasikan sehingga kedua urutan (request menang, mutasi menang) teramati.

## Catatan untuk gate review

- `drain` mengklaim semua export queued di database lokal (bukan hanya milik test); suite berjalan sekuensial
  (`maxWorkers: 1`) dan setiap test menguras antriannya sendiri. Akun, objek, dan baris export dibersihkan di `afterAll`.
- Test memakai `docker exec psql` sebagai pemilik database (pola `evidence-backend.test.ts`) hanya untuk memajukan jam
  (lease, expiry, umur objek), menandai akun deleting, membaca `object_key`/`attempt_token`, dan fingerprint CV; semua
  perilaku produk diuji lewat RPC/service/worker nyata.
- Signed URL memuat path objek (`<user>/export/<attempt_token>`) karena itulah mekanisme Storage; object key tidak
  dikembalikan sebagai field terpisah dan tidak ada di PDF, error, atau ringkasan.

## Belum dibuktikan di fase ini

Regresi penuh seluruh suite T02–T20, gate M2/M3, e2e, dan `pnpm build` ulang (Fase 7).

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 7: regresi penuh sesuai §7 plan dan receipt Fase 7.
