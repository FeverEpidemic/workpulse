# 0019 — T13 Durable AI jobs dan consent

- Tanggal: 27 September 2026
- Status: Diterima
- Rujukan: PRD R05, §3 *Content and AI behavior*, §4 *AI disclosure / Data minimization / Failures*; User Flow F02; Wireframe §1 dan S12; Database Schema §2, §3, §6; `IMPLEMENTATION_PLAN.md` §3 dan §4/T13; [handoff T13](../verification/T13-implementation-plan.md).
- Nomor 0017 tetap dicadangkan untuk T11 dan tidak dibuat.

## Konteks

T13 menyiapkan infrastruktur AI yang durable sebelum T14 (deteksi, review, apply). Syarat yang harus dipenuhi:

- Job tidak bergantung pada umur request web.
- Tidak ada duplikasi job.
- Hasil stale atau hasil dari worker yang terlambat tidak boleh tersimpan.
- Consent dicatat beserta versi dan timestamp, dan diperiksa sebelum teks dikirim.
- Jalur manual tetap utuh tanpa AI.

Sumber tidak menetapkan provider, model, maupun wording consent, sehingga keputusan tersebut dicatat di sini.

## Keputusan

1. **`public.ai_jobs` hanya bisa diubah lewat RPC.**
   - RLS mengizinkan SELECT hanya untuk owner, dan grant kolom menyembunyikan `attempt_token`, `lease_expires_at`, dan `payload_hash` dari client.
   - Hak INSERT/UPDATE/DELETE dicabut dari semua role, termasuk `service_role`.
   - Trigger `guard_ai_job_row` menjaga field identitas tetap immutable dan menaikkan `revision`.
2. **Kind T13 hanya `detect`**, yaitu subset dari DB §3. Kind `refine` ditambahkan di T14, sedangkan `import` beserta `import_batch_id` di T15. Target memakai composite FK `(user_id, activity_id)` dengan `ON DELETE CASCADE` (DB §6).
3. **Idempotency key diturunkan server**, berbentuk `detect:<activity_id>:r<revision>` dan unik per user.
   - `payload_hash` adalah sha256 atas `{raw_text, role, scope, outcome}`. Locale sengaja tidak ikut karena perubahan locale tidak menaikkan revisi.
   - Key yang sama dengan hash berbeda menghasilkan `IDEMPOTENCY_KEY_REUSED`.
4. **Tidak ada retry otomatis.**
   - Setiap claim dihitung sebagai satu attempt. Retry `failed → queued` hanya terjadi atas permintaan eksplisit, maksimal 3 attempt.
   - Retry ditolak dengan `STALE_INPUT` bila revisi activity sudah berubah.
5. **Lease 120 detik yang kedaluwarsa menghasilkan `failed/AI_TIMEOUT`**, tidak di-reclaim (DB §3). Timeout provider 90 detik. Complete dan fail memakai compare-and-set pada token serta lease.
6. **Consent** menggunakan kolom `profiles.ai_consent_at/_version` yang sudah ada.
   - Versi hanya bersumber dari `internal.current_ai_consent_version()` (`ai-processing-v1`), dan TypeScript diuji paritasnya terhadap nilai itu.
   - Consent diperiksa tiga kali: sebelum enqueue (`CONSENT_REQUIRED`), sebelum teks dirilis ke worker (`CONSENT_REQUIRED`), dan sebelum hasil disimpan (`CONSENT_WITHDRAWN`, result NULL). Pemeriksaan sebelum apply ke Achievement adalah bagian T14.
7. **Urutan lock** selalu profile (`for share`) → activity (`for update`) → job. `claim_ai_jobs` tidak menyentuh activity; status `running` diset saat input diambil.
8. **`analysis_state` hanya ditulis oleh fungsi job**, dan hanya bila revisi cocok. Trigger T06 diperluas satu cabang: edit input mereset status ke `not_requested`.
9. **Minimisasi data.** Worker hanya menerima `{locale, raw_text, role, scope, outcome}`. ID, nama, email, project/employer, evidence, dan filename tidak ikut. Klaim job tidak memuat teks.
10. **Skema `detect.v1`.**
    - Zod dan JSON Schema strict, dengan batas di bawah `ACHIEVEMENT_FIELD_LIMITS`.
    - Setiap nilai dan baseline metric wajib tertulis di teks pengguna (grounding).
    - Output invalid atau refusal disimpan sebagai error code tanpa result.
11. **Provider: adapter OpenAI-compatible melalui `fetch`, tanpa SDK baru.** Keputusan ini diubah atas instruksi pengguna di Fase 6; rencana awal memakai OpenAI Responses.
    - Default-nya Chat Completions (`POST {base}/chat/completions`, `response_format` json_schema strict). Responses (`WORKPULSE_AI_API=responses`) dan JSON mode (`WORKPULSE_AI_STRUCTURED_OUTPUT=json_object`) tetap tersedia.
    - Base URL memilih pemroses. Endpoint pilihan pengguna adalah `https://ai.sumopod.com/v1` dengan model `gpt-6-luna`, diverifikasi lewat daftar model endpoint dan smoke live.
    - `store:false` hanya dikirim ke `api.openai.com`, karena endpoint compatible belum tentu menerima field tersebut. Retensi di pemroses pihak ketiga mengikuti kebijakannya masing-masing; WorkPulse tidak menjanjikan zero retention.
12. **Konfigurasi.** Mode default adalah `unavailable`, dan job gagal dengan `AI_UNAVAILABLE` sehingga Retry tampil.
    - Mode `fake` hanya boleh dipakai di development/test.
    - Konfigurasi yang tidak lengkap atau tidak dikenal fail closed dengan `AI_CONFIG_INVALID`. URL http hanya diizinkan untuk localhost.
    - Semua variabel AI disimpan di `.env.ai.local`, yang hanya dibaca oleh `worker:run`/`worker:once`. Proses web tidak membutuhkan key.
13. **UI consent (S12)** berupa kartu *AI processing* dan `AiConsentDialog` bersama (*Allow AI* / *Continue manually*, fokus awal di *Continue manually*). Withdraw memakai konfirmasi inline. Wording generik, "penyedia AI eksternal", atas pilihan pengguna.
14. **Kebijakan versi consent.** Perubahan copy di tahap ini terjadi sebelum ada rilis atau pengguna nyata, sehingga versi tetap `ai-processing-v1`. Setelah rilis, setiap perubahan pemroses, cakupan data, atau wording material wajib menaikkan versi di SQL dan TypeScript sekaligus. Consent lama kemudian dianggap *outdated*.

## Error code

`CONSENT_REQUIRED`, `CONSENT_WITHDRAWN`, `STALE_INPUT`, `ACCOUNT_DELETING`, `AI_TIMEOUT`, `AI_PROVIDER_TIMEOUT`, `AI_PROVIDER_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_CONFIG_INVALID`, `AI_REFUSED`, `AI_OUTPUT_INVALID`, `AI_UNAVAILABLE`, `AI_RETRY_EXHAUSTED`.

Pemetaan HTTP ke error code:

| Respons provider | Error code |
| --- | --- |
| 400/401/403/404/422 | `AI_CONFIG_INVALID` |
| 409/429 | `AI_RATE_LIMITED` |
| 408 atau abort | `AI_PROVIDER_TIMEOUT` |
| Lainnya | `AI_PROVIDER_UNAVAILABLE` |

Body respons tidak pernah dibaca ke log maupun ke error.

## Seam

- **T14** menambah kind `refine`, counter follow-up dan suppression per revisi activity, UI Analyze/Retry/status, serta apply lewat review action yang memeriksa ulang consent dan revisi. T14 memakai `createAiJobService`, `AiConsentDialog`, dan `detect.v1`.
- **T15** menambah `import_batch_id` dan kind `import`, beserta consent sebelum ekstraksi.
- **T21** mengikuti pola lease, token, dan attempt yang sama untuk export.

## Konsekuensi

- Tanpa worker yang berjalan, job tetap `queued`. UI T14 harus menampilkan status tersebut apa adanya.
- Mengganti pemroses cukup dilakukan lewat env. Setelah rilis, versi consent wajib dinaikkan (poin 14).
