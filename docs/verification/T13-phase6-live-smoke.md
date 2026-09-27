# T13 Fase 6 — Smoke live OpenAI-compatible

- Tanggal: 27 September 2026.
- Persetujuan: pengguna menyetujui panggilan live dan menyediakan key di `.env.ai.local` (git-ignored). Pesan pengguna: "Oke run lagi fase 6 nya".

## Percobaan pertama: api.openai.com

Hasilnya gagal, dan penyebabnya ada di konfigurasi, bukan di kode.

- `pnpm test:ai:live` menghasilkan `AI_CONFIG_INVALID` pada ketiga kasus.
- Probe diagnostik hanya mencetak status HTTP serta `error.type` dan `error.code`. Request minimal tanpa skema pun mendapat `401 invalid_api_key`.
- Key berjenis `sk-`, 25 karakter. Pengguna kemudian menjelaskan bahwa key itu milik endpoint OpenAI-compatible lain, bukan OpenAI.
- Sesuai stop condition, tidak ada model atau endpoint lain yang dicoba sebelum pengguna memutuskan.

## Perubahan scope atas instruksi pengguna

Pengguna meminta adapter AI memakai endpoint **OpenAI-compatible** (`https://ai.sumopod.com`) dan memutuskan:

- API style: **Chat Completions**. Responses tetap tersedia lewat env.
- Dukungan `json_schema` di endpoint belum pasti, sehingga mode structured output dibuat bisa dikonfigurasi.
- Copy consent memakai sebutan **generik** ("penyedia AI eksternal") tanpa nama vendor.

Implementasi:

- `src/server/ai/openai-provider.ts`:
  - Opsi `api` bernilai `chat_completions` (default) atau `responses`, dan opsi `structuredOutput` bernilai `json_schema` (default) atau `json_object`.
  - Jalur Chat Completions memakai `POST {base}/chat/completions` dengan pesan system dan user, `response_format` json_schema strict atau json_object, serta `max_completion_tokens`.
  - `store:false` hanya dikirim ke `api.openai.com`, karena endpoint compatible belum tentu menerima field itu. Retensi di pemroses lain mengikuti kebijakannya masing-masing.
  - Parser Chat Completions memetakan `refusal`/`content_filter` ke `AI_REFUSED` dan `finish_reason=length` ke `AI_OUTPUT_INVALID`. Pembungkus fence Markdown ```` ```json ```` diterima di mode JSON.
- `src/server/ai/resolve-provider.ts`:
  - Mode `openai-compatible`, dengan alias `openai`.
  - Env baru `WORKPULSE_AI_API` dan `WORKPULSE_AI_STRUCTURED_OUTPUT`. Nilai yang tidak dikenal membuat provider fail closed dengan `AI_CONFIG_INVALID`.
- `src/i18n/messages.ts`: `ai.consent.dialogIntro` en/id kini generik. Versi consent tetap `ai-processing-v1` karena belum ada rilis atau pengguna nyata; rilis berikutnya yang mengubah copy wajib menaikkan versi.
- Test:
  - `tests/unit/openai-provider.test.ts` (14): chat default, `store` hanya untuk OpenAI resmi, mode JSON dengan skema di prompt, refusal, filter, truncation, dan Responses.
  - `tests/unit/ai-provider-resolve.test.ts` (7).
  - `tests/integration/openai-stub.ts` kini mendukung `/chat/completions`.
  - Skenario 9 integration dijalankan untuk kedua API style.
  - `tests/e2e/ai-consent.spec.ts` memastikan dialog tidak lagi menyebut "OpenAI".
- `.env.example` dan README memuat variabel compatible. Nilai nyata tetap hanya ada di `.env.ai.local`.

## Probe endpoint (read-only, sebelum smoke)

`GET https://ai.sumopod.com/v1/models` dengan key pengguna mengembalikan HTTP 200, 66 model, dan model terkonfigurasi `gpt-6-luna` tersedia. Karena key valid di endpoint ini, 401 sebelumnya terjadi akibat key yang dikirim ke api.openai.com.

## Smoke live

Command yang dijalankan (base URL hanya di-set di env proses; `.env.ai.local` pengguna tidak diubah):

```
WORKPULSE_OPENAI_BASE_URL=https://ai.sumopod.com/v1 WORKPULSE_AI_LIVE=1 pnpm test:ai:live
```

Hasil: exit 0, 3 test lulus dan 1 di-skip. Test yang di-skip adalah varian non-live, sesuai desain.

| Kasus | Status | Model | Latency | Token in/out | Detail |
| --- | --- | --- | --- | --- | --- |
| Adapter, fixture sintetis en | valid (skema dan grounding) | `gpt-6-luna` | 3011 ms | 581 / 368 | potential=true, 2 metric, 0 question |
| Adapter, fixture sintetis id | valid (skema dan grounding) | `gpt-6-luna` | 3101 ms | 585 / 252 | potential=true, 1 metric, 0 question |
| Job end-to-end: `node workers/run.ts --once` | `succeeded`, `analysis_state = done` | — | 3561 ms (proses worker) | — | Result lolos `validateDetectResult`. Stdout/stderr tidak memuat key maupun teks fixture |

Temuan tambahan:

- Mode `json_schema` strict didukung oleh endpoint tersebut untuk `gpt-6-luna`, jadi `json_object` tidak diperlukan.
- Receipt angka tersimpan di `test-results/t13-live-smoke.json` (git-ignored). File itu tidak memuat key, header, prompt, maupun output.
- Pemindaian key tanpa mencetaknya pada 483 file tracked, untracked, dan `test-results` menemukan 0 kecocokan.

## Regresi setelah perubahan

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm test` | 0 | 51 file / 274 test |
| `pnpm typecheck` / `pnpm lint` | 0 / 0 | bersih |
| `pnpm test:integration:ai` | 0 | 13/13 (skenario 9 untuk chat_completions dan responses) |
| `pnpm test:e2e:ai` | 0 | 2/2, dua run |

## Acceptance

§1.11 terbukti untuk endpoint OpenAI-compatible yang dipilih pengguna. Kalimat di handoff dan acceptance yang menyebut "OpenAI" kini dibaca sebagai "OpenAI-compatible"; decision 0019 akan mencatat perubahan ini.
