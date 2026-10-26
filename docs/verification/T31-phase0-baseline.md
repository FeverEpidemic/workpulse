# T31 Fase 0: baseline

- Tanggal: 26 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Worktree: `.claude/worktrees/t31-impl`, branch `claude/t31-impl` dari `claude/t31-floating-tab-bar` (`f789e5b`). Cabang itu adalah `main` (`97ee13c`) ditambah dua commit dokumen plan T31, jadi tidak ada perubahan kode di atas `main`.
- Status: **berhenti di stop condition §8 (label tebal tidak muat)**. Fase 1 belum dimulai.

## Hasil command

| Command | Hasil |
| --- | --- |
| `git status` di worktree baru | bersih (hanya file scratch/receipt T31 yang baru) |
| `pnpm install --frozen-lockfile` | exit 0 |
| Paritas migration (`supabase migration list --local`) | **38/38**, 0 selisih, terakhir `20261019090000` |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **153 file, 1439 test lulus** (sesuai harapan closeout T30) |
| `pnpm test:e2e:release` | **42 lulus**, exit 0 (9,2 menit) |

Catatan lingkungan (bukan regresi kode):

- Docker Desktop mati saat sesi mulai; dinyalakan. Kong gagal start karena bind-mount menunjuk ke worktree lama `D:\Project\WorkPulse-t29`; stack dihidupkan ulang dengan `pnpm db:stop` lalu `pnpm db:start` (tanpa reset, data tetap, paritas tetap 38/38). `config.toml` identik dengan checkout utama (hash sama), blok Google tetap ada. File versi image di `supabase/.temp` disalin dari checkout utama lebih dulu.
- Run E2E pertama gagal 4 test karena kredensial fixture tidak dimuat dan container `workpulse-t21-pdf` mati. Run kedua gagal 1 test (`release-a11y` T30 pending) karena `workpulse-t10-clamav` dan `workpulse-t15-gotenberg` mati. Setelah container dinyalakan dan env dimuat (`SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY`, variabel AI harness dikosongkan), run ketiga lulus 42/42.
- Test E2E menulis ulang screenshot tracked di `docs/verification/T25-screenshots`, `T27-screenshots`, `T30-screenshots`; dikembalikan dengan `git checkout`.

## Ukur label tebal di 360 × 640 (build produksi, bar saat ini)

Font tab: `700 12px Plus Jakarta Sans`.

| Label | Lebar tebal | Catatan |
| --- | --- | --- |
| Dashboard | **64,5 px** | terlebar |
| Activity | 45,4 px | |
| Projects | 48,9 px | |
| Profile | 37,8 px | |

Bar sekarang: slot 70,4 px (`(360 - 8) / 5`), isi tab 68,4 px (border transparan 1 px per sisi). Dashboard muat dengan sisa 3,9 px.

Kapsul 336 px sesuai plan: lebar dalam 334 px (border 1 px), padding list 4 px per sisi, slot `(334 - 8) / 5` = **65,2 px**, isi tab 63,2 px. Label Dashboard tebal 64,5 px **melebihi isi tab 1,3 px**. `.workspace-tab-label` memakai `overflow: hidden; text-overflow: ellipsis`, jadi tab aktif Dashboard akan terpotong menjadi "Dashboar…". Ini menggagalkan acceptance 6.

Ini persis stop condition §8 bullet 2 dan review focus 1. Plan melarang memilih sendiri. Opsi yang diukur untuk pengguna:

1. Gutter 8 px: kapsul 344 px, slot 66,8 px, isi tab 64,8 px. Dashboard muat dengan sisa 0,3 px (mepet).
2. Label 11 px (turun dari token `--font-size-xs` 12 px): Dashboard tebal sekitar 59 px, muat dengan sisa sekitar 4 px. Menambah ukuran font baru di luar skala.
3. Padding list kiri/kanan 0, gutter tetap 12 px: slot 66,8 px, isi tab 64,8 px. Sama mepetnya dengan opsi 1, dan tab aktif menempel ke tepi kapsul.

## Inventaris test yang membaca posisi atau padding bar

- `tests/e2e/mobile-tab-bar.spec.ts`: padding ≥ 64 (baris 187), tap `box.x + 2` (baris 131), toast di atas bar (266), durasi transisi tiga selector (319).
- `tests/e2e/app-frame.spec.ts:259-265`: hanya visibilitas dan screenshot.
- `tests/e2e/motion-loading.spec.ts:35,76`, `tests/e2e/helpers/motion-loading.ts:132,208,230`: klik + dan elemen pending; tidak membaca posisi.
- `tests/e2e/release-keyboard.spec.ts:196`: tombol Quick log.
- `tests/unit/mobile-navigation-ui.test.tsx:39`: markup `<nav class="workspace-tab-bar" ... data-compact="false">` (markup tidak berubah).

## Rujukan file:baris

Semua cocok dengan plan: `globals.css:419-440`, `:448-471`, `:1175-1190`, `:1498-1503`, `:1807-1815`; `tokens.css:76-87`; `mobile-tab-bar.tsx:49-52` tidak dibaca ulang karena markup tidak diubah.

## Berikutnya

**Keputusan pengguna (26 Oktober 2026, di chat): opsi 1, gutter 8 px.** Konsekuensi untuk plan: `--tab-bar-gutter: var(--space-2)`; kapsul expanded 344 px di 360 px (`left` 8, `right` 352, `bottom` = 640 - 8); padding bawah `main` ≥ 64 + 8 = 72 px (bukan 76); ruang konten `calc(64px + var(--tab-bar-offset) + var(--space-10))` tetap. Sisa 0,3 px untuk Dashboard tebal mepet, jadi acceptance 6 diuji di E2E dan hasilnya dicatat di receipt Fase 2.

Lalu Fase 1. File scratch `tests/e2e/zz-t31-measure.spec.ts` dan `playwright.t31tmp.config.ts` tidak di-commit dan dihapus sebelum commit Fase 1.
