# Gate M5: integration review Pilot readiness

- Tanggal: 21 Oktober 2026 (Fase 0–7 pelaksana, Fase 8 reviewer).
- Branch: `claude/m5-gate-review`, basis `origin/main` `973e886` (PR #31). Tidak di-push.
- Pelaksana: Claude (Opus 5.5), satu sesi tanpa sub-agent, mode antislop *during*. Fase 0–7 dari [`M5-gate-review-plan.md`](M5-gate-review-plan.md). Reviewer Fase 8: Claude (Opus 5.5), sesi terpisah.
- **Verdict: BLOCKED** (21 Oktober 2026, HEAD gate `a9e5ac4`). Kriteria 1–10 dan 13 lulus lokal. Kriteria 11 dan 12 (lingkungan pilot) belum punya bukti yang dibaca balik, dan menurut §2.2 butir 3 handoff, gate tidak boleh PASSED tanpa keduanya. Daftar kerja di [§8](#8-verdict-reviewer-fase-8) hanya berisi item lingkungan pilot.
- Kalimat gate (`IMPLEMENTATION_PLAN.md:299`): *Gate M5: seluruh acceptance lulus. Target pilot 60% activation, 40% value completion, 30% return capture dan 98% export reliability baru dievaluasi dari 20 consenting pilot users; bukan syarat metrik yang bisa dibuktikan sebelum pilot berjalan.*
- Receipt: [Fase 0](M5-gate-phase0-baseline.md), [1](M5-gate-phase1-acceptance-audit.md), [2](M5-gate-phase2-code-review.md), [3](M5-gate-phase3-pilot-journey.md), [4](M5-gate-phase4-cross-domain.md), [5](M5-gate-phase5-regression.md), [6](M5-gate-phase6-pilot-environment.md). Daftar periksa operator: [M5-gate-pilot-environment.md](M5-gate-pilot-environment.md).

## Ringkasan

- Satu akun pilot menjalani siklus hidup lengkap di browser, dalam Bahasa Indonesia: daftar dari email, onboarding, import CV DOCX tanpa AI, capture saat AI tidak tersedia, konfirmasi manual, evidence, CV, PDF, penghapusan akun, lalu login ditolak. Semua baris, counter, event, dan objek akun itu 0 setelah purge (`test:e2e:m5`, 1/1).
- Integration lintas domain baru (`test:integration:m5`, 7/7) membuktikan metrik pilot dengan import `rules`, import `rules` tanpa unit AI, penghapusan saat setiap jenis job aktif, retensi import, penarikan consent, isolasi RPC T26/0032, dan alert `ops:check`.
- Seluruh 52 command §7 lulus (E2E setelah Docker hidup kembali), kecuali `db:test` di database bersama yang gagal karena data sisa akun lain; clean rebuild 38 migration lulus 21/1725 dan tipe identik. p95 lokal: baca 154,7 ms, simpan 91,2 ms.
- Gate menemukan **satu P2**, sudah diperbaiki dengan TDD: `"playwright": "latest"` dari commit Storybook membuat setiap `pnpm test:e2e:*` di `main` gagal sebelum test pertama (RV-PW, `f92cc04`). Tidak ada P0 atau P1. Tujuh P3 baru.
- Kriteria §1.11 (lingkungan pilot sejalan dengan HEAD) dan §1.12 (retensi backup di host pilot) **menunggu bukti operator**. Daftar periksanya siap. Menurut §2.2 butir 3 handoff, tanpa keduanya gate tidak dapat PASSED.

## 1. Matriks kriteria §1

| # | Kriteria | Status | Bukti |
| --- | --- | --- | --- |
| 1 | R01–R10 lulus | PASS (lokal) | Matriks dengan kolom dampak 0032/0033 dan test di gate: [Fase 1 §2](M5-gate-phase1-acceptance-audit.md#2-matriks-r01r10-di-head-gate). Semua suite yang dirujuk lulus di [Fase 5](M5-gate-phase5-regression.md) |
| 2 | Enam skenario rilis, skenario 1 untuk kedua mode | PASS | §3 di bawah. Mode `ai`: `import-commit` #1 dan `import-review.spec` (fake provider). Mode `rules`: `test:e2e:m5` langkah 2 dengan DOCX, ClamAV, dan Gotenberg nyata |
| 3 | Siklus hidup akun pilot di browser | PASS | [Fase 3](M5-gate-phase3-pilot-journey.md): satu E2E dari daftar sampai login ditolak; tab kedua kehilangan akses |
| 4 | Event produk | PASS | Fase 3 langkah 6 (event yang diharapkan, tanpa teks, nama file, email, atau ID); Fase 3 langkah 8 dan Fase 4 skenario 3–4 (event hilang setelah purge); Fase 4 skenario 1 (pembilang dan penyebut keempat metrik tepat, akun non-pilot diabaikan, activation lewat import `rules` terhitung) |
| 5 | Batas AI dan mode rules | PASS | Fase 4 skenario 2 (empat import `rules` melewati batas harian tanpa unit, `ai` keempat ditolak `QUOTA_EXCEEDED`, jalur manual tetap); Fase 3 langkah 2–3 (rules tanpa `ai_jobs`, unit, atau consent; analisis membebankan unit); Fase 4 skenario 3–4 dan Fase 3 langkah 8 (`ai_usage`, `ai_plan_assignments` terhapus) |
| 6 | Penghapusan akun lintas domain | PASS | Fase 4 skenario 3: batch `rules` antre, batch `ai` dengan lease ditahan, analisis antre, export dengan lease ditahan, evidence `scanning`, reservasi aktif. Penyelesaian terlambat tidak menulis; purge selamat dari worker yang mati; prefix Storage kosong; profil dan user Auth hilang (decision 0029); `account_deletion_overdue` dan `storage_cleanup_failed` tidak naik |
| 7 | Isolasi dan katalog | PASS | `release_catalog.test.sql` membaca katalog `public` dan `internal` secara dinamis ([Fase 2](M5-gate-phase2-code-review.md) butir 5), lulus di clean rebuild; `test:integration:release` 12; Fase 4 skenario 7 (ID batch, item, retry `rules` milik A dijawab sama dengan ID acak; `get_ai_usage` tanpa ID) |
| 8 | Aksesibilitas dan usability | PASS | `test:e2e:release` 15/15 (run ulang Fase 5). Axe dan keyboard pada dialog mode import 360 dark (fokus awal di judul), S03, S06 AI unavailable, dialog S12 360 dark dan 1440 light; tanpa overflow. Simpan yang gagal mempertahankan isi form (Fase 3 langkah 4). Banner batas AI 0032 tidak muncul di journey (akun tidak mencapai batas); Axe-nya tercakup `test:e2e:ai` dan `import` (gate review 0032) |
| 9 | Performance lokal | PASS | `test:perf` sendirian: p95 baca ≤ 154,7 ms, simpan ≤ 91,2 ms, 50 sampel warm + 1 cold per operasi, satu mesin lokal ([Fase 5](M5-gate-phase5-regression.md#performance)) |
| 10 | Regresi penuh hijau | PASS dengan catatan | 52 command; ClamAV, Gotenberg, renderer PDF nyata; clean rebuild 38 migration 21/1725, tipe identik. Catatan: 19 suite E2E lulus pada run ulang setelah Docker Desktop berhenti di tengah run pertama (M5-N7); `db:test` di database bersama gagal 3 assertion karena data sisa (M5-N3) |
| 11 | Lingkungan pilot sejalan dengan HEAD gate | **MENUNGGU LINGKUNGAN** | Daftar periksa butir 1–5 dan 11. Belum ada bukti *dibaca balik* dari `myworkpulse.my.id` |
| 12 | Retensi backup ≤ 30 hari di lingkungan pilot | **MENUNGGU LINGKUNGAN** | Daftar periksa butir 6. sha256 acuan `backup.sh` (`6e35778`) diverifikasi lokal: `e8e6dd09…3ad1`. Asal baris log 18 dan 19 Oktober harus ditunjukkan operator |
| 13 | Tidak ada P0–P2 terbuka | PASS (lokal); lingkungan pilot belum diperiksa | §4 |

## 2. Matriks acceptance §3 handoff

| Paket | Hasil gate | Catatan |
| --- | --- | --- |
| T23 | Terbukti sebagian | Mekanisme penghapusan diuji ulang dengan tabel 0032 dan jalur T26 (Fase 3, 4). Retensi backup baru terbukti untuk staging; untuk pilot menunggu kriteria §1.12 |
| T24 | Terbukti | Activation lewat import `rules` kini terbukti (Fase 4 skenario 1); `test:integration:product-events` 9, `test:perf` lulus |
| T25 | Terbukti sebagian | Bukti lokal diulang (release 12/15, katalog, rebuild). Integrasi nyata terbukti di staging dengan image tanpa migration 37–38; pilot menunggu §1.11 |
| Batas AI (0032) | Terbukti | Fase 4 skenario 2, 3, 4, 6; `ai-usage` 9 |
| T26 | Terbukti | Fase 3 langkah 2 dengan DOCX dan Gotenberg nyata; Fase 4 skenario 2, 3, 5, 7; suite T26 lulus di Fase 5 |

Matriks R01–R10 lengkap, peta skenario lintas subsistem X1–X4, dan tabel P3 lama yang diklasifikasi ulang ada di [Fase 1](M5-gate-phase1-acceptance-audit.md).

## 3. Enam skenario rilis PRD

| # | Skenario | Bukti akhir |
| --- | --- | --- |
| 1 | Import CV Indonesia, masa kerja tumpang tindih, koreksi, konfirmasi sekali, tanpa duplikat | Mode `ai`: `test:e2e:import` (11), `test:integration:import-commit` #1–2. Mode `rules`: `test:e2e:m5` langkah 2 (Enter ganda, reload, back/forward; tepat dua experience; Timeline menampilkan masing-masing sekali) |
| 2 | Graduate tanpa CV/employment sampai export | `test:e2e:m4` langkah 1–5, `test:integration:cv-export` "graduate scenario" |
| 3 | Note saat AI unavailable, edit, retry, output basi tidak menimpa | `test:e2e:m2`, `test:e2e:m3`, `test:e2e:ai-review` "S06 provider outage" dan "editing the note while a job is queued"; `test:e2e:m5` langkah 3 dengan provider `unavailable` nyata (job lama basi, retry membuat job untuk revisi baru, teks catatan tetap) |
| 4 | Dua upload di batas kuota, URL dicabut | `test:integration:evidence` (14), `test:e2e:evidence` (8) |
| 5 | Override lalu update/delete sumber, export terblokir | `test:integration:m4` skenario 3–4, `test:integration:cv-freshness`, `test:e2e:cv-export` |
| 6 | Ownership dua akun, PDF multipage | `test:integration:release` (12), `test:integration:m4` skenario 11–12, `test:integration:m5` skenario 7, `test:pdf` (46) |

## 4. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV-PW | P2 | Commit Storybook `834a4b0` menambah devDependency `"playwright": "latest"` (ter-resolve 1.64.0) sementara `@playwright/test` dipin 1.63.0. Bin `playwright` memuat runner kedua, sehingga setiap `pnpm test:e2e:*` di `main` gagal dengan *Playwright Test did not expect test.beforeAll()* sebelum test pertama. Perintah acceptance E2E di `AGENTS.md` tidak dapat dijalankan | **Fixed** `f92cc04`: `playwright` dipin 1.63.0, peer `playwright-core` axe dikembalikan ke 1.63.0 di lockfile (re-resolve sempat menaikkannya dan memecah `next build` lewat tipe `Page`), `pnpm install --frozen-lockfile` dan typecheck lulus. Unit `tests/unit/playwright-version.test.ts` merah (`'latest'` ≠ `'1.63.0'`) lalu hijau. Seluruh suite E2E lulus sesudahnya |
| M5-N1 | P3 | `/api/health` tanpa commit atau tag image; kecocokan image pilot hanya terbaca dari host | Catat; daftar periksa butir 3 |
| M5-N2 | P3 | Baris `ai_usage`, `ai_plan_assignments`, `product_events` bertahan sampai user Auth dihapus (tombstone 0029); bila `deleteUser` gagal terus, terlihat sebagai `account_deletion_overdue` | Diterima |
| M5-N3 | P3 | `cv_export.test.sql` menghitung semua export di database; gagal di database lokal bersama yang tercemar | Follow-up: hitung per akun test |
| M5-N4 | P3 | Pass worker test dengan `claimLimit` dapat memproses job akun sesi lain di database bersama | Catat |
| M5-N5 | P3 | Screenshot *full page* S12 360 px menggambar elemen `fixed` di posisi gulir | Catat |
| M5-N6 | P3 | Auth lokal hanya mengizinkan redirect ke port 3000; journey memindahkan path konfirmasi ke port gate | Catat; hosted diperiksa operator |
| M5-N7 | P3 | Docker Desktop berhenti tiga kali selama gate dengan exit bersih; suite yang jalan gagal dan membocorkan akun `t25-*` | Keterbatasan lingkungan lokal |

P3 lama (T23 F4/F6/F9, T24 G2/G5/G6/G7, T25 N3/N5/N6/O3, 7b B3/B5/B6/B7, closeout C1–C4, 0032 U1–U5, T26 N1–N7) diklasifikasi ulang di [Fase 1 §4](M5-gate-phase1-acceptance-audit.md#4-p3-dan-celah-terbuka-diklasifikasi-ulang). Perubahan penting: T26 N1 **tertutup** (keduanya di `main`); T26 N2 dan T25 B6 menjadi bagian kriteria §1.11; T25 O3 tetap P3 tetapi kini berdampak pada M5-N3.

**Batas independensi:** RV-PW ditemukan dan diperbaiki oleh pelaksana yang sama. Reviewer perlu menilai ulang diff `f92cc04`.

## 5. Command dan hasil

Angka rinci di [Fase 5](M5-gate-phase5-regression.md). Ringkas:

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm lint` / `typecheck` / `build` / `worker:check` | 0 | bersih / bersih / berhasil / `ready` 9 job |
| `pnpm test` | 0 | 129 file / 1181 (128/1180 di baseline; selisih dari handoff = 7 file story Storybook dan test RV-PW) |
| `pnpm db:test` (clean rebuild) / (database bersama) | 0 / 1 | 21 / 1725 PASS / 3 gagal karena data sisa |
| `pnpm db:lint`, `migration list --local` | 0 | bersih, 38/38 |
| `pnpm ops:check` | 0 | `status: ok` |
| `pnpm test:pdf` | 0 | 46 |
| `pnpm test:integration:m5` | 0 | 7 |
| `pnpm test:e2e:m5` | 0 | 1 (1,3 menit), lulus 4 kali berturut-turut termasuk regresi |
| 22 suite integration lain | 0 | sama dengan baseline task asal |
| 19 suite E2E lain | 0 | sama dengan baseline task asal (run ulang) |
| `pnpm test:perf` | 0 | 3 test; p95 baca ≤ 154,7 ms, simpan ≤ 91,2 ms |
| `git diff --check 973e886 HEAD` | 0 | bersih |

Commit gate: `571dd28`, `31712da` (Fase 0), `c575909` (Fase 1–2), `f92cc04` (RV-PW), `32b8ebc` (salinan handoff), `d375b0e`, `8b27d06` (Fase 4), `37451ca`, `4d37e20` (Fase 3), `a789dc0` (Fase 6), `e12727d` (Fase 5), dan commit laporan ini.

## 6. Flaky, tidak dijalankan, dan batas

- **Flaky:** tidak ada flaky test. Run merah di Fase 3 (3) dan Fase 4 (2) adalah kesalahan test yang dijelaskan per run di receipt masing-masing; tidak ada asersi produk yang dilemahkan. Run merah Fase 5 disebabkan Docker berhenti (M5-N7).
- **Tidak dijalankan:** `test:ai:live` (dilarang handoff); pemeriksaan NVDA manusia (di luar gate, keterbatasan T25 N6); semua butir lingkungan pilot (pelaksana tidak boleh mengakses server atau proyek hosted); p95 hosted; laporan HTML Playwright (reporter tidak menulis ke folder yang diminta; screenshot disimpan lewat `testInfo.outputPath` dan disalin ke folder catatan sesi).
- **Batas:** semua bukti dari Supabase lokal (Docker), Storage lokal, ClamAV dan Gotenberg lokal, renderer Chromium lokal, Playwright Chromium. Keberhasilan lokal bukan bukti kesiapan pilot maupun production.

## 7. BLOCKER production yang tetap terbuka

Tidak menghalangi verdict gate pilot (§1 handoff, "tidak mencakup"), tetapi wajib disebut. Dari [`T25-release-checklist.md`](T25-release-checklist.md) §1, sepuluh BLOCKER tetap terbuka untuk production: lingkungan production dan smoke-nya, p95 hosted, retensi backup pada paket production, otorisasi deploy tertulis, domain production dan `WORKPULSE_SITE_URL`, SMTP Auth dengan domain pengirim production, konfigurasi Auth hosted production, scanner nyata dengan EICAR di host, renderer nyata dengan pencocokan teks PDF, dan keputusan mode AI. Butir yang dipenuhi lingkungan pilot (domain, SMTP, Auth hosted, scanner, renderer, retensi, mode AI) dinilai lewat kriteria §1.11–§1.12 untuk pilot saja. Juga tetap terbuka: cleanup setelah restore hosted, kanal notifikasi `ops:check`, NVDA manusia, dan evaluasi target pilot setelah 20 pengguna consenting.

## 8. Verdict reviewer (Fase 8)

**BLOCKED.** Bukti lokal cukup untuk PASSED. Yang belum terbukti hanya kesesuaian lingkungan pilot `myworkpulse.my.id` dengan HEAD gate dan retensi backup di host pilot.

### Verifikasi ulang independen

Dijalankan reviewer di worktree gate pada `a9e5ac4`, 21 Oktober 2026 13:04–13:18 WIB. Supabase lokal, ClamAV `workpulse-t10-clamav`, Gotenberg `workpulse-t15-gotenberg`, dan renderer PDF `workpulse-t21-pdf` hidup. `SUPABASE_SECRET_KEY` hanya diset di environment proses, dan variabel AI harness dikosongkan.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 129 file / 1181 |
| `pnpm test:integration:m5` | 0 | 7 |
| `pnpm test:integration:release` | 0 | 12 |
| `pnpm test:integration:account-deletion` | 0 | 15 |
| `pnpm test:e2e:m5` | 0 | 1 (1,5 menit) |
| `pnpm test:e2e:release` | 0 | 15 (3,7 menit) |

Setelah T27 (PR #32) masuk `main`, `origin/main` di-merge ke branch gate (`1171989`). Hasil merge diuji ulang sesuai §2.2 butir 2: lint dan typecheck exit 0, unit 135 file / 1262, `test:e2e:m5` 1, dan `test:e2e:release` 21 (termasuk 6 dari spec T27). Semuanya lulus.

`test:e2e:release` menulis ulang 88 PNG ter-track di `docs/verification/T25-screenshots/`, sama seperti di T25. Reviewer mengembalikannya dengan `git checkout`, sehingga worktree bersih. Regresi penuh 52 command, clean rebuild, dan `test:perf` tidak diulang. Angka pelaksana di Fase 5 dipakai untuk suite yang tidak disentuh perbaikan.

### Penilaian

- **RV-PW (`f92cc04`) diterima.** Diff mengganti `"playwright": "latest"` dengan `1.63.0`, menurunkan `playwright` dan `playwright-core` dari 1.64.0 ke 1.63.0 di lockfile (termasuk peer `@vitest/browser-playwright`), dan menambah unit penjaga yang mewajibkan versi `playwright` sama dengan `@playwright/test`. Gejala yang sama tercatat di catatan lingkungan lokal reviewer sebelum gate. Seluruh E2E yang diulang lulus dengan pin ini.
- **Screenshot journey** dibuka reviewer: dialog mode import 360 dark (cincin fokus di judul, dua pilihan bertumpuk), S03 dengan banner *Data ini dibaca tanpa AI* dan dua masa kerja, S06 *Analisis tidak selesai* dengan *Coba lagi* dan *Buat pencapaian secara manual*, S08 konflik dengan isi *Judul* lokal tetap ada, dan dialog S12 berisi hitungan data. Header dan tautan lewati yang tampak di tengah S08 dan S12 adalah artefak screenshot *full page* (M5-N5), bukan cacat layout.
- **Temuan:** tidak ada P0 atau P1. Satu P2 (RV-PW) sudah diperbaiki. P3 M5-N1 sampai M5-N7 diterima sebagai follow-up.
- **Kriteria 11–12:** sebagian sudah dibaca balik reviewer. Lihat bagian berikut.

### Bukti lingkungan pilot (dibaca balik, 21 Oktober 2026)

Pemilik produk mengonfirmasi bahwa pilot dan staging memakai **satu** proyek Supabase, yaitu `Workpulse` (`cotmocgufdxjtiuakwdh`, ap-northeast-2, Free). Log Auth proyek itu mendukung hal ini: 331 dari 340 baris dalam 24 jam terakhir menyebut `myworkpulse`. Reviewer membaca proyek tersebut lewat connector Supabase secara read-only, setelah diminta pengguna.

| Butir daftar periksa | Hasil | Bukti |
| --- | --- | --- |
| 2. Parity | **PASS** | `list_migrations`: 38 versi, sama persis dengan `supabase/migrations/`, termasuk `20261018090000_ai_usage_limits` dan `20261019090000_t26_import_rules_extraction` |
| 4. Auth dan bucket | **PASS sebagian** | Log Auth 20 Oktober 23:26 UTC: `/signup` 200 dengan redirect `…myworkpulse…/auth/confirm`, lalu `/verify` 200 empat belas detik kemudian. Hari ini sembilan `Login` dan `/token` 200. Dua akun, keduanya terkonfirmasi. Bucket `workpulse-private` privat, batas 50 MiB. Nilai Site URL dan template email tidak terbaca lewat connector |
| 5. Smoke | **Sebagian** | `https://myworkpulse.my.id/api/health` mengembalikan `{"status":"ok","service":"workpulse-web","version":"0.1.0"}`, dan ref Supabase tidak ada di bundle browser. Data hosted: 5 evidence `ready`, 1 export `succeeded`, 1 batch import mode `ai` `committed`. Pengguna melaporkan sisa smoke sudah diuji langsung dan aman (21 Oktober; **dilaporkan**). Data hosted mendukung sebagian: tiga penghapusan akun `completed` (terakhir 17 Oktober, smoke T25 di proyek yang sama) dan recovery dari Gmail 16–17 Oktober (T25 Fase 7). Data hosted **tidak** mendukung import mode `rules`: tidak ada satu pun batch `rules`, dan tidak ada penghapusan akun sejak 17 Oktober yang bisa menghapusnya, padahal mode `rules` baru ada sejak migration 38. EICAR dan ekstraksi teks PDF tidak meninggalkan jejak yang bisa dibaca |
| 7. Mode AI | **Aktif, berjalan** | Satu `ai_jobs` jenis `import` berstatus `succeeded` (21 Oktober 05:02 UTC) dan 2 baris `internal.ai_usage`. Keputusan tertulis pemilik produk soal mode AI belum dilampirkan |
| 9. Ops | **PASS (data)** | `get_operational_health`: delapan metrik bernilai 0. Cron `ops:check` dan kanal notifikasinya belum ditunjukkan |
| 3. Image | **PASS** | Screenshot `docker ps` dari host (ditempel pengguna, 21 Oktober): `workpulse-staging-web-1` dan `workpulse-staging-worker-1`, keduanya `ghcr.io/feverepidemic/workpulse-{web,worker}:sha-f9fff79ce233e4b761b9885eba8a286e86e65054`, up 4 jam, web di `100.123.4.17:7998`. `f9fff79` adalah ujung `origin/main` (merge PR #32, T27) dengan 38 migration. Selisihnya dengan HEAD gate hanya tooling test (pin `playwright`, `playwright.m5.config.ts`, lockfile), tanpa kode runtime. Web dan worker pilot berjalan di host yang sama dengan staging, sesuai 0036 |
| 6. Backup | **Sebagian** | Pengguna menempel dua baris `backup.log`: `2026-10-18T12:30:53Z backup: ok … copies=2` dan `2026-10-19T12:30:53Z backup: ok … copies=3`. Ini baris yang sama dengan bukti T25 untuk proyek ini (0036 #5). Belum ada: baris run 20 Oktober 12:30 UTC, sha256 `backup.sh` dibanding `6e35778`, `crontab -l`, dan daftar salinan |

**M5-E1 (P2, tertutup oleh [decision 0036](../decisions/0036-shared-staging-pilot-project.md), 21 Oktober 2026).** Pemilik produk memilih penyelesaian kedua di bawah. Staging dan pilot berbagi satu proyek Supabase, sehingga syarat "lulus smoke di staging lebih dulu" (§1.11) tidak dapat dipenuhi untuk database: setiap migration, smoke, dan akun uji langsung mengenai data pilot. Ada dua penyelesaian:

- memisahkan staging ke proyek sendiri (paket Free membatasi dua proyek aktif per organisasi, dan slot kedua dipakai proyek lain); atau
- decision baru yang menerima satu proyek untuk pilot 20 pengguna, dengan syarat: migration hanya setelah lulus lokal dan setelah backup hari itu `ok`, akun uji tidak didaftarkan `set_pilot_participant`, dan akun uji dihapus lewat S12 setelah smoke.

Sisi positifnya, bukti staging T25 Fase 7 untuk database, Auth, dan bucket kini berlaku juga untuk pilot. Log backup 18–19 Oktober pun mencadangkan database yang sama, asalkan asal host dan versi script-nya ditunjukkan.

### Daftar kerja untuk PASSED

Semuanya dikerjakan operator mengikuti [daftar periksa lingkungan pilot](M5-gate-pilot-environment.md). Bukti ditempel tanpa rahasia, dan setiap bukti mencantumkan project ref pilot. Butir 2 sudah PASS, dan butir 4 dan 7 sebagian, menurut bagian bukti di atas.

0. ~~Keputusan pemilik produk untuk M5-E1~~: selesai lewat decision 0036. Untuk butir 1 dan seterusnya, staging tidak lagi menjadi langkah uji database terpisah. Yang wajib ditunjukkan adalah syarat 0036 #2: migration lulus lokal dan ada `backup: ok` hari itu sebelum migration diterapkan.
1. Urutan rilis: tanggal migration 37–38 diterapkan dan tanggal worker T26 terpasang di pilot, serta job import yang dibuat di antara keduanya (butir 1).
2. `migration list` proyek pilot 38/38, dibaca balik (butir 2).
3. Tag image web dan worker `sha-<commit>` dari `docker ps` di host pilot. Image harus memuat HEAD gate setelah branch ini di-merge ke `main` (butir 3).
4. Konfigurasi Auth pilot: Site URL dan redirect `https://myworkpulse.my.id/auth/confirm`, dua template, SMTP kustom, dan bucket `workpulse-private` privat (butir 4).
5. Smoke pilot dengan akun uji khusus: evidence `ready`, EICAR ditolak, import DOCX mode `rules`, export PDF beserta ekstraksi teks, penghapusan sampai hitungan nol, dan satu klik recovery dari kotak masuk nyata (butir 5).
6. Backup: sha256 `backup.sh` di host pilot sama dengan `6e35778`, project ref `--db-url` adalah proyek pilot, baris cron, dua `backup: ok` dari cron pada dua hari berbeda setelah RV-B1 terpasang, dan daftar salinan tanpa yang lebih tua dari 29 hari (butir 6).
7. Keputusan tertulis pemilik produk tentang mode AI pilot (butir 7).

Setelah bukti masuk, reviewer memeriksa kesamaan project ref di semua bukti. Bila ada izin, reviewer juga menjalankan query read-only butir 11. Verdict lalu ditulis ulang tanpa perlu mengulang suite lokal, kecuali bila `main` sudah berubah.
