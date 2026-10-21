# T28 Fase 0: baseline

- Tanggal: 21 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, tanpa sub-agent.
- Tujuan: memastikan titik awal bersih dan terukur sebelum kode T28 diubah. Tidak ada kode yang diubah di fase ini.
- antislop: tidak ada preferensi global (`%APPDATA%\antislop\settings.json` tidak ada). Plan mencatat mode **during** untuk konsep; mode sesi eksekusi dikonfirmasi ke pengguna sebelum Fase 2 (copy dan UI).

## Git dan branch

- Branch `claude/t28-import-mode-choice`, HEAD `88095dd` (plan T28), turunan dari `main` (`git merge-base --is-ancestor main HEAD` benar).
- `git status` awal: hanya `.claude/launch.json` dan `.claude/setting.local.json` (untracked, lokal pengguna). Tidak ada path T28 yang kotor.
- Parity migration lokal: `supabase migration list --local` menampilkan **38/38** pasangan local = remote, terakhir `20261019090000` (`t26_import_rules_extraction.sql`).

## Command dan hasil (HEAD `88095dd`)

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 1: 136 error, 33 warning, **semuanya** di `.claude/worktrees/*/.next/` (build output worktree sesi lain) |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **134 file / 1261 test** (sesuai harapan entry T27) |
| `test:e2e:import` | exit 0, **11 passed** (1,5 menit) |
| `test:e2e:import-review` | exit 0, **10 passed** (1,3 menit) |
| `test:e2e:ai` | exit 0, **2 passed** (35 detik) |
| `test:e2e:m3` | exit 0, **2 passed** (46 detik) |
| `test:e2e:release` | exit 0, **21 passed** (4,0 menit), setelah renderer PDF dinyalakan |

Semua suite E2E dijalankan lewat `node node_modules/@playwright/test/cli.js test --config <config> [spec]` dengan argumen yang sama seperti script `package.json`.

## Catatan lingkungan

- Run pertama kelima suite lewat `pnpm test:e2e:*` gagal dengan "Playwright Test did not expect test.beforeAll()": `package.json` memuat `"playwright": "latest"` (1.64.0) di samping `@playwright/test` 1.63.0. Ini sudah ter-commit di `main`, bukan perubahan lokal; dicatat juga di receipt T27.
- Run kedua `release` gagal di `beforeAll` karena container `workpulse-t21-pdf` mati ("The PDF renderer is not reachable"). Setelah `docker start workpulse-t21-pdf`: 21/21.
- Container yang dinyalakan untuk baseline: `workpulse-t10-clamav`, `workpulse-t15-gotenberg`, `workpulse-t21-pdf`. Tidak ada worker atau `next dev` dari sesi lain yang jalan.
- Env proses: `SUPABASE_SECRET_KEY` dari JWT `SERVICE_ROLE_KEY` `supabase status -o env`, isi `.env.local`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. Tidak ada nilai yang dicetak atau disimpan.
- `release-a11y` dan suite T27 menulis ulang PNG tracked di `docs/verification/T25-screenshots/` dan `T27-screenshots/`; dikembalikan dengan `git checkout` setelah run.
- Log `[WebServer] Error: The destination stream closed early.` muncul di `release` tetapi tidak menggagalkan test (navigasi dibatalkan saat streaming).

## Rujukan file:baris di plan

| Rujukan plan | Kondisi aktual |
| --- | --- |
| `src/features/ai/actions.ts:48` / `48-77` (`setAiConsentAction`) | benar |
| `20260928090000_t13_ai_jobs_consent.sql:247` (`set_ai_consent`) | benar |
| `20260928090000_t13_ai_jobs_consent.sql:635-637` (`CONSENT_WITHDRAWN`) | benar |
| `20261019090000_t26_import_rules_extraction.sql:525-526` | benar |
| `import-start.tsx:61-71` (`chooseImportMode`) | benar |
| `import-start.tsx:173-177` (dialog hanya bila `!granted`) | benar |
| `import-start.tsx:188-197` (error upload) | benar |
| `import-start.tsx:256` (`aiBlocksRetry`) | benar |
| `import-start.tsx:269-274` (cabang kuota habis + consent) | benar |
| `import-start.tsx:410` (`{granted ? null : ...}`) | benar |
| `import-start.tsx:53-55` (`importUploadHeaders`) | benar |
| `import-mode-dialog.tsx:11-15` (komentar "a user without AI consent") | benar |
| `consent-service.ts:54` (`revision`) | benar; `setAiConsentAction` mengembalikan `actionSuccess(..., state)`, jadi `state.data.revision` tersedia (§2.2.6 aman, bukan stop condition) |
| `import-view.ts:104-109`, `:108` (alasan `consent`) | benar |
| `ai-consent-card.tsx:107-117` (konfirmasi S12) | benar. Catatan: S12 memberi `autoFocus` ke tombol *Keep*; T28 sengaja memberi fokus ke judul konfirmasi (§2.2.4), jadi hanya pola ganti-isi yang diambil |
| `tests/e2e/import-onboarding.spec.ts:31-40` (`createUser({ consent })`) | benar |

## Test yang meng-upload sebagai pengguna consent

`rg "Upload and extract" tests` (baris yang cocok): `import-onboarding` **13** (plan menulis 16; selisih karena plan menghitung kemunculan, bukan baris), `m3-assisted-journey` 3, `ai-usage-limits` 3, `import-start-ui` 3, `import-review` 1, `m2-manual-journey` 1, `release-a11y` 1.

Langkah upload yang kini membuka dialog (pengguna consent, file valid):

| Spec | Lokasi | Catatan |
| --- | --- | --- |
| `import-onboarding.spec.ts` | test `:166` (4 upload), `:202`, `:219`, `:240` (id, label Indonesia), `:264` | `createUser({ consent: true })` |
| `import-review.spec.ts` | helper upload `:155` | `createUser` selalu memberi consent (`:52`); dipakai semua test di spec |
| `m3-assisted-journey.spec.ts` | test `:261` (upload `:275`, `:279`) | consent lewat RPC `:265`. Perlu dicek di Fase 3: file yang ditolak di klien (format) berhenti sebelum dialog, file yang ditolak server tetap lewat dialog |
| `release-a11y.spec.ts` | `beforeAll` `:99` (aktor `rich`) | `consent(rich)` di `:87` |

Tidak berubah: `m2-manual-journey:172` (hanya cek tombol nonaktif), `m3:139` (pengguna baru tanpa consent, sudah memakai dialog T26), skenario T26 tanpa consent di `import-onboarding` (`:102`, `:126`, `:296`, `:383`, `:411`, `:461`).

Assertion unit yang akan berubah dengan sengaja:

1. `import-start-ui.test.tsx:161` "keeps the AI disclosure and no mode dialog for a user who already consented": perilaku lama (tanpa dialog, disclosure AI saja).
2. `import-start-ui.test.tsx:173-174` bagian `consented` dari "keeps the upload open ... limit is reached": lama mengharapkan tanpa *Upload and extract*.
3. `ai-usage-limits.test.tsx:89-96` "replaces the drop area with the limit and makes manual entry the primary action": cabang kuota-habis-hanya-manual yang dihapus §2.2.7.
4. `import-mode-dialog.test.tsx:17`: daftar key yang memuat `import.disclosureNoConsent`, yang dihapus §2.2.8.

Tetap: `ai-usage-limits.test.tsx:98-103` (Retry disembunyikan saat kuota habis, tampilan status batch) tidak tersentuh §2.2.7.

## Acceptance

Fase 0 tidak membuktikan acceptance §1; fase ini menetapkan baseline untuk acceptance 13 (tanpa regresi).

## Blocker

Tidak ada. Stop condition §8 tidak terpicu.

## Langkah berikutnya

Fase 1: test gagal untuk `chooseImportMode(mode, granted, steps)` empat kombinasi, lalu implementasi.
