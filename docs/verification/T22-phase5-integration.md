# T22 Fase 5 — Integration nyata lintas lapis

- Tanggal: 7 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `8182783` (Fase 4).
- Status: **selesai**. Semua pengujian memakai Supabase Auth, Storage, dan database lokal nyata; satu kasus memakai renderer Chromium nyata (`workpulse-t21-pdf`) tanpa fallback ke fake.

## 1. Tujuan

Membuktikan di atas data nyata bahwa lapis server S14 dan aturan aksi bekerja bersama: status route mengikuti job dari `queued` ke `succeeded`, aturan Retry/Regenerate/Download mengikuti revision tersimpan, klik ganda tidak membuat dua job, kedaluwarsa dan blocker memengaruhi aksi, dan PDF yang akan digambar halaman S14 sama dengan yang tersimpan.

## 2. File berubah

| Aksi | File |
| --- | --- |
| Modify (test) | `tests/integration/cv-export-preview.test.ts` (dari 1 menjadi 8 test; support `cv-export-support.ts` tidak diubah) |
| Update | `docs/verification/T22-implementation-plan.md` (checkbox Fase 5) |

Tidak ada perubahan kode produksi pada fase ini.

## 3. Skenario (akun nyata, worker dalam proses)

1. **Status mengikuti job.** `GET /api/cv/exports/[id]` sebagai pemilik: `queued` → (di dalam seam `onRendered`, saat worker memegang job) `running` → `succeeded`. Urutan teramati persis `["queued","running","succeeded"]`.
2. **Revision tersimpan vs export lama.** Setelah export sukses, `exportActions` → `download` (tanpa sekunder). CV disimpan lagi (`title`, revision +1) → `regenerate` + `download` sekunder, tanpa alasan nonaktif. Request baru pada revision baru membuat export **baru** (`reused: false`, `cvRevision` = revision baru, `queued`); export lama tetap berrevision lama di database.
3. **Retry vs Regenerate.** Renderer gagal (`RENDERER_UNAVAILABLE`): attempt 1 pada revision tersimpan → `retry`. Setelah tiga attempt (dua `retryExport` + drain gagal) → `regenerate`, dan database menolak attempt keempat (`EXPORT_NOT_RETRYABLE`). Kegagalan (`RENDERER_TIMEOUT`) dari revision yang sudah bukan revision tersimpan setelah CV diedit → `regenerate`, tidak pernah `retry` (N2).
4. **Klik ganda.** Dua `requestExport` paralel dengan kunci idempotency berbeda pada revision sama → satu export (`exportId` sama; tepat satu `reused: true`); `count(cv_exports) = 1`.
5. **Kedaluwarsa.** `expires_at` dimundurkan lewat SQL → `regenerate` (tanpa `download`); request pada revision tersimpan membuat export baru (`reused: false`, `queued`), bukan mengembalikan yang kedaluwarsa. (Status route `expired: true` dan `EXPORT_EXPIRED` pada unduhan dibuktikan di test Fase 2 pada file yang sama.)
6. **Blocker.** Achievement terpilih dihapus lewat RPC `delete_achievement` setelah export sukses: readiness `ready: false` dengan `ITEM_DELETED` dan `item_id` item CV; revision CV naik; `exportActions` → `regenerate` + `download` sekunder dengan `disabledReason` = `cv.export.error.blocked`; request ke database ditolak `EXPORT_BLOCKED` dan **tidak** membuat job (jumlah export tetap).
7. **Renderer nyata, URL inline.** CV nama `Siti Nurhaliza Ç. Ñuñez` dan bullet Indonesia dirender oleh Chromium nyata lewat worker (`succeeded: 1`, tanpa galat). URL `inline` mengembalikan 200 dengan `access-control-allow-origin: *`; **hash SHA-256 byte yang disajikan sama dengan objek tersimpan**; parser `pdf-export` (pdf.js) membaca jumlah halaman yang sama dengan `page_count` di status route dan teks memuat bullet dan nama (setelah NFKC).

## 4. Uji kekuatan

Mutasi sementara pada `src/domain/cv/export-view.ts` (cek revision pada aturan Retry diganti `true`), lalu dikembalikan (`git diff` kosong): test skenario 3 **gagal** (`1 failed | 7 passed`). Tanpa mutasi: 8 lulus.

## 5. Command dan hasil

| Command | Hasil |
| --- | --- |
| `vitest run … cv-export-preview.test.ts` | exit 0, 1 file / **8 test** |
| `pnpm test:integration:cv-export` | exit 0, **3 file / 35 test** (T21: 27; `cv-export-preview`: 8), renderer nyata hidup |

Env tiap command: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`.

## 6. Acceptance §1 yang dibuktikan (integration)

- **§1.5 (sebagian):** status `queued` → `running` → `succeeded` lewat route; idempotensi klik ganda di backend.
- **§1.7 (lengkap di sisi server):** unduhan bernama, inline, TTL ≤ 305 detik, hash byte (Fase 2 dan 5).
- **§1.8:** Retry/Regenerate terhadap database nyata, termasuk batas tiga attempt dan revision lama.
- **§1.16 (server):** isolasi owner dan 404 identik (Fase 2); tidak ada kebocoran teks CV.
- **§1.4 (server):** blocker `ITEM_DELETED` dengan `item_id` dan penolakan request tanpa job.
- **§1.6 (sumber halaman):** PDF yang digambar halaman S14 adalah byte objek tersimpan dengan jumlah halaman = `page_count`; penggambaran canvas di browser menyusul Fase 6.

## 7. Warning dan blocker

Tidak ada kegagalan, blocker, atau stop condition. Test memakai satu proses Node untuk worker dan route (route dipanggil sebagai fungsi dengan sesi nyata); perilaku HTTP penuh, cookie, dan fokus diuji di E2E Fase 6.

## 8. Langkah berikutnya

Fase 6: `playwright.cv-export.config.ts` (port 3014), `tests/e2e/helpers/export-worker.ts`, dan sembilan skenario `tests/e2e/cv-export.spec.ts` (Axe, 360/1440 × terang/gelap, keyboard, screenshot halaman PDF dan keadaan S14, inspeksi gambar).
