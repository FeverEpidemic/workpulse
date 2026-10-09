# Handoff Gate M4 — integration review Master CV dan PDF

> **Untuk agen pelaksana:**
> - Kerjakan fase berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Ini **review gate**, bukan task fitur. Jangan menambah fitur.
> - Perbaikan hanya untuk temuan P0–P2 dan wajib memakai TDD: tulis test gagal → jalankan → perbaiki minimal → jalankan ulang → commit.
> - Jangan membuat sub-agent. Bila ragu, baca §6 (stop conditions) sebelum berimprovisasi.
> - Nama file test, script, config, dan port di dokumen ini **dibekukan**.

- Tanggal: 8 Oktober 2026
- Status saat handoff ditulis: Gate M4 **terbuka**. T18–T22 **DONE** pada acceptance lokal per task (lihat `docs/IMPLEMENTATION_STATUS.md`).
- Baseline: branch `claude/clever-archimedes-gbu7qd`, HEAD minimal `4757a76 docs(t23): record user approval of frozen decisions`. Commit kode produk terakhir adalah `369b016` (T22 RV1).
- Pelaksana: satu agent **Claude Sonnet 5.5** di sesi baru. Berhenti setelah Fase 6 dan serahkan receipt.
- Pemberi keputusan: **Claude** (Opus). Hanya reviewer yang menulis verdict Gate M4 (Fase 7) dan bagian authoritative `IMPLEMENTATION_STATUS.md`.
- Acuan:
  - `IMPLEMENTATION_PLAN.md` §1, §3 (*CV*), §5 (T18–T22 dan kalimat **Gate M4**), §6 (baris R09, R10, enam skenario rilis).
  - PRD R09, R10, *CV freshness contract*, *Release scenarios*, tabel milestone M4.
  - User Flow F07. Wireframe S04, S08, S13, S14. Database Schema §5 dan §6.
  - Decision 0024–0028. `Design.md`. `AGENTS.md`.

**Tujuan:** membuktikan kalimat gate di `IMPLEMENTATION_PLAN.md:277`:

> Gate M4: F07 end-to-end lolos; snapshot/provenance/override terjaga dan PDF dapat dibaca serta dicari.

Kriteria milestone PRD M4 *CV output*: *Selection, ordering, overrides, refresh, PDF jobs. Source provenance survives editing and export; layout fixtures pass.*

Setiap task M4 sudah lulus per lapis. Gate ini menguji **sambungan antar lapis dan domain**:

- satu pengguna menjalankan F07 utuh di browser nyata, dari data karier (S04/S08) sampai PDF yang diunduh dan teksnya diekstrak;
- mutasi di domain karier (activity, achievement, project, experience, profil, evidence, import) tercermin konsisten di S13, S14, Dashboard, dan snapshot export;
- PDF yang sudah dibuat tidak pernah berubah, dan tidak ada data akun lain yang bocor.

---

## 0. Cara memakai handoff ini

1. Baca dokumen ini sampai selesai sebelum menjalankan apa pun.
2. Baca `AGENTS.md`, entry T18–T22 di `docs/IMPLEMENTATION_STATUS.md`, `IMPLEMENTATION_PLAN.md` §3 *CV* dan §5 M4, serta decision 0024–0028.
3. Ekstrak R09, R10, *CV freshness contract*, *Release scenarios*, tabel milestone dari PRD; F07 dari User Flow; S13/S14 dari Wireframe; DB §5/§6. Pakai `python -I` + `zipfile` atas `word/document.xml` (`python-docx` tidak terpasang). Jangan menebak isi DOCX dari nama file.
4. Pertahankan perubahan lokal pengguna. Jangan commit, stash, reset, atau checkout atas nama pengguna selain commit pekerjaan gate sendiri.
5. Pada akhir setiap fase, tulis **receipt** ke `docs/verification/M4-gate-phaseN-<slug>.md` berisi:
   - tujuan dan file berubah;
   - command beserta hasil aktual (exit code dan angka pass/fail);
   - temuan terklasifikasi;
   - blocker dan langkah berikutnya.

   Angka di receipt harus hasil command yang benar-benar dijalankan.

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD R09:** pilih dan urutkan experience, project, confirmed achievement, education, skill, certification. Edit summary dan wording item. Edit sumber memicu refresh yang dapat ditinjau.
- **PRD R10:** export revision CV tersimpan sebagai teks A4 yang dapat dicari dengan page break benar. Kegagalan mempertahankan draft dan mendukung retry. Evidence tidak di-embed atau ditautkan.
- **PRD freshness:**
  - confirm achievement tidak otomatis memasukkannya ke CV;
  - update sumber terpilih menandai item *changed*; refresh hanya memperbarui item tanpa override;
  - item ber-override menampilkan wording lama dan perubahan sumber, lalu pengguna memilih Keep atau Replace;
  - sumber deleted/unconfirmed memblokir export;
  - PDF yang sudah diunduh tidak berubah.
- **F07:**
  1. Buka pertama membuat CV unik akun; pilih label id/en; template satu kolom A4.
  2. Pilih dan urutkan record. Achievement di bawah parent yang terpilih, standalone di *Selected achievements*. Memilih child memasukkan parent.
  3. Layout awal dari data sumber tanpa panggilan AI. Override disimpan terpisah dari snapshot sumber.
  4. Simpan, lalu S14 memakai revision tersimpan yang persis. Validasi memblokir CV tanpa nama atau tanpa record substantif.
  5. Sumber berubah → review di S13; item stale valid boleh diekspor setelah *Keep saved wording*; sumber hilang/unconfirmed harus dihapus atau diperbaiki.
  6. Export mengantre job terikat snapshot immutable dan revision. Sukses → *Download PDF*; gagal → *Retry* snapshot sama; edit yang berjalan tidak mengubah export.
- **Skenario rilis PRD yang relevan:**
  - graduate tanpa CV/employment → education + project akademik → capture → confirm → export CV yang berguna;
  - edit achievement terpilih setelah override → refresh tanpa kehilangan override → hapus sumber → export terblokir sampai diselesaikan;
  - ownership dua akun untuk setiap tabel dan path Storage; validasi ekstraksi teks PDF, karakter Indonesia, bullet panjang, multipage.

## 1. Kriteria lulus Gate M4

Gate M4 **lulus** hanya jika semua poin berikut terbukti dengan hasil lokal nyata:

1. **F07 end-to-end di browser.** Satu E2E baru berhasil dari awal sampai akhir lewat UI: data karier → entry S04 atau S08 → S13 (seleksi, urutan, override, Save) → S14 → export dengan renderer Chromium nyata → halaman PDF tampil → *Download PDF* → teks hasil ekstraksi PDF yang diunduh cocok dengan revision tersimpan. Lihat Fase 3.
2. **Tanpa AI.** F07 berjalan tanpa variabel AI. Layout awal dan export tidak memanggil provider AI (penghitung adapter fake = 0 di integration).
3. **Snapshot immutable dan PDF lama tidak berubah.** Setelah edit sumber, override, refresh, delete, reopen, dan export baru, snapshot export lama dan byte objek PDF lama (sha256) identik dengan sebelumnya. Export baru mencerminkan revision barunya.
4. **Provenance terjaga.**
   - Item CV yang sumbernya dihapus tetap menyimpan snapshot tampilan dan memblokir export.
   - Achievement turunan tetap memiliki source excerpt/revision setelah activity sumbernya dihapus.
   - Achievement dan experience hasil import tetap utuh di CV dan export setelah batch import dipurge.
5. **Override terjaga.** Override wording, summary, dan kontak tidak pernah menimpa record canonical. Refresh tidak mengganti override; hanya *Replace from source* yang menggantinya. Override tercetak di PDF menggantikan teks sumber.
6. **Konsistensi lintas domain.** Untuk setiap mutasi Fase 4, readiness S14, review S13 (`get_cv_review_summary`), check CV Dashboard, dan snapshot export sepakat tanpa cache basi.
7. **PDF dapat dibaca dan dicari.** PDF yang diunduh di E2E dan PDF fixture integration:
   - A4;
   - teks dapat diekstrak (pdf.js) dan memuat nama, heading section sesuai locale CV, dan karakter Indonesia;
   - fixture panjang multipage (> 1 dan ≤ 20 halaman);
   - tanpa nama file evidence, object key, URL evidence, atau `credential_url`.

   `pnpm test:pdf` (fixture layout T22) lulus.
8. **Isolasi dua akun.** Akun B tidak dapat membaca, memilih, me-review, mengekspor, me-retry, memantau status, atau mengunduh apa pun milik CV A, di semua RPC, route, action, dan path Storage M4. Hasilnya tidak membedakan "tidak ada" dan "milik akun lain".
9. **Aksesibilitas journey.** Axe tanpa pelanggaran *serious*/*critical* pada S13 dan S14 dalam keadaan journey. Alur F07 dapat diselesaikan dengan keyboard, termasuk *Retry*, *Regenerate*, dan *Download PDF* (menutup celah T22 N6). Satu pass 360 × 800 dark tanpa overflow horizontal.
10. **Regresi penuh hijau.** Seluruh suite §7 lulus dengan renderer, ClamAV, dan Gotenberg nyata. Flaky dicatat dengan bukti rerun dan penyebab.
11. **Tidak ada temuan P0–P2 terbuka.** Semua P0–P2 diperbaiki dan diuji ulang. P3 dicatat sebagai follow-up.

Gate M4 **tidak** mencakup penghapusan akun dan retensi snapshot (T23), analytics dan p95 (T24), serta deployment/staging (T25).

## 2. Scope

### 2.1 Dalam scope

- Audit acceptance T18–T22 terhadap bukti yang ada, termasuk klasifikasi ulang P3 terbuka.
- Review kode lintas domain (read-only) dengan fokus pada sambungan antar fitur.
- Satu E2E journey baru dan satu integration lintas domain baru.
- Regresi seluruh suite lokal dengan renderer PDF, ClamAV, dan Gotenberg nyata.
- Perbaikan minimal untuk P0–P2 dengan test regresi.
- Laporan gate draft; verdict dan status authoritative oleh Claude.

### 2.2 Di luar scope

- Fitur baru, refactor, perubahan copy/desain non-P0–P2.
- Migration, kecuali perbaikan P0/P1 yang memerlukannya. Itu wajib dengan decision baru di `docs/decisions/` dan persetujuan reviewer; pelaksana **stop** lebih dulu.
- Perubahan aturan Retry export dan retensi snapshot. Keduanya sudah dibekukan untuk T23 (`T23-implementation-plan.md` §2.4.6–7); jangan dikerjakan di gate.
- AI live, deployment, layanan eksternal, `db reset`.

### 2.3 Klasifikasi temuan

| Level | Arti | Contoh | Tindakan |
| --- | --- | --- | --- |
| P0 | Kebocoran data/owner, kehilangan data, PDF memuat data akun lain atau evidence | Akun B mengunduh PDF A; delete sumber menghapus override | Stop, laporkan, perbaiki, uji ulang |
| P1 | F07 tidak dapat diselesaikan atau invariant rusak | Export lolos dengan sumber deleted; PDF lama berubah; snapshot ≠ revision tersimpan | Perbaiki sebelum lulus |
| P2 | Acceptance task tidak terpenuhi atau pelanggaran WCAG 2.2 AA | Fokus hilang setelah konflik; tabel review tidak reflow di 360 px; teks PDF tidak dapat dicari | Perbaiki sebelum lulus |
| P3 | Kosmetik, copy, flaky yang sudah dipahami, tech debt | Copy *failed* ganda; biaya baca freshness | Catat sebagai follow-up |

## 3. Input yang harus diaudit

| Task | Acceptance (ringkas, `IMPLEMENTATION_PLAN.md` §5) | Bukti |
| --- | --- | --- |
| T18 | First open serentak → satu CV; draft tidak eligible; child memasukkan parent; sumber duplikat ditolak; mutasi child menaikkan revision CV | `T18-cv-schema-selection.md`, `T18-gate-review.md` |
| T19 | Graduate dengan education/project dapat menyusun CV; wording manual tidak mengubah record canonical; parent removal menangani child; edit basi bersamaan tidak overwrite | `T19-cv-builder-overrides.md`, `T19-gate-review.md` |
| T20 | Edit sumber kedua membatalkan acknowledgement lama; refresh mempertahankan override; delete/reopen sumber memblokir; edit activity sumber memunculkan review tanpa overwrite diam-diam | `T20-cv-freshness-deletion.md`, `T20-gate-review.md` |
| T21 | Edit/delete/reopen yang berlomba dengan export → snapshot konsisten atau konflik yang dapat ditindaklanjuti; render gagal mempertahankan CV; lease timeout, export ganda, dan kedaluwarsa 24 jam | `T21-cv-export-backend.md`, `T21-review-remediation-plan.md` |
| T22 | Ekstraksi PDF cocok snapshot; heading tidak yatim; bullet tidak terbelah bila muat; tanpa clipping; URL unduhan owner-scoped ≤ 5 menit; inspeksi halaman render | `T22-saved-preview-pdf-qa.md`, `T22-review-remediation-plan.md`, `T22-screenshots/` |

P3 terbuka yang wajib masuk tabel Fase 1 dan diklasifikasi ulang:

- **T18:** F1 flaky, F3 race tidak deterministik.
- **T20:** F1 fokus hilang setelah `CV_SOURCE_CHANGED`, F2 tabel review kurang terbaca di 360 px, F3 copy unconfirmed/`parentAdded`, F4 assertion ganda di spec M2, F6 biaya baca freshness.
- **T21 (decision 0027):** N2 → T23, N3 kolom snapshot/key terbaca pemilik lewat PostgREST, N4 searchability Han/Arab/Ibrani/Devanagari, N5 rute LibreOffice di container renderer, N6 export dipakai ulang hampir kedaluwarsa, N7 biaya reconcile, N8 trim NBSP SQL vs TS.
- **T22 (decision 0028):** N1 copy *failed* ganda, N2 satu canvas, N3 E2E menulis ulang screenshot yang di-track, N4 → T23, N5 tiga query paralel, N6 Retry/Regenerate/Download belum diuji keyboard, N7 flaky `activity-ui`, N8 kolom preview sticky.

T20 F1 dan F2 menyentuh WCAG (fokus, reflow 1.4.10). Fase 1 memutuskan ulang levelnya berdasarkan bukti, bukan label lama.

## 4. Environment

- Supabase lokal via Docker harus aktif. Jangan `db reset`. Bila `db:start`/`db:status` dipakai, saring output-nya karena memuat key lokal.
- `.env.local` **tidak** memuat `SUPABASE_SECRET_KEY`. Ambil nilai lokal ke environment proses saja; jangan tulis ke file, log, atau receipt. Di mesin ini pakai `SERVICE_ROLE_KEY` (JWT) bila key format baru ditolak Kong:

  ```powershell
  $st = pnpm exec supabase status -o env 2>$null
  $line = $st | Where-Object { $_ -match '^SERVICE_ROLE_KEY=' }
  $env:SUPABASE_SECRET_KEY = ($line -replace '^[A-Z_]+="?','' -replace '"$','')
  ```

  Setiap panggilan tool PowerShell adalah proses baru, jadi ulangi baris ini (dan muat `.env.local`) dalam command yang sama dengan test.
- Renderer PDF `workpulse-t21-pdf` pada `127.0.0.1:13401` (`docs/verification/T21-pdf-renderer-runbook.md`). `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` hanya di env proses suite yang membutuhkannya. Jangan memakai renderer fake untuk bukti kriteria §1.1, §1.3, §1.7.
- ClamAV `workpulse-t10-clamav` (`127.0.0.1:13310`, `T10-scanner-runbook.md`) dan Gotenberg `workpulse-t15-gotenberg` (`127.0.0.1:13400`, `T15-renderer-runbook.md`) untuk evidence dan import. Periksa `docker ps` dulu; bila mati, `docker start` (jangan buat ulang bila sudah ada). Jangan hentikan container mana pun di akhir gate.
- Tidak ada variabel AI. Kosongkan `AI_AGENT` dan `ANTHROPIC_BASE_URL` yang disuntik harness untuk run `test:e2e:m2`/`m3`/`m4`. Jangan melemahkan assertion env.
- Port E2E terpakai: 3000–3014. Port 3015 dicadangkan untuk T23. Pakai **3016** untuk config gate.
- Jangan mem-pipe suite pnpm ke `Select-Object -First` (membunuh proses); tangkap dengan `Out-String`. Untuk file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch`, branch, dan HEAD. Working tree hanya boleh berisi `.claude/` yang tidak dilacak. Jika ada perubahan lain, **stop**.
- [ ] `pnpm install --frozen-lockfile` dan `pnpm exec supabase migration list --local`. Parity harus **31/31** dengan migration terakhir `20261005090000_t21_cv_export_backend.sql`.
- [ ] Nyalakan dan verifikasi tiga container §4; catat image/versi.
- [ ] Baseline dengan harapan berikut:

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check` | lulus |
  | `pnpm test` | 103 file / 956 test |
  | `pnpm db:test` | 15 file / 1290 assertion |
  | `pnpm test:pdf` | 46 test |
  | `pnpm test:integration:cv-export` | 35 test |
  | `pnpm test:e2e:cv-export` | 12 test |

- [ ] Receipt `M4-gate-phase0-baseline.md`. Commit `docs(m4): add phase 0 baseline receipt`.

### Fase 1 — Audit acceptance T18–T22 (read-only)

- [ ] Untuk setiap baris §3: baca acceptance di rencana dan di plan task (`T18`–`T22-implementation-plan.md` §1), baca bukti, lalu tandai **Terbukti / Terbukti sebagian / Tidak terbukti**. Setiap tanda wajib merujuk test atau bagian bukti yang konkret (file:line atau nama test).
- [ ] Petakan F07 langkah 1–6, S13 (semua state yang diwajibkan Wireframe), dan S14 ke langkah UI dan test yang ada. Flow atau cabang recovery yang belum pernah diuji lintas lapis menjadi kandidat skenario Fase 3/4.
- [ ] Petakan tiga skenario rilis PRD (§0) ke bukti yang ada dan yang akan dibuat gate.
- [ ] Kumpulkan semua P3 terbuka (§3) dan acceptance "tidak dijalankan" dari bukti T18–T22 ke satu tabel. Klasifikasikan ulang dengan alasan; khususnya T20 F1/F2 terhadap WCAG 2.2 AA (2.4.3, 1.4.10) dan T22 N6 terhadap kriteria §1.9.
- [ ] Receipt `M4-gate-phase1-acceptance-audit.md` berisi matriks acceptance × bukti, peta F07/S13/S14, dan daftar celah.

### Fase 2 — Review kode lintas domain (read-only)

Baca kode nyata, bukan hanya test. Checklist minimum:

- [ ] **Ownership.** Service di `src/features/cv`, route `src/app/(workspace)/cv/**` dan `src/app/api/cv/**`, serta worker export mengambil actor dari sesi atau dari baris job, bukan dari payload. Setiap RPC CV memeriksa `auth.uid()` dan composite FK `(user_id, …)`. Grep `getSupabaseAdminClient`/secret key di jalur CV: hanya penerbitan signed URL dan worker.
- [ ] **Lock protocol (decision 0026).** Urutan profil → dokumen → item → sumber kanonik dipakai sama di `select_cv_source`, `save_cv_edits`, `resolve_cv_freshness`, `request_cv_export`, dan semua jalur delete/edit sumber (`delete_experience`, `delete_project`, `delete_achievement`, `internal.delete_foundation_record`, reopen achievement, relink project/activity). Cari jalur mutasi sumber yang **tidak** menaikkan revision CV atau tidak memakai `internal.cv_lock_for_source_change` padahal mengubah tampilan item.
- [ ] **Satu definisi.** Readiness S14, review S13, check Dashboard, dan `request_cv_export` memakai `internal.cv_item_state`/`cv_profile_state`/`cv_export_blockers` yang sama. Tidak ada aturan freshness tiruan di TypeScript yang dapat menyimpang.
- [ ] **Snapshot dan worker.** Worker export hanya membaca `get_cv_export_input`, tidak pernah tabel karier atau CV. Snapshot `cv-export.v1` tidak memuat field privat (evidence, `credential_url` bila kebijakan T21 menolaknya, id internal yang tidak perlu). Template escape semua teks dan tanpa hyperlink/resource.
- [ ] **Preview = export.** `buildCvPreviewModel` (S13/S14) dan `buildExportRenderModel` (worker) menghasilkan urutan dan teks yang sama untuk revision yang sama. Catat setiap perbedaan yang disengaja.
- [ ] **Error contract.** Setiap error CV punya `code`, pesan terlokalisasi en/id, dan correlation ID. Tidak ada pesan yang membedakan "tidak ada" dan "milik akun lain".
- [ ] **Logging.** Grep `console.`/logger di `src/` dan `workers/`: tidak ada teks CV, wording, nama, object key, attempt token, atau isi PDF.
- [ ] **AI-free.** Tidak ada import `src/server/ai` di jalur CV/export.
- [ ] Receipt `M4-gate-phase2-code-review.md` berisi temuan terklasifikasi P0–P3 dengan file:line.

### Fase 3 — E2E journey F07 (kriteria §1.1, §1.2, §1.5, §1.7, §1.9)

- [ ] Buat `playwright.m4.config.ts` dengan menyalin `playwright.cv-export.config.ts`: PORT **3016**, `testMatch: "m4-cv-journey.spec.ts"`, workers 1, timeout ≥ 300 detik. Web server tanpa env `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`.
- [ ] Tambahkan script `"test:e2e:m4": "playwright test --config playwright.m4.config.ts tests/e2e/m4-cv-journey.spec.ts"`.
- [ ] Tulis `tests/e2e/m4-cv-journey.spec.ts`. Pakai ulang helper `tests/e2e/helpers/{accessibility,export-worker}.ts`, `tests/evidence-fixtures.ts`, dan pola pembuatan/pembersihan akun `tests/e2e/cv-export.spec.ts`. User dibuat via admin dan dihapus pada `afterAll`. Ekstraksi teks PDF unduhan memakai pdf.js legacy build seperti `tests/pdf/pdf-layout.ts`.

  Seluruh langkah berikut dikerjakan **lewat UI**, kecuali pembuatan akun, drain worker, dan pemajuan waktu lewat SQL admin:

  1. **Graduate (skenario rilis PRD), keyboard saja:** onboarding hanya display name → S12 tambah education → `/projects/new` project akademik `completed` → Quick log note → derived achievement → confirm (tanpa metrics/evidence).
  2. **Entry S04:** check Dashboard *confirmed achievement not on CV* = 1 → tautan membuka S13. Confirm tidak memasukkan achievement ke CV secara otomatis.
  3. **S13:** pilih achievement → project parent ikut terpilih (child memasukkan parent). Pilih education. Ganti label CV ke Bahasa Indonesia sementara UI tetap English. Override wording achievement dengan teks berkarakter Indonesia (`Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`). Pindahkan urutan dengan kontrol move. Save.
  4. **S14:** *Saved revision N* sama dengan S13 → *Export PDF* → worker renderer nyata → halaman PDF tampil → *Download PDF* dengan keyboard.
  5. **PDF yang diunduh:** `%PDF-`, A4, teks ekstraksi memuat nama, heading section Indonesia, education, project, wording override (bukan teks sumber), dan karakter Indonesia; tanpa evidence. Simpan sha256 sebagai **PDF-1**.
  6. **Entry S08 dan freshness:** dari detail achievement kedua (confirmed) klik *Add to CV* → S13 menyorot kandidat → pilih → Save. Edit achievement pertama di S08 → S13 *changed* → *Keep my wording* (override tetap) → S14 siap → export → **PDF-2** memuat override yang sama.
  7. **Skenario rilis delete:** hapus achievement kedua di S07 → S14 blocker `ITEM_DELETED` dengan tautan ke S13 → *Remove* di S13 → Save → export → **PDF-3**.
  8. **PDF lama tidak berubah:** unduh ulang export PDF-1 dari riwayat S14 → sha256 identik dengan PDF-1.
  9. **Gagal → Retry → Regenerate dengan keyboard (T22 N6):** renderer fake gagal → *Retry* (Enter) → renderer nyata → sukses. Majukan `expires_at` lewat SQL admin → *Regenerate* (Enter) → export baru.
  10. **Isolasi:** login sebagai akun B → `/cv`, `/cv/preview`, `GET /api/cv/exports/<id A>`, dan action unduhan dengan id A → kosong/404 generik; Dashboard B tidak memuat judul A.
  11. **Aksesibilitas:** `expectNoWcagViolations` pada S13 (selection, review *changed*, override) dan S14 (siap, terblokir, sukses dengan halaman PDF). Satu pass 360 × 800 dark tanpa overflow horizontal pada S13 dan S14. Fokus kembali ke tombol aksi atau status setelah setiap aksi.
  12. **AI-free:** pada setiap halaman journey, `getByText(/analyz|menganalisis|AI suggestion|saran AI/i)` berjumlah 0, kecuali copy yang secara eksplisit menyatakan AI tidak dipakai.

- [ ] Jalankan hingga lulus. Kegagalan karena bug produk = temuan (klasifikasikan). Jangan melemahkan asersi.
- [ ] Commit `test(m4): add F07 cross-domain CV journey`.
- [ ] Receipt `M4-gate-phase3-cv-journey.md` berisi hasil, jumlah halaman dan sha256 PDF-1/2/3 (bukan isinya), dan screenshot `testInfo.attach` (jalankan sekali dengan `--reporter=html` dan `PLAYWRIGHT_HTML_OPEN=never`). Jangan menulis ke `docs/verification/T22-screenshots/`.

### Fase 4 — Integration lintas domain (kriteria §1.2–§1.8)

- [ ] Buat `tests/integration/m4-cv-output.test.ts` dengan pola `tests/integration/cv-export.test.ts` dan `cv-export-support.ts` (admin + owner A + owner B lewat sign-in nyata, service layer nyata, worker export nyata, `sql()` untuk pemajuan waktu). Tambahkan script `"test:integration:m4": "vitest run --config vitest.integration.config.ts --configLoader native tests/integration/m4-cv-output.test.ts"`.
- [ ] Setiap skenario mengukur **sebelum dan sesudah** mutasi lewat `getReadiness()`, `getFreshness()`/`get_cv_review_summary`, `getDashboard()` (check CV), dan snapshot/objek export:
  1. **Provenance import:** commit batch import (pola `tests/integration/m3-assisted-entry.test.ts`) dengan experience dan achievement confirmed → pilih ke CV → export. Majukan `expires_at` batch dan jalankan `purge_expired_import_batches` → item CV, readiness, dan snapshot export tidak berubah; achievement masih punya excerpt.
  2. **Delete activity sumber** achievement turunan terpilih → achievement tetap confirmed dengan source excerpt/revision; item CV tidak menjadi deleted; snapshot dan sha256 objek export lama tetap.
  3. **Override + edit sumber + refresh:** override → edit sumber → `changed` → refresh semua tanpa override tidak menyentuh item ber-override → *Replace from source* → export baru memuat teks sumber; snapshot export sebelumnya tetap memuat override.
  4. **Delete sumber** (achievement, project parent, experience, education, skill, certification; satu per sub-kasus) → `ITEM_DELETED` di readiness, review, Dashboard, dan `request_cv_export` (`EXPORT_BLOCKED`) → remove → siap. Record canonical lain tidak terhapus.
  5. **Reopen confirmed → draft** → `ITEM_UNCONFIRMED` di semua lapis → confirm ulang → status sesuai decision 0026 → export.
  6. **Relink project ke experience lain** setelah achievement kontekstual terpilih → parent ditambahkan sesuai aturan T20 → PDF tidak merender achievement ganda dan konteks sesuai snapshot baru.
  7. **Evidence:** achievement dan project terpilih masing-masing punya evidence `ready` (ClamAV nyata) → snapshot dan teks PDF (renderer nyata) tanpa nama file evidence, object key, URL, atau `credential_url`.
  8. **Profil:** ubah display name dan kontak → `PROFILE_CHANGED` → *Keep saved wording* lalu export memakai nama tersimpan; edit kedua membatalkan acknowledgement.
  9. **Export berjalan saat edit:** request export → edit sumber dan Save CV sebelum worker berjalan → worker merender snapshot lama; revision export ≠ revision CV; S14 menandai *Earlier revision*.
  10. **Tanpa AI:** adapter AI fake penghitung terpasang di worker selama skenario 1–9 → 0 panggilan.
  11. **Multipage dan searchable:** fixture panjang (≥ 12 achievement, bullet ≥ 600 karakter) dengan locale `id` → renderer nyata → 2–20 halaman, A4, teks ekstraksi memuat awal/akhir bullet panjang dan heading Indonesia.
  12. **Isolasi:** untuk setiap service, action, dan route CV/export, sesi B dengan ID milik A menghasilkan hasil kosong atau error yang sama dengan ID acak; signed URL untuk key A tidak dapat diterbitkan untuk B; `reconcile_orphan_export_objects` tidak menyentuh objek A yang masih dimiliki baris hidup.
- [ ] Jalankan hingga lulus. PDF lama berubah, export lolos dengan blocker, atau karya hilang adalah **P0/P1**; jangan ubah expectation.
- [ ] Commit `test(m4): add CV output cross-domain integration`.
- [ ] Receipt `M4-gate-phase4-cross-domain.md`.

### Fase 5 — Regresi penuh

- [ ] Jalankan seluruh §7 dan catat angka aktual. Suite evidence dengan ClamAV nyata, import dengan Gotenberg nyata, dan CV export/PDF dengan renderer nyata.
- [ ] Untuk kegagalan: rerun sekali. Jika lulus saat rerun, catat sebagai flaky beserta pesan error dan dugaan penyebab (P3 kecuali menyentuh acceptance). Jika gagal konsisten, jadikan temuan. Flaky bawaan `activity-ui.spec.ts:356` dicatat sebagai flaky bila lulus saat diulang tanpa perubahan.
- [ ] Periksa `git status`: suite E2E T22 tidak boleh meninggalkan screenshot ter-track yang berubah (T22 N3). Bila berubah, kembalikan dengan `git restore docs/verification/T22-screenshots` dan catat.
- [ ] Receipt `M4-gate-phase5-regression.md`.

### Fase 6 — Perbaikan P0–P2 dan laporan draft

- [ ] Untuk setiap P0–P2 dari Fase 1–5: tulis test gagal, perbaiki minimal, jalankan ulang suite domain terkait serta `test:e2e:m4`/`test:integration:m4`. Satu commit per temuan: `fix(m4): <ringkas>`. Perbaikan yang memerlukan migration atau perubahan kontrak RPC → **stop** dan laporkan (§6).
- [ ] Petakan skenario rilis PRD (`IMPLEMENTATION_PLAN.md` §6) yang relevan untuk M4 ke bukti:
  - graduate tanpa CV/employment → Fase 3 langkah 1–5;
  - CV override diikuti update/delete sumber → Fase 3 langkah 6–7, Fase 4 skenario 3–4;
  - ownership dua akun dan PDF multipage → Fase 3 langkah 10, Fase 4 skenario 11–12;
  - export bersamaan mutasi sumber → bukti race T21 + Fase 4 skenario 9.
- [ ] Susun laporan draft `docs/verification/M4-gate-review.md` dengan pola `M3-gate-review.md`:
  - ringkasan;
  - matriks kriteria §1 (PASS/FAIL + bukti);
  - matriks acceptance T18–T22;
  - temuan per level dengan status (fixed/open);
  - tabel command dan hasil;
  - flaky, tidak dijalankan beserta alasan, dan batas (lokal saja, bukan production).
- [ ] **Jangan** menulis verdict atau mengubah `IMPLEMENTATION_STATUS.md`/`AGENTS.md`.
- [ ] Commit `docs(m4): add draft gate report`. Berhenti dan serahkan hash commit, receipt Fase 0–6, dan laporan draft kepada Claude.

### Fase 7 — Verdict (Claude)

- [ ] Verifikasi ulang secara independen:
  - baca diff test gate dan perbaikan;
  - jalankan ulang minimal `test:e2e:m4`, `test:integration:m4`, `test:pdf`, gate dasar, dan suite yang disentuh perbaikan;
  - buka sendiri screenshot dan PDF journey.
- [ ] Tetapkan verdict di `M4-gate-review.md`: **PASSED** hanya bila semua kriteria §1 PASS dan tidak ada P0–P2 terbuka. Selain itu **BLOCKED**, disertai daftar kerja konkret.
- [ ] Update `IMPLEMENTATION_STATUS.md`: tambahkan bagian "Gate M4" di atas dengan verdict, bukti, dan langkah berikutnya (T23 bila PASSED; handoff `T23-implementation-plan.md` sudah tersedia). Perbarui snapshot di `AGENTS.md` dan `docs/AGENTS.md` (keduanya harus identik); ganti kalimat "Langkah berikutnya adalah Gate M4 …" yang kini usang. Riwayat lama dibiarkan.
- [ ] Commit `docs(m4): record gate review verdict`.

## 6. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree berisi perubahan pengguna selain `.claude/` pada Fase 0, atau parity migration ≠ 31/31.
- Penyelesaian membutuhkan `db reset`, mengedit migration lama, migration baru, perubahan kontrak RPC, atau operasi destruktif.
- Renderer PDF, ClamAV, atau Gotenberg tidak dapat dijalankan lokal. Tandai kriteria terkait **tidak terbukti** dan jangan memakai fake untuk bukti tersebut.
- Temuan P0 (kebocoran owner, PDF berisi data akun lain atau evidence, kehilangan data). Laporkan segera sebelum memperbaiki bila perbaikan memerlukan migration atau mengubah kontrak.
- Perbaikan terasa memerlukan fitur baru, AI, perubahan aturan Retry/retensi snapshot (T23), atau perubahan scope produk.
- Test apa pun memerlukan layanan eksternal, key nyata, atau deployment, atau sentinel/teks CV muncul di log atau respons akun lain.
- Suite lama (T02–T22, M2, M3) perlu diubah agar lulus.

## 7. Commands

Jalankan melalui pnpm. Catat command, exit code, dan angka aktual. Integration/E2E memerlukan `SUPABASE_SECRET_KEY` dan `.env.local` di environment proses (§4).

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
pnpm test:pdf
pnpm test:integration:m4
pnpm test:integration:cv-export
pnpm test:integration:cv-freshness
pnpm test:integration:cv-builder
pnpm test:integration:cv
pnpm test:integration:achievements
pnpm test:integration:projects
pnpm test:integration:activity
pnpm test:integration:dashboard
pnpm test:integration:import-commit
pnpm test:integration:import-review
pnpm test:integration:import
pnpm test:integration:m2
pnpm test:integration:m3
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:m4
pnpm test:e2e:cv-export
pnpm test:e2e:cv-freshness
pnpm test:e2e:cv
pnpm test:e2e:achievements
pnpm test:e2e:projects
pnpm test:e2e:dashboard
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:import
pnpm test:e2e:import-review
pnpm test:e2e:ai
pnpm test:e2e:ai-review
pnpm test:e2e:evidence
pnpm test:e2e:m2
pnpm test:e2e:m3
pnpm worker:check
pnpm build
git diff --check
```

`test:integration:m4` dan `test:e2e:m4` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `test:e2e:evidence` juga menjalankan ulang spec activity/projects/achievements pada port 3004.

## 8. Review focus — risiko yang paling mungkin lolos

1. **PDF lama yang diam-diam berubah.** Objek export ditimpa, key dipakai ulang, atau unduhan riwayat memanggil render baru. Dijaga oleh sha256 PDF-1 di Fase 3 langkah 8 dan Fase 4 skenario 2–3.
2. **Jalur mutasi sumber yang tidak menyentuh CV.** Satu jalur edit/delete/reopen/relink lupa memakai lock CV atau menaikkan revision, sehingga S14 siap padahal item seharusnya terblokir. Dijaga oleh review Fase 2 (daftar semua jalur) dan Fase 4 skenario 4–6.
3. **Preview dan PDF menyimpang.** `buildCvPreviewModel` dan `buildExportRenderModel` berbeda urutan atau teks (override, parent, standalone). Dijaga oleh review Fase 2 dan asersi teks Fase 3 langkah 5.
4. **Evidence atau data privat masuk PDF.** Nama file, URL, atau `credential_url` lolos lewat snapshot. Dijaga oleh Fase 4 skenario 7 dengan renderer nyata.
5. **Gate "lulus" karena test lemah.** Renderer fake dipakai diam-diam, ekstraksi teks hanya mengecek keberadaan file, atau isolasi hanya menguji satu route. Dijaga oleh env per proses, asersi teks, dan daftar route di Fase 4 skenario 12.
6. **WCAG yang tertinggal sebagai P3.** Fokus hilang setelah konflik (T20 F1) dan reflow 360 px (T20 F2) sebenarnya pelanggaran AA. Dijaga oleh klasifikasi ulang Fase 1 dan Axe/keyboard Fase 3.

## 9. Prompt untuk memulai sesi baru

```text
Jalankan integration review Gate M4 WorkPulse sesuai handoff
docs/verification/M4-gate-review-plan.md. Baca handoff itu sampai selesai,
lalu AGENTS.md, entry T18–T22 di docs/IMPLEMENTATION_STATUS.md,
IMPLEMENTATION_PLAN.md §3 (CV), §5 (M4), §6, dan decision 0024–0028.

Kerjakan Fase 0–6 berurutan dan tulis receipt tiap fase. Jangan menambah
fitur; perbaiki hanya temuan P0–P2 dengan TDD. Pakai renderer PDF
workpulse-t21-pdf, ClamAV, dan Gotenberg nyata; jangan memakai fake untuk
bukti gate. Jangan db reset dan jangan membuat migration. Ambil
SUPABASE_SECRET_KEY lokal ke environment proses saja, jangan tulis ke file.
Patuhi stop conditions §6. Berhenti setelah Fase 6; verdict Gate M4 dan
status authoritative hanya ditulis oleh Claude pada Fase 7.
```
