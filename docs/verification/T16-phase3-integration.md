# T16 Fase 3 — Integration nyata (receipt)

- Tanggal: 29 September 2026

## Tujuan

`tests/integration/import-commit.test.ts` memakai Supabase lokal, Storage, ClamAV nyata, parser thread, renderer `fake`, dan fake AI `import_valid`/`import_partial`. Batch `review` dibangun oleh
pipeline T15 nyata (upload service → scan/parse → AI worker), bukan insert langsung. Script baru `test:integration:import-commit`.

## File berubah

- Baru: `tests/integration/import-commit.test.ts`. Diubah: `package.json` (script baru).

## Command dan hasil aktual

Env: `.env.local` + `SERVICE_ROLE_KEY` JWT dari `supabase status -o env` di env proses saja; `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan; ClamAV dan Gotenberg berjalan.

| Command | Hasil |
| --- | --- |
| `pnpm test:integration:import-commit` (percobaan pertama) | exit 1: fixture memakai `admin` pada tabel kanonik yang tidak memberi grant ke `service_role` (bug test, bukan produk) → fixture dipindah ke RPC/klien pemilik |
| `pnpm test:integration:import-commit` (setelah perbaikan) | exit 0, 1 file / 11 test lulus |
| `pnpm test:integration:import` | exit 0, 2 file / 21 test lulus |
| `pnpm test:integration:achievements` / `dashboard` / `activity` / `projects` | exit 0: 5 / 4 / 6 / 7 test lulus |
| `pnpm test:integration:m2` / `ai` / `ai-review` | exit 0: 8 / 13 / 21 test lulus |

## Acceptance yang terbukti

- §1.14 (skenario PRD): CV Indonesia dengan dua experience overlap (satu current), edit satu kandidat, map skill `SQL` ke skill lama, konfirmasi satu achievement + satu draft → commit lewat service;
  overlap tersimpan utuh, `experience_id` benar, Dashboard (`confirmedAchievementCount = 1`) dan Timeline (experience/education/achievement confirmed muncul, draft tidak), commit ulang = hasil sama tanpa row baru.
- §1.3: tiga sesi paralel milik satu owner → tiga hasil identik, tepat satu set row.
- §1.4: satu item invalid (`import_partial` → `role_title` REQUIRED) → `ITEM_INVALID` dengan `{item_id, field, code}`; jumlah row, revision profil, status batch, `committed_id` identik;
  `validate` mengembalikan daftar yang sama; setelah diperbaiki commit berhasil.
- §1.5: map ke skill akun B, ID acak, dan row tabel salah ditolak (`TARGET_INVALID`); target yang dihapus sebelum commit → `TARGET_UNAVAILABLE`; row target yang di-map identik sesudah commit.
- §1.8: pengguna baru: tanpa onboarding → `ONBOARDING_REQUIRED`, placeholder → `ONBOARDING_INVALID`, tanpa write; valid → profil terisi dan `onboarding_completed_at` terisi (predikat yang dipakai guard `/dashboard`).
- §1.13: commit vs `update_import_item`, commit vs `cancel_import_batch`, commit vs `delete_experience` atas target map, masing-masing dengan sesi terpisah: hasil selalu salah satu urutan serial yang sah, tanpa
  kode `UNEXPECTED`/`UNAVAILABLE` (deadlock akan tampil sebagai `UNAVAILABLE`), tanpa achievement yang menggantung ke experience yang terhapus.
- §1.9: setelah commit dan purge worker nyata: object Storage hilang, `extracted_text`/`file_key` NULL, payload/excerpt item NULL, `committed_id` tetap, achievement tetap memegang `source_excerpt`.
- §1.12: akun B → `NOT_FOUND` untuk update/validate/commit; klien tidak dapat insert/update/delete `import_items`/`import_batches`.
- §1.16: sentinel isi CV, nama file, dan nama perusahaan tidak muncul di error, detail, hasil commit, ringkasan worker, maupun output console selama suite.

## Ruling / catatan

- Setiap race hanya menguji **hasil serial yang sah**; suite tidak dapat memaksa urutan interleaving tertentu. Deadlock akan muncul sebagai kegagalan (`UNAVAILABLE`), tetapi absennya deadlock pada satu putaran bukan bukti formal.
- Fixture memakai RPC (`create_experience_idempotent`, `create_skill_idempotent`, `delete_experience`) karena `service_role` tidak punya grant tabel kanonik.
- Akun fixture dihapus di `afterAll`, termasuk object Storage prefix `import`.

## Belum dijalankan

Suite E2E dan sisa regresi di §7 dijalankan pada Fase 4.
