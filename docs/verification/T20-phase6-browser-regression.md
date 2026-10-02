# T20 Fase 6 — Browser acceptance dan regresi penuh (receipt)

- Tanggal: 2 Oktober 2026
- Tujuan: bukti browser nyata (build produksi) untuk S13/S04 dan regresi seluruh suite. Status T20 **tidak** ditandai DONE di sini; menunggu gate review.

## File berubah

- Baru: `playwright.cv-freshness.config.ts` (port 3013), `tests/e2e/cv-freshness.spec.ts` (10 test), script `test:e2e:cv-freshness`.
- Diubah: `src/features/cv/cv-builder.tsx` (bulk refresh hanya menutup panel item yang di-refresh), `tests/e2e/m2-manual-journey.spec.ts` (lihat Penyimpangan).

## E2E `cv-freshness` (10/10, dua run bersih terakhir; run awal menemukan 3 kesalahan desain test, bukan produk)

Alur 1–11 plan: badge + perbandingan + Refresh (preview berubah hanya setelah pilihan; fokus ke heading section); item ber-override (Keep my wording menjaga override dan memperbarui snapshot; Replace menghapus override); Keep saved wording lalu edit lagi → Source changed; deleted (hanya penjelasan + Remove) dan unconfirmed (tautan ke achievement); profil (Keep my wording mempertahankan `display_overrides`); Refresh all melewati item ber-override dan draft belum disimpan menonaktifkan aksi dengan alasan terlihat, draft tetap setelah reload; dashboard dua check + tautan `/cv#cv-review` dan `/cv#cv-pool-achievements` (pool terbuka), check hilang bila nol; keyboard-only (Enter, Tab, Space, live region, fokus); 360/1440 px × light/dark pada `/cv` (4 panel review terbuka) dan `/dashboard` tanpa overflow horizontal dan **0 pelanggaran Axe A/AA**; reduced motion. Screenshot: `test-results/t20-shots/{cv-review,dashboard-cv}-{360,1440}-{light,dark}.png` (8 file, tidak di-commit; berisi data fixture saja, tanpa sentinel).

## Regresi (hasil aktual)

| Command | Hasil |
| --- | --- |
| `pnpm lint` / `typecheck` / `db:lint` / `worker:check` / `build` | exit 0 semuanya |
| `pnpm test` | 89 file / 706 test lulus |
| `pnpm db:test` | 14 file / 1115 assertion, PASS |
| `test:integration:` cv-freshness 11, cv-builder 7, cv 10, achievements 5, projects 7, activity 6, dashboard 4, import-commit 11, import-review 6, import 21, m2 8, m3 7, ai 13, ai-review 21, storage 1 | semuanya exit 0 |
| `test:e2e:` cv 8, achievements 4, projects 1, dashboard 1, auth 1, ui 1, activity 1, import 7, import-review 10, ai 2, ai-review 11, m3 2, m2 1, cv-freshness 10 | semuanya lulus (m2 setelah penyesuaian) |
| `git diff --check` | bersih (hanya peringatan LF→CRLF) |

ClamAV dan Gotenberg (container lokal `workpulse-t10-clamav`, `workpulse-t15-gotenberg`) dinyalakan ulang; suite import berjalan terhadapnya. `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan untuk run E2E.

## Tidak dijalankan / catatan

- `test:integration:evidence` dan `test:e2e:evidence`: tidak lulus/tidak dijalankan. Integration: `evidence-pipeline.test.ts` gagal "Local Supabase environment required" (konfigurasi publik tidak terbaca di proses; suite lain di file yang sama lulus 9, 5 di-skip) — masalah environment, bukan perubahan T20 (T20 tidak menyentuh evidence). E2E evidence tidak dijalankan.
- `test:e2e:cv` dijalankan: 8/8.
- Hasil per putaran race tidak dilog (lihat receipt Fase 5).

## Penyimpangan dari "suite lama tanpa perubahan" (untuk reviewer)

Tiga perubahan pada suite T02–T19, semuanya akibat langsung keputusan yang disetujui, assertion inti dipertahankan:
1. `cv_selection.test.sql` — literal revision 17/18 → revision dokumen saat itu (+1) (Fase 1).
2. `tests/integration/cv-selection.test.ts` — race reorder vs `delete_experience`: reorder yang kalah kini `CONFLICT` (Fase 1).
3. `tests/e2e/m2-manual-journey.spec.ts:337` — dashboard tidak lagi kosong: achievement confirmed yang belum di CV kini menjadi check CV *available* (acceptance §1.13). Assertion bukti-evidence dan outcome kosong dipertahankan; pesan "No checks need attention." diganti dengan keberadaan check CV.
Plus penyesuaian mock/fixture (`cv-builder-ui` mock actions, `dashboard-service` respons default RPC baru, daftar kode error `cv-contracts`).

## Untuk gate review Claude

Commit: `5ecdf0b`(F0), `5a7a55d`(F1), `4159341`(F2), `709c4ed`(F3), `5c07aab`(F4), `42ceca2`(F5), `eb17daa`(F6) + commit receipt ini. Acceptance §1 yang bergantung pada keputusan untuk ditinjau khusus: poin 17 (perubahan suite lama di atas) dan interpretasi §1.10 (konfirmasi ulang tanpa perubahan field tampilan = fresh). `commit_import_batch` memegang lock profil `for update` pertama; konsisten dengan urutan profil → dokumen CV → sumber (tidak pernah menunggu dokumen CV).