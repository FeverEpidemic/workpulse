# T28 Pilihan Dengan AI / Tanpa AI di setiap import: bukti acceptance

- Tanggal: 21 Oktober 2026
- Status: **DONE** (acceptance lokal). Gate review PASS tanpa P0-P2; empat P3 (G1-G4) diselesaikan dalam remediasi RV1-RV4.
- Pelaksana Fase 0-5: Claude (Opus 5.5), single-agent. Gate review dan remediasi: Claude (Opus 5.5) di sesi dan worktree terpisah (`claude/t28-gate-review-5493dd`), lalu branch T28 di-fast-forward ke `bed98db`. Independensi terbatas: pelaksana dan reviewer memakai model yang sama.
- Dokumen: [rencana](T28-implementation-plan.md), [decision 0038](../decisions/0038-t28-import-mode-choice.md), [gate review](T28-gate-review.md), [rencana remediasi](T28-review-remediation-plan.md), [receipt remediasi](T28-review-remediation.md), receipt [Fase 0](T28-phase0-baseline.md), [1](T28-phase1-choice-logic.md), [2](T28-phase2-dialog-s02.md), [3](T28-phase3-e2e.md), [4](T28-phase4-regression.md).

## Trace

| Sumber | Bagian | Diwujudkan di |
| --- | --- | --- |
| PRD | R02, §3 (kandidat sampai dikonfirmasi) | dialog pilihan di setiap upload S02; batch `ai`/`rules` tetap lewat review S03 |
| User Flow | F01, *Import exceptions* | upload pengguna consent kini melalui pilihan; kuota habis tidak menutup jalur import |
| Wireframe | S02, S12 | dialog dan konfirmasi di S02; status consent S12 *Not allowed* setelah pencabutan |
| Database | `public.set_ai_consent` (T13), `begin_import_batch` mode `rules` (T26) | dipakai apa adanya; tanpa migration (38) |
| Decision | 0033 #2 dan #10 | diubah dan diperluas oleh 0038 #1, #3, #8 |

## Acceptance §1

| # | Acceptance | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Dialog untuk semua pengguna | PASS | unit S02 pengguna consent; E2E T28 (a) |
| 2 | Pakai AI tanpa langkah tambahan bagi pengguna consent | PASS | unit `chooseImportMode`; E2E (a): batch `ai`, `profiles.revision` tetap |
| 3 | Konfirmasi sebelum pencabutan | PASS | unit `chooseMode`/markup konfirmasi; E2E (b): belum ada batch dan consent tetap sebelum tombol lanjut |
| 4 | Konfirmasi mencabut consent lalu upload `rules` | PASS | unit urutan `withdraw` → `upload:rules`; E2E (b): consent `null`, batch `rules`, tanpa `ai_jobs`, unit import tetap |
| 5 | Batal dan kembali tidak mengubah apa pun | PASS | E2E (b): Kembali, Esc, Batal, backdrop dari konfirmasi (RV2); file tetap terpilih, consent tetap, tanpa batch |
| 6 | Kegagalan pencabutan tidak meng-upload | PASS | unit `withdrawConsent` gagal → pesan dikembalikan, `upload` tidak dipanggil |
| 7 | Revisi profil selalu terbaru | PASS | E2E (c): izinkan lalu matikan di satu kunjungan halaman tanpa konflik |
| 8 | AI berhenti di seluruh aplikasi | PASS | E2E (d): S12 *Not allowed*, *Analyze with AI* membuka *Allow AI processing?*, tanpa `ai_jobs` |
| 9 | Kuota habis tidak menutup import | PASS | unit S02 dan `ai-usage-limits`; E2E (e) |
| 10 | Retry batch `ai` setelah consent dicabut | PASS | unit `withConsentWithdrawn` (sama dengan `toImportView` ber-`consent: false`) |
| 11 | Copy jujur dan simetris | PASS | unit copy en/id persis §2.2.8, tanpa em dash, key lama tidak dirujuk; reviewer membandingkan kata per kata |
| 12 | Aksesibilitas | PASS | E2E (b) fokus dan Tab; matriks axe kedua tampilan 360/1440 light/dark tanpa pelanggaran dan tanpa overflow; teks 200% di 320/360/720 (RV3) |
| 13 | Tidak ada regresi | PASS | regresi §7 Fase 4 dan rerun pasca-remediasi di bawah; assertion yang berubah hanya yang terdaftar |

Tambahan dari remediasi: dialog terkunci selama pilihan diproses (RV1, unit + E2E dengan server action ditahan, dibuktikan dengan mutasi).

## Commands dan hasil

Pelaksana, Fase 4 (HEAD `11fd9ab`, sebelum remediasi):

| Command | Exit | Hasil |
| --- | --- | --- |
| lint (`--ignore-pattern ".claude/**"`), `typecheck`, `build` | 0 | bersih |
| `pnpm test` | 0 | 134 file / 1270 test |
| `test:integration:import`, `ai`, `ai-usage`, `m3` | 0 | 25, 13, 9, 7 |
| `test:e2e:import`, `import-review`, `ai`, `ai-review`, `m2`, `m3`, `release` | 0 | 16, 10, 2, 11, 1, 2, 21 |

Reviewer (worktree bersih, HEAD `de511be`): lint, typecheck exit 0; unit 134/1270; diff server/migration/dependency 0 baris; `test:e2e:import` 16, `import-review` 10, `m3` 2, `release` 21 setelah restart stack (run pertama 3/13 karena storage lokal rusak, lihat batas lingkungan).

Remediasi (HEAD `9210094`): lint, typecheck exit 0; unit 134/1271; `test:e2e:import` 18, `import-review` 10, `ai` 2, `release` 21.

Pelaksana, setelah fast-forward ke `bed98db` (perubahan primitive `Dialog`): `test:e2e:m3` 2 passed, `test:e2e:ai-review` 11 passed, `test:e2e:m2` 1 passed, semua exit 0.

## Tidak dijalankan

- `test:e2e:evidence`, `account-deletion`, `test:pdf`, `test:perf`, integration selain import/ai/ai-usage/m3: domain tidak disentuh.
- Integration ulang setelah remediasi: remediasi hanya mengubah komponen client dan test.
- Uji screen reader manusia (NVDA) pada konfirmasi; staging.

## Flaky dan batas lingkungan

- `pnpm test:e2e:*` gagal selama T28 dikerjakan karena `package.json` memuat `"playwright": "latest"` (1.64) di samping `@playwright/test` 1.63; semua suite di atas dijalankan lewat `node node_modules/@playwright/test/cli.js test` dengan argumen script yang sama. Gate M5 (RV-PW) mem-pin 1.63.0 dan ikut masuk lewat merge `main`.
- Setelah merge `main` (M5, `1f34115`): lint, typecheck exit 0; unit 135/1272. `pnpm test:e2e:import` gagal 14/18 di langkah upload karena storage lokal bersama kembali ke `v1.72.1` (di-restart sesi lain); merge tidak mengubah kode T28.
- `pnpm lint` penuh membaca build output `.claude/worktrees/*/.next/`; repo sendiri bersih dengan `--ignore-pattern ".claude/**"`.
- Stack Supabase lokal bersama sempat di-restart dari checkout tanpa pin `supabase/.temp`, sehingga storage `v1.72.1` berjalan di atas skema `v1.80.2` dan setiap upload `500` (`42P10`). Dipulihkan dengan `supabase stop`/`start` dari checkout utama atas persetujuan pengguna, tanpa reset. RV4 mencatat aturan ini di `README.md` dan `AGENTS.md`.
- Log `[WebServer] The destination stream closed early.` muncul tanpa menggagalkan test (sama dengan baseline).
- Batasan yang diterima: Esc kedua yang dipaksa Chromium selama request (decision 0038 #5) tidak diuji E2E.
- Semua bukti lokal; bukan bukti integrasi staging atau production.
