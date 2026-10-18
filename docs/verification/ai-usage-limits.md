# Receipt: batas pemakaian AI per akun (decision 0032)

Tanggal: 18 Oktober 2026. Pelaksana: Claude (Opus 5.5), branch `claude/eloquent-jones-3c0191`. Belum ada gate review independen.

## Perubahan

- Migration `supabase/migrations/20261018090000_ai_usage_limits.sql` (forward-only, ke-37): `internal.ai_plans`, `internal.ai_plan_assignments`, `internal.ai_capacity`, `internal.ai_usage`, `internal.ai_capacity_usage`; `internal.ai_plan_for`, `internal.add_ai_usage_unit`, `internal.charge_ai_usage`; `public.get_ai_usage()`; charge di `internal.enqueue_ai_job`, `public.retry_ai_job`, `public.begin_import_batch`, `public.retry_import_batch` (badan fungsi T14/T15 lainnya tidak berubah).
- Domain dan service: `src/domain/ai/usage.ts`, `src/features/ai/ai-usage-service.ts`, kode `QUOTA_EXCEEDED`/`CAPACITY_EXCEEDED` di `ai-errors.ts` dan `import-errors.ts` (HTTP 429, `ActionState` `RATE_LIMITED`), `usage` pada payload S06 (`ai-review-service.ts`).
- UI: `src/features/ai/ai-limit-notice.tsx`; S06 `activity-analysis-panel.tsx`, S02 `import-start.tsx`; timezone profil diteruskan dari `activity/[id]/page.tsx` dan `onboarding/import/page.tsx`; copy en/id di `src/i18n/messages.ts`.
- Test: `tests/unit/ai-usage-limits.test.tsx` (10), tambahan di `ai-analysis-panel.test.tsx` dan `ai-review-service.test.ts`, `tests/integration/ai-usage-limits.test.ts` (9, `pnpm test:integration:ai-usage`), `tests/integration/ai-usage-support.ts`; fixture suite AI/import lama dipasang ke paket `unlimited`.

## Checks (hasil aktual, stack lokal bersama)

| Check | Hasil |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm db:lint` | exit 0 |
| `pnpm test` | 119 file, 1084 test lulus |
| `pnpm db:test` | 20 file, 1638 test lulus (termasuk `release_catalog`) |
| `pnpm test:integration:ai-usage` | 9/9 |
| `pnpm test:integration:ai` | 13/13 |
| `pnpm test:integration:ai-review` | 21/21 |

Skenario `test:integration:ai-usage`: unit ke-21 per hari ditolak tanpa job dan replay gratis, lalu jalur manual tetap confirm; 6 request paralel pada 18/20 menghasilkan tepat 2 job; jendela bulanan dan waktu reset tanggal 1; retry dibebankan dan ditolak tanpa mengubah job; jawaban tersimpan saat refine ditolak; import ke-4 per hari ditolak tanpa batch dan replay tidak dibebankan; retry import ditolak tanpa melanjutkan batch; kapasitas bersama menolak akun `free`, sementara akun `unlimited` tidak berhenti dan tidak dihitung; counter tidak terbaca dari API dan hilang bersama user Auth.

## Belum terverifikasi

- `test:integration:import`, `import-commit`, `import-review`, `m3`, `account-deletion`, `release`: gagal pada **upload Storage pertama** di stack lokal ini, juga untuk `test:integration:storage` yang tidak menyentuh AI. Log container storage: `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` pada upsert `storage.objects`, karena skema `storage.objects` sudah berbentuk versioned (`idx_objects_current_version`, `is_versioned`) sedangkan container storage v1.80.2. Ini masalah lingkungan lokal, bukan migration ini; ulangi suite tersebut setelah stack diperbaiki.
- E2E (`test:e2e:*`) belum dijalankan. Fixture E2E masih memakai paket `free`; spec yang mengimpor lebih dari tiga CV per akun per hari akan tersandung batas import.
- Staging hosted: migration belum diterapkan.
