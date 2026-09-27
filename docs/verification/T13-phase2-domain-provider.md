# T13 Fase 2 — Domain dan provider

- Tanggal: 27 September 2026.
- Tujuan fase ini: kontrak AI, skema hasil `detect.v1` beserta grounding, minimisasi input, adapter OpenAI (via `fetch`), fake deterministic, dan resolver mode.

## File berubah

- `src/domain/ai/contracts.ts`: versi consent, batas attempt, lease, timeout, dan error code.
- `src/domain/ai/minimize.ts`: `buildDetectInput`, dengan kunci tetap `locale`, `raw_text`, `role`, `scope`, `outcome`.
- `src/domain/ai/detect-result.ts`: skema Zod strict, JSON Schema strict, dan `validateDetectResult` (skema plus grounding metric).
- `src/server/ai/provider.ts`: interface `AIProvider` dan `UnavailableAIProvider`. File terpisah `unavailable-provider.ts` di handoff digabung ke sini karena isinya hanya satu kelas kecil.
- `src/server/ai/openai-provider.ts`, `fake-provider.ts`, `resolve-provider.ts`, `detect-prompt.ts` (`detect.prompt.v1`).
- Test: `tests/unit/{ai-contracts,detect-result,ai-minimize,openai-provider,ai-provider-resolve}.test.ts`.

## Keputusan pelaksanaan

- Modul di `src/domain/ai` dan `src/server/ai` memakai import relatif `.ts`, tanpa alias `@/` dan tanpa `server-only`. Alasannya, worker Node mengimpornya langsung, sama seperti `src/server/storage/malware-scanner.ts`. Modul tersebut juga tidak mengimpor Next.js maupun database types.
- Batas `DETECT_LIMITS` tidak melebihi `ACHIEVEMENT_FIELD_LIMITS` (dibuktikan unit test). Dengan begitu, draft hasil review T14 selalu muat di kolom Achievement.
- Metric memakai bentuk `{label, value:number, unit, baseline:number|null}`, sesuai metric Achievement T09. Grounding mensyaratkan `value` dan `baseline` muncul sebagai angka di `raw_text`, `role`, `scope`, atau `outcome`. Pemisah ribuan dan desimal Indonesia (`1.500`, `98,5`) didukung.
- Aturan lintas field hanya diperiksa oleh Zod karena JSON Schema strict tidak dapat mengungkapkannya:
  - `potential=false` berarti `suggestion=null` dan tidak ada question.
  - `potential=true` mewajibkan suggestion.
  - Field question harus unik.
- Adapter OpenAI:
  - Request: `POST {base}/responses` dengan `store:false`, `reasoning.effort:"low"`, `text.format` json_schema strict, dan `max_output_tokens: 4000`.
  - Parser mencari item `type:"message"` karena output model reasoning dapat diawali item `reasoning`.
  - Pemetaan status:
    - 400/401/403/404/422 → `AI_CONFIG_INVALID`
    - 409/429 → `AI_RATE_LIMITED`
    - 408 atau abort → `AI_PROVIDER_TIMEOUT`
    - selain itu → `AI_PROVIDER_UNAVAILABLE`
  - Body respons tidak pernah dibaca ke pesan error, dan body error dibuang dengan `cancel()`.
- Resolver:
  - Default `unavailable`.
  - `fake` hanya diizinkan di test/development; selain itu resolver melempar `FAKE_AI_NOT_ALLOWED_IN_PRODUCTION`.
  - `openai` dengan key atau model kosong, base URL http non-localhost, atau URL berkredensial menghasilkan provider yang gagal `AI_CONFIG_INVALID`. Tidak ada request yang dikirim.
- Catatan TDD: test fase ini ditulis bersamaan dengan implementasinya, bukan diamati gagal lebih dulu. Kasus negatif (skema, grounding, pemetaan HTTP, guard production) memberi bukti perilaku yang setara. Kekurangan ini dicatat sebagai deviasi proses.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `vitest run` untuk 5 file baru | 0 | 5 file, 35 test |
| `pnpm typecheck` | 0 (setelah perbaikan typing test) | bersih |
| `pnpm test` | 0 | 49 file, 238 test (sebelumnya 44/203) |
| `pnpm lint` | 0 | bersih |

## Acceptance terbukti

- §1.7: output tidak sesuai skema, refusal, incomplete, JSON rusak, dan metric ungrounded (termasuk baseline) ditolak.
- §1.8 (unit): body error provider yang berisi key atau sentinel tidak muncul di hasil, dan key tidak ada di body request.
- §1.9: payload hanya berisi 5 kunci; sentinel nama, email, ID, project, employer, dan filename tidak ada.
- Guard fake di production dan fail-closed untuk konfigurasi OpenAI yang tidak lengkap.
