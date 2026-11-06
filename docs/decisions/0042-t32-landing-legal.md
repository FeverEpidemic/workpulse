# Decision 0042: T32 landing page dan halaman legal

Date: 1 November 2026

Status: Accepted. Brief, referensi parloa.com, dan pilihan desain dari interview pengguna di chat (Oktober 2026). Mockup disetujui 28 Oktober 2026, copy deck dan terjemahan legal disetujui 29 Oktober 2026. Dieksekusi Claude Opus 5.5 (Fase 0 sampai 5) di branch `claude/t32-landing`. Gate review Claude Opus 5.5 pada 31 Oktober 2026: satu P2 (RV1) diperbaiki, review ulang lulus tanpa P0-P2. Task: T32 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T32-implementation-plan.md), [bukti](../verification/T32-landing-legal.md), [gate review](../verification/T32-review-remediation-plan.md). Tanpa migration (parity tetap 38), tanpa dependency.

## References

- **Brief** `docs/marketing/landing-page-brief-v1.md`, **copy deck** `docs/marketing/landing-copy-v1.md`, **draf legal** `docs/legal/`.
- **Design.md** §16.4 (pola landing) dan §17.5 (permukaan hangat), keduanya baru dari decision ini. §16.1 (dial app tetap ENERGY 1 / RHYTHM 1 / MOTION 2).
- **Decision 0040** (token motion dan blok reduced motion global di `globals.css`).

## Context

Root `/` dulu mengalihkan tamu ke `/sign-in`. Pengguna meminta landing page untuk pilot gratis, dengan Privasi dan Syarat yang bisa dibuka dari footer dan dari form daftar.

## Decisions

1. **`/` untuk tamu adalah landing. Akun login tetap dialihkan.** `rootDestination(context)` di `src/domain/routes/root-destination.ts`: tamu mendapat landing, akun onboarding ke `/dashboard`, akun provisional ke `/onboarding/import`, sesi tanpa profil ke `/sign-in?notice=serviceUnavailable`. `/` tidak menjadi path terlindungi. *Alasan:* perubahan sekecil mungkin. Pengguna yang sudah login tidak pernah melihat landing.
2. **Fallback `Accept-Language` untuk bahasa.** `resolveLocale(profil, cookie, acceptLanguage)`: locale profil setelah onboarding, lalu cookie `wp-locale` yang valid, lalu `id` bila bahasa dengan q tertinggi di header adalah `id` atau `in`, selain itu `en`. Parser di `src/i18n/accept-language.ts` tidak pernah melempar error. Ini berlaku di semua halaman yang memakai `getRequestLocale`. Itu termasuk `/sign-in`, halaman legal, dan juga halaman akun provisional (onboarding), karena profil baru dipakai setelah onboarding selesai. *Alasan:* brief, "Indonesia dapat `id`, sisanya `en`". Test lama memakai locale Playwright `en-US`, jadi hasilnya tidak berubah.
3. **`/sign-in?mode=create-account`.** `SignInClient` menerima `initialMode`. Nilai `mode` lain diabaikan. Form buat akun menautkan Syarat Layanan dan Kebijakan Privasi tanpa checkbox. Route tetap `/sign-in`, sesuai pilihan pengguna.
4. **UI app asli sebagai bukti visual.** Landing merender `ActivityListRow` (dipecah dari `ActivityList` dengan `href` opsional, markup app sama), `CvPreview`, `Badge`, dan kelas tombol/field app, dengan data fiktif di `src/features/marketing/sample-data.ts`. Setiap contoh dibungkus `ExampleFrame`: badge "Contoh"/"Example", `aria-label`, dan `inert`. *Alasan:* brief meminta UI asli, bukan screenshot. `inert` mencegah aksi dan fokus. `AchievementListRow` tidak dipecah karena mockup tidak punya daftar achievement.
5. **Dua token permukaan hangat**, `--color-bg-warm` dan `--color-bg-warm-subtle` (light dan dark, Design.md §17.5). Tanpa aksen baru. Teks sage tidak dipakai di atas warm-subtle (4,24:1).
6. **MOTION 3 hanya di landing**, dengan semua gerak memakai `--motion-slow`/`--ease-out` dan jeda di TS (`motion.ts`). Hal yang berbeda dari rencana awal:
   - Anti-kedip hero memakai skrip inline sebelum hero (`html[data-hero-story="armed"]`, menyerah setelah 3 s), bukan hanya `.is-reveal-ready` setelah mount. Cara itu masih memperlihatkan keadaan akhir sebelum hydration.
   - Reveal memakai cek scroll, bukan IntersectionObserver. Lompatan cepat bisa melewati section tanpa pernah berpotongan, dan section itu akan tetap tersembunyi. *Reveal sekali per section diganti fade dua arah per item oleh [decision 0043](0043-landing-two-way-fade.md).*
   - Panel tab lama langsung hilang. Hanya panel baru yang masuk dengan `@keyframes` sekali jalan.
   - Blok reduced motion khusus landing (`transition: none`, `animation: none`) ditambahkan di atas blok global decision 0040.
7. **Halaman legal sebagai data TS.** `src/features/legal/content/*.ts` disalin dari draf Markdown, tanpa parser Markdown saat runtime. Model kontennya: intro, paragraf, list, tabel, dan segmen inline (tebal, kode, placeholder, link). `tests/unit/legal-content.test.ts` membandingkan teks halaman dengan draf kata per kata. Placeholder `[…]` ditampilkan dengan `<mark>` warna warning. Halaman `noindex` dan berlabel draf selama `LEGAL_DRAFT` bernilai `true`, dan test gagal bila konstanta itu dimatikan sementara masih ada placeholder.
8. **Header halaman legal mengikuti sesi (RV1).** Akun onboarding mendapat logo dan "Buka dashboard", tanpa toggle bahasa (bahasanya dari profil) dan tanpa Masuk/Daftar. Tamu dan akun provisional mendapat header landing.
9. **Video ditunda.** Belum ada komponen atau placeholder video. Section itu ditambah setelah file video ada.

## Not promised

- Isian legal yang kosong (kota, penyedia AI dan negaranya, region server, penyedia email, usia minimum, jangka waktu, pengadilan) dan review hukum. Tanggung jawab pemilik produk.
- Forwarding email `halo@myworkpulse.my.id`.
- Belum diuji di Safari, Firefox, perangkat nyata, staging, atau production. Semua bukti berasal dari Chromium lokal di production build.

## Follow-up (P3 dari gate review)

- F1: akun yang sedang dihapus melihat landing di `/`, bukan pemberitahuan penghapusan di `/sign-in`.
- F3: tombol putar ulang muncul setelah hydration, sehingga hero sedikit bergeser.
- F4: dua test flaky yang tersisa (`landing.spec.ts` layout 360, `motion-loading.spec.ts:61` T30). Yang ketiga ditutup oleh RV2.
- F6: dua teks data contoh dicatat di copy deck (Fase 6).
- F8: axe untuk varian header akun login di halaman legal.
