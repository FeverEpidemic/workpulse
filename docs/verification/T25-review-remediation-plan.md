# Rencana Remediasi Review T25 · Regression, aksesibilitas, dan release handoff

Status plan: **TODO**.

- Tanggal: 11 Oktober 2026.
- Reviewer: Claude (Opus). Gate review read-only setelah Fase 8, mengacu ke `T25-implementation-plan.md` §9–§10.
- HEAD yang direview: `4574d9a`, branch `claude/clever-archimedes-gbu7qd`. HEAD Fase 0: `6e861f2`.
- Lingkungan review: worktree bersih di HEAD (`git worktree add --detach`, `pnpm install --frozen-lockfile`), jadi perubahan Storybook dari sesi lain di working tree utama tidak ikut. Stack Supabase aktif 36/36, ClamAV T10, Gotenberg T15, dan `workpulse-t21-pdf` hidup. Stack tidak di-reset.
- Mode antislop: **during** (dipilih pengguna untuk sesi review ini).
- Verdict awal (HEAD `4574d9a`): **BELUM LULUS. Satu temuan P2 terbuka (RV1).**
  - Tidak ada P0 atau P1.
  - Status T25 tetap **PARTIAL**: bagian authoritative `IMPLEMENTATION_STATUS.md` tidak diubah.
  - Terlepas dari RV1, T25 tidak dapat DONE selama Fase 7 (staging) BLOCKED, sesuai keputusan §2.4.1. Setelah RV1 ditutup, rekomendasi status tetap **PARTIAL** dengan blocker B1 (staging) dan B2 (retensi backup).
- Batas eksekusi remediasi:
  - satu agent, tanpa sub-agent, TDD (test gagal → perbaikan minimal → lulus);
  - tanpa migration, tanpa perubahan `src/`, `workers/`, atau `supabase/`;
  - tanpa `db reset`, tanpa dependency baru;
  - golden aria tidak ditulis ulang. Isinya sudah benar (lihat §2).
- Setelah review ulang lulus, lanjutkan Fase 9 plan: decision 0031, `T25-release-handoff.md`, README.

## 1. Ringkasan temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | `pnpm test:e2e:release` gagal pada checkout bersih di Windows: snapshot aria S04, S05, S08, S13, S14 dibaca sebagai CRLF (`core.autocrlf=true`) dan dibandingkan dengan snapshot LF tanpa normalisasi. Pesan kegagalannya juga salah ("line 0: expected undefined, got undefined"). Bukti §1.11 tidak dapat diulang di clone baru | Terbuka |
| N1 | P3 | `T25-release-checklist.md` bagian 3 belum diperbarui setelah Fase 8: "Regresi penuh" masih `[ ]`, tanggal masih 10 Oktober | Perbaiki di Fase 9 |
| N2 | P3 | Receipt Fase 8, tabel "Perubahan source", menulis "integration 2 file (13 test)"; run nyata dan tabel di atasnya 12 test | Perbaiki di Fase 9 |
| N3 | P3 | `release-ownership.test.ts:524` hanya memeriksa insert B menghasilkan error apa pun; receipt Fase 2 menyatakan `42501`. Saat ini benar (`authenticated` tidak punya privilege `INSERT`, O5), tetapi error lain (mis. `23502` not null) juga akan lulus bila privilege suatu saat dibuka dan RLS `with check` longgar. Itu persis risiko §10.2 | Follow-up: assert `42501`, atau `42501`/`23xxx` hanya dengan alasan per tabel |
| N4 | P3 | Runbook §7 (restore) tidak menyebut bahwa restore database hosted tidak memulihkan objek Storage. Setelah restore, baris dapat merujuk objek yang sudah tidak ada. Perilaku cleanup dan penghapusan akun untuk objek yang hilang hanya diuji lokal dengan objek yang masih ada (`release-restore.test.ts`) | Tambah satu kalimat di runbook §7 + item verifikasi di checklist (Fase 7 atau operator) |
| N5 | P3 | Skenario rilis 2 dan 3 ditutup sebagai *rangkaian* test, bukan satu journey dari onboarding sampai PDF / dari AI unavailable sampai stale. Diterima oleh §1.2 ("rangkaian test bernama") | Diterima |
| N6 | P3 | NVDA nyata (§6.4) belum dijalankan; proxy snapshot aria ada | Diterima; tetap tercatat di checklist |

Catatan P3 pelaksana (O1–O13, D10, F1–F4) sudah dibaca reviewer. Klasifikasinya diterima.

## 2. RV1 · Snapshot aria gagal pada checkout CRLF (P2)

### Gejala

Reviewer menjalankan `pnpm test:e2e:release` di worktree baru dari HEAD `4574d9a`:

- 14 passed, 1 failed: `release-a11y.spec.ts:278` › "accessibility tree of S04, S05, S08, S13 and S14 is locked (screen reader proxy)".
- Kelima layar dilaporkan berbeda dengan pesan `at line 0: expected undefined, got undefined`.

Pemeriksaan:

- `git ls-files --eol docs/verification/T25-aria` → `i/lf w/lf` di working tree pelaksana (file ditulis langsung oleh test, tidak pernah di-checkout ulang).
- Di worktree reviewer: `s04-dashboard.aria.yml` berisi 86 CR dan 86 LF; di working tree pelaksana 0 CR.
- Setelah kelima golden di worktree reviewer dikonversi ke LF, test yang sama lulus (`-g "screen reader proxy"`, 1 passed). Jadi isi accessibility tree cocok; hanya line ending yang berbeda.

Akibat: siapa pun yang meng-clone repo di Windows dengan setelan git bawaan (`core.autocrlf=true`) mendapat suite rilis merah. CI01 di runner Windows akan gagal dengan cara yang sama. Acceptance §1.11 menuntut snapshot "dikunci di E2E"; kunci yang hanya lulus di satu working tree tidak memenuhi itu.

### Penyebab

`tests/e2e/release-a11y.spec.ts:293`:

```ts
else if (readFileSync(file, "utf8").trimEnd() !== snapshot.trimEnd()) {
```

membandingkan teks mentah. Baris 295–297 memecah dengan `split(/\r?\n/)`, yang membuang `\r`, sehingga tidak ada baris yang berbeda dan `findIndex` mengembalikan `-1` (pesan "line 0").

Repo tidak punya `.gitattributes`, jadi line ending golden bergantung pada setelan git tiap mesin.

### Perbaikan minimal (test saja)

1. Pindahkan perbandingan ke fungsi murni di `tests/e2e/helpers/accessibility.ts` (file helper ini sudah diubah T25), mis. `compareAriaSnapshot(expected: string, actual: string): { line: number; expected: string; actual: string } | null`:
   - normalisasi kedua sisi: `\r\n` → `\n`, lalu `trimEnd()`;
   - kembalikan `null` bila sama;
   - bila berbeda, kembalikan baris pertama yang berbeda **termasuk** kasus satu sisi lebih panjang (baris yang hilang dilaporkan sebagai `""` atau penanda `<end of file>`, bukan `undefined`).
2. `release-a11y.spec.ts:293–300` memakai fungsi itu; pesan kegagalan menyebut nomor baris ≥ 1 dan kedua isi baris.
3. Penulisan golden (`WRITE_ARIA`) tetap `snapshot + "\n"` (LF).
4. Jangan menambah `.gitattributes` di remediasi ini. Normalisasi di test sudah cukup, dan `.gitattributes` akan mengubah perilaku checkout seluruh repo (screenshot, dokumen). Catat sebagai opsi CI01.

### Test regresi (gagal dulu, lalu lulus)

- **Unit baru** `tests/unit/aria-snapshot-compare.test.ts` (unit config sudah mencakup `tests/unit`):
  - golden CRLF vs snapshot LF dengan isi sama → `null` (gagal sebelum perbaikan karena fungsi belum ada / perbandingan mentah);
  - satu baris berbeda di tengah → nomor baris yang benar (1-based) dan kedua isi;
  - snapshot lebih panjang atau lebih pendek dari golden → dilaporkan, tanpa `undefined`;
  - spasi di akhir file tidak dihitung.
- **Reproduksi E2E nyata:** buat worktree baru dari commit perbaikan (`git worktree add --detach <scratch> HEAD`; `core.autocrlf=true` bawaan mesin ini), pastikan `git ls-files --eol` atau hitungan byte menunjukkan golden CRLF di worktree itu, lalu `pnpm install --frozen-lockfile` dan `pnpm test:e2e:release`: **15 passed**. Catat juga run yang sama pada HEAD `4574d9a` (1 failed) sebagai bukti gagal-dulu. Hapus worktree setelahnya (`git worktree remove`).
- **Mutasi:** ubah satu baris golden di worktree scratch (mis. nama tombol). Test harus gagal dengan pesan yang menyebut nomor baris dan isi baris itu. Pulihkan.

## 3. Checks yang wajib diulang setelah remediasi

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:release
git diff --check
```

- `pnpm test:e2e:release` dijalankan di working tree pelaksana **dan** di worktree bersih CRLF (§2).
- Bila working tree masih membawa perubahan Storybook sesi lain, jalankan Playwright lewat `node node_modules/@playwright/test/cli.js test --config playwright.release.config.ts` (O12) atau di worktree bersih.
- Env per command mengikuti §7 plan: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.
- Setelah run E2E, pulihkan PNG/JSON T22–T24 yang tertulis ulang dengan `git checkout` (F4) dan pastikan `git diff --stat` hanya berisi file remediasi.

Tulis receipt `docs/verification/T25-phase8b-remediation.md` berisi:

- output test yang gagal sebelum perbaikan (unit dan E2E CRLF);
- perubahan helper dan spec;
- hasil mutasi;
- command, exit code, dan angka.

Commit `fix(t25): compare locked aria snapshots without line endings`, lalu `test(t25): record review remediation receipt`. Commit file per path; jangan ikut mengomit perubahan Storybook.

## 4. Hasil verifikasi ulang reviewer (HEAD `4574d9a`)

Semua command dijalankan reviewer sendiri pada 11 Oktober 2026 di worktree bersih, env dimuat per proses.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | lockfile cocok |
| `pnpm lint` | 0 | lulus |
| `pnpm typecheck` | 0 | lulus |
| `pnpm test` | 0 | 117 file / 1064 test (tanpa Storybook; receipt Fase 8 mencatat 124/1093 karena config Storybook sesi lain) |
| `pnpm db:test` | 0 | 20 file / 1638 assertion, PASS |
| `pnpm db:lint` | 0 | lulus |
| `pnpm exec supabase migration list --local` | 0 | 36/36, terakhir `20261012090000` |
| `pnpm test:integration:release` | 0 | 2 file / 12 test |
| `node workers/ops-check.ts` (env stack lokal) | 0 | `status: ok`, 8 metrik 0, ambang default |
| `ops-check` dengan `WORKPULSE_ALERT_JOBS_FAILED_24H=abc` | 1 | `OPS_CONFIG_INVALID`, `metrics: []` |
| `ops-check` dengan `SUPABASE_URL=http://127.0.0.1:1` | 1 | `OPS_BACKEND_UNAVAILABLE` |
| `ops-check` dengan key salah | 1 | `OPS_BACKEND_UNAVAILABLE`; tanpa URL, key, atau stack di keluaran |
| `pnpm worker:check` | 0 | `status: ready`, 9 job |
| `pnpm test:e2e:release` | 1 | 14 passed, 1 failed (RV1); `next build` di dalamnya lulus |
| `test:e2e:release -g "screen reader proxy"` setelah golden dikonversi LF | 0 | 1 passed |
| `pnpm test:e2e:m2` (env AI dikosongkan) | 0 | 1 passed |
| `pnpm test:e2e:evidence` | 0 | 8 passed (termasuk `activity-ui`, D12) |
| `pnpm test:e2e:account-deletion` | 0 | 7 passed |
| `git diff --check 6e861f2..HEAD` | 0 | bersih |

Tidak dijalankan ulang oleh reviewer: clean rebuild Fase 5 (stack sekali pakai), `test:perf`, dan suite §7 lain. Buktinya receipt Fase 5 dan Fase 8; perubahan source T25 terbatas pada token warna, satu paragraf S12, dan dua utility `h1`, sehingga reviewer mengambil sampel E2E yang menyentuh layar itu dan jalur manual M2.

## 5. Yang sudah lulus review

- **Katalog database.** `release_catalog.test.sql` membaca `pg_class`, `pg_attribute`, `pg_trigger`, `pg_proc`, `has_*_privilege`, dan `storage.buckets`; allowlist `anon` kosong dan eksplisit. Delapan aturan, sebelas probe pelanggar dalam subtransaksi yang di-rollback, dua kontrol negatif, dan batas non-vakum. Aturan kolom dan `USAGE` skema `internal` melampaui plan dan beralasan.
- **Isolasi dua akun.** Query katalog independen reviewer: 18 tabel `public` (17 ber-`user_id` + `profiles`), 9 tabel `internal`, 0 tabel pengguna di skema lain, 0 tabel `public` dengan privilege tulis untuk `authenticated`. Cocok dengan suite, yang juga gagal bila tabel `public` baru tidak punya kolom pemilik (risiko §10.1). Daftar parameter RPC ber-ID berasal dari katalog dan gagal dua arah (kasus hilang, kasus basi). Seluruh FK `public` antar tabel menyertakan `user_id` (hanya `profiles → auth.users` dan `evidence_files → internal.evidence_scan_jobs` yang tidak), jadi ID asing yang diselipkan di `p_changes` jsonb tidak dapat menautkan record lintas akun. Route dan storage: ID asing identik dengan ID acak, pemilik dijawab berbeda, digest objek A tidak berubah.
- **Restore.** `release-restore.test.ts` mengikuti §2.2.9: ekspor id sesudah titik restore, simulasi restore, `begin_account_deletion` ulang sampai `completed`, `P0002` untuk id yang tidak ada. Lihat N4 untuk batas objek Storage.
- **Health.** `get_operational_health` `security definer`, `search_path = pg_catalog`, `revoke` dari `public, anon, authenticated` lalu grant hanya `service_role`. Hanya kolom `metric`/`value`. `account_deletion_overdue` memakai aturan yang sama dengan `get_account_deletion_backlog` (`status <> 'completed'` dan `requested_at` ≥ 24 jam; T23 memakai `clock_timestamp()`, T25 `p_now`). Kolom status dan lease cocok dengan constraint T05/T10/T15/T21/T23. `ops:check` fail-closed: env tidak valid, backend tidak terjangkau, jawaban dengan jumlah atau nama metrik salah → exit 1.
- **Kontras.** Reviewer menghitung ulang 10 pasangan dengan `contrast-check.py`: dark `border-control` pada elevated 3,18:1 dan pada subtle 3,38:1 (non-teks ≥ 3:1); seleksi dark 6,52:1; teks sekunder dark pada elevated 7,79:1; focus ring dark 9,68:1; danger dark 7,32:1; teks sekunder light pada subtle 5,65:1; `border-control` light 3,67:1; focus ring light 6,82:1; danger light 6,68:1. Semua cocok dengan `theme-contrast.test.ts`.
- **Screenshot.** Reviewer membuka `s12-settings-360-dark`, `s12-delete-dialog-1440-light`, `s08-achievement-confirmed-360-light`, `s14-preview-1440-dark`: tanpa overflow, email di-mask, judul panjang S08 terbungkus, kalimat S12 tampil. Tombol pudar di dialog dan S14 adalah state disabled (dikecualikan WCAG 1.4.3).
- **Copy S12.** en dan id setara dan sesuai §2.4.3. Klaimnya benar: trigger T24 mencatat nama aksi dan properti allowlist tanpa teks, nama file, id, atau email (`product-events` integration + pgTAP). Tanpa em dash, tanpa angka, tanpa klaim keamanan baru.
- **Defect UI.** D9/D10 (token), D11 → D12 (wrap hanya pada dua `h1` berisi judul pengguna). Komponen lain yang menampilkan teks pengguna sudah punya `overflow-wrap: anywhere` per kelas di `globals.css` (35 aturan sebelum T25), jadi pencabutan aturan global D11 tidak membuka overflow baru; matriks 200% dan 360 px lulus di run reviewer.
- **Runbook dan checklist.** Rollback forward-fix tanpa langkah yang menghapus data. Retensi backup dan restore hosted tertulis **belum terverifikasi**. Delapan BLOCKER production. Paritas env dijaga `release-docs.test.ts`.
- **Matriks.** Sampel enam nama test dari matriks (`cv-export` graduate scenario, `cv-freshness` override, `ai-jobs` 10, `evidence-backend` last-slot, `import-commit` 1, `import-review.spec` R02) ada di source.
- **Hygiene.** Migration baru hanya `20261012090000_t25_operational_health.sql` (ditambah migration T24 dari merge `origin/main`). Tidak ada dependency baru. `git diff --check` bersih.

### Delivery Gate antislop (layar dan token yang diubah T25)

Cakupan: S12 (paragraf baru), token `border-control` dark dan `selection-bg`, utility `wrap-anywhere` pada `h1` S08 dan S10.

| Item | Hasil |
| --- | --- |
| R-02 em dash | PASS: kedua kalimat S12 tanpa `—`; `account-deletion-i18n.test.ts` menolaknya |
| R-03 mobile | PASS: matriks 360 px dan teks 200% pada 720/360/320 px lulus di run reviewer; screenshot 360 tanpa overflow |
| R-17, R-18, R-36, R-38 | PASS: kalimat S12 menyatakan perilaku T24 yang diuji; tanpa angka atau klaim baru |
| R-23, R-24, R-26 | PASS: tidak ada aset, navigasi, atau kontrol baru |
| R-25 kontras | PASS: 10 pasangan dihitung ulang dengan skrip; Axe `color-contrast` bersih di 80 + 8 tampilan |
| R-27 state | PASS: kartu S12 tidak memuat data; state lain tidak berubah dan dicakup matriks |
| R-32 keyboard | PASS: `release-keyboard.spec.ts` lulus di run reviewer (journey, empat dialog, ring ≥ 3:1) |
| R-33 | PASS: perubahan ditulis di source (`tokens.css`, `globals.css`, `.tsx`) |
| R-34 tema | PASS: kedua tema di matriks; dark selection kini terbaca |
| R-35 dijalankan | PASS: build produksi dan click-through oleh spec di run reviewer |
| R-37 arah | PASS: arah dari `Design.md`; perubahan tidak menambah elemen visual |
| Block 2 (R-01, R-04 … R-22) | PASS: tidak ada gradien, ikon, badge, glow, bayangan, animasi, atau ilustrasi baru |
| Block 3 liveliness | Tidak berlaku: tidak ada layar baru; dial dan motif dari `Design.md` tidak berubah |
| Block 4 (C-1 … C-5) | PASS: setiap perubahan punya alasan tercatat (D9–D12, §2.4.3); tidak ada yang rusak per tema, breakpoint, atau tanpa mouse |
| Human checklist | PASS untuk kontras teks/non-teks, focus di dua tema, keyboard dan Escape, state, teks 200%. Keyboard mobile menutupi input tidak diuji di perangkat nyata (tidak ada input baru) |

## 6. Catatan lingkungan (bukan temuan T25)

- Working tree utama masih membawa perubahan Storybook dari sesi lain (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `eslint.config.mjs`, `.gitignore`, `.storybook/`, `src/components/ui/*.stories.tsx`, `public/`, `docs/IMPLEMENTATION_STATUS.md`, dua dokumen `storybook-ai-setup*`). Reviewer tidak menyentuh atau mengomitnya. `"playwright": "latest"` di sana memicu O12.
- Database lokal masih menyimpan akun `wp-*` dari suite lama (O3); jumlahnya naik setiap regresi penuh.
