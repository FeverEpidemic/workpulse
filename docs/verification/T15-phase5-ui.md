# T15 Fase 5 — UI S02 (receipt)

Tanggal: 29 September 2026.

Tujuan: layar S02 `/onboarding/import` untuk consent, pilih/drop file, upload, progres, leave-return, cancel, gagal permanen/transient, retry, ringkasan kandidat saat `review`, dan peringatan duplikat.

## File berubah

- Baru: `src/features/import/import-start.tsx`, `tests/unit/import-start-ui.test.tsx`, `docs/verification/T15-renderer-runbook.md`
- Diubah: `src/app/onboarding/import/page.tsx` (placeholder "not available yet" diganti S02 nyata; redirect onboarding dipertahankan), `src/components/ui/ai-consent-dialog.tsx` (prop opsional `purpose="import"`), `src/app/globals.css` (kelas `import-*` berbasis token)

## Keputusan UI

- Consent diminta sebelum upload lewat `AiConsentDialog` dengan copy import ("Hanya teks yang dibaca dari CV yang Anda unggah"). Versi consent tetap `ai-processing-v1`; S02 juga selalu menampilkan penjelasan pemrosesan sebelum upload. Allow → upload otomatis dilanjutkan; Escape/Continue manually → tidak ada upload dan fokus kembali ke drop area.
- Drop area adalah `role="button"` yang dapat difokus; Enter/Spasi membuka file chooser. Input file tersembunyi dari pembaca layar (satu kontrol, bukan dua).
- Progres per `stage` (`role="status"`, teks jelas, tanpa spinner): *Waiting to start*, *Checking file*, *Reading document*, *Extracting career data*, plus "You can leave this page". Polling memakai jadwal evidence (1–30 detik) dan berhenti di review/terminal.
- Gagal permanen: alasan spesifik, *Try another file*, *Start manually*, tanpa Retry. Gagal transient: Retry (nonaktif dengan alasan bila habis/kedaluwarsa/tanpa consent) + jalur manual.
- `review`: jumlah kandidat per kelompok dan pernyataan jujur bahwa peninjauan belum tersedia (T17). Tidak ada link ke S03. Ekstraksi kosong: *Start manually* sebagai aksi utama.
- Cancel memakai dialog konfirmasi (fokus awal pada *Keep importing*; Escape mengembalikan fokus ke pemicu). Setelah cancel/retry fokus pindah ke section status.
- Cancel, retry, dan consent dipanggil sebagai server action dari event handler (`useTransition`), karena aturan lint `react-hooks/set-state-in-effect` melarang menyalin hasil `useActionState` ke state di dalam effect.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/import-start-ui.test.tsx` | 8/8 |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | 66 file / 424 test |
| `pnpm test:e2e:auth` | 1/1 (regresi onboarding) |

## Catatan lingkungan

Run pertama `test:e2e:auth` gagal pada sign-up ("service temporarily unavailable"). Penyebabnya seluruh container Docker (Supabase, ClamAV, Gotenberg) berhenti pada saat yang sama; setelah `pnpm db:start` dan `docker start` untuk kedua container, test lulus tanpa perubahan kode. Data lokal tidak di-reset.

Berikutnya: Fase 6 (browser acceptance dan regresi penuh).
