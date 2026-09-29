# T15 Fase 6 — Browser acceptance dan regresi penuh (receipt)

Tanggal: 29 September 2026. HEAD saat regresi: `7864b69` (+ perubahan assertion M2 di bawah).

## File berubah

- Baru: `playwright.import.config.ts` (port 3009, env web tanpa variabel AI/renderer), `tests/e2e/helpers/import-worker.ts` (worker child: fake AI, fake renderer, ClamAV nyata), `tests/e2e/import-onboarding.spec.ts`
- Diubah: `package.json` (script `test:e2e:import`), `tests/e2e/m2-manual-journey.spec.ts` (lihat di bawah)

## Browser acceptance S02 (`pnpm test:e2e:import`): 7/7

1. Consent ditolak: pilih file dengan keyboard (Tab ke drop area, Enter membuka file chooser) → Upload → dialog consent (fokus awal *Continue manually*) → Escape → fokus kembali ke drop area → tidak ada batch → *Start manually* ke S12.
2. Allow → *Waiting to start* tanpa worker → leave-return (pindah halaman lalu kembali: batch sama, satu batch) → hapus cookie (session kedaluwarsa) → sign-in → batch tersimpan tampil → worker → *Extraction finished*, 7 kandidat, tanpa link S03. Output worker tanpa sentinel isi CV maupun nama file.
3. File bukan PDF → alasan spesifik tanpa batch; PDF berpassword → gagal permanen tanpa Retry, dengan *Try another file* dan *Start manually*; *Try another file* memfokuskan drop area; cancel lewat dialog; unggah byte sama dua kali → peringatan duplikat nonblokir.
4. `AI_UNAVAILABLE` → Retry pada batch yang sama → *Extracting career data* → selesai; tetap satu batch.
5. Cancel saat menunggu: fokus awal *Keep importing*, Escape mengembalikan fokus ke pemicu, konfirmasi → *Import cancelled*; worker setelahnya tidak mengubah status.
6. Locale `id` (cookie sebelum onboarding, perilaku T03): DOCX kosong → *Dokumen tidak berisi teks.*; ekstraksi kosong → *Tidak ada data karier* + *Mulai manual*.
7. 360×800 dan 1440×900, light/dark: tanpa overflow horizontal.

Axe WCAG 2.2 A/AA dijalankan di state choose, consent, waiting, review-ready, failed-permanent, failed-retriable, failed (id), empty (id), dan keempat kombinasi layout; tidak ada pelanggaran. Screenshot dilampirkan di hasil Playwright.

Perbaikan test selama fase ini: selector `getByRole("alert")` ambigu karena route announcer Next.js juga `role="alert"` (dipersempit ke `.import-start`); test locale `id` harus memakai cookie `wp-locale` karena locale profil hanya berlaku setelah onboarding (T03).

## Perubahan assertion M2 (bukan pelemahan)

`tests/e2e/m2-manual-journey.spec.ts:170` mengasersi placeholder "Import CV · not available yet" yang memang diganti T15 dengan S02 nyata. Assertion diganti: tombol *Upload and extract* nonaktif sebelum ada file (tidak ada upload atau AI tanpa aksi pengguna). `expectAiFree` (tidak ada klaim analisis/saran AI) dan assertion env AI-free tidak diubah dan tetap lulus; jalur manual tetap diuji lewat *Start manually*.

## Regresi penuh

| Command | Hasil |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` | exit 0 / exit 0 |
| `pnpm test` | 66 file / 424 test |
| `pnpm db:test` / `pnpm db:lint` | 10 file / 668 assertion PASS / exit 0 |
| `pnpm test:integration:import` | 21/21 |
| `pnpm test:integration:{ai,ai-review,activity,achievements,projects,dashboard,m2,evidence,storage}` | 13, 21, 6, 5, 7, 4, 8, 14, 1 |
| `pnpm test:e2e:import` | 7/7 |
| `pnpm test:e2e:{ai-review,ai,auth,ui,activity,projects,achievements,dashboard,evidence}` | 11, 2, 1, 1, 1, 1, 4, 1, 8 |
| `pnpm test:e2e:m2` | gagal pada run penuh (assertion placeholder lama), 1/1 setelah penyesuaian di atas |
| `pnpm worker:check` / `pnpm worker:once` | exit 0 / exit 0 |
| `pnpm build` | exit 0 |

Lingkungan: Supabase lokal, ClamAV `127.0.0.1:13310`, Gotenberg 8.37.0 `127.0.0.1:13400`, env harness AI dibersihkan per run.

## Tidak dijalankan

- Smoke live `extractImport` ke provider nyata: butuh persetujuan eksplisit pengguna; tidak dijalankan.
- Staging/production: tidak ada deployment.
