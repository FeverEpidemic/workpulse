# T32 Fase 4: halaman legal

- Tanggal: 29 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override).

## Tujuan

`/privacy` dan `/terms` untuk tamu dan pengguna login, id dan en, dari draf di `docs/legal/`. Semua isian kosong tetap terlihat sebagai draf, ada label draf, dan halaman tidak diindeks selama `LEGAL_DRAFT` bernilai `true`.

## File berubah

- `src/features/legal/content/types.ts` (baru): `LegalDocument`, `LegalSection`, `LegalBlock` (`p`, `ul`, `table`), dan `LegalInline` (teks, `strong`, `code`, `placeholder`, `link`).
- `src/features/legal/content/{privacy,terms}.{id,en}.ts` (baru): disalin dari keempat draf Markdown.
- `src/features/legal/legal-status.ts` (baru): `LEGAL_DRAFT`, `legalPlaceholders`, `canPublishLegal`.
- `src/features/legal/documents.ts` (baru): `legalDocument`, `legalMetadata` (`robots: { index: false, follow: true }` selama draf).
- `src/features/legal/legal-page.tsx` (baru).
- `src/app/privacy/page.tsx`, `src/app/terms/page.tsx` (baru), dengan `generateMetadata`.
- `src/features/marketing/landing-footer.tsx` (baru): footer landing dipindah ke sini supaya bisa dipakai halaman legal, dengan `aria-current="page"`.
- `src/features/marketing/landing-page.tsx`: memakai `LandingFooter`.
- `src/i18n/messages.ts`: `legal.privacy.description`, `legal.terms.description`, `legal.draftNotice`, `legal.effective`, `legal.toc`.
- `src/app/globals.css`: blok `/* T32 legal pages */`.
- `tests/unit/legal-content.test.ts`, `tests/unit/legal-markup.test.tsx` (baru).

## Keputusan

1. **Model konten diperluas dari §2.2.9:** ada `intro` (paragraf sebelum bagian 1), blok `table` (Kebijakan Privasi bagian 6, seperti dicatat di Fase 1), dan segmen inline untuk huruf tebal, kode (`wp-locale`), placeholder, dan link. Tanpa segmen inline, `**…**` dan `[KURUNG SIKU]` hanya bisa tampil sebagai teks mentah atau lewat parser Markdown saat runtime, dan plan melarang parser itu.
2. **Disalin dengan skrip sekali jalan, tidak di-commit.** Skrip konversi di scratchpad menulis keempat file TS dari Markdown. Yang menjaga kesamaannya adalah `legal-content.test.ts`: ia membaca draf Markdown, menghapus penanda (`**`, backtick, sintaks link, pipa dan garis tabel), lalu membandingkan kata per kata dengan teks TS untuk intro, setiap bagian, dan tanggal berlaku. Kalau draf diubah tanpa menyalin ulang, test gagal.
3. **Placeholder** ditampilkan sebagai `<mark class="legal-blank">` dengan warna warning. Kontrasnya 6,24:1 di light (`#80530f` di atas `#fff7e9`) dan 8,02:1 di dark. Teks label draf menyebutnya "bertanda kuning" / "Highlighted".
4. **Guard draf:** `canPublishLegal(LEGAL_DRAFT, docs)` harus `true`. Kalau `LEGAL_DRAFT` diubah ke `false` sementara masih ada placeholder, test gagal. Test juga memastikan tidak ada `[` huruf besar yang lolos tanpa ditandai placeholder.
5. **Header dan footer** sama dengan landing (logo, toggle bahasa, Masuk, Daftar). Footer menandai halaman aktif dengan `aria-current="page"`, seperti mockup.
6. **Daftar isi:** di 768 px ke atas berupa sidebar sticky. Di bawah 768 px, 12 link setinggi 44 px mendorong isi sekitar 600 px ke bawah, jadi daftar isi dilipat ke `<details>` "Di halaman ini" yang tertutup. CSS hanya menampilkan satu dari keduanya, jadi hanya satu landmark `nav` yang terbaca. Link daftar isi setinggi 44 px; di mockup 36 px.
7. **Tabel retensi** memakai `caption` visually hidden (judul bagian) dan `th scope="col"`. Sel membungkus teks, jadi tidak perlu wadah scroll horizontal.

## TDD

File konten TS dibuat oleh skrip konversi sebelum test ditulis. Kedua file test dijalankan merah sebelum `legal-status.ts`, `documents.ts`, dan `legal-page.tsx` ada (2 suite gagal import), lalu lulus setelah implementasi.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| Skrip konversi | 0 | 4 file, masing-masing 12 bagian |
| Test legal sebelum implementasi | 1 | 2 suite gagal: modul belum ada |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **163 file / 1558 test** lulus (Fase 3b: 161 / 1528) |
| `pnpm exec playwright test --config playwright.config.ts` | 0 | 2 lulus |

## Cek di browser (dev server)

- `/privacy` 1440 light: daftar isi sticky di kiri, label draf, placeholder disorot, tabel retensi rapi. `meta robots` = `noindex, follow`, title "Privacy Policy · WorkPulse", 12 `h2`.
- `/terms` 360 dark: tanpa scroll horizontal, tidak ada link atau tombol di luar artikel yang di bawah 44 px. "Di halaman ini" tertutup lalu bisa dibuka, dan hanya satu nav yang terlihat. Footer "Terms of Service" `aria-current`.
- `/sign-in?mode=create-account`: link Syarat dan Privasi di bawah form sekarang mengarah ke halaman yang ada (dulu 404).

## Acceptance terbukti (unit dan manual; E2E di Fase 5)

- 16: keempat dokumen punya 12 bagian dengan heading sama dengan draf dan kata yang sama. Satu `h1`, 12 `h2` berurutan, tanpa `h3`-`h6`. Label draf `role="note"`, isian kosong `<mark>`, `robots` noindex di kedua bahasa. Nama dan email pengelola ada di bagian 1 dan 12, dan email di-link `mailto:`. Guard `LEGAL_DRAFT` diuji.

## Warning

- Link di dalam artikel tidak setinggi 44 px. Link inline di dalam paragraf termasuk pengecualian target sentuh WCAG 2.5.8.
- Draf Markdown tetap sumber utama. Setiap perubahan draf perlu menjalankan ulang skrip konversi (atau menyalin manual), dan test akan menunjukkan bagian yang berbeda.

## Blocker

Tidak ada.

## Berikutnya

Fase 5: E2E, regresi, aksesibilitas, Delivery Gate, lalu stop untuk gate review Claude.
