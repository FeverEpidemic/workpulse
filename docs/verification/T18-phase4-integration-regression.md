# T18 Fase 4 — Integration nyata dan regresi penuh

- Tanggal: 30 September 2026
- Eksekutor: Claude Sonnet 5.5
- Lingkungan: Supabase lokal (Docker), migration 27/27, ClamAV `workpulse-t10-clamav` (127.0.0.1:13310) dan Gotenberg `workpulse-t15-gotenberg` (127.0.0.1:13400) berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (proses saja, tidak dicetak); `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan untuk semua run E2E.

## Tujuan

Membuktikan T18 terhadap PostgreSQL/Auth nyata (bukan mock) dan memastikan tidak ada regresi pada T02–T17 dan gate M2/M3.

## File berubah

- `tests/integration/cv-selection.test.ts` (baru; 10 test)
- `package.json` (script `test:integration:cv`)

## Suite baru — `pnpm test:integration:cv`

Setiap test membuat akun nyata (Auth admin API + sign-in klien terpisah, onboarding lewat RPC `complete_onboarding`), membuat sumber lewat RPC/service yang ada (bukan insert admin), dan menghapus akun di `afterAll`. Pembacaan verifikasi memakai session klien pemilik (service_role sengaja tanpa grant pada tabel CV).

| Test | Bukti |
| --- | --- |
| Graduate, lima `ensure` paralel dari lima session | tepat satu row `cv_documents`, satu `created: true`, `cv_id` identik; select achievement ber-`project_id` → item project + achievement, revision +1; outline menempatkan achievement di bawah project; posisi kontigu |
| Draft tidak eligible | `SOURCE_INELIGIBLE` tanpa write; pool tanpa draft; setelah confirm select berhasil |
| Duplikat + parent sudah ada | `SOURCE_DUPLICATE` (achievement dan parent eksplisit); parent tidak digandakan (`parentItemIds` kosong) |
| Edit bersamaan (3 putaran, dua session, revision sama, `reorder` vs `select`) | tepat satu sukses per putaran, yang lain `CONFLICT` (bukan `UNAVAILABLE`, jadi tanpa `40P01`), revision +1 per putaran, posisi kontigu |
| Race sumber (4 putaran reopen vs select, 4 putaran delete vs select, reorder vs `delete_experience`) | hasil serial konsisten: select gagal hanya dengan `SOURCE_INELIGIBLE` / `SOURCE_NOT_FOUND` tanpa item; select berhasil lalu delete → item `source_deleted`; reorder dan delete keduanya sukses; tanpa deadlock |
| Penghapusan sumber lewat RPC delete lama (achievement, project, experience, skill, education, certification) | semua sukses; 6 item tetap ada, `source_deleted = true`, kolom sumber NULL, snapshot dan posisi identik; outline: lima entri deleted + satu child |
| Hapus parent | tanpa keputusan → `CHILD_ITEMS_EXIST` dengan tepat ID child; `remove_children = true` menghapus keduanya, revision +1 |
| Isolasi + log hygiene | B tidak melihat CV/item A; select/remove/reorder atas ID A → `SOURCE_NOT_FOUND`/`NOT_FOUND`/`REORDER_INVALID` (sama untuk ID acak); insert/update/delete langsung pada `cv_items`/`cv_documents`/`cv_exports` ditolak; sentinel `WP-PRIVATE-CV-SENTINEL-<uuid>` tidak muncul di error service (JSON, message, stack) maupun error RPC mentah |
| Onboarding wajib | `ONBOARDING_REQUIRED`, tanpa row CV |
| Reorder + layout | himpunan salah → `REORDER_INVALID`; reorder dan `updateLayout` menaikkan revision +1; revision basi → `CONFLICT`; outline mengikuti `section_order` |

Hasil: 10/10 lulus. Suite dijalankan 4 kali berturut-turut (1 run awal + 3 ulang) dan lulus semuanya (tidak flaky). Satu percobaan awal gagal pada setup (`complete_onboarding` membutuhkan `p_locale`/`p_timezone`; `service_role` tanpa grant tabel CV) — kesalahan test, diperbaiki tanpa mengubah migration.

`grep console.` pada `src/features/cv` = 0 hasil.

## Regresi penuh (hasil aktual)

Gate dasar: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 0 (81 file / 575 test), `pnpm db:test` 0 (12 file / 909 assertion, PASS), `pnpm db:lint` 0, `pnpm worker:check` 0, `pnpm build` 0, `git diff --check` tanpa error (hanya peringatan LF→CRLF).

Integration (semua exit 0): `cv` 10, `achievements` 5, `projects` 7, `activity` 6, `dashboard` 4, `import-commit` 11, `import-review` 6, `import` 21 (2 file), `m2` 8, `m3` 7, `ai` 13, `ai-review` 21, `evidence` 14 (3 file, ClamAV nyata), `storage` 1.

E2E: `achievements` 4, `projects` 1, `dashboard` 1, `auth` 1, `ui` 1, `import` 7, `import-review` 10, `ai` 2, `ai-review` 11, `evidence` 8, `m2` 1, `m3` 2 — semuanya exit 0.

`test:e2e:activity`: **run pertama gagal (1 failed)**; diulang tanpa perubahan apa pun dan **lulus (1 passed)**. Baris test yang gagal pada run pertama tidak saya tangkap (output difilter ke ringkasan). Plan mencatat flaky bawaan `activity-ui.spec.ts:356`; saya mencatatnya sebagai flaky yang diduga sama, bukan terkonfirmasi. Kode yang disentuh T18 tidak berada di jalur test itu (tidak ada UI/route baru).

Tidak dijalankan: `test:e2e` tanpa suffix (gabungan) dan `test:ai:live` (butuh persetujuan pengguna; tidak relevan T18).

## Acceptance §1 yang kini terbukti

1 (pgTAP + paralel ×5), 2, 3, 4, 5, 6, 7 (pgTAP + query klien langsung), 8, 9 (dua session nyata), 10, 11, 12, 13 (pgTAP + integration), 14 (semua suite di atas lulus tanpa melemahkan assertion), 15 (integration + grep).

## Belum terbukti / batas

- Tidak ada UI S13 (T19) dan tidak ada freshness/refresh/invalidasi revision CV saat sumber berubah (T20); export (T21/T22) tidak disentuh.
- Race diuji dengan dua session pada satu proses Node (interleaving nyata di PostgreSQL, tetapi tidak deterministik); tidak ada stress berskala besar (T24).
- Keberhasilan lokal bukan bukti integrasi production.

## Langkah berikutnya

Serahkan ke Claude untuk gate review (§9 plan): hash commit, diff, receipt Fase 0–4. Fase 5 (decision 0024, verification doc, README) setelah gate.
