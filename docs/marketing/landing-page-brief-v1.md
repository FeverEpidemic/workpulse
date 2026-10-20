# Landing page myworkpulse.my.id (brief v1)

Hasil interview 2026-10-20. Sumber arah visual: `docs/Design.md` (sage, Plus Jakarta Sans, logo lima titik di 16.2). Cerita dan aturan klaim ikut `reels-30s-v1.md`.

## Keputusan

| Topik | Keputusan |
| --- | --- |
| Lokasi | Root `/` di app ini. Belum login: lihat landing. Sudah login: tetap diarahkan ke dashboard atau onboarding seperti sekarang (`src/app/page.tsx`). |
| Bahasa | Indonesia dan English lewat i18n `en`/`id` yang sudah ada. Kunjungan pertama ikut bahasa browser (Indonesia dapat `id`, sisanya `en`), ada toggle untuk ganti. |
| Cerita hero | Sama dengan reels: mau update CV, lupa setahun kemarin ngerjain apa. Jawabannya: catat kerjaan tiap hari, nanti tinggal pilih. |
| Fitur yang ditonjolkan | Catat Activity cepat, AI usulkan Achievement (user yang setujui), CV PDF satu kolom, Import CV lama. |
| Status | "Pilot gratis". Rencana freemium tidak disebut. |
| CTA | Daftar langsung di app, tanpa waitlist, tanpa kuota. |
| Video | Belum ada. Section video disembunyikan sampai file-nya ada, bukan kotak kosong. |
| Bukti visual | Potongan UI asli yang dirender dari komponen app, diisi data contoh fiktif dan diberi label "contoh". Bukan screenshot, bukan skeleton. |
| Data dan AI | Disebut: AI tidak mengubah apa pun tanpa persetujuan, catatan asli tetap tersimpan, akun dan data bisa dihapus (fitur ada di `src/features/account/`). Nama provider AI dan lokasi server tidak disebut. |
| Pembuat | Tampil nama asli, satu paragraf pendek, email domain. |
| FAQ | Tidak ada sampai ada pertanyaan nyata dari calon user. |
| Legal | Kebijakan Privasi dan Syarat Layanan dibuat baru. Claude menyusun draf dari kode (data yang disimpan, provider, hapus akun), pemilik me-review, sebaiknya dicek orang yang paham hukum sebelum live. |
| Arah visual | Satu nada dengan app, lebih hidup. |

## Yang tidak boleh muncul

- Klaim "lolos ATS". Yang boleh: satu kolom, teks asli.
- Angka hasil, jumlah user, testimoni. Belum ada data nyata.
- Nama merek pembanding.
- Link nav ke halaman yang belum ada.

## Design Read

Reading this as: landing produk personal untuk karyawan aktif, fresh graduate, dan freelancer di Indonesia, dalam bahasa visual app sendiri (sage, tenang, profesional tapi tidak formal), dial ENERGY 2 / RHYTHM 2 / MOTION 1.

- ENERGY 2: lebih menyapa dari app, tetap tenang.
- RHYTHM 2: komposisi section konsisten, dengan beberapa jeda yang sengaja beda.
- MOTION 1: hover dan focus saja, sesuai Design.md 2.4 dan 28.4.
- Motif identitas: ritme lima titik dari logo (hari kerja, satu hari kosong, hari ini).

## Urutan isi (draf, mengikuti alur cerita)

1. **Header**: logo, toggle bahasa, Masuk, Daftar.
2. **Masalah**: dua baris dari reels, lalu CTA daftar pilot gratis.
3. **Alur kerja**: catat Activity, AI usulkan Achievement, user setujui, pilih untuk CV, download PDF. Satu alur yang mengalir, bukan tiga kartu bernomor.
4. **Import CV lama**: tidak mulai dari kosong.
5. **Kendali atas data**: AI butuh persetujuan, catatan asli tetap ada, akun bisa dihapus.
6. **Video**: disembunyikan sampai file ada.
7. **Dari pembuat**: nama, paragraf pendek, email.
8. **Penutup**: CTA daftar, footer berisi Privasi, Syarat, kontak.

## Masih terbuka

- [ ] Nama asli untuk bagian pembuat, dan isi paragrafnya.
- [ ] Alamat email domain (misal `halo@myworkpulse.my.id`) dan forwarding-nya.
- [ ] Rute pendaftaran yang dituju CTA (cek apakah sign-up ada di `/sign-in` atau rute sendiri).
- [x] Draf Kebijakan Privasi dan Syarat Layanan (versi Indonesia): `docs/legal/`. Isian yang masih kosong ada di `docs/legal/legal-facts-and-gaps.md`.
