# Handoff T26 Import CV tanpa AI (parser aturan): eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 18 Oktober 2026
- Status plan: **DONE** 20 Oktober 2026 (gate review PASS, [bukti](T26-import-rules-extraction.md)).
- Dependensi: T15, T16, T17 **DONE** (acceptance lokal), T23 **DONE**, Gate M3 dan M4 **PASSED**. T25 masih **PARTIAL** (staging); T26 tidak menyentuh pekerjaan staging T25.
- Asal task: penambahan scope oleh pengguna pada 18 Oktober 2026. T26 **tidak ada** di `IMPLEMENTATION_PLAN.md` §5. Desain disetujui per bagian di chat (arsitektur, aturan ekstraksi, UI/copy/error, pengujian).
- Eksekutor: satu agent **Claude**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) dikerjakan setelah gate.
- Keputusan yang sudah disetujui pengguna: pendekatan A (parser aturan di worker import yang ada), mode otomatis untuk pengguna tanpa consent, dialog pilihan netral 50:50 tanpa default (revisi 18 Oktober 2026, menggantikan dialog consent dengan tombol default), cakupan v1 profil/experience/education/skills, achievement dari bullet ditunda.
- Acuan:
  - PRD R02, §3 (*Imported achievement claims are candidates until the user selects Confirm during review*), *Shared validation*.
  - User Flow F01 dan *Import exceptions*; Wireframe S02, S03.
  - Database Schema §4 `import_batches`/`import_items`.
  - `AGENTS.md` *Konteks proyek* (jalur manual harus tetap berfungsi tanpa AI) dan *Files, import, dan cleanup*.
  - `docs/decisions/0021-t15-import-staging.md` (poin 1, 3, 5, 6, 7, 9, 11, 13), `0022-t16-import-commit.md`, `0023-t17-import-review-ui.md`, draft `0033-t26-import-rules-extraction.md`.

**Goal:** Pengguna yang belum memberi consent AI tetap bisa mengimpor CV PDF/DOCX. Saat upload, dialog pilihan netral menampilkan dua kartu setara, **Pakai AI** dan **Baca tanpa AI**, tanpa jawaban default. Pilihan kedua meng-upload batch dengan mode `rules`: worker membaca teks seperti biasa, lalu parser berbasis aturan (heading en/id, pola tanggal, daftar) mengusulkan kandidat profil, experience, education, dan skills. Kandidat melewati validator grounding yang sama dengan output AI dan masuk review S03. Tidak ada teks yang dikirim ke penyedia AI, dan tidak ada yang tersimpan sebelum pengguna mengonfirmasi.

**Architecture:** Satu migration forward-only menambah `extraction_mode` (`ai`/`rules`) pada `import_batches` dan `internal.import_jobs`, ditetapkan saat upload dan immutable. `begin_import_batch` hanya memeriksa consent untuk mode `ai`. Ekstraksi aturan berjalan di parser thread yang sudah terisolasi (`src/server/documents/parser-thread.ts`), tepat setelah teks keluar. Worker memvalidasi hasilnya dengan `validateImportResult`, lalu `complete_import_parse` men-stage item dan membuka `review` dalam satu transaksi tanpa baris `ai_jobs`. Logika staging dipindah dari `complete_import_ai_job` ke fungsi internal bersama tanpa mengubah perilaku AI. Review, commit T16, purge, dan penghapusan akun tidak berubah karena bekerja di `import_items`.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Zod 4, Supabase PostgreSQL (pgTAP), worker Node 24 dengan `worker_threads`, pdfjs-dist 6.3.289, Vitest (unit + integration nyata), Playwright + axe-core, pnpm dari lockfile. **Tidak ada dependency baru.**

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, decision 0021/0022/0023, draft decision 0033, `Design.md` (dialog, form, state, aksesibilitas), lalu `docs/verification/T17-implementation-plan.md` sebagai pola format. Bila perlu memastikan isi PRD/F01/S02/S03, ekstrak DOCX dengan alat ekstraksi (mis. `python` + `zipfile` atas `word/document.xml`); jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **AGENTS.md:** WorkPulse adalah workspace karier privat; jalur manual harus tetap berfungsi tanpa AI. Import PDF/DOCX maksimal 10 MiB dan 20 halaman, parser dengan timeout, tanpa OCR atau auto-confirm. Extraction hanya menghasilkan staging candidates. Jangan mencatat teks CV atau nama file ke log.
- **PRD R02:** ekstrak data CV ke staging; pengguna mengedit dan memilih sebelum satu commit atomik.
- **PRD §3:** klaim hasil import tetap kandidat sampai pengguna memilih *Confirm*.
- **F01 Import exceptions:** ekstraksi parsial membuka review dengan field kurang di-highlight; tidak ada hasil yang auto-confirm.
- **Decision 0021 #1:** consent sebelum upload karena import saat itu hanya ada untuk mengirim teks ke AI. T26 mengubah poin ini (draft decision 0033): consent hanya wajib untuk mode `ai`.
- **Decision 0021 #9 dan #11:** parsing terisolasi di `worker_threads` (256 MB heap, env kosong, timeout 30 detik); grounding `import.v1` membuang kandidat yang excerpt-nya tidak ada di teks dan mengosongkan fakta yang tidak ada di excerpt.

Pertahankan perubahan lokal pengguna. Jangan menandai T26 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T26-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T26

T26 lulus hanya jika setiap poin berikut dibuktikan dengan hasil lokal nyata:

1. **Upload tanpa consent dengan mode `rules`.** `begin_import_batch` dengan `p_extraction_mode = 'rules'` berhasil untuk pengguna tanpa consent; mode `ai` tanpa consent tetap `CONSENT_REQUIRED`. Dibuktikan pgTAP dan integration.
2. **Mode immutable dan bagian identitas idempotency.** `extraction_mode` tidak dapat diubah setelah insert (trigger guard). Key idempotency sama dengan mode berbeda menghasilkan `IDEMPOTENCY_KEY_REUSED`. Dibuktikan pgTAP.
3. **Staging atomik tanpa AI.** Untuk batch `rules`, `complete_import_parse` menyimpan teks, insert `import_items`, dan membuka `review` dalam satu transaksi; tidak ada baris `ai_jobs` untuk batch itu. Batch yang di-cancel di tengah proses menghasilkan `stale` tanpa item. Dibuktikan pgTAP.
4. **Perilaku AI tidak berubah.** Batch `ai` tetap meng-enqueue job AI; seluruh test pgTAP, unit, dan integration import T15–T17 tetap lulus tanpa melemahkan assertion. Dibuktikan suite regresi.
5. **Extractor menghasilkan kandidat yang grounded.** Untuk setiap fixture teks CV sintetis, `validateImportResult(extractImportByRules(text), text)` mengembalikan `ok: true` dan `dropped_ungrounded === 0`. Dibuktikan unit.
6. **Aturan ekstraksi sesuai §2.2.6.** Heading en/id, pemisah role/organisasi, format tanggal, `is_current`, `kind`, pemecahan skills, dan heading penutup berperilaku sesuai spesifikasi; kasus negatif tidak crash dan tidak menebak. Dibuktikan unit.
7. **Aman terhadap input jahat.** Baris panjang dengan pola berulang selesai di bawah batas waktu; extractor berjalan di parser thread dengan batas heap dan timeout yang ada. Dibuktikan unit (waktu) dan unit worker (thread).
8. **Kegagalan extractor jelas.** Exception di extractor atau output yang gagal validasi menghasilkan batch `failed` dengan `IMPORT_RULES_FAILED` (permanen, tanpa Retry); log worker hanya berisi kode. Dibuktikan unit worker dan pgTAP (`is_permanent_import_error`).
9. **Retry tanpa consent untuk batch `rules`.** `retry_import_batch` pada batch `rules` yang gagal transien tidak memeriksa consent dan melanjutkan job parse; batch `ai` tetap memeriksa consent. Dibuktikan pgTAP.
10. **Dialog pilihan netral.** Pengguna tanpa consent yang menekan Upload melihat dialog dengan dua kartu setara (§2.2.10). Fokus awal ada di judul dialog, sehingga Enter tanpa memilih tidak meng-upload dan tidak memberi consent. **Baca tanpa AI** meng-upload dengan header `x-extraction-mode: rules` tanpa mengubah consent. **Pakai AI** menyimpan consent lalu meng-upload dengan mode `ai`. Esc dan tombol tutup tidak meng-upload. Kedua tombol memakai varian yang sama. Dialog consent analisis aktivitas tidak berubah. Dibuktikan unit UI dan E2E.
11. **Copy jujur.** Disclosure S02 bercabang sesuai consent; catatan "dibaca tanpa AI" tampil di hasil siap S02 dan di atas S03 hanya untuk batch `rules`; hasil kosong `rules` memakai copy khusus. Semua key baru ada di en dan id dan tidak mengandung em dash. Dibuktikan unit.
12. **Alur penuh.** Integration: upload `rules` → scan → parse + ekstraksi → review → commit → purge membersihkan teks dan objek; penghapusan akun menghapus batch `rules`. E2E: pengguna baru menolak AI, upload PDF fixture, review, konfirmasi, dashboard menampilkan record. Dibuktikan integration dan E2E.
13. **Privasi dan isolasi.** Akun B tidak melihat batch `rules` akun A; log, response, dan console tidak memuat teks CV, excerpt, atau nama file (sentinel = 0). Dibuktikan integration dan E2E.
14. **Aksesibilitas.** Axe tanpa pelanggaran WCAG 2.2 AA pada dialog pilihan import dan S02/S03 untuk batch `rules`; 360 px dan 1440 px, light dan dark; kartu berdampingan di 1440 px dan bertumpuk di 360 px tanpa overflow horizontal; urutan tab dari judul: Pakai AI, lalu Baca tanpa AI; tiap kartu adalah region berlabel sehingga screen reader membacakan isi kartu bersama tombolnya. Dibuktikan E2E.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- Migration `supabase/migrations/20261019090000_t26_import_rules_extraction.sql`, pgTAP `supabase/tests/database/import_rules.test.sql`, regenerasi `src/server/supabase/database.types.ts`.
- Domain murni `src/domain/import/rules-extract.ts` (+ `rules-patterns.ts` bila file melebihi ~400 baris).
- Parser thread, worker import, gateway Supabase worker, service dan route upload, view model S02/S03.
- UI S02 (`import-start.tsx`), dialog pilihan baru (`import-mode-dialog.tsx`), opsi fokus judul pada primitive `Dialog`, catatan S03 (`import-review.tsx`), copy en/id, test unit/integration/E2E, receipt, draft decision 0033 final.

### 2.2 Keputusan implementasi

1. **Mode ditetapkan saat upload.** Client mengirim `x-extraction-mode: ai|rules`. Header tidak ada → `ai` (kompatibel dengan client lama). Nilai lain → 400 `INVALID_IMPORT_UPLOAD`. Mode tersimpan di `import_batches.extraction_mode` dan disalin ke `internal.import_jobs.extraction_mode` oleh `finalize_import_upload`. Consent yang berubah setelah upload tidak mengubah mode batch.
2. **Consent hanya untuk mode `ai`.** `begin_import_batch` memeriksa `internal.has_current_ai_consent` hanya bila mode `ai`. `complete_import_parse` dan `retry_import_batch` juga hanya memeriksa consent untuk mode `ai`. Batch `rules` tidak pernah gagal dengan `CONSENT_REQUIRED` atau `CONSENT_WITHDRAWN`.
3. **Pengguna dengan consent tetap memakai AI.** Tidak ada pilihan manual "baca tanpa AI" untuk pengguna yang sudah consent (disetujui pengguna, YAGNI).
4. **Ekstraksi di parser thread.** `parseInThread(kind, bytes, { extract: true })` menjalankan `extractImportByRules` atas teks final (setelah `normalizeExtractedText`) di thread yang sama. Exception extractor ditangkap di dalam thread dan dikembalikan sebagai `extraction: null, extractionFailed: true`; teks tetap dikembalikan. Thread tidak pernah mengembalikan teks dalam pesan error.
5. **Validasi di worker, struktur di database.** Worker memanggil `validateImportResult(extraction, text)` dari `src/domain/import/extract-result.ts:224`. `ok: false` atau `extractionFailed` → `fail_import_job(..., 'IMPORT_RULES_FAILED', true, ...)`. Database memvalidasi struktur item dengan aturan yang sama seperti `complete_import_ai_job` (`20260930090000_t15_import_staging.sql:1392-1419`), plus: batch `rules` hanya boleh berisi `profile`, `experience`, `education`, `skill`.
6. **Aturan ekstraksi v1 (dibekukan).** Excerpt selalu potongan baris asli. Field yang tidak yakin diisi `null`, tidak ditebak.
   - *Bagian:* baris heading bila ≤ 40 karakter, tanpa angka, dan cocok kamus setelah `:` dibuang dan huruf disamakan. Experience: `experience`, `work experience`, `professional experience`, `employment`, `work history`, `pengalaman`, `pengalaman kerja`, `riwayat pekerjaan`. Education: `education`, `academic background`, `pendidikan`, `riwayat pendidikan`. Skills: `skills`, `technical skills`, `keahlian`, `kemampuan`, `keterampilan`, `kompetensi`. Summary: `summary`, `profile`, `about me`, `ringkasan`, `profil`, `tentang saya`. Heading penutup (isinya diabaikan di v1): `certifications`, `sertifikasi`, `projects`, `proyek`, `awards`, `penghargaan`, `languages`, `bahasa`, `references`, `referensi`, `organisasi`, `organizations`, `volunteering`. Teks sebelum heading pertama adalah blok header.
   - *Profil* (blok header + summary): `contact_email` dari regex email pertama; `phone` dari pola `+62`/`08`/internasional dengan 9–15 digit; `website` dari URL `http(s)` pertama atau domain telanjang yang diberi `https://` (validator membandingkan tanpa skema, `extract-result.ts:185-193`); `display_name` dari baris pertama berisi 2–5 kata huruf tanpa angka, `@`, atau URL; `headline` dari baris setelah nama bila ≤ 80 karakter tanpa info kontak; `summary` dari isi bagian summary; `location` selalu `null`. Tidak ada kandidat profil bila semua field kosong.
   - *Rentang tanggal:* `<tgl> <pemisah> <tgl | present | now | current | sekarang | saat ini>` dengan pemisah `-`, `–`, `to`, `s/d`, `sampai`; format `Mon YYYY` (nama bulan en/id dari daftar `MONTHS` yang sama dengan validator, `extract-result.ts:91-97`), `MM/YYYY`, `YYYY`. `day` selalu `null`. Kata present → `is_current: true`, `end: null`.
   - *Experience:* baris yang berisi rentang tanggal adalah jangkar entri. Maksimal 3 baris non-bullet di sekitar jangkar (sebelum bullet pertama) adalah header entri; baris bullet (`•`, `-`, `*`, `▪`, `·`, nomor) masuk `description` (digabung dengan newline, maks. `IMPORT_LIMITS.long`). Pemisah role/organisasi: `Role at Org`, `Role | Org`, `Role – Org`/`Role - Org`, `Role, Org`; dua baris tanpa pemisah: baris pertama role, baris kedua organisasi. `kind`: `intern`, `internship`, `magang` → `internship`; `volunteer`, `relawan`, `sukarelawan` → `volunteer`; selain itu `null`. `ref` berurutan `exp-1`, `exp-2`, dst. Bagian experience tanpa jangkar tanggal tidak menghasilkan kandidat.
   - *Education:* jangkar tanggal yang sama, tahun tunggal juga diterima. `institution` dari baris/segmen yang memuat `universitas`, `university`, `institut`, `institute`, `politeknik`, `polytechnic`, `sekolah`, `school`, `sma`, `smk`, `college`, `akademi`, `academy`. `qualification` dari segmen yang memuat `S1`, `S2`, `S3`, `D3`, `D4`, `sarjana`, `magister`, `doktor`, `diploma`, `bachelor`, `master`, `phd`, `b.sc`, `m.sc`, `b.eng`, `s.kom`, `s.t.`. `field_of_study` dari teks setelah `jurusan`, `program studi`, `prodi`, `in`, `of`, atau setelah koma yang mengikuti gelar.
   - *Skills:* buang bullet dan prefix label (`Teks: …`), pecah per `,`, `;`, `•`, `|`. Garis miring bukan pemisah (`CI/CD` utuh). Token 1–50 karakter dan ≤ 5 kata; duplikat case-insensitive dibuang; maksimal `IMPORT_LIMITS.perType`. Excerpt = baris asal token.
   - *Batas:* baris > 500 karakter tidak dicek sebagai heading atau jangkar. Regex tanpa quantifier bersarang dan tanpa backtracking tak terbatas. `certifications` dan `achievements` selalu `[]`.
7. **Kode error baru.** `IMPORT_RULES_FAILED` (permanen) ditambahkan ke `internal.is_permanent_import_error` dan ke `FAILURE_KEYS` di `src/features/import/import-start.tsx:24`. Timeout thread tetap `PARSER_TIMEOUT`, crash thread tetap `CORRUPT_FILE` (perilaku 0021 #9).
8. **Stage.** Batch `rules` berpindah `parsing → done` tanpa `extracting`. Copy progress tidak berubah.
9. **Hasil kosong.** Nol kandidat valid → `review` tanpa item, tampil sebagai `review_empty` (perilaku T17), bukan error.
10. **Dialog pilihan netral (50:50).** Import tidak lagi memakai `AiConsentDialog` untuk pengguna tanpa consent. Komponen baru `src/features/import/import-mode-dialog.tsx` dibangun di atas primitive `Dialog`:
    - Dua kartu setara (`section` berlabel dengan heading sendiri), urutan tetap: **Dengan AI**, lalu **Tanpa AI**. Tidak diacak, agar susunannya dapat diprediksi bagi pengguna keyboard dan screen reader.
    - Isi kartu simetris: ke mana teks dikirim, apa yang ditemukan, apa kekurangannya. Kartu AI juga menyebut bahwa izin berlaku untuk analisis aktivitas dan dapat dicabut di Pengaturan, karena consent `ai-processing-v1` memang mencakup keduanya.
    - Kedua tombol memakai varian `secondary` yang sama. Tidak ada badge "Disarankan", tidak ada warna atau ukuran yang membedakan.
    - **Fokus awal di judul dialog.** `showModal()` native memfokuskan elemen pertama yang dapat difokus bila tidak ada `autoFocus` (`src/components/ui/dialog.tsx:29`), sehingga tanpa perubahan fokus jatuh ke tombol kartu pertama. Primitive `Dialog` mendapat prop opsional `focusTitle?: boolean` yang memberi heading `tabIndex={-1}` dan `autoFocus`. Dialog lain tidak berubah karena default-nya `false`.
    - Esc, klik backdrop, dan tombol tutup hanya membatalkan; file tetap terpilih.
    - **Pakai AI** memanggil `setAiConsentAction` seperti alur sekarang (`import-start.tsx:171-189`), lalu upload mode `ai`. Gagal menyimpan consent → pesan error di dialog, tanpa upload. **Baca tanpa AI** langsung upload mode `rules`.
    - Satu kalimat bersama di bawah kartu tentang data yang tidak pernah dikirim dan review sebelum simpan.
    - Layout: kartu berdampingan mulai lebar yang cukup (mengikuti breakpoint `Design.md`), bertumpuk di mobile.
    - `AiConsentDialog` dan pemakaiannya untuk analisis aktivitas tidak berubah.
11. **View model.** `ImportView` (`src/domain/import/import-view.ts`) dan view review S03 (`src/domain/import/review-view.ts`) mendapat `extractionMode: "ai" | "rules"`. Batch lama tanpa nilai eksplisit dibaca sebagai `ai` (default kolom).
12. **Copy.** Semua teks baru lewat `src/i18n/messages.ts` (en dan id), tanpa string literal di komponen dan tanpa em dash. Teks yang disetujui:
    - `import.mode.title`: en "How should we read your CV?" / id "Bagaimana CV Anda dibaca?"
    - `import.mode.description`: en "Choose one. Both options open the same review before anything is saved." / id "Pilih salah satu. Kedua pilihan membuka review yang sama sebelum apa pun disimpan."
    - `import.mode.aiTitle`: en "With AI" / id "Dengan AI".
    - `import.mode.aiBody`: en "Your CV text is sent to an external AI provider. It finds experience, education, skills, certifications and achievements." / id "Teks CV dikirim ke penyedia AI eksternal. AI menemukan pengalaman, pendidikan, skill, sertifikasi, dan pencapaian."
    - `import.mode.aiConsent`: en "This permission also covers activity analysis. You can withdraw it in Settings." / id "Izin ini juga berlaku untuk analisis aktivitas dan bisa dicabut di Pengaturan."
    - `import.mode.aiAction`: en "Use AI" / id "Pakai AI".
    - `import.mode.rulesTitle`: en "Without AI" / id "Tanpa AI".
    - `import.mode.rulesBody`: en "Your CV text is read on the WorkPulse server using fixed rules. It finds experience, education and skills. You usually get fewer results." / id "Teks CV dibaca di server WorkPulse dengan aturan tetap. Hasilnya mencakup pengalaman, pendidikan, dan skill, dan biasanya lebih sedikit."
    - `import.mode.rulesAction`: en "Read without AI" / id "Baca tanpa AI".
    - `import.mode.shared`: en "Either way, the file, its name and your other records are not sent. You review every result before it is saved." / id "Apa pun pilihan Anda, file, nama file, dan data Anda yang lain tidak dikirim. Semua hasil tetap Anda tinjau sebelum disimpan."
    - `import.disclosureNoConsent`: en "If you allow AI, your CV text is sent to an external AI provider. If you don't, WorkPulse reads it itself using fixed rules. The file, its name and your other records are never sent." / id "Kalau Anda mengizinkan AI, teks CV dikirim ke penyedia AI eksternal. Kalau tidak, WorkPulse membacanya sendiri dengan aturan tetap. File, nama file, dan data Anda yang lain tidak pernah dikirim."
    - `import.rulesNote`: en "These records were read without AI. Check employers, job titles and dates before you confirm." / id "Data ini dibaca tanpa AI. Cek nama perusahaan, jabatan, dan tanggal sebelum mengonfirmasi."
    - `import.emptyBodyRules`: en "We couldn't find an Experience, Education or Skills section in this file. Two-column or table-based CVs often can't be read without AI. You can try another file or start manually." / id "Kami tidak menemukan bagian Pengalaman, Pendidikan, atau Skill di file ini. CV dua kolom atau berbentuk tabel sering tidak terbaca tanpa AI. Anda bisa mencoba file lain atau mulai manual."
    - `import.failed.IMPORT_RULES_FAILED`: en "We couldn't read this CV without AI. Try another file or start manually." / id "Kami tidak bisa membaca CV ini tanpa AI. Coba file lain atau mulai manual."
13. **Nomor.** Migration `20261019090000_t26_import_rules_extraction.sql` (parity 38/38). Decision `docs/decisions/0033-t26-import-rules-extraction.md`. Tidak ada script npm baru; suite baru masuk ke script yang ada (`test`, `test:integration:import`, `test:e2e:import`).
14. **Basis usage limits (revisi 18 Oktober 2026).** Pengguna memutuskan T26 berbasis branch `claude/eloquent-jones-3c0191` (batas pemakaian AI, migration `20261018090000_ai_usage_limits.sql`, decision 0032). `begin_import_batch` dan `retry_import_batch` di migration T26 mengambil body versi usage limits: batch `ai` tetap men-charge unit `import` seperti di branch itu, batch `rules` tidak men-charge karena tidak ada panggilan provider. Decision T26 menjadi 0033. Parity menjadi 38/38.

### 2.3 Di luar scope

- Achievement dari bullet experience, sertifikasi, proyek, dan `location` → follow-up setelah uji CV nyata.
- Pilihan "baca tanpa AI" untuk pengguna yang sudah consent.
- Fallback otomatis ke aturan saat AI gagal atau consent ditarik di tengah batch `ai` (batch `ai` tetap gagal `CONSENT_WITHDRAWN` seperti 0021).
- Deteksi layout dua kolom, OCR, atau library parsing CV pihak ketiga.
- Perubahan review S03, commit T16, purge, dan retensi selain catatan `rules`.
- Deploy ke staging (ikut alur T25 setelah T26 DONE).

## 3. Kontrak teknis

### 3.1 Migration `20261019090000_t26_import_rules_extraction.sql`

- `alter table public.import_batches add column extraction_mode text not null default 'ai'` + `check (extraction_mode in ('ai', 'rules'))`. Sama untuk `internal.import_jobs`.
- `internal.guard_import_batch_row()` (`20260930090000_t15_import_staging.sql:221`): `create or replace` dengan `extraction_mode` ditambahkan ke daftar kolom identitas immutable. Salin seluruh body lama; jangan mengubah aturan lain.
- `internal.is_permanent_import_error(text)` (`:9`): tambah `IMPORT_RULES_FAILED`.
- `public.begin_import_batch`: `drop function public.begin_import_batch(uuid, text, bigint, text, text)`, lalu buat versi 6 parameter dengan `p_extraction_mode text` di akhir. Validasi mode (`22023 INVALID_IMPORT_UPLOAD`); consent hanya bila `ai`; mode masuk `v_hash` (`:841`) sehingga key sama dengan mode berbeda → `IDEMPOTENCY_KEY_REUSED`; mode disimpan saat insert. Ulangi `revoke`/`grant`/`comment` untuk signature baru (pola `:1661-1664`, `:1697`).
- `public.finalize_import_upload` (`:976`): salin `extraction_mode` ke insert `internal.import_jobs` (`:1002-1003`).
- `public.claim_import_jobs(integer)` (`:1043`): tipe kembalian berubah, jadi `drop` lalu buat ulang dengan kolom `extraction_mode` tambahan. Ulangi `revoke`/`grant`/`comment`.
- `internal.stage_import_items(p_batch public.import_batches, p_items jsonb, p_allowed_types text[]) returns boolean`: pindahan validasi struktur dan insert item dari `complete_import_ai_job` (`:1392-1446`). Mengembalikan `false` tanpa insert bila struktur invalid. `complete_import_ai_job` dibuat ulang memanggil fungsi ini dengan keenam tipe; perilakunya harus identik (test pgTAP T15 lama tetap lulus).
- `public.complete_import_parse`: `drop` signature 4 parameter, buat `(p_job_id uuid, p_attempt_token uuid, p_text text, p_page_count integer, p_items jsonb default null)`. Mode `ai`: `p_items` harus `null` (selain itu `22023`), lalu perilaku lama (`:1219-1233`). Mode `rules`: `p_items` wajib array; tutup job parse `succeeded`, simpan teks dan `page_count`, panggil `internal.stage_import_items` dengan tipe `profile/experience/education/skill`; `false` → `internal.fail_import_batch_locked(..., 'IMPORT_RULES_FAILED')` dan kembalikan `'failed:IMPORT_RULES_FAILED'`; `true` → `status = 'review'`, `stage = 'done'`, kembalikan `'succeeded'`. Ulangi `revoke`/`grant`/`comment`.
- `public.retry_import_batch` (`:908`): pemeriksaan consent di `:941` hanya untuk batch `ai`.
- Urutan lock tidak berubah (0021 *Lock order*).

### 3.2 Domain

- `src/domain/import/rules-extract.ts` (imports relatif, tanpa alias `@/`, tanpa TypeScript parameter properties karena worker memakai Node type stripping, seperti `extract-result.ts:144`): ekspor `extractImportByRules(text: string): RawImportResult` dan konstanta kamus heading. Murni, tanpa I/O.
- `src/domain/import/import-view.ts` dan `review-view.ts`: field `extractionMode` (§2.2.11).

### 3.3 Server dan worker

- `src/server/documents/parser-thread.ts` dan `parse-in-thread.ts`: opsi `extract` dan field hasil `extraction`/`extractionFailed` (§2.2.4).
- `workers/import-worker.ts:160-173`: bila `job.extraction_mode === 'rules'`, parse dengan `extract: true`, validasi (§2.2.5), lalu `completeImportParse(job.id, job.attempt_token, text, pageCount, items)`. Ringkasan worker menambah hitungan `importRulesStaged`. Cek halaman dan panjang teks tetap terjadi sebelum `completeImportParse`.
- `workers/supabase-import-gateway.ts`: parameter `p_items` dan kolom `extraction_mode` dari claim.
- `src/app/api/imports/route.ts` dan `src/features/import/import-service.ts`: baca dan validasi header (§2.2.1), teruskan `p_extraction_mode`.

### 3.4 UI

- `src/components/ui/dialog.tsx`: prop opsional `focusTitle` (§2.2.10); dialog yang sudah ada tidak berubah.
- `src/features/import/import-mode-dialog.tsx` (baru): §2.2.10.
- `src/features/import/import-start.tsx`: `upload` menerima mode; pengguna tanpa consent membuka `ImportModeDialog` sebagai ganti `AiConsentDialog`; disclosure bercabang (`granted`); catatan `import.rulesNote` di `review_ready` bila `extractionMode === 'rules'`; `import.emptyBodyRules` di `review_empty` untuk `rules`; `IMPORT_RULES_FAILED` di `FAILURE_KEYS`.
- `src/features/import/import-review.tsx`: catatan `import.rulesNote` di atas grup kandidat untuk batch `rules`, sebagai teks biasa (bukan hanya badge warna).

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Create | `supabase/migrations/20261019090000_t26_import_rules_extraction.sql`, `supabase/tests/database/import_rules.test.sql` |
| Modify | `src/server/supabase/database.types.ts` (via `pnpm db:types`) |
| Create | `src/domain/import/rules-extract.ts` (+ `rules-patterns.ts` bila perlu) |
| Modify | `src/domain/import/import-view.ts`, `src/domain/import/review-view.ts` |
| Modify | `src/server/documents/parser-thread.ts`, `src/server/documents/parse-in-thread.ts` |
| Modify | `workers/import-worker.ts`, `workers/supabase-import-gateway.ts` |
| Modify | `src/app/api/imports/route.ts`, `src/features/import/import-service.ts`, `src/features/import/import-review-view-service.ts` |
| Create | `src/features/import/import-mode-dialog.tsx` |
| Modify | `src/components/ui/dialog.tsx`, `src/features/import/import-start.tsx`, `src/features/import/import-review.tsx`, `src/i18n/messages.ts`, `src/app/globals.css` (layout kartu, token yang ada) |
| Create | `tests/unit/import-rules-extract.test.ts` |
| Modify | `tests/import-fixtures.ts`, `tests/unit/import-worker.test.ts`, `tests/unit/import-view.test.ts`, `tests/unit/import-start-ui.test.tsx`, `tests/unit/import-review-ui.test.tsx`, `tests/integration/import-staging.test.ts`, `tests/integration/import-commit.test.ts`, `tests/integration/account-deletion.test.ts`, `tests/e2e/import-onboarding.spec.ts` |
| Create | `docs/verification/T26-phase{0..5}-*.md`, `docs/verification/T26-import-rules-extraction.md` |
| Modify | `docs/decisions/0033-t26-import-rules-extraction.md` (draft → final) |

## 5. Fase eksekusi

### Fase 0: Baseline (tanpa edit kode)

- [ ] `git status` bersih untuk path T26 (catat file lain yang kotor, jangan disentuh); branch kerja baru dari `main`.
- [ ] Parity migration lokal **37/37**, migration terakhir `20261018090000_ai_usage_limits.sql` (basis branch `claude/eloquent-jones-3c0191`).
- [ ] Jalankan `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:test`, `pnpm db:lint`, `pnpm worker:check`. Harapan dari receipt terakhir: unit **118/1068**, pgTAP **20/1638**. Catat angka aktual.
- [ ] Jalankan `pnpm test:integration:import`, `test:integration:import-commit`, `test:integration:import-review`, `test:e2e:import`, `test:e2e:import-review`; catat angka.
- [ ] Verifikasi rujukan file:baris di §3 masih benar terhadap source; selisih dicatat di receipt.
- [ ] Receipt `T26-phase0-baseline.md`.

### Fase 1: Database (pgTAP dulu)

- [ ] Tulis `import_rules.test.sql` (gagal): acceptance 1, 2, 3, 8 (permanen), 9; struktur `rules` menolak `achievement`/`certification`; `p_items` non-null untuk batch `ai` ditolak; `claim_import_jobs` mengembalikan mode; grant signature baru hanya `authenticated`/`service_role` sesuai pola lama.
- [ ] Tulis migration §3.1; `pnpm db:test` lulus termasuk `import_staging.test.sql` lama tanpa perubahan assertion; `pnpm db:lint` exit 0; `pnpm db:types`.
- [ ] Bila `release_catalog.test.sql` atau `test:integration:release` gagal karena signature baru, perbaiki hanya daftar signature yang memang berubah dan catat alasannya di receipt.
- [ ] Receipt `T26-phase1-database.md`, commit.

### Fase 2: Domain extractor (unit)

- [ ] Fixture teks CV sintetis di `tests/import-fixtures.ts` (orang fiktif): satu kolom en, satu kolom id, variasi pemisah, variasi tanggal, intern/relawan, skills berlabel, heading penutup, tanpa heading, experience tanpa tanggal, teks dua kolom teracak.
- [ ] `tests/unit/import-rules-extract.test.ts` (gagal): acceptance 5, 6, 7 (baris 500+ karakter berpola jahat selesai < 50 ms per baris di mesin lokal; catat angka).
- [ ] Implementasi `rules-extract.ts`; `pnpm test`, `pnpm typecheck`, `pnpm lint` lulus.
- [ ] Receipt `T26-phase2-domain.md`, commit.

### Fase 3: Worker, thread, service, route

- [ ] `import-worker.test.ts` (gagal): batch `rules` sukses tanpa enqueue AI; `extractionFailed` dan validasi gagal → `IMPORT_RULES_FAILED` final; batch `ai` tidak berubah; log tanpa teks (sentinel).
- [ ] Test service/route: header valid, header hilang → `ai`, header invalid → 400; `ImportView.extractionMode`.
- [ ] Implementasi §3.3; `pnpm worker:check` exit 0.
- [ ] Integration `import-staging.test.ts`/`import-commit.test.ts`/`account-deletion.test.ts`: acceptance 12 (bagian integration) dan 13.
- [ ] Receipt `T26-phase3-worker-service.md`, commit.

### Fase 4: UI dan copy

- [ ] `import-start-ui.test.tsx` dan `import-review-ui.test.tsx` (gagal): acceptance 10 dan 11, termasuk fokus awal di judul, Enter tanpa memilih tidak meng-upload, kedua tombol bervarian sama, Esc tanpa upload, Pakai AI menyimpan consent sebelum upload `ai`, Baca tanpa AI meng-upload `rules` tanpa consent, catatan dan copy kosong hanya untuk `rules`, dialog analisis tidak berubah.
- [ ] Test primitive `Dialog`: `focusTitle` memfokuskan heading; tanpa prop, perilaku fokus dialog lama tetap.
- [ ] Test otomatis: key baru ada di en dan id, tanpa karakter em dash.
- [ ] Implementasi §3.4 dan copy §2.2.12.
- [ ] Receipt `T26-phase4-ui.md`, commit.

### Fase 5: E2E, aksesibilitas, regresi penuh

- [ ] `import-onboarding.spec.ts`: skenario pengguna baru menolak AI → upload PDF fixture → review → konfirmasi → dashboard; axe pada dialog dan S02/S03 `rules`; 360/1440 px light/dark; keyboard-only.
- [ ] Regresi §7 lengkap; tidak ada assertion lama yang dilemahkan. Perubahan assertion yang disengaja dicatat dengan alasan.
- [ ] Receipt `T26-phase5-e2e-regression.md`, commit. **Stop: gate review Claude.**

### Fase 6: Draft dokumen (setelah gate lulus)

- [ ] Finalkan decision 0033 (hapus penanda draft, isi angka aktual).
- [ ] Tulis `docs/verification/T26-import-rules-extraction.md` (ringkasan acceptance dan bukti) tanpa klaim DONE.
- [ ] Commit.

## 6. Fixture

- Akun A (pengguna baru tanpa consent) dan akun B (isolasi), dibuat dan dibersihkan oleh helper yang ada (`tests/e2e/helpers/import-worker.ts`, fixture integration import).
- Teks CV sintetis dengan nama dan perusahaan fiktif; tidak ada data orang nyata di repo.
- Sentinel privat: string unik di teks CV dan nama file fixture, dicari di log worker, response route, dan console browser (harus 0).
- PDF fixture untuk E2E dibuat dari teks fixture dengan cara yang sama seperti fixture import T15 yang ada.

## 7. Commands

Semua script sudah ada di `package.json`:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm test:integration:import
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:m3
pnpm test:integration:release
pnpm test:integration:account-deletion
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:m3
pnpm test:e2e:release
```

Jalankan `test:integration:account-deletion` sebelum suite integration lain yang meninggalkan cleanup job, sesuai urutan CI di `4e4d790`.

## 8. Stop conditions

Berhenti dan laporkan bila:

- Working tree kotor pada path yang akan diubah T26.
- Perlu `db reset` database lokal aktif atau rewrite migration lama.
- Test lama T15–T17 hanya bisa lulus dengan melemahkan assertion, atau perilaku batch `ai` berubah.
- Grounding `validateImportResult` perlu diubah agar output aturan lulus (output aturan yang harus menyesuaikan, bukan validator).
- Scope bocor ke §2.3 (achievement dari bullet, sertifikasi, fallback AI, pilihan untuk pengguna consent).
- Perlu dependency baru.
- Masalah credential atau kebutuhan memanggil penyedia AI nyata.

## 9. Gate review Claude

Read-only setelah Fase 5. P0–P2 memblokir, P3 follow-up.

- [ ] Receipt Fase 0–5 lengkap dengan angka aktual; ulang checks utama di worktree bersih.
- [ ] Migration: signature lama ter-drop, grant/revoke/comment lengkap, `stage_import_items` identik dengan logika lama, consent hanya untuk `ai` di ketiga titik.
- [ ] Batch `rules` tidak pernah membuat `ai_jobs` dan tidak pernah gagal karena consent.
- [ ] Extractor murni, regex linear, excerpt potongan asli, tidak ada field yang ditebak.
- [ ] Dialog netral: fokus awal di judul, kedua kartu setara (ukuran, varian, tanpa badge), Esc tanpa upload, kartu AI menyebut cakupan consent, dialog analisis tidak berubah.
- [ ] Copy en/id sesuai §2.2.12, simetris antar kartu, tanpa em dash, tanpa klaim akurasi.
- [ ] Log dan response tanpa teks CV atau nama file.

## 10. Review focus

1. **Consent bocor.** Satu titik pemeriksaan consent terlewat (`begin`, `complete_import_parse`, `retry`) sehingga batch `rules` gagal atau batch `ai` lolos tanpa consent. Dijaga pgTAP acceptance 1, 3, 9.
2. **Refactor staging mengubah perilaku AI.** Pemindahan ke `internal.stage_import_items` diam-diam mengubah validasi atau resolusi `experience_ref`. Dijaga `import_staging.test.sql` lama dan integration T15/T16.
3. **ReDoS di extractor.** Regex dengan quantifier bersarang membuat parser thread kena timeout pada CV biasa. Dijaga unit waktu acceptance 7 dan batas baris 500 karakter.
4. **Excerpt tidak grounded.** Extractor menormalisasi teks sebelum memotong excerpt sehingga validator membuang kandidat. Dijaga kontrak acceptance 5 (`dropped_ungrounded === 0`).
5. **Dialog tidak benar-benar netral.** Fokus jatuh ke tombol kartu pertama karena perilaku `showModal()` native, atau `onOpenChange(false)` dipakai juga oleh tombol pilihan sehingga Esc ikut meng-upload. Dijaga unit UI acceptance 10 (fokus judul, Enter, Esc).
6. **Idempotency mode.** Replay dengan key sama dan mode berbeda membuat batch kedua atau memakai mode lama. Dijaga pgTAP acceptance 2.
