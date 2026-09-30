# Gate M3 — laporan integration review (Assisted entry)

- Tanggal: 30 September 2026.
- Branch: `claude/clever-archimedes-gbu7qd`. HEAD yang direview: `42bab36` (T17 DONE). Commit gate: commit laporan ini (test gate + dokumen, tanpa perubahan kode produk).
- Pelaksana dan pemberi keputusan: Claude (Opus), satu sesi tanpa sub-agent, atas permintaan pengguna ("Langsung jalankan Gate Review M3"). Tidak ada handoff plan terpisah; lingkup diambil langsung dari kalimat gate dan acceptance T13–T17.
- Kalimat gate (`IMPLEMENTATION_PLAN.md` §5): *F01 import dan F02 assisted lolos bersama malformed file, retry, consent withdrawal, AI unavailable dan stale-result scenarios.*
- Rujukan: R02, R05, F01, F02, S02, S03, S06, S08, S12; bukti task [T13](T13-ai-jobs-consent.md), [T14](T14-detection-review.md), [T15](T15-import-staging.md), [T16](T16-import-commit.md), [T17](T17-import-review-ui.md); remediasi [M3-review-remediation-plan.md](M3-review-remediation-plan.md).

## Verdict

**Gate M3: PASSED** — ditetapkan Claude pada 30 September 2026 setelah remediasi RV1, untuk acceptance lokal.

Verdict awal pada `42bab36` adalah BELUM LULUS karena satu P2 (RV1): S02 menyatakan teks CV "tidak dikirim" untuk batch `CONSENT_WITHDRAWN`, padahal kode itu hanya muncul setelah teks sudah diterima provider. Atas persetujuan pengguna, RV1 diperbaiki di `1da020a`. Perbaikannya berupa copy en/id sendiri dan pemetaan di `importFailureKey`, tanpa SQL atau migration, dengan test unit yang gagal dulu lalu lulus. Checks §3 rencana remediasi diulang dan semuanya exit 0: lint, typecheck, unit 76/501, build, `test:integration:m3` 7/7, `test:e2e:import` 7/7, `test:e2e:m3` 2/2, `git diff --check 42bab36`.

Kesepuluh kriteria §1 kini PASS dan tidak ada P0–P2 terbuka. Remediasi dikerjakan reviewer sendiri, jadi review ulang tidak sepenuhnya independen. Langkah berikutnya adalah **T18 CV schema dan selection**. Follow-up P3 (N1–N4) tidak memblokir T18.

## 1. Kriteria lulus

| # | Kriteria | Status | Bukti |
| --- | --- | --- | --- |
| 1 | F01 dan F02 berjalan bersama untuk satu pengguna baru | PASS | Integration M3-1 (upload → ClamAV → parser → fake AI → review → commit dengan onboarding → note terhubung experience hasil import → analisis → apply → confirm; dashboard 2 confirmed). E2E M3 journey (browser + proses worker nyata) |
| 2 | Malformed file | PASS | M3-4: DOCX terpotong `CORRUPT_FILE`, teks bukan PDF `UNSUPPORTED_FORMAT`, tanpa batch. E2E M3 test 2 (S02 alert, 0 batch, *Start manually* tetap ada). Output provider rusak di kedua alur → `AI_OUTPUT_INVALID` retriable, 0 item staging, 0 baris canonical, apply ditolak |
| 3 | Retry | PASS | M3-2/3/4: retry batch dan retry job berjalan terpisah (batch `retry_count = 1`, job `attempt_count = 2`) dan keduanya pulih. E2E: S02 *Retry* pada batch yang sama. Batas 3× dari T13/T15 tetap lulus di regresi |
| 4 | Consent withdrawal | PASS (RV1 fixed `1da020a`) | M3-2: withdraw saat import dan analisis antre → 0 panggilan provider, `CONSENT_REQUIRED`, retry/request ditolak, jalur manual tetap berjalan, allow + retry memulihkan keduanya. M3-2b: withdraw saat panggilan provider berjalan → hasil import dan analisis dibuang (`CONSENT_WITHDRAWN`, 0 item, 0 achievement). E2E: withdraw di S12 saat analisis antre → S06 *Analysis did not finish* + alasan consent, Retry nonaktif, entri manual berhasil, note baru `not_requested` tanpa job. **RV1:** copy S02 untuk `CONSENT_WITHDRAWN` salah |
| 5 | AI unavailable | PASS | M3-3 memakai `resolveAIProvider` default tanpa konfigurasi (`AI_UNAVAILABLE`): batch `failed_retriable` dengan `canRetry`, analisis `failed` dengan `canRetry`, 0 baris canonical, confirm manual berhasil, retry eksplisit memulihkan keduanya. E2E: S02 outage → *Start manually* terlihat → *Retry* → review |
| 6 | Stale result | PASS | M3-5a: cancel import dan edit note terjadi di pass worker yang sama → batch `cancelled` tanpa item, job `STALE_INPUT`, S06 `stale`. M3-5b: suggestion yang sudah `succeeded` menjadi basi setelah note dihubungkan ke experience dari import berikutnya → apply `STALE_INPUT`, analisis baru membuat job baru dan apply berhasil dengan konteks experience. M3-5c: commit import dengan revision batch lama → `STALE`, 0 baris. E2E: edit saat antre → pesan stale → *Analyze again* → review → confirm |
| 7 | Tanpa auto-apply/auto-confirm lintas alur | PASS | M3-1: baris achievement import identik sebelum dan sesudah alur assisted (`toEqual`). M3-4: hasil valid setelah retry tidak menambah baris canonical tanpa aksi review. E2E: total confirmed = import 1 + assisted 1 + manual 1 |
| 8 | Minimisasi dan hygiene | PASS | M3-1: input import hanya `{ text }`; input detect tanpa teks CV dan tanpa nama profil. M3-6: summary worker, error dan console bebas sentinel CV/note/nama file. E2E: console browser dan output `drainImportWorker` bebas sentinel (N3 untuk output `drainAiWorker`) |
| 9 | Regresi penuh hijau | PASS dengan flaky bawaan | §4; satu-satunya kegagalan adalah N4 (flaky pra-M3) |
| 10 | Tidak ada P0–P2 terbuka | PASS | RV1 (P2) fixed `1da020a`; verdict awal pada `42bab36` FAIL |

## 2. Matriks acceptance T13–T17 untuk gate

Semua task berstatus DONE (acceptance lokal) dengan bukti di dokumen masing-masing. Gate ini tidak mengulang audit per butir. Gate menambahkan bukti lintas alur di atas dan menjalankan ulang semua suite task tersebut (§4).

| Task | Status gate | Catatan |
| --- | --- | --- |
| T13 AI jobs dan consent | Terbukti | Consent di tiga titik kini juga terbukti untuk job import dan detect yang berjalan bersamaan (M3-2/2b) |
| T14 Detection dan review | Terbukti | Stale lintas alur (M3-5b). Butir "Sebagian" T14 (§1.18 log worker, §1.20) tetap: N3 |
| T15 Import staging | Terbukti, RV1 | RV1 menyangkut butir §1.17 "status jujur" |
| T16 Import commit | Terbukti | Commit basi (M3-5c) dan provenance import tidak disentuh alur assisted (M3-1) |
| T17 Import review UI | Terbukti | E2E M3 memakai S03 end-to-end dari pengguna baru |

## 3. Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | `src/features/import/import-start.tsx:34` memetakan `CONSENT_WITHDRAWN` ke `import.failed.CONSENT_REQUIRED` ("…so the text was not sent"). Padahal `complete_import_ai_job` (`20260930090000_t15_import_staging.sql:1387`) hanya mencatat kode itu setelah provider menerima teks. Unit `import-start-ui.test.tsx:123` mengunci pemetaan tersebut | **Fixed** `1da020a` ([remediasi §2](M3-review-remediation-plan.md)) |
| N1 | P3 | `workers/ai-worker.ts:90` tidak menandai gagal job import dengan teks kosong/terlalu panjang (menunggu lease habis). Tidak terjangkau karena `import-worker.ts:169` sudah menolak lebih dulu | Follow-up |
| N2 | P3 | S06 untuk hasil yang dibuang karena consent hanya menampilkan pesan generik | Follow-up (copy) |
| N3 | P3 | `drainAiWorker` (helper E2E) tidak mengembalikan stdout, sehingga hygiene log E2E alur detect masih bersandar pada integration T13-12 | Follow-up |
| N4 | P3 | Flaky pra-M3 `activity-ui.spec.ts:356` hanya dalam `test:e2e:evidence` (2/2 run gagal di sini; lulus di `test:e2e:activity`). Snapshot menunjukkan `<select>` project kembali ke "All projects" setelah `selectOption`, sehingga URL tanpa `project`. Ini race hydration di sisi test setelah `page.goto`. Sebelumnya tercatat T15 RV5 / T17 N9 | Follow-up (test) |

Tidak ada P0 atau P1.

## 4. Command dan hasil (HEAD `42bab36` + test gate)

Env: `.env.local` dan `SUPABASE_SECRET_KEY` (JWT `SERVICE_ROLE_KEY` lokal) hanya di env proses; `AI_AGENT`/`ANTHROPIC_BASE_URL` harness dikosongkan. Docker: Supabase lokal, ClamAV `workpulse-t10-clamav`, Gotenberg `workpulse-t15-gotenberg`. AI: fake provider eksplisit (test) dan `UnavailableAIProvider` default.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` / `typecheck` | 0 / 0 | bersih |
| `pnpm test` | 0 | 76 file / 500 |
| `pnpm worker:check` | 0 | `ready`, 6 job terdaftar |
| `pnpm db:lint` / `db:test` | 0 / 0 | bersih / 11 file, 779 PASS |
| `pnpm test:integration:m3` (baru) | 0 | 7/7 |
| `test:integration:` import / import-commit / import-review / ai / ai-review | 0 | 21 / 11 / 6 / 13 / 21 |
| `test:integration:` activity / achievements / projects / dashboard / m2 / storage / evidence | 0 | 6 / 5 / 7 / 4 / 8 / 1 / 14 |
| `pnpm build` | 0 | berhasil |
| `pnpm test:e2e:m3` (baru) | 0 | 2/2 (juga lulus di run terpisah sebelumnya) |
| `test:e2e:` import / import-review / ai / ai-review / m2 | 0 | 7 / 10 / 2 / 11 / 1 |
| `test:e2e:` auth / ui / activity / projects / achievements / dashboard | 0 | 1 / 1 / 1 / 1 / 4 / 1 |
| `pnpm test:e2e:evidence` | 1, 1 | 7/8 dua kali; gagal hanya N4 |
| `git diff --check` | 0 | bersih |

## 5. Flaky dan tidak dijalankan

- Flaky: N4 (di atas). Run pertama `test:e2e:m3` gagal karena test memakai `locator.check()` pada checkbox confirm S03, yang baru berubah setelah simpan server. Test diganti ke klik + `toBeChecked` (pola R02). Ini bukan perilaku produk.
- Tidak dijalankan: smoke live `refine` dan `extractImport` ke provider nyata (butuh persetujuan pengguna setiap kali), uji stres race commit berulang, `db:types` (tanpa migration), clean rebuild database, staging/hosted/production.

## 6. Batas

Semua bukti berasal dari Supabase lokal (Docker), Storage lokal, ClamAV dan Gotenberg lokal, proses worker `workers/run.ts --once` dengan fake AI provider eksplisit, dan build lokal. Perilaku model nyata terhadap prompt `refine`/`extractImport` belum terbukti. Keberhasilan lokal bukan bukti kesiapan production.
