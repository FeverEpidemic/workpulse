# T30 animasi dan loading: ringkasan bukti

- Tanggal: 23 Oktober 2026
- Branch: `claude/t30-motion-loading` (dari `466b2f8`, `origin/main` digabung di `cfeff32`). Status: **DONE** (acceptance lokal, closeout 23 Oktober 2026).
- Desain: [T30-motion-loading-design.md](T30-motion-loading-design.md). Rencana: [T30-implementation-plan.md](T30-implementation-plan.md). Decision: [0040](../decisions/0040-t30-motion-loading.md). Gate: [T30-review-remediation-plan.md](T30-review-remediation-plan.md).
- Receipt: [Fase 0](T30-phase0-baseline.md), [1](T30-phase1-foundation.md), [2](T30-phase2-loading.md), [3](T30-phase3-buttons.md), [4](T30-phase4-transitions-copy.md), [5](T30-phase5-e2e-regression.md), [5b remediasi](T30-phase5b-remediation.md). Screenshot: [T30-screenshots](T30-screenshots/).
- Eksekutor Fase 0 sampai 5: ChatGPT Sol 6.1 (reasoning medium). Reviewer, remediasi RV1, dan closeout: Claude.

## Yang berubah

Tombol yang ditekan mengecil sedikit, tombol yang menunggu server menampilkan spinner dengan label dan lebar tetap, dan tidak bisa dikirim dua kali. Skeleton berdenyut, setiap halaman loading menampilkan teks, dan setelah 8 detik muncul catatan dengan tombol muat ulang. Link navigasi yang diklik menampilkan pending sampai halaman berikutnya tampil. Job AI, import, dan export menampilkan tahap, lama menunggu, dan catatan bila lebih lama dari biasanya, tanpa persentase. Modal, sheet, backdrop, dan toast punya transisi masuk/keluar; aktivitas baru dari Quick log diberi highlight sekali; konten halaman masuk singkat saat navigasi di dalam app. Reduced motion mengganti spinner dengan ikon statis dan tetap menampilkan teks status. Tanpa migration, route API, server action, atau dependency baru.

## Acceptance

| # | Ringkas | Bukti |
| --- | --- | --- |
| 1 | Token motion dan batas 240 ms | unit `motion-tokens` |
| 2 | Efek tekan `scale(0.97)` pada lima varian | E2E `motion-loading` (pointer native, light/dark) |
| 3 | Tombol pending: label/lebar tetap, opacity 1, spinner setelah 150 ms | unit `button-pending`; E2E `motion-loading`, `activity-ui`; story `Button` |
| 4 | Tanpa submit ganda | E2E: dua klik, satu POST, satu activity |
| 5 | Satu sumber pending | inventaris Fase 0/3; unit `import-mode-dialog`, `ai-analysis-panel` |
| 6 | Skeleton berdenyut tanpa gradient, teks memuat terlihat | unit `loading-pages` (en/id); E2E `motion-loading`, `release-a11y` |
| 7 | Catatan loading lama dan muat ulang | unit `slow-loading-notice`; E2E navigasi (request dokumen nyata) |
| 8 | Pending navigasi sidebar dan tab bar | unit `navigation-loading-store`, `navigation-pending`; E2E 6 skenario (360/1440, light/dark, cleanup) |
| 9 | `ProgressStatus` AI/import/export | unit `progress-status-view`, `progress-status`; E2E `ai-review`, `import-onboarding`, `cv-export`, `release-a11y` |
| 10 | Transisi dialog, sheet, backdrop, toast; Escape dan fokus | unit `dialog-motion`, `toast-lifecycle`; E2E `motion-loading`, `release-keyboard` |
| 11 | Satu toast dan satu highlight setelah Quick log | E2E `motion-loading` (dashboard dan activity, light/dark) |
| 12 | Masuk halaman hanya konten, hanya navigasi client, filter GET tidak memicu | unit `motion-copy`; E2E page entry; probe gate review (Fase 5b) |
| 13 | Reduced motion | E2E `motion-loading`, `release-a11y`; story reduced motion |
| 14 | Axe 360/1440 light/dark, copy en/id tanpa em dash | E2E `release-a11y` (8 state baru); unit `motion-copy`, `theme-contrast` |

## Angka akhir

Setelah `origin/main` (T28, T29) digabung, di HEAD closeout. Env Supabase lokal hanya di proses; env var AI dikosongkan.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 153 file lulus. Run sebelumnya setelah merge: 1 gagal / 1438 lulus dari 1439 (test T28 di bawah), lalu diperbaiki |
| `pnpm build` | 0 | compiled |
| release suite (testMatch `playwright.release.config.ts`, port 3030) | 0 | 42 passed (9.8 menit) |
| `pnpm test:e2e:import` | 0 | 18 passed (2.9 menit) |
| `pnpm test:e2e:auth-google` | 0 | 17 passed (1.3 menit) |
| `pnpm test:e2e:ui` | 0 | 1 passed (50.1 dtk) |

Screenshot T25, T27, T29, dan T30 yang ditulis ulang suite dipulihkan dari HEAD.

Sebelum merge, receipt Fase 5 juga mencatat `test:e2e:activity` 1, `dashboard` 1, `ai-review` 11, `cv-export` 12, `m2` 1, `m5` 1, `build-storybook` dan `worker:check` lulus. Suite itu tidak diulang setelah merge karena T28/T29 tidak menyentuh area T30 di sana selain dialog dan import, yang diulang di atas.

Merge `origin/main` menghasilkan satu konflik di `src/components/ui/dialog.tsx` (`onCancel` T30 vs `dismissible` T29), digabung sehingga `dismissible={false}` tetap mencegah Escape. Satu test baru T28 (`import-mode-dialog.test.tsx:115`) mengharapkan label pending berganti; diubah ke pola T30, kategori yang diizinkan plan §5 Fase 3.

## Warning dan batas

- Warning baseline: `The destination stream closed early` pada navigasi yang dibatalkan, NO_COLOR/FORCE_COLOR.
- Hanya Chromium lokal. Belum diuji di Safari, Firefox, perangkat iOS fisik, staging, atau production.
- Ambang lambat 30/45/60 detik hipotesis UX pilot.
- P3 follow-up: N1 (Escape memanggil `onOpenChange(false)` dua kali), N2 (padding `Button` +4 px per sisi), `error.tsx` per route.
