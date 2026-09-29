# T15 Fase 3 — Domain import dan provider (receipt)

Tanggal: 29 September 2026.

Tujuan: skema `import.v1`, validator dan grounding, view model S02, serta `AIProvider.extractImport` (OpenAI-compatible, fake, unavailable).

## File berubah

- Baru: `src/domain/import/{extract-result,import-view}.ts`, `src/server/ai/import-prompt.ts`, `tests/unit/{import-extract-result,import-view}.test.ts`
- Diubah: `src/domain/ai/detect-result.ts` (hanya ekspor `numbersIn`), `src/server/ai/{provider,openai-provider,fake-provider}.ts`, `tests/unit/openai-provider.test.ts` (+2 test import), `tests/unit/ai-worker.test.ts` (mock provider menambah `extractImport`; assertion tidak diubah)

## Keputusan

- Output mentah `import.v1` memakai tanggal `{year, month, day}` agar presisi dapat dibumikan ke excerpt; payload item memakai kolom canonical (`start_date`/`start_precision`, dst.).
- Grounding: excerpt harus substring teks (normalisasi NFKC, huruf kecil, whitespace) atau kandidat dibuang dan dihitung `dropped_ungrounded`. Field fakta (organisasi, role, institusi, kualifikasi, nama sertifikasi/skill, issuer, kontak) harus muncul di excerpt-nya sendiri; jika tidak dikosongkan + `UNGROUNDED`. Teks yang boleh diparafrasekan (judul/kontribusi/outcome/CV bullet/deskripsi) hanya dicek angkanya. Metric tanpa angka di excerpt dibuang. Tahun wajib ada di excerpt; bulan (angka atau nama en/id) dan hari hanya dipertahankan bila tertulis. Interval yang pasti terbalik diberi `DATE_RANGE`; overlap diterima.
- Field terlalu panjang dikosongkan + `TOO_LONG` (tidak memotong fakta, tidak menggagalkan seluruh ekstraksi).
- `achieved_on` Achievement disimpan hanya bila presisi hari tergrounding, karena kolom canonical adalah tanggal eksak.
- Provider: `extractImport({ text })` mengirim hanya teks (tanpa filename/akun), prompt `import.prompt.v1`, JSON schema strict `import_v1`, batas output 16.000 token. Fake memakai baris fixture `EXP|…`, `EDU|…`, `CERT|…`, `SKILL|…`, `ACH|…` dengan excerpt baris itu, plus skenario `import_empty/partial/ungrounded/numbers` dan skenario umum (`malformed`, `unavailable`, `slow`, `refusal`).
- `AI_JOB_KINDS` tidak diubah (tetap kind activity `detect|refine`); kind `import` ditangani terpisah di worker agar kode S06/S08 tidak pernah menerima job import.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/{import-extract-result,import-view,openai-provider}.test.ts` | 37/37 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | 63 file / 404 test |

Kegagalan yang ditemukan: pencocokan nama bulan tidak case-insensitive ("Jan 2019" dianggap tanpa bulan). Diperbaiki di `monthGrounded`; ditangkap test "never makes a date more precise than its excerpt".

## Acceptance yang terbukti (unit)

§1.9 (grounding excerpt, employer rekaan, angka rekaan, presisi tanggal, output rusak), §1.10 (kandidat parsial dengan `REQUIRED`, ekstraksi kosong, Achievement selalu draft), §1.17 (view model: status jujur per stage, polling berhenti di review/terminal, retry diblokir dengan alasan).

Berikutnya: Fase 4 (worker, service, route, integration nyata).
