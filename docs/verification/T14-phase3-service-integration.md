# T14 Fase 3 — Service, route, dan integration nyata

- Tanggal: 28 September 2026
- Pelaksana: Claude. Handoff: [T14-implementation-plan.md](T14-implementation-plan.md). Sebelumnya: [Fase 0](T14-phase0-baseline.md), [Fase 1](T14-phase1-database.md), [Fase 2](T14-phase2-domain.md).

## Tujuan

`ai-review-service.ts` (answer/skip/dismiss/apply/getAnalysisView), route GET status owner-scoped,
server actions baru, dan integration test nyata terhadap Supabase lokal (worker asli + fake
provider) sesuai §3.2/§3.4 dan checklist Fase 3 rencana. Fase ini juga memperbaiki regresi
`test:integration:ai` yang dicatat sebagai diharapkan di Fase 1.

## Perbaikan regresi Fase 1 (`kind` pada `retry_ai_job`)

Fase 1 hanya mengubah return type `request_ai_analysis` (menambah `kind`). Saat `ai-job-service.ts`
diperbarui di fase ini agar `receiptSchema` (dipakai bersama oleh `requestAnalysis` **dan**
`retryJob`) mewajibkan kolom `kind`, `retry_ai_job` — yang tidak diubah di Fase 1 — mulai gagal
divalidasi. Diperbaiki dengan memperluas migration `20260929090000_t14_ai_review.sql` yang sama
(masih lokal, belum di branch bersama manapun) menambah `drop function` + `create function` untuk
`retry_ai_job` dengan kolom `kind`, badan fungsi identik T13. Karena migration ini sudah tercatat
"applied" di riwayat CLI, delta diterapkan langsung ke database lokal aktif lewat `docker exec ...
psql` (tanpa `db reset`, forward-only tetap terjaga — file migration dan state database sinkron).
Lihat commit `fix(t14): carry kind through ai_jobs receipts` untuk detail dan alasan tidak memakai
`db reset`.

## TDD dan debugging signifikan

1. **`ai-review-service.ts`**: `answersSchema` awalnya dicoba dengan `z.record(z.enum([...]),
   ...)` — di Zod 4 ini mewajibkan SEMUA kunci enum hadir (bukan partial map), sehingga input sah
   `{ outcome: "..." }` gagal validasi. Diperbaiki memakai `z.object({...}).strict()` dengan field
   opsional. Ditemukan lewat 8 test unit gagal dengan kode `VALIDATION` yang seharusnya sukses.
2. **Integration test — kaskade kegagalan konsent.** Draft pertama skenario 3 gagal karena
   `saveAchievement`'s `changes` (Zod `achievementChangesSchema`, `.strict()`, field `nullableText`
   menerima **string** bukan `null` literal — `""` yang ditransformasi jadi null, bukan `null`
   mentah) dikirim dengan bentuk salah (snake_case, field hilang, `null` literal). Karena test
   melempar sebelum baris `setConsent(ownerA, true)` di akhir, consent tetap OFF untuk 17 test
   berikutnya, membuat SEMUANYA gagal dengan `CONSENT_REQUIRED` — satu bug lokal menyamar sebagai
   kegagalan luas. Diperbaiki dengan helper `confirmChanges()` (membangun payload lengkap
   camelCase dari row Achievement) dan `try/finally` agar consent selalu direset.
3. **`admin` (service_role) tidak boleh SELECT `achievements`/`chat_messages`.** T09/T06 hanya
   memberi grant select ke `authenticated` (bukan `service_role`) untuk kedua tabel ini — berbeda
   dari `ai_jobs` yang memang diberi select ke `service_role`. Query pemeriksaan test yang memakai
   client admin gagal (count `null`, bukan exception yang tertangkap eksplisit). Diperbaiki
   memakai client pemilik (`ownerA.client`) untuk semua pembacaan `achievements`/`chat_messages`
   di test.
4. **Ekspektasi konkurensi yang salah, dua kali.** (a) "edit while queued lalu apply" pada job yang
   sudah `failed` mengharapkan `STALE_INPUT`, padahal `apply_ai_suggestion` memeriksa
   `status = 'succeeded'` **sebelum** memeriksa revisi — job gagal (bukan sukses-lalu-stale)
   sehingga hasilnya `AI_JOB_UNAVAILABLE` → `NOT_FOUND`. Ditambahkan skenario terpisah yang benar
   (sukses dulu, baru diedit) untuk membuktikan `STALE_INPUT` yang sesungguhnya. (b) Retry paralel
   ×3 diharapkan ketiganya sukses; senyatanya `retry_ai_job` mengunci baris job, hanya satu yang
   menang saat `status='failed'`, dua lainnya melihat `status='queued'` dan ditolak
   `AI_JOB_NOT_RETRYABLE` — diperbaiki jadi `toHaveLength(1)` plus assert jumlah job tetap 1 dan
   `attempt_count` tidak naik dua kali (retry tidak menaikkan attempt_count, hanya claim yang
   menaikkan).

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm exec vitest run tests/unit/ai-review-service.test.ts` | 0 | 25 test |
| `pnpm exec vitest run tests/unit/ai-analysis-route.test.ts` | 0 | 5 test |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **56 file / 338 test** |
| `pnpm test:integration:ai-review` (baru) | 0 | **20/20** — semua skenario §1 Fase 3 rencana |
| `pnpm test:integration:ai` | 0 | 13/13 — regresi Fase 1 **sudah tidak ada** |
| `pnpm test:integration:activity` | 0 | 6/6 |
| `pnpm test:integration:achievements` | 0 | 5/5 |
| `pnpm test:integration:m2` | 0 | 8/8 |
| `pnpm worker:check` | 0 | `{"status":"ready", ..., "registeredJobs":["evidence-scan","evidence-cleanup","ai-detect"]}` |
| `pnpm worker:once` (mode default `unavailable`, tanpa `.env.ai.local` di proses ini) | 1 | `WORKER_UNAVAILABLE` — **hasil yang diharapkan**: tanpa provider terkonfigurasi, worker gagal aman, bukan bug |
| `pnpm build` | 0 | Sukses; route baru `/api/ai/activities/[id]/analysis` (`ƒ`, dynamic) terdaftar |
| `git diff --check` | 0 | bersih |

`pnpm db:test`/`db:lint`/migration list tidak diulang penuh di fase ini (hanya berubah lewat delta
`retry_ai_job` di atas, sudah diverifikasi 540/540 pgTAP tetap PASS pada commit sebelumnya setelah
delta diterapkan). Kegagalan `evidence.test.sql` test 22 yang dicatat sebelum fase ini **tidak
berkaitan dengan T14** (lihat catatan Fase 1 dan task investigasi terpisah yang sudah dibuat);
tidak diulang di sini karena di luar lingkup perubahan fase ini.

## Perubahan

- `src/features/ai/ai-job-service.ts`: `AiJobReceipt`/`AiJobView` menambah `kind`; `JOB_COLUMNS`
  dan skema Zod diperluas.
- `src/features/ai/ai-review-service.ts` (baru): `answerQuestions`, `skipQuestions`,
  `dismissSuggestion`, `applySuggestion`, `getAnalysisView`. `getAnalysisView` menggabungkan
  activity/profile/job/review/achievement lewat query paralel, **selalu memvalidasi ulang**
  `result` tersimpan lewat `validateDetectResult` (bukan mempercayai isi kolom `result` mentah —
  §2.2.9), dan menghitung `appliedRevision` Achievement lewat query terpisah ke
  `ai_suggestion_reviews` (`applied_achievement_id = achievement.id`, revisi terbaru), bukan dari
  review job yang sedang dilihat (lihat Fase 2 §"Keputusan implementasi" untuk alasan pemisahan
  ini). `raw_text` dipakai hanya secara internal untuk grounding, tidak pernah dikembalikan.
- `src/features/ai/ai-errors.ts`: 7 `AiServiceErrorCode` baru (`AI_JOB_NOT_APPLICABLE`,
  `AI_SUGGESTION_DISMISSED`, `AI_SUGGESTION_APPLIED`, `AI_QUESTIONS_CLOSED`, `DRAFT_EDITED`,
  `ACHIEVEMENT_CONFIRMED`, `ACHIEVEMENT_DISMISSED`) plus `ACHIEVEMENT_EXISTS`/`INVALID_AI_ANSWER`
  dipetakan ke `CONFLICT`/`VALIDATION`; `mapAiDatabaseError` diperluas.
- `src/features/ai/actions.ts`: `requestAnalysisAction`, `retryAnalysisAction`,
  `answerQuestionsAction`, `skipQuestionsAction`, `dismissSuggestionAction`,
  `applySuggestionAction` — pola sama dengan `setAiConsentAction`, `revalidatePath` untuk
  `/activity/[id]`, `/achievements`, `/achievements/[id]`.
- `src/app/api/ai/activities/[id]/analysis/route.ts` (baru): `GET` owner-scoped,
  `dynamic = "force-dynamic"`, `Cache-Control: no-store`, error generik (401/404/503/409) tanpa
  membocorkan `raw_text` atau data akun lain.
- `src/i18n/messages.ts`: 13 kunci baru (7 `error.*` untuk kode review baru, 6 `ai.analysis.*`/`ai.review.*`
  untuk pesan sukses aksi) en/id.
- `package.json`: script `test:integration:ai-review` baru.
- `tests/integration/ai-review.test.ts` (baru, 20 test): mencakup seluruh 13 skenario §Fase 3
  rencana (alur utama, no-auto-apply, consent, outage, 4 varian AI_OUTPUT_INVALID, stale saat
  queued/running/setelah sukses, retry exhaustion + paralel, request paralel ×5 + refine berbagi
  slot, answer note+chat+replay ×3+payload lima kunci, dismiss suppression, proteksi
  confirmed/edited/untouched draft + apply paralel ×3, nonpotential, isolasi dua akun, log
  hygiene).

## Acceptance yang terbukti di fase ini

Melengkapi bukti Fase 1 dengan jalur layanan+worker+DB nyata: §1 butir 1, 3, 4, 6, 7, 11, 13, 14,
15, 17, 18 (sebagian; grep sentinel penuh menyusul E2E) sekarang punya bukti integration, bukan
hanya pgTAP. Butir UI (16, 19) dan browser (semua yang menyebut S06/S08 nyata) menunggu Fase 4-5.

## Blocker dan langkah berikutnya

Tidak ada blocker T14. Follow-up di luar lingkup: investigasi `evidence.test.sql` (task terpisah
sudah dibuat, lihat Fase 1). Langkah berikutnya: Fase 4 — UI panel S06 (`activity-analysis-panel.tsx`)
dan aside S08 (`ai-suggestion-aside.tsx`), dipasang di halaman activity/achievement detail, dengan
unit render test mengikuti pola `evidence-attachments-ui.test.tsx`.
