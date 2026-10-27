# Hosted browser smoke, 26 Oktober 2026

Penguji: Codex. Pengguna meminta pengujian alur lewat browser di `https://myworkpulse.my.id` dan secara eksplisit melewati tes hapus akun. Pengguna mengizinkan penambahan data sintetis TEST ke akun yang sedang login serta pencabutan consent AI global. Aksi aplikasi dilakukan melalui browser; receipt akhir diperiksa dengan query Supabase read-only pada proyek `cotmocgufdxjtiuakwdh`. Tidak ada perubahan server, konfigurasi, schema, atau deployment.

Acuan: R04/R07/R09, F02/F05/F07, S02/S03/S05/S12/S13/S14, T10/T26/T28/T22, Gate M5 E2/E3/E4. Ini receipt pengujian terbatas, bukan verdict gate atau penutupan authoritative blocker production. Tag image web/worker tidak diperiksa.

## Hasil

| Alur | Hasil dan bukti |
| --- | --- |
| Export saved CV | Regenerate dari saved revision 10, tanpa mengubah pilihan/wording CV. UI `PDF ready`, dua halaman. Receipt `cv_exports`: `succeeded`, revision 10, page count 2, dibuat `2026-10-26T05:41:15.504758Z`. Download browser berhasil ke `WorkPulse-CV-2026-10-26.pdf`. |
| Teks dan layout PDF | `pypdf` membaca 2.999 karakter; kedua halaman berukuran sekitar 594,96 × 841,92 pt (A4). Nama, judul proyek, judul achievement, awal bullet achievement, qualification pendidikan, dan GPA cocok dengan preview tersimpan. Ini pemeriksaan enam anchor teks, bukan perbandingan byte seluruh snapshot. Kedua halaman dirender dengan Poppler dan dilihat langsung: teks terbaca, tidak terlihat clipping, halaman kosong, atau heading yatim. |
| Import tanpa AI | DOCX sintetis menghasilkan satu experience, satu education, satu skill. UI menunjukkan hasil dibaca tanpa AI. Field Type experience wajib diisi manual sebelum commit; dipilih Employment dan disimpan eksplisit. Education dan skill di-skip. Confirm import berhasil: satu experience dibuat, dua kandidat di-skip, nol achievement confirmed. |
| Receipt import | Batch `f3b1f5d7-4366-4bce-96c1-c29acbf19f32`: `extraction_mode=rules`, `status=committed`, `error_code=null`; jumlah `ai_jobs` untuk batch = 0. |
| Manual capture | Quick log menyimpan satu activity TEST tanpa meminta AI; toast sukses dan detail revision 1 terlihat. Activity `eb25b2a2-b9f8-4fbf-9067-0b66f4b7453b`. |
| Evidence bersih | PDF sintetis 1.447 byte melewati `Security check in progress` lalu `Ready`. Download berhasil, SHA-256 sama dengan fixture: `5fec4f57f6a7f077bd646e82315a4a0c86fa6b7ee7364e00914653b19095be5d`. Scan job `38ef5655-6841-43bd-a1c2-4b39c188011f`: `succeeded/clean`, attempt 1. |
| EICAR dalam DOCX | DOCX ZIP memuat entry `test-signature.txt` dengan signature uji EICAR standar 68 byte, SHA-256 `275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f`. Pola ini sama dengan `tests/integration/evidence-pipeline.test.ts`. Job `5bca7b06-80aa-4523-9a45-1be73bb9e0a4` untuk evidence `89c52ecd-b97d-4192-ae20-0cc5a771c5e9`: `succeeded/rejected`, attempt 1, selesai `2026-10-26T05:46:28.061682Z`. Metadata evidence dan objek Storage keduanya berjumlah 0 setelah worker. |
| Consent | Query akhir profil akun pengujian: `ai_consent_at is not null = false`. Consent tidak dinyalakan kembali. |

## Hasil tambahan yang perlu ditinjau

Sebelum kontrol DOCX, penguji mengunggah PDF valid dengan signature EICAR persis yang ditambahkan sebagai komentar setelah `%%EOF`. File 1.519 byte ini menjadi `Ready`; job `2659fc39-9707-4b0a-b5f2-407a4223ffa0` menghasilkan `succeeded/clean`. Signature pada fixture sudah diverifikasi persis dan sepanjang 68 byte. Berbeda dengan kontrol DOCX, fixture ini tidak ditolak. Penyebab belum dibuktikan; perlu reproduksi dengan versi/config/signature database ClamAV yang terpasang untuk membedakan perilaku scanning PDF dari masalah integrasi. Jangan menyimpulkan mode `fake-clean` dari hasil ini: kontrol DOCX memang ditolak. EICAR adalah signature uji antivirus yang tidak menjalankan malware.

DOCX yang ditolak hilang dari daftar evidence. Pada observasi browser tidak terlihat pesan penolakan yang menetap; receipt database diperlukan untuk mengetahui hasilnya. Tinjau feedback rejection di UI sebagai follow-up.

## Kondisi yang ditinggalkan

- Satu experience sintetis: `TEST Browser Smoke Analyst` di `TEST WorkPulse Sandbox`, Januari–Desember 2025; tidak ditambahkan ke master CV.
- Satu activity TEST untuk pengujian evidence, dengan PDF bersih dan PDF komentar EICAR yang berstatus Ready. DOCX EICAR sudah dibersihkan worker.
- Satu export baru dari saved revision 10; master CV tidak diedit.
- Consent AI global dalam keadaan dicabut, sesuai izin pengguna.
- Tidak ada penghapusan manual atau hapus akun. Artefak TEST dibiarkan untuk pemeriksaan pengguna.

## Batas verifikasi

- E2 (`rules` hosted), E3 (kontrol EICAR DOCX ditolak dan dibersihkan), serta E4 (PDF hosted diunduh dan anchor teks cocok) kini memiliki observasi langsung dan receipt. Hasil PDF komentar EICAR tetap dicatat terpisah dan belum diselesaikan.
- Backup/cron/retensi (E1), nilai konfigurasi Auth dashboard (E5), p95 hosted, tag image, scanner engine/config/signature age, isolasi antar-akun, recovery email, dan Google OAuth tidak diuji pada sesi ini.
- Hapus akun dilewati atas instruksi pengguna. Aksesibilitas/perangkat/browser lain tidak diuji; ini bukan audit UI.
- Tidak menjalankan lint/build/unit/E2E otomatis; sesi ini menguji aplikasi hosted melalui browser, tanpa mengubah implementasi.
- Bukti visual lokal dan fixture berada di `.tmp/browser-smoke-20261026/` (di-ignore Git): `import-saved.png`, `export-ready.png`, `evidence-screening.png`, dan render PDF `cv-page-1.png`/`cv-page-2.png`. Tidak menambahkan isi CV, kontak pribadi, atau PDF pengguna ke Git.

Verifikasi lokal bukti: ekstraksi teks dengan Python `pypdf`; render kedua halaman dengan bundled Poppler `pdftoppm`; hash download evidence dengan `Get-FileHash`; query Supabase hanya SELECT, scoped ke batch/activity pengujian. Tidak ada secret atau isi CV lengkap disalin ke receipt ini.
