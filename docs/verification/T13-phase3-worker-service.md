# T13 Fase 3 — Worker dan service

- Tanggal: 27 September 2026.
- Tujuan: worker AI dan gateway service-role, service web (consent dan job) beserta server action consent, integrasi ke `workers/run.ts`, serta integration test terhadap PostgreSQL lokal nyata.

## File berubah

- `workers/ai-worker.ts`: `runAiWorkerOnce`, yang hanya mengembalikan ringkasan berisi angka dan kode.
- `workers/supabase-ai-gateway.ts`: RPC service-role dengan timeout 15 detik. Semua kegagalan dilaporkan dengan pesan tetap.
- `workers/run.ts`: satu pass AI setelah pass evidence. Kegagalan satu pass tidak menghentikan pass lainnya; pada mode `--once`, kegagalan tetap menghasilkan `WORKER_UNAVAILABLE` dan exit 1.
- `workers/bootstrap.ts`: menambah `ai-detect`.
- `src/features/ai/{ai-errors,consent-service,ai-job-service,actions}.ts`.
- `src/i18n/messages.ts`: `error.staleInput`, `error.consentRequired`, `error.aiRetryExhausted`, dan `ai.*` (en/id). Copy UI dipakai di Fase 4.
- `package.json`:
  - Menambah `test:integration:ai`.
  - `worker:run`/`worker:once` kini juga membaca `--env-file-if-exists=.env.ai.local`.
- Test:
  - Unit: `tests/unit/ai-worker.test.ts` (12) dan `tests/unit/ai-job-service.test.ts` (18). `tests/unit/worker-bootstrap.test.ts` diperbarui.
  - Integration: `tests/integration/ai-jobs.test.ts` (12) dan stub HTTP lokal `tests/integration/openai-stub.ts`.

## Temuan saat eksekusi

- **Bug nyata (diperbaiki):** `src/server/ai/*` memakai *parameter properties* TypeScript di constructor. Node 24 yang menjalankan worker dengan type stripping menolak sintaks itu (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), sehingga `worker:run` akan crash. Unit test tidak menangkapnya karena Vitest mentransformasi kode sepenuhnya; skenario 12, yang menjalankan `node workers/run.ts` sungguhan, menangkapnya. Constructor `UnavailableAIProvider`, `OpenAIProvider`, dan `ExplicitTestFakeAIProvider` diubah menjadi field eksplisit.
- Kegagalan awal skenario 13 hanya efek lanjutan dari bug tersebut: job sisa skenario 12 ikut diproses. Assertion diperkuat menjadi total `aiStale` di semua ringkasan ditambah jumlah panggilan provider.
- `.env.local` tidak memuat `SUPABASE_SECRET_KEY`. Seperti pada Gate M2, key diambil dari `supabase status -o env` ke env proses test saja, tanpa dicetak atau disimpan.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm test:integration:ai` | 1, lalu 0 | Run pertama gagal 2/12 karena bug di atas. Setelah perbaikan: 12/12 |
| `pnpm test:integration:activity` | 0 | 6/6 |
| `pnpm test:integration:achievements` | 0 | 5/5 |
| `pnpm test:integration:m2` | 0 | 8/8 |
| `pnpm worker:check` | 0 | `registeredJobs: evidence-scan, evidence-cleanup, ai-detect` |
| `pnpm worker:once` (mode AI default `unavailable`, tanpa `.env.ai.local`) | 0 | Ringkasan berisi field `ai*`, `aiJobsClaimed: 0`. Sebuah cleanup job evidence sisa test sebelumnya ikut selesai |
| `pnpm test` | 0 | 51 file, 268 test |
| `pnpm lint` / `pnpm typecheck` | 0 / 0 | bersih |

## Acceptance terbukti (integration, PostgreSQL nyata)

| Poin §1 | Skenario |
| --- | --- |
| 1 | Skenario 2: 5 request paralel menghasilkan 1 `job_id` dan 1 row. Request ulang setelah selesai mengembalikan job yang sama |
| 2 | Skenario 4: edit saat queued menghasilkan `STALE_INPUT` dan provider dipanggil 0 kali; retry maupun request revisi lama menghasilkan `STALE_INPUT`; request untuk revisi 2 menghasilkan job baru. Skenario 5: edit saat provider berjalan menghasilkan `STALE_INPUT` dengan result NULL |
| 3 | Skenario 13: activity dihapus saat provider berjalan, job ikut ter-cascade, dan complete yang terlambat dihitung stale. Lease expiry dibuktikan pgTAP (Fase 1) |
| 4 | Skenario 8: attempt 1→2→3, lalu `RETRY_EXHAUSTED` |
| 5 | Skenario 1: tanpa consent menghasilkan `CONSENT_REQUIRED` dan 0 job. Skenario 6: withdraw saat queued menghasilkan `CONSENT_REQUIRED` dengan 0 panggilan provider; withdraw saat running menghasilkan `CONSENT_WITHDRAWN` dengan result NULL |
| 6 | Skenario 7: akun deleting menghasilkan `ACCOUNT_DELETING` dengan 0 panggilan provider; request dan retry menghasilkan `UNAUTHENTICATED` |
| 7 | Skenario 8: output malformed menghasilkan `AI_OUTPUT_INVALID`. Skenario 9 (adapter OpenAI asli melawan stub): refusal menghasilkan `AI_REFUSED` |
| 8 | Skenario 12: proses `node workers/run.ts --once` sungguhan, dengan stub yang mengembalikan HTTP 500 berisi sentinel dan key di body. Stdout dan stderr tidak memuat sentinel, key, maupun teks sumber, dan row job juga tidak memuatnya |
| 9 | Skenario 2: provider menerima tepat `{locale, raw_text, role, scope, outcome}`. Skenario 9: body request ke stub memuat `store:false` dan kunci input minimal |
| 10 | Skenario 1: confirm manual berhasil tanpa consent. Regresi `m2` 8/8 |
| 13 | Skenario 11: B tidak dapat select job A. Request atau retry B terhadap job A maupun ID acak menghasilkan `NOT_FOUND` yang sama. Kolom `attempt_token` ditolak untuk owner |
| Provider | Skenario 9: HTTP 429 menghasilkan `AI_RATE_LIMITED`, respons lambat menghasilkan `AI_PROVIDER_TIMEOUT`, dan respons valid menghasilkan `succeeded`. Skenario 10: mode `unavailable` menghasilkan `AI_UNAVAILABLE`, lalu retry menghasilkan `succeeded` pada attempt 2 |

## Langkah berikutnya

Fase 4: UI consent S12.
