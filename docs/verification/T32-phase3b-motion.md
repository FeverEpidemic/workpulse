# T32 Fase 3b: motion landing

- Tanggal: 29 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override).

## Tujuan

MOTION 3 khusus landing (§2.2.8): cerita hero sekali jalan dengan tombol putar ulang, reveal bertahap, tab yang bergeser sesuai arah, titik langkah, dan interaksi mikro. Konten tetap utuh tanpa JavaScript dan dengan reduced motion.

## File berubah

- `src/features/marketing/motion.ts` (baru): jeda cerita hero, kecepatan ketik, stagger reveal 80 ms, batas tunggu hydration 3 s, dan skrip inline `HERO_STORY_ARM_SCRIPT`.
- `src/features/marketing/hero-story-state.ts` (baru): reducer murni `storyReducer`, `storyNextStep`, `initialStoryState`.
- `src/features/marketing/hero-story.tsx`: menjadi client component. Mengetik catatan lewat `raw_text` ke `ActivityListRow`, lalu saved, suggested, approved, done, dengan tombol "Replay example"/"Putar ulang contoh".
- `src/features/marketing/reveal-on-scroll.tsx` (baru).
- `src/features/marketing/demo-tabs.tsx`: arah geser (`data-direction`) dari klik dan dari panah/Home/End.
- `src/features/marketing/landing-page.tsx`: atribut `data-reveal`/`data-reveal-item` dengan `--reveal-delay` dari TS, skrip arm sebelum hero, dan `RevealOnScroll`.
- `src/features/marketing/sample-data.ts`: `reviewBadge` untuk hero.
- `src/app/globals.css`: blok `/* T32 landing motion */`.
- `tests/unit/hero-story-state.test.ts` (baru), `tests/unit/landing-css.test.ts` (diperluas).
- `tests/e2e/landing-motion.spec.ts` (baru), dimasukkan ke `testMatch` `playwright.release.config.ts`.
- `docs/verification/T32-screenshots/hero-story.webm` (baru).

## Keputusan dan selisih dari plan

1. **Anti-kedip hero memakai skrip inline, bukan hanya `.is-reveal-ready`.** Di §2.2.8, hero baru disembunyikan setelah mount. Dengan cara itu keadaan akhir dari server sempat terlihat sampai hydration selesai, lalu kembali ke awal. Itu kedip yang dilarang acceptance 10. Sekarang skrip kecil tepat sebelum hero memberi `html[data-hero-story="armed"]` sebelum hero di-parse, dan CSS menyembunyikan bagian cerita (`visibility: hidden`) hanya di bawah atribut itu. `HeroStory` menggantinya dengan `running` di `useLayoutEffect` (sebelum paint) dan memulai dari `idle`. Supaya konten tidak hilang:
   - Tanpa JavaScript, skrip tidak jalan dan keadaan akhir terlihat.
   - Dengan reduced motion, skrip tidak arm.
   - Kalau hydration tidak datang dalam 3 s, skrip mengganti atribut ke `expired`, keadaan akhir terlihat, dan `HeroStory` tidak memulai cerita.
   - Navigasi client ke `/` (skrip tidak jalan lagi) tetap memulai cerita sebelum paint.
2. **Reset ke `idle` tanpa transisi.** Saat cek di browser, kartu AI sempat memudar keluar 240 ms ketika hydration me-reset cerita. Fase `idle` sekarang mematikan transisi di bagian cerita, jadi hanya langkah maju yang memudar masuk.
3. **Reveal memakai cek scroll, bukan IntersectionObserver.** Lompatan cepat (End, link anchor, scroll roda besar) bisa melewati section tanpa pernah berpotongan, dan section itu akan tetap tersembunyi di atas viewport. Cek scroll ber-`requestAnimationFrame` me-reveal semua section yang top-nya sudah melewati 90% tinggi viewport, lalu listener dilepas setelah semuanya ter-reveal.
4. **Stagger dari TS.** `--reveal-delay` dihitung di server dari `REVEAL_STAGGER_MS`, bukan `calc(index * 80ms)` di CSS, supaya tidak ada durasi literal di CSS (§2.2.8).
5. **Panel lama langsung hilang.** Panel baru masuk lewat `@keyframes` sekali jalan (`translateX(±24px)` + fade, `--motion-slow`) setiap kali ia tampil dari `display: none`. Panel lama tidak dianimasikan keluar, jadi tidak pernah ada dua panel terlihat dan tidak perlu posisi absolut. Load pertama tidak bergerak karena `data-direction` belum ada.
6. **Reduced motion.** Plan menyebut blok reduced motion global di `globals.css` yang memaksa 0,01 ms. Blok itu tidak ada. Hanya ada blok per komponen, misalnya `ui-skeleton` dan `cv-layout`. Landing punya blok sendiri: `.landing *` dengan `transition: none !important; animation: none !important;`. Durasi terhitung 0 s, dan hover kartu ada di dalam `(prefers-reduced-motion: no-preference)`.
7. **Tempo.** `charMs` 25 ms diturunkan ke 22 ms dan `approveDelay` 450 ms ke 420 ms. Di browser dev, timer berantai molor sekitar 6%, dan catatan 90 karakter dengan nilai lama berada tepat di 3,5 s. Teori sekarang: 74 karakter (en) 2.848 ms, 82 karakter (id) 3.024 ms, 90 karakter 3.200 ms.
8. **Timeline E2E diukur dengan waktu nyata, bukan `page.clock`.** Plan meminta `page.clock` untuk timeline hero. Spec mencatat setiap perubahan `data-phase` dengan `performance.now()` lewat `MutationObserver` dari `addInitScript`, jadi yang diukur adalah durasi nyata termasuk molornya timer. `page.clock` dipakai untuk fallback 3 s saat hydration diblokir.

## TDD

`landing-css.test.ts` versi baru dijalankan sebelum CSS ditulis: 3 test gagal (reveal, hover, keyframes), lalu lulus. `hero-story-state.test.ts` ditulis bersamaan dengan reducer dan tidak dijalankan merah dulu. Ini selisih dari aturan TDD dan dicatat di sini.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **161 file / 1528 test** lulus (Fase 3: 160 / 1513) |
| `pnpm exec playwright test --config playwright.release.config.ts landing-motion.spec.ts` (percobaan 1) | 1 | 10 lulus, 2 gagal: route test fallback ikut memblokir CSS (Next 16 menaruh CSS di `/_next/static/chunks`), dan test keyboard memfokus tab yang tidak terpilih. Kedua perbaikan ada di test, bukan di kode. |
| Sama (percobaan 2) | 0 | **12 lulus**, 1 skip (rekaman video, butuh `T32_RECORD_VIDEO=1`) |
| `T32_RECORD_VIDEO=1 ... -g "plays once\|records one run"` | 0 | 2 lulus. Durasi cerita terukur **3.027 ms** (en). Video 230 KB. |
| `pnpm exec playwright test --config playwright.config.ts` | 0 | 2 lulus |

`test:e2e:release` lengkap belum dijalankan di fase ini (Fase 5).

## Acceptance terbukti

- 9: section yang sudah di layar saat mount (`landing-how` di 1440×900) langsung terlihat. Section di bawah mulai `opacity: 0` dengan geser 12 px dan `transition-delay` `0s, 0.08s, 0.16s, 0.24s`, durasi `0.24s`. Setelah di-scroll semuanya `opacity: 1`. Scroll cepat bolak-balik tidak meninggalkan item tersembunyi. Logo penutup tidak bertanda reveal, `animation-name: none`. Tanpa JS semua item `opacity: 1`.
- 10: urutan `idle, typing, saved, suggested, approved, done` sekali jalan dalam 3.027 ms, dan tidak berulang setelah 1,5 s. Kartu AI tidak terlihat saat DOMContentLoaded. Teks akhir sama dengan catatan contoh. Tombol replay 44 px atau lebih, jalan dengan Enter, `aria-disabled` selama berjalan, dan fokus tidak hilang. Contoh terbaca sebagai satu group berlabel, tanpa `aria-live`. Hydration yang diblokir menampilkan keadaan akhir setelah 3 s. Tab tersembunyi langsung ke `done`.
- 8 (gerak): panel kanan `landing-panel-from-right`, kiri `landing-panel-from-left`, `0.24s`. Klik beruntun menyisakan satu panel dengan `opacity: 1`. Panah, Home, dan End memindah pilihan dan fokus.
- 11: 1, 3, lalu 5 titik menyala, dengan teks "Step 1 of 5", "Steps 1-3 of 5", dan "Steps 1-5 of 5". Transisi `0.24s`, tanpa animasi loop.
- 12: hover contoh mengangkat kartu `translateY(-2px)` dengan `--shadow-lg`. Panah CTA bergeser 3 px saat hover dan saat `:focus-visible`. Indikator toggle bergeser selebar satu tombol dengan transisi `0.24s`. Di perangkat sentuh, media hover tidak cocok dan kartu tidak terangkat.
- 13: dengan reduced motion, tidak ada perubahan fase, tombol replay, `is-reveal-ready`, atau `data-hero-story`. Panel tanpa animasi, durasi transisi titik `0s`, dan kartu tidak terangkat. Tanpa JS, hero di keadaan akhir dan ketiga panel terlihat.

## Kesan tempo

Dari cek di browser dev dan log fase: pengetikan sekitar 1,6 s untuk 74 karakter, terbaca seperti orang mengetik cepat tapi tidak tergesa. Jeda saved, suggested, approved masing-masing 0,2-0,4 s, cukup untuk melihat badge berganti. Total sekitar 3 s, lalu hero diam. Video `hero-story.webm` belum ditonton ulang oleh pelaksana. Pengguna sebaiknya menontonnya untuk menilai tempo.

## Warning

- Bila hydration lebih lambat dari 3 s, keadaan akhir tampil, dan cerita tidak dimainkan sama sekali (bukan berkedip).
- `transition-delay` reveal tetap menempel di item setelah reveal. Item reveal tidak punya transisi lain, jadi tidak ada efek samping yang terlihat.

## Blocker

Tidak ada.

## Berikutnya

Fase 4: halaman legal.
