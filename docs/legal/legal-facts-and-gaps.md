# Draf legal: sumber fakta dan yang masih kosong

Pendamping `privacy-policy-id-draft.md` dan `terms-of-service-id-draft.md`. Disusun 20 Oktober 2026 dari kode di branch `claude/cd-docker-images`.

## Sumber fakta

| Klaim di draf | Sumber |
| --- | --- |
| AI opsional, consent dicek sebelum kirim, yang dikirim dan tidak dikirim | Decision 0019 #6, #9, #13; `ai.consent.*` di `src/i18n/messages.ts` |
| Provider lewat adapter OpenAI-compatible, retensi di provider tidak dijanjikan nol | Decision 0019 #11; `src/server/ai/resolve-provider.ts` |
| Hapus akun: password + ketik email, tanpa undo, 24 jam data aktif, 30 hari backup | Decision 0029 keputusan produk 1-4, #10; `account.delete.privacy` |
| File impor dan teks dihapus ≤ 24 jam setelah terminal; review terbengkalai 30 hari | Decision 0029 #9; PRD *Data minimization* |
| PDF export kedaluwarsa 24 jam | `supabase/migrations/20261005090000_t21_cv_export_backend.sql:604` |
| Event produk tanpa isi, disimpan selama akun ada, ikut terhapus | Decision 0030 keputusan produk 7-8, #2, #9; `account.privacy.events` |
| Tanpa analitik pihak ketiga | Decision 0030 *Alternatif yang ditolak*; grep `src/` dan `package.json` bersih |
| Akses per akun, bucket privat | Decision 0031 #1 (katalog: tidak ada bucket publik, RLS di semua tabel `public`) |
| Cookie: sesi Supabase, `wp-locale`, tema, `wp-recovery-flow` | `src/server/supabase/server.ts`, `src/server/locale/cookie.ts`, `src/components/layout/theme-toggle.tsx`, `src/app/auth/confirm/route.ts` |
| Backup harian, dihapus sebelum 30 hari, tidak mencakup isi file | `docs/verification/T25-backup-runbook.md` §1; `deploy/staging/backup.sh` (`keep_days=29`) |

## Yang harus diisi pemilik produk

- [ ] Nama pengelola dan kota. Nama: Ilham Aisy Rasyid. Kota belum diisi.
- [x] Email kontak: `halo@myworkpulse.my.id`.
- [ ] Nama penyedia AI dan negaranya. Endpoint yang tercatat di decision 0019 adalah agregator OpenAI-compatible, jadi teks bisa diteruskan lagi ke penyedia model di belakangnya. Yang ditulis sebaiknya rantai lengkapnya.
- [ ] Region proyek Supabase production.
- [ ] Lokasi server (negara) untuk web, worker, dan backup.
- [ ] Penyedia SMTP untuk email Auth.
- [ ] Usia minimum.
- [ ] Jangka waktu menjawab permintaan salinan data.
- [ ] Masa pemberitahuan sebelum pilot berhenti dan sebelum syarat berubah.
- [ ] Pengadilan negeri untuk sengketa.
- [ ] Bagian 9 Syarat Layanan (batas tanggung jawab), bersama ahli hukum.

## Hal yang perlu diputuskan atau dicek sebelum terbit

1. **Backup production belum terverifikasi.** Runbook backup dan `keep_days=29` baru terbukti di staging. Klaim "backup dihapus sebelum 30 hari" di draf dan di S12 baru benar untuk production setelah cron yang sama terpasang di sana.
2. **Isi file tidak ikut backup**, dan backup hanya ada di satu server. Draf tidak menjanjikan pemulihan file, tetapi Syarat Layanan bagian 8 menyarankan pengguna menyimpan salinan CV sendiri karena alasan ini.
3. **Impor tanpa AI (T26) belum diimplementasi.** Decision 0032 masih draf. Setelah T26 rilis, Kebijakan Privasi bagian 4 perlu menyebut bahwa impor juga bisa berjalan tanpa mengirim teks ke penyedia AI.
4. **Versi consent.** Menyebut nama penyedia AI di kebijakan tidak mengubah apa yang dikirim. Tapi kalau penyedia diganti setelah rilis, decision 0019 #14 mewajibkan versi consent `ai-processing-v1` dinaikkan, dan kebijakan ini ikut diperbarui.
5. **Belum ada export semua data.** Bagian 8 menangani hak salinan data lewat email. Pastikan permintaan itu memang bisa dijawab (misalnya query manual per user).
6. **Batas pemakaian AI per akun** disebut sebagai kemungkinan di Syarat Layanan bagian 2. Naskah reels menyebutnya sebagai syarat sebelum promosi; implementasinya belum dicek di brief ini.
7. **Rute `/privacy` dan `/terms` belum ada.** Syarat Layanan sudah menautkan `/privacy`. Rute keduanya dibuat bersama landing page, dan link-nya dipasang juga di halaman pendaftaran.
8. **Versi English** ditulis setelah versi Indonesia disetujui, supaya review cukup sekali.
