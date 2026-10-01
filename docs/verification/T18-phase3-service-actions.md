# T18 Fase 3 — Service dan action

- Tanggal: 30 September 2026
- Eksekutor: Claude Sonnet 5.5

## Tujuan

Membungkus lima RPC CV dalam `createCvService({ supabase, correlationId })` (Zod, pemetaan error, correlation ID) dan server action tipis. Belum ada UI; `/cv` tetap `WorkspaceUnavailable`.

## File berubah

- `src/features/cv/cv-errors.ts` — `CvServiceError` (code, `messageKey`, `correlationId`, `childItemIds`), `mapCvDatabaseError`, `toCvServiceError`.
- `src/features/cv/cv-service.ts` — `ensure`, `getCv` (dokumen + item terurut + outline), `getSelectionPool`, `select`, `remove`, `reorder`, `updateLayout`.
- `src/features/cv/actions.ts` — `ensureCvAction`, `selectCvSourceAction`, `removeCvItemAction`, `reorderCvSectionAction`, `updateCvLayoutAction`.
- `src/i18n/messages.ts` — enam kunci `cv.error.*` (en dan id; hanya pesan error, tanpa copy builder).
- `tests/unit/cv-service.test.ts`, `tests/unit/cv-actions.test.ts`.

## Command dan hasil aktual

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0; 81 file / 575 test lulus (+2 file / +34 test dari Fase 2) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |

## Keputusan

- Owner selalu dari session (`auth.getUser()` di service; `auth.uid()` di RPC). Input klien tidak pernah membawa `user_id` (skema `.strict()`).
- `getSelectionPool` membaca lewat session client (RLS); achievement hanya `status = 'confirmed'` dan hanya kolom tampilan (`id, title, cv_bullet, achieved_on, experience_id, project_id, revision`) — `contribution`, `scope`, `metrics`, `source_excerpt`, `activity_id` tidak dibaca. Test menegaskan daftar kolom.
- Error tidak memuat teks database: pesan tak dikenal menjadi `UNAVAILABLE`; detail `CV_CHILD_ITEMS_EXIST` hanya diterima bila array UUID.
- Server action memvalidasi input dengan Zod sebelum membuat client; `revalidatePath('/cv')` hanya setelah sukses. Urutan item/section dikirim sebagai field berulang (`item_id`, `section`) agar tidak ada JSON parse; `remove_children` harus eksplisit `"true"`/`"false"`.
- Kode error action: `VALIDATION` (input, onboarding, ineligible), `NOT_FOUND`, `UNAUTHENTICATED`, `UNAVAILABLE`, sisanya `CONFLICT` (stale, duplicate, child items, reorder invalid). `correlationId` dari service dipertahankan.

## Acceptance yang dibuktikan (unit)

§1.3 (`getSelectionPool` tanpa draft/dismissed), §1.7 (owner dari session, anonim ditolak), §1.11 (detail child), §1.15 (sentinel tidak muncul di error/JSON/message), validasi Zod dan revalidate-after-success pada action. Bukti terhadap database nyata ada di Fase 4.

## Warning / blocker

Tidak ada.

## Langkah berikutnya

Fase 4: `tests/integration/cv-selection.test.ts` (database nyata), script `test:integration:cv`, dan regresi penuh.
