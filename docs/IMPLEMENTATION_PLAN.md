# WorkPulse MVP v0.1 Implementation Plan

Tanggal: 10 September 2026. Target pelaksana: LUNA dengan reasoning MAX. Status: rencana implementasi; aplikasi belum dibuat. Workspace saat penyusunan hanya berisi lima dokumen sumber.

Rencana ini membagi MVP menjadi paket kerja berurutan dengan batas perubahan, dependensi, dan bukti penerimaan. Hasil akhir adalah aplikasi web privat: pengguna mencatat aktivitas, mengonfirmasi pencapaian, memilihnya ke satu master CV, lalu mengunduh PDF. Jalur manual harus tetap berfungsi ketika AI tidak tersedia.

## 1 Acuan dan batas keputusan

| Kode | Dokumen | Acuan utama |
| --- | --- | --- |
| PRD | [WorkPulse_PRD_v0.1.docx](WorkPulse_PRD_v0.1.docx) | R01–R10, validasi, batas MVP, M1–M5 |
| FLOW | [WorkPulse_User_Flow_v0.1.docx](WorkPulse_User_Flow_v0.1.docx) | F01–F07, transisi, recovery |
| UI | [WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx](WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx) | S01–S14, route, input dan state |
| DB | [WorkPulse_Database_Schema_v0.1.docx](WorkPulse_Database_Schema_v0.1.docx) | Field, ownership, relasi, transaksi, snapshot |
| DESIGN | [Design.md](Design.md) | Token, komponen, tema, aksesibilitas, responsive |

Keputusan kerja berikut menyelesaikan pertentangan sumber untuk kebutuhan rencana. Ini interpretasi eksplisit, bukan perubahan terhadap dokumen asli. PRD menentukan scope, DB menentukan persistence, FLOW dan UI menentukan perilaku; DESIGN diterapkan untuk visual dan interaksi yang kompatibel. Jika ditemukan konflik baru yang mengubah hasil produk, catat dalam decision log sebelum mengerjakan bagian tersebut.

| Perbedaan sumber | Keputusan implementasi v0.1 |
| --- | --- |
| DESIGN §4 menempatkan Skills dan Career Profile di navigasi utama | Ikuti UI §1: Dashboard, Activity, Achievements, Projects, Timeline, CV; profile/settings di bagian bawah. Skill diedit di S12. |
| DESIGN §5, §11–13 memuat proficiency, readiness dan CV target lowongan | Ikuti PRD §2–5: skill berupa label dan jumlah achievement confirmed; tanpa readiness, target job, auto-selection AI atau CV variants. |
| DESIGN §8 memakai paused/archived dan progress | Ikuti DB §2: planned/active/completed; tanpa progress percentage. |
| DESIGN §39 mensyaratkan CV, role, company dan years of experience | Ikuti PRD shared validation dan F01: hanya display name wajib; tanpa CV dan employment tetap bisa onboarding. |
| DESIGN §14–15 memuat library, global search, command palette dan coach | Tidak menjadi paket wajib v0.1. Evidence tertanam pada S06/S08/S10; filter lokal tetap ada. |
| DESIGN §33 meminta AI Insight persisten | Dashboard memakai agregat faktual dan actionable checks PRD. Coaching lintas riwayat ditunda. |
| DESIGN §6 menyebut activity masuk timeline | Activity masuk daftar aktivitas S06; career timeline S11 hanya event yang ditentukan R08. |
| DESIGN §7 melarang penciptaan achievement otomatis | Hasil AI disimpan di ai_jobs.result; pengguna membuka Review untuk membuat/menerapkan draft. Tidak ada auto-confirm. |
| DESIGN §26 memilih autosave sebagai default | Autosave hanya draft/edit yang jelas status persistensinya. Save capture, confirm achievement, commit import, dan request export tetap aksi eksplisit. |
| PRD menyebut empat field konfirmasi; DB/UI juga mewajibkan CV bullet | Wajib title, contribution, outcome, achieved_on dan cv_bullet; fallback faktual membentuk bullet saat AI tidak tersedia. |
| DESIGN default English; PRD mewajibkan id/en | Default awal English, pilihan Bahasa Indonesia tersedia sejak akun/onboarding. Locale tidak menerjemahkan konten sumber. |

Yang tetap diambil dari DESIGN: sage tanpa gradient, Plus Jakarta Sans, light/dark theme, spacing 4px, compact rows, satu aksi utama, progressive disclosure, mobile drawer, Quick log satu aksi dari workspace, skeleton, focus management, reduced motion dan target WCAG 2.2 AA. Ukur kontras token dalam pemakaiannya; jangan menganggap semua kombinasi token otomatis lolos.

Tidak termasuk: billing, team/HRIS, public profile, recruiter search, job matching, interview, evidence AI analysis, OCR, offline sync, enkripsi end-to-end, penerjemahan otomatis, serta aplikasi native.

## 2 Arsitektur yang diusulkan

Pilihan berikut adalah baseline rencana, bukan stack yang sudah terpasang. Tidak ada klaim mengenai versi terbaru. Pada T01, periksa dokumentasi resmi kompatibilitas, pin versi paket, lalu simpan lockfile.

| Lapisan | Pilihan kerja | Batas tanggung jawab |
| --- | --- | --- |
| Web | Next.js App Router dan TypeScript strict | UI, session boundary, authenticated server operations |
| Database | PostgreSQL melalui Supabase; SQL migrations | RLS, composite FK, revision, transaksi dan queue |
| Auth dan files | Supabase Auth dan private Storage | Session, recovery, bucket privat, URL sementara |
| UI | CSS tokens, accessible primitives, satu keluarga icon | Komponen reusable; id/en dictionaries dan tema |
| Validasi | Zod pada server boundary dan SQL constraints | Jangan mengandalkan validasi browser |
| Background | Proses worker Node/TypeScript terpisah, queue PostgreSQL | AI, import, PDF, screening, cleanup; tidak bergantung pada umur request web |
| AI | Interface provider dengan structured result | Provider/model runtime aplikasi dipilih pada T13; LUNA MAX adalah pelaksana coding, bukan otomatis model AI produk |
| Parsing | Adapter PDF text dan DOCX; renderer terisolasi untuk hitung halaman DOCX | Validasi sebelum extraction, tanpa OCR atau eksekusi macro |
| PDF | HTML print template dan Chromium worker | A4 searchable text dari immutable snapshot |
| Uji | Unit runner, integration PostgreSQL, Playwright | Domain invariants, dua akun, E2E, PDF dan responsive |

Pisahkan `AuthAdapter`, `StorageAdapter`, `AIProvider`, `DocumentParser`, `MalwareScanner`, dan `PdfRenderer`. Fake adapter boleh untuk development/tests dengan penanda jelas; production tidak boleh menyatakan screening, AI, atau export sukses dengan fake.

Struktur target:

```text
src/app/                     routes S01–S14 dan server entrypoints
src/components/ui/           primitives dan shared feedback
src/features/{domain}/       UI, contracts, services, queries per domain
src/server/                  auth, adapters, logging, config
src/domain/                  dates, revisions, metrics, CV rules
src/i18n/                    en dan id
src/styles/                  theme tokens
workers/                     import, AI, storage, export, cleanup
supabase/migrations/         SQL versioned
supabase/tests/              RLS, FK, transaksi, concurrency
tests/{unit,integration,e2e,pdf}/
docs/decisions/              keputusan implementasi
docs/verification/           bukti acceptance dan release
IMPLEMENTATION_STATUS.md     checkpoint pelaksana
```

Nama file rinci dapat mengikuti pola repository yang terbentuk pada T01. Hindari membuat abstraction besar sebelum ada pemakai nyata.

## 3 Kontrak lintas fitur

### Ownership dan concurrency

- `profiles.id` adalah ID auth; tabel milik pengguna lain memiliki `user_id`. UUID dibuat server, timestamp audit UTC, locale id/en, timezone IANA.
- Aktifkan RLS dan composite FK `(user_id, parent_id)` untuk semua relasi, termasuk polymorphic targets, join, AI target dan CV sources. Worker bercredential tinggi tetap memvalidasi owner dan `deleting_at`.
- Server mengambil user dari session; payload client tidak menentukan pemilik. Worker state, reservation, import commit, AI result dan export snapshot hanya ditulis operasi server yang dibatasi.
- Mutable save membawa `expected_revision`. Update bersyarat menaikkan revision; mismatch menghasilkan conflict dengan opsi reload/rekonsiliasi tanpa membuang input lokal. Append-only chat, immutable export payload dan housekeeping mempunyai aturan khusus yang dicatat.
- Operasi berpotensi diulang membawa idempotency key yang scoped user + jenis operasi + input revision. Request identik mengembalikan hasil lama; key sama dengan payload berbeda ditolak.
- Error contract: `code`, pesan lokal yang aman, optional field errors, correlation ID. Bedakan validation, unauthorized, unavailable, conflict, quota, stale input, timeout dan dependency unavailable. Jangan bocorkan keberadaan record akun lain.

### Data karier

- Partial date menggunakan date + precision year/month/day, unknown menggunakan keduanya NULL. Tampilan tidak membocorkan tanggal placeholder. Bandingkan interval pengetahuan; tolak hanya urutan yang pasti bertentangan. Current mensyaratkan end NULL.
- Aktivitas mempunyai raw_text nonblank maksimal 10.000 karakter dan tanggal tepat menurut timezone profil. AI tidak mengubah raw_text. User edit dan perubahan input chat relevan menaikkan input revision agar hasil lama tidak dapat diterapkan.
- Satu derived achievement per activity; standalone achievement tetap valid. Project menentukan experience termasuk NULL; derived achievement mengikuti konteks activity. Relink dan perubahan konteks project harus atomik.
- Confirm hanya dengan title, contribution, outcome, tanggal, dan CV bullet valid. Metrics opsional berbentuk label/value/unit dengan optional baseline/period; tidak mengisi nol atau impact rekaan. Skill dinormalisasi server; hitungan hanya distinct confirmed achievements.
- Delete project mempertahankan activity/achievement dan experience mereka; delete experience membersihkan context terkait tanpa menghapus karya. Delete activity mempertahankan achievement beserta source excerpt/revision. Invalidasi snapshot CV dan increment revision dilakukan dalam transaksi yang sama.

### Jobs dan data privat

- Durable job: queued → running → succeeded/failed; explicit retry failed → queued. Lease 120 detik, claim atomik dan token kepemilikan lease. Worker terlambat tidak boleh menyelesaikan attempt yang sudah expired/digantikan. AI maksimal tiga attempts.
- Cek consent sebelum enqueue dan sebelum mengirim teks ke provider. Recheck sebelum apply; penarikan consent mencegah request berikutnya. Tidak ada evidence dikirim ke AI. Hasil invalid/stale tidak diterapkan.
- Evidence: PDF/PNG/JPEG/DOCX, lebih dari 0 sampai 10 MiB/file, tiga file/parent, 50 MiB/account. Reserve dengan lock profil dan parent sebelum upload; uploading/scanning/ready dihitung. Reservation berlaku 15 menit, actual bytes diverifikasi dan malware screening wajib sebelum ready.
- Evidence hanya memiliki satu parent. Move eksplisit memvalidasi slot destination secara atomik; tidak menambah bytes akun. Files failed/pending tidak dihitung sebagai evidence pendukung. Bucket/prefix import, evidence dan export dipisahkan.
- Signed download maksimal lima menit, owner authorized dan attachment disposition. Delete langsung menutup penerbitan URL baru; URL yang sudah terbit mengikuti kemampuan revocation provider dan tetap expired maksimal lima menit.
- Cleanup evidence object maksimal 24 jam. Original import file/extracted text dihapus dalam 24 jam setelah terminal commit/cancel/failure; provenance yang diperlukan disalin sebelum purge. Export object expired setelah 24 jam, CV tetap tersimpan.

### CV

- Satu master CV/account, locale id/en, template `single_column_v1`. Supported sections: experience, projects, achievements, education, skills, certifications.
- Selecting child memilih parent yang diperlukan. Parent removal meminta penyelesaian child selection. Achievement contextual tampil di bawah parent; standalone di achievement section; tidak dirender ganda.
- Snapshot dan override terpisah. Freshness membandingkan revision sumber; Keep saved wording mengakui revision live tertentu, edit berikutnya menjadi changed lagi. Refresh tidak mengganti override kecuali Replace eksplisit. Aturan sama untuk profile/contact.
- Export membutuhkan nama dan minimal satu experience/project/education/confirmed achievement. Source deleted, unconfirmed, atau stale tanpa acknowledgement memblokir export; konfirmasi achievement tidak otomatis memilihnya ke CV.
- Lock CV serta semua sumber terpilih dengan urutan konsisten saat validasi/export, lalu simpan immutable snapshot dan job dalam satu transaksi. Semua mutation CV child menaikkan parent revision. Worker hanya membaca snapshot ekspor, bukan career rows terbaru.
- Source edit/delete/reopen yang bersaing dengan export menghasilkan satu urutan transaksi konsisten: export tervalidasi sebelum perubahan, atau conflict/block setelah perubahan. PDF yang sudah valid dibuat dari snapshot lama tetap tidak berubah.

## 4 Detail schema yang perlu dilengkapi

DB v0.1 memberikan kontrak logis tetapi belum seluruh field operasional. Berikut extension teknis yang diusulkan; dokumentasikan SQL final dan alasan pada T02/T13. Jangan mengganti field canonical yang sudah ditentukan.

| Gap | Penyelesaian yang direncanakan |
| --- | --- |
| Save activity wajib idempotent tetapi tabel belum memiliki operation key | Tabel internal `operation_requests` dengan unique user/operation/key, payload hash, hasil minimal; disimpan dalam transaksi domain. Terapkan retention tanpa menghilangkan dedup pada jendela retry yang dijanjikan. |
| Lease disebut tanpa lease field | Tambah lease expiry, attempt token, attempt count bila belum ada pada ai_jobs/cv_exports dan storage_jobs; CAS diperlukan untuk completion. |
| Maksimal tiga follow-up per revision dan suppression dismissed belum dimodelkan lengkap | Tambah source revision pada chat dan metadata pertanyaan/suppression per activity revision; counter atomik, bukan penghitung browser. Definisikan jawaban sebagai revisi input baru dan jangan reset limit hanya karena retry job. |
| pages import wajib diverifikasi tanpa kolom | Simpan `page_count` setelah parsing/rendering yang terpercaya; DOCX metadata pages bukan sumber otoritatif. Batasi parsing time, memory dan uncompressed ZIP size. |
| Import achievement memerlukan pilihan confirm tetapi action hanya create/map/skip | Simpan status reviewed draft/confirmed di payload tervalidasi; konfirmasi eksplisit menjadi bagian commit. Mapping tidak mengubah target. |
| Profil nonblank wajib tetapi new user belum mengisi nama | Pertahankan session auth tanpa profile lengkap untuk onboarding awal. Buat profile setelah input nama atau atomic import commit; buat provisional display_name netral nonblank untuk import staging jika root dibutuhkan, dengan flag onboarding_completed_at NULL. Jangan tampilkan placeholder sebagai nama CV yang valid. Finalisasi onboarding hanya setelah user memilih nama nyata. |
| Cleanup account dapat kehilangan antrean saat profile dihapus | Queue cleanup internal tanpa FK cascade ke profile; enqueue semua object dahulu, blokir writes, revoke session, lalu purge rows. Simpan receipt minimal sampai object deletion terverifikasi. |
| CV consistency lintas source delete/edit belum berupa lock protocol | Semua domain mutation yang menyentuh CV memakai protocol lock yang sama; uji deadlock/retry dan race, termasuk edit profile serta child parent-context. |

Profil provisional adalah satu opsi teknis untuk kebutuhan FK import; pada T02 pilih dan tulis satu lifecycle final sebelum migration dibuat. Jangan membuat dua jalur yang berbeda tanpa invariant yang sama. Kewajiban produk tetap hanya nama saat onboarding selesai.

## 5 Paket implementasi untuk LUNA MAX

Kerjakan satu ID per sesi. Jika satu ID terlalu besar, pecah menjadi subtask bernomor sebelum coding; setiap subtask tetap menghasilkan perubahan yang bisa diuji. Dependensi harus DONE sebelum task dimulai. Semua task memerlukan catatan file berubah, acceptance, perintah uji dan hasil aktual.

### M1 Foundation

**T01 Bootstrap dan kontrak proyek — dependensi: tidak ada.**

- Baca PRD §1/5, DB §1, dan rencana ini. Buat aplikasi TypeScript, scripts lint/typecheck/test/build, env example tanpa secret, health endpoint, struktur folder serta status file.
- Pin versi kompatibel, pilih primitives dan runner, catat keputusan arsitektur dan cara menjalankan web/worker/database lokal. Jangan implementasi fitur bisnis dahulu.
- Selesai jika clean install dari lockfile dan empat checks berjalan; aplikasi menampilkan shell kosong, tidak memakai data karier palsu sebagai data production.

**T02 Schema dasar dan tenant boundary — dependensi: T01.**

- Sumber DB §1/2/6. Selesaikan lifecycle profile awal dan extension lintas fitur pada §4. Buat migrations profiles, experiences, education, certifications, projects, skills; checks partial dates, normalized skills, indexes, revision dan RLS.
- Buat fixtures dua akun, fresh graduate dengan unknown dates, dan overlapping employment. Siapkan DB test harness dan helper transaction.
- Selesai jika rebuild database berhasil, cross-owner read/write/FK ditolak, duplicate skill ditolak, unknown/overlap dates valid dan definite end-before-start ditolak.

**T03 Auth dan profil — dependensi: T02.**

- Sumber R01, F01, S01/S12. Implement signup, verification, sign-in/out, recovery, session expiry, safe return route; profile CRUD, locale/timezone, foundation editors dan conflict handling.
- Onboarding manual hanya meminta nama; record employment/education opsional. Import CTA boleh menampilkan status belum tersedia sampai T17, bukan flow sukses palsu.
- Selesai jika pengguna tanpa CV/employment masuk dashboard; anonymous dan user kedua tidak melihat profil; expired save mempertahankan input dan meminta sign-in.

**T04 Design system dan application frame — dependensi: T03.**

- Sumber UI §1, DESIGN §16–38. Implement tokens light/dark, font, id/en strings, sidebar/drawer, global Quick log dan primitives yang dibutuhkan saat ini.
- Shared states: skeleton, empty, inline errors, toast, unsaved dialog, named delete dialog, revision conflict, unavailable record. Filter disimpan dalam URL.
- Selesai jika navigasi enam tujuan benar; 360/1440 px tidak overflow; keyboard, focus return, reduced motion dan theme switch dapat diperiksa. Bangun komponen tambahan saat feature membutuhkannya.

**T05 Private storage foundation — dependensi: T02.**

- Sumber DB §4/6 dan R07 privacy. Siapkan adapter, bucket privat, path owner/category/object_uuid, unauthorized URL rejection, metadata validation dan internal storage_jobs migration.
- Definisikan scanner interface dan configuration failure behavior. Tidak ada public bucket atau browser service credential.
- Selesai jika dua akun tidak bisa mengakses path satu sama lain dan URL expiry dibatasi server; cleanup queue tetap hidup setelah parent dihapus.

**Gate M1:** T01–T05 selesai; foundation CRUD, isolation dan record lifecycle dasar lolos. Evidence UI belum diperlukan pada gate ini.

### M2 Capture dan penggunaan manual

**T06 Activity persistence — dependensi: T03.**

- Sumber R04, F02, DB §3. Buat activities/chat schema, save/edit/list/detail services, operation dedup, pagination 30 dengan tie breaker id.
- Selesai jika retry save tidak menduplikasi, exact date timezone benar, 10.001 karakter ditolak, dua edit bersamaan menghasilkan conflict, raw_text tersimpan tanpa AI.

**T07 Capture dan activity UI — dependensi: T04, T06.**

- Sumber S05/S06. Buat Note/Form dan Chat manual entry; pesan pertama dipersist sebagai raw_text sebelum pemrosesan tambahan. Optional fields progressively disclosed, filter date/project, save feedback hanya setelah commit.
- Hubungkan global Quick log langsung ke input terfokus. AI controls baru aktif setelah T14; jangan menyatakan analisis berlangsung tanpa job.
- Selesai jika save gagal mempertahankan teks, return list mempertahankan filter, deep link hilang aman, manual capture bekerja pada mobile/keyboard.

**T08 Project dan context propagation — dependensi: T06, T04.**

- Sumber R06/F04/S09/S10, DB §3/6. Implement project CRUD, statuses, list/detail, attach existing owned activity, context relink dan delete dependency preview.
- Selesai jika completed tanpa outcome tetap tersimpan dengan check; standalone academic project valid; delete project membersihkan project link tetapi mempertahankan experience serta aktivitas. Tambahkan propagation achievement saat T09 masuk.

**T09 Manual achievements dan skills — dependensi: T08.**

- Sumber R05/F03/S07/S08, DB §3. Migration achievements/achievement_skills, create standalone/derived draft, edit/confirm/dismiss/reopen, filters, metrics validation, skill tags dan factual CV bullet fallback.
- Terapkan unique activity, context propagation, retained provenance saat activity dihapus, serta dependent delete preview.
- Selesai jika qualitative achievement confirmed tanpa angka/evidence; dismissed harus kembali draft sebelum confirm; edit confirmed valid tetap confirmed; draft tidak masuk demonstrated count. Satu activity tidak bisa menghasilkan dua achievement melalui race.

**T10 Evidence reservation dan screening backend — dependensi: T05, T09.**

- Sumber R07/F05, DB §4. Buat evidence_files, quota reservation, finalize signature/MIME/actual size, scanning job, expiration dan orphan cleanup.
- Pasang scanner nyata untuk staging; ketika scanner unavailable file tidak boleh ready. Worker menggunakan claim atomik dan retry yang tercatat.
- Selesai jika concurrent uploads pada slot/byte boundary hanya mengizinkan kapasitas sah; oversized atau MIME spoof ditolak, abandoned reservation released dan quota kembali benar.

**T11 Evidence UI dan lifecycle — dependensi: T10.**

- Sumber S06/S08/S10 dan F05. Attachment control menampilkan uploading/scanning/ready/failed/deleting, retry reservation baru, authorized download, named remove dan move activity → achievement.
- Selesai jika moving ke parent penuh ditolak tanpa kehilangan file; parent deletion menutup akses baru dan mengantrikan object; file project tidak dihitung sebagai direct evidence achievement.

**T12 Dashboard dan timeline — dependensi: T07, T09, T11.**

- Sumber R03/R08, F06, S04/S11. Query recent occurred_on, active projects, confirmed counts, distinct demonstrated skills, missing direct ready evidence dan completed missing outcome. CV review checks dihubungkan pada T20.
- Timeline derived dari experience, education, project starts, confirmed achievements; year grouping, unknown dates di bawah, overlap tetap tampak, deep link ke editor canonical.
- Selesai jika semua count cocok fixtures dan setiap check menuju filter sumber; empty dashboard memiliki CTA manual/import yang benar; tanpa readiness/proficiency/streak.

**Gate M2:** F02–F06 manual berjalan dari note hingga confirmed achievement, evidence privat dan timeline; tidak bergantung pada AI.

### M3 Assisted entry

**T13 Durable AI jobs dan consent — dependensi: T06, T05.**

- Sumber PRD §3/4, DB §3. Implement ai_jobs, consent version/timestamp, provider adapter, claim/lease 120 detik, maksimal tiga attempts, idempotency dan structured validation.
- Pilih provider/model aplikasi dan dokumentasikan env, text minimization, error handling; mock deterministic hanya untuk tests. Consent decline/withdrawal tidak menutup manual features.
- Selesai jika duplicate requests memakai job sama, stale source menghasilkan STALE_INPUT, worker timeout tidak bisa menulis belakangan, deleting account diblokir dan tidak ada secret/source text di log.

**T14 Detection, refinement dan review — dependensi: T13, T09, T07.**

- Sumber R05/F02/S06/S08. Save → queue → optional questions → review draft; source selalu terlihat. Tiga follow-up maksimum per activity revision, skippable; dismissed suppression tersimpan server.
- Terapkan hasil hanya melalui review action dan expected revisions activity serta draft; jangan overwrite confirmed atau draft yang sudah diedit pengguna. Nonpotential tetap activity normal.
- Selesai jika consent declined, AI outage, malformed output, edit-while-running, repeated retry dan dismissed-reanalysis lolos; fallback manual tetap dapat confirm. Uji output tidak menambahkan angka/fakta dari luar input.

**T15 Import upload dan extraction staging — dependensi: T13.**

- Sumber R02/F01/S02, DB §4. Buat import_batches/items, upload PDF/DOCX ≤10 MiB/20 halaman, signature checks, scanner, extraction dan structured candidates dengan excerpt.
- Deteksi encrypted/scanned/corrupt/unsupported/oversized, decompression limits dan parser timeout. Jumlah halaman DOCX diverifikasi lewat rendering terisolasi; jika tidak bisa diverifikasi tampilkan kegagalan/manual path.
- Selesai jika tidak ada canonical record ditulis oleh extraction; cancel, leave-return, same-batch retry, duplicate-hash warning dan terminal retention berjalan. Tidak ada OCR atau auto-confirm.

**T16 Import commit transaction — dependensi: T15, T09.**

- Sumber DB §4 import commit. Lock batch, validate payload dan owner mapped target, resolve temporary IDs foundation dahulu, commit pilihan create/map/skip atomik, simpan committed IDs dan counts.
- Map hanya reuse; profile hanya reviewed selected fields; achievement default draft kecuali user confirm lengkap. Profile lifecycle mengikuti T02.
- Selesai jika double commit mengembalikan hasil awal; foreign mapping ditolak; satu invalid item me-rollback semuanya; mapping tidak mengubah existing row dan excerpts tetap ada setelah raw purge.

**T17 Import review UI dan onboarding lengkap — dependensi: T16, T04.**

- Sumber S02/S03/F01. Editable grouped candidates, excerpt, missing fields, duplicate warning, persisted create/map/skip dan explicit per-achievement confirmation.
- Hubungkan returning user import dari S12 dan empty dashboard; result counts aktual menuju S04.
- Selesai jika CV Indonesia dengan overlapping roles berhasil direview sekali; incomplete extraction bisa diperbaiki, empty extraction menawarkan manual, refresh tidak kehilangan pilihan yang telah tersimpan.

**Gate M3:** F01 import dan F02 assisted lolos bersama malformed file, retry, consent withdrawal, AI unavailable dan stale-result scenarios.

### M4 Master CV dan PDF

**T18 CV schema dan selection service — dependensi: T09, T03.**

- Sumber R09/F07/DB §5. Buat cv_documents/items/exports, unique CV/account, section/source checks, snapshots, parent auto-selection dan transactional reordering dengan unique positions deferrable.
- Selesai jika concurrent first open menghasilkan satu CV; draft tidak eligible, child memasukkan parent, duplicate sources ditolak dan child mutation menaikkan CV revision.

**T19 CV builder dan overrides — dependensi: T18, T04.**

- Sumber S13. Implement enam section, locale labels, selection, accessible move up/down, summary/contact editing dan per-item override terpisah. Add to CV hanya highlight candidate untuk dipilih.
- Initial template dari sumber tanpa AI; save state eksplisit dan revision guard. Preview model berasal dari saved snapshot.
- Selesai jika graduate dengan education/project bisa menyusun CV, manual wording tidak mengubah canonical record, parent removal menangani child, dan stale concurrent edit tidak overwrite.

**T20 Source freshness dan deletion integration — dependensi: T19, T12.**

- Sumber PRD freshness, DB §5/6. Terapkan changed/override/deleted/unconfirmed states, Keep saved wording per live revision, Refresh dan Replace eksplisit termasuk profile/contact.
- Integrasikan invalidation pada seluruh foundation/activity/context/achievement mutation dan delete, source snapshot retained sebelum FK cleared. Tambahkan dashboard changed vs available CV checks.
- Selesai jika source edit kedua membuat acknowledgement lama tidak berlaku, refresh mempertahankan override, source delete/reopen memblokir eligibility dan source activity edits memunculkan kebutuhan review tanpa silent overwrite.

**T21 Immutable export backend — dependensi: T20, T05, T13.**

- Sumber R10/F07/DB §5. Transaction request memvalidasi nama/substantive record, source state, freshness, revision dan ordering dengan lock protocol; snapshot/job disimpan bersama.
- Worker render template A4 searchable, tidak requery career data, tanpa evidence/link evidence. Retry menggunakan snapshot sama; expired export dapat regenerate sesudah validasi current saved CV sebagai request baru.
- Selesai jika edit/delete/reopen source racing export memberi consistent snapshot atau actionable conflict; failed render mempertahankan CV; lease timeout, duplicate export dan 24-hour expiry bekerja.

**T22 Saved preview dan PDF QA — dependensi: T21.**

- Sumber S14 dan R10. Tampilkan exact saved revision, page boundaries/navigation, job status, Retry, Download dan Regenerate. Jangan menampilkan unsaved CV sebagai preview export.
- Fixture: Bahasa Indonesia/English, long bullet, Unicode, multipage, unknown dates, overlapping roles, selected contextual/standalone achievements dan override.
- Selesai jika hasil extract PDF cocok snapshot, heading tidak terpisah sendirian dari konten, bullets tidak split jika muat satu halaman, teks tidak clipping, dan URL download owner-scoped maksimal lima menit. Lakukan inspeksi rendered pages, bukan hanya assertion file exists.

**Gate M4:** F07 end-to-end lolos; snapshot/provenance/override terjaga dan PDF dapat dibaca serta dicari.

### M5 Pilot readiness

**T23 Account deletion dan retention — dependensi: T17, T22.**

- Sumber R01, PRD §4, DB §6. Reauthentication, data-loss confirmation, deleting flag, immediate session revocation, block writes/jobs, enqueue seluruh objects sebelum purge account rows.
- Rekonsiliasi cleanup retry/orphans untuk evidence, import dan exports. Verifikasi active purge ≤24 jam dan backup retention ≤30 hari dari konfigurasi layanan; jangan menjanjikan retention yang belum dapat dibuktikan.
- Selesai jika worker restart tidak kehilangan cleanup, deleted account tidak bisa retry jobs, queue surviving FK deletion teruji dan bukti retention tercatat.

**T24 Instrumentation dan performance — dependensi: T23.**

- Sumber PRD §4/5. Events activation, achievement confirmation, activity saved dan export terminal memakai metadata minimal tanpa note/CV text, filename atau attachment content. Pilot consenting users dipisahkan dari fixture data.
- Seed 1.000 activities, 200 achievements, 50 projects; ukur p95 query/list/dashboard <2 detik dan save <1 detik tanpa network/AI. Catat lingkungan, sample count, warm/cold treatment dan hasil; optimasi indeks berdasar query plan.
- Selesai jika events dapat menghitung activation 24 jam, value completion 7 hari, return capture 28 hari dan export reliability; angka target PRD disebut hipotesis, bukan hasil tercapai.

**T25 Regression, aksesibilitas dan release handoff — dependensi: T24.**

- Jalankan matriks §6, production build, clean migration rebuild, dua akun untuk seluruh tabel/storage/worker, responsive 360/1440 px light/dark, keyboard/screen-reader checks dan contrast scan.
- Buat runbook deploy/migrate/worker/rollback/restore, daftar env, health checks, alert failed jobs/cleanup backlog, serta release checklist. Jangan rollback dengan menghapus user data; gunakan forward fix bila schema sudah berisi data.
- Selesai jika R01–R10 lulus dengan bukti, tidak ada critical privacy/data-loss defect dan integrasi nyata diverifikasi di staging. Publish production memerlukan environment dan otorisasi deployment yang sesuai; jangan menyebut production live hanya karena lokal lulus.

**Gate M5:** seluruh acceptance lulus. Target pilot 60% activation, 40% value completion, 30% return capture dan 98% export reliability baru dievaluasi dari 20 consenting pilot users; bukan syarat metrik yang bisa dibuktikan sebelum pilot berjalan.

## 6 Matriks verifikasi

| Requirement | Flow / screen | Paket utama | Bukti minimum |
| --- | --- | --- | --- |
| R01 | F01; S01/S12 | T02–T05, T23 | Auth/recovery/expiry, dua akun, CRUD profil, deletion |
| R02 | F01; S02/S03/S12 | T15–T17 | Malformed import, review saved, atomic commit, retry dedup |
| R03 | F01/F06/F07; S04 | T12/T20 | Counts dari fixtures, link checks, changed vs available |
| R04 | F02; S05/S06 | T06/T07 | Persist before AI, timezone, failed save input, optimistic conflict |
| R05 | F02/F03; S07/S08 | T09/T13/T14 | Confirm guards, 3 questions, stale AI, source preserved |
| R06 | F04; S09/S10 | T08/T09 | Context propagation, standalone, delete retain records |
| R07 | F05; S06/S08/S10 | T05/T10/T11 | Race quotas, signature/screening, move, owner URL, cleanup |
| R08 | F06; S11 | T12 | Partial/unknown/overlap dates, canonical deep links |
| R09 | F03/F07; S13 | T18–T20 | Selection, ordering, override, acknowledgement and invalidation |
| R10 | F07; S14 | T21/T22 | Immutable snapshot race, searchable A4, layout, retry/expiry |

Unit tests ditujukan pada date intervals, metrics, normalization, confirmation dan CV freshness rules. Integration tests memakai PostgreSQL asli untuk RLS, composite FK, transactions, quota races dan revision locking. E2E membuktikan pengguna dapat menyelesaikan workflow. Mock-only tests tidak cukup untuk privacy, storage atau PDF acceptance.

Enam release scenarios PRD wajib dicatat satu per satu: import CV Indonesia; graduate tanpa CV/employment; note ketika AI unavailable lalu stale retry; concurrent evidence quota; CV override diikuti source update/delete; ownership dua akun dan PDF multipage. Tambahkan export bersamaan source mutation, consent withdrawal, lease expiration, dan cleanup setelah account deletion karena melintasi beberapa subsistem.

## 7 Cara menjalankan rencana dengan LUNA MAX

Urutan default: T01 → T02 → T03 → T04 → T05 → T06 → T07 → T08 → T09 → T10 → T11 → T12 → T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20 → T21 → T22 → T23 → T24 → T25. Urutan ini memenuhi dependensi dan memprioritaskan manual workflow sebelum AI.

Paket tidak memiliki estimasi hari karena kecepatan implementasi, integrasi dan environment belum diukur. Ukur setelah M1, lalu estimasi sisa berdasarkan pekerjaan nyata. Jangan mengganti acceptance dengan batas waktu atau jumlah file arbitrer.

Gunakan prompt ini untuk memulai pelaksanaan di sesi dengan model LUNA dan reasoning MAX:

```text
Implementasikan WorkPulse MVP v0.1 mulai dari task pertama yang belum DONE
dalam IMPLEMENTATION_PLAN.md. Baca IMPLEMENTATION_STATUS.md jika sudah ada,
instruksi repository yang berlaku, serta bagian dokumen sumber untuk task itu.

Kerjakan satu task ID sampai acceptance-nya terverifikasi. Jika terlalu besar,
pecah menjadi subtask konkret dan selesaikan sesuai dependensi. Ikuti keputusan
scope pada bagian 1; jangan memasukkan fitur roadmap dari Design.md.

Sebelum mengedit, tulis scope singkat, dependency yang sudah terpenuhi, file
yang diperkirakan berubah, dan checks yang akan membuktikan hasil. Terapkan
perubahan terkecil yang lengkap. Jangan menimpa pekerjaan pengguna atau
melakukan refactor di luar kebutuhan task.

Jangan melaporkan mock sebagai integrasi nyata. Jangan menandai DONE bila
acceptance belum diuji. Bila credential atau external service belum tersedia,
selesaikan bagian lokal yang independen, catat keterbatasan dan kebutuhan
konkret, lalu tinggalkan task berstatus PARTIAL atau BLOCKED yang akurat.

Setelah selesai, update IMPLEMENTATION_STATUS.md dengan file berubah,
migration/decision baru, perintah checks dan hasil aktual, acceptance checklist,
risiko terbuka, dan next task. Tutup dengan ringkasan perubahan dan verifikasi.
Jangan deploy production tanpa environment dan otorisasi yang sesuai.
```

Checkpoint harus cukup untuk sesi baru melanjutkan tanpa mengandalkan chat lama. Pada setiap gate M1–M5, baca kembali acceptance requirements terkait dan lakukan integration review sebelum meneruskan milestone berikutnya.

## 8 Prasyarat integrasi dan risiko terbuka

| Kebutuhan | Diperlukan paling lambat | Tindakan jika belum tersedia |
| --- | --- | --- |
| Auth/database/private storage development | T02/T03/T05 | Jalankan stack lokal; catat cara setup. Jangan memakai akun produksi sebagai fixture. |
| Email verification/recovery environment | T03 | Uji dengan local mail sink; staging email nyata tetap acceptance integrasi. |
| Malware scanner dan parser sandbox | T10/T15 | Fake untuk unit tests; ready/production upload diblokir sampai scanner nyata terverifikasi. |
| AI provider credential, model, consent wording | T13/T14 | Tetap jalankan manual workflow dan fake contract tests; jangan mengirim data pengguna tanpa consent. |
| DOCX pagination renderer dan Chromium PDF runtime | T15/T21 | Uji packaging di worker; jangan percaya cached DOCX page metadata atau mengabaikan limit halaman. |
| Worker host, storage retention dan backup policy | T23/T25 | Dokumentasikan pilihan dan bukti konfigurasi; release gate tetap terbuka jika target purge/backup belum terpenuhi. |
| Production domain/hosting/secret provisioning | T25 | Siapkan runbook dan staging evidence; deployment aktual adalah langkah terpisah sesuai otorisasi. |

Risiko utama adalah kehilangan konsistensi antar canonical data, AI revision dan CV snapshot; penambahan fitur dari DESIGN yang melampaui PRD; serta file/jobs yang tetap hidup setelah delete. Karena itu transaksi, test races, retention dan source provenance menjadi acceptance sejak paket terkait dibuat, bukan pekerjaan tambahan setelah UI selesai.
