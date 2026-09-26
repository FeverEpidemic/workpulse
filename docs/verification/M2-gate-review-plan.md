# Handoff Gate M2 — integration review Capture dan penggunaan manual

> **Untuk agen pelaksana:** kerjakan fase berurutan dengan checkbox (`- [ ]`). Ini **review gate**, bukan task fitur. Jangan menambah fitur. Perbaikan hanya untuk temuan P0–P2 dan wajib memakai TDD: tulis test gagal → jalankan → perbaiki minimal → jalankan ulang → commit. Jangan membuat sub-agent.

- Tanggal: 26 September 2026
- Status saat handoff ditulis: Gate M2 **terbuka**. T06–T12 **DONE** pada acceptance lokal per task (lihat `docs/IMPLEMENTATION_STATUS.md`).
- Baseline: branch `claude/clever-archimedes-gbu7qd`, HEAD minimal `75025b5 docs(t12): record gate review and mark T12 done`.
- Pelaksana: satu agent di sesi baru (Claude atau GPT-6 Luna).
- Pemberi keputusan: **Claude**. Hanya Claude yang menulis verdict Gate M2 dan bagian authoritative `IMPLEMENTATION_STATUS.md`. Jika pelaksananya Claude, sign-off dilakukan pada Fase 7 di sesi yang sama setelah semua bukti lengkap. Jika pelaksananya bukan Claude, berhenti setelah Fase 6 dan serahkan receipt.
- Acuan: `IMPLEMENTATION_PLAN.md` §1, §3, §5 (T06–T12 dan kalimat **Gate M2**), §6; PRD R03–R08; User Flow F02–F06; Wireframe S04–S12; Database Schema §3/§4/§6; `Design.md`; `AGENTS.md`.

**Tujuan:** membuktikan kalimat gate di `IMPLEMENTATION_PLAN.md:210`:

> Gate M2: F02–F06 manual berjalan dari note hingga confirmed achievement, evidence privat dan timeline; tidak bergantung pada AI.

Setiap task sudah lulus per domain. Gate ini menguji **sambungan antar domain**: satu pengguna menjalankan alur utuh di browser nyata, lalu efek mutasi lintas fitur (delete, reopen, move, relink) tercermin konsisten di list, detail, Dashboard, dan Timeline tanpa kebocoran owner.

---

## 0. Cara memakai handoff ini

1. Baca dokumen ini sampai selesai sebelum menjalankan apa pun.
2. Baca `AGENTS.md`, bagian atas `docs/IMPLEMENTATION_STATUS.md` (T06–T12), dan `IMPLEMENTATION_PLAN.md` §3 serta §5 T06–T12.
3. Ekstrak F02–F06 dari `WorkPulse_User_Flow_v0.1.docx`, R03–R08 dari PRD, dan S04–S12 dari Wireframe dengan alat ekstraksi dokumen. Jangan menebak isi DOCX dari nama file.
4. Pertahankan perubahan lokal pengguna. Jangan commit, stash, reset, atau checkout atas nama pengguna selain commit pekerjaan gate sendiri.
5. Pada akhir setiap fase, tulis **receipt** ke `docs/verification/M2-gate-phaseN-<slug>.md`: tujuan, file berubah, command dan hasil aktual (exit code/angka test), temuan, blocker, dan langkah berikutnya.

## 1. Kriteria lulus Gate M2

Gate M2 **lulus** hanya jika semua poin berikut terbukti dengan hasil lokal nyata:

1. **Alur manual utuh (F02→F06).** Satu E2E browser baru berhasil dari awal sampai akhir: note → activity tersimpan → project → derived achievement → confirm → evidence privat `ready` melalui ClamAV nyata → Dashboard → Timeline → deep link kembali ke record canonical. Lihat Fase 3.
2. **Tanpa AI.** Alur di atas berjalan tanpa variabel AI apa pun. Tidak ada UI yang mengklaim analisis sedang berlangsung atau hasil AI tersedia.
3. **Konsistensi lintas fitur.** Mutasi di satu domain langsung tercermin di domain lain tanpa cache basi (Fase 4): count Dashboard, list terfilter, detail, dan Timeline sepakat.
4. **Retensi karya.** Delete activity/project/experience tidak menghapus achievement atau activity turunan secara tidak sengaja. Provenance dan konteks dibersihkan sesuai §3 rencana.
5. **Privasi evidence.** Evidence hanya dapat diunduh pemilik via signed URL ≤ 5 menit. File non-`ready` tidak dianggap evidence pendukung. Evidence tidak pernah tampil di Timeline atau Dashboard sebagai konten.
6. **Isolasi dua akun menyeluruh.** Akun B tidak dapat membaca, menghitung, memfilter, atau men-deep-link record A pada semua route M2. Hasilnya tidak membocorkan keberadaan record.
7. **Regresi penuh hijau.** Seluruh suite §8 lulus, termasuk evidence dengan ClamAV nyata. Flaky dicatat beserta bukti rerun dan penyebab.
8. **Tidak ada temuan P0–P2 terbuka.** Semua P0–P2 diperbaiki dan diuji ulang. P3 dicatat sebagai follow-up.

Gate M2 **tidak** mencakup AI (T13/T14), import (T15–T17), CV (T18–T22), account deletion menyeluruh (T23), atau performa (T24).

## 2. Scope

### 2.1 Dalam scope

- Audit acceptance T06–T12 terhadap bukti yang ada.
- Review kode lintas domain (read-only) dengan fokus pada sambungan antar fitur.
- Satu E2E lintas domain baru dan satu integration test lintas domain baru.
- Regresi seluruh suite lokal, termasuk ClamAV nyata.
- Perbaikan minimal untuk P0–P2 dengan test regresi.
- Laporan gate dan, oleh Claude, verdict serta status authoritative.

### 2.2 Di luar scope

Fitur baru, refactor, perubahan copy/desain non-P0–P2, migration kecuali perbaikan P0/P1 yang memerlukannya (wajib dengan decision baru di `docs/decisions/` dan persetujuan reviewer), AI, import, CV, deployment, layanan eksternal, dan `db reset` database aktif.

### 2.3 Klasifikasi temuan

| Level | Arti | Contoh | Tindakan |
| --- | --- | --- | --- |
| P0 | Kebocoran data/owner, kehilangan data, bypass screening | Akun B membaca evidence A; delete project menghapus achievement | Stop, perbaiki, uji ulang |
| P1 | Alur gate tidak dapat diselesaikan atau invariant rusak | Confirm gagal setelah relink; count Dashboard ≠ list | Perbaiki sebelum lulus |
| P2 | Acceptance task tidak terpenuhi atau pelanggaran WCAG AA | Filter hilang setelah back; focus hilang setelah dialog | Perbaiki sebelum lulus |
| P3 | Kosmetik, copy, flaky yang sudah dipahami, tech debt | Heading lama "Your workspace is ready" | Catat sebagai follow-up |

## 3. Input yang harus diaudit

| Task | Acceptance (ringkas, `IMPLEMENTATION_PLAN.md` §5) | Bukti |
| --- | --- | --- |
| T06 | Retry tanpa duplikasi, tanggal timezone, 10.001 karakter ditolak, conflict edit bersamaan, raw_text tanpa AI | `T06-activity-persistence.md` |
| T07 | Save gagal mempertahankan teks, filter dipertahankan saat kembali, deep link hilang aman, mobile/keyboard, Quick log terfokus | `T07-activity-ui.md` |
| T08 | Completed tanpa outcome tersimpan, standalone project valid, delete project mempertahankan experience dan activity | `T08-projects-context.md` |
| T09 | Confirm kualitatif tanpa angka/evidence, dismissed → draft sebelum confirm, draft tidak dihitung, race satu achievement per activity | `T09-manual-achievements-skills.md` |
| T10 | Race quota slot/byte, MIME spoof ditolak, reservation abandoned dilepas | `T10-evidence-backend.md`, `T10-scanner-runbook.md` |
| T11 | Move ke parent penuh ditolak tanpa kehilangan file, parent delete menutup akses, file project bukan direct evidence | `T11-evidence-ui-lifecycle.md` |
| T12 | Count = fixture = list, check → filter sumber, empty CTA benar, tanpa readiness/proficiency/streak | `T12-dashboard-timeline.md` |

Catat juga follow-up P3 yang masih terbuka dari setiap bukti di atas. Untuk T12 sudah tercatat: heading Dashboard lama, fallback konteks saat truncated, redirect sign-in S12 tanpa `record`, flaky Axe `achievements-ui.spec.ts:199`, dan warning `destination stream closed early`.

## 4. Environment

- Supabase lokal via Docker (`supabase_*_WorkPulse`) harus aktif. Jangan `db reset`.
- `.env.local` **tidak** memuat `SUPABASE_SECRET_KEY`. Untuk integration/E2E, ambil nilai lokal ke environment proses saja, jangan tulis ke file, log, atau receipt:

  ```powershell
  $st = pnpm exec supabase status -o env 2>$null
  $line = $st | Where-Object { $_ -match '^SECRET_KEY=' }
  if (-not $line) { $line = $st | Where-Object { $_ -match '^SERVICE_ROLE_KEY=' } }
  $env:SUPABASE_SECRET_KEY = ($line -replace '^[A-Z_]+="?','' -replace '"$','')
  ```

  Setiap panggilan tool PowerShell adalah proses baru, jadi ulangi baris ini dalam command yang sama dengan test.
- ClamAV nyata mengikuti `docs/verification/T10-scanner-runbook.md`: container `workpulse-t10-clamav` pada `127.0.0.1:13310`, image ter-pin. Periksa dulu apakah container sudah ada. Tunggu signature siap sebelum test. Hentikan dan hapus container **hanya** container itu pada akhir Fase 5. Jangan pernah mengganti dengan fake scanner.
- Tidak ada variabel AI. Pastikan tidak ada variabel `*AI*`/provider di environment proses saat menjalankan alur gate.
- Port E2E yang terpakai: 3000–3005. Pakai **3006** untuk config baru.

## 5. Fase eksekusi

### Fase 0 — Baseline (tanpa edit kode)

- [ ] Catat `git status --short --branch`, branch, dan HEAD. Working tree hanya boleh berisi `.claude/` yang tidak dilacak. Jika ada perubahan lain, stop dan tanyakan pengguna.
- [ ] `pnpm install --frozen-lockfile`, `pnpm db:status`, `pnpm exec supabase migration list --local`. Parity harus **21/21** dengan migration terakhir `20260927090000`.
- [ ] Baseline cepat: `pnpm lint`, `pnpm typecheck`, `pnpm test` (terakhir 44 file/203 test), `pnpm db:test` (terakhir 7 file/386 assertion).
- [ ] Start ClamAV sesuai §4, lalu catat versi engine dan umur signature.
- [ ] Receipt Fase 0.

### Fase 1 — Audit acceptance T06–T12 (read-only)

- [ ] Untuk setiap baris §3: baca acceptance di rencana, baca bukti, lalu tandai **Terbukti / Terbukti sebagian / Tidak terbukti**. Setiap tanda wajib merujuk test atau bagian bukti yang konkret (file:line atau nama test).
- [ ] Petakan F02, F03, F04, F05, F06 (dari DOCX) ke langkah UI dan test yang ada. Flow atau cabang recovery yang belum pernah diuji menjadi kandidat skenario Fase 3/4.
- [ ] Kumpulkan semua follow-up P3 terbuka dan acceptance "tidak dijalankan" dari bukti T06–T12 ke satu tabel.
- [ ] Receipt Fase 1 berisi matriks acceptance × bukti dan daftar celah.

### Fase 2 — Review kode lintas domain (read-only)

Baca kode nyata, bukan hanya test. Checklist minimum:

- [ ] **Ownership.** Setiap service di `src/features/{activity,project,achievement,evidence,dashboard,timeline,profile}` mengambil actor dari sesi (`auth.getUser`), bukan dari payload. Setiap RPC/tabel baru T06–T12 memiliki RLS owner dan composite FK `(user_id, parent_id)`. Grep `service_role`/secret key di `src/` untuk memastikan tidak ada jalur browser.
- [ ] **Revision dan idempotency.** Semua mutable save membawa `expected_revision`. Semua create yang dapat diulang memakai idempotency key scoped user + operasi. Periksa konsistensi pola antar domain.
- [ ] **Error contract.** Setiap error UI punya `code`, pesan terlokalisasi, dan correlation ID. Tidak ada pesan yang membedakan "tidak ada" dan "milik akun lain".
- [ ] **Deletion dan propagation** (§3 Data karier): delete activity mempertahankan achievement + source excerpt/revision; delete project mempertahankan activity/achievement dan experience-nya; delete experience membersihkan konteks tanpa menghapus karya; relink/konteks project atomik; evidence parent delete menutup akses baru dan mengantrikan cleanup.
- [ ] **Filter URL dan safe-return.** Semua key filter T07–T12 ada di reader, `src/domain/routes/safe-return.ts`, dan UI. Tidak ada filter yang hilang saat berpindah tab, next page, atau kembali dari detail.
- [ ] **Logging.** Grep `console.`/logger di `src/` dan `workers/`: tidak ada `raw_text`, isi note, filename, isi attachment, atau secret.
- [ ] **i18n.** Setiap key yang dipakai M2 ada di en dan id. Tidak ada copy terlarang (streak, readiness, proficiency, score, %, gap).
- [ ] **AI-free.** Tidak ada UI yang menyiratkan AI aktif sebelum T14 (§5 T07).
- [ ] Receipt Fase 2 berisi temuan terklasifikasi P0–P3 dengan file:line.

### Fase 3 — E2E alur manual lintas domain (kriteria §1.1, §1.2, §1.5)

- [ ] Buat `playwright.m2.config.ts` dengan menyalin `playwright.evidence.config.ts`: PORT **3006**, `testMatch: "m2-manual-journey.spec.ts"`, workers 1, timeout ≥ 300 detik.
- [ ] Tambahkan script `"test:e2e:m2": "playwright test --config playwright.m2.config.ts tests/e2e/m2-manual-journey.spec.ts"`.
- [ ] Tulis `tests/e2e/m2-manual-journey.spec.ts`. Pakai ulang helper `tests/e2e/helpers/accessibility.ts` dan `evidence-fixtures.ts`, serta pola `drain()` worker dari `tests/e2e/evidence-api.spec.ts` (scanner `clamav` 127.0.0.1:13310). User dibuat via admin dan dihapus pada `afterAll`.

  Seluruh langkah berikut dikerjakan **lewat UI** kecuali pembuatan akun dan drain worker:

  1. **Graduate tanpa CV/employment:** onboarding hanya dengan display name → masuk Dashboard kosong. *Add your first activity* membuka input terfokus. *Import CV* disabled.
  2. **F02 capture:** Quick log → tulis note → Save. Sukses hanya muncul setelah commit. Reload: note ada di `/activity` dengan `occurred_on` benar menurut timezone profil.
  3. **F04 project:** buat project `active` dari `/projects/new`, lalu tautkan activity tadi ke project. Detail project menampilkan activity.
  4. **F03 achievement:** dari detail activity buat derived achievement. Konteks project terpropagasi. Isi title/contribution/outcome/achieved_on/cv_bullet dan satu skill → Confirm. Tanpa metrics dan tanpa evidence, confirm tetap berhasil.
  5. **Dashboard setelah confirm:** confirmed 1, current projects 1, skill 1, check missing evidence 1. Link check → list berisi tepat achievement ini.
  6. **F05 evidence:** upload PDF bersih pada achievement → status scanning → `drain()` → `ready`. Download menghasilkan byte identik dan URL bertanda tangan. Dashboard: missing evidence menjadi 0 dan menampilkan "No checks need attention".
  7. **Evidence activity tidak diwariskan:** upload file ke activity → `ready`. Check missing evidence pada achievement lain yang dibuat tanpa evidence tetap dihitung.
  8. **F06 timeline:** achievement muncul di grup tahun yang benar dengan konteks project. Project muncul sebagai *Started …*. Tambah satu experience di S12, lalu event experience muncul. Klik event → editor canonical terbuka (`<details>` open untuk experience).
  9. **Isolasi:** login sebagai akun B, lalu buka langsung URL detail activity/achievement/project/evidence download milik A. Hasilnya unavailable tanpa existence leak, dan Dashboard/Timeline B tidak memuat judul A.
  10. **AI-free:** pada setiap halaman alur, `getByText(/analyz|menganalisis|AI suggestion|saran AI/i)` berjumlah 0, kecuali copy yang secara eksplisit menyatakan AI belum tersedia.
  11. **Aksesibilitas:** `expectNoWcagViolations` pada Dashboard, detail achievement dengan evidence, dan Timeline. Alur 2–4 dapat diselesaikan keyboard-only dengan focus terlihat. Satu pass pada 360×800 dark tanpa horizontal overflow.

- [ ] Jalankan hingga lulus. Kegagalan karena bug produk = temuan (klasifikasikan). Jangan melemahkan asersi.
- [ ] Commit: `test(m2): add manual cross-domain journey`.
- [ ] Receipt Fase 3 berisi hasil dan screenshot `testInfo.attach` (jalankan sekali dengan `--reporter=html` dan `PLAYWRIGHT_HTML_OPEN=never` agar screenshot tersimpan di `playwright-report/`).

### Fase 4 — Integration lintas domain (kriteria §1.3, §1.4, §1.6)

- [ ] Buat `tests/integration/m2-cross-domain.test.ts` dengan pola `tests/integration/dashboard-timeline.test.ts` (admin + owner A + owner B via sign-in nyata, service layer nyata). Tambahkan script `"test:integration:m2"`.
- [ ] Setiap skenario mengukur **sebelum dan sesudah** mutasi melalui `getDashboard()`, `listAchievements`/`listProjects`/list activity dengan filter terkait, dan `getTimeline()`:
  1. **Delete activity** sumber derived confirmed achievement → achievement tetap ada, tetap confirmed, source excerpt/revision tersimpan. Recent activity Dashboard berkurang dan confirmed count tetap.
  2. **Delete project** → activity dan achievement tetap ada dengan `project_id` NULL dan experience dipertahankan. Current projects berkurang. Event project hilang dari Timeline dan konteks achievement menjadi experience atau *Independent*.
  3. **Delete experience** → konteks project/achievement dibersihkan tanpa menghapus karya. Event experience hilang dari Timeline.
  4. **Relink project ke experience lain** → derived achievement mengikuti konteks secara atomik. Timeline menampilkan konteks baru.
  5. **Reopen confirmed → draft** → confirmed, skill, dan missing-evidence count turun serta event Timeline hilang. Confirm ulang → semuanya kembali.
  6. **Move evidence activity → achievement** (derived yang sama) → missing evidence achievement turun 1. Quota bytes akun tidak bertambah.
  7. **Delete evidence `ready`** satu-satunya pada achievement confirmed → missing evidence naik 1 dan URL baru tidak dapat diterbitkan.
  8. **Isolasi:** untuk setiap service M2, sesi B dengan ID milik A menghasilkan hasil kosong atau error unavailable yang sama dengan ID acak, tanpa perbedaan kode.
- [ ] Jalankan hingga lulus. Count ≠ list atau karya hilang adalah **P0/P1**, jangan ubah expectation.
- [ ] Commit: `test(m2): add cross-domain consistency integration`.
- [ ] Receipt Fase 4.

### Fase 5 — Regresi penuh

- [ ] Jalankan seluruh §8 dan catat angka aktual. Suite evidence wajib dijalankan dengan ClamAV nyata.
- [ ] Untuk kegagalan: rerun sekali. Jika lulus saat rerun, catat sebagai flaky beserta pesan error dan dugaan penyebab (P3 kecuali menyentuh acceptance). Jika gagal konsisten, jadikan temuan.
- [ ] Hentikan dan hapus container `workpulse-t10-clamav` sesuai runbook. Jangan hentikan stack Supabase.
- [ ] Receipt Fase 5.

### Fase 6 — Perbaikan P0–P2 dan skenario rilis parsial

- [ ] Untuk setiap P0–P2 dari Fase 1–5: tulis test gagal, perbaiki minimal, jalankan ulang suite domain terkait serta `test:e2e:m2`/`test:integration:m2`. Satu commit per temuan: `fix(m2): <ringkas>`.
- [ ] Petakan skenario rilis PRD (`IMPLEMENTATION_PLAN.md` §6) yang relevan untuk M2 ke bukti:
  - graduate tanpa CV/employment → Fase 3 langkah 1;
  - note saat AI unavailable → Fase 3 langkah 2 dan 10 (bagian stale retry menunggu T13/T14);
  - concurrent evidence quota → bukti T10 race + regresi evidence;
  - ownership dua akun → Fase 3 langkah 9 dan Fase 4 skenario 8 (bagian PDF menunggu T21/T22).
- [ ] Susun laporan draft `docs/verification/M2-gate-review.md`: ringkasan, matriks kriteria §1 (PASS/FAIL + bukti), matriks acceptance T06–T12, temuan per level dengan status (fixed/open), tabel command dan hasil, flaky, tidak dijalankan beserta alasan, dan batas (lokal saja, bukan production).
- [ ] **Jangan** menulis verdict atau mengubah `IMPLEMENTATION_STATUS.md` pada fase ini.
- [ ] Jika pelaksana bukan Claude: berhenti di sini dan serahkan hash commit, receipt Fase 0–6, dan laporan draft.

### Fase 7 — Verdict (Claude)

- [ ] Verifikasi ulang secara independen: baca diff perbaikan, jalankan ulang minimal `test:e2e:m2`, `test:integration:m2`, gate dasar, dan suite yang disentuh perbaikan.
- [ ] Tetapkan verdict di `M2-gate-review.md`: **PASSED** hanya bila semua kriteria §1 PASS dan tidak ada P0–P2 terbuka. Selain itu **BLOCKED**, disertai daftar kerja konkret.
- [ ] Update `IMPLEMENTATION_STATUS.md`: tambahkan bagian "Gate M2" di atas dengan verdict, bukti, dan langkah berikutnya (T13 bila PASSED). Perbarui snapshot di `AGENTS.md` dan `docs/AGENTS.md` (keduanya harus identik). Hapus kalimat "Gate M2 masih terbuka" yang kini usang hanya pada snapshot tersebut. Riwayat lama dibiarkan.
- [ ] Commit: `docs(m2): record gate review verdict`.

## 6. Stop conditions

Berhenti dan laporkan bukti, jangan berimprovisasi, bila:

- Working tree berisi perubahan pengguna selain `.claude/` pada Fase 0.
- Parity migration ≠ 21/21, atau penyelesaian membutuhkan `db reset`, rewrite migration lama, atau operasi destruktif.
- ClamAV tidak dapat dijalankan secara lokal. Tandai kriteria §1.5/§1.7 **tidak terbukti** dan jangan memakai fake scanner.
- Temuan P0 (kebocoran owner atau kehilangan data). Laporkan segera sebelum memperbaiki bila perbaikan memerlukan migration atau mengubah kontrak.
- Perbaikan terasa memerlukan fitur baru, AI, import, CV, atau perubahan scope produk.
- Test apa pun memerlukan layanan eksternal atau deployment.

## 7. Commands (§8)

Jalankan melalui pnpm. Catat command, exit code, dan angka aktual. Integration/E2E memerlukan `SUPABASE_SECRET_KEY` di environment proses (§4).

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:test
pnpm db:lint
pnpm exec supabase migration list --local
pnpm test:integration:activity
pnpm test:integration:projects
pnpm test:integration:achievements
pnpm test:integration:storage
pnpm test:integration:evidence
pnpm test:integration:dashboard
pnpm test:integration:m2
pnpm test:e2e:auth
pnpm test:e2e:ui
pnpm test:e2e:activity
pnpm test:e2e:projects
pnpm test:e2e:achievements
pnpm test:e2e:evidence
pnpm test:e2e:dashboard
pnpm test:e2e:m2
pnpm worker:check
pnpm build
git diff --check
```

Catatan: `test:e2e:evidence` juga menjalankan ulang spec activity/projects/achievements pada port 3004. Script baru hanya boleh dilaporkan lulus setelah benar-benar ditambahkan dan dijalankan.

## 8. Prompt untuk memulai sesi baru

```text
Jalankan integration review Gate M2 WorkPulse sesuai handoff
docs/verification/M2-gate-review-plan.md. Baca handoff itu sampai selesai,
lalu AGENTS.md, bagian atas docs/IMPLEMENTATION_STATUS.md, dan
IMPLEMENTATION_PLAN.md §3, §5 (T06–T12), §6.

Kerjakan fase berurutan dan tulis receipt tiap fase. Jangan menambah fitur;
perbaiki hanya temuan P0–P2 dengan TDD. Pakai ClamAV nyata sesuai
T10-scanner-runbook.md dan jangan memakai fake scanner. Jangan db reset.
Ambil SUPABASE_SECRET_KEY lokal ke environment proses saja, jangan tulis ke
file. Patuhi stop conditions §6. Verdict Gate M2 dan status authoritative
hanya ditulis oleh Claude pada Fase 7.
```
