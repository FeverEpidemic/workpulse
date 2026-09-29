# T15 Fase 4 — Worker, service, route, dan integration nyata (receipt)

Tanggal: 29 September 2026.

Tujuan: pass worker import (housekeeping, scan+parse, cleanup), cabang kind `import` di worker AI, service/route/action web, dan suite integration nyata.

## File berubah

- Baru: `workers/{import-worker,supabase-import-gateway}.ts`, `src/features/import/{import-errors,import-service,http,actions}.ts`, `src/app/api/imports/route.ts`, `src/app/api/imports/[id]/route.ts`, `tests/unit/{import-worker,import-service}.test.ts`, `tests/integration/import-staging.test.ts`
- Diubah: `workers/{ai-worker,supabase-ai-gateway,run,bootstrap}.ts`, `src/i18n/messages.ts` (copy `import.*` en/id), `package.json` (script `test:integration:import`), `tests/unit/{ai-worker,worker-bootstrap}.test.ts`

## Perubahan test lama (bukan pelemahan)

- `tests/unit/ai-worker.test.ts`: harness menambah dua method gateway baru; test T14 "treats an unknown kind as stale" semula memakai `"import"` sebagai contoh kind tak dikenal. Karena `import` kini sah, contohnya diganti `"summarize"`; assertion (stale, provider tidak dipanggil) tidak berubah. Ditambah 2 test cabang import.
- `tests/unit/worker-bootstrap.test.ts`: `registeredJobs` bertambah `import-scan-parse`, `import-cleanup`, `ai-import`.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/{import-worker,ai-worker,worker-bootstrap,import-service}.test.ts` | 28/28 |
| `pnpm test:integration:import` (baru) | 21/21 (19 import-staging + 2 renderer nyata Gotenberg) |
| `pnpm test:integration:{ai,ai-review,evidence,storage,activity,achievements,projects,dashboard,m2}` | 13, 21, 14, 1, 6, 5, 7, 4, 8 — semua lulus |
| `pnpm worker:check` | exit 0, `registeredJobs` 6 handler |
| `pnpm worker:once` (mode default: AI dan renderer `unavailable`) | exit 0, ringkasan hanya angka |
| `pnpm typecheck`, `pnpm lint` | exit 0 |

Lingkungan integration: Supabase lokal (Storage nyata), ClamAV nyata `127.0.0.1:13310`, parser `worker_threads` nyata, renderer DOCX `fake` untuk suite import-staging (renderer nyata dibuktikan terpisah di `import-renderer-real.test.ts`), fake AI provider berpenghitung.

## Kegagalan yang ditemukan saat menulis suite (diperbaiki di test)

1. Helper bernama `process` membayangi global `process` → diganti `drive`.
2. `admin` (service role) tidak punya grant select pada sebagian tabel canonical → hitungan canonical memakai client pemilik (RLS).
3. Batch `queued` sisa skenario idempotensi/duplikat diklaim lebih dulu oleh skenario berikutnya (claim global, limit 1) → skenario itu membatalkan batch-nya sendiri di akhir dan `drive` memakai hingga 20 pass.
4. Rantai assertion cancel terakhir memanggil cancel sebelum batch gagal (bug test) → dipecah menjadi langkah eksplisit.

## Acceptance yang terbukti (integration nyata)

- §1.1 PDF → `review`, item per tipe, excerpt substring teks, achievement draft dengan `experience_item_id` ter-resolve.
- §1.2 DOCX → `page_count` dari renderer (fake di suite ini; nyata di Fase 2), 21 halaman → `TOO_MANY_PAGES`.
- §1.3 jumlah row canonical tetap.
- §1.4 validasi upload lewat service: kosong, >10 MiB, `content-length` tidak cocok, MIME tidak cocok, PNG, teks, CFB terenkripsi, DOCX macro, DOCX terpotong — tanpa batch dan tanpa object.
- §1.5 `ENCRYPTED_FILE`, `SCANNED_PDF`, `TOO_MANY_PAGES`, `EMPTY_DOCUMENT` permanen dan tidak dapat di-retry.
- §1.7 EICAR (dalam DOCX) → `MALWARE_DETECTED`, tidak ada teks, object terhapus setelah purge+cleanup; scanner `unavailable` → 5 attempt → `SCANNER_UNAVAILABLE` retriable → retry dengan ClamAV nyata → `review`.
- §1.8 tanpa consent tidak ada object/batch; consent ditarik sebelum ekstraksi → `CONSENT_REQUIRED`, provider 0 panggilan; retry diblokir sampai consent diberikan lagi; payload provider hanya `{ text }`.
- §1.9/§1.10 skenario `import_ungrounded` (kandidat rekaan dibuang, `dropped_ungrounded = 1`, employer rekaan `UNGROUNDED`), `import_numbers`, `import_partial`, `import_empty` → `review_empty`, `malformed` → `AI_OUTPUT_INVALID` retriable tanpa item.
- §1.11 upload paralel ×3 dengan key sama → satu batch; key sama byte beda → `CONFLICT`; replay setelah object ada (response hilang) → batch yang sama berlanjut.
- §1.12 peringatan duplikat per akun, tidak memblokir.
- §1.13 cancel saat queued, saat parsing (hook worker), dan saat AI berjalan (hook provider) → tidak ada teks/item; cancel batch `failed` → `NOT_CANCELLABLE`.
- §1.15 retry paralel ×3 → satu job AI; tiga attempt AI habis → `RETRY_EXHAUSTED`.
- §1.16 purge: teks, item, dan object hilang; `sha256`/status/`purged_at` tetap.
- §1.18 isolasi dua akun lewat service, query langsung, dan kolom privat.
- §1.19 ringkasan worker dan pesan error tidak memuat sentinel isi CV, nama file, atau key.

## Catatan

- View model owner menyertakan `filename` milik pengguna sendiri (S02 menampilkan "Impor tersimpan: …"). Nama file tidak pernah masuk log, ringkasan worker, pesan error, atau payload AI. Ini penyempitan tafsir §1.19 plan ("response route") dan dicatat di decision 0021.
- Route `GET /api/imports` (tanpa id) ditambahkan untuk leave-return di sisi client; page server juga memuat batch aktif langsung.

Berikutnya: Fase 5 (UI S02).
