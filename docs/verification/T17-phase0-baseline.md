# T17 Fase 0 — Baseline (30 September 2026)

Tujuan: memastikan kondisi awal sebelum mengubah kode. Tanpa edit kode pada fase ini.

Keputusan pengguna: perintah "Eksekusi Plan T17 YA" dibaca sebagai konfirmasi keputusan §2.2.1 (tanpa migration; purge batch `review` yang ditinggalkan tetap T23), §2.2.2 (route S03 di luar workspace frame), §2.2.3 (S02 terbuka untuk pengguna lama), dan §2.2.6 (pilihan langsung tersimpan, edit field lewat Save eksplisit).

## Kondisi

- Branch `claude/clever-archimedes-gbu7qd`, HEAD `ba8d375`; working tree bersih kecuali `.claude/` (untracked).
- Parity migration lokal 26/26, migration terakhir `20261001090000_t16_import_commit.sql` (`supabase migration list --local`).
- Container ClamAV (`workpulse-t10-clamav`) dan Gotenberg (`workpulse-t15-gotenberg`) berjalan; `supabase_vector` restart-loop (tidak dipakai suite).

## Baseline (hasil aktual)

| Command | Hasil |
| --- | --- |
| `pnpm install --frozen-lockfile` | Up to date |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 70 file / 449 test PASS |
| `pnpm db:test` | All tests successful, Result: PASS |
| `pnpm test:integration:import-commit` | 11 test PASS (setelah memuat env lokal; run pertama tanpa env gagal "Local Supabase environment required" — masalah env, bukan kode) |
| `pnpm test:e2e:import` | 7 passed |
| `pnpm test:e2e:dashboard` | 1 passed |

## Verifikasi dari source

- RLS/grant: `import_items_select_own` dan `import_batches_select_own` (`20260930090000_t15_import_staging.sql:281-284`), `grant select on import_items to authenticated` (`:293`); kolom batch termasuk `revision`; `commit_result` di-grant di `20261001090000_t16_import_commit.sql:36`.
- RPC: `update_import_item` (`…t16_import_commit.sql:539`), `validate_import_batch` (`:664`), `commit_import_batch` (`:690`); `internal.import_item_errors` (`:443`) melewati item `skip`.
- `payload_patch` di SQL menerima string/null, `is_current` boolean, `metrics`/`selected_fields` array (`:623-631`). Zod `updateImportItemInput` (`commit-contracts.ts:53`) menerima string/boolean/null/array; payload T15 tidak memuat angka mentah di level atas (angka hanya di dalam `metrics`) → tidak ada temuan.
- `selected_fields` tidak pernah diisi T15 (`grep`); UI T17 yang mengisinya.
- Fake provider mendukung `import_partial` (`role_title` null) dan `import_empty` (`src/server/ai/fake-provider.ts:5-66`); helper E2E `tests/e2e/helpers/import-worker.ts:4` belum memuat `import_partial` (ditambah di Fase 5 tanpa mengubah skenario lama).
- Guard: `requireCompletedWorkspace` me-redirect provisional ke `/onboarding/import` (`src/server/auth/workspace-page.ts:13`); `src/app/onboarding/import/page.tsx:20` me-redirect onboarded ke `/dashboard`; `sanitizeReturnTo` (`src/domain/routes/safe-return.ts:13-22`) belum menerima `/imports/<uuid>/review` (akan diperluas dengan test).
- `UnsavedChangesProvider` hanya dipasang di `ApplicationFrame`; S03 di luar workspace harus memasangnya sendiri.
- Entry point lama: `dashboard.importUnavailable` (`dashboard-view.tsx:41-44`), `onboarding.importUnavailable*` di `messages.ts`, assertion "tanpa link S03" di `tests/e2e/import-onboarding.spec.ts:155` dan `tests/unit/import-start-ui.test.tsx:81`.

## Langkah berikutnya

Fase 1 (view model domain) dan Fase 2 (service baca, route, action).
