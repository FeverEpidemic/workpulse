# T23 Fase 5 — UI S12, notice sign-in, notice S03, Retry S14

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Mode antislop: during (pilihan pengguna di sesi ini). Skill yang dibaca: core, ui, copywriting, human, layoutmobile, code.

## File berubah

| File | Perubahan |
| --- | --- |
| `src/features/account/delete-account-card.tsx` | baru: kartu *Privacy and account* dan dialog hapus akun |
| `src/features/account/delete-account-state.ts` | baru: aturan murni tombol, fokus, dan baris pratinjau |
| `src/features/profile/profile-workspace.tsx` | kartu baru setelah `AiConsentCard` |
| `src/components/ui/field-control.tsx` | `Input` menerima `ref` (tipe saja; React 19 meneruskannya) |
| `src/app/globals.css` | kelas `.delete-account*`, memakai token yang ada |
| `src/domain/import/review-view.ts`, `review-retention.ts` | `last_activity_at`; `formatAbandonedReviewDate` |
| `src/features/import/import-review-view-service.ts`, `import-review.tsx` | notice tanggal pembatalan otomatis di S03 |
| `tests/unit/delete-account-state.test.ts` (baru), `import-review-retention`, `import-review-view-service` | test |

Notice sign-in (`accountDeleted`, `accountDeleting`) dan Retry S14 (`exportActions`) sudah masuk di Fase 3.

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| `pnpm test` | **113 file / 1034 test** lulus |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 (`/settings/profile` terbangun) |

## Perilaku UI

- **Kartu.** Judul *Privacy and account*, satu paragraf yang menyebut apa yang dihapus, jendela 24 jam untuk data aktif dan berkas, dan 30 hari untuk salinan cadangan. Satu tombol *Delete account* bergaya `secondary`; gaya danger hanya ada di dalam dialog.
- **Dialog.** Memakai `Dialog` bersama (Escape dan klik latar menutup). Isi: hitungan dari `get_account_deletion_preview` (loading dengan `role=status`, gagal dengan teks yang tetap mengizinkan hapus), field password (`autocomplete="current-password"`), field email konfirmasi, lalu *Cancel* dan *Delete account permanently*.
- **Tombol danger** nonaktif sampai email cocok (tanpa membedakan huruf besar dan spasi) dan selama request berjalan; server tetap memverifikasi ulang.
- **Fokus.** Masuk ke field password saat dialog dibuka dan kembali ke tombol pemicu saat ditutup. Setelah gagal: password dikosongkan, fokus ke field yang salah, atau ke blok pesan bila kegagalannya bukan milik field.
- **Pengiriman** lewat `onSubmit` + transition (bukan `<form action>`) agar React tidak mereset field konfirmasi yang dikontrol; Enter tetap mengirim.
- **Kesalahan.** Password salah dan konfirmasi salah tampil di field masing-masing (teks, `aria-invalid`, `aria-describedby`); rate limit, tidak ada sesi, dan layanan tidak tersedia tampil di `InlineError` dalam dialog, dengan tautan masuk untuk `UNAUTHENTICATED`. Tidak ada status yang hanya berupa warna.
- **S03.** `import-review.tsx` menampilkan *This import will be cancelled automatically on <date> if you don't finish it.* dari aktivitas terakhir (batch atau item terbaru). Tanggal diformat UTC supaya render server dan browser sama; selisih paling banyak satu hari untuk zona waktu jauh dari UTC.
- **S14.** *Retry* hanya muncul bila CV siap dan snapshot ada; selain itu *Regenerate* (Fase 3). Kode `EXPORT_RETRY_UNAVAILABLE` punya pesan en dan id.

## Alasan keputusan UI (R-31)

- Satu aksi bergaya danger, hanya di dalam dialog: Design.md bagian 25 dan 27 meminta merah terkendali, eksplisit, dan tidak menyerupai aksi utama.
- Tanpa ikon, badge, animasi, atau dekorasi: ini layar pengaturan dengan dial ENERGY 1 / RHYTHM 1 / MOTION 1 yang sama dengan S12 yang ada; hierarki dibangun dari urutan keputusan (apa yang hilang, siapa kamu, konfirmasi).
- Hitungan berasal dari database, bukan tampilan statis (R-17, R-38); gagal memuat berarti teks jujur, bukan angka nol palsu.
- Dua kolom hitungan hanya mulai 480 px; di bawah itu satu kolom, tombol dialog membungkus (`ui-dialog-actions`).

## Delivery Gate antislop (ringkas)

| Item | Status | Bukti |
| --- | --- | --- |
| R-02 em dash | lulus | `account-deletion-i18n.test.ts` memeriksa 30 kunci en dan id |
| R-26 kontrol berfungsi | belum diklik | diklik dan dicatat per elemen di Fase 7 (Playwright) |
| R-27 empty/loading/error | lulus (kode) | loading, gagal-memuat, dan ready untuk pratinjau; error per field dan blok |
| R-32 keyboard dan fokus | lulus (kode), diverifikasi di Fase 7 | fokus masuk dan kembali diatur eksplisit; Escape lewat `Dialog` |
| R-25 kontras, R-03 responsive, R-34 tema | belum diukur | Axe dan screenshot 360/1440 light/dark di Fase 7 |
| R-35 dijalankan dan diklik | sebagian | `pnpm build` lulus; klik-through di Fase 7 |
| Teks privasi 24 jam dan 30 hari | kebijakan | klaim backup 30 hari belum terverifikasi; tercatat sebagai kebijakan di runbook (Fase 9) |

## Catatan

- Kartu belum diuji di browser; semua klaim perilaku dialog (fokus, reset form, Axe, overflow) menunggu E2E Fase 7. Risiko yang akan diperiksa pertama: apakah field konfirmasi tetap terisi setelah satu kegagalan.
- Tidak ada `console.` baru.

## Acceptance Fase 5 yang terbukti

§1.2 (UI konfirmasi: aturan tombol dan fokus diuji unit; E2E menyusul), §1.15 (notice S03, unit view service), §1.17 (aturan Retry, unit). §1.18 menunggu Fase 7.

## Langkah berikutnya

Fase 6: integration lintas domain (`account-deletion.test.ts` dilengkapi, `retention.test.ts`).
