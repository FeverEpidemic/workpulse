# T23 Gate review (Claude, read-only)

- Tanggal: 10 Oktober 2026
- Reviewer: Claude (Opus)
- HEAD yang direview: `f29e682` (baseline Fase 0 `7e874b6`; kode diuji pelaksana di `56ff182`; 88 file, +6079/−50 baris; dua migration baru `20261009090000`, `20261009100000`)
- Lingkungan: Supabase lokal (migration 33/33), `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf` berjalan; `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` lokal (hanya env proses); `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan; `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` untuk suite yang memakai renderer T21.

## Verdict

**Tidak ada temuan P0–P2. T23 lulus gate review.** Sepuluh temuan P3: dua diperbaiki reviewer (F8 di `7ad7d91`, F10), dua koreksi dokumen dikerjakan saat closeout (F2, F3), sisanya follow-up atau diterima.

Riwayat: verdict pertama (`4facf2c`) hanya mencakup bagian non-UI karena mode antislop belum dipilih dan Gate M4 belum punya verdict tertulis. Pada 10 Oktober 2026 pengguna memilih antislop *during* untuk sesi ini dan menegaskan Gate M4 sudah dikerjakan; reviewer lalu menjalankan tinjauan UI (bagian di bawah), memperbaiki F8 dan F10, dan menutup T23.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| F1 | P3 | Proses: plan §0/§8 melarang mulai sebelum Gate M4 PASSED tanpa izin eksplisit. `M4-gate-review.md` masih DRAFT tanpa verdict (baris 6), dan `IMPLEMENTATION_STATUS.md` belum punya entry Gate M4. Pelaksana menafsirkan "Coba Eksekusi ulang Plan T23" sebagai izin dan mencatatnya terbuka di receipt Fase 0. Pengguna menegaskan (10 Oktober 2026) bahwa Gate M4 sudah dikerjakan. Tidak ada dampak kode (suite `m4` lulus pada HEAD ini). Sisa: verdict reviewer M4 (Fase 7 rencana M4) belum tertulis. | Diterima pengguna; verdict M4 follow-up |
| F2 | P3 | `docs/decisions/0029-t23-account-deletion-retention.md:78` rusak: backtick hilang dan ada karakter CR tunggal, sehingga teks terbaca "...expire_cv_exports hanya ... dan `\r`edact_cv_export_snapshots...". Jejak escape `` `r `` PowerShell. Perbaikan: tulis ulang baris itu dengan tool Edit; cek `[regex]::Matches(text, "\r(?!\n)")` = 0. | Diperbaiki saat closeout |
| F3 | P3 | Runbook `T23-retention-runbook.md:63` menyatakan job `failed` dikembalikan ke antrean "oleh reconcile kategori (evidence, import, export)". `reconcile_orphan_evidence_objects` melewati job yang statusnya bukan `succeeded` (`20260925100000_t10_evidence_backend.sql:1328`), jadi untuk evidence hanya purge yang mengantrekan ulang. Dampak praktis kecil: job cleanup hanya berakhir `failed` untuk `INVALID_OBJECT_KEY` (`workers/evidence-worker.ts:268`, `import-worker.ts:188`, `export-worker.ts:184`), yang tidak terjadi untuk key kanonis; error transien di-retry. Receipt yang tertahan tetap terlihat sebagai overdue. Perbaikan: koreksi kalimat runbook. | Diperbaiki saat closeout |
| F4 | P3 | Test integration guard (`tests/integration/account-deletion.test.ts:186-191`) menerima `ACCOUNT_DELETING` **atau** `AUTH_REQUIRED` untuk semua 16 RPC, sehingga tidak mengunci bahwa RPC tanpa pemeriksaan sendiri ditolak oleh trigger lewat PostgREST. Reviewer membuktikannya terpisah dengan akun sekali pakai: `update_profile` lewat PostgREST setelah `begin_account_deletion` → `42501 ACCOUNT_DELETING` (sebelumnya sukses). Perbaikan: pesan per RPC dipin (`ACCOUNT_DELETING` untuk RPC di daftar "tidak memeriksa" receipt Fase 0). | Follow-up |
| F5 | P3 | Proses: Fase 3 tidak TDD murni (diakui di receipt Fase 3), dan dokumen Fase 9 (decision 0029, runbook, laporan, README) ditulis sebelum gate, padahal plan §5 menempatkannya setelah gate. Isinya sudah saya tinjau; temuan F2 dan F3 berasal dari sana. | Diterima |
| F6 | P3 | Batas yang diterima dan sudah tercatat jujur di decision 0029: objek non-kanonis di prefix menahan receipt di `purged` (terlihat sebagai overdue, butuh tindakan manual); race guard tulis hanya diargumentasikan, tidak diuji paralel; access token yang sudah terbit tetap dapat membaca sampai `exp` (tulisan ditolak); retensi backup ≤ 30 hari belum terverifikasi (T25). | Diterima, follow-up T25 |
| F7 | P3 | `test:integration:cv-export` dan `test:integration:m4` gagal keras bila `WORKPULSE_PDF_GOTENBERG_URL` tidak diset (sesuai desain, tanpa fallback fake). Receipt Fase 8 tidak menyebut env itu; plan §7 menyebutnya. Dengan env diset, keduanya lulus 35/35 dan 17/17. | Ditutup oleh run reviewer |
| F8 | P3 | UI S12: `useActionState` hidup lebih lama dari dialog, jadi error percobaan yang sudah ditutup (mis. *That password is not correct.* dengan `aria-invalid`) tampil lagi saat dialog dibuka ulang dengan field kosong (R-27, C-4). Jawaban pratinjau yang terlambat dari pembukaan sebelumnya juga dapat menimpa hitungan pembukaan baru. Perbaikan reviewer `7ad7d91`: `visibleDeletionState` menyembunyikan error yang correlation ID-nya sudah ditutup, dan nomor permintaan pratinjau mengabaikan jawaban lama. Bukti: unit baru merah lalu hijau; langkah E2E baru gagal pada kartu lama (`toHaveCount(0)` menerima 1) dan lulus sesudahnya (suite 7/7). | Diperbaiki |
| F9 | P3 | Hermetisitas: `test:e2e:account-deletion` melakukan banyak sign-in dan percobaan password salah. Saat dijalankan berulang tanpa jeda, suite dapat gagal karena rate limit Auth lokal (`supabase/config.toml:212`, `sign_in_sign_ups = 30` per 5 menit per IP). Satu run reviewer gagal dengan cara ini; setelah jeda 5 menit suite lulus. Perbaikan yang mungkin: jeda atau akun bersama antar test, atau batas rate limit khusus test. | Follow-up |
| F10 | P3 | Copy: `account.delete.confirmHelp` berbunyi *Type {email} exactly to confirm* (id: *persis seperti itu*), padahal pencocokan mengabaikan huruf besar dan spasi (`confirmationMatches`). Diubah reviewer menjadi *Type {email} to confirm.* / *Ketik {email} untuk konfirmasi.* | Diperbaiki |

Catatan non-temuan: log server `[WebServer] The destination stream closed early` muncul juga di suite yang tidak disentuh T23 (`auth`, `m2`), sama seperti catatan gate T20.

## Penyimpangan pelaksana yang saya putuskan

| Penyimpangan | Keputusan | Alasan |
| --- | --- | --- |
| Guard aktif hanya bila `auth.uid()` terisi **dan** `current_setting('role') = 'authenticated'` (`20261009090000_t23_account_deletion.sql:25`), bukan sekadar `auth.uid()` terisi | **Diterima** | Pengecualian tetap hanya untuk sesi non-pengguna (owner DB, `service_role`); PostgREST menjalankan request pengguna sebagai `authenticated`, dan probe reviewer lewat PostgREST menghasilkan `ACCOUNT_DELETING`. Suite lama tidak diubah. Tidak ada jalur pengguna ke role lain. |
| Purge juga menghapus `internal.evidence_scan_jobs`, `internal.evidence_reservation_requests`, `internal.import_jobs` | **Diterima** | Katalog reviewer: tabel ber-`user_id` di skema non-sistem adalah 17 `public` + 6 `internal`; purge menghapus semua kecuali `storage_jobs` dan `account_deletions` (sengaja bertahan) dan `import_items` (cascade dari batch). Tanpa ini baris tanpa FK akan tertinggal. |
| `user_banned` dipetakan ke `auth.invalidCredentials` (`src/server/auth/errors.ts:31`) | **Diterima** | Probe Fase 0: Auth memeriksa ban sebelum password, jadi pesan khusus akan membuka enumerasi. Sesuai §2.2.8. |
| `.ui-dialog { margin: auto }` di CSS bersama | **Diterima** | Cacat lama `Dialog`; suite E2E lain yang memakai dialog lulus di Fase 8. Penilaian visual masuk tinjauan UI yang tertunda. |
| Migration T23 direvisi di DB lokal sebelum commit pertama | **Diterima** | `supabase db diff --local --schema public,internal` → "No schema changes found"; hash `prosrc` lima fungsi kunci (guard, begin, purge, `guard_cv_export_row`, `retry_cv_export`) identik dengan teks file. |

## Checklist §9 handoff

| Butir | Hasil | Bukti |
| --- | --- | --- |
| User dan email dari session; password tidak dicatat | PASS | `deletion-service.ts:63-69` (`getUser`), `:89-92` (email sesi ke `verifyPassword`); input Zod strict tanpa email (`domain/account/deletion.ts:13-16`); `AccountDeletionError` tanpa teks pengguna (`deletion-service.ts:37-43`) |
| Client sekali pakai tanpa cookie | PASS | `reauthenticate.ts:11-17` (`persistSession: false`, publishable key, client baru tiap panggilan), user id dibandingkan `:36`, sesi sekali pakai dicabut `:41-42`; probe Fase 0: sesi browser tidak berubah |
| RPC begin tidak dapat dipanggil `authenticated` | PASS | revoke/grant `migration:526-537`; pgTAP; integration B → A ditolak 42501 |
| Urutan action §2.2.4 dan titik commit | PASS | verify → begin → ban → global sign-out → local sign-out (`deletion-service.ts:92-117`); kegagalan sebelum begin melempar tanpa efek; sesudahnya `revokeDeferred`; action menghapus cookie lalu redirect (`actions.ts:68-70`) |
| Ban + global sign-out; sign-in ulang ditolak; tanpa enumerasi | PASS | integration sesi (refresh token ditolak, sign-in `user_banned`); E2E dua konteks dan sign-in ulang |
| `getRequestContext` tanpa loop redirect | PASS | `context.ts:36-38` mengembalikan `user: null, accountDeleting: true`; sign-in page memakai notice (`sign-in/page.tsx:35`); unit `request-context-deleting` |
| Sisa risiko access token dicatat jujur | PASS | decision 0029 *Sisa risiko*; integration: tulisan dengan token lama ditolak 42501 |
| Guard: katalog lengkap, pengecualian, race | PASS (F4, F6) | 18 trigger `zz_guard_account_writable` = 17 tabel `public` ber-`user_id` + `profiles`; satu-satunya tabel `public` tanpa `user_id` adalah `profiles`; probe PostgREST reviewer; race diargumentasikan |
| Spot-check jalur tulis di luar daftar test | PASS | semua RPC tulis pengguna menulis tabel ber-trigger; dua RPC service-role yang dipanggil dari `src/` (`begin_account_deletion`, `finalize_import_upload`) masing-masing gerbang penghapusan dan memeriksa `deleting_at` (matriks Fase 0) |
| Purge: enqueue sebelum DELETE dalam satu transaksi; prefix catch-all; urutan; tombstone; idempotensi; CAS/lease | PASS | `migration:315-347` (key dari baris + objek kanonis `storage.objects`) sebelum DELETE pertama `:350`; job `failed` diantrekan ulang `:336-345`; profil tidak dihapus; lease/token diverifikasi `:294-303`; pgTAP rollback; integration crash tiga titik |
| Receipt tanpa PII; antrean tanpa FK | PASS | kolom `migration:91-122` hanya UUID, timestamp, status, kode allowlist (CHECK `:109-110`); tanpa FK; RLS + revoke |
| `completed` hanya setelah prefix kosong; backlog; prune 30 hari | PASS (F3) | `verify_account_purges` `migration:441-481`; backlog `:510-522`; prune `:483-508`; pgTAP + integration |
| Runbook tidak mengklaim backup terbukti | PASS | runbook §1 dan §3: *Belum terverifikasi* |
| Pembatalan review memakai transisi cancel yang sama | PASS | `20261009100000_t23_retention.sql:42-50` identik dengan `cancel_import_batch` (`t15:891-899`), plus syarat `status = 'review'` |
| Redaksi snapshot tidak membuka mutasi lain | PASS | `guard_cv_export_row` `retention:83-89` hanya mengizinkan `snapshot → '{}'` bersama `snapshot_purged_at` NULL → nilai; kolom immutable lain tetap; CHECK `:61-63`; pgTAP lima kasus negatif |
| Guard retry di database | PASS | `retention:201-208` (snapshot kosong, revision beda, blocker setelah lock sumber); selebihnya identik dengan T21 `:374-415` |
| Suite T21/T22 tetap bermakna | PASS | `cv_export.test.sql` lama tanpa perubahan; perubahan unit `cv-export-view` sesuai §2.4.7; E2E `cv-export` lulus tanpa diubah |
| UI: satu aksi utama, danger hanya di dialog, fokus, Axe, 360/1440 light/dark, copy backup | PASS (F8, F10 diperbaiki) | E2E `account-deletion` 7/7 diulang reviewer (Axe, overflow, fokus); tinjauan antislop di bawah; copy 30 hari sebagai kebijakan yang disetujui pemilik |
| Hanya file §4, tanpa dependency baru, tanpa `console.` | PASS | `package.json` hanya dua script; file di luar §4 tercatat di receipt Fase 8 dan wajar; grep `console.` = 0; `CI01-implementation-plan.md` di diff adalah commit pengguna, bukan T23 |
| Angka receipt cocok | PASS | lihat tabel di bawah |

## Tinjauan UI antislop (mode *during*, session override)

Cakupan: kartu *Privacy and account* dan dialog hapus akun di S12, notice sign-in, notice pembatalan otomatis S03, copy baru en/id, dan komentar kode di diff T23. Skill yang dibaca: core, ui, copywriting, human, layoutmobile, code.

Design Read: dialog pengaturan S12 untuk pengguna yang mengelola workspace kariernya sendiri, mengikuti bahasa visual `Design.md` yang sudah ada, dial ENERGY 1 / RHYTHM 1 / MOTION 1 (sama dengan receipt Fase 5).

Alasan keputusan (R-31), dicek terhadap kode:

- Tombol pemicu sekunder, danger hanya pada *Delete account permanently* di dalam dialog: aksi destruktif tidak menyerupai aksi utama halaman (`Design.md` dialog destruktif).
- Hitungan dari `get_account_deletion_preview`, bukan angka statis; gagal memuat menampilkan teks jujur, bukan nol palsu (R-17, R-38).
- Konfirmasi dengan email akun, bukan frasa per locale: nama record netral bahasa (§2.4.2).
- Tanpa ikon, badge, atau animasi baru: layar pengaturan dengan dial 1/1/1.

Delivery Gate:

| Item | Status | Bukti |
| --- | --- | --- |
| R-02 em dash | PASS | `account-deletion-i18n.test.ts` memeriksa semua kunci baru en dan id; copy F10 tanpa dash |
| R-03 mobile | PASS | E2E nol overflow halaman dan dialog di 360 px; dua kolom hitungan baru mulai 480 px; tombol memakai `--touch-target-min` |
| R-17, R-38 angka dan konten | PASS | hitungan dari database; fixture screenshot hanya akun `@workpulse.test` |
| R-18, R-23, R-24, R-28 | n/a | tidak ada testimonial, aset baru, navigasi baru, atau FAQ |
| R-25 kontras | PASS | Axe nol pelanggaran WCAG A/AA di light dan dark, 360 dan 1440 (diulang reviewer) |
| R-26 kontrol berfungsi | PASS | pemicu membuka dialog, Cancel dan Escape menutup, submit mengirim, tautan *Sign in* hanya untuk `UNAUTHENTICATED` |
| R-27 state | PASS setelah F8 | loading (`role=status`), pratinjau gagal, error per field dan blok; error yang ditutup tidak muncul lagi |
| R-32 keyboard | PASS | E2E alur utama lewat keyboard, fokus masuk ke password dan kembali ke pemicu |
| R-33 | PASS | tidak ada skrip patch; CSS di `globals.css` |
| R-34 tema | PASS | screenshot dan Axe light/dark |
| R-35 dijalankan dan diklik | PASS | `test:e2e:account-deletion` 7/7 pada `7ad7d91`: Delete account (Enter) → dialog dan fokus password; password salah → pesan di field, password kosong, email tetap; email salah → tombol nonaktif; email benar → `/sign-in?notice=accountDeleted`; Escape/Cancel → tutup dan fokus kembali; buka ulang → email dan error lama kosong; S03 notice tampil. F10 hanya mengubah teks bantuan yang tidak di-assert E2E (unit i18n 12/12, typecheck lulus) |
| R-36 klaim | PASS, override pemilik | *Backup copies ... deleted within 30 days* adalah kebijakan yang disetujui pengguna (§2.4.4, 8 Oktober 2026) dan mengikat T25; runbook menandainya *belum terverifikasi* |
| R-37 arah desain | PASS | `Design.md` ada; Design Read dicatat di atas |
| Purpose-Gate R-01, R-04, R-06, R-07, R-08, R-09, R-10, R-12, R-13, R-14, R-19, R-22 | PASS | tidak ada gradien, glow, ikon, badge, pola latar, atau animasi baru; shadow hanya milik `Dialog` bersama |
| Liveliness | PASS | dial 1/1/1 dinyatakan dan konsisten; fokus utama tombol danger di dialog; satu aksen merah hanya di titik keputusan |
| C-1 sampai C-5, R-05, R-11, R-15, R-16, R-20, R-21, R-29, R-30 | PASS | CTA spesifik (*Delete account permanently*), tanpa buzzword, palet token yang ada |
| Komentar kode (antislop-code) | PASS | komentar baru menjelaskan alasan atau batasan; pemisah `-- N. Bagian ---` di migration mengikuti konvensi T21 yang ada |

Catatan visual yang tidak diubah (dari receipt Fase 7, dikonfirmasi pada screenshot): di 360 px setelah error, tombol danger berada di bawah lipatan dialog dan dapat dicapai dengan gulir atau Tab; email panjang terpotong secara visual di field 1440 px, sedangkan teks bantuan memuat email lengkap.

## Command yang saya jalankan ulang

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` / `typecheck` / `worker:check` / `db:lint` | 0 | bersih |
| `pnpm test` | 0 | 113 file / 1034 test (= receipt) |
| `pnpm db:test` | 0 | 17 file / 1439 assertion, PASS (= receipt) |
| `pnpm build` | 0 | `/settings/profile` dinamis |
| `pnpm db:types` | 0 | tanpa diff terhadap `database.types.ts` |
| `supabase migration list --local` | 0 | 33/33, terakhir `20261009100000` |
| `supabase db diff --local --schema public,internal` | 0 | "No schema changes found" |
| `git diff --check 7e874b6..HEAD` | 0 | bersih |
| `test:integration:account-deletion` | 0 | 2 file / 14 (= receipt) |
| `test:integration:cv-export` | 0 | 35 (run pertama tanpa `WORKPULSE_PDF_GOTENBERG_URL` gagal karena env, F7) |
| `test:integration:import` / `import-review` / `evidence` / `storage` / `m4` | 0 | 21 / 6 / 14 / 1 / 17 |
| `test:e2e:account-deletion` | 0 | 7 passed |
| `test:e2e:cv-export` | 0 | 12 passed |
| `test:e2e:auth` / `m2` | 0 | 1 passed / lulus (exit 0) |
| Probe guard PostgREST (skrip scratch, akun sekali pakai, dibersihkan) | — | `update_profile` sukses sebelum, `42501 ACCOUNT_DELETING` sesudah `begin_account_deletion` |
| F8: `vitest run tests/unit/delete-account-state.test.ts` sebelum implementasi | 1 | `visibleDeletionState is not a function` (merah) |
| F8: langkah E2E baru dengan kartu lama (stash sementara) | 1 | `toHaveCount(0)` menerima 1 (merah) |
| `pnpm test` / `lint` / `typecheck` setelah `7ad7d91` | 0 | 113 / 1035 |
| `test:e2e:account-deletion` setelah `7ad7d91` (jeda 5 menit, F9) | 0 | 7 passed |
| Unit `account-deletion-i18n` + `delete-account-state` setelah F10 | 0 | 12 passed |

Tidak dijalankan ulang oleh reviewer: suite integration/E2E domain lain di §7 (`cv-freshness`, `cv-builder`, `achievements`, `projects`, `activity`, `dashboard`, `import-commit`, `ai`, `ai-review`, `m2`/`m3` integration, `e2e:ui`, `activity`, `import`, `import-review`, `ai`, `evidence`, `m3`, `m4`). Receipt Fase 8 mencatat semuanya exit 0 pada `56ff182`; kode tidak berubah sejak itu (commit setelahnya hanya dokumen).

Setelah run: nol receipt penghapusan, nol storage job terbuka, nol user probe tersisa. Screenshot T22/T23 yang ditimpa E2E dikembalikan ke versi ter-commit.

## Batas

Semua bukti di atas berasal dari stack lokal. Purge ≤ 24 jam dan retensi backup ≤ 30 hari pada layanan hosted belum terbukti (T25).
