# T30 animasi dan loading: desain

- Tanggal: 21 Oktober 2026
- Branch: `claude/t30-motion-loading` (dari `466b2f8`, `origin/main`). Status: **DESAIN**, menunggu review owner.
- Sumber arah: [DESIGN.md](../../DESIGN.md) §16.2, §28, §29, §37. Filter: antislop mode DURING, dial **MOTION 2**.
- Rencana implementasi: [T30-implementation-plan.md](T30-implementation-plan.md). Desain disetujui owner 21 Oktober 2026; dua koreksi dari pembacaan kode (skeleton, transisi halaman) dicatat di bagian 2.1 dan 3.

## Masalah

Owner melaporkan tiga hal:

1. App terasa kaku: modal, sheet, toast, dan halaman muncul tiba-tiba.
2. Saat loading, tidak jelas apakah app masih bekerja atau crash.
3. Saat tombol diklik, tidak terasa bahwa klik sudah diterima.

Penyebab yang terlihat di kode:

- `.ui-skeleton` (`src/app/globals.css`) hanya kotak `--color-bg-subtle` diam. Tidak ada `@keyframes` di seluruh `src/`.
- `Button` (`src/components/ui/button.tsx`) tidak punya efek tekan. Saat `loading`, teks diganti `loadingLabel` dan tombol disabled; tanpa `loadingLabel`, tombol mati tanpa tanda. `SubmitButton` di `activity-analysis-panel.tsx` punya logika pending sendiri.
- Job panjang (AI, import CV, export PDF) hanya punya status `queued` / `running` lewat polling, tanpa persentase.
- Blok `prefers-reduced-motion` global membuat semua animasi selesai dalam 0.01ms dan berjalan sekali, jadi indikator berputar akan membeku bagi pengguna reduced motion.

## Keputusan wawancara

| Topik | Keputusan |
| --- | --- |
| Lokasi masalah loading | Semua: pindah halaman, tombol simpan, dan job panjang |
| Dial | MOTION 2 (seimbang): transisi masuk/keluar dan halaman cepat, tanpa koreografi |
| Job panjang | Status jujur + tanda hidup + waktu berjalan; tanpa progress bar persentase palsu (R-38) |
| Feedback sukses | Satu saja: toast + item baru muncul. Tombol tidak menampilkan centang |
| Pendekatan teknis | CSS + View Transitions, tanpa dependency baru. Naik ke library `motion` hanya jika timeline mentok |

## 1. Pondasi

**Token** (`src/styles/tokens.css`):

| Token | Nilai | Dipakai untuk |
| --- | --- | --- |
| `--motion-instant` | 100ms | efek tekan |
| `--motion-fast` | 120ms (ada) | hover, keluar |
| `--motion-normal` | 180ms (ada) | masuk, perubahan state |
| `--motion-slow` | 240ms | sheet, drawer, halaman |
| `--ease-out` | `cubic-bezier(0.2, 0, 0, 1)` | elemen masuk |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | elemen keluar |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | perubahan state |

Aturan: tidak ada transisi di atas 240ms (kecuali highlight memudar item baru dan putaran shimmer, yang bukan transisi interaksi), dan tidak ada animasi yang memblokir input.

**Reduced motion.** Blok global tetap. Tambahan: indikator loading tidak boleh hanya mengandalkan gerak. Di reduced motion, spinner diganti ikon statis + teks status; tanda hidup datang dari teks yang berubah (tahap dan waktu berjalan). Skeleton diam tetapi selalu disertai teks "memuat" yang terlihat. Masuk/keluar menjadi fade singkat atau instan.

**Aksesibilitas.** `aria-busy` dan `role="status"` yang ada tetap dipakai. Waktu berjalan tidak diumumkan tiap detik ke screen reader; yang diumumkan hanya pergantian tahap dan peringatan "butuh lebih lama".

## 2. Pola loading

### 2.1 Pindah halaman

- Item navigasi (sidebar, tab bar) yang diklik langsung menampilkan state pending lewat `useLinkStatus` dari `next/link`. Verifikasi dukungan di Next 16.3 di Fase 0; jika tidak tersedia, pakai `useTransition` + router.
- Skeleton: berdenyut pelan lewat `opacity` (1 → 0.55 → 1, sekitar 1.6 detik), dicek di light dan dark. Bukan shimmer kiri ke kanan, karena shimmer butuh gradient dan Design.md §16.1 melarang gradient (koreksi 22 Oktober 2026). Ini satu-satunya animasi berulang selain spinner: punya pemicu (data dimuat) dan berhenti saat konten datang.
- Anti-kedip: skeleton baru terlihat setelah sekitar 150ms (`animation-delay` pada opacity).
- Lebih dari 8 detik: muncul teks "masih memuat" dengan tombol muat ulang. Saat ini tidak ada `error.tsx` di `src/app/`; error boundary per route adalah follow-up di luar T30.

### 2.2 Tombol simpan atau kirim

- Tekan: `scale(0.97)` + warna sedikit lebih gelap, `--motion-instant`.
- Pending: tombol langsung disabled sejak klik (tidak bisa submit ganda); spinner kecil muncul setelah 150ms di dalam tombol, label tetap, lebar tidak berubah.
- Sukses: toast + item baru (bagian 3). Gagal: pesan error di dekat tombol, tombol aktif kembali.
- Pola ini dibangun sekali di `Button`. `SubmitButton` lokal digabung ke pola yang sama sehingga tidak ada tombol yang lupa state loading.

### 2.3 Job panjang (AI, import CV, export PDF)

Satu komponen `ProgressStatus` untuk ketiganya:

- Indikator kecil bergerak (DESIGN.md §28.2) + teks tahap (antre, lalu memproses) + waktu berjalan yang muncul setelah 3 detik.
- Ambang wajar per jenis job, usulan awal: AI 30 detik, export 45 detik, import 60 detik. Angka ini dicek terhadap data job nyata di Fase 0 sebelum dipakai. Lewat ambang, teks berganti menjadi peringatan bahwa proses kadang butuh lebih lama.
- Gagal: state error dan tombol coba lagi yang sudah ada.

Semua copy lewat i18n (en/id), tanpa em dash. Teks final ditulis saat implementasi dengan skill antislop-copywriting.

## 3. Transisi

`Dialog` dan sheet mobile memakai `<dialog>` native, jadi masuk memakai `@starting-style` dan keluar memakai `transition-behavior: allow-discrete`, tanpa JS tambahan.

| Elemen | Masuk | Keluar | Tujuan |
| --- | --- | --- | --- |
| Modal | fade + scale dari 0.98, 180ms | fade, 120ms | menandai lapisan baru |
| Bottom sheet (Quick log, More) | naik dari bawah, 240ms | turun, 180ms | gerak searah asal sheet |
| Backdrop | fade, 180ms | fade, 120ms | |
| Toast | slide pendek + fade, 180ms | fade, 120ms | menarik perhatian tanpa kaget |
| Item baru di timeline | geser 4px + latar sage tipis memudar sekitar 1.2 detik | | menunjukkan di mana data baru masuk (§28.1) |
| Pindah halaman | konten utama fade + geser 4px, 180ms; sidebar dan tab bar diam | | kontinuitas tanpa dramatisasi |
| Accordion / collapsible | tinggi + opacity, 180ms | sama | |
| Tab bar | transisi tinggi yang ada tetap | | |

Sengaja tidak dianimasikan: stagger isi list, animasi saat scroll, kartu terangkat saat hover, dan logo (§16.2).

Koreksi 22 Oktober 2026: transisi halaman memakai `src/app/(workspace)/template.tsx` dengan animasi masuk CSS, bukan View Transitions. `next.config.ts` tidak punya flag `viewTransition` dan opsi itu tidak ada di schema Next 16.3.5, sedangkan T30 tidak memakai flag eksperimental. Hasilnya sama untuk pengguna (masuk saja, tanpa animasi keluar) dan jalan di semua browser.

## 4. Tahapan dan testing

| Fase | Isi |
| --- | --- |
| 0 | Baseline: suite yang ada hijau, cek `useLinkStatus` dan View Transitions di Next 16.3 / React 19.3, ukur durasi job nyata |
| 1 | Pondasi: token, easing, aturan reduced motion |
| 2 | Loading: shimmer + anti-kedip skeleton, pending nav, `ProgressStatus` di AI / import / export |
| 3 | Tombol: tekan, spinner di `Button`, `SubmitButton` digabung |
| 4 | Transisi: dialog, sheet, toast, item timeline, accordion, halaman |
| 5 | Regresi seluruh suite E2E + Delivery Gate antislop |

Testing:

- Unit (vitest, fake timers): kemunculan waktu berjalan, ambang peringatan, pergantian tahap, anti-kedip 150ms, pengumuman screen reader hanya saat tahap berganti.
- Storybook: semua state tombol, skeleton, dan `ProgressStatus`, termasuk reduced motion dan dark mode, dengan addon a11y.
- E2E (Playwright): tidak ada submit ganda, `aria-busy` saat pending, dialog buka/tutup dengan Escape termasuk animasi keluar, `emulateMedia({ reducedMotion: 'reduce' })` tetap menampilkan teks status.
- Risiko: E2E yang ada menjadi flaky karena elemen bergerak. Mitigasi: durasi pendek (maksimal 240ms) dan regresi penuh di Fase 5.
- Klik-tembus di browser per elemen, light dan dark, desktop dan 360 px (R-35).

## Di luar lingkup

- Progress bar persentase (tidak ada datanya).
- Library animasi baru.
- Perubahan alur, copy di luar status loading, atau layout halaman.
