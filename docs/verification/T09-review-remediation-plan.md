# Rencana Remediasi Review T09 — Achievements dan Recovery

Tanggal: 24 September 2026.

Status plan: **DONE; acceptance lokal selesai 25 September 2026**. Remediasi dan seluruh
integration/browser checks yang tertunda sudah lulus. T09 dan dependensi T08 berstatus DONE; T10
tetap TODO; Gate M2 masih terbuka sampai task M2 berikutnya selesai.

Dokumen ini merencanakan perbaikan enam item review dan mencatat bukti eksekusi pada bagian berikut.

## Checkpoint awal — 24 September 2026 (historis, Docker belum tersedia)

RV1–RV6 telah ditangani pada implementasi: retry mempertahankan lifecycle action dan input lokal;
cursor tanggal mencakup seluruh row NULL-date; helper metrics yang tidak dipakai dihapus sementara
jalur aktif tetap menolak blank; redirect existing record berjalan di luar error boundary; sign-in
resume mempertahankan route create, source, dan return destination; sanitizer return membatasi URL
hingga 500 karakter dan empat tingkat nesting serta mengizinkan round-trip Activity/Achievement.
Regresi unit, integration, dan E2E telah ditambahkan. Tidak ada migration, perubahan schema/RPC,
backfill, atau reset database.

| Check | Hasil aktual |
| --- | --- |
| Unit Vitest, semua unit | Exit 0; `node node_modules/vitest/vitest.mjs run --configLoader native`; 32 file / 159 tests. |
| TypeScript | Exit 0; `node node_modules/typescript/bin/tsc --noEmit --incremental false`. |
| ESLint | Exit 0; `node node_modules/eslint/bin/eslint.js . --max-warnings 0`. |
| Production build | Exit 0; production build Next.js berhasil. |
| `git diff --check` | Exit 0; hanya warning normal LF/CRLF. |
| Achievement/Project database integration | Belum dijalankan: Docker Desktop Linux engine tidak tersedia (`npipe:////./pipe/dockerDesktopLinuxEngine`). |
| Achievement/Auth/Activity/Project browser E2E | Belum dijalankan karena local Supabase/database fixture tidak tersedia. |
| Package-manager wrapper | `pnpm exec vitest` berhenti saat Corepack mencoba mengambil metadata dari registry; tidak ada dependency/lockfile yang berubah. Check lokal dijalankan dengan binary terpasang. |

Pada checkpoint ini T09 masih PARTIAL karena local Docker belum tersedia. Blocker tersebut ditutup
pada 25 September; hasil terkini dicatat berikutnya.

## Hasil acceptance lokal — 25 September 2026 (status terkini)

Docker Desktop tersedia (server 29.6.1), dan local Supabase berhasil dipakai untuk semua acceptance
database/browser yang diwajibkan rencana ini. Tidak ada migration, schema/RPC change, backfill,
`db reset`, atau perubahan dependency. Supabase melaporkan `imgproxy` dan `pooler` berhenti; keduanya
tidak dipakai oleh suites berikut.

| Check | Hasil aktual |
| --- | --- |
| Achievement database integration | Exit 0; 1 file / 5 tests, termasuk pagination NULL-date dan owner isolation. |
| Project database integration | Exit 0; 1 file / 7 tests, termasuk candidate filtering/pagination dan context race. |
| Achievement browser E2E | Exit 0; 3/3, termasuk sign-in resume, retry seluruh lifecycle action dan alternatif Reopen, metrics validation/preservation, source handoff, Axe, dan viewport mobile. |
| Auth browser E2E | Exit 0; 1/1, termasuk create resume standalone, Activity, Project, dan session-expired recovery. |
| Activity browser E2E | Exit 0; 1/1, termasuk context dan revision recovery. |
| Project browser E2E | Exit 0; 1/1, termasuk context prefill dan dependency delete. |
| Unit Vitest | Exit 0; 32 file / 159 tests. |
| TypeScript | Exit 0; `node node_modules/typescript/bin/tsc --noEmit --incremental false`. |
| ESLint | Exit 0; `node node_modules/eslint/bin/eslint.js . --max-warnings 0`. |
| Production build | Exit 0; `node node_modules/next/dist/bin/next build`. Build dijalankan dengan akses workspace karena sandboxed write ke `.next` mengembalikan `EPERM`. |
| `git diff --check` | Exit 0; tracked diff bersih, hanya warning normal konversi LF/CRLF. File T09 baru/untracked dicek tanpa temuan baru; dua spasi pada baris tanggal dipertahankan sebagai hard-break Markdown. |

Perintah database/browser dijalankan dari root repository. Variabel URL, publishable key, dan server
key local Supabase diberikan ke proses dari output status CLI tanpa mencetak nilainya. Perintah
suite:

```text
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader native tests/integration/achievement-lifecycle.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader native tests/integration/project-context.test.ts
node node_modules/@playwright/test/cli.js test --config playwright.achievements.config.ts tests/e2e/achievements-ui.spec.ts
node node_modules/@playwright/test/cli.js test --config playwright.auth.config.ts tests/e2e/auth-profile.spec.ts
node node_modules/@playwright/test/cli.js test --config playwright.activity.config.ts tests/e2e/activity-ui.spec.ts
node node_modules/@playwright/test/cli.js test --config playwright.projects.config.ts tests/e2e/projects-ui.spec.ts
node node_modules/vitest/vitest.mjs run --configLoader native
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js . --max-warnings 0
node node_modules/next/dist/bin/next build
git diff --check
```

Matriks penerimaan review kini lengkap dan lulus; T09 remediasi berstatus **DONE**. `pgTAP`, DB lint,
migration parity, serta disposable rebuild tidak diulang karena scope remediasi tidak mengubah SQL;
bukti T09 sebelum review tetap tercatat di [verification T09](T09-manual-achievements-skills.md).
E2E mengeluarkan warning non-blocking Node `NO_COLOR` dan Next.js `destination stream closed early`
saat navigasi dibatalkan; seluruh assertion tetap lulus. Jangan mulai T10 dalam remediasi ini.

## 1. Dasar dan koreksi hasil review

Acuan: `AGENTS.md` dan `docs/AGENTS.md`; [rencana utama](../IMPLEMENTATION_PLAN.md) §1,
§3–4, acceptance T09 dan matriks §6; [checkpoint](../IMPLEMENTATION_STATUS.md);
[plan T09](T09-implementation-plan.md); [verification T09](T09-manual-achievements-skills.md);
[decision 0014](../decisions/0014-t09-achievement-lifecycle.md), dan
[decision 0015](../decisions/0015-t09-review-remediation.md).

Trace requirement: R05/F03/S07–S08 untuk lifecycle, pagination dan metrics; R04/F02/S05–S06
untuk Activity recovery; R06/F04/S09–S10 untuk candidate attach dan navigasi Project;
R01/shared recovery untuk session, ownership, dan redirect aman.

Lima item terlihat pada jalur aplikasi aktif melalui inspeksi kode. Item metrik perlu koreksi:
`normalizeMetricRows()` memang memakai `Number(row.value)` sehingga string kosong menjadi nol,
tetapi pencarian referensi saat plan disusun tidak menemukan pemanggil helper ini. Jalur aktif adalah
`MetricsEditor.toPayload()` → form action → `achievementSaveSchema` → RPC; string kosong tetap
string dan ditolak schema angka. **Klaim review sebelumnya bahwa blank metric saat ini tersimpan
sebagai nol ditarik.** Tidak ada dasar untuk migration koreksi data atau mengubah metric nol existing.

| ID | Item review | Status bukti dan target |
| --- | --- | --- |
| RV1 | Retry kehilangan `achievement_action` | Defect aktif: retry harus mengirim aksi yang sama dan revision terbaru. |
| RV2 | Cursor dated membatasi UUID row NULL | Defect aktif pada list dan candidate: semua row eligible harus terjangkau tanpa gap/duplikasi. |
| RV3 | Blank metric menjadi nol | Defect helper yang belum dipakai; hapus helper jika tetap tanpa pemanggil, dan buktikan jalur aktif menolak blank. |
| RV4 | Redirect existing Achievement tertangkap sebagai error | Defect aktif: buka record existing tanpa membuat duplikat. |
| RV5 | Sign-in kembali ke back destination | Defect aktif: pulihkan route create beserta source context dan return destination. |
| RV6 | Activity menolak return ke Achievement detail | Defect aktif: tombol Back kembali ke Achievement asal melalui URL yang dibatasi. |

## 2. Scope dan batas perubahan

Lingkup satu task T09: form retry, query pagination, route create/recovery, sanitizer return URL,
dan penutupan item helper metrics. Pertahankan ownership dari session, RLS, revision checking,
confirmation eksplisit, idempotency create, serta input lokal ketika operasi gagal.

Tidak ada perubahan schema/RPC yang diperlukan berdasarkan temuan ini. Migration T08/T09 yang
sudah diterapkan tetap immutable; tidak ada reset database aktif, data backfill, dependency baru,
regenerasi database types, atau pekerjaan AI/Evidence/CV. Jika implementasi menemukan kebutuhan
database baru, catat bukti dan revisi lingkup sebelum menambahkan migration forward-only.

Perkiraan file implementasi:

- `src/features/achievement/achievement-form.tsx`, `achievement-action-contract.ts` bila diperlukan.
- `src/features/achievement/achievement-service.ts`.
- `src/domain/achievement/metrics.ts`; editor/schema hanya bila regresi jalur aktif membuktikan perlu.
- `src/app/(workspace)/achievements/new/page.tsx`.
- `src/domain/routes/safe-return.ts` dan caller Activity/Achievement yang diperlukan untuk return path.
- `src/i18n/messages.ts` jika recovery memerlukan pesan baru; selalu lengkapi en/id.
- Tests unit, integration, dan E2E terkait; verification T09 dan implementation status.

Sebelum edit, baca ulang kode aktual, scoped instructions, dokumen sumber R05/F03/S07/S08,
dan bagian Design.md yang terkait feedback, keyboard, focus, serta unsaved state. Ekstrak DOCX
dengan alat dokumen jika perlu membaca sumber; jangan membaca binernya sebagai teks.

## 3. Paket remediasi dan acceptance

### T09-R1 — Retry mempertahankan intent pengguna (RV1)

Masalah: `retryLocal()` memanggil `requestSubmit()` tanpa submitter. Form menyampaikan
`achievement_action` melalui tombol bernama, sehingga submit programatis tidak menyertakan aksi.

Langkah:

1. Simpan aksi valid dari submitter saat submit awal, termasuk keyboard submission. Gunakan enum
   lifecycle yang sama dengan server; jangan menebak bahwa retry selalu berarti confirm atau save.
2. Setelah pengguna memilih retry, kirim aksi tersimpan tepat satu kali bersama latest revision,
   melalui submitter yang sesuai atau satu hidden field yang tidak menduplikasi nama field.
3. Pertahankan semua input lokal, skills, metrics, dan unsaved state selama pending atau gagal.
   Bersihkan dirty state setelah success atau reload/discard eksplisit, bukan sebelum retry commit.
4. Jika status terbaru membuat aksi awal tidak valid, tampilkan recovery yang aman dan minta pilihan
   aksi valid; jangan mengganti intent atau melakukan confirm otomatis. Revision tetap divalidasi server.

Acceptance:

- Konflik dua tab lalu retry untuk `save_draft`, `confirm`, `dismiss`, `reopen`, dan `save_changes`
  mengirim aksi asli ketika transisinya masih valid, dengan revision server terbaru.
- Perubahan status concurrent, konflik kedua, validasi gagal, dan session expired mempertahankan
  input; tidak menghasilkan false success atau mutation tanpa aksi valid.
- Reload/discard mengembalikan versi server secara eksplisit. Fokus dan tombol pending tetap usable.

### T09-R2 — Pagination melewati batas tanggal ke NULL (RV2)

Urutan canonical tetap `achieved_on DESC NULLS LAST, id DESC`, page size 30.
Untuk cursor dated, predicate sesudah cursor harus mencakup:

```text
achieved_on < cursor.date
OR (achieved_on = cursor.date AND id < cursor.id)
OR achieved_on IS NULL
```

Untuk cursor NULL, predicate tetap `achieved_on IS NULL AND id < cursor.id`.
Perbaiki `listAchievements()` dan `listRelinkCandidates()` bersama. Pertahankan owner/status/project
filters dan exclusion Project target sebelum limit. Jangan mengisi tanggal unknown dengan placeholder.

Acceptance PostgreSQL nyata melalui service:

- Fixture deterministik lebih dari 30 row: tanggal sama/berbeda dan NULL; UUID NULL berada di kedua
  sisi UUID cursor dated. Uji halaman terakhir dated tepat pada batas page dan page campuran dated/NULL.
- Iterasi semua halaman menghasilkan seluruh ID eligible tepat sekali, sesuai urutan, lalu cursor NULL.
- Ulangi untuk daftar terfilter, candidate attach, all-NULL, empty, dan malformed cursor.
- Record akun kedua dan record yang sudah linked ke Project target tidak pernah masuk candidate.
- Dialog Load more benar-benar menampilkan candidate bertanggal unknown yang sebelumnya terlewat.

### T09-R3 — Tutup item metrics sesuai bukti aktual (RV3)

Langkah default: periksa referensi ulang; jika `normalizeMetricRows()` tetap tidak dipakai,
hapus helper tersebut sehingga konversi berbahaya tidak menjadi jalur baru di masa depan.
Pertahankan `achievementMetricsSchema` sebagai validasi angka canonical. Jangan menghubungkan
helper yang belum dipakai hanya untuk membenarkan temuan review.

Jika ada pemanggil baru saat eksekusi, validasi nilai blank/null/undefined/whitespace sebelum
konversi angka dan tolak row sebagian terisi; jangan diam-diam menghapus row yang sudah diisi pengguna.

Acceptance:

- Jalur form → action → service menolak row berlabel/unit dengan value blank atau whitespace;
  input tetap terlihat, tidak ada RPC mutation sukses untuk nilai tidak valid.
- Nilai eksplisit `0`, desimal, dan angka negatif yang valid tetap diterima; kosong tidak disamakan nol.
- Tanpa metric (`[]`), achievement kualitatif tetap dapat confirmed jika field wajib lengkap.
- Verification mencatat koreksi review dan keputusan helper. Tidak ada klaim data existing pernah rusak.

### T09-R4 — Redirect existing record di luar error boundary (RV4)

Pisahkan hasil lookup dari navigasi: simpan ID Achievement existing di dalam blok lookup,
lalu panggil `redirect()` setelah blok penanganan error selesai. Error service tetap menghasilkan
pesan aman; exception navigasi framework tidak boleh diubah menjadi `UNAVAILABLE`.

Acceptance browser:

- Buka langsung `/achievements/new?activity=<owned-id>` ketika derived Achievement sudah ada:
  URL akhir menuju record existing dan jumlah Achievement tidak bertambah.
- Query `returnTo` yang valid tetap terbawa. Activity tanpa derived record membuka create normal.
- Lookup unavailable tidak menghasilkan redirect palsu; missing/foreign source tidak membocorkan record.
- Uji dengan redirect framework nyata dalam E2E, bukan mock `redirect()` yang mengembalikan nilai biasa.

### T09-R5 — Pulihkan create route setelah autentikasi (RV5)

Bentuk `createPath` canonical dari `/achievements/new`, source UUID valid, dan `returnTo` tersanitasi.
Gunakan path itu untuk `requireCompletedWorkspace`, retry halaman, serta sign-in recovery create.
Back/Cancel tetap memakai back destination. Audit `ActionFeedback` create agar error session di form
juga mengembalikan pengguna ke create route beserta context.

Sanitizer harus mengizinkan `activity` atau `project` khusus route `/achievements/new`, dengan UUID
valid, satu nilai per key, dan maksimum satu source. Tolak request ambigu yang mengirim keduanya.
Query ini tidak otomatis diizinkan pada detail routes. UUID valid bukan bukti ownership: setelah
login, source tetap di-resolve ulang melalui service owner-scoped akun yang sedang masuk.

Acceptance:

- Logged-out direct link untuk standalone, Activity-derived, dan Project-context → sign-in → create
  route yang sama dengan context dan filter back destination tetap sesuai.
- Session expired ketika submit → login → source context direvalidasi, tanpa create otomatis.
- Source foreign/deleted dan perubahan akun ditangani aman; tidak memakai data akun sebelumnya.
- Malformed/duplicate source IDs, kedua source sekaligus, external URL, protocol-relative URL,
  backslash, encoded control characters, dan unknown query key ditolak dengan fallback aman.

### T09-R6 — Return Activity ke Achievement tanpa rekursi tak terbatas (RV6)

`AchievementDetail` mengirim detail URL sebagai `returnTo` pada Open Activity, tetapi
`sanitizeActivityReturnTo()` hanya menerima list Activity atau detail Project. Tambahkan dukungan
detail Achievement yang valid dengan validasi URL bersama yang memiliki batas kedalaman eksplisit.
Jangan sekadar membuat sanitizer Activity dan Achievement saling memanggil tanpa budget kedalaman.

Kontrak target: maksimal empat lapisan `returnTo` per URL, batas panjang total tetap 500 karakter,
validasi tiap lapisan dengan allowlist route/query dan UUID; input melewati batas ditolak secara
deterministik. Caller membentuk path canonical dan tidak terus menambahkan salinan rantai lama.
Fallback domain tetap konsisten; tidak ada penerimaan arbitrary internal/external path.

Acceptance:

- Achievement → Open Activity → Back kembali ke Achievement asal beserta list filters yang valid.
- Rantai dari Project detail dan Activity list terfilter tetap pulih; browser Back/Forward juga usable.
- Uji round-trip sanitizer pada URL yang dihasilkan caller, nested external URL, rantai bergantian
  Activity/Achievement, kedalaman melebihi batas, dan panjang berlebih; tidak ada recursion overflow.
- Existing Activity ↔ Project serta auth safe-return regression tetap lulus.

## 4. Urutan eksekusi

1. **T09-R0:** cek dirty tree, checkpoint, package scripts, fixture dan local database yang tersedia;
   pertahankan pekerjaan pengguna. Rekam baseline serta koreksi RV3 sebelum edit implementasi.
2. Tambahkan regresi bermakna untuk RV1/RV2/RV4/RV5/RV6 dan guard jalur aktif RV3. Catat kegagalan
   awal yang benar-benar terlihat; test metrics aktif boleh sudah lulus karena klaim review dikoreksi.
3. Kerjakan R1, R2, dan R3; setiap perubahan diikuti check terarah.
4. Kerjakan sanitizer bersama untuk R5/R6, kemudian caller/create recovery dan R4. Gunakan satu
   kontrak return URL agar perbaikan auth tidak membatalkan perbaikan Back navigation.
5. Jalankan integration/browser acceptance, perbaiki regresi, lalu static checks dan production build.
6. Perbarui verification/status serta decision teknis bila diperlukan. T09 baru kembali DONE setelah
   seluruh item ditutup dengan bukti; lanjutkan T10 hanya pada permintaan implementasi berikutnya.

## 5. Matriks verifikasi saat implementasi

Perintah berikut tersedia di manifest saat plan disusun; baca ulang manifest sebelum eksekusi.

| Check | Tujuan |
| --- | --- |
| `pnpm test` | Domain metrics, cursor/URL, action contract, dan regression unit existing. |
| `pnpm test:integration:achievements` | Pagination PostgreSQL nyata, lifecycle/revision, ownership, dan metrics. |
| `pnpm test:integration:projects` | Candidate attach dan konteks Project setelah predicate berubah. |
| `pnpm test:e2e:achievements` | Konflik/retry, metrics input, existing redirect, pagination dan navigation. |
| `pnpm test:e2e:auth` | Login/resume route create dan invalid return URL. |
| `pnpm test:e2e:activity` | Return Activity/Achievement dan existing capture recovery. |
| `pnpm test:e2e:projects` | Candidate Load more dan existing Project return links. |
| `pnpm lint` dan `pnpm typecheck -- --incremental false` | Static correctness. |
| `pnpm build` | Kompatibilitas server/client dan route produksi. |
| `git diff --check` | Whitespace patch; inspect juga file untracked yang tidak tercakup diff standar. |

Tempat test: `tests/unit/achievement-domain.test.ts`, `tests/unit/auth-routing.test.ts`, unit baru
untuk action/URL bila diperlukan; `tests/integration/achievement-lifecycle.test.ts` dan
`tests/integration/project-context.test.ts`; serta suite browser Achievement/Auth/Activity/Project.
Pilih assertion hasil pengguna dan data tersimpan, bukan hanya snapshot string query internal.

UI yang berubah diperiksa keyboard, focus, error/pending/unsaved states, Axe, serta viewport
360px/1440px dalam light/dark. Copy baru harus en/id. Gunakan akun fixture terpisah dan cleanup
terarah; jangan mencetak credential, note, atau isi CV ke log.

DB migration rebuild, `db:types`, pgTAP penuh, worker check, Storage suite, deployment dan T24 bukan
gate baru untuk perubahan TypeScript/UI ini. Jalankan tambahan hanya jika perubahan aktual menyentuh
kontrak tersebut atau ada kegagalan yang memerlukannya. Bila local stack tidak tersedia, selesaikan
pekerjaan independen dan catat integration/browser sebagai belum dijalankan; T09 tetap PARTIAL.

## 6. Definition of Done dan handoff

- Lima defect alur aktif lulus acceptance; item metrics ditutup dengan koreksi temuan, penanganan
  helper, dan bukti jalur aktif tidak mengubah blank menjadi nol.
- Retry mempertahankan aksi dan input, pagination lengkap, existing redirect berhasil, serta login
  dan Back navigation mempertahankan context dengan validasi bounded URL.
- Perintah wajib relevan lulus; verification mencatat tanggal, environment, hasil aktual dan limitation.
- `docs/IMPLEMENTATION_STATUS.md`, tracker, `T09-manual-achievements-skills.md`, dan checkpoint pada
  `T09-implementation-plan.md` konsisten. Bukti sebelum review tetap diberi label historis.
- Decision remediasi, bila dibuat, mencatat intent retry dan batas return URL; nomor file ditentukan
  dari kondisi repository saat eksekusi, tidak menimpa decision existing.
- Tidak ada task T10+ dimulai sebagai bagian remediasi ini. Status DONE memerlukan bukti baru,
  bukan menyalin angka test dari checkpoint sebelum review.

Prompt handoff:

> Eksekusi `docs/verification/T09-review-remediation-plan.md` sesuai working tree aktual. Baca
> checkpoint dan instruksi proyek, validasi ulang enam item termasuk koreksi RV3, kerjakan perbaikan
> minimal beserta regresi bermakna, jalankan acceptance yang relevan, dan perbarui verification/status
> dengan hasil aktual. Pertahankan dirty changes pengguna dan migration yang sudah diterapkan.
> T09 tetap PARTIAL sampai bukti penutupan lengkap; jangan memulai T10.
