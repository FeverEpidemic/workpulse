# Gate M5 Fase 3: E2E siklus hidup akun pilot

- Tanggal: 21 Oktober 2026. Pelaksana: Claude (Opus 5.5).
- Kriteria: §1.2 (skenario rilis 1 mode `rules`, skenario 3), §1.3, §1.5, §1.8 handoff.
- File berubah: `playwright.m5.config.ts` (salinan pola `playwright.m4.config.ts`, port **3018**, workers 1, timeout 900 detik, web server tanpa env `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`), `tests/e2e/m5-pilot-journey.spec.ts`, script `test:e2e:m5` (`package.json`, commit `d375b0e`). Commit journey `37451ca`.
- Tidak ada suite lama yang diubah. Helper lama dipakai: `helpers/accessibility.ts` (`expectNoWcagViolations`), `helpers/export-worker.ts` (`requireRealRenderer`), `tests/import-fixtures.ts` (`cvDocx`, `DOCX_MIME`). Helper import E2E lama memakai renderer DOCX palsu, jadi journey menjalankan `workers/run.ts --once` sendiri dengan adapter nyata: ClamAV 127.0.0.1:13310, Gotenberg DOCX 13400, renderer PDF 13401, dan `WORKPULSE_AI_MODE=unavailable` (mode default pilot). Setiap pass memeriksa ringkasan worker tidak melaporkan renderer palsu.

## Journey

Satu akun `m5-journey-…@workpulse.test`. Semua langkah lewat UI, kecuali kotak surat lokal (Mailpit), drain worker, satu edit bersamaan, pemasangan paket AI `free` oleh operator (agar purge punya baris `ai_plan_assignments`), dan pemeriksaan SQL read-only.

| # | Langkah | Yang dibuktikan |
| --- | --- | --- |
| 1 | Daftar lewat S01, konfirmasi dari Mailpit, onboarding | Tautan konfirmasi berisi `token_hash` ke `/auth/confirm`. Auth lokal hanya mengizinkan redirect ke port 3000 (`config.toml:165-168`), jadi path dan token dibuka di port 3018 dari halaman opaque-origin. Onboarding hanya display name, **Bahasa Indonesia** dipilih, `html[lang=id]`, consent AI kosong |
| 2 | S02 360 × 800 dark → dialog mode → *Baca tanpa AI* dengan keyboard → CV DOCX Indonesia, dua masa kerja tumpang tindih (Maret 2021–sekarang dan 2020–2022) → ClamAV dan Gotenberg nyata → S03 | Fokus awal di judul dialog, Tab mencapai *Baca tanpa AI*, tanpa overflow, Axe bersih. Batch `extraction_mode = rules`. Tanpa dialog consent. S03: dua kandidat, *Jenis* dipilih `employment`, satu *Peran* diperbaiki, keduanya *Tersimpan*. *Konfirmasi impor* ditekan Enter dua kali, lalu reload dan back/forward: tetap *Impor disimpan*. Tepat dua experience dengan nilai terkoreksi, batch `committed`, `ai_jobs` 0, `internal.ai_usage` 0, consent tetap kosong. Timeline menampilkan setiap jabatan sekali |
| 3 | *Catatan cepat* → simpan → *Analisis dengan AI* → consent di dialog → worker AI `unavailable` | S06: *Analisis tidak selesai* / *Layanan AI sedang tidak tersedia.* dan *Buat pencapaian secara manual*, Axe bersih. Unit analisis terbebankan dalam transaksi job. *Edit aktivitas* → catatan baru tersimpan → panel *Aktivitas ini berubah setelah analisis…*, tanpa *Coba lagi* untuk job lama, `input_revision` job < revisi aktivitas. *Analisis lagi* → job baru untuk revisi baru, gagal lagi; teks catatan tetap versi pengguna |
| 4 | *Buat pencapaian secara manual* → *Pencapaian baru* → isi → *Konfirmasi Pencapaian* → simpan yang gagal → evidence | Status `confirmed`. Edit dari sesi lain menaikkan revisi; *Simpan perubahan* menampilkan *Pencapaian ini berubah di server* dan isi *Judul* lokal tetap ada; *Tinjau dan coba simpan perubahan saya* menyimpannya, status tetap `confirmed`. PDF evidence sampai *Siap* dengan ClamAV nyata |
| 5 | S13 pilih achievement dan experience, bahasa CV Indonesia, *Simpan perubahan* → S14 → export (renderer nyata) → *Unduh PDF* dengan Enter | Nama `WorkPulse-CV-YYYY-MM-DD.pdf`. Teks pdf.js memuat nama profil, *Kepala Gudang*, organisasi, dan bullet `Rp1,5 miliar “tepat waktu”`; tidak memuat nama file evidence, nama file CV, sentinel catatan, atau nama bucket |
| 6 | Event produk (SQL read-only) | Ada `import_committed`, `career_record_created`, `activity_saved`, `achievement_confirmed`, `cv_export_finished`. Baris event tidak memuat sentinel catatan, nama file CV, nama file evidence, organisasi dari CV, display name, email, user id, atau ID activity, achievement, dan batch |
| 7 | S12 360 × 800 dark (dialog terbuka) → kembali 1440 light → reautentikasi password + email → tab kedua | Fokus awal di *Kata sandi saat ini*, tanpa overflow halaman maupun dialog, Axe bersih pada dialog terbuka dan dialog siap kirim. Setelah hapus: `/sign-in?notice=accountDeleted`; tab kedua yang sudah masuk diarahkan ke `/sign-in` pada navigasi berikutnya. Worker penghapusan sampai receipt `completed`. Masuk ulang dengan kredensial lama ditolak dengan pesan generik |
| 8 | Setelah purge (SQL read-only) | Lihat tabel di bawah. Tidak ada job cleanup terbuka di prefix akun; `account_deletion_overdue` dan `storage_cleanup_failed` tidak naik. Sentinel tidak muncul di keluaran worker maupun console browser; tidak ada `pageerror` |
| 9 | Aksesibilitas | `expectNoWcagViolations` pada dialog mode import (360 dark), S03, S06 *AI unavailable*, dialog S12 (360 dark dan 1440 light) |

## Hitungan baris sebelum dan sesudah purge

Dari run HTML (run 6), dicetak oleh test (`M5-ROWS`). Hanya angka, tanpa isi.

| Tabel / prefix | Sebelum | Sesudah |
| --- | ---: | ---: |
| `public.activities` | 1 | 0 |
| `public.achievements` | 1 | 0 |
| `public.experiences` | 2 | 0 |
| `public.education` | 1 | 0 |
| `public.skills` | 2 | 0 |
| `public.import_batches` | 1 | 0 |
| `public.import_items` | 6 | 0 |
| `public.ai_jobs` | 2 | 0 |
| `public.evidence_files` | 1 | 0 |
| `public.cv_documents` | 1 | 0 |
| `public.cv_items` | 2 | 0 |
| `public.cv_exports` | 1 | 0 |
| tabel `public` ber-`user_id` lain (5: `achievement_skills`, `ai_suggestion_reviews`, `certifications`, `chat_messages`, `projects`) | 0 | 0 |
| `public.profiles` | 1 | 0 |
| `auth.users` | 1 | 0 |
| `internal.ai_usage` | 2 | 0 |
| `internal.ai_plan_assignments` | 1 | 0 |
| `internal.product_events` | 8 | 0 |
| `internal.pilot_participants` | 0 | 0 |
| Storage `evidence/` | 1 | 0 |
| Storage `import/` | 0 | 0 |
| Storage `export/` | 1 | 0 |

Storage `import/` sudah 0 sebelum penghapusan: file asli tidak lagi ada setelah commit dan pass worker berikutnya. Retensi 24 jam untuk batch commit, batal, dan gagal dibuktikan di Fase 4 skenario 5.

## Command

| Run | Command | Exit | Hasil | Penyebab merah |
| --- | --- | ---: | --- | --- |
| 1 | `pnpm test:e2e:m5` | 1 | 0/1 | Kesalahan test: asersi "tanpa copy consent" mencocokkan pemberitahuan netral S02 (*…penyedia AI eksternal…*) yang memang ditampilkan T26 sebelum pilihan. Diganti dengan asersi tanpa dialog consent dan consent profil tetap kosong |
| 2 | sama | 1 | 0/1 | Kesalahan test: prefix Storage export adalah `export/`, bukan `exports/` |
| 3 | sama | 1 | 0/1 | Kesalahan test: status job cleanup selesai adalah `succeeded`, bukan `completed` |
| 4 | sama | 0 | **1/1** (1,3 menit) | |
| 5 | `… --reporter=html,list` | 1 | tidak jalan | Argumen reporter salah tulis (`MODULE_NOT_FOUND`) |
| 6 | `… --reporter=html --reporter=list` | 0 | **1/1** (1,3 menit) | Laporan HTML tidak tertulis ke folder yang diminta (`PLAYWRIGHT_HTML_OUTPUT_DIR`/`PLAYWRIGHT_HTML_REPORT` tidak terpakai); karena itu screenshot juga disimpan lewat `testInfo.outputPath` |
| 7 | `pnpm test:e2e:m5` | 0 | **1/1** (1,3 menit) | |

Tiga run merah pertama adalah kesalahan test, bukan bug produk. Tidak ada asersi yang dilemahkan; asersi run 1 diganti dengan pemeriksaan yang tepat untuk kriteria yang sama.

Log web server memuat `Error: The destination stream closed early.` (sama dengan T26 dan T25, M4 E-2) dan peringatan `@napi-rs/canvas` dari pdf.js di proses test; journey tetap lulus.

## Screenshot

Lima lampiran `testInfo.attach` (run 7) disimpan di `test-results/` (di-ignore git) dan disalin ke folder catatan sesi untuk reviewer: `m5-s02-mode-dialog-360-dark.png`, `m5-s03-review.png`, `m5-s06-ai-unavailable.png`, `m5-s08-conflict.png`, `m5-s12-delete-360-dark.png`. Pelaksana membuka S02, S06, dan S12: dialog mode dengan cincin fokus di judul dan dua kartu bertumpuk, S06 dengan status gagal, *Coba lagi*, dan jalur manual, S12 dengan dialog dan hitungan data. Pada S12 *full page*, tautan lewati dan header mobile tampak di tengah halaman karena cara screenshot *full page* menggambar elemen `fixed`; Axe dan pemeriksaan overflow lulus. Tidak ada file di direktori screenshot T22/T25 yang di-track yang berubah oleh suite ini.

## Temuan

Tidak ada P0–P2 dari journey.

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| M5-N5 | P3 | Screenshot *full page* S12 360 px menggambar elemen `fixed` di posisi gulir; reviewer sebaiknya membandingkan dengan screenshot viewport bila ingin memastikan tampilan | Catat |
| M5-N6 | P3 | `redirect_to` ke port selain 3000 ditolak Auth lokal, sehingga journey memindahkan path konfirmasi ke port gate. Perilaku hosted diperiksa operator di daftar periksa Fase 6 butir 4–5 | Catat |
