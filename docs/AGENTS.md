# Panduan Agen — WorkPulse

Panduan ini berlaku untuk seluruh workspace WorkPulse. Gunakan instruksi pengguna yang berlaku untuk menentukan lingkup pekerjaan; panduan ini membantu menjaga implementasi konsisten dengan dokumen proyek.

## Konteks proyek

WorkPulse MVP v0.1 adalah workspace karier privat: pengguna mencatat aktivitas, meninjau dan mengonfirmasi pencapaian, memilih data ke satu master CV, lalu mengunduh PDF. Jalur manual harus tetap berfungsi tanpa AI.

Workspace sudah berisi aplikasi Next.js, worker, schema Supabase, dan test suite di repository Git (`origin` GitHub, branch utama `main`). Per 30 September 2026, T01–T17 berstatus DONE secara lokal dan Gate M2 berstatus PASSED (acceptance lokal, `docs/verification/M2-gate-review.md`); T13 juga lulus smoke live pada endpoint OpenAI-compatible pilihan pengguna (`docs/verification/T13-ai-jobs-consent.md`). T14 (detection, refinement, dan review) DONE secara lokal dengan fake provider; smoke live `refine` dan suite scanner ClamAV belum dijalankan (`docs/verification/T14-detection-review.md`). T15 (import upload dan extraction staging) DONE secara lokal dengan fake provider, renderer Gotenberg dan ClamAV nyata; smoke live `extractImport` belum dijalankan (`docs/verification/T15-import-staging.md`). T16 (import commit transaction) DONE secara lokal: RPC `update_import_item`, `validate_import_batch`, `commit_import_batch` (atomik, idempotent, onboarding lewat commit), dengan real integration dan gate review tanpa P0–P2 (`docs/verification/T16-import-commit.md`). T17 (import review UI dan onboarding lengkap) DONE secara lokal: S03 `/imports/[id]/review`, entry point S02/S04/S12, onboarding lewat commit, tanpa migration; gate review menemukan satu P2 (token commit) yang sudah diperbaiki (`docs/verification/T17-import-review-ui.md`). Gate M3 (assisted entry) berstatus PASSED secara lokal (`docs/verification/M3-gate-review.md`). Gate ini menambah suite lintas alur `test:integration:m3` dan `test:e2e:m3`, serta memperbaiki satu P2 (copy S02 untuk consent yang ditarik saat ekstraksi berjalan). T18 (CV schema dan selection) DONE secara lokal: migration `20261002090000` (`cv_documents`, `cv_items`, `cv_exports` struktur saja) dan RPC `ensure_cv_document`, `select_cv_source`, `remove_cv_item`, `reorder_cv_section`, `update_cv_layout`, domain `src/domain/cv`, service `src/features/cv`, tanpa UI; gate review tanpa P0–P2 (`docs/verification/T18-cv-schema-selection.md`). Per 1 Oktober 2026, T19 (CV builder dan overrides) DONE secara lokal: S13 `/cv` (selection, move aksesibel, locale CV, override wording/summary/contact, Save eksplisit, konflik per field, preview dari data tersimpan, *Add to CV*), RPC `save_cv_edits` dan migration `20261003090000`/`20261003100000`; gate review tanpa P0–P2 dan P3 F1–F7 sudah diperbaiki (`docs/verification/T19-cv-builder-overrides.md`). Per 3 Oktober 2026, T20 (CV freshness dan deletion) DONE secara lokal: migration `20261004090000`, state freshness dihitung saat dibaca (`internal.cv_item_state`/`cv_profile_state`), RPC `get_cv_freshness`, `get_cv_review_summary`, `resolve_cv_freshness`, jalur delete sumber mengunci CV lebih dulu dan menaikkan revision CV dalam transaksi delete, review S13 (Refresh/Keep saved wording/Keep my wording/Replace) dan dua check CV di S04; gate review tanpa P0–P2 dengan tujuh P3 follow-up (`docs/verification/T20-cv-freshness-deletion.md`, decision 0026). Per 6 Oktober 2026, T21 (export backend) DONE secara lokal: migration `20261005090000`, readiness `internal.cv_export_blockers`/`get_cv_export_readiness`, `request_cv_export` (lock profil → dokumen → sumber kanonik, snapshot immutable `cv-export.v1` dan enqueue dalam satu transaksi, satu export aktif per CV), `retry_cv_export` (snapshot sama, maksimal tiga attempt), `get_cv_export_download` (signed URL ≤ 5 menit), RPC worker lease/CAS/kedaluwarsa 24 jam/cleanup/orphan, worker `cv-export`/`export-cleanup` dengan renderer Gotenberg Chromium terisolasi `workpulse-t21-pdf` (`docs/verification/T21-pdf-renderer-runbook.md`), service dan action tanpa UI; gate review menemukan satu P2 (cek nama aksara non-Latin) yang sudah diperbaiki, delapan P3 follow-up (`docs/verification/T21-cv-export-backend.md`, decision 0027). Per 8 Oktober 2026, T22 (saved preview dan PDF QA) DONE secara lokal tanpa migration: S14 `/cv/preview` (revision tersimpan persis, blocker bertaut ke S13, satu aksi export eksplisit dengan `expected_revision` dan idempotency key per klik, polling `GET /api/cv/exports/[id]`, Retry hanya untuk revision tersimpan dan selain itu Regenerate, halaman PDF nyata lewat pdf.js dari signed URL `inline`, unduhan `WorkPulse-CV-<tanggal>.pdf`), perluasan storage aditif, aturan break template (`overflow-wrap`, `entry-flow` untuk entry lebih tinggi dari satu halaman), serta QA PDF renderer nyata `tests/pdf/` (`pnpm test:pdf`); gate review menemukan satu P2 (halaman kosong sebelum entry panjang) yang sudah diperbaiki, delapan P3 follow-up (`docs/verification/T22-saved-preview-pdf-qa.md`, decision 0028). Gate M4 (integration review Master CV dan PDF) berstatus PASSED secara lokal (verdict reviewer 10 Oktober 2026, `docs/verification/M4-gate-review.md`). Gate ini menambah suite lintas domain `test:integration:m4` dan `test:e2e:m4` (journey F07 dengan renderer nyata) dan memperbaiki tiga P2: region preview yang dapat difokuskan, `onBeforeInput` Quick log, dan fokus setelah `CV_SOURCE_CHANGED`. Per 10 Oktober 2026, T23 (account deletion dan retention) DONE secara lokal: migration `20261009090000`/`20261009100000`, trigger `zz_guard_account_writable` pada setiap tabel milik pengguna (`42501 ACCOUNT_DELETING` untuk akun `deleting`), antrean `internal.account_deletions` tanpa FK (claim/lease/CAS), `begin_account_deletion` khusus service role, `purge_account_data` (antrekan semua objek lalu DELETE berurutan, profil sebagai tombstone), pass worker `account-deletion` (purge → `deleteUser` → verify prefix kosong), S12 *Privacy and account* dengan reautentikasi password dan konfirmasi email, pembatalan otomatis batch `review` setelah 30 hari, pengosongan snapshot export, dan `retry_cv_export` yang menolak `EXPORT_RETRY_UNAVAILABLE`; retensi backup ≤ 30 hari belum terverifikasi (T25); gate review tanpa P0–P2 (`docs/verification/T23-account-deletion-retention.md`, decision 0029). Per 10 Oktober 2026, T24 (instrumentation dan performance) DONE secara lokal tanpa perubahan UI: migration `20261011090000`, tabel `internal.product_events` yang diisi trigger `AFTER` pada delapan tabel kanonis (lima event dengan properti allowlist, tanpa teks, ID record, atau nama file), kohort pilot `internal.pilot_participants` lewat `set_pilot_participant` dan laporan `get_pilot_metrics` (keduanya khusus service role; target pilot adalah hipotesis), event ikut terhapus bersama akun, dan suite `pnpm test:perf` yang membuktikan p95 baca dan simpan jauh di bawah target PRD pada dataset 1.000/200/50 di satu mesin lokal, tanpa migration indeks; gate review tanpa P0–P2 (`docs/verification/T24-instrumentation-performance.md`, decision 0030, runbook `docs/verification/T24-pilot-metrics-runbook.md`). Langkah berikutnya adalah T25 (regression dan release handoff). Status ini hanya snapshot: periksa kondisi aktual setiap sesi dan gunakan `docs/IMPLEMENTATION_STATUS.md` sebagai checkpoint, bukan sebagai pengganti pemeriksaan kode. Keberhasilan lokal bukan bukti integrasi production.

Dokumen proyek berada di `docs/`. `AGENTS.md` dan `Design.md` di root disalin juga ke `docs/`; jaga kedua salinan tetap identik saat mengubahnya.

## Acuan dan urutan membaca

Sebelum mengubah implementasi:

1. Baca `IMPLEMENTATION_STATUS.md` untuk status, blocker, dan langkah berikutnya.
2. Baca bagian terkait di `IMPLEMENTATION_PLAN.md`, terutama §1 untuk keputusan scope, §3 untuk kontrak lintas fitur, §4 untuk gap schema, serta acceptance task yang dikerjakan.
3. Baca bagian dokumen sumber yang relevan dengan task. Pertahankan rujukan requirement R01–R10, flow F01–F07, screen S01–S14, dan task T01–T25 dalam catatan implementasi/verifikasi.
4. Baca `Design.md` ketika mengerjakan UI, dengan batas scope yang sudah diselesaikan dalam rencana.

| Dokumen | Tanggung jawab |
| --- | --- |
| `WorkPulse_PRD_v0.1.docx` | Scope MVP, requirement, validasi, acceptance |
| `WorkPulse_User_Flow_v0.1.docx` | Alur, transisi, recovery |
| `WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx` | Screen, route, input, state |
| `WorkPulse_Database_Schema_v0.1.docx` | Data canonical, ownership, relasi, transaksi, snapshot |
| `Design.md` | Token visual, komponen, tema, responsive, aksesibilitas |
| `IMPLEMENTATION_PLAN.md` | Keputusan konflik sumber, arsitektur usulan, dependensi dan paket kerja |
| `IMPLEMENTATION_STATUS.md` | Hasil aktual, bukti acceptance, checkpoint lanjutan |

Keputusan konflik yang sudah tercatat di §1 rencana menjadi acuan v0.1. Jika ada konflik baru yang mengubah hasil produk, catat keputusan dan alasannya di `docs/decisions/`; minta klarifikasi hanya jika keputusan tersebut memerlukan pilihan produk dari pengguna. Jangan mengubah dokumen sumber diam-diam. Baca DOCX menggunakan alat ekstraksi dokumen; jangan memperlakukan file biner sebagai teks atau mengandalkan metadata halaman untuk validasi import.

## Batas MVP yang harus dipertahankan

- Navigasi utama: **Dashboard, Activity, Achievements, Projects, Timeline, CV**. Profile/settings di bagian bawah; skill diedit di S12.
- Onboarding hanya mewajibkan display name. Pengguna tanpa CV, employment, atau pengalaman kerja tetap dapat masuk.
- Status project: `planned`, `active`, `completed`; tanpa persentase progress.
- Skill berupa label dengan jumlah distinct achievement confirmed; tanpa proficiency atau readiness score.
- Satu master CV per akun, template `single_column_v1`, locale `en`/`id`. Default awal English; Bahasa Indonesia tersedia sejak akun/onboarding. Locale tidak menerjemahkan konten sumber.
- Evidence melekat pada activity, achievement, atau project. Library terpisah, global search, command palette, dan career coach bukan paket wajib v0.1.
- Daftar activity berbeda dari career timeline. Timeline mengikuti event R08, bukan seluruh log activity.
- Jangan menambahkan target job, AI auto-selection CV, CV variants, billing, team/HRIS, public profile, recruiter search, job matching, interview, evidence AI analysis, OCR, offline sync, enkripsi end-to-end, penerjemahan otomatis, atau aplikasi native tanpa perubahan scope pengguna.

## Arsitektur dan struktur target

Bootstrap T01 sudah memilih dan mem-pin stack (lihat `docs/decisions/0001-foundation-stack.md`): Node.js 24.18 (`>=24.18.0 <25`), pnpm 11.19 dengan satu lockfile `pnpm-lock.yaml`, Next.js 16 + React 19, TypeScript 6 strict, Tailwind CSS 4, Zod 4, Supabase JS/SSR, lucide-react sebagai satu-satunya keluarga ikon, Vitest, Playwright + axe-core, dan Supabase CLI sebagai devDependency. Ikuti `package.json`, lockfile, keputusan di `docs/decisions/`, dan pola kode yang nyata; jangan menambah package manager atau lockfile lain. Perubahan versi dependensi memerlukan alasan dan verifikasi ulang.

- Next.js App Router dengan TypeScript strict.
- Supabase PostgreSQL, Auth, dan private Storage; schema melalui SQL migrations versioned.
- Validasi server dengan Zod serta SQL constraints.
- Worker Node/TypeScript terpisah dengan queue PostgreSQL untuk AI, import, screening, PDF, dan cleanup. Job tidak bergantung pada umur request web.
- Adapter terpisah: `AuthAdapter`, `StorageAdapter`, `AIProvider`, `DocumentParser`, `MalwareScanner`, `PdfRenderer`.
- PDF berupa HTML print template yang dirender Chromium menjadi A4 dengan searchable text.
- Provider AI produk ditetapkan T13 (`docs/decisions/0019-t13-ai-jobs-consent.md`): adapter OpenAI-compatible via `fetch` (default Chat Completions + json_schema strict), endpoint/model/key hanya di `.env.ai.local` milik worker, default mode `unavailable`. Sebutan LUNA MAX pada rencana merujuk pelaksana coding, bukan pilihan otomatis model AI produk.

```text
src/app/                    route dan server entrypoint
src/components/ui/          primitives dan feedback bersama
src/features/{domain}/      UI, contracts, services, queries per domain
src/server/                 auth, adapters, logging, config
src/domain/                 dates, revisions, metrics, CV rules
src/i18n/                   dictionary en dan id
src/styles/                 theme tokens
workers/                    AI, import, screening, export, cleanup
supabase/migrations/        SQL versioned
supabase/tests/             RLS, FK, transactions, concurrency
tests/{unit,integration,e2e,pdf}/
docs/decisions/             keputusan teknis dan alasan
docs/verification/          bukti acceptance
```

Struktur di atas sebagian besar sudah ada (termasuk `src/components/{ui,forms,layout}`, `src/server/{auth,storage,supabase,locale,theme}`, dan `src/features/{activity,achievement,project,evidence,profile,auth,ai}`, `src/domain/ai`, `src/server/ai`); `src/domain/import`, `src/features/import`, `src/server/documents`, dan route S03 `src/app/imports/` sudah ada; `src/domain/cv` dan `src/features/cv` sudah ada (T18), dengan route S13 `src/app/(workspace)/cv/` (T19); `src/server/export/` dan `workers/export-worker.ts` sudah ada (T21); route S14 `src/app/(workspace)/cv/preview/` dan `tests/pdf/` sudah ada (T22). Buat direktori/abstraksi ketika diperlukan task, bukan sebagai scaffolding spekulatif. Pisahkan aturan domain dari UI dan adapter. Simpan secret hanya pada konfigurasi server; `.env.example` berisi nama variabel dan placeholder, tanpa credential.

## Invariant data dan keamanan

### Ownership, transaksi, dan revisi

- Ambil identitas pengguna dari session server, bukan `user_id` yang dipercaya dari payload client.
- Terapkan RLS dan composite FK ownership `(user_id, parent_id)` sesuai schema, termasuk join, polymorphic target, AI target, dan CV source. Worker bercredential tinggi tetap memeriksa owner dan `deleting_at`.
- Validasi input di server dan database. Error harus aman, terlokalisasi, memiliki code/correlation ID, dan tidak membocorkan keberadaan record akun lain.
- Mutable save menggunakan `expected_revision`; update bersyarat menaikkan revision. Konflik menyediakan reload/rekonsiliasi sambil mempertahankan input lokal.
- Operasi yang dapat diulang memakai idempotency key scoped user, jenis operasi, dan input revision. Payload berbeda dengan key sama ditolak.
- Gunakan transaksi untuk propagation context, quota reservation, import commit, CV invalidation, dan export snapshot. Jangan menggantikan constraint atau locking database dengan pemeriksaan UI.
- Audit timestamp UTC; tanggal aktivitas mengikuti timezone IANA profil. Partial date menyimpan precision; unknown tetap NULL. Jangan menampilkan tanggal placeholder atau menolak overlapping history yang valid.

### Activity, achievement, dan AI

- Persist activity sebelum AI berjalan. `raw_text` nonblank maksimal 10.000 karakter dan tidak ditimpa AI. Kegagalan save mempertahankan input; feedback sukses hanya setelah commit.
- Maksimal satu derived achievement per activity, ditegakkan di database. Standalone achievement valid.
- Confirm membutuhkan `title`, `contribution`, `outcome`, `achieved_on`, dan `cv_bullet` valid. Metrics dan evidence opsional; jangan mengarang angka, impact, atau fakta.
- AI result disimpan pada job, lalu diterapkan melalui aksi Review pengguna. Tidak ada auto-confirm atau overwrite terhadap confirmed achievement/draft yang sudah diedit pengguna.
- Consent diperiksa sebelum enqueue, sebelum mengirim teks, dan sebelum apply. Evidence tidak dikirim ke AI. Input revision berubah berarti hasil lama tidak boleh diterapkan; follow-up maksimal tiga per activity revision sesuai kontrak rencana.
- Durable jobs memakai claim atomik, lease 120 detik, attempt token, dan guard completion. AI maksimal tiga attempts; worker dari lease lama tidak boleh menulis hasil belakangan.
- Penghapusan source mengikuti retention/provenance pada schema dan rencana. Delete project/activity tidak boleh menghapus karya turunannya secara tidak sengaja; invalidasi CV berlangsung dalam transaksi yang sama.

### Files, import, dan cleanup

- Semua bucket privat; download harus owner-authorized dengan signed URL maksimal lima menit. Service credential tidak masuk browser.
- Evidence: PDF/PNG/JPEG/DOCX, ukuran lebih dari 0 sampai 10 MiB/file, tiga file/parent, total 50 MiB/account. Reserve slot/bytes secara atomik; reservation berlaku 15 menit. Verifikasi signature, MIME, actual bytes, dan malware screening sebelum `ready`.
- Scanner unavailable berarti file belum boleh `ready`. Fake adapter hanya untuk development/tests dengan penanda jelas.
- Import PDF/DOCX maksimal 10 MiB dan 20 halaman. Terapkan parser timeout/decompression limits; hitung halaman DOCX dengan renderer terisolasi. Tidak ada OCR atau auto-confirm.
- Extraction hanya menghasilkan staging candidates. Commit pilihan `create`/`map`/`skip` atomik dan idempotent; `map` hanya reuse record yang dimiliki pengguna, tanpa menimpa record tersebut.
- Pertahankan provenance yang diperlukan sebelum purge. Ikuti retention rencana: cleanup evidence maksimal 24 jam, raw import dalam 24 jam setelah terminal state, export expired setelah 24 jam.
- Account deletion memblokir writes/jobs dan mencabut session; antrekan cleanup harus tetap hidup setelah row akun dihapus. Verifikasi konfigurasi purge/backup nyata sebelum menjanjikan retention.
- Jangan mencatat note/CV text, filename, attachment content, atau secret ke log/analytics.

### Master CV dan export

- Selection pengguna eksplisit; confirm achievement tidak otomatis memasukkannya ke CV. Child selection memasukkan parent yang diperlukan dan tidak dirender ganda.
- Pisahkan canonical source, saved snapshot, dan wording override. Refresh mempertahankan override kecuali Replace eksplisit.
- Freshness memakai source revision. Keep saved wording hanya mengakui revision tertentu; perubahan berikutnya kembali memerlukan review.
- Export memerlukan nama dan setidaknya satu experience/project/education/confirmed achievement yang eligible. Source deleted, unconfirmed, atau stale tanpa acknowledgement memblokir export.
- Validasi, lock CV/sumber, immutable snapshot, dan enqueue export terjadi dalam satu transaksi dengan urutan lock konsisten. Worker merender snapshot tersebut, tanpa membaca ulang career rows terbaru.
- Preview menunjukkan saved revision yang sama dengan export. Retry memakai snapshot yang sama; export expired diregenerasi sebagai request baru setelah validasi.
- Jangan memasukkan evidence atau link evidence ke PDF.

## UI dan aksesibilitas

Gunakan token `Design.md`: muted sage tanpa gradient, Plus Jakarta Sans, spacing berbasis 4px, light/dark theme, compact rows, satu aksi utama, dan progressive disclosure. Desktop memakai sidebar, mobile memakai drawer; Quick log langsung membuka input terfokus dalam satu aksi.

Gunakan primitives bersama dan satu keluarga ikon. Definisikan loading, empty, error, disabled, focus, unsaved, conflict, dan unavailable states yang relevan. Pertahankan filter dalam URL sesuai rencana. Save capture, confirm achievement, commit import, dan request export adalah aksi eksplisit; autosave harus menunjukkan status persistensi.

Targetkan WCAG 2.2 AA: keyboard navigation, label yang jelas, focus management/return, reduced motion, dan status yang tidak bergantung pada warna. Ukur kontras pada penggunaan token nyata. Verifikasi minimal viewport 360 px dan 1440 px dalam light/dark theme.

## Cara menjalankan pekerjaan

1. Untuk permintaan implementasi umum, lanjutkan task pertama yang belum DONE menurut rencana/status. Default satu task ID per sesi dengan dependensi DONE; pecah task besar menjadi subtask konkret. Untuk permintaan terarah, kerjakan lingkup yang diminta tanpa memulai milestone lain.
2. Sebelum edit, sampaikan scope singkat, dependensi, file yang diperkirakan berubah, dan checks yang akan membuktikan acceptance.
3. Terapkan perubahan terkecil yang lengkap. Pertahankan pekerjaan pengguna dan hindari refactor atau perubahan dokumen sumber di luar kebutuhan task.
4. Jalankan checks yang relevan dan catat hasil aktual. Selesaikan pekerjaan lokal yang independen bila integrasi belum tersedia.
5. Setelah task implementasi, perbarui `IMPLEMENTATION_STATUS.md`: task/tanggal/status, dependensi, scope selesai, file berubah, migration/keputusan, acceptance beserta bukti, perintah dan hasil, checks belum dijalankan beserta alasan, blocker, dan langkah berikutnya.
6. Gunakan TODO, IN_PROGRESS, PARTIAL, BLOCKED, DONE sesuai status file. DONE membutuhkan bukti acceptance; scaffold atau mock bukan integrasi selesai. Simpan rencana task di `docs/verification/Txx-implementation-plan.md` dan bukti acceptance di `docs/verification/`.
7. Pada gate M1–M5, baca ulang acceptance terkait dan lakukan integration review sebelum lanjut. Deployment mengikuti environment dan otorisasi pengguna yang berlaku; keberhasilan lokal bukan bukti production live.

## Verifikasi

Gunakan scripts dari `package.json` melalui pnpm; `README.md` mendokumentasikan setup web/worker/database. Jangan mengklaim perintah sudah lulus tanpa menjalankannya.

- Gate dasar: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, dan `pnpm worker:check`.
- Database lokal (Docker + Supabase CLI): `pnpm db:start`, `pnpm db:test` (pgTAP di `supabase/tests/`), `pnpm db:lint`, dan `pnpm db:types` setelah migration. Migration bersifat forward-only; jangan `db:reset` database lokal aktif tanpa persetujuan pengguna.
- Integration per domain: `pnpm test:integration:{activity,projects,achievements,storage,evidence}` terhadap Supabase lokal dengan `.env.local`; export CV `pnpm test:integration:cv-export` juga membutuhkan renderer `workpulse-t21-pdf` (`WORKPULSE_PDF_GOTENBERG_URL`), begitu pula QA PDF `pnpm test:pdf` dan E2E S14 `pnpm test:e2e:cv-export`.
- E2E per domain: `pnpm test:e2e`, `pnpm test:e2e:{auth,ui,activity,projects,achievements,evidence}`; masing-masing memakai config `playwright.*.config.ts` sendiri dan membersihkan fixture akun test.
- Scanner nyata untuk evidence mengikuti `docs/verification/T10-scanner-runbook.md`.

- Unit: date intervals, metrics, normalization, confirmation, dan CV freshness.
- Integration dengan PostgreSQL nyata: RLS dua akun, composite FK, atomic commit, revision locking, quota races, dan export/source mutation races.
- E2E: alur pengguna terkait task; manual capture harus tetap berhasil ketika AI unavailable.
- PDF: ekstraksi teks cocok snapshot, searchable A4, Unicode id/en, multipage, tanpa clipping atau heading yatim. Inspeksi rendered pages, bukan hanya keberadaan file.
- Release: ikuti matriks §6 rencana dan enam skenario PRD; integrasi storage, screening, auth, worker, dan PDF tidak cukup dibuktikan dengan mock.
- Performance T24: fixtures 1.000 activities, 200 achievements, 50 projects; ukur target p95 sesuai rencana dan catat lingkungan/metode. Target pilot adalah hipotesis sampai ada data pengguna consenting yang nyata. Suite `pnpm test:perf` dijalankan sendirian (tanpa suite lain, `next build`, atau `next dev` di checkout yang sama) dan menulis `docs/verification/T24-perf-results.json` kecuali `WORKPULSE_PERF_OUT` diarahkan ke tempat lain. Event produk diuji dengan `pnpm test:integration:product-events`.

Jalankan pemeriksaan sesuai dampak perubahan. Untuk perubahan dokumentasi saja, verifikasi konsistensi isi, path/rujukan, dan diff; jangan mengarang build/test aplikasi. Ringkasan akhir menyebut hasil, verifikasi yang benar-benar dijalankan, dan keterbatasan yang masih terbuka.

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.codex/skills/antislop/SKILL.md`
- UI / visual: `antislop-ui`: `.codex/skills/antislop-ui/SKILL.md`
- Copy & text: `antislop-copywriting`: `.codex/skills/antislop-copywriting/SKILL.md`
- People: `antislop-human`: `.codex/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.codex/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.codex/skills/antislop-code/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
