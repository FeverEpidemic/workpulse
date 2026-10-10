# T24 Runbook metrik pilot

- Tanggal: 10 Oktober 2026
- Untuk: operator pilot WorkPulse
- Dasar: [decision 0030](../decisions/0030-t24-instrumentation-performance.md), PRD §5 *Pilot measures*

Runbook ini menjelaskan cara mendaftarkan peserta pilot, menarik peserta, dan membaca laporan keempat ukuran pilot. Angka target dari PRD adalah hipotesis pilot, bukan hasil produk. Laporan ini tidak boleh dipakai untuk menyatakan target tercapai.

## 1. Sebelum mulai

- WorkPulse mencatat event untuk semua akun sejak migration `20261011090000_t24_product_events.sql` diterapkan. Waktu penerapan itu disimpan sebagai epoch di `internal.product_event_epoch`.
- **Akun yang dibuat sebelum epoch tidak dapat didaftarkan**, karena event hari pertamanya tidak ada. Di lingkungan hosted, epoch adalah waktu migration diterapkan ke project itu. Calon peserta harus mendaftar akun setelah tanggal tersebut.
- Persetujuan pilot dikumpulkan di luar aplikasi, lewat formulir persetujuan pilot. Formulir itu juga yang menjelaskan kepada peserta event apa yang dicatat. Aplikasi tidak punya UI consent analitik.
- Akun fixture, test, E2E, dan perf tidak pernah didaftarkan. Karena itu akun tersebut tidak masuk laporan.

Kedua fungsi hanya dapat dieksekusi `service_role` dan pemilik database. Jalankan keduanya dari SQL editor project (sebagai pemilik database), dari `psql` lokal, atau dari skrip server yang memakai secret key dari env proses. Jangan menempel secret key di dokumen, tiket, atau chat.

## 2. Mendaftarkan peserta

1. Cari user id peserta berdasarkan email dari formulir persetujuan:

   ```sql
   select id, created_at from auth.users where email = '<email peserta>';
   ```

2. Daftarkan dengan versi persetujuan yang ditandatangani peserta. Versi memakai huruf kecil, angka, titik, garis bawah, atau tanda hubung, maksimal 32 karakter (misalnya `pilot-v1`):

   ```sql
   select * from public.set_pilot_participant('<user id>', 'pilot-v1', true);
   ```

3. Simpan pasangan email dan versi persetujuan di daftar persetujuan di luar sistem. Database hanya menyimpan user id, versi, dan waktu.

Pemanggilan ulang dengan versi yang sama mengembalikan baris yang ada. Versi berbeda memperbarui `consent_version` tanpa mengubah `enrolled_at`.

| Error (`22023`) | Arti | Tindakan |
| --- | --- | --- |
| `PILOT_ACCOUNT_UNAVAILABLE` | akun tidak ada atau sedang dihapus | periksa user id; akun yang sedang dihapus tidak dapat ikut |
| `PILOT_ACCOUNT_PREDATES_INSTRUMENTATION` | akun dibuat sebelum epoch | peserta perlu akun baru; jangan mengubah `created_at` |
| `PILOT_PARTICIPANT_WITHDRAWN` | peserta pernah menarik diri | penarikan bersifat final; peserta tidak dapat didaftarkan ulang |
| `INVALID_PILOT_PARTICIPANT` | user id kosong atau versi persetujuan tidak cocok pola | perbaiki argumen |

## 3. Menarik peserta

```sql
select * from public.set_pilot_participant('<user id>', '<versi>', false);
```

Fungsi mengisi `withdrawn_at` sekali. Pemanggilan ulang tidak mengubah waktu itu. Peserta yang tidak pernah terdaftar ditolak dengan `PILOT_PARTICIPANT_UNKNOWN`. Sejak penarikan, semua event peserta itu, termasuk event lama, tidak lagi dihitung.

**Peserta yang menghapus akun keluar dari kohort.** Event dan baris pesertanya ikut terhapus bersama akun (decision 0029 dan 0030). Selisih antara jumlah di laporan dan daftar persetujuan di luar sistem menunjukkan peserta yang sudah menghapus akunnya. Status penghapusan akun dipantau lewat `get_account_deletion_backlog` ([runbook T23](T23-retention-runbook.md)), bukan lewat event.

## 4. Membaca laporan

```sql
select * from public.get_pilot_metrics(now());
```

Untuk laporan tanggal lampau, ganti `now()` dengan waktu itu, misalnya `get_pilot_metrics('2026-11-01 00:00+07')`. Hanya event sampai waktu itu yang dihitung (migration `20261011100000_t24_pilot_metrics_as_of.sql`, gate review G1). Kohort tetap dibaca dari daftar peserta saat ini: peserta yang menarik diri atau menghapus akun sesudah tanggal itu tidak ikut, dan peserta yang didaftarkan sesudahnya ikut.

| Kolom | Arti |
| --- | --- |
| `measure` | `activation`, `value_completion`, `return_capture`, atau `export_reliability` |
| `cohort_size` | peserta terdaftar yang belum menarik diri |
| `eligible` | penyebut: akun yang jendelanya sudah selesai, atau untuk export, jumlah export terminal |
| `achieved` | pembilang |
| `pending` | akun yang jendelanya belum selesai; tidak dihitung gagal |
| `rate` | `achieved / eligible`, empat desimal; NULL bila `eligible = 0` |
| `target` | hipotesis PRD: 0,60 / 0,40 / 0,30 / 0,98 |

Definisi setiap ukuran. Semua jendela dihitung dari waktu pembuatan akun, dan event tepat di batas jendela tidak dihitung.

- **Activation (24 jam).** Akun menyimpan activity, membuat achievement, project, experience, education, atau certification, atau meng-commit import yang membuat atau memetakan minimal satu record karier. Batas definisi yang diterima: draft achievement kosong yang dibuat dengan satu klik sudah menghitung Activation (gate review G2, diterima pengguna untuk pilot).
- **Value completion (7 hari).** Dari akun teraktivasi, akun mengonfirmasi minimal satu achievement **dan** menyelesaikan minimal satu export CV yang sukses dalam 7 hari. Export gagal tidak dihitung.
- **Return capture (28 hari).** Dari akun teraktivasi, akun menyimpan activity pada minimal dua minggu kalender berbeda (Senin sampai Minggu, menurut zona waktu profil saat menyimpan) dalam 28 hari.
- **Export reliability.** Export sukses dibagi semua export yang selesai (sukses atau gagal) milik kohort. Setiap percobaan dihitung, jadi gagal lalu retry sukses tercatat 1 dari 2. Kegagalan karena akun sedang dihapus (`ACCOUNT_DELETING`) dikeluarkan, sama seperti pembatalan pengguna.

`pending` value completion dan return capture hanya berisi akun teraktivasi yang jendela 7 atau 28 harinya belum selesai. Akun yang jendela 24 jamnya masih terbuka hanya muncul di `pending` activation.

## 5. Menafsirkan angka

- Target PRD adalah hipotesis untuk ditinjau setelah 20 peserta pertama yang memberi persetujuan. Laporan ini tidak menyatakan target tercapai atau gagal.
- Dengan kohort 20 orang atau kurang, satu akun mengubah rasio sekitar 5 poin persentase, dan lebih besar lagi bila `eligible` lebih kecil dari `cohort_size`. Laporkan selalu `achieved` dan `eligible`, bukan `rate` saja.
- Tunggu sampai `pending` mendekati 0 sebelum membandingkan dengan target. Dengan begitu, peserta yang baru bergabung tidak menurunkan rasio.
- Event tidak menyimpan teks catatan, teks CV, nama file, isi lampiran, email, atau ID record. Laporan hanya berisi hitungan, jadi tidak dapat dipakai untuk melihat apa yang ditulis peserta.

## 6. Yang belum dicakup T24

- Retensi event setelah pilot. Event disimpan selama akun ada, dan kebijakannya diputuskan bersama hasil pilot.
- Ekspor laporan ke alat analitik eksternal, dashboard metrik di aplikasi, dan alert. Alert operasional milik T25.
