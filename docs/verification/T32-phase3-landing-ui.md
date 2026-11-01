# T32 Fase 3: landing UI

- Tanggal: 29 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override).

## Tujuan

Landing lengkap di `/` untuk tamu dalam keadaan akhir, tanpa gerak: header, hero, panel demo bertab, import CV, Data kamu, pembuat, penutup, footer. Tata letak mengikuti mockup yang disetujui, teks mengikuti copy deck yang disetujui.

## File berubah

- `src/features/marketing/` (baru): `landing-page.tsx`, `landing-header.tsx`, `locale-toggle.tsx` (client), `hero-story.tsx`, `demo-tabs.tsx` (client), `step-dots.tsx`, `example-frame.tsx`, `sample-data.ts`.
- `src/features/activity/activity-list.tsx`: `ActivityListRow` dipecah keluar dengan `href` opsional. `ActivityList` memakainya dengan `href` yang sama seperti sebelumnya, jadi markup app tidak berubah.
- `src/app/page.tsx`: merender `LandingPage` dan `generateMetadata` (`landing.meta.*`).
- `src/i18n/messages.ts`: semua key `landing.*` en dan id.
- `src/styles/tokens.css`: `--color-bg-warm` dan `--color-bg-warm-subtle`, light dan dark.
- `src/app/globals.css`: blok `/* T32 landing */` di akhir file.
- `tests/unit/landing-copy.test.ts`, `landing-markup.test.tsx`, `landing-css.test.ts` (baru).
- `tests/e2e/smoke.spec.ts`: assertion `title` mengikuti `landing.meta.title`.

## Keputusan di fase ini

- **Komponen app yang dipakai:** `ActivityListRow` (hero), `CvPreview` (tab CV, bagian meta "Preview" disembunyikan lewat `.landing-cv .cv-preview-meta`), `Badge`, kelas `button-primary`/`button-secondary`, `field-label`, `field-input`, dan `achievement-source-preview`. Quick log, kartu review, dan contoh import disusun dari primitive ini, sesuai inventaris Fase 0.
- **`AchievementListRow` tidak dipecah.** Mockup tidak punya baris daftar achievement. Kartu achievement di hero dan tab review berbentuk kartu review, jadi `achievement-list.tsx` tidak disentuh.
- **Data contoh** ada di `sample-data.ts` per locale, bukan di `messages.ts`. Copy deck mencatatnya sebagai data contoh, bukan key. Scan kata terlarang di `landing-copy.test.ts` ikut memeriksanya.
- **Key tambahan di luar copy deck**, semuanya label aksesibilitas atau label pendek: `landing.home`, `landing.example`, `landing.steps.label`, dan `exampleLabel` untuk Quick log, review, CV, dan import. Teksnya menjelaskan isi contoh, tanpa klaim.
- **Panel demo tanpa JavaScript:** server merender ketiga panel tanpa `hidden`. Setelah hydration (`useSyncExternalStore`) hanya panel terpilih yang terlihat. Panah kiri/kanan, Home, dan End sudah jalan. Gerak tab ada di Fase 3b.
- **Toggle bahasa:** form dengan dua tombol submit di `saveLocalePreference` yang sudah ada. Jalan tanpa JavaScript, tanpa action baru.
- **Hero** merender keadaan akhir: Activity tersimpan, lalu Achievement usulan AI dengan badge "Disetujui". Efek ketik dan tombol putar ulang ada di Fase 3b.
- **Kolom teks hero** dibuat lebih lebar dari mockup (`flex: 1.3`). Judul en lebih panjang dari id, dan di 1440 px sempat terpecah lima baris.

## Kontras permukaan hangat

Dihitung dengan rumus WCAG:

| Teks | Latar | Rasio |
| --- | --- | --- |
| `#1a211c` text-primary | `#f6f3ec` warm | 14,83 |
| `#59635c` text-secondary | `#f6f3ec` warm | 5,63 |
| `#59635c` text-secondary | `#efeadf` warm-subtle | 5,20 |
| `#567657` action-primary (label kecil) | `#f6f3ec` warm | 4,59 |
| `#567657` action-primary | `#efeadf` warm-subtle | **4,24** |
| `#f1f5f2` text-primary dark | `#1c1b17` warm | 15,66 |
| `#b6c0b8` text-secondary dark | `#23211c` warm-subtle | 8,59 |
| `#8faf87` action-primary dark | `#23211c` warm-subtle | 6,62 |

`action-primary` sebagai warna teks di atas `warm-subtle` di bawah 4,5:1. Karena itu landing tidak menaruh teks hijau di permukaan itu. Panel demo dan penutup hanya memakai teks primary/secondary di sana, dan tab terpilih memakai teks putih di atas hijau (5,09). Ini dicatat sebagai komentar di `tokens.css`. Nilai token mengikuti nilai awal plan.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| Test baru sebelum implementasi | 1 | 2 suite gagal import, 3 test CSS gagal |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | |
| `pnpm typecheck` | 0 | Percobaan pertama gagal (`updated_at` belum ada di data contoh), diperbaiki |
| `pnpm test` | 0 | **160 file / 1513 test** lulus (Fase 2: 157 / 1489) |
| `pnpm exec playwright test --config playwright.config.ts` | 0 | 2 lulus |

`motion-tokens.test.ts` tetap lulus. Blok landing tidak memakai durasi literal.

## Cek di browser (dev server, panel browser)

- 1440 light: semua section tampil berurutan. Klik tab CV dan panah kiri menghasilkan satu panel terlihat, `aria-selected` pindah, fokus tetap di tab, dan status titik menjadi "Steps 1-3 of 5".
- 360 light: `scrollWidth - innerWidth = 0`, tidak ada elemen keluar layar, tidak ada link atau tombol di bawah 44 px. Bagian bawah CTA hero di 562 px dari tinggi 780, jadi terlihat tanpa scroll. Header turun jadi dua baris.
- 360 dark: hero, panel demo, dan import terbaca di permukaan hangat dark.
- Toggle ID: `lang="id"`, judul dan title berganti ke Indonesia, tombol ID `aria-pressed="true"`. Dikembalikan ke EN setelahnya.
- Console: tanpa error.

## Acceptance terbukti (sebagian, unit dan cek manual)

- 6: scan kata terlarang di semua key `landing.*` dan data contoh, kedua bahasa. Tidak ada key `landing.video*`, tidak ada FAQ atau `<video>`.
- 7: lima `ExampleFrame` dengan `role="group"`, `aria-label`, badge "Example"/"Contoh", dan `inert`. `<main>` tanpa `form`/`submit`, dan link di dalamnya hanya ke `/sign-in?mode=create-account`, `/sign-in`, dan `mailto:`.
- 8 (sebagian): tablist server dengan tiga panel terbaca. Keyboard dicek manual. Gerak di Fase 3b.
- 11 (sebagian): lima titik, status teks, terpisah dari `BrandSymbol`.
- 14 (sebagian): token warm di light dan dark. Blok CSS tanpa gradient, literal warna, atau `rgba`.
- 15, 18 (unit/manual): pembuat dan `mailto`, footer Privasi/Syarat/kontak, `generateMetadata`.

E2E untuk semua butir ini ada di Fase 5.

## Warning

- `/privacy` dan `/terms` masih 404 sampai Fase 4.
- Klik toggle bahasa juga mengubah cookie `wp-locale` di panel browser. Sudah dikembalikan ke `en`.

## Blocker

Tidak ada.

## Berikutnya

Fase 3b: motion landing.
