# Decision 0032: T26 import CV tanpa AI (parser aturan)

Date: 18 Oktober 2026

Status: **Draft**. Desain disetujui pengguna di chat pada 18 Oktober 2026; implementasi belum dimulai. Difinalkan pada Fase 6 rencana setelah gate review. Task: T26 (penambahan scope pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T26-implementation-plan.md).

## References

- **PRD** R02, §3 (*Imported achievement claims are candidates until the user selects Confirm during review*), *Shared validation*.
- **User Flow** F01 dan *Import exceptions*; **Wireframe** S02, S03.
- **AGENTS.md** *Konteks proyek*: jalur manual harus tetap berfungsi tanpa AI.
- **Decision terkait:** 0021 (T15 staging: poin 1, 3, 5, 6, 7, 9, 11, 13), 0022 (T16 commit), 0023 (T17 review UI).

## Context

Decision 0021 #1 mewajibkan consent `ai-processing-v1` sebelum upload, dengan alasan import saat itu hanya ada untuk mengirim teks CV ke penyedia AI. Akibatnya pengguna yang menolak AI tidak punya jalur import sama sekali dan harus mengisi semua data secara manual.

Bagian lokal pipeline (malware scan, parsing PDF/DOCX di thread terisolasi, hitung halaman DOCX) tidak membutuhkan consent. Yang membutuhkan consent hanya tahap ekstraksi oleh AI. Pengguna meminta jalur import yang mengisi kandidat tanpa AI.

## Decisions

1. **Mengubah 0021 #1: consent hanya untuk mode `ai`.** Setiap batch punya `extraction_mode` (`ai` atau `rules`) yang ditetapkan saat upload dan immutable. `begin_import_batch`, `complete_import_parse`, dan `retry_import_batch` memeriksa consent hanya untuk batch `ai`. Batch `ai` tetap mengikuti seluruh aturan consent 0021 (cek saat enqueue, saat input dibaca, dan saat completion).
2. **Mode mengikuti pilihan di dialog consent.** Pengguna yang sudah consent selalu memakai `ai`. Pengguna tanpa consent melihat dialog dengan **Lanjut tanpa AI** (fokus awal) dan **Izinkan AI**; Lanjut tanpa AI meng-upload batch `rules`. Esc dan tombol tutup hanya membatalkan. Consent yang berubah setelah upload tidak mengubah mode batch.
3. **Ekstraksi aturan di parser thread yang ada.** Extractor murni (`src/domain/import/rules-extract.ts`) berjalan di thread yang sama dengan parsing, sehingga mewarisi batas 0021 #9 (heap 256 MB, env kosong, timeout 30 detik). Ini penting karena regex berjalan atas teks yang tidak dipercaya.
4. **Grounding yang sama dengan AI.** Output extractor berbentuk `import.v1` dan divalidasi oleh `validateImportResult` seperti output AI (0021 #11). Excerpt selalu potongan baris asli; field yang tidak yakin diisi `null`.
5. **Staging tanpa `ai_jobs`.** Untuk batch `rules`, `complete_import_parse` menyimpan teks, men-stage item, dan membuka `review` dalam satu transaksi. Logika validasi struktur dan insert item dipindah dari `complete_import_ai_job` ke `internal.stage_import_items` tanpa mengubah perilaku AI. Batch `rules` berpindah `parsing → done` tanpa stage `extracting`.
6. **Cakupan v1.** Profil (kontak, nama, headline, summary), experience, education, dan skills. Database menolak tipe lain untuk batch `rules`. Achievement dari bullet, sertifikasi, proyek, dan lokasi ditunda karena aturannya paling mudah salah dan hasilnya menambah beban review.
7. **Kode error baru `IMPORT_RULES_FAILED` (permanen).** Dipakai bila extractor melempar exception atau outputnya gagal validasi. Keduanya bug di kode WorkPulse, bukan masalah file pengguna, jadi Retry tidak ditawarkan. Timeout dan crash thread tetap `PARSER_TIMEOUT` dan `CORRUPT_FILE`.
8. **Copy jujur tentang kualitas.** S02 menjelaskan kedua jalur bagi pengguna tanpa consent. Hasil batch `rules` membawa catatan agar pengguna mengecek perusahaan, jabatan, dan tanggal. Hasil kosong menyebut bahwa CV dua kolom atau berbentuk tabel sering tidak terbaca tanpa AI.

## Error codes

- Permanen baru: `IMPORT_RULES_FAILED`.
- Tidak pernah berlaku untuk batch `rules`: `CONSENT_REQUIRED`, `CONSENT_WITHDRAWN`, dan kode `AI_*`.
- Request: key idempotency sama dengan mode berbeda → `IDEMPOTENCY_KEY_REUSED`; mode tidak dikenal → `INVALID_IMPORT_UPLOAD`.

## Lock order

Tidak berubah dari 0021: profile (`for share`) → import batch (`for update`) → import job atau AI job (`for update`) → items.

## Alternatives rejected

- **Parsing di browser** (pdf.js di klien, server hanya menerima kandidat): malware scan, batas halaman, dan grounding harus diduplikasi atau dilonggarkan, dan alurnya terpisah dari pipeline.
- **Parser aturan sebagai AI provider palsu** lewat `ai_jobs`: pemeriksaan consent di tiga titik akan memblokirnya dan metrik pemakaian AI tercampur, sehingga consent butuh pengecualian di banyak tempat.
- **Pilihan "tanpa AI" juga untuk pengguna yang sudah consent:** belum ada kebutuhan; ditunda.
- **Fallback otomatis ke aturan saat AI gagal atau consent ditarik:** mengubah perilaku batch `ai` yang sudah diuji dan membuat asal kandidat tidak jelas bagi pengguna.
- **Library parsing CV pihak ketiga:** menambah dependency untuk masalah yang bisa diselesaikan dengan aturan sederhana pada cakupan v1.

## Open

- Kualitas ekstraksi pada CV nyata belum diukur. Rencana menyarankan uji manual dengan 5 sampai 10 CV milik pemilik produk (en/id, satu dan dua kolom), dicatat tanpa menyimpan isi CV.
- Apakah achievement dari bullet experience ditambahkan setelah uji CV nyata.
