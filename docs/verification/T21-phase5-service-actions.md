# T21 Fase 5 — Service, action, dan copy export

- Tanggal: 6 Oktober 2026
- Status: **PASSED**
- Commit: `feat(t21): add CV export service and actions`

## Tujuan

Batas aplikasi untuk export (dipakai UI T22): readiness, daftar export, request, retry, dan URL unduhan bertanda tangan
≤ 300 detik, dengan error aman berkode, `correlationId` tunggal per request, dan copy en/id. Tanpa komponen UI atau route.

## File berubah

- `src/features/cv/export-service.ts` (baru: `createCvExportService` → `getReadiness`, `listExports`, `requestExport`,
  `retryExport`, `issueDownload`)
- `src/features/cv/cv-errors.ts` (kode service `EXPORT_*`, `blockers` pada `CvServiceError`, pemetaan kode database
  baru termasuk `IDEMPOTENCY_KEY_REUSED` → `CONFLICT`)
- `src/features/cv/actions.ts` (`requestCvExportAction`, `retryCvExportAction`, `issueCvExportDownloadAction`; helper
  `runExport`; `mapCode` dan `failure` diperluas aditif)
- `src/i18n/messages.ts` (kunci `cv.export.error.*`, `cv.export.blocker.*`, `cv.export.status.*` en dan id)
- `tests/unit/{cv-export-service,cv-export-actions,cv-export-i18n}.test.ts` (baru)
- `docs/verification/T21-implementation-plan.md` (checkbox Fase 5), receipt ini

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `vitest run … cv-export-service cv-export-actions cv-export-i18n` (sebelum implementasi) | 1 | **FAIL**: 3 file, 18 failed / 1 passed |
| idem + `cv-actions` + `cv-service` (setelah implementasi, run pertama) | 1 | 1 failed / 106 passed — salah ekspektasi test: field form tambahan memang diabaikan action |
| `vitest run … cv-export-service cv-export-actions cv-export-i18n` (setelah perbaikan test) | 0 | 3 file, **50 passed** (30 + 16 + 4) |
| `pnpm typecheck` | 0 | tanpa error (paritas kunci en/id dijaga tipe `Record<keyof typeof en, string>`) |
| `pnpm lint` | 0 | tanpa warning |
| `pnpm test` | 0 | **97 file / 836 test passed** (Fase 4: 94 / 786); `cv-actions` dan `cv-service` T18–T20 lulus tanpa perubahan |
| `pnpm build` | 0 | build produksi sukses; tidak ada route baru |
| `grep console. src/features/cv` | — | 0 kecocokan |

## Acceptance yang terbukti pada fase ini

- Service: tanpa sesi → `UNAUTHENTICATED` tanpa panggilan database atau query (semua lima method); input salah
  (`expected_revision` 0, key tidak aman, key tambahan `user_id`, `export_id` bukan UUID) → `VALIDATION` tanpa panggilan.
- Readiness divalidasi Zod (ready konsisten dengan blocker); tanpa baris (akun deleting) → `UNAUTHENTICATED`; baris
  rusak atau error RPC → `UNAVAILABLE` tanpa teks sentinel.
- Daftar: maksimum 10 (limit lebih besar dipotong), terbaru dulu, `eq("user_id", aktor)`, kolom aman saja
  (tanpa `snapshot`, `object_key`, `attempt_token`, `lease_expires_at`, `idempotency_key`, `user_id`); baris dengan
  kolom privat ditolak.
- Request dan retry memakai argumen RPC milik sesi saja; key di-trim; receipt rusak → `UNAVAILABLE`.
- Pemetaan error: setiap kode database export → kode service + `messageKey` + `correlationId`;
  `CV_EXPORT_BLOCKED` membawa blocker dari `detail` yang divalidasi strict (detail rusak, berisi teks, atau kode asing →
  `EXPORT_BLOCKED` dengan blocker kosong); pesan error tidak pernah memuat sentinel.
- Unduhan: RPC memberi key, service memverifikasi key adalah objek `export` milik aktor lalu memanggil
  `issueDownload(key, 300)`; hasil hanya `{ url, expiresInSeconds }` (tanpa key/token); key kosong, bukan string, kategori
  `evidence`/`import`, owner lain, atau format rusak → `UNAVAILABLE` tanpa menyentuh storage; kegagalan storage →
  `UNAVAILABLE` tanpa bocor; storage service hanya dibangun saat unduhan diminta (request/retry tidak memerlukan
  kredensial admin).
- Action: validasi input tiga action tanpa panggilan database atau revalidate; `revalidatePath("/cv")` hanya setelah
  request/retry sukses, tidak pada kegagalan dan tidak pada unduhan; blocker kembali sebagai `latestRecord.blockers`;
  `CV_EXPORT_IN_PROGRESS`/`NOT_RETRYABLE`/`NOT_READY`/`EXPIRED`/`STALE_REVISION`/`IDEMPOTENCY_KEY_REUSED` → `CONFLICT`,
  `CV_EXPORT_NOT_FOUND` → `NOT_FOUND`; satu `correlationId` yang sama antara service dan error action; field form yang
  tidak dikenal (mis. `user_id`, `object_key`) diabaikan sehingga tidak pernah sampai ke RPC.
- Copy: setiap kunci export punya teks en dan id yang tidak kosong, berbeda, dengan placeholder identik; semua kode
  blocker dan status tercakup; tidak ada kata internal (`object`, `bucket`, `snapshot`, `token`, `lease`, kode DB).

## Catatan

- `idempotency_key` datang dari klien per klik; service memvalidasi polanya dan RPC menegakkan keunikan per akun.
  T22 menghasilkan key baru per permintaan baru dan memakai ulang key yang sama saat mengulang request yang sama.
- Storage untuk unduhan memakai `createRequestPrivateStorageService()` yang sudah ada (terikat sesi, kredensial admin
  hanya di server); `PrivateStorageService` tidak diubah.
- Tidak ada UI, route, atau dependency baru.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 6: integration nyata (`tests/integration/cv-export.test.ts` dan `cv-export-renderer-real.test.ts`, script
`test:integration:cv-export`).
