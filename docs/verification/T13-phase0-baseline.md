# T13 Fase 0 — Baseline dan verifikasi provider

- Tanggal: 27 September 2026
- Pelaksana: Claude (atas permintaan pengguna, sesi tunggal, tanpa sub-agent). Handoff: [T13-implementation-plan.md](T13-implementation-plan.md).
- Branch: `claude/clever-archimedes-gbu7qd`. HEAD awal `e5d59d3`, yaitu merge PR #2. Commit rencana `f3c7b28` dibuat agar diff T13 terpisah.

## Tujuan

Fase ini memastikan baseline hijau, parity migration 21/21, dan asumsi source SQL benar. Fase ini juga memilih model OpenAI dari dokumentasi resmi tanpa memanggil API.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `git status --short --branch` | 0 | Hanya `.claude/` dan dua file dokumen rencana. Dokumen rencana di-commit sebagai `f3c7b28` |
| `pnpm install --frozen-lockfile` | 0 | Already up to date |
| `pnpm exec supabase migration list --local` | 0 | 21/21, terakhir `20260927090000` |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 44 file, 203 test |
| `pnpm db:test` | 0 | 7 file, 386 assertion |

## Asumsi yang diverifikasi (file:baris)

- `internal.set_ai_consent(uuid,int,boolean,text)` ada di `supabase/migrations/20260916120000_secure_foundation_mutations.sql:463-498`.
  - Fungsi ini memanggil `lock_profile_revision` (21-57) yang me-raise `STALE_REVISION`.
  - Grant hanya ke `service_role` (569-575).
  - `supabase/config.toml` hanya meng-expose schema `public`, sehingga wrapper public diperlukan.
- Trigger `internal.guard_activity_row` ada di `20260917160000_t06_activity_persistence.sql:175-200` dan tidak pernah didefinisikan ulang setelah T06.
  - Revisi naik bila tuple `(raw_text, occurred_on, role, scope, outcome, experience_id, project_id)` berubah.
  - `analysis_state` tidak termasuk tuple itu. Dengan demikian job dapat menulisnya tanpa membuat input menjadi stale.
- Check `analysis_state in ('not_requested','queued','running','done','failed')` ada di t06:118-120.
- `internal.touch_mutable_row` (`20260916090000_foundation_schema.sql:150-170`) selalu menaikkan revisi. Trigger ini tidak dipakai untuk `ai_jobs` (lihat Fase 1).
- Pola job diambil dari `claim_evidence_scan_jobs`/`complete_evidence_scan_job` (`20260925100000_t10_evidence_backend.sql:945-1065`).
  - Claim memakai `for update skip locked`.
  - Complete mengambil lock profile → parent → job, lalu guard `status='running' and attempt_token = p and lease_expires_at > clock_timestamp()`.
  - Grant dicabut dari semua role lalu diberikan ke `service_role` (1349-1379).
- `.gitignore:19-21` sudah berisi `.env`, `.env.*`, `!.env.example`, sehingga `.env.ai.local` tidak ter-commit tanpa perubahan `.gitignore`.
- `tests/e2e/m2-manual-journey.spec.ts:147` menolak env proses yang cocok dengan pola `AI|OPENAI|ANTHROPIC|GEMINI|LLM`. Karena itu variabel AI hanya boleh ada di proses worker.

## Provider dan model (dokumentasi resmi, diakses 27 September 2026)

| Sumber | Temuan |
| --- | --- |
| https://developers.openai.com/api/docs/guides/structured-outputs | Responses API: `text: { format: { type: "json_schema", name, strict: true, schema } }`. Root harus object, semua properti masuk `required`, `additionalProperties: false`, dan nullable ditulis lewat array type. Refusal muncul sebagai content `type: "refusal"`. Incomplete ditandai `status: "incomplete"` dengan `incomplete_details.reason` (`max_output_tokens`/`content_filter`) |
| https://developers.openai.com/api/docs/models | Model rekomendasi: `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`. Luna adalah *most efficient model for focused, high-volume tasks* |
| https://developers.openai.com/api/docs/models/gpt-6-luna | ID `gpt-6-luna`, default snapshot `gpt-6-luna`. Harga $0.1 input / $0.5 output per 1M token. Model reasoning dengan `reasoning.effort` `none`–`max`. Endpoint `v1/responses`. Structured Outputs didukung. Tier 1: 500 RPM |
| https://developers.openai.com/api/reference/resources/responses/methods/create | `text.format` json_schema: `name`, `schema`, `strict`, `description`. Status response `completed`/`incomplete`/`in_progress`. Content `output_text.text` dan `refusal.refusal`. Usage berupa `input_tokens` dan `output_tokens` |

Keputusan: pakai **`gpt-6-luna`** dengan `reasoning.effort = "low"`. Model ini paling efisien untuk ekstraksi terstruktur yang pendek dan bervolume tinggi, sementara effort low menjaga latency jauh di bawah timeout 90 detik. Model tetap wajib diisi lewat `WORKPULSE_AI_MODEL` karena tidak ada default di kode. Dokumentasi tidak menyebut snapshot ber-tanggal, jadi snapshot yang dipakai adalah `gpt-6-luna` sesuai default resmi. Karena output dapat berisi item `reasoning` sebelum `message`, parser mencari item `type: "message"`. Nilai default `store` tidak tercantum pada kutipan dokumentasi, sehingga `store: false` selalu dikirim secara eksplisit.

## Acceptance terbukti

Belum ada acceptance produk yang terbukti di fase ini, karena fase ini hanya baseline.

## Blocker dan langkah berikutnya

- Pengguna perlu menyediakan `WORKPULSE_OPENAI_API_KEY` di `.env.ai.local` sebelum Fase 6. Key tidak boleh ditempel di chat.
- Langkah berikutnya: Fase 1, yaitu migration dan pgTAP.
