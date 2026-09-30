# T17 Fase 5 — Browser acceptance dan regresi penuh (30 September 2026)

Tujuan: membuktikan acceptance §1 di browser nyata dan memastikan tidak ada regresi T03–T16.

## File berubah

- Baru: `tests/e2e/import-review.spec.ts` (9 skenario), `playwright.import-review.config.ts` (port 3010), script `test:e2e:import-review`.
- Diubah: `tests/e2e/helpers/import-worker.ts` (skenario `import_partial`), `src/features/import/import-review.tsx` dan `import-review-candidate.tsx` (perbaikan dari temuan E2E, lihat bawah).

## Temuan E2E yang diperbaiki (bug produk, bukan pelemahan test)

1. Judul state S03 memakai `role="status"` sehingga bukan heading → diganti `aria-live="polite"`.
2. Setelah *Reload latest*, penanda konflik hilang sehingga nilai server tidak tampil di samping input lokal → `reloadedConflicts` menyimpannya sampai Save/Discard.
3. Nomor kandidat memakai `ordinal` berbasis 0 ("Experience 0") → ditampilkan `ordinal + 1`; tautan ringkasan error kini menuju kandidat yang benar.

## Skenario (semua PASS, `--repeat-each 2` = 18/18)

R02 rilis PRD keyboard-only (koreksi field, map SQL, lengkapi + confirm satu achievement, skip satu, onboarding lewat commit, hitungan = row nyata, dashboard + timeline overlap); double click + reload + back/forward tanpa row baru; refresh mempertahankan pilihan dan dialog unsaved; ekstraksi parsial (highlight, blocker, error terhubung `aria-describedby`, tautan ringkasan fokus ke field); dua tab (konflik menjaga input lokal, nilai server, commit basi tidak commit); ekstraksi kosong + cancel; pengguna lama dari S12 dengan map experience/skill tanpa mengubah row target; isolasi akun/anonim dan privasi (sentinel isi CV dan nama file = 0 di console, output worker, body API, halaman); 360/1440 × terang/gelap tanpa overflow. Axe WCAG A/AA tanpa pelanggaran pada S02 review-ready, S03 review, errors, konflik, kosong, committed, dan seluruh kombinasi layout.

## Regresi penuh (hasil aktual, HEAD setelah commit E2E)

lint, typecheck, `db:lint`, `worker:check`, `build`, `git diff --check` exit 0; unit 76 file / 495; `db:test` PASS; integration import-review 6, import-commit 11, import 21, achievements 5, dashboard 4, activity 6, projects 7, m2 8, ai 13, ai-review 21, evidence 14, storage 1; E2E import-review 9, import 7, dashboard 1, achievements 4, auth 1, ui 1, activity 1, projects 1, ai 2, ai-review 11, evidence 8, m2 1 (env AI harness dibersihkan; ClamAV dan Gotenberg berjalan). Parity migration tetap 26/26 (tanpa migration).

## Catatan / belum terbukti

- Route S03 tidak mengembalikan status HTTP 404 untuk id asing/tidak ada karena `loading.tsx` men-stream halaman lebih dulu; kontennya generik dan identik (API mengembalikan 404). Test membandingkan konten, bukan status. Reviewer: putuskan apakah `loading.tsx` dipertahankan.
- Copy S02 `committed` hanya diuji unit (state itu tidak dimuat ulang oleh `getActiveView`).
- Penyimpangan §1.16: assertion `m2-manual-journey.spec.ts:181` (lihat receipt Fase 4).
- Smoke live `extractImport`, race stres commit, purge batch `review` ditinggalkan (T23), tidak dijalankan.
- Screenshot terlampir pada laporan Playwright (`test-results/` per run), tidak di-commit.
