# T27 bottom tab bar mobile: ringkasan bukti

- Tanggal: 20 Oktober 2026
- Branch: `claude/t27-mobile-tab-bar` (dari `ef98935`). Status: **DONE** (acceptance lokal, closeout 21 Oktober 2026).
- Rencana: [T27-implementation-plan.md](T27-implementation-plan.md). Decision: [0035](../decisions/0035-t27-mobile-tab-bar.md). Gate: [T27-gate-review.md](T27-gate-review.md).
- Receipt: [Fase 0](T27-phase0-baseline.md), [1](T27-phase1-routes-state.md), [2](T27-phase2-tab-bar.md), [3](T27-phase3-sheets.md), [4](T27-phase4-copy-a11y.md), [5](T27-phase5-e2e-regression.md).

## Yang berubah

Di ≤ 880 px, hamburger + drawer diganti header ringkas dan bottom tab bar lima slot (Dashboard, Activity, +, Projects, Profile). + membuka sheet composer dengan catatan terfokus dan menyimpan di tempat. Achievements, Timeline, CV, tema, dan keluar ada di sheet Menu lainnya dari header Profile. Desktop tidak berubah. Tanpa migration, route API, atau dependency baru.

## Acceptance

| # | Ringkas | Bukti |
| --- | --- | --- |
| 1 | Lima slot, tanpa drawer, desktop tetap | unit `mobile-navigation-ui`, E2E `mobile-tab-bar` 1 dan 5, `app-frame` |
| 2 | Tab aktif, `aria-current`, bukan warna saja | unit `navigation-routes`, `mobile-navigation-ui`; E2E 1 |
| 3 | Label mengikuti scroll, tetap di nama aksesibel | unit `use-scroll-chrome`, `mobile-navigation-ui`; E2E 1 |
| 4 | Header ikut scroll, tidak sembunyi saat fokus/sheet | unit `use-scroll-chrome`, `mobile-navigation-ui`; E2E 1 dan 4 |
| 5 | Composer sekali tap, simpan di tempat, validasi sama | unit `mobile-sheets-ui`; E2E 3; `app-frame`; `release-keyboard` |
| 6 | Draft bersama dan tidak hilang | unit `mobile-sheets-ui` (`mergeDraftValues`); E2E 3 |
| 7 | Menu lainnya | unit `mobile-sheets-ui`; E2E 4; `release-keyboard` |
| 8 | Inisial di tab Profile | unit `initials-avatar`; E2E 1 |
| 9 | Konten tidak tertutup, tanpa scroll samping | E2E 2; matriks `release-a11y` 360 px |
| 10 | Reduced motion | E2E 5 |
| 11 | Keyboard, target 44 px, axe 360 px light/dark, kontras | E2E 5 dan 6; `release-keyboard`; `release-a11y`; `theme-contrast` (tanpa token baru) |
| 12 | Copy en/id lewat i18n, tanpa em dash | unit `mobile-navigation-i18n` |

## Angka akhir

- `pnpm test`: 134 file / 1261 test (baseline 128 / 1180).
- `test:e2e:release`: 21 passed (baseline 15; +6 dari `mobile-tab-bar.spec.ts`).
- `test:e2e:ui`, `auth`, `activity`, `m2`, `dashboard`: masing-masing 1 passed.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`: exit 0.
- Parity migration tetap 38.

## Penyimpangan dari plan

- Key copy tambahan: `workspace.profileTab`, `workspace.moreMenuDescription`, `quickLog.sheetDescription`.
- `onCreated(activityId)` dipakai untuk sukses create di varian sheet, karena `onSaved` menerima baris hasil edit.
- Composer tidak mendaftar ke penjaga unsaved-changes; draft-nya digabung ke draft form penuh (`useSessionDraft` opsi `merge`, default mati).
- Skenario E2E mobile ada di spec baru `mobile-tab-bar.spec.ts` (masuk config release yang ada) agar bisa memakai fixture dengan 23 aktivitas; `app-frame` dan `release-keyboard` mengganti langkah drawer.

## Risiko terbuka dan follow-up

- Keyboard iOS Safari belum diuji di WebKit atau perangkat nyata.
- Foto profil (migration + storage + upload) dengan fallback inisial.
