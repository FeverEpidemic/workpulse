# T16 Fase 2 — Kontrak domain, service, action (receipt)

- Tanggal: 29 September 2026

## Tujuan

Membungkus tiga RPC T16 dengan kontrak Zod, service `createImportReviewService`, pemetaan error, dan server action untuk S03 (UI di T17).

## File berubah

- Baru: `src/domain/import/commit-contracts.ts`, `src/features/import/import-review-service.ts`,
  `tests/unit/import-commit-contracts.test.ts`, `tests/unit/import-review-service.test.ts`, `tests/unit/import-review-actions.test.ts`.
- Diubah: `src/features/import/import-errors.ts` (kode baru, `itemErrors`, pemetaan; kode T15 tidak diubah), `src/features/import/actions.ts`
  (`updateImportItemAction`, `commitImportAction`), `src/i18n/messages.ts` (8 kunci en/id).

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `vitest run` 3 file baru (sebelum implementasi, RED) | exit 1: modul belum ada / `commitImportAction is not a function` |
| `vitest run` 3 file baru + `import-service.test.ts` (setelah implementasi) | exit 0, 4 file / 23 test lulus |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (`--max-warnings 0`) |
| `pnpm test` | exit 0, 69 file / 444 test lulus (baseline 66 / 424) |

## Acceptance yang terbukti

- Allowlist patch di TypeScript sama dengan daftar SQL (dibandingkan eksplisit di test).
- Input ditolak (`VALIDATION`/`NOT_FOUND`) sebelum RPC untuk: kunci asing (`user_id`), UUID salah, `confirm_requested` non-boolean, revision < 1, `onboarding` tak valid.
- Setiap kode DB dipetakan ke kode service, `messageKey`, status HTTP, dan `correlationId` UUID; `IMPORT_ITEM_INVALID` membawa daftar `{item_id, field, code, existing_id?}`;
  detail dengan properti tambahan ditolak (daftar kosong) sehingga teks sumber tidak bisa lewat.
- Pesan error, JSON error, dan message key tidak memuat sentinel dari teks DB.
- `commitImportAction` memanggil `revalidatePath('/dashboard')` hanya setelah sukses; gagal/validasi/anonim tidak melakukannya dan tidak memanggil RPC bila input tidak valid.
- Commit ulang melalui service meneruskan hasil yang sama.

## Ruling

1. Service memakai `createImportReviewService({ client })` (pola `createImportService`), bukan `{ supabase, correlationId }`: `ImportServiceError` sudah membuat `correlationId` sendiri.
2. Tidak ada pemeriksaan header Origin manual pada server action: Next.js server action sudah memverifikasi Origin/Host, dan action T15 yang ada juga tidak menambahkannya
   (pola `http.ts` hanya untuk route handler). Biaya bila salah: satu pemeriksaan tambahan bila kelak dibuka sebagai route handler.
3. Test ditulis lebih dulu dan dijalankan RED sebelum implementasi (urutan plan); test action memakai mock untuk `next/cache`, server client, dan admin client.

## Belum dijalankan / langkah berikutnya

Integration nyata (Fase 3) belum dijalankan. Langkah berikutnya: `tests/integration/import-commit.test.ts`.
