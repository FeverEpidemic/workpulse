# T30 Fase 0: baseline

- Tanggal: 22 Oktober 2026.
- Status: COMPLETE. Baseline release lulus 21/21, exit 0 (4.0 menit).
- Branch: `claude/t30-motion-loading`, baseline `dcd146d`, bersih sebelum pekerjaan ini.
- Eksekusi sendiri, tanpa sub-agent. Checkout utama tidak diubah.
- antislop during, session override. Design Read: workspace karier privat untuk pengguna individu, bahasa visual tenang sesuai Design.md, ENERGY 1 / RHYTHM 1 / MOTION 2.

## Tujuan dan lingkup

Membuktikan baseline dan dukungan Next sebelum mengubah implementasi. Fase ini hanya mengubah receipt dan checkbox plan. Tidak ada perubahan source, server action, dependency, migration, atau flag Next.

## Command dan hasil aktual

| Command | Exit | Hasil |
| --- | --- | --- |
| `git status --short`, `git branch --show-current` | 0 | bersih, branch sesuai |
| `pnpm install --frozen-lockfile` | 0 | 599 package, lockfile tidak berubah; percobaan sandbox awal exit 1 karena DNS Corepack |
| hitung `supabase/migrations/*.sql` | 0 | 38 file, terakhir `20261019090000_t26_import_rules_extraction.sql` |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | tanpa error atau warning lint |
| `pnpm typecheck` | 0 | tanpa error |
| `pnpm test`, pertama | 1 | 128 file unit / 1233 test lulus; 7 suite Storybook gagal mengambil Google Fonts |
| `Invoke-WebRequest` Google Fonts | 0 | HTTP 200 |
| `pnpm test`, ulang tanpa perubahan assertion | 0 | 135 file / 1262 test lulus, termasuk 29 test Storybook |
| `pnpm db:status`, output disaring | 0 | stack lokal aktif; credential tidak dicetak |
| `pnpm test:e2e:ui`, pertama | 1 | 1 gagal; worktree ternyata tidak mempunyai `.env.local`, sehingga Auth unavailable |
| `pnpm test:e2e:ui`, env proses dari Supabase lokal | 0 | 1 passed (1.2 menit) |
| `pnpm test:e2e:release`, pertama | 1 | 11 passed, 1 failed, 9 tidak berjalan; renderer PDF mati |
| `docker start workpulse-t21-pdf workpulse-t15-gotenberg workpulse-t10-clamav` | 0 | container yang sudah ada dinyalakan |
| probe Chromium `useLinkStatus`, dev Next 16.3.5 | 0 | 1 passed: hydrated, pending false ke true, navigasi selesai |

Key publik dan SERVICE_ROLE_KEY diambil dari `supabase status -o env` ke env proses saja, tidak dicetak atau ditulis ke file. Build E2E berhasil menggunakan font asli. Suite mengeluarkan warning NO_COLOR/FORCE_COLOR dan Next `The destination stream closed early`; E2E UI tetap lulus.

## Probe useLinkStatus

Fixture sementara di `test-results/t30-probe` memakai Next yang terpasang, Link dengan `prefetch={false}`, child yang memanggil `useLinkStatus`, serta route lambat dengan `loading.jsx`. Chromium menunda respons RSC 1500 ms. Probe awal salah memakai origin 127.0.0.1 yang diblokir dev resource Next, sehingga belum terhidrasi dan melakukan navigasi document. Probe final memakai localhost, menunggu `data-hydrated=true`, memverifikasi header RSC=1 dan pending=true bersamaan klik. Fixture bukan endpoint produksi dan dihapus Playwright saat suite berikutnya dimulai. Proses fixture sudah berhenti.

## Inventaris pending

| Path | Pemakaian useFormStatus | Keputusan untuk Fase 3 |
| --- | --- | --- |
| `src/components/forms/submit-button.tsx:18` | submit bersama | pertahankan sebagai adapter Button |
| `src/components/forms/action-feedback.tsx:23` | menyembunyikan feedback lama saat pending | bukan tombol, pertahankan |
| `src/components/forms/conflict-controls.tsx:104` | menyembunyikan konflik saat pending; tombol sudah Button | pertahankan guard, tidak mengubah form |
| `src/features/profile/ai-consent-card.tsx:144,153` | AllowSubmit, WithdrawSubmit sudah memakai Button | dapat memakai SubmitButton dengan name/value yang tetap |
| `src/features/ai/activity-analysis-panel.tsx:80` | SubmitButton lokal sudah memakai Button | gabung adapter bersama tanpa perubahan action |
| `src/features/ai/activity-analysis-panel.tsx:607` | ApplyButton raw button mengganti label | pindah ke Button dengan ref dan variant yang sama |
| `src/features/ai/activity-analysis-panel.tsx:622` | AllowSubmit sudah memakai Button | adapter bersama, pertahankan name/value |

Assertion label pending: `tests/e2e/activity-ui.spec.ts:220`, `tests/unit/import-mode-dialog.test.tsx:66`, dan `src/components/ui/button.stories.tsx` Loading. Assertion Saving pada import-review-ui adalah status penyimpanan kandidat, bukan label tombol dan harus tetap. `ai-analysis-panel.test.tsx` dan `ai-review.spec.ts` mengharapkan copy tahap AI yang ada, sehingga key tahap itu dipakai ulang.

## Lokasi data dan copy

- Status import S02: `src/features/import/import-start.tsx:321-334`; PROGRESS_KEYS di baris 44 memetakan uploading, waiting, screening, parsing, extracting. S03 processing: `src/features/import/import-review.tsx:406-412`.
- Aktivitas terbaru dashboard: `src/features/dashboard/dashboard-view.tsx:94-96`, data dari dashboard-service.
- Key existing: `ai.analysis.queued`, `ai.analysis.running`, `cv.export.status.queued`, `cv.export.status.running`, `import.uploading`, `import.state.waiting`, `import.state.screening`, `import.state.parsing`, `import.state.extracting`, `import.review.processingTitle`.
- Quick log: `mobile-chrome.tsx:75-78` hanya menutup sheet dan refresh. `activity-capture-form.tsx:269-276` memanggil `onCreated(activityId)` setelah sukses. ActionFeedback sudah mengirim toast, jadi callback baru hanya menyimpan marker dan refresh.
- Details/summary existing: activity-capture-form, conflict-controls, profile/foundation-editors, cv/cv-section. Details import-review dan import-review-candidate berada di luar scope animasi frame workspace.

## Durasi lokal dan selisih plan

Query baca saja pada timestamp fixture release di PostgreSQL: AI kind import 39 ms run / 208 ms enqueue sampai selesai; export nyata 1768 ms run / 2258 ms enqueue sampai selesai; import PDF dengan fake AI dan ClamAV nyata 1235 ms sampai review. Ini satu sampel lokal, bukan estimasi production; ambang 30/45/60 detik tetap hipotesis. Receipt T25 mencatat render staging kurang dari 15 detik menurut pengguna, bukan pengukuran alat. Query REST awal untuk cv_exports ditolak 403 sesuai privilege, lalu pengukuran menggunakan psql lokal baca saja; tidak ada payload atau ID di output.

- Baseline aktual 135/1262, bukan perkiraan 129/1181. Unit node 128/1233, ditambah 7 file / 29 test browser Storybook.
- `.env.local` yang diasumsikan handoff tidak ada di worktree ini. Konfigurasi lokal dipasok hanya lewat proses.
- Rujukan token CSS 88-89, active 1258, dialog 1322-1386, skeleton 1394, toast 1418-1433, reduced motion 1696 tetap sesuai. Icon button berada di 1474.
- Path ai-consent-card yang benar ada di `src/features/profile/`, bukan domain AI.
- `useLinkStatus` pada App Router berasal dari `next/dist/client/app-dir/link.js`; versi pages-router selalu idle dan tidak dipakai sebagai bukti.

## Acceptance dan langkah berikutnya

Belum ada acceptance 1-14 implementasi yang diklaim lulus. Baseline dan prasyarat hook terbukti. Setelah release lulus, pulihkan screenshot baseline yang ditulis suite, centang Fase 0, commit receipt dan plan, lalu mulai TDD token pada Fase 1.

## Penutupan

pnpm test:e2e:release ulang: exit 0, 21 passed (4.0 menit). Screenshot T25 dan T27 yang ditulis ulang suite dipulihkan dari HEAD. git diff --check exit 0. Tidak ada blocker; berikutnya Fase 1.
