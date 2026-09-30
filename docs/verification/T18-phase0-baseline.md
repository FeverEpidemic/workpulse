# T18 Fase 0 — Baseline

- Tanggal: 30 September 2026
- Eksekutor: Claude Sonnet 5.5 (single agent)
- HEAD: `ba64e6d` (branch `claude/clever-archimedes-gbu7qd`); working tree hanya berisi `.claude/` (untracked, diabaikan sesuai plan).

## Tujuan

Mencatat kondisi awal sebelum T18 dan memverifikasi asumsi handoff pada source.

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `git status --short --branch` | bersih kecuali `?? .claude/` |
| `pnpm install --frozen-lockfile` | Already up to date (exit 0) |
| `pnpm exec supabase migration list --local` | 26/26 lokal = remote, terakhir `20261001090000` |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0; 76 file / 501 test lulus |
| `pnpm db:test` | exit 0; 11 file / 779 assertion, `Result: PASS` |
| `pnpm test:integration:achievements` | exit 0; 5 test lulus (dijalankan setelah migration T18 diterapkan, jadi sekaligus bukti tidak ada regresi FK) |
| `pnpm test:integration:projects` | exit 0; 7 test lulus (idem) |

## Verifikasi source

- `internal.touch_mutable_row` menaikkan `revision` pada setiap UPDATE dan mereset `user_id` (`20260916090000_foundation_schema.sql:150-170`); dipasang pada `experiences/education/certifications/projects/skills` (`:387-409`). Semua sumber punya `unique (user_id, id)` (`:233, 264, 290, 319, 349`; achievements `20260922100000_t09_achievements_skills.sql:147`). `achievements` memakai `internal.guard_achievement_row` (revision hanya naik bila kolom bermakna berubah, `:235-257`).
- Pola composite FK `on delete set null (col)`: `foundation_schema.sql:320-323`, `t09:183-188`.
- Fungsi delete: `delete_achievement` (`t09:911`, lock achievement `for update` lalu delete), `delete_project` (`:1125`, lock experience→project→activities→achievements), `delete_experience` (`:1204`), `delete_education/certification/skill` lewat `internal.delete_foundation_record` (`20260916124500_fix_foundation_rpc_row_checks.sql:132`). Tidak ada yang mengunci profil lalu tabel CV; tidak ada yang menyentuh `cv_documents`.
- `save_achievement` terbaru (`20260922110000_t09_achievement_null_patch.sql:3`) mengunci baris achievement `for update` (`:59-62`); dengan `for share` di `select_cv_source`, reopen bersamaan diserialkan.
- Errcode RPC lama: `STALE_REVISION` = `P0001`, `AUTH_REQUIRED` = `42501`, validasi input = `22023` (mis. `20261001090000_t16_import_commit.sql:592, 723, 596`). T18 mengikuti pola ini.

## Acceptance yang dibuktikan

Tidak ada (fase baseline). Angka baseline di atas menjadi pembanding regresi.

## Warning / blocker

Tidak ada blocker. Baseline integration dijalankan setelah migration T18 diterapkan (urutan kerja), bukan sebelum; angka tetap sama dengan harapan plan (5 dan 7).

## Langkah berikutnya

Fase 1: pgTAP `cv_selection.test.sql` (red), lalu migration `20261002090000_t18_cv_schema_selection.sql`.
