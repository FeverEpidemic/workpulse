# Reels 30 detik: "Lupa kerjaan sendiri" (draf v1)

Format: Instagram Reels, vertikal 9:16, 30 detik, teks + musik (tanpa voice-over, tanpa wajah).
Penonton: karyawan aktif, fresh graduate yang lagi benerin CV, freelancer.
Tujuan: daftar akun pilot langsung di myworkpulse.my.id.
Bahasa: Indonesia santai, campur istilah Inggris yang memang dipakai sehari-hari.

Semua isi layar diambil dari **akun demo berisi data contoh**, bukan data pengguna asli.

## Naskah dan shot list

| Waktu | Visual | Teks di layar |
| --- | --- | --- |
| 0-3 dtk | Layar polos, teks muncul ketik | Mau update CV. |
| 3-6 dtk | Teks yang sama, baris kedua muncul | Terus lupa setahun kemarin ngerjain apa aja. |
| 6-12 dtk | Rekaman layar `/activity/new`: isi satu catatan contoh, simpan | Selesai kerja, catat di WorkPulse. Singkat aja. |
| 12-19 dtk | Rekaman layar detail Activity (`/activity/[id]`): panel analisis AI, lalu klik konfirmasi jadi Achievement | AI bantu ubah catatan jadi achievement. Lo yang cek dan setujuin. |
| 19-25 dtk | Rekaman layar `/cv`: tap "Tambahkan ke CV" di achievement "Analisis penyebab retur pengiriman", lalu `/cv/preview`, Ekspor PDF, Unduh PDF | Pilih yang mau masuk CV, terus download PDF. |
| 25-27 dtk | Zoom ke PDF hasil, satu kolom | Format satu kolom, teksnya asli, bukan gambar. |
| 27-30 dtk | Logo WorkPulse + URL | Pilot gratis udah buka. Daftar langsung di myworkpulse.my.id |

Caption Instagram (opsional):

> Biasain nyatet kerjaan dari sekarang, biar pas update CV nggak mulai dari nol. Pilot gratis WorkPulse udah buka, daftar langsung di myworkpulse.my.id

## Keputusan dari interview

- Pembanding disebut versi umum, tanpa nama merek.
- Video cuma bilang "pilot gratis". Rencana freemium (gratis + fitur berbayar) tidak disinggung, supaya tidak terbaca sebagai gratis selamanya.
- Tidak ada klaim "lolos ATS" karena belum pernah diuji ke ATS. Yang ditulis cuma fakta template: satu kolom, teks asli.
- Tanpa waitlist: penonton daftar langsung di app. Pendaftaran pilot dibuka untuk umum, jadi video tidak menyebut kuota.
- Tidak ada angka hasil (misalnya jumlah achievement yang ketemu) karena belum ada data nyata.
- CTA follow akun ditunda sampai akun Instagram dibuat.

## Yang perlu disiapkan sebelum rekam

- Akun demo dengan beberapa Activity dan Achievement contoh, nama dan perusahaan fiktif yang jelas fiktif. Buat dengan `node scripts/demo-account.ts` di stack Supabase lokal; kredensialnya ada di `.env.demo.local`.
- Dev server harus jalan dengan `SUPABASE_SECRET_KEY` di env proses (konfigurasi `web-demo` di `.claude/launch.json`), kalau tidak unduh PDF dan halaman PDF gagal dimuat.
- Rekam dari build production (`pnpm build` lalu `pnpm start`) supaya badge "N" Next.js di pojok kiri bawah tidak ikut terekam.
- Di builder CV, pindahkan Operations Analyst ke atas Staf Data Entry dulu. Urutan bawaan seed menaruh pekerjaan lama di atas.
- Fitur AI aktif di lingkungan rekaman, supaya panel analisis di detik 12-19 muncul.
- App sudah live di production dan sign-up di myworkpulse.my.id bisa dipakai. Video baru diposting setelah pilot dibuka.
- Ada limit pemakaian AI per user, karena pendaftaran terbuka dan setiap user baru menambah biaya provider AI.
- Musik bebas royalti, atau dari library audio Instagram.
