# Handoff Gate M5 — integration review Pilot readiness

> **Untuk agen pelaksana:**
> - Kerjakan fase berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Ini **review gate**, bukan task fitur. Jangan menambah fitur.
> - Perbaikan hanya untuk temuan P0–P2 dan wajib memakai TDD: tulis test gagal → jalankan → perbaiki minimal → jalankan ulang → commit.
> - Jangan membuat sub-agent. Bila ragu, baca §6 (stop conditions) sebelum berimprovisasi.
> - Nama file test, script, config, dan port di dokumen ini **dibekukan**.

- Tanggal: 20 Oktober 2026
- Status saat handoff ditulis: Gate M5 **terbuka**. T23 dan T24 **DONE** lokal. T25 **PARTIAL** (bukti lokal lulus; staging sebagian; retensi backup belum terverifikasi). Pekerjaan pasca-rencana yang masuk pilot: batas pemakaian AI (decision 0032) dan T26 import tanpa AI (decision 0033), keduanya **DONE** lokal dan sudah di `main`. T27 (bottom tab bar mobile) masih **TODO** di branch `claude/t27-mobile-tab-bar`.
- Baseline: `origin/main`, HEAD minimal `181103f Merge pull request #29`. Migration terakhir `20261019090000_t26_import_rules_extraction.sql` (ke-38).
- Pelaksana: satu agent **Claude** di sesi baru. Berhenti setelah Fase 7 dan serahkan receipt.
- Pemberi keputusan: **Claude** (Opus). Hanya reviewer yang menulis verdict Gate M5 (Fase 8) dan bagian authoritative `IMPLEMENTATION_STATUS.md`.
- Acuan:
  - `IMPLEMENTATION_PLAN.md` §1, §3, §5 (T23–T25 dan kalimat **Gate M5**), §6 (matriks R01–R10 dan enam skenario rilis), §8.
  - PRD §2 R01–R10, §4 *Reliability and release validation*, *Release scenarios*, §5 tabel milestone M5, *Pilot measures*.
  - User Flow F01–F07. Wireframe S01–S14. Database Schema §6.
  - Decision 0029–0033. `T25-release-checklist.md`, `T25-release-handoff.md`, `T25-release-matrix.md`, `T25-phase7-staging.md`, `T25-phase7b-review.md`, `T25-backup-runbook.md`, `T24-pilot-metrics-runbook.md`. `AGENTS.md`.

**Tujuan:** membuktikan kalimat gate di `IMPLEMENTATION_PLAN.md:299`:

> Gate M5: seluruh acceptance lulus. Target pilot 60% activation, 40% value completion, 30% return capture dan 98% export reliability baru dievaluasi dari 20 consenting pilot users; bukan syarat metrik yang bisa dibuktikan sebelum pilot berjalan.

Kriteria milestone PRD M5 *Pilot*: *Instrumentation, access review, deletion, regression and usability review. All R01–R10 conditions pass; no critical privacy or data loss defects.*

Setiap task M5 sudah lulus per lapis, dan Gate M2–M4 sudah PASSED. Gate ini menguji tiga hal yang belum pernah diuji bersama:

- satu akun pilot menjalani seluruh siklus hidup produk, dari daftar sampai penghapusan akun, dengan import tanpa AI (T26), batas AI (0032), event produk (T24), dan purge (T23) dalam satu urutan;
- pekerjaan pasca-rencana (0032, 0033) tidak merusak invariant R01–R10 yang sudah dibuktikan T25: isolasi, katalog, penghapusan, dan aksesibilitas;
- lingkungan pilot memenuhi syarat yang hanya bisa dibuktikan di sana: migration hosted, adapter nyata, dan retensi backup ≤ 30 hari.

---

## 0. Cara memakai handoff ini

1. Baca dokumen ini sampai selesai sebelum menjalankan apa pun.
2. Baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` sampai T23, `IMPLEMENTATION_PLAN.md` §5 M5 dan §6, decision 0029–0033, dan laporan Gate M4 (`M4-gate-review.md`) sebagai pola.
3. Ekstrak dari PRD: R01–R10, §4, *Release scenarios*, tabel milestone, *Pilot measures*. Pakai `python -I` + `zipfile` atas `word/document.xml` (`python-docx` tidak terpasang). Jangan menebak isi DOCX dari nama file.
4. Kerjakan di **worktree baru** dari `origin/main`, bukan di checkout utama. Checkout utama berisi pekerjaan T27 yang belum di-commit. Jangan commit, stash, reset, atau checkout atas nama pengguna selain commit pekerjaan gate sendiri.
5. Pada akhir setiap fase, tulis **receipt** ke `docs/verification/M5-gate-phaseN-<slug>.md` berisi:
   - tujuan dan file berubah;
   - command beserta hasil aktual (exit code dan angka pass/fail);
   - temuan terklasifikasi;
   - blocker dan langkah berikutnya.

   Angka di receipt harus hasil command yang benar-benar dijalankan. Bukti staging yang hanya dilaporkan pengguna ditulis "dilaporkan", bukan "terverifikasi".

Kutipan sumber yang mengikat (parafrase ringkas):

- **PRD §4 Privacy:** akses owner-scoped pada setiap tabel, relasi, operasi worker, dan request file. Key AI hanya di server. Tanpa profil publik atau tautan berbagi.
- **PRD §4 AI disclosure:** jelaskan sebelum aksi AI pertama bahwa teks terpilih dikirim ke pemroses eksternal; catat versi dan waktu consent. Menolak tetap menyisakan entri manual dan edit CV.
- **PRD §4 Data minimization:** kirim hanya teks yang perlu; tanpa evidence. Hapus file import asli dan teks staging dalam 24 jam setelah commit, batal, atau gagal terminal.
- **PRD §4 Deletion:** penghapusan akun mencabut sesi seketika, menghapus data dan objek aktif dalam 24 jam, dan backup kedaluwarsa dalam 30 hari.
- **PRD §4 Performance:** pada dataset staging 1.000 activity, 200 achievement, 50 project: p95 baca dashboard/list < 2 detik, simpan < 1 detik, tanpa network dan AI.
- **PRD §4 Usability:** kontrol dapat diakses keyboard, fokus terlihat, error berlabel, kontras terbaca, layout 360 px dan 1440 px. Isi form bertahan setelah simpan gagal.
- **PRD Pilot measures:** event tanpa teks catatan, teks CV, nama file, atau isi lampiran. Target adalah hipotesis, ditinjau ulang setelah 20 pengguna pilot yang consent.
- **Rencana T25 (kalimat selesai):** R01–R10 lulus dengan bukti, tidak ada defect kritis privasi/kehilangan data, integrasi nyata diverifikasi di staging. Publish production butuh environment dan otorisasi tersendiri.

## 1. Kriteria lulus Gate M5

Gate M5 **lulus** hanya jika semua poin berikut terbukti. Poin 1–10 dibuktikan lokal oleh pelaksana. Poin 11–13 dibuktikan di lingkungan pilot oleh operator atau pemilik produk dan diperiksa reviewer.

1. **R01–R10 lulus.** Matriks `IMPLEMENTATION_PLAN.md` §6 diperbarui: setiap requirement punya bukti test yang masih lulus di HEAD gate, termasuk dampak 0032 dan 0033. Matriks T25 (`T25-release-matrix.md`) menjadi titik awal, bukan pengganti run ulang.
2. **Enam skenario rilis PRD.** Masing-masing dipetakan ke test yang dijalankan di gate, satu per satu. Skenario import CV Indonesia dibuktikan untuk **kedua** mode (`ai` dengan fake provider, `rules` dengan parser aturan).
3. **Siklus hidup akun pilot di browser.** Satu E2E baru lewat UI: daftar → onboarding → import mode `rules` → review dan commit → capture saat AI unavailable → confirm → evidence → CV → export PDF → penghapusan akun → login ditolak. Lihat Fase 3.
4. **Event produk.** Untuk akun journey, `internal.product_events` memuat event yang diharapkan dengan properti allowlist saja (tanpa teks, ID record, nama file). Setelah penghapusan akun, event akun itu hilang. `get_pilot_metrics` menghitung activation, value completion, return capture, dan export reliability dengan benar untuk kohort fixture yang dimajukan waktunya, dan mengabaikan akun non-pilot.
5. **Batas AI dan mode rules.** Import `rules` tidak membuat `ai_jobs`, tidak membebankan unit, dan tidak memerlukan consent. Import `ai` dan analisis tetap membebankan unit dalam transaksi job; batas tercapai menyisakan jalur manual. Penghapusan akun menghapus baris `internal.ai_usage` dan `internal.ai_plan_assignments` milik akun itu.
6. **Penghapusan akun lintas domain.** Akun dengan job import (`rules` dan `ai`), job AI, export aktif, evidence `scanning`, dan reservation aktif dihapus: tidak ada job yang menyelesaikan atau menulis setelah `deleting`, semua prefix Storage kosong, `auth.users`/`profiles` sesuai decision 0029, `get_operational_health` kembali ke 0 untuk `account_deletion_overdue` dan `storage_cleanup_failed`.
7. **Isolasi dan katalog.** `release_catalog.test.sql` dan `test:integration:release` lulus di HEAD gate dan **mencakup** tabel serta RPC baru migration 37–38 (bukan hanya lulus karena daftar statis). Akun B tidak dapat membaca usage, batch import, atau event akun A.
8. **Aksesibilitas dan usability.** `test:e2e:release` lulus (matriks 20 keadaan × 360/1440 × light/dark, teks 200%, keyboard, aria snapshot). Dialog pilihan mode import (T26) dan banner batas AI (0032) diperiksa Axe dan keyboard di 360 px dark. Form yang gagal simpan mempertahankan isi.
9. **Performance lokal.** `pnpm test:perf` dijalankan sendirian dan p95 baca < 2 detik, simpan < 1 detik. Catat lingkungan, sample count, dan warm/cold.
10. **Regresi penuh hijau.** Seluruh suite §7 lulus dengan ClamAV, Gotenberg, dan renderer PDF nyata, clean rebuild 38 migration lulus, tanpa melemahkan assertion. Flaky dicatat dengan bukti rerun dan penyebab.
11. **Lingkungan pilot sejalan dengan HEAD gate.** Parity migration hosted **38/38**; web dan worker memakai image dengan tag `sha-<commit>` yang memuat HEAD gate (bukan tag `main` yang dapat berubah); smoke §8 runbook diulang termasuk import mode `rules`; scanner dan renderer nyata.
12. **Retensi backup ≤ 30 hari terverifikasi.** `backup.sh` hasil RV-B1 terpasang; dua baris `backup: ok` dari cron pada dua hari berbeda tercatat ([runbook backup](T25-backup-runbook.md) §4 langkah 4); BLOCKER retensi di checklist dinilai ulang. Tanpa ini Gate M5 **tidak boleh** PASSED (`IMPLEMENTATION_STATUS.md`, entry T25).
13. **Tidak ada temuan P0–P2 terbuka**, lokal maupun lingkungan pilot. P3 dicatat sebagai follow-up.

Gate M5 **tidak** mencakup:

- Evaluasi target pilot 60/40/30/98%. Itu pasca-pilot dari 20 pengguna consenting (`T24-pilot-metrics-runbook.md`).
- Publish production: otorisasi deploy tertulis, domain production, paket hosted production. Item BLOCKER production di `T25-release-checklist.md` §1 yang khusus production tetap terbuka dan tidak menghalangi verdict gate, tetapi wajib disebut di laporan.
- Pemeriksaan NVDA oleh manusia. Dicatat sebagai keterbatasan bila belum ada; menjadi P2 hanya jika pengguna menjalankannya dan menemukan pelanggaran.
- T27, kecuali T27 sudah DONE dan di-merge ke `main` sebelum Fase 0 (§2.2 butir 2).

## 2. Scope

### 2.1 Dalam scope

- Audit acceptance T23–T25, batas AI (0032), dan T26 terhadap bukti yang ada, termasuk klasifikasi ulang P3 terbuka.
- Review kode lintas domain (read-only) dengan fokus pada sambungan pasca-rencana ke invariant M5.
- Satu E2E journey baru dan satu integration lintas domain baru.
- Regresi seluruh suite lokal, clean rebuild, dan `test:perf`.
- Daftar periksa lingkungan pilot untuk operator; reviewer memeriksa receipt-nya.
- Perbaikan minimal untuk P0–P2 dengan test regresi.
- Laporan gate draft; verdict dan status authoritative oleh Claude.

### 2.2 Keputusan yang dibekukan

1. **Gate dijalankan di worktree baru dari `origin/main`.** Alasan: checkout utama berisi T27 yang sedang dikerjakan dan test yang belum di-commit; gate tidak boleh menyentuhnya.
2. **T27 di luar gate secara default.** Bila T27 sudah DONE dan di-merge sebelum Fase 0, pelaksana menambahkannya ke tabel §3 sebagai pasca-rencana dan baseline unit berubah sesuai receipt T27. Bila belum, gate tetap jalan; T27 nanti cukup lulus `test:e2e:release` dan `test:e2e:m5` sebelum merge.
3. **Verdict dua tingkat tidak dipakai.** Hanya **PASSED** atau **BLOCKED**. Bila poin 1–10 dan 13 lulus tetapi 11 atau 12 belum, verdict **BLOCKED** dengan satu-satunya daftar kerja berupa item lingkungan pilot. Alasan: kalimat status T25 sudah menetapkan retensi backup sebagai syarat.
4. **Lingkungan pilot = staging server pribadi (T25 Fase 7b).** Pendaftaran pilot terbuka di sana (decision 0032). Bila pemilik produk memindahkan pilot ke lingkungan lain, poin 11–12 dibuktikan ulang di lingkungan baru.
5. **Mode AI di lingkungan pilot tidak diuji live.** Smoke memakai `WORKPULSE_AI_MODE=unavailable` atau mode yang sudah diputuskan tertulis oleh pemilik produk. Bila aktif, satu smoke `analysis` dengan key staging yang disetujui dan unit terbebankan; selain itu tidak ada panggilan provider.
6. **Port E2E gate: 3018.** 3000–3017 terpakai (`playwright.release.config.ts` memakai 3017).

### 2.3 Di luar scope

- Fitur baru, refactor, perubahan copy/desain non-P0–P2.
- Migration, kecuali perbaikan P0/P1 yang memerlukannya. Itu wajib decision baru (nomor berikutnya **0035**; 0034 dipakai T27) dan persetujuan reviewer; pelaksana **stop** lebih dulu.
- Mengubah angka batas AI, kontrak `extraction_mode`, aturan retry export, atau retensi snapshot.
- Deploy, migrasi hosted, atau akses server oleh pelaksana. Semua aksi lingkungan pilot dikerjakan operator; pelaksana hanya menyiapkan daftar periksa dan query read-only.
- `db reset` database lokal aktif.

### 2.4 Klasifikasi temuan

| Level | Arti | Contoh | Tindakan |
| --- | --- | --- | --- |
| P0 | Kebocoran data/owner, kehilangan data, data tersisa setelah penghapusan akun | Akun B membaca usage A; objek Storage tersisa setelah purge; event memuat teks catatan | Stop, laporkan, perbaiki, uji ulang |
| P1 | Siklus hidup akun tidak dapat diselesaikan atau invariant rusak | Job import `rules` menulis setelah `deleting`; unit AI dibebankan untuk `rules`; backup > 30 hari | Perbaiki sebelum lulus |
| P2 | Acceptance tidak terpenuhi, pelanggaran WCAG 2.2 AA, atau lingkungan pilot tidak sejalan dengan HEAD | Dialog mode import tanpa fokus awal; parity hosted 36/38; metrik salah hitung | Perbaiki sebelum lulus |
| P3 | Kosmetik, copy, flaky yang sudah dipahami, tech debt, dokumen basi | Baris basi di receipt; biaya query | Catat sebagai follow-up |

## 3. Input yang harus diaudit

| Paket | Acceptance (ringkas) | Bukti |
| --- | --- | --- |
| T23 | Worker restart tidak kehilangan cleanup; akun terhapus tidak dapat retry job; antrean bertahan setelah FK hilang; bukti retensi tercatat | `T23-account-deletion-retention.md`, `T23-gate-review.md`, decision 0029 |
| T24 | Event menghitung activation 24 jam, value completion 7 hari, return capture 28 hari, export reliability; p95 di bawah target; target disebut hipotesis | `T24-instrumentation-performance.md`, `T24-gate-review.md`, `T24-perf-results.json`, decision 0030 |
| T25 | R01–R10 lulus dengan bukti; tanpa defect kritis privasi/data; integrasi nyata di staging | `T25-release-handoff.md`, `T25-release-matrix.md`, `T25-review-remediation-plan.md`, `T25-phase7-staging.md`, `T25-phase7a-review.md`, `T25-phase7b-review.md`, decision 0031 |
| Batas AI | Unit dibebankan dalam transaksi job; batas harian/bulanan/kapasitas; S06/S02 menampilkan batas dan jalur manual | `ai-usage-limits.md`, `ai-usage-limits-gate-review.md`, decision 0032 |
| T26 | Import tanpa consent lewat parser aturan; tanpa `ai_jobs` dan unit; grounding sama dengan AI; dialog pilihan netral | `T26-import-rules-extraction.md`, `T26-gate-review.md`, decision 0033 |

P3 dan celah terbuka yang wajib masuk tabel Fase 1 dan diklasifikasi ulang:

- **T25:** N3 (assertion insert belum spesifik `42501`), N5 (skenario 2/3 sebagai rangkaian test), N6 (NVDA), O1–O13 di receipt fase, khususnya O3 (akun `wp-*` suite lama bocor).
- **T25 Fase 7b:** B3 (margin umur prune), B5 (baris basi receipt), B6 (recovery Gmail belum terikat image), B7 (nilai yang hanya dilaporkan); status pemasangan RV-B1 di server.
- **T25 checklist §3:** cleanup setelah restore hosted, p95 staging, kanal notifikasi `ops:check`.
- **Batas AI:** lima P3 di `ai-usage-limits-gate-review.md`; staging belum dimigrasi.
- **T26:** N1–N7 di `T26-gate-review.md`, khususnya N2 (migration dan worker harus dideploy bersamaan).
- **T23/T24:** P3 di gate review masing-masing.

`T25-release-checklist.md` sebagian basi (masih menyebut staging BLOCKED, padahal Fase 7b sudah ada). Fase 1 mencatat baris mana yang basi; pembaruan isinya dikerjakan reviewer di Fase 8.

## 4. Environment

- Supabase lokal via Docker harus aktif. Jangan `db reset`. Bila `db:start`/`db:status` dipakai, saring output-nya karena memuat key lokal.
- `.env.local` **tidak** memuat `SUPABASE_SECRET_KEY`. Ambil nilai lokal ke environment proses saja; jangan tulis ke file, log, atau receipt. Di mesin ini pakai `SERVICE_ROLE_KEY` (JWT) bila key format baru ditolak Kong:

  ```powershell
  $st = pnpm exec supabase status -o env 2>$null
  $line = $st | Where-Object { $_ -match '^SERVICE_ROLE_KEY=' }
  $env:SUPABASE_SECRET_KEY = ($line -replace '^[A-Z_]+="?','' -replace '"$','')
  ```

  Setiap panggilan tool PowerShell adalah proses baru, jadi ulangi baris ini (dan muat `.env.local`) dalam command yang sama dengan test.
- Container nyata: renderer PDF `workpulse-t21-pdf` (`127.0.0.1:13401`), ClamAV `workpulse-t10-clamav` (`127.0.0.1:13310`), Gotenberg `workpulse-t15-gotenberg` (`127.0.0.1:13400`). Periksa `docker ps` dulu; bila mati, `docker start` (jangan buat ulang bila sudah ada). Jangan hentikan container mana pun di akhir gate. Env URL renderer hanya di proses suite yang membutuhkannya.
- Tidak ada variabel AI di proses web E2E. Kosongkan `AI_AGENT` dan `ANTHROPIC_BASE_URL` yang disuntik harness. `.env.ai.local` tidak boleh dibaca suite gate.
- Port E2E gate **3018**.
- Jangan mem-pipe suite pnpm ke `Select-Object -First` (membunuh proses); tangkap dengan `Out-String`. Untuk file ber-karakter non-ASCII gunakan tool Edit, bukan `Set-Content`.
- `pnpm test:perf` dijalankan sendirian, tanpa suite lain, `next build`, atau `next dev` di checkout yang sama. Arahkan `WORKPULSE_PERF_OUT` ke scratchpad agar `T24-perf-results.json` tidak berubah.
- Clean rebuild memakai stack sekali pakai seperti `T25-phase5-rebuild-build.md`, bukan database lokal aktif.

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Buat worktree baru dari `origin/main`. Catat `git status --short --branch`, branch, dan HEAD (minimal `181103f`). Working tree harus bersih. Catat apakah T27 sudah di `main` (§2.2 butir 2).
- [ ] `pnpm install --frozen-lockfile` dan `pnpm exec supabase migration list --local`. Parity harus **38/38** dengan migration terakhir `20261019090000_t26_import_rules_extraction.sql`.
- [ ] Nyalakan dan verifikasi tiga container §4; catat image/versi.
- [ ] Baseline dengan harapan berikut (angka dari gate review T26, 20 Oktober 2026; bila T27 sudah di `main`, angka unit mengikuti receipt T27):

  | Command | Harapan |
  | --- | --- |
  | `pnpm lint`, `pnpm typecheck`, `pnpm worker:check`, `pnpm db:lint` | lulus |
  | `pnpm test` | 121 file / 1151 test |
  | `pnpm db:test` | 21 file / 1725 assertion |
  | `pnpm test:integration:release` | 12 test |
  | `pnpm test:integration:account-deletion` | 15 test |
  | `pnpm test:e2e:release` | 15 test |

- [ ] Receipt `M5-gate-phase0-baseline.md`. Commit `docs(m5): add phase 0 baseline receipt`.

### Fase 1 — Audit acceptance (read-only)

- [ ] Untuk setiap baris §3: baca acceptance di rencana dan plan task (`T23`–`T26-implementation-plan.md` §1, rencana batas AI), baca bukti, lalu tandai **Terbukti / Terbukti sebagian / Tidak terbukti**. Setiap tanda wajib merujuk test atau bagian bukti konkret (file:line atau nama test).
- [ ] Perbarui matriks R01–R10 (`IMPLEMENTATION_PLAN.md` §6) ke HEAD gate: kolom tambahan "dampak 0032/0033" dan "test di gate". Requirement yang disentuh 0032/0033 (R02, R04, R05, R01 lewat penghapusan) wajib punya bukti pasca-perubahan.
- [ ] Petakan enam skenario rilis PRD (§0) dan empat skenario lintas subsistem rencana §6 (export bersamaan mutasi sumber, penarikan consent, lease expiration, cleanup setelah penghapusan akun) ke bukti yang ada dan yang akan dibuat gate.
- [ ] Kumpulkan semua P3 dan celah terbuka (§3) ke satu tabel. Klasifikasikan ulang dengan alasan. Khususnya: T25 O3 terhadap privasi fixture, B6 terhadap poin §1.11, dan T26 N2 terhadap urutan deploy lingkungan pilot.
- [ ] Catat baris basi di `T25-release-checklist.md` dan `T25-release-handoff.md`.
- [ ] Receipt `M5-gate-phase1-acceptance-audit.md` berisi matriks acceptance × bukti, matriks R01–R10, peta skenario, dan daftar celah.

### Fase 2 — Review kode lintas domain (read-only)

Baca kode nyata, bukan hanya test. Checklist minimum:

- [ ] **Penghapusan akun × tabel baru.** `purge_account_data` dan guard `zz_guard_account_writable` (migration `20261009090000`/`20261009100000`) mencakup tabel milik pengguna yang ditambahkan **setelah** T23: `internal.ai_usage`, `internal.ai_plan_assignments` (migration `20261018090000`), dan kolom/job import mode `rules` (migration `20261019090000`). Cari tabel dengan `user_id` yang tidak dihapus atau tidak dijaga.
- [ ] **Worker × `deleting`.** Jalur parser aturan di worker import (`workers/`, `src/server/documents`) memeriksa owner dan `deleting_at` sebelum stage dan sebelum commit, sama seperti jalur AI. `finalize_import_upload` dan `stage_import_items` menolak akun `deleting`.
- [ ] **Unit AI.** `internal.charge_ai_usage` hanya dipanggil dari `internal.enqueue_ai_job`, `retry_ai_job`, `begin_import_batch`, dan `retry_import_batch` untuk mode `ai`. Tidak ada jalur `rules` yang membebankan unit atau membuat `ai_jobs`. Retry import `rules` tidak berubah menjadi `ai`.
- [ ] **Event produk.** Trigger `AFTER` T24 tetap memicu event yang sama untuk import `rules` (activation dari commit import) dan tidak memuat properti baru di luar allowlist. Event tidak memuat `extraction_mode` kecuali allowlist mengizinkan.
- [ ] **Katalog dan isolasi.** `release_catalog.test.sql` membaca katalog secara dinamis; fungsi baru `public.get_ai_usage` dan perubahan `begin_import_batch`/`retry_import_batch`/`finalize_import_upload` lolos aturan `search_path`, privilege `anon`, dan grant. `release-ownership.test.ts` mencakup parameter RPC ber-ID baru.
- [ ] **Health operasional.** `get_operational_health` menghitung backlog yang relevan setelah 0032/0033 (job import `rules` macet terhitung sebagai backlog import).
- [ ] **Logging dan data minimization.** Grep `console.`/logger di `src/` dan `workers/`: tidak ada teks CV, teks hasil parser aturan, nama file, object key, atau angka usage per pengguna yang dapat dikaitkan ke isi.
- [ ] **Health endpoint dan bundle.** `/api/health` tidak membocorkan versi rahasia atau konfigurasi AI; bundle browser tanpa secret (pola `T25-phase4-accessibility.md`).
- [ ] Receipt `M5-gate-phase2-code-review.md` berisi temuan terklasifikasi P0–P3 dengan file:line.

### Fase 3 — E2E siklus hidup akun pilot (kriteria §1.2, §1.3, §1.5, §1.8)

- [ ] Buat `playwright.m5.config.ts` dengan menyalin `playwright.m4.config.ts`: PORT **3018**, `testMatch: "m5-pilot-journey.spec.ts"`, workers 1, timeout ≥ 300 detik. Web server tanpa env `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`. Worker memakai Gotenberg, ClamAV, dan renderer PDF nyata.
- [ ] Tambahkan script `"test:e2e:m5": "playwright test --config playwright.m5.config.ts tests/e2e/m5-pilot-journey.spec.ts"`.
- [ ] Tulis `tests/e2e/m5-pilot-journey.spec.ts`. Pakai ulang helper `tests/e2e/helpers/{accessibility,export-worker,release-fixture}.ts`, `tests/evidence-fixtures.ts`, fixture CV DOCX Indonesia dari suite T26, dan pola akun `tests/e2e/account-deletion.spec.ts`. Akun dibuat lewat UI daftar bila mail sink lokal tersedia, selain itu via admin; semua akun sisa dihapus di `afterAll`.

  Seluruh langkah dikerjakan **lewat UI**, kecuali pembuatan akun, drain worker, dan pemajuan waktu lewat SQL admin:

  1. **Daftar dan onboarding:** hanya display name; locale Bahasa Indonesia dipilih di onboarding.
  2. **Import tanpa AI (skenario rilis 1):** S02 → dialog pilihan mode, fokus awal di judul, pilih *Baca tanpa AI* dengan keyboard → upload CV DOCX Indonesia dengan dua masa kerja yang tumpang tindih → drain worker → S03 → perbaiki satu kandidat → commit. Tidak ada copy consent AI; `ai_jobs` dan `internal.ai_usage` akun ini 0 (SQL admin). Retry commit tidak menggandakan record; Dashboard menampilkan record terpilih sekali.
  3. **Capture saat AI unavailable (skenario rilis 3):** Quick log → simpan → copy AI unavailable dengan jalur manual → edit catatan → status analisis tidak menimpa revisi baru.
  4. **Confirm dan evidence:** buat derived achievement, confirm, unggah satu PDF evidence → `ready` (ClamAV nyata). Satu simpan gagal yang dipaksa (mis. revisi basi) mempertahankan isi form.
  5. **CV dan export:** S13 pilih achievement (parent ikut), Save → S14 export → renderer nyata → *Download PDF* → teks ekstraksi memuat nama dan karakter Indonesia, tanpa nama file evidence.
  6. **Event produk (SQL admin, read-only):** event activation, activity saved, achievement confirmation, dan export terminal untuk akun ini ada, dengan properti allowlist saja; tidak ada string sentinel catatan, nama file, atau teks CV di baris event.
  7. **Penghapusan akun:** S12 *Privacy and account* → reautentikasi password → konfirmasi email → sesi dicabut seketika (tab kedua yang sudah login ditolak pada aksi berikutnya) → drain worker `account-deletion` → login dengan kredensial lama ditolak.
  8. **Setelah purge (SQL admin):** baris akun di tabel `public`, `internal.ai_usage`, `internal.ai_plan_assignments`, `internal.product_events`, dan objek Storage tiga kategori = 0. `get_operational_health` tanpa backlog akun ini.
  9. **Aksesibilitas:** `expectNoWcagViolations` pada dialog mode import, S03, banner AI unavailable, S12 penghapusan akun. Satu pass 360 × 800 dark tanpa overflow horizontal pada S02 (dialog terbuka) dan S12.

- [ ] Jalankan hingga lulus. Kegagalan karena bug produk = temuan (klasifikasikan). Jangan melemahkan asersi.
- [ ] Commit `test(m5): add pilot account lifecycle journey`.
- [ ] Receipt `M5-gate-phase3-pilot-journey.md` berisi hasil, hitungan baris sebelum/sesudah purge (angka, bukan isi), dan screenshot `testInfo.attach` (jalankan sekali dengan `--reporter=html` dan `PLAYWRIGHT_HTML_OPEN=never`). Jangan menulis ke direktori screenshot T22/T25 yang di-track.

### Fase 4 — Integration lintas domain (kriteria §1.4–§1.7)

- [ ] Buat `tests/integration/m5-pilot-readiness.test.ts` dengan pola `tests/integration/m4-cv-output.test.ts`, `account-deletion.test.ts`, dan `product-events.test.ts` (admin + owner A + owner B lewat sign-in nyata, service layer nyata, worker nyata, `sql()` untuk pemajuan waktu). Tambahkan script `"test:integration:m5": "vitest run --config vitest.integration.config.ts --configLoader native tests/integration/m5-pilot-readiness.test.ts"`.
- [ ] Skenario:
  1. **Metrik pilot end-to-end.** Kohort empat akun pilot (`set_pilot_participant`) plus satu akun non-pilot, masing-masing menjalankan pola berbeda: aktif 24 jam via import `rules`; aktif via simpan manual lalu confirm dan export dalam 7 hari; aktif lalu simpan activity di minggu kedua dalam 28 hari; tidak aktif. Satu export gagal terminal. `get_pilot_metrics` mengembalikan pembilang dan penyebut yang tepat untuk keempat metrik; akun non-pilot tidak terhitung.
  2. **Rules tanpa unit.** Import `rules` sampai batas import harian terlewati jumlahnya → tetap diterima, `internal.ai_usage` tidak berubah. Import `ai` (fake provider) setelah batas tercapai → ditolak dengan kode batas, jalur manual tetap tersedia.
  3. **Penghapusan saat semua job aktif.** Akun A memiliki: batch import `rules` `queued`, batch import `ai` `running` (lease aktif), job AI `analysis` `queued`, export `running`, evidence `scanning`, reservation evidence aktif. `begin_account_deletion` → setiap worker yang berjalan ditolak saat CAS/complete; tidak ada baris baru setelah `deleting`; purge selesai; prefix Storage kosong; worker restart di tengah purge tidak kehilangan pekerjaan.
  4. **Tabel baru ikut terhapus.** Setelah skenario 3: `internal.ai_usage`, `internal.ai_plan_assignments`, dan `internal.product_events` milik A = 0; baris B tidak tersentuh; `internal.ai_capacity_usage` agregat tetap konsisten (tidak negatif, tidak memuat `user_id`).
  5. **Retensi import.** Batch `rules` dan `ai` yang commit, batal, dan gagal terminal: file asli dan teks staging hilang setelah waktu dimajukan 24 jam dan worker cleanup berjalan; provenance achievement/experience hasil import tetap ada.
  6. **Penarikan consent.** Consent ditarik saat job AI `queued` → job tidak mengirim teks (penghitung fake = 0) dan unit yang sudah dibebankan ditangani sesuai decision 0032; import `rules` setelahnya tetap jalan.
  7. **Isolasi baru.** Sesi B dengan ID A untuk `get_ai_usage`, batch import `rules`, retry import, dan route upload `x-extraction-mode` → hasil sama dengan ID acak.
  8. **Health.** Satu job import `rules` dengan lease kedaluwarsa dan satu cleanup gagal → `get_operational_health` menghitungnya; `pnpm ops:check` exit 2 terhadap ambang uji; setelah dibereskan exit 0.
- [ ] Jalankan hingga lulus. Data tersisa setelah purge, unit dibebankan untuk `rules`, atau metrik salah adalah **P0/P1/P2** sesuai §2.4; jangan ubah expectation.
- [ ] Commit `test(m5): add pilot readiness cross-domain integration`.
- [ ] Receipt `M5-gate-phase4-cross-domain.md`.

### Fase 5 — Regresi penuh, rebuild, dan performance

- [ ] Clean rebuild di stack sekali pakai (pola `T25-phase5-rebuild-build.md`): 38 migration dari nol, `pnpm db:test` lulus, tipe hasil `db:types` identik dengan `src/server/supabase/database.types.ts`.
- [ ] Jalankan seluruh §7 dan catat angka aktual. Evidence dengan ClamAV nyata, import dengan Gotenberg nyata, CV export/PDF dengan renderer nyata.
- [ ] `pnpm test:perf` sendirian dengan `WORKPULSE_PERF_OUT` ke scratchpad; catat p95 per operasi, lingkungan, dan sample count.
- [ ] Untuk kegagalan: rerun sekali. Lulus saat rerun → flaky beserta pesan error dan dugaan penyebab (P3 kecuali menyentuh acceptance). Gagal konsisten → temuan.
- [ ] Periksa `git status`: suite E2E tidak boleh meninggalkan screenshot/snapshot ter-track yang berubah. Bila berubah, kembalikan dengan `git restore` dan catat.
- [ ] Hitung akun fixture yang tersisa di database lokal (`auth.users` dengan prefix suite). Sisa dari suite gate = P3 baru; sisa dari suite lama dicatat terhadap T25 O3.
- [ ] Receipt `M5-gate-phase5-regression.md`.

### Fase 6 — Daftar periksa lingkungan pilot (kriteria §1.11, §1.12)

Pelaksana **tidak** mengakses server atau proyek hosted. Fase ini menyiapkan instruksi untuk operator.

- [ ] Tulis `docs/verification/M5-gate-pilot-environment.md` berisi langkah yang dijalankan operator dan bentuk bukti yang diminta:
  1. Urutan deploy migration 37–38 dan worker bersamaan (T26 N2, decision 0032/0033), dengan runbook §3 sebagai acuan; parity hosted 38/38 dari `migration list`.
  2. Tag image web dan worker `sha-<commit>` yang memuat HEAD gate; cara membacanya balik dari host.
  3. Smoke §8 runbook diulang: evidence sampai `ready` dan EICAR ditolak, import DOCX mode `rules` dan (bila AI aktif) mode `ai`, export PDF dan ekstraksi teks, penghapusan akun sampai hitungan nol. Satu klik recovery dari Gmail pada image terpasang (menutup B6).
  4. `backup.sh` hasil RV-B1 terpasang; dua baris `backup: ok` pada dua hari berbeda; daftar direktori backup dengan umur tertua < 30 hari.
  5. p95 baca/simpan di staging dengan dataset T24 (opsional bagi verdict; wajib dicatat bila tidak dijalankan).
  6. Keputusan tertulis pemilik produk tentang mode AI pilot.
  7. Query read-only yang boleh dijalankan reviewer untuk memeriksa ulang hitungan (tanpa key di dokumen; hanya nama variabel).
- [ ] Receipt `M5-gate-phase6-pilot-environment.md` hanya mencatat bahwa daftar periksa siap dan item mana yang sudah punya bukti sebelumnya (`T25-phase7-staging.md`, `T25-phase7b-review.md`).

### Fase 7 — Perbaikan P0–P2 dan laporan draft

- [ ] Untuk setiap P0–P2 dari Fase 1–5: tulis test gagal, perbaiki minimal, jalankan ulang suite domain terkait serta `test:e2e:m5`/`test:integration:m5`. Satu commit per temuan: `fix(m5): <ringkas>`. Perbaikan yang memerlukan migration atau perubahan kontrak RPC → **stop** dan laporkan (§6).
- [ ] Petakan enam skenario rilis PRD ke bukti akhir:
  - import CV Indonesia → `test:e2e:import` (mode `ai`), Fase 3 langkah 2 (mode `rules`);
  - graduate tanpa CV/employment → `test:e2e:m4` langkah 1–5;
  - note saat AI unavailable lalu retry basi → `test:e2e:m2`/`m3`, Fase 3 langkah 3;
  - quota evidence serentak dan pencabutan URL → `test:integration:evidence`, `test:e2e:evidence`;
  - override CV lalu update/delete sumber → `test:integration:m4` skenario 3–4;
  - ownership dua akun dan PDF multipage → `test:integration:release`, `test:integration:m4` skenario 11–12, Fase 4 skenario 7.
- [ ] Susun laporan draft `docs/verification/M5-gate-review.md` dengan pola `M4-gate-review.md`:
  - ringkasan;
  - matriks kriteria §1 (PASS/FAIL/MENUNGGU LINGKUNGAN + bukti);
  - matriks R01–R10 dan matriks acceptance §3;
  - temuan per level dengan status (fixed/open);
  - tabel command dan hasil;
  - flaky, tidak dijalankan beserta alasan, dan batas (lokal saja, bukan production);
  - BLOCKER production yang tetap terbuka.
- [ ] **Jangan** menulis verdict atau mengubah `IMPLEMENTATION_STATUS.md`, `AGENTS.md`, atau `T25-release-checklist.md`.
- [ ] Commit `docs(m5): add draft gate report`. Berhenti dan serahkan hash commit, receipt Fase 0–6, dan laporan draft kepada Claude.

### Fase 8 — Verdict (Claude)

- [ ] Verifikasi ulang secara independen:
  - baca diff test gate dan perbaikan;
  - jalankan ulang minimal `test:e2e:m5`, `test:integration:m5`, `test:integration:release`, `test:integration:account-deletion`, `test:e2e:release`, gate dasar, dan suite yang disentuh perbaikan;
  - buka sendiri screenshot journey;
  - periksa bukti operator Fase 6 dan jalankan query read-only yang diizinkan terhadap hosted.
- [ ] Tetapkan verdict di `M5-gate-review.md`: **PASSED** hanya bila semua kriteria §1 PASS dan tidak ada P0–P2 terbuka. Selain itu **BLOCKED**, disertai daftar kerja konkret (§2.2 butir 3).
- [ ] Bila PASSED: T25 dinilai ulang ke DONE bila kalimat selesainya kini terpenuhi; perbarui `T25-release-checklist.md` (baris basi, BLOCKER retensi dan staging) dan `T25-release-handoff.md`.
- [ ] Update `IMPLEMENTATION_STATUS.md`: tambahkan bagian "Gate M5" di atas dengan verdict, bukti, dan langkah berikutnya (pilot berjalan dan evaluasi metrik setelah 20 pengguna bila PASSED). Perbarui snapshot di `AGENTS.md` dan `docs/AGENTS.md` (keduanya harus identik). Riwayat lama dibiarkan.
- [ ] Commit `docs(m5): record gate review verdict`.

## 6. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Worktree gate tidak bersih pada Fase 0, atau parity migration ≠ 38/38.
- Penyelesaian membutuhkan `db reset` database aktif, mengedit migration lama, migration baru, perubahan kontrak RPC, atau operasi destruktif.
- ClamAV, Gotenberg, atau renderer PDF tidak dapat dijalankan lokal. Tandai kriteria terkait **tidak terbukti**; jangan memakai fake untuk bukti tersebut.
- Temuan P0 (kebocoran owner, data tersisa setelah purge, event berisi konten). Laporkan segera sebelum memperbaiki bila perbaikan memerlukan migration atau mengubah kontrak.
- Perbaikan terasa memerlukan fitur baru, AI live, perubahan angka batas AI, atau perubahan scope produk.
- Test apa pun memerlukan key nyata, akses server, proyek hosted, atau deployment.
- Sentinel/teks pengguna muncul di log, event, atau respons akun lain.
- Suite lama (T02–T26, M2–M4, release) perlu diubah agar lulus.
- Pekerjaan T27 di checkout utama terlihat berubah oleh langkah gate.

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
pnpm worker:check
pnpm build
pnpm ops:check
pnpm test:pdf
pnpm test:integration:m5
pnpm test:integration:release
pnpm test:integration:account-deletion
pnpm test:integration:product-events
pnpm test:integration:ai-usage
pnpm test:integration:m4
pnpm test:integration:m3
pnpm test:integration:m2
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
pnpm test:integration:ai
pnpm test:integration:ai-review
pnpm test:integration:evidence
pnpm test:integration:storage
pnpm test:e2e:m5
pnpm test:e2e:release
pnpm test:e2e:account-deletion
pnpm test:e2e:m4
pnpm test:e2e:m3
pnpm test:e2e:m2
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
pnpm test:perf
git diff --check
```

`test:integration:m5` dan `test:e2e:m5` adalah script **baru**; hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan. `test:perf` dijalankan terakhir dan sendirian. `test:ai:live` tidak dijalankan.

## 8. Review focus — risiko yang paling mungkin lolos

1. **Tabel pasca-T23 lolos dari purge.** `internal.ai_usage` dan `internal.ai_plan_assignments` dibuat setelah `purge_account_data` ditulis. Bila tidak ikut dihapus, jejak pemakaian akun terhapus bertahan. Dijaga oleh Fase 2 butir 1, Fase 3 langkah 8, dan Fase 4 skenario 4.
2. **Jalur parser aturan melewati guard `deleting`.** T26 menambah jalur worker yang tidak melewati `ai_jobs`; guard yang selama ini menempel di jalur AI bisa tidak terpanggil. Dijaga oleh Fase 2 butir 2 dan Fase 4 skenario 3.
3. **Metrik pilot salah hitung untuk aktivasi lewat import `rules`.** Activation PRD mencakup "confirm imported records"; event commit import mode baru bisa tidak memicu event yang sama. Dijaga oleh Fase 2 butir 4 dan Fase 4 skenario 1.
4. **Lingkungan pilot tertinggal dari `main`.** Staging tercatat di parity 36; migration 37–38 dan worker baru harus naik bersamaan (T26 N2). Image `main` yang dapat berubah membuat bukti smoke tidak terikat commit. Dijaga oleh kriteria §1.11 dan daftar periksa Fase 6.
5. **Retensi backup "lulus" tanpa bukti cron.** Satu run manual bukan bukti retensi; prune lama tidak berjalan saat dump gagal (B1). Dijaga oleh kriteria §1.12 dan §2.2 butir 3.
6. **Gate "lulus" karena katalog statis.** Test isolasi yang memakai daftar tabel tetap tidak akan gagal untuk tabel baru. `release-ownership.test.ts:252` membaca `pg_class` secara dinamis untuk skema `public`, tetapi tabel baru 0032 ada di skema `internal`. Dijaga oleh Fase 2 butir 5 dan Fase 4 skenario 7.

## 9. Prompt untuk memulai sesi baru

```text
Jalankan integration review Gate M5 WorkPulse sesuai handoff
docs/verification/M5-gate-review-plan.md. Baca handoff itu sampai selesai,
lalu AGENTS.md, entry teratas docs/IMPLEMENTATION_STATUS.md sampai T23,
IMPLEMENTATION_PLAN.md §5 (M5) dan §6, decision 0029–0033, dan
M4-gate-review.md sebagai pola.

Kerjakan di worktree baru dari origin/main; jangan menyentuh checkout utama
yang berisi pekerjaan T27. Kerjakan Fase 0–7 berurutan dan tulis receipt
tiap fase. Jangan menambah fitur; perbaiki hanya temuan P0–P2 dengan TDD.
Pakai ClamAV, Gotenberg, dan renderer PDF nyata; jangan memakai fake untuk
bukti gate. Jangan db reset dan jangan membuat migration. Jangan mengakses
server atau proyek hosted; Fase 6 hanya menyiapkan daftar periksa operator.
Ambil SUPABASE_SECRET_KEY lokal ke environment proses saja, jangan tulis ke
file. Patuhi stop conditions §6. Berhenti setelah Fase 7; verdict Gate M5
dan status authoritative hanya ditulis oleh Claude pada Fase 8.
```
