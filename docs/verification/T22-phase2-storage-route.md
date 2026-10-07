# T22 Fase 2 — Storage aditif, service, action, dan route status

- Tanggal: 7 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `8874c97` (Fase 1).
- Status: **selesai**. Backend S14 (status, unduhan bernama, unduhan inline) terbukti dengan Supabase Auth, Storage, dan database nyata.

## 1. Tujuan

Menyediakan sisi server untuk S14 tanpa mengubah perilaku lama:

- adapter storage dapat menerbitkan signed URL `inline` dan `attachment` dengan nama file generik;
- service export punya `getExport(id)` dan `issueDownload({ export_id, disposition })`;
- action unduhan menerima `disposition` dari form;
- route `GET /api/cv/exports/[id]` untuk polling status.

Tanpa migration, tanpa perubahan RPC/worker T21.

## 2. File berubah

| Aksi | File |
| --- | --- |
| Modify | `src/server/storage/adapter.ts` (tipe `SignedDownloadOptions`, `DOWNLOAD_FILENAME_PATTERN`, `isValidSignedDownloadOptions`, parameter ketiga opsional) |
| Modify | `src/server/storage/supabase-storage-adapter.ts` |
| Modify | `src/server/storage/private-storage-service.ts` (kode error baru `STORAGE_DOWNLOAD_OPTIONS_INVALID`, parameter ketiga opsional) |
| Modify | `src/domain/cv/contracts.ts` (`CV_EXPORT_DISPOSITIONS`, `downloadCvExportInput` + `disposition` default `attachment`) |
| Modify | `src/features/cv/export-service.ts` (`getExport`, `issueDownload` dengan disposition dan nama), `src/features/cv/actions.ts` |
| Create | `src/app/api/cv/exports/[id]/route.ts` |
| Modify | `package.json` (file integration baru ditambahkan ke `test:integration:cv-export`) |
| Create (test) | `tests/unit/storage-download-options.test.ts`, `tests/unit/cv-export-status-route.test.ts`, `tests/integration/cv-export-preview.test.ts` |
| Modify (test) | `tests/unit/cv-export-service.test.ts`, `tests/unit/cv-export-actions.test.ts` (lihat §5) |

`tests/unit/private-storage-service.test.ts` dan `tests/unit/cv-contracts.test.ts` **tidak diubah** dan lulus. Plan §4 menyebut "test storage unit yang ada" untuk diperluas, tetapi §3.2 menuntut test storage lama lulus tanpa diubah; saya memilih file baru `storage-download-options.test.ts` agar keduanya terpenuhi.

## 3. Kontrak yang diimplementasikan

- **Adapter.** `createSignedDownloadUrl(key, ttl, options?)`:
  - tanpa opsi atau `{ disposition: "attachment" }` → `createSignedUrl(key, ttl, { download: true })` (perilaku lama, byte-identik untuk pemanggil lama termasuk evidence);
  - `filename` valid → `{ download: "<nama>" }`;
  - `inline` → `createSignedUrl(key, ttl)` tanpa opsi `download`; `filename` diabaikan;
  - opsi tidak valid (nama di luar `^[A-Za-z0-9._-]{1,80}\.pdf$`, disposition asing) → `StorageAdapterUnavailableError` sebelum menghubungi provider.
- **`PrivateStorageService.issueDownload(key, ttl = 300, options?)`:** urutan authorize → TTL 1..300 → validasi opsi (`STORAGE_DOWNLOAD_OPTIONS_INVALID`) → metadata → adapter. Tanpa opsi, adapter dipanggil dengan **dua** argumen seperti sebelumnya (`toHaveBeenCalledWith(key, 300)` di test lama tetap benar).
- **`CvExportService.getExport(id)`:** id bukan UUID → `null` tanpa I/O; selain itu satu `select` kolom aman dengan `eq("id")` dan `eq("user_id")` + `limit(1)`; baris diparse dengan `cvExportRowSchema` strict (kolom privat atau state rusak → `UNAVAILABLE`); tidak ada baris → `null`.
- **`issueDownload({ export_id, disposition })`:** `disposition` default `attachment`, `strictObject` (nama file dari klien ditolak). Urutan: RPC `get_cv_export_download` (otoritas, kedaluwarsa, kepemilikan) → cek key export milik pemanggil → untuk `attachment`, nama dari `exportDownloadName(finished_at)` lewat pembacaan baris best-effort (kegagalan apa pun → `WorkPulse-CV.pdf`, tidak pernah menggagalkan unduhan) → `getStorage().issueDownload(key, 300, options)`. `inline` tidak membaca baris dan tidak membawa nama.
- **Action:** `issueCvExportDownloadAction` meneruskan `disposition` hanya bila field ada (string kosong atau nilai lain → `VALIDATION`); tidak ada revalidate.
- **Route:** `runtime = "nodejs"`, `dynamic = "force-dynamic"`, `Cache-Control: no-store`. Urutan: sesi dari `getRequestContext()` (anonim, profil hilang atau `deleting_at` → 401; `profileUnavailable` → 503) → `getExport(id)` → 200 `{ ...row, expired }` dengan `isExportExpired(row, now)` atau 404 `EXPORT_NOT_FOUND`. Galat: `{ code, message, correlationId }` (pesan dilokalkan dari profil), status 401/404/503, tanpa teks galat mentah.

## 4. TDD dan bukti

**RED** (sebelum implementasi): `vitest run` atas lima file unit → `cv-export-actions` 4 gagal, `cv-export-service` 9 gagal, `storage-download-options` 5 gagal, dan suite route gagal diimpor (`Cannot find package '@/app/api/cv/exports/[id]/route'`).

**GREEN** setelah implementasi: enam file unit (tiga baru/diperluas + `private-storage-service` dan `cv-contracts` lama) → `6 passed`, `130 passed`.

**Uji kekuatan test integration** (mutasi sementara pada `supabase-storage-adapter.ts`, lalu dipulihkan; `git diff` hanya memuat perubahan yang diinginkan):

| Mutasi | Hasil `cv-export-preview.test.ts` |
| --- | --- |
| `inline` ikut memakai `{ download: true }` | **gagal** (exit 1) |
| `filename` diabaikan (`{ download: true }`) | **gagal** (exit 1) |
| tanpa mutasi | lulus |

Isi integration `cv-export-preview.test.ts` (satu skenario, akun nyata A dan B, worker dengan renderer fake):

- status `queued` lalu `succeeded` dari route sebagai A; body hanya kolom aman + `expired`, tanpa `snapshot`, `object_key`, `attempt_token`, `lease_expires_at`, `idempotency_key`, `user_id`, dan tanpa teks CV, sentinel, atau id pemilik;
- sebagai B: id export A, UUID acak, `not-a-uuid` → 404 generik **identik** (kode, pesan, kunci body sama; hanya `correlationId` berbeda), `no-store`; anonim → 401;
- B tidak dapat `issueDownload` (`EXPORT_NOT_FOUND`), `retryExport` (`EXPORT_NOT_FOUND`), `getExport` (`null`), atau `listExports` (`[]`) atas export A;
- unduhan `attachment` (eksplisit dan default): HTTP 200, `content-disposition` memuat `attachment; filename=WorkPulse-CV-<hari UTC finished_at dari SQL>.pdf`, isi `%PDF-`, klaim `exp − now` > 0 dan ≤ 305 detik, URL tanpa nama akun atau sentinel;
- unduhan `inline`: HTTP 200, tanpa `attachment` pada `content-disposition`, `access-control-allow-origin: *`, `content-type: application/pdf`, tanpa parameter `download` di URL, `exp − now` ≤ 305, preflight `OPTIONS` 200;
- setelah `expires_at` dimundurkan lewat SQL: route `expired: true` dan `issueDownload` → `EXPORT_EXPIRED`;
- sentinel tidak muncul di respons, galat, atau `collectedErrors` yang dilihat B atau anonim.

## 5. Perubahan pada test lama (harus dilihat reviewer)

Dua assertion T21 diubah karena kontraknya diperluas oleh plan §3.2 (service sekarang meneruskan opsi ke storage):

| File | Sebelum | Sesudah |
| --- | --- | --- |
| `tests/unit/cv-export-service.test.ts` (download) | `expect(storage.issueDownload).toHaveBeenCalledWith(OBJECT_KEY, 300)` | `... toHaveBeenCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV.pdf" })` |
| `tests/unit/cv-export-actions.test.ts` (download) | `expect(issueDownload).toHaveBeenCalledWith(OBJECT_KEY, 300)` | `... toHaveBeenCalledWith(OBJECT_KEY, 300, { disposition: "attachment", filename: "WorkPulse-CV.pdf" })` |

Ini memperkuat, bukan melemahkan, assertion (nama file dan disposition kini ikut diperiksa); plan §4 memang mencantumkan kedua file itu untuk diperluas. Saya mencatatnya karena stop condition §8 menyebut perubahan suite lama. Tidak ada assertion lain pada suite T02–T21 yang diubah.

## 6. Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0, **101 file / 904 test** (sebelumnya 99 / 874: +2 file, +30 test) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test:integration:cv-export` | exit 0, **3 file / 28 test** (T21 27 + `cv-export-preview` 1; renderer nyata `workpulse-t21-pdf` hidup) |
| `pnpm test:integration:storage` | exit 0, 1 file / 1 test |
| `pnpm test:integration:evidence` | exit 0, 3 file / 14 test (pemanggil adapter lama, tanpa opsi, tetap lulus) |

Env tiap command: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`.

## 7. Acceptance §1 yang dibuktikan di fase ini

- **§1.7 Unduhan:** URL baru lewat action dengan `disposition`, TTL ≤ 300 detik (`exp − now` ≤ 305), nama generik `WorkPulse-CV-<YYYY-MM-DD>.pdf` dengan tanggal UTC `finished_at`, header `content-disposition` terverifikasi, export akun lain atau ID acak → `EXPORT_NOT_FOUND` (integration). Event download di browser dan "URL tidak dirender ke HTML" menyusul Fase 3/6.
- **§1.16 Owner dan privasi:** status route 404 generik identik untuk akun lain/ID acak/ID rusak, B tidak dapat mengunduh atau me-retry export A, respons tanpa object key/token/snapshot/teks CV (integration + unit route). E2E dan sentinel di console/network menyusul Fase 6.
- **§1.17 (sebagian):** tidak ada migration; adapter aditif (test storage lama tidak diubah dan lulus; evidence integration lulus). Regresi penuh di Fase 7.
- **§1.18 (sebagian):** tidak ada `console.` di file baru.

Belum dibuktikan: semua poin lain §1.

## 8. Warning dan blocker

Tidak ada kegagalan di akhir, tidak ada blocker, tidak ada stop condition. Catatan: `pdf.js`/UI belum disentuh; `/cv/preview` belum ada (Fase 3). `revalidatePath("/cv")` pada request/retry tidak diubah (plan §3.2); S14 akan memanggil `router.refresh()` sendiri.

## 9. Langkah berikutnya

Fase 3: state klien murni (`cv-export-page-state`), kunci i18n `cv.exportPage.*` dan `cv.builder.previewAndExport*`, route `/cv/preview` (+ `loading.tsx`), komponen `CvExportPage` dan `CvPdfPages`, `id="cv-profile"`, tautan *Preview and export* di S13, `returnTo` untuk `/cv/preview` (G1) dan shim tipe `pdfjs-dist/build/pdf.mjs` (G2) — tests lebih dulu.
