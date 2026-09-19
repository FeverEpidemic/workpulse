# Verifikasi T07 — Capture dan Activity UI

Tanggal verifikasi: 18 September 2026

Status: **DONE**. Dependensi T04 dan T06 sudah `DONE`; Gate M2 tetap terbuka sampai T08–T12 selesai.

Implementasi mengikuti [rencana T07](T07-implementation-plan.md) dan trace PRD R04, User Flow F02
serta shared recovery, Wireframe S05–S06, Database Schema §§1–3/6, dan Design.md §§2, 6–7, 16–44.
Kontrak persistence tetap memakai service T06 dan keputusan 0009–0010.

## Hasil

- `/activity/new` menyediakan Note, Form, dan Chat. Activity tersimpan lewat service T06; Chat
  menyimpan pesan pertama sebagai source dan riwayat sequence 1 tanpa memulai AI.
- Tanggal default berasal dari timezone profil. Source mempertahankan spasi, Unicode, dan line break;
  validasi membatasi 10.000 code point tanpa trim atau pemotongan sebelum submit.
- Context Project/Experience hanya dibaca dengan owner scope. Project menentukan Experience efektif;
  context kosong atau unavailable tidak menghalangi capture mandiri.
- Save memakai idempotency key yang sama saat retry. Status `Saving…` menonaktifkan submit berulang;
  `Saved`/navigasi terjadi sesudah commit. Validation dan sesi berakhir mempertahankan input serta
  draft tab; setelah sign-in, draft dan operation key yang sama dapat disimpan.
- `/activity` menggunakan filter tanggal/project UUID, cursor service T06, urutan canonical, dan
  maksimal 30 row. Back/Forward, Next page, serta tautan kembali dari detail mempertahankan URL list.
- Detail menampilkan source penuh, tanggal, context, field Form, dan riwayat Chat asli. Edit memakai
  `expected_revision`; E2E membuktikan conflict lintas tab, tampilan versi server, retry eksplisit,
  reload, dan pesan Chat asli yang tidak ikut berubah.
- Malformed, random, dan foreign ID menghasilkan copy `Record unavailable` yang sama. Pembacaan
  foreign tidak mengungkap record akun lain.
- Tidak ada migration, perubahan schema/RPC/types, dependency baru, AI, achievement, evidence,
  Project CRUD, atau Activity delete dalam scope T07. Perubahan T05–T06 yang belum di-commit tetap
  dipertahankan.

## File T07

- Route dan filter: `src/app/(workspace)/activity/page.tsx`,
  `src/app/(workspace)/activity/new/page.tsx`, `src/app/(workspace)/activity/[id]/page.tsx`,
  `src/app/(workspace)/activity/loading.tsx`, `src/domain/routes/url-filters.ts`, dan
  `src/domain/routes/safe-return.ts`.
- Domain dan feature: `src/domain/activity/activity-display.ts`,
  `src/features/activity/activity-context-service.ts`, `activity-action-contract.ts`, `actions.ts`,
  `activity-capture-form.tsx`, `activity-list.tsx`, `activity-detail.tsx`, `activity-page-issue.tsx`,
  dan `activity-filters.tsx`. Form lama `quick-log-capture.tsx` digantikan oleh form Activity bersama.
- UI dan copy: `src/components/ui/record-unavailable.tsx`,
  `src/components/ui/unsaved-changes.tsx`, `src/i18n/messages.ts`, dan `src/app/globals.css`.
- Verifikasi: unit tests domain/action/URL Activity, `tests/e2e/activity-ui.spec.ts`, pembaruan
  `tests/e2e/app-frame.spec.ts` dan `tests/e2e/auth-profile.spec.ts`, serta
  `playwright.activity.config.ts`.
- Dokumentasi dan perintah: `package.json`, `README.md`, dan `docs/IMPLEMENTATION_STATUS.md`.

## Acceptance dan bukti browser

| Area | Bukti aktual |
| --- | --- |
| Capture dan recovery | Activity E2E menyimpan Note/Form/Chat, menguji keyboard mode/disclosure, tanggal profil, project→experience, source whitespace, validation recovery, session expiry, draft, operation key, dan tombol pending disabled. |
| List dan URL | E2E menguji filter tanggal/project UUID, 30+3 row tanpa gap, cursor, detail return, missing/foreign/malformed state; App-frame E2E menguji browser Back/Forward dan unavailable selection. |
| Detail dan edit | Activity E2E menguji source dan Chat history persis, Form fields, revision conflict pada dua tab, retry lokal, serta reload versi server. |
| Accessibility dan responsive | Axe WCAG 2.2 A/AA tidak melaporkan violation pada capture, detail, Form, filtered list, dan conflict. Pada 360/1440 px, route list/capture/detail tidak overflow horizontal pada light/dark. Reduced-motion check lulus. |
| Visual | Screenshot Playwright mobile light capture dan desktop dark detail diperiksa visual; layout sesuai hierarchy S05/S06 dan tidak menunjukkan clipping horizontal. File ada di `test-results/activity-ui-Activity-captu-04beb-work-against-local-Supabase/` dan diabaikan Git. |

Browser E2E memakai fixture Supabase lokal dengan dua akun dan cleanup di `finally`. Secret test
berada di process environment server/test, tidak dikirim ke browser dan tidak dicetak. Supabase
aktif lokal; `supabase/.temp/project-ref` tidak ada, sehingga tidak ada project hosted yang tertaut.

## Checks akhir

| Perintah | Hasil aktual |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; dependencies sudah up to date, lockfile tidak berubah. |
| `pnpm lint` | Exit 0; ESLint tanpa warning. |
| `pnpm typecheck -- --incremental false` | Exit 0. |
| `pnpm test` | Exit 0; 25 file / 124 unit tests. |
| `pnpm test:integration:activity` | Exit 0; 6/6 terhadap Supabase lokal. |
| `pnpm test:integration:storage` | Exit 0; 1/1 terhadap Supabase lokal. |
| `pnpm build` | Exit 0; production build menghasilkan route `/activity`, `/activity/new`, dan `/activity/[id]`. |
| `pnpm worker:check` | Exit 0; worker ready, belum ada registered jobs sesuai scope T07. |
| `pnpm db:test` | Exit 0; 240/240 pgTAP assertion. Database aktif tidak di-reset. |
| `pnpm db:lint` | Exit 0; tidak ada temuan severity `error`. |
| `pnpm db:status` | Exit 0; output credential disembunyikan. |
| `pnpm exec supabase migration list --local` | Exit 0; 9/9 migration di ledger lokal cocok dengan file lokal. |
| `pnpm test:e2e:auth` | Exit 0; 1/1 Auth/Profile E2E. |
| `pnpm test:e2e:ui` | Exit 0; 1/1 app-frame E2E, termasuk filter Back/Forward dan Quick log. |
| `pnpm test:e2e:activity` | Exit 0; 1/1 Activity E2E pada Chromium dan Supabase lokal, termasuk Axe, screenshot, responsive, dan revision recovery. |
| `git diff --check` | Exit 0; pemeriksaan terakhir setelah dokumentasi. |

`pnpm db:types`, migration baru, clean rebuild, dan DB reset tidak diperlukan karena T07 tidak
mengubah schema. Smoke E2E umum, hosted/staging/production, dan T24 performance tidak dijalankan;
semuanya di luar acceptance T07. E2E UI mencetak beberapa Next.js `destination stream closed early`
ketika navigasi mengganti stream; assertions dan test tetap lulus.

## Checkpoint

T07 ditandai `DONE` pada task tracker. Berikutnya T08 Projects dan context. Gate M2 tetap terbuka
sampai T08–T12 selesai. Tidak ada klaim migration hosted, staging, atau production.
