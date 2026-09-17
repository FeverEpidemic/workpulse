# Rencana Remediasi Review T03 dan T04 untuk Luna

Tanggal: 16 September 2026

Status: siap dieksekusi; dokumen ini hanya membuat rencana, belum mengubah implementasi
atau status T03/T04.
Target pelaksana: `gpt-5.6-luna` dengan reasoning `max`.

## Tujuan

Menutup empat temuan review setelah T03 dan T04 ditandai `DONE`:

1. Jalur `INSERT` langsung foundation masih dapat melewati RPC create idempotent dan
   validasi aplikasi.
2. Replay create membaca row live, sehingga hasil replay berubah setelah edit atau gagal
   setelah delete.
3. Unsaved guard tidak menangani navigasi Back/Forward App Router; Quick log dapat hilang
   tanpa dialog atau draft recovery.
4. Banyak field error tidak terhubung secara programatis ke input terkait.

Remediasi selesai hanya jika boundary mutation database, replay stability, navigasi
unsaved, dan error accessibility dibuktikan melalui test baru. Lulusnya suite lama saja
tidak cukup.

## Profil eksekusi

- Kerjakan fase secara berurutan. Jangan memulai T05 atau fitur bisnis T06+.
- Sebelum setiap fase, sebutkan scope, invariant, file yang diperkirakan berubah, dan
  checks yang akan membuktikan hasil.
- Pertahankan pekerjaan pengguna. Repository belum memiliki baseline commit; inspeksi
  keadaan aktual dan jangan mengandalkan diff historis.
- Jangan mengubah PRD, flow, wireframe, database-schema DOCX, atau `Design.md`.
- Jangan mengakses hosted Supabase, SMTP production, atau akun pengguna nyata.
- Semua migration harus forward-only. Jangan mengubah migration T01–T04 yang sudah ada.
- Bila local PostgreSQL, Mailpit, Chromium, atau child process tidak tersedia, selesaikan
  pekerjaan independen, catat blocker konkret, dan jangan mengembalikan status `DONE`.

## Bacaan wajib sebelum edit

1. `AGENTS.md` dan `docs/AGENTS.md`.
2. `docs/IMPLEMENTATION_STATUS.md`, khususnya checkpoint T03 dan T04.
3. `docs/IMPLEMENTATION_PLAN.md` §1, §3, §4, T03, T04, dan matriks R01.
4. `docs/verification/T03-auth-profile.md` dan
   `docs/verification/T04-design-system-app-frame.md`.
5. `docs/decisions/0003-auth-session.md`,
   `docs/decisions/0004-foundation-create-idempotency.md`, dan
   `docs/decisions/0005-design-system-application-frame.md`.
6. R01/F01/S01/S05/S12 dan bagian profile/foundation yang relevan dari source DOCX,
   dibaca melalui alat ekstraksi dokumen.
7. Implementasi serta test yang disebut pada setiap fase di bawah.

## Batas perubahan

Termasuk:

- hardening create experience, education, certification, dan skill;
- database constraints untuk field T03 yang sudah memiliki batas server;
- immutable replay result untuk operation key T03;
- unsaved Back/Forward dan owner-scoped draft Quick log;
- hubungan input-error dan audit error state WCAG;
- test, decision log, verification record, README bila perlu, dan implementation status.

Tidak termasuk:

- CRUD Projects baru, Activity persistence, storage, AI, import, CV, atau worker;
- perubahan struktur navigasi atau redesign visual;
- cleanup/retention umum `operation_requests` yang belum diperlukan T03;
- account deletion T23;
- deployment atau konfigurasi production.

## Fase 0 — Baseline dan reproduksi

### File yang dibaca

- `package.json`
- seluruh file yang disebut dalam temuan di fase berikutnya
- test unit, pgTAP, Auth E2E, dan UI E2E saat ini

### Langkah

1. Catat `git status --short`; jangan membersihkan file yang tidak dikenal.
2. Jalankan baseline berikut sebelum edit:

   ```text
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm typecheck -- --incremental false
   pnpm test
   pnpm build
   pnpm db:status
   pnpm db:test
   pnpm db:lint
   pnpm test:e2e:auth
   pnpm test:e2e:ui
   ```

3. Tambahkan regression test yang gagal untuk setiap temuan sebelum atau bersamaan
   dengan fix. Jangan melemahkan assertion suite lama.
4. Saat implementasi dimulai, catat T03 dan T04 sebagai `IN_PROGRESS` atau `PARTIAL`
   pada checkpoint remediasi. Jangan menghapus bukti historis bahwa suite lama pernah
   lulus.

### Acceptance fase

- Baseline aktual dan limitation tercatat.
- Masing-masing temuan mempunyai reproduksi otomatis yang jelas.

## Fase 1 — Tutup jalur create yang melewati contract

### Masalah yang harus diperbaiki

Migration lama masih memberikan `INSERT` langsung kepada `authenticated` pada tabel
foundation. Karena Supabase REST adalah boundary publik, caller dapat melewati
`operation_key`, ledger, dan Zod Server Action. Constraint database juga belum
menegakkan seluruh batas panjang/format yang sudah dijanjikan UI/server.

### File yang diperkirakan berubah

- migration baru, gunakan timestamp berikutnya; nama yang disarankan:
  `supabase/migrations/20260916190000_t03_foundation_contract_hardening.sql`
- `supabase/tests/database/foundation.test.sql`
- `src/features/profile/schemas.ts`
- `src/features/profile/foundation-actions.ts`
- `src/server/supabase/database.types.ts` hanya bila output generator berubah
- decision baru `docs/decisions/0006-t03-t04-review-remediation.md`

### Perilaku database wajib

1. Revoke direct `INSERT` untuk `authenticated` pada:
   - `public.experiences`;
   - `public.education`;
   - `public.certifications`;
   - `public.skills`.
2. Jangan membuka kembali direct `UPDATE` atau `DELETE`. Typed public RPC menjadi
   satu-satunya create boundary untuk empat tabel tersebut.
3. Jangan mengubah privilege `projects` dalam fase ini; T08 harus menyediakan contract
   create project sendiri sebelum memakai tabel itu.
4. Tambahkan database constraints yang ekuivalen dengan contract T03, minimal:
   - profile: display name 80, headline 120, summary 2.000, contact email 320,
     phone 40, location 120, website 2.048, timezone 100;
   - experience: organization/role 200, description 5.000;
   - education: institution/qualification/field of study 200, description 5.000;
   - certification: name/issuer 200, credential URL 2.048 dan HTTP(S);
   - skill name 100.
5. Pertahankan constraint nonblank, partial date, normalized skill, ownership, revision,
   locale, dan timezone yang sudah ada. Gunakan `char_length`, trim/canonical null rule,
   dan stable SQLSTATE/condition yang dapat dipetakan ke error aman.
6. Public create/update RPC tidak boleh menerima payload yang hanya lolos karena bypass
   terhadap Server Action. Tidak ada raw SQL message yang dikirim ke UI.
7. Migration harus aman untuk data yang sudah ada. Lakukan precondition/check yang jelas;
   jangan truncate, delete, atau memotong nilai existing secara diam-diam.

### Perilaku aplikasi wajib

1. Pertahankan Zod validation sebagai feedback field-level pertama.
2. Samakan batas Zod dan database. Jangan memiliki angka batas berbeda di beberapa file
   tanpa constant/domain contract yang jelas.
3. Map constraint violation ke localized `VALIDATION` result; jangan bergantung pada
   seluruh teks error PostgreSQL.
4. Owner tetap berasal dari `auth.uid()`/server session, bukan payload client.

### Test wajib

- pgTAP membuktikan role `authenticated` tidak lagi memiliki direct `INSERT` pada empat
  tabel.
- Keempat typed create RPC tetap berhasil untuk owner aktif.
- Direct REST-equivalent insert ditolak walau `user_id` sama dengan session.
- Oversized values ditolak oleh database untuk create dan update, bukan hanya oleh Zod.
- URL non-HTTP(S), blank optional canonical violation, duplicate skill, partial date,
  cross-owner, dan revision tests tetap lulus.
- Server Action mengembalikan field/localized validation yang aman.

### Acceptance fase

- Tidak ada jalur create foundation non-idempotent yang callable oleh `authenticated`.
- Semua contract field T03 berlaku pada Server Action dan database boundary.

## Fase 2 — Jadikan hasil replay immutable

### Masalah yang harus diperbaiki

`internal.operation_requests` hanya menyimpan result table dan ID. Replay kemudian
membaca row live. Edit setelah create mengubah hasil replay; delete membuat replay yang
sama gagal. Ini bertentangan dengan keputusan 0004 bahwa identical replay mengembalikan
hasil create awal.

### File yang diperkirakan berubah

- migration fase 1 yang sama bila tetap kecil dan atomik, atau migration terpisah dengan
  timestamp lebih baru
- `supabase/tests/database/foundation.test.sql`
- `src/features/profile/foundation-actions.ts` bila bentuk result berubah
- `src/server/supabase/database.types.ts` bila signature publik berubah
- `docs/decisions/0006-t03-t04-review-remediation.md`

### Contract wajib

1. Simpan immutable result snapshot yang cukup untuk mengembalikan result create awal.
   Pilihan yang direkomendasikan adalah kolom private `result_payload jsonb` di ledger;
   jangan menyimpan payload input mentah dua kali.
2. Pada first success, tulis `result_table`, `result_id`, immutable `result_payload`, dan
   `completed_at` dalam transaksi yang sama dengan domain insert.
3. Replay identik membaca snapshot ledger, bukan row domain live.
4. Edit atau delete domain row setelah create tidak boleh mengubah atau menghilangkan
   hasil replay.
5. Same key + different canonical input tetap menghasilkan
   `IDEMPOTENCY_KEY_REUSED` dan tidak memodifikasi ledger maupun domain row.
6. Snapshot hanya dapat diakses melalui wrapper yang memvalidasi owner dari `auth.uid()`;
   ledger tetap private dari `anon`, `authenticated`, dan browser.
7. Tentukan strategi migration existing ledger secara eksplisit:
   - backfill snapshot dari row owned yang masih ada;
   - bila row legacy sudah hilang dan hasil penuh tidak dapat direkonstruksi, jangan
     mengarang data; fail migration dengan pesan operasional yang jelas atau catat
     legacy exception yang deterministik;
   - karena project belum production, clean local reset boleh menjadi bukti tambahan,
     tetapi bukan alasan membuat migration yang diam-diam merusak data.
8. Pertahankan satu transaksi dan concurrency behavior: competing identical request
   menunggu claim pertama lalu menerima snapshot yang sama.

### Test wajib

- Create lalu immediate replay: ID dan payload sama, satu row domain/ledger.
- Create lalu update row, kemudian replay original request: hasil sama dengan snapshot
  create, bukan versi updated.
- Create lalu delete row, kemudian replay original request: result create awal tetap
  dikembalikan dan row tidak dibuat ulang.
- Same key/different payload setelah edit atau delete tetap ditolak.
- Dua session concurrent menghasilkan satu row dan snapshot yang sama.
- Cross-owner dan cross-operation-kind isolation tetap lulus.
- Rollback domain insert meninggalkan nol ledger completion dan nol partial row.

### Acceptance fase

- Identical replay bersifat stabil terhadap semua mutation row berikutnya.
- Keputusan 0004 dikoreksi/supersede secara eksplisit oleh decision 0006.

## Fase 3 — Lindungi Quick log pada Back/Forward

### Masalah yang harus diperbaiki

`UnsavedChangesProvider` hanya menangkap klik anchor dan `beforeunload`. Navigasi history
App Router dapat berjalan tanpa unload. Quick log menyimpan note hanya di React state,
sehingga Back/Forward dapat membuang sampai 10.000 karakter tanpa dialog atau restore.

### File yang diperkirakan berubah

- `src/components/ui/unsaved-changes.tsx`
- helper baru yang kecil bila perlu, misalnya
  `src/domain/routes/unsaved-navigation.ts`
- `src/features/activity/quick-log-capture.tsx`
- `src/app/(workspace)/activity/new/page.tsx`
- `src/components/layout/application-frame.tsx` hanya bila owner perlu diteruskan
- `tests/unit/session-draft.test.ts` atau unit test navigation helper baru
- `tests/e2e/app-frame.spec.ts`
- `src/i18n/messages.ts` hanya bila copy baru benar-benar dibutuhkan

### Perilaku wajib

1. Browser Back/Forward saat ada form dirty tidak boleh kehilangan data diam-diam.
2. Pada Back dari Quick log:
   - tampilkan dialog unsaved yang sama;
   - `Stay` mempertahankan `/activity/new`, note, selection/focus yang masuk akal, dan
     history yang masih dapat dipakai;
   - `Continue` menjalankan navigasi awal tepat sekali tanpa loop atau history entry
     palsu yang menumpuk.
3. `beforeunload` tetap menangani reload/tab close/full-document navigation.
4. Anchor navigation yang sudah bekerja tetap mempertahankan focus return ke link pemicu.
5. Persist Quick log sebagai fallback owner-scoped session draft. Owner ID wajib berasal
   dari completed workspace context; jangan membuat key global atau memakai email.
6. Quick log draft tidak memuat identity, revision, atau hidden fields, dan dibersihkan
   setelah persistence Activity nyata berhasil pada T07. Karena save masih disabled di
   T04, jangan menghapus draft seolah-olah sudah tersimpan.
7. Sign-out membersihkan Quick log draft milik owner aktif melalui mekanisme draft yang
   sudah ada.
8. Jangan bergantung hanya pada experimental API yang tidak tersedia lintas browser.
   Jika implementasi history memerlukan adapter/fallback, catat dukungannya di decision.

### Test wajib

- Unit-test state transition guard bila logic history diekstrak.
- E2E: isi Quick log, tekan `page.goBack()`, dialog tampil, pilih Stay, URL/note tetap.
- E2E: ulangi Back, pilih Continue, kembali ke route sebelumnya tepat sekali.
- E2E: Forward/revisit tidak menghasilkan loop dan owner yang sama dapat memulihkan
  draft yang belum disimpan.
- E2E dua akun: draft Quick log user A tidak terlihat oleh user B dalam tab yang sama.
- Existing link-navigation, reload warning, drawer, filter back/forward, dan session
  draft Profile tetap lulus.

### Acceptance fase

- Semua jalur navigation yang dapat membuang Quick log memiliki confirmation atau
  recovery yang terbukti.
- URL/history tidak korup dan tidak terjadi navigation loop.

## Fase 4 — Hubungkan setiap field error ke input

### Masalah yang harus diperbaiki

`FieldError` membuat ID internal ketika caller tidak memberikan ID, tetapi input tidak
dapat mereferensikan ID tersebut. Pada onboarding terdapat `aria-describedby` yang
menunjuk ID berbeda; pada auth, password, partial-date, dan foundation form tidak ada
hubungan sama sekali.

### File yang diperkirakan berubah

- `src/components/forms/action-feedback.tsx`
- `src/features/auth/sign-in-client.tsx`
- `src/features/auth/update-password-form.tsx`
- `src/features/profile/onboarding-form.tsx`
- `src/features/profile/profile-editor.tsx`
- `src/features/profile/foundation-editors.tsx`
- test unit/component baru untuk error association
- `tests/e2e/auth-profile.spec.ts`
- `tests/e2e/app-frame.spec.ts`

### Perilaku wajib

1. Gunakan ID deterministic dan unik per form + field. Pilihan sederhana: jadikan prop
   `id` pada `FieldError` wajib dan tetapkan ID eksplisit pada semua caller.
2. Setiap input/select/textarea yang dapat menerima field error wajib menunjuk error
   element melalui `aria-describedby` atau `aria-errormessage` dan memakai
   `aria-invalid=true` hanya ketika field tersebut invalid.
3. Preserve help text yang sudah ada: gabungkan beberapa ID dalam `aria-describedby`,
   jangan mengganti help text dengan error.
4. Partial-date year/month/day dan credential URL harus menunjuk error masing-masing.
5. Error tetap memiliki live announcement yang tidak berulang secara berlebihan.
6. Jangan memasukkan pesan validation ke accessible name/label secara tidak sengaja.
7. Ubah Axe helper agar memeriksa seluruh violation untuk tag WCAG A/AA yang dipilih,
   bukan hanya impact `serious`/`critical`. Jalankan scan pada error state, bukan hanya
   happy path.

### Test wajib

- Unit/component assertion bahwa setiap field error ID ada tepat sekali dan direferensikan
  control yang sesuai.
- Auth E2E memicu invalid credentials/validation dan memeriksa error association.
- Onboarding E2E memicu display name/timezone server error dan memeriksa association.
- Foundation E2E memicu partial-date/duplicate-skill error dan memeriksa association.
- Axe WCAG A/AA pada sign-in error, onboarding error, profile validation, conflict dialog,
  dan representative workspace route melaporkan nol violation yang belum di-waive.
- Bila ada waiver, catat rule, node, alasan, owner, dan follow-up task; jangan menyaring
  berdasarkan severity saja.

### Acceptance fase

- Fokus ke field invalid memberikan label, help text, dan error yang benar kepada
  assistive technology.
- Klaim accessibility T04 mencakup error state nyata.

## Fase 5 — Integration review dan dokumentasi

### Urutan verifikasi final

Jalankan dari workspace root dan catat exit code serta jumlah test aktual:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck -- --incremental false
pnpm test
pnpm build
pnpm db:status
pnpm db:test
pnpm db:lint
pnpm db:types
pnpm typecheck -- --incremental false
pnpm test:e2e
pnpm test:e2e:auth
pnpm test:e2e:ui
```

Selain itu:

1. Jalankan two-session concurrency replay check terhadap PostgreSQL lokal.
2. Jalankan clean `db:reset` pada project Supabase disposable, bukan volume WorkPulse
   asli. Verifikasi semua migration dari nol, seed, pgTAP, dan lint; lalu hapus hanya
   disposable project yang path/project ID-nya sudah diverifikasi.
3. Bandingkan output `pnpm db:types` dengan
   `src/server/supabase/database.types.ts`. Jangan menyatakan parity hanya karena
   typecheck lulus.
4. Review screenshot 360/1440 light/dark hanya pada route yang terpengaruh; tidak perlu
   membuat ulang seluruh mockup desain.
5. Periksa `git diff --check` atau konsistensi whitespace yang ekuivalen. Karena repo
   belum memiliki baseline commit, jangan menyebut clean diff jika Git belum dapat
   membuktikannya.

### Dokumentasi yang harus diperbarui

- Tambahkan `docs/decisions/0006-t03-t04-review-remediation.md` yang menjelaskan:
  mutation boundary, database validation, immutable replay snapshot, history guard,
  Quick log draft, dan field-error contract.
- Perbarui `docs/verification/T03-auth-profile.md` dengan migration, pgTAP, replay
  edit/delete/concurrency, dan privilege evidence.
- Perbarui `docs/verification/T04-design-system-app-frame.md` dengan Back/Forward,
  Quick log recovery, error association, dan Axe error-state evidence.
- Perbarui `docs/IMPLEMENTATION_STATUS.md` dengan tanggal, status, file, migration,
  command aktual, checks yang tidak dijalankan, blocker, dan langkah berikutnya.
- README hanya diubah bila perintah/setup benar-benar berubah.

### Status akhir

- T03 kembali `DONE` hanya jika Fase 1–2, pgTAP, clean migration reset, type parity,
  concurrency replay, dan Auth E2E lulus.
- T04 kembali `DONE` hanya jika Fase 3–4, browser history tests, two-account Quick log
  isolation, error-state Axe/keyboard checks, dan UI/Auth E2E lulus.
- Jika salah satu integration gate tidak dijalankan, task terkait tetap `PARTIAL` dengan
  blocker dan next command konkret.
- Gate M1 tetap terbuka karena T05 belum selesai.

## Matriks temuan ke bukti

| Temuan | Fix utama | Bukti minimum |
| --- | --- | --- |
| Direct INSERT bypass | Revoke privilege + DB constraints + RPC-only create | pgTAP privilege, direct-call rejection, valid RPC success |
| Replay memakai live row | Immutable ledger result snapshot | replay setelah update/delete + two-session concurrency |
| Back/Forward membuang Quick log | History guard + owner-scoped draft fallback | Playwright Stay/Continue/Forward + dua akun |
| Error tidak terasosiasi | Deterministic IDs + ARIA references/invalid state | DOM assertions + Axe pada error state |

## Non-regression checklist

- [ ] Name-only onboarding masih masuk Dashboard tanpa CV/employment.
- [ ] Anonymous/provisional/completed routing tetap benar.
- [ ] Recovery/password update dan safe return tetap lulus.
- [ ] Draft Profile/Foundation tetap owner-scoped dan tidak menyimpan password/hidden fields.
- [ ] Conflict reload/retry tetap mempertahankan revision semantics.
- [ ] Foundation update/delete masih revision-checked.
- [ ] Enam tujuan navigasi, drawer Escape/focus return, theme, filters, dan Quick log focus
      tetap lulus.
- [ ] Tidak ada fake persistence, data contoh production, atau scope T05+.
- [ ] Locale `en`/`id` tetap lengkap untuk copy yang diubah.

## Format handoff Luna

Jawaban akhir Luna harus berurutan:

1. outcome dan status T03/T04;
2. empat invariant yang diperbaiki;
3. file dan migration yang berubah;
4. decision dan compatibility/migration note;
5. commands yang benar-benar dijalankan beserta exit/count;
6. checks yang tidak dijalankan dan blocker konkret;
7. risiko/limitation yang masih terbuka;
8. next task tetap T05 bila semua remediation gate selesai.

## Prompt eksekusi siap salin untuk Luna

```text
Implementasikan seluruh remediation dalam
docs/verification/T03-T04-review-remediation-plan.md untuk WorkPulse. Gunakan model
gpt-5.6-luna dengan reasoning max.

Baca AGENTS.md, docs/AGENTS.md, implementation status/plan, verification T03/T04,
decision 0003–0005, bagian source R01/F01/S01/S05/S12 yang relevan, dan implementasi
aktual sebelum mengubah file. Kerjakan fase secara berurutan: baseline/reproduksi,
mutation boundary dan database validation, immutable replay snapshot, unsaved
Back/Forward + owner-scoped Quick log draft, field-error accessibility, lalu integrated
verification dan dokumentasi. Jangan memulai T05 atau mengubah source DOCX/Design.md.

Gunakan migration forward-only; jangan mengedit migration lama. Owner harus selalu
berasal dari authenticated server/database session. Foundation create harus hanya lewat
typed idempotent RPC, identical replay harus stabil setelah row diedit/dihapus, Quick log
tidak boleh hilang diam-diam pada Back/Forward, dan setiap field error harus terhubung
secara programatis ke control-nya.

Tambahkan regression tests sebelum mengklaim fix. Jalankan semua checks pada Fase 5,
termasuk pgTAP, DB lint/type parity, two-session concurrency, disposable clean reset,
Auth/Mailpit E2E, dan UI E2E. Jika integration environment terblokir, selesaikan bagian
independen, catat error aktual, dan biarkan task terkait PARTIAL. Perbarui decision 0006,
verification T03/T04, dan IMPLEMENTATION_STATUS.md hanya dengan bukti aktual. Akhiri
dengan format handoff yang ditentukan plan.
```
