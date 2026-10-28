# Kebijakan Privasi WorkPulse

> **DRAF, belum berlaku.** Disusun dari kode dan decision record repo pada 20 Oktober 2026, belum di-review orang yang paham hukum. Teks dalam `[KURUNG SIKU]` wajib diisi pemilik produk sebelum terbit. Sumber tiap fakta ada di `legal-facts-and-gaps.md`.

Berlaku sejak: [TANGGAL BERLAKU]

WorkPulse adalah tempat mencatat pekerjaan sehari-hari, menyusunnya menjadi achievement, lalu memakainya untuk CV. Kebijakan ini menjelaskan data apa yang kami simpan, ke mana data itu pergi, berapa lama disimpan, dan apa yang bisa Anda lakukan atasnya.

WorkPulse saat ini berjalan sebagai **pilot gratis**. Fitur dan kebijakan ini masih bisa berubah. Kalau ada perubahan penting, kami beri tahu lebih dulu (lihat bagian 11).

## 1. Siapa pengelola WorkPulse

WorkPulse dikelola oleh Ilham Aisy Rasyid, [KOTA], Indonesia. Untuk pertanyaan atau permintaan soal data Anda, hubungi halo@myworkpulse.my.id.

## 2. Data yang kami simpan

**Data akun.** Alamat email dan password Anda. Password disimpan dalam bentuk hash oleh layanan autentikasi, jadi kami tidak bisa membacanya.

**Pengaturan profil.** Bahasa antarmuka, zona waktu, persetujuan pemrosesan AI beserta versi dan waktunya, serta isian profil karier yang Anda tulis sendiri.

**Catatan karier.** Semua yang Anda masukkan ke WorkPulse: activity, achievement, project, skill, pengalaman kerja, pendidikan, sertifikasi, dan CV yang Anda susun.

**File.** File bukti yang Anda unggah, file CV lama yang Anda impor beserta teks yang dibaca darinya, dan PDF CV hasil export.

**Catatan jenis aksi.** WorkPulse mencatat jenis aksi yang terjadi, misalnya "activity disimpan" atau "export CV selesai", untuk mengukur apakah produk bekerja dengan andal. Catatan ini **tidak** memuat isi tulisan Anda, teks CV, nama file, isi file, ID record, atau email.

Kami tidak memasang alat analitik atau iklan pihak ketiga.

## 3. Untuk apa data dipakai

- Menjalankan fitur yang Anda pakai: menyimpan catatan, menyusun CV, membuat PDF.
- Menjalankan analisis AI, hanya kalau Anda sudah mengizinkan dan memintanya (bagian 4).
- Memeriksa file unggahan dari malware sebelum file bisa dipakai.
- Mengukur keandalan produk selama pilot dari catatan jenis aksi di bagian 2.
- Mengirim email yang dibutuhkan akun, seperti konfirmasi pendaftaran dan reset password.

Kami tidak menjual data Anda dan tidak memakainya untuk iklan.

## 4. Pemrosesan AI

AI di WorkPulse **opsional**. Semua fitur tetap bisa dipakai tanpa AI.

Sebelum Anda mengizinkan AI di halaman Profil dan pengaturan, tidak ada teks yang dikirim ke penyedia AI. Setelah diizinkan, teks baru dikirim saat Anda sendiri meminta:

- **Analisis activity:** yang dikirim hanya teks catatan activity yang Anda pilih, beserta peran, cakupan, dan hasilnya.
- **Impor CV:** yang dikirim hanya teks yang dibaca dari file CV yang Anda unggah.

Yang tidak pernah dikirim ke penyedia AI: file bukti, nama file, nama Anda, email Anda, dan catatan Anda yang lain.

Hasil AI selalu berupa usulan. Usulan baru menjadi achievement setelah Anda periksa dan setujui, dan catatan asli Anda tetap tersimpan apa adanya.

Penyedia AI yang kami pakai: [NAMA PENYEDIA AI DAN NEGARANYA]. Penyedia AI memproses teks itu di servernya sendiri, dan berapa lama mereka menyimpannya mengikuti kebijakan penyedia tersebut. Kami tidak menjanjikan penyedia AI langsung menghapus teks setelah diproses.

Anda bisa menarik persetujuan AI kapan saja di halaman Profil dan pengaturan. Permintaan AI berikutnya berhenti, dan catatan, draf, serta achievement Anda tetap seperti semula. Kalau penyedia AI atau cakupan data yang dikirim berubah, kami minta persetujuan Anda lagi.

## 5. Di mana data disimpan

- **Database, autentikasi, dan file:** Supabase, region [REGION SUPABASE].
- **Aplikasi web, pemeriksaan malware, pembuatan PDF, dan backup:** server yang kami kelola di [LOKASI SERVER].
- **Email akun:** dikirim lewat [PENYEDIA EMAIL].
- **Pemrosesan AI:** lihat bagian 4.

Setiap akun hanya bisa membaca dan mengubah datanya sendiri. File disimpan di penyimpanan privat yang tidak bisa dibuka lewat tautan publik.

## 6. Berapa lama data disimpan

| Data | Lama disimpan |
| --- | --- |
| Akun dan catatan karier | Selama akun Anda ada |
| File CV impor dan teks yang dibaca darinya | Dihapus dalam 24 jam setelah proses impor selesai, gagal, atau dibatalkan |
| Impor yang menunggu review tapi tidak disentuh | Dibatalkan otomatis setelah 30 hari, lalu file dan teksnya dihapus dalam 24 jam |
| PDF hasil export | Bisa diunduh selama 24 jam, lalu dihapus |
| Catatan jenis aksi | Selama akun Anda ada. Kebijakan retensinya akan ditinjau setelah pilot |
| Backup database | Dibuat harian, setiap salinan dihapus sebelum berumur 30 hari |

## 7. Menghapus akun

Anda bisa menghapus akun sendiri di halaman Profil dan pengaturan. Untuk keamanan, Anda perlu memasukkan password dan mengetik ulang email akun.

Setelah Anda konfirmasi:

- Anda langsung keluar dari semua perangkat.
- Profil, activity, achievement, project, file bukti, impor, CV, export, dan catatan jenis aksi dihapus dalam 24 jam.
- Salinan backup yang mungkin masih memuat data Anda terhapus dalam 30 hari.

Penghapusan tidak bisa dibatalkan, dan tidak ada masa tenggang.

## 8. Hak Anda

Sesuai Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi, Anda berhak:

- **melihat dan memperbaiki** data Anda. Sebagian besar bisa langsung dilakukan di aplikasi;
- **menghapus** data Anda, lewat fitur hapus akun di bagian 7;
- **menarik persetujuan** pemrosesan AI kapan saja (bagian 4);
- **meminta salinan** data Anda. Saat ini belum ada tombol untuk mengunduh semua data sekaligus, jadi kirim permintaan ke halo@myworkpulse.my.id dan kami jawab dalam [JANGKA WAKTU, misal 14 hari kerja].

## 9. Cookie

WorkPulse hanya memakai cookie yang dibutuhkan aplikasi:

- cookie sesi login, supaya Anda tetap masuk;
- `wp-locale`, untuk mengingat bahasa yang Anda pilih;
- cookie tema, untuk mengingat pilihan tampilan terang atau gelap;
- `wp-recovery-flow`, sementara saat Anda mereset password.

Tidak ada cookie iklan atau pelacak pihak ketiga.

## 10. Usia

WorkPulse ditujukan untuk orang yang sedang bekerja atau mencari kerja. Anda harus berusia minimal [USIA MINIMUM] tahun untuk mendaftar.

## 11. Perubahan kebijakan

Kalau kebijakan ini berubah, kami perbarui tanggal di bagian atas. Untuk perubahan yang memengaruhi data Anda, misalnya penyedia baru atau jenis data baru yang dikirim, kami beri tahu lewat email atau di dalam aplikasi sebelum perubahan berlaku.

## 12. Kontak

Ilham Aisy Rasyid, halo@myworkpulse.my.id.
