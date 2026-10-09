# Handoff CI01 Continuous integration dengan GitHub Actions — eksekusi single-agent

> **Untuk agen pelaksana:**
> - Kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai.
> - Gunakan TDD bila ada logika yang dapat diuji: tulis test yang gagal, jalankan dan lihat gagal, buat perubahan minimal, jalankan ulang sampai lulus, lalu commit.
> - Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §8 (stop conditions) sebelum berimprovisasi.
> - Semua nama file workflow, nama job, nama script, label, port, dan path di dokumen ini **dibekukan**; jangan mengganti namanya.
> - Tidak ada migration. Tidak ada perubahan perilaku aplikasi. Jangan pernah `db:reset` database lokal.

- Tanggal: 9 Oktober 2026
- Status saat plan ditulis: **TODO**.
- Jenis: task infrastruktur di luar daftar T01–T25. Ini bukan T25 (release handoff) dan bukan deployment. ID `CI01` dipakai agar tidak bertabrakan dengan nomor task rencana.
- Dependensi: tidak ada task fitur. Repo `github.com/FeverEpidemic/workpulse` (**publik**, branch utama `main`) belum punya `.github/`.
- Hubungan dengan task lain: boleh berjalan paralel dengan Gate M4/T23 karena hanya menyentuh `.github/`, config Playwright, README, dan dokumen. Bila Gate M4/T23 sedang mengubah config Playwright yang sama, berhenti (§8).
- Eksekutor: satu agent. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude**. Gate review read-only wajib setelah Fase 5. Fase 6 (draft dokumen) dikerjakan setelah gate.
- Keputusan pengguna (9 Oktober 2026):
  - scope **CI dulu, CD ditunda**;
  - kedalaman CI **bertingkat**: check cepat di setiap PR, sedangkan integration + E2E berat di workflow terpisah (nightly, manual, atau label);
  - target hosting **belum ditentukan**;
  - bentuk plan: handoff di `docs/verification`.
- Acuan:
  - `AGENTS.md` bagian *Verifikasi* (gate dasar: lint, typecheck, test, build, worker:check; database: db:test, db:lint, db:types).
  - `docs/IMPLEMENTATION_PLAN.md` §6 (matriks verifikasi), §8 baris *Production domain/hosting/secret provisioning* (milik T25; deployment adalah langkah terpisah sesuai otorisasi).
  - `docs/decisions/0001-foundation-stack.md` (Node 24.18, pnpm 11.19, satu lockfile, versi exact).
  - Runbook container: `docs/verification/T10-scanner-runbook.md`, `T15-renderer-runbook.md`, `T21-pdf-renderer-runbook.md`.

**Goal:** Setiap PR ke `main` dan setiap push ke `main` otomatis menjalankan gate dasar dan gate database di GitHub Actions. Hasilnya terlihat sebagai status check yang bisa dijadikan *required* oleh pengguna. Suite integration, PDF, dan E2E yang butuh Supabase penuh, ClamAV, dan dua renderer Gotenberg berjalan di workflow terpisah. Workflow itu jalan setiap malam, bisa dipicu manual, dan bisa dipicu di PR lewat label `ci:full`. Config Playwright berjalan di Linux maupun Windows.

**Architecture:** Dua workflow.

- **`.github/workflows/ci.yml` (cepat, setiap PR/push).** Dua job paralel di `ubuntu-24.04`:
  - `quality`: install dari lockfile, lalu `lint`, `typecheck`, `test`, `worker:check`, dan `build`;
  - `database`: `supabase db start` (hanya Postgres + migration), lalu `db:test`, `db:lint`, parity migration, dan drift `database.types.ts`.
- **`.github/workflows/ci-full.yml` (berat).** Tiga job matrix. Setiap job menyalakan stack lengkapnya sendiri: `supabase start`, ClamAV T10, Gotenberg T15, dan Gotenberg T21 dengan digest yang sama dengan runbook. Job lalu membuat `.env.local` dari `supabase status -o env` dan menjalankan grup suite-nya. Report Playwright di-upload hanya saat gagal.
- Semua action pihak ketiga di-pin ke commit SHA. Dependabot hanya untuk ekosistem `github-actions`.

**Tech stack:** GitHub Actions (runner `ubuntu-24.04`), `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (cache pnpm), `actions/upload-artifact`, Supabase CLI dari devDependency (`pnpm exec supabase`), Docker bawaan runner, Playwright Chromium (`pnpm exec playwright install --with-deps chromium`), `actionlint` lewat container berdigest untuk validasi lokal. Tidak ada dependency npm baru dan tidak ada secret repository.

---

## 0. Cara memakai handoff ini

**Urutan baca.** Baca dokumen ini sampai selesai sebelum mengubah apa pun, lalu baca:

1. `AGENTS.md` bagian *Verifikasi* dan *Cara menjalankan pekerjaan*.
2. Entry teratas `docs/IMPLEMENTATION_STATUS.md`. Catat angka suite terakhir sebagai harapan.
3. `package.json` (scripts, `packageManager`, `engines`), `.npmrc`, `pnpm-workspace.yaml`.
4. Ke-18 `playwright*.config.ts`, `vitest*.config.ts`, `supabase/config.toml`.
5. Ketiga runbook container di atas.

Kutipan sumber yang mengikat (parafrase ringkas):

- **AGENTS Verifikasi:** gate dasar adalah `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm worker:check`. Database lokal memakai Supabase CLI; migration forward-only. Jangan mengklaim perintah lulus tanpa menjalankannya.
- **AGENTS langkah 7:** deployment mengikuti environment dan otorisasi pengguna; keberhasilan lokal (dan CI) bukan bukti production live.
- **Decision 0001:** satu lockfile `pnpm-lock.yaml`, versi exact, tidak ada package manager lain.
- **Rencana §8:** hosting/secret provisioning milik T25 dan butuh otorisasi terpisah.

**Aturan kerja:**

- Pertahankan perubahan lokal pengguna (saat plan ditulis, `.claude/setting.local.json` untracked; jangan disentuh).
- Jangan menandai CI01 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`.
- **Push ke `origin`, membuat PR, memberi label, dan memicu workflow adalah aksi keluar.** Lakukan hanya setelah pengguna mengizinkan secara eksplisit di chat untuk fase itu (Fase 4).
- Pada akhir setiap fase, tulis receipt `docs/verification/CI01-phaseN-<slug>.md` berisi:
  - tujuan dan file berubah;
  - command beserta hasil aktual (exit code, angka pass/fail, durasi job untuk run GitHub);
  - acceptance yang terbukti;
  - warning/kegagalan dan blocker;
  - langkah berikutnya.
- Angka di receipt harus hasil command atau run yang benar-benar terjadi. Tautkan URL run GitHub bila ada.

## 1. Acceptance inti CI01

CI01 lulus hanya jika setiap poin berikut terbukti:

1. **Config Playwright lintas platform.** Tidak ada `next.CMD` atau path backslash di `playwright*.config.ts`. Setiap `webServer.command` memakai `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --port <PORT>` (port tiap config tidak berubah). Dibuktikan oleh unit test guard `tests/unit/ci-playwright-configs.test.ts` (gagal sebelum perubahan), ditambah dua suite E2E yang tetap lulus di Windows lokal dan lulus di Linux pada `ci-full`.
2. **Trigger `ci.yml`.** Berjalan pada `pull_request` ke `main`, `push` ke `main`, dan `workflow_dispatch`. Ada `concurrency` per ref dengan `cancel-in-progress: true` khusus PR, dan `permissions: contents: read`. Dibuktikan oleh `actionlint` bersih dan satu run PR nyata.
3. **Job `quality`** menjalankan secara berurutan `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm worker:check`, dan `pnpm build`, dengan Node dari `engines` `package.json` dan pnpm dari `packageManager`. Run nyata hijau, dan angka unit sama dengan baseline lokal Fase 0.
4. **Job `database`** menjalankan `pnpm exec supabase db start` lalu:
   - `pnpm db:test` dengan angka pgTAP sama dengan baseline lokal;
   - `pnpm db:lint` bersih;
   - parity migration: jumlah file `supabase/migrations` = jumlah migration terapan (31/31 saat plan ditulis);
   - drift types: `pnpm db:types` dibandingkan dengan `src/server/supabase/database.types.ts` dan gagal bila berbeda.

   Dibuktikan run nyata hijau, plus satu bukti merah yang disengaja untuk drift (§5 Fase 4).
5. **Kegagalan memblokir.** Step yang gagal membuat job merah dan tidak ada `continue-on-error` pada check. Dibuktikan oleh satu commit sementara di branch PR yang sengaja melanggar lint; run merah, lalu commit itu di-revert sebelum review.
6. **`ci-full.yml`** berjalan pada `schedule` (`0 19 * * *` UTC = 02:00 WIB), `workflow_dispatch`, dan `pull_request` dengan tipe `labeled`/`synchronize`. Untuk event PR, job hanya jalan bila PR berlabel `ci:full`. Matrix tiga grup (§3.3) dengan `fail-fast: false` dan `timeout-minutes: 90`. Dibuktikan oleh satu run `workflow_dispatch` nyata dengan ketiga grup hijau, atau gagal hanya pada flaky yang sudah dikenal (§10).
7. **Stack container identik dengan runbook.** ClamAV, Gotenberg T15, dan Gotenberg T21 memakai digest, flag, dan port yang sama dengan ketiga runbook, dan job menunggu health sebelum suite jalan. Dibuktikan oleh log run dan cek grep di gate review.
8. **Tanpa secret repository.** Kedua workflow tidak memakai `secrets.*` selain `GITHUB_TOKEN` implisit. Key Supabase lokal dari `supabase status` di-mask (`::add-mask::`) sebelum ditulis ke `.env.local`. `.env.local` tidak pernah di-upload sebagai artifact. `test:ai:live` tidak pernah dijalankan di CI. Dibuktikan oleh grep workflow dan isi artifact.
9. **Supply chain.** Setiap `uses:` pihak ketiga di-pin ke SHA 40 karakter dengan komentar versi. `.github/dependabot.yml` hanya berisi ekosistem `github-actions` mingguan. Dibuktikan oleh grep di gate review.
10. **Dokumentasi.** README punya bagian *Continuous integration*: workflow, trigger, label `ci:full`, dan cara menjadikan `quality`/`database` required check. Runbook `docs/verification/CI01-ci-runbook.md` berisi cara men-debug kegagalan dan cara menjalankan grup `ci-full` lokal.

## 2. Scope

### 2.1 Dalam scope

- Dua workflow, `dependabot.yml`, perbaikan `webServer.command` di 17 config Playwright, satu unit test guard, README, runbook, decision, dan dokumen verifikasi.

### 2.2 Keputusan implementasi yang dibekukan

1. **Runner `ubuntu-24.04`**, bukan `ubuntu-latest`, agar image tidak berubah diam-diam.
2. **Node dari `node-version-file: package.json`** (dibaca dari `engines.node`) dan **pnpm dari `packageManager`** (`pnpm/action-setup` tanpa input `version`). Satu sumber versi, sesuai decision 0001.
3. **`webServer.command` memakai `node node_modules/next/dist/bin/next`.** Perintah ini berjalan sama di Windows dan Linux, dan sudah pernah dipakai di status M1 (`IMPLEMENTATION_STATUS.md`, baris *Production build*). Tidak memakai `pnpm build` agar env `webServer.env` yang sudah difilter (mis. `playwright.m4.config.ts`) tidak berubah jalurnya. `playwright.config.ts` (smoke) sudah memakai `pnpm build && pnpm start` dan tidak diubah.
4. **Job `database` memakai `supabase db start`**, bukan `supabase start`. pgTAP hanya butuh Postgres, dan stack lengkap memperlambat setiap PR beberapa menit. Bila Fase 0 membuktikan `db:test` butuh layanan lain (mis. schema `storage`/`auth` dari container lain), ganti dengan `supabase start -x studio,imgproxy,edge-runtime,logflare,vector,realtime,postgres-meta,mailpit` dan catat buktinya di receipt.
5. **Drift types** dicek dengan `pnpm db:types > $RUNNER_TEMP/types.ts` lalu `diff -u src/server/supabase/database.types.ts $RUNNER_TEMP/types.ts`. Bila Fase 0 menemukan file di repo tidak identik byte demi byte dengan output CLI (mis. format), berhenti dan laporkan. Jangan menormalisasi file types dalam task ini.
6. **Tiga grup `ci-full`**, dijalankan sebagai matrix dengan stack sendiri-sendiri (paralel, lebih cepat, dan kegagalan terisolasi):
   - `integration`: semua script `test:integration:*` dan `test:pdf`;
   - `e2e-core`: `test:e2e`, `test:e2e:auth`, `ui`, `activity`, `projects`, `dashboard`, `achievements`, `evidence`, `ai`, `ai-review`, `m2`;
   - `e2e-import-cv`: `test:e2e:import`, `import-review`, `m3`, `cv`, `cv-freshness`, `cv-export`, `m4`.

   Suite dalam satu grup berjalan berurutan dengan `bash -e`, sehingga suite gagal pertama menghentikan grup. Daftar persis ada di §3.3.
7. **Repo publik**, sehingga menit runner standar gratis. Pemilahan cepat/berat tetap dipakai demi waktu tunggu PR, bukan demi biaya.
8. **Tidak ada retry tambahan.** `retries` Playwright tidak diubah. Flaky yang dikenal (`activity-ui.spec.ts:356`) dicatat, bukan disembunyikan.
9. **Key lokal.** Di Linux, `SUPABASE_SECRET_KEY` diisi dari `SECRET_KEY` (`sb_secret_...`) sesuai `.env.example`. Masalah 401 Kong yang pernah terlihat hanya pada Docker Desktop/WSL2 Windows. Bila terjadi juga di runner, pakai `SERVICE_ROLE_KEY` dan catat di receipt.
10. **Label `ci:full`** dibuat pengguna (atau pelaksana setelah izin Fase 4). Workflow tidak membuat label sendiri.
11. **Tanpa CD.** Tidak ada job deploy, environment, atau secret hosting. Kerangka CD dicatat sebagai keputusan tertunda di decision 0030.

### 2.3 Di luar scope

- Deployment staging/production, provisioning Supabase hosted, worker host, dan domain (T25, menunggu keputusan hosting dan otorisasi pengguna).
- Mengaktifkan branch protection/ruleset di GitHub. Ini pengaturan repo milik pengguna; pelaksana hanya menulis langkahnya di README/runbook.
- `test:ai:live` (butuh endpoint dan key nyata serta izin per run).
- Memperbaiki flaky `activity-ui.spec.ts:356` dan P3 lain yang terbuka.
- Upgrade dependency npm, Dependabot untuk npm, CodeQL, dan cache Docker image (boleh jadi follow-up).
- Runner Windows di CI.

## 3. Kontrak teknis

### 3.1 Bagian bersama kedua workflow

```yaml
permissions:
  contents: read
defaults:
  run:
    shell: bash
env:
  CI: "true"
  NEXT_TELEMETRY_DISABLED: "1"
```

Langkah setup (urutan tetap):

1. `actions/checkout`, dengan `persist-credentials: false`.
2. `pnpm/action-setup`.
3. `actions/setup-node` dengan `node-version-file: package.json` dan `cache: pnpm`.
4. `pnpm install --frozen-lockfile`.

### 3.2 `ci.yml`

- `name: CI`. Job id dan nama tampil: `quality`, `database`. Nama ini menjadi nama required check (`CI / quality`, `CI / database`).
- `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }`.
- `quality`: `timeout-minutes: 20`. Step: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm worker:check`, `pnpm build`.
- `database`: `timeout-minutes: 25`. Step:
  1. `pnpm exec supabase db start`;
  2. `pnpm db:test`;
  3. `pnpm db:lint`;
  4. parity: hitung `ls supabase/migrations/*.sql | wc -l`, bandingkan dengan `pnpm exec supabase migration list --local` (jumlah baris dengan kolom Local dan Remote terisi). Gagal bila berbeda; detailnya dikunci di Fase 2;
  5. drift types (§2.2.5);
  6. `if: always()` → `pnpm exec supabase stop --no-backup`.

### 3.3 `ci-full.yml`

- `name: CI full`. Job id `full`, nama tampil `full (${{ matrix.group }})`.
- Trigger:

```yaml
on:
  schedule:
    - cron: "0 19 * * *"
  workflow_dispatch:
  pull_request:
    branches: [main]
    types: [labeled, synchronize, opened, reopened]
```

- Guard job: `if: github.event_name != 'pull_request' || contains(github.event.pull_request.labels.*.name, 'ci:full')`.
- `concurrency: { group: ci-full-${{ github.ref }}-${{ matrix.group }}, cancel-in-progress: true }` (di level job).
- Step stack, berurutan:
  1. Setup §3.1, lalu `pnpm exec playwright install --with-deps chromium`. Lewati untuk grup `integration` bila Fase 3 membuktikan grup itu tidak butuh browser.
  2. `pnpm exec supabase start`.
  3. `docker run` tiga container persis seperti runbook: `workpulse-t10-clamav` 13310, `workpulse-t15-gotenberg` 13400, `workpulse-t21-pdf` 13401, dengan digest dan flag yang disalin dari runbook. `--memory` boleh diturunkan bila runner (16 GB) kekurangan memori; catat di receipt.
  4. Tunggu siap, dengan batas waktu dan pesan gagal yang jelas:
     - ClamAV: loop `docker exec workpulse-t10-clamav clamdscan --ping 3` (atau ping TCP setara) sampai 300 detik, karena freshclam pertama kali bisa lama;
     - Gotenberg: `curl -fsS http://127.0.0.1:13400/health` dan `:13401/health` sampai 120 detik.
  5. Tulis `.env.local` dari `pnpm exec supabase status -o env`. Setiap nilai key di-`::add-mask::` lebih dulu. Variabel yang ditulis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`, `WORKPULSE_SITE_URL`, `WORKPULSE_SCANNER_MODE=clamav`, `WORKPULSE_CLAMD_HOST=127.0.0.1`, `WORKPULSE_CLAMD_PORT=13310`, `WORKPULSE_GOTENBERG_URL`, `WORKPULSE_PDF_GOTENBERG_URL`. Nama variabel status CLI dicocokkan di Fase 3 dari output nyata, bukan ditebak.
  6. Jalankan daftar suite grup (`bash -e`). Daftarnya disimpan sebagai skrip `.github/scripts/ci-full-group.sh <group>` agar dapat dijalankan sama di lokal (WSL/Git Bash) dan di CI.
  7. `if: failure()` → `actions/upload-artifact` dengan `playwright-report/` dan `test-results/`, nama `ci-full-${{ matrix.group }}-${{ github.run_attempt }}`, `retention-days: 7`. Jangan pernah meng-upload `.env*`.
  8. `if: always()` → `docker rm -f` ketiga container dan `pnpm exec supabase stop --no-backup`.
- Isi `ci-full-group.sh` (dibekukan; Fase 0 memverifikasi setiap script ada di `package.json`):

| Grup | Script berurutan |
| --- | --- |
| `integration` | `test:integration:storage`, `activity`, `projects`, `achievements`, `dashboard`, `evidence`, `ai`, `ai-review`, `import`, `import-commit`, `import-review`, `m2`, `m3`, `cv`, `cv-builder`, `cv-freshness`, `cv-export`, `m4`, lalu `test:pdf` |
| `e2e-core` | `test:e2e`, `test:e2e:auth`, `ui`, `activity`, `projects`, `dashboard`, `achievements`, `evidence`, `ai`, `ai-review`, `m2` |
| `e2e-import-cv` | `test:e2e:import`, `import-review`, `m3`, `cv`, `cv-freshness`, `cv-export`, `m4` |

### 3.4 `dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

## 4. Struktur file

| Aksi | Path |
| --- | --- |
| Baru | `.github/workflows/ci.yml`, `.github/workflows/ci-full.yml`, `.github/scripts/ci-full-group.sh`, `.github/dependabot.yml` |
| Baru | `tests/unit/ci-playwright-configs.test.ts` |
| Ubah | 17 `playwright.*.config.ts` (hanya `webServer.command`): achievements, activity, ai-review, ai, auth, cv-export, cv-freshness, cv, dashboard, evidence, import-review, import, m2, m3, m4, projects, ui. `playwright.config.ts` (smoke) tidak diubah. Fase 0 menghitung ulang |
| Ubah | `README.md` (bagian *Continuous integration*) |
| Baru (dokumen) | `docs/verification/CI01-ci-runbook.md`, `docs/verification/CI01-phaseN-*.md`, draft `docs/verification/CI01-continuous-integration.md`, draft `docs/decisions/0030-ci01-github-actions.md` |

Nomor decision **0030**, karena 0029 sudah dipesan oleh T23 (`T23-implementation-plan.md`).

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] `git status --short` hanya berisi perubahan pengguna yang sudah diketahui. Catat HEAD.
- [ ] `gh auth status` dan `gh repo view FeverEpidemic/workpulse --json visibility,isPrivate`. Catat: repo publik, Actions aktif (`gh api repos/FeverEpidemic/workpulse/actions/permissions`). Push file workflow lewat git SSH tidak butuh scope `workflow` pada token `gh`. Bila push ditolak karena scope, berhenti (§8).
- [ ] Hitung config Playwright yang memakai `.CMD` (harapan: 17) dan port masing-masing.
- [ ] Verifikasi setiap script di tabel §3.3 ada di `package.json`. Script yang tidak ada dicatat dan tidak dikarang.
- [ ] Baseline lokal: `pnpm lint`, `pnpm typecheck`, `pnpm test` (harapan unit **103 file / 956 test** atau lebih, sesuai status terakhir), `pnpm worker:check`, `pnpm build`.
- [ ] Database lokal: `pnpm db:test` (harapan pgTAP **15 file / 1290 test** atau lebih), `pnpm db:lint`, parity 31/31.
- [ ] Drift types lokal: `pnpm db:types` ke file sementara di luar repo, lalu bandingkan dengan `src/server/supabase/database.types.ts`. Harapan: identik. Bila berbeda (termasuk line ending CRLF di Windows), catat penyebabnya. Untuk CRLF, cek `git ls-files --eol src/server/supabase/database.types.ts`. Ini menentukan apakah §2.2.5 bisa dipakai apa adanya.
- [ ] Probe §2.2.4: cek apakah pgTAP menyentuh schema `auth`/`storage` (grep `supabase/tests`). Catat apakah `supabase db start` saja cukup.
- [ ] Receipt `CI01-phase0-baseline.md`.

### Fase 1 — Config Playwright lintas platform (TDD)

- [ ] Tulis `tests/unit/ci-playwright-configs.test.ts`. Test membaca semua `playwright*.config.ts` di root dan meng-assert:
  - tidak ada `.CMD` atau `node_modules\\`;
  - setiap config non-smoke yang punya `webServer.command` memakai `node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --port`.
- [ ] Jalankan `pnpm test`. Test baru **gagal** (17 pelanggaran). Catat.
- [ ] Ubah hanya string `webServer.command` di ke-17 config. Port, env, timeout, dan opsi lain tidak berubah.
- [ ] `pnpm test` lulus. `pnpm lint` dan `pnpm typecheck` lulus.
- [ ] Bukti Windows tidak rusak, dengan stack lokal dan container sesuai memori lingkungan: `pnpm test:e2e:ui` dan `pnpm test:e2e:cv-export` lulus dengan angka sama seperti baseline status.
- [ ] Commit `test(ci01): guard cross-platform playwright web server command` dan `fix(ci01): run next through node in playwright configs`. Receipt `CI01-phase1-playwright.md`.

### Fase 2 — `ci.yml` dan `dependabot.yml`

- [ ] Resolve SHA setiap action dari tag rilis terbaru yang stabil, lewat `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`. Jika tag annotated, dereference ke commit. Tulis `uses: owner/repo@<sha> # vX.Y.Z`. Catat tabel action, tag, dan SHA di receipt.
- [ ] Tulis `ci.yml` sesuai §3.1–§3.2 dan `dependabot.yml` sesuai §3.4.
- [ ] Validasi lokal dengan `actionlint` lewat container berdigest. Resolve digest `rhysd/actionlint` dan catat. Harapan: 0 temuan. Jalankan juga `shellcheck` bila tersedia di image yang sama.
- [ ] Commit `ci(ci01): add quality and database workflow`. Receipt `CI01-phase2-ci-workflow.md`.

### Fase 3 — `ci-full.yml` dan skrip grup

- [ ] Tulis `.github/scripts/ci-full-group.sh` (`set -euo pipefail`, `case` per grup, cetak nama suite sebelum jalan, exit 2 untuk grup tidak dikenal).
- [ ] Cocokkan nama variabel `supabase status -o env` dari output nyata, tanpa mencetak nilai key ke receipt. Tulis langkah pembuat `.env.local` dengan mask.
- [ ] Tulis `ci-full.yml` sesuai §3.3.
- [ ] `actionlint` + `shellcheck` 0 temuan.
- [ ] Opsional bila WSL/Git Bash tersedia: jalankan `bash .github/scripts/ci-full-group.sh e2e-import-cv` lokal untuk satu grup. Bila tidak dijalankan, tulis alasannya.
- [ ] Commit `ci(ci01): add nightly full integration and e2e workflow`. Receipt `CI01-phase3-ci-full.md`.

### Fase 4 — Bukti di GitHub (butuh izin pengguna)

**Berhenti dan minta izin eksplisit di chat** sebelum langkah pertama fase ini. Sebutkan yang akan dilakukan: push branch, membuat draft PR ke `main`, membuat label `ci:full`, menjalankan `workflow_dispatch`, dan dua commit merah sementara.

- [ ] Push branch kerja, lalu buat **draft PR** ke `main`.
- [ ] `ci.yml` pada PR: `quality` dan `database` hijau. Catat durasi dan angka unit/pgTAP dari log; harus sama dengan Fase 0.
- [ ] Bukti merah lint: commit sementara yang melanggar lint → `quality` merah, lalu `git revert` → hijau.
- [ ] Bukti merah drift: commit sementara yang menambah satu baris di `database.types.ts` → `database` merah pada step drift, lalu revert → hijau.
- [ ] `gh workflow run ci-full.yml --ref <branch>`. Ketiga grup hijau. Bila satu grup gagal, unduh artifact dan diagnosis:
  - flaky yang dikenal (§10) → jalankan ulang job sekali dan catat;
  - bug lingkungan CI → perbaiki workflow/skrip, lalu commit baru;
  - bug aplikasi → **berhenti** (§8).
- [ ] Bukti label: buat label `ci:full`, pasang di PR, `ci-full` jalan. Lepas label, push commit kosong, `ci-full` di-skip.
- [ ] Pastikan artifact grup yang gagal (bila ada) tidak berisi `.env*` (`unzip -l`).
- [ ] Receipt `CI01-phase4-github-runs.md` dengan URL setiap run, durasi per job, dan angka per suite.

### Fase 5 — Dokumentasi pengguna

- [ ] README: bagian *Continuous integration* (trigger, apa yang diuji, label `ci:full`, cara menjadikan `CI / quality` dan `CI / database` required lewat *Settings → Rules → Rulesets*).
- [ ] `docs/verification/CI01-ci-runbook.md`:
  - membaca kegagalan per job;
  - mengunduh artifact;
  - menjalankan grup `ci-full` lokal;
  - memperbarui SHA action (Dependabot);
  - mengganti digest container (harus sinkron dengan runbook T10/T15/T21);
  - apa yang **bukan** dibuktikan CI (production, hosted, AI live).
- [ ] Commit `docs(ci01): document continuous integration`. Receipt `CI01-phase5-docs.md`.

**Gate review Claude (§9) dijalankan di sini.**

### Fase 6 — Draft dokumen (setelah gate)

- [ ] Draft decision `docs/decisions/0030-ci01-github-actions.md`: keputusan §2.2, alasan, hasil gate, serta CD yang ditunda dengan pertanyaan terbuka (hosting web, worker host, Supabase hosted, strategi migration, environment approval).
- [ ] Draft `docs/verification/CI01-continuous-integration.md` (bukti acceptance §1 per poin dengan URL run), tanpa klaim DONE.
- [ ] Commit `docs(ci01): add draft decision and verification record`.

## 6. Fixture

Tidak ada fixture baru. Suite memakai fixture akun A/B dan sentinel privatnya sendiri, dan membersihkannya sendiri. Database CI selalu baru per job, jadi tidak ada data yang tersisa antar run.

## 7. Commands

Yang sudah ada: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm worker:check`, `pnpm build`, `pnpm db:test`, `pnpm db:lint`, `pnpm db:types`, seluruh `pnpm test:integration:*`, `pnpm test:pdf`, dan seluruh `pnpm test:e2e*`.

Baru (bukan script `package.json`): `bash .github/scripts/ci-full-group.sh <integration|e2e-core|e2e-import-cv>`.

GitHub (Fase 4, setelah izin): `gh pr create --draft`, `gh run list`, `gh run view --log-failed`, `gh run download`, `gh workflow run ci-full.yml`, `gh label create ci:full`, `gh pr edit --add-label/--remove-label`.

## 8. Stop conditions

Berhenti dan laporkan ke pengguna bila:

- working tree berisi perubahan yang tidak dikenal, atau Gate M4/T23 sedang mengubah config Playwright yang sama;
- butuh migration, `db:reset`, atau perubahan kode aplikasi (`src/`, `workers/`, `supabase/`) agar CI hijau. Itu bug, bukan pekerjaan CI01;
- suite gagal di Linux karena perilaku aplikasi, bukan lingkungan (mis. asumsi path Windows di kode non-config). Catat file:baris, jangan diperbaiki diam-diam;
- butuh secret repository, token dengan scope tambahan, atau mengubah setting repo (Actions permissions, rulesets);
- fase 4 tanpa izin eksplisit pengguna;
- drift types di Fase 0 tidak bisa dijelaskan, atau digest container dari runbook tidak bisa ditarik;
- tergoda menambah `retries`, `continue-on-error`, `test.skip`, atau melemahkan assertion (termasuk regex AI di `m2-manual-journey.spec.ts`) agar hijau.

## 9. Gate review Claude (read-only)

Setelah Fase 5, reviewer memeriksa tanpa mengedit:

- [ ] Receipt Fase 0–5 lengkap. Angka konsisten dengan log run GitHub.
- [ ] `git diff main --stat` hanya menyentuh file §4. Tidak ada perubahan `src/`, `workers/`, `supabase/`, lockfile, atau `package.json`.
- [ ] Ulangi lokal: `pnpm test` (termasuk guard), `pnpm lint`, `pnpm typecheck`, `actionlint`/`shellcheck`, dan satu suite E2E Windows.
- [ ] Grep: `uses:` semuanya SHA 40 karakter; tidak ada `secrets.`; tidak ada `continue-on-error`; tidak ada `pull_request_target`; `permissions: contents: read`; artifact tanpa `.env`.
- [ ] Digest dan flag container identik dengan ketiga runbook.
- [ ] Buka run PR dan run `ci-full`: hijau, bukti merah lint/drift ada dan sudah di-revert.
- [ ] Temuan P0–P2 memblokir; P3 jadi follow-up di decision 0030.

## 10. Review focus

1. **Check yang diam-diam tidak berjalan.** Guard `if:` label yang salah membuat `ci-full` selalu skip; parity yang selalu lulus karena output CLI berubah format. Dijaga oleh bukti skip/run label dan bukti merah drift di Fase 4.
2. **Kebocoran key ke log atau artifact.** Key lokal bersifat ephemeral, tetapi kebiasaan buruk tetap terbawa ke CD nanti. Dijaga oleh mask, grep, dan `unzip -l` artifact.
3. **Perubahan config Playwright mengubah env webServer.** Config M4 memfilter env AI/renderer. Dijaga oleh guard test yang hanya mengizinkan perubahan pada string command, review diff baris demi baris, dan E2E m4 di grup `e2e-import-cv`.
4. **ClamAV belum siap** (freshclam pertama) sehingga evidence/m2 gagal acak. Dijaga oleh wait loop 300 detik dengan pesan gagal eksplisit.
5. **Flaky dikenal** `activity-ui.spec.ts:356` membuat nightly merah. Tidak boleh disembunyikan. Catat frekuensinya di receipt Fase 4 sebagai data untuk follow-up.
6. **Supabase CLI di Linux berbeda dari Windows** (key `sb_secret` vs `SERVICE_ROLE_KEY`, nama container `supabase_db_WorkPulse` yang dipakai `cv-export-support.ts` dan `cv-export.spec.ts`). Dijaga oleh grup `integration` dan `e2e-import-cv` yang menjalankan suite tersebut.
