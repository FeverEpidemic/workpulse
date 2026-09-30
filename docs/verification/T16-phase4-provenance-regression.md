# T16 Fase 4 — Provenance S08 dan regresi penuh (receipt)

- Tanggal: 29 September 2026

## Tujuan

S08 menampilkan provenance jujur untuk achievement `origin = 'import'` ("Imported from CV" / "Diimpor dari CV" + excerpt) dan tidak lagi menampilkan "Aktivitas asli tidak lagi tersedia".
Regresi penuh atas §7 plan.

## File berubah

- Baru: `src/features/achievement/achievement-source-card.tsx` (kartu sumber diekstrak dari `achievement-detail.tsx`), `tests/unit/achievement-import-provenance-ui.test.tsx`.
- Diubah: `src/features/achievement/achievement-detail.tsx` (memakai kartu; subjudul header untuk origin import), `src/i18n/messages.ts` (`achievement.importedFromCv`, `achievement.importedHelp` en/id).

## Command dan hasil aktual

Env: `.env.local` + `SERVICE_ROLE_KEY` JWT di env proses; `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan; ClamAV + Gotenberg berjalan.

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/achievement-import-provenance-ui.test.tsx` sebelum implementasi (RED) | exit 1, modul `achievement-source-card` belum ada |
| `pnpm typecheck` / `pnpm lint` | exit 0 / exit 0 |
| `pnpm test` | exit 0, 70 file / 449 test lulus (baseline 66 / 424) |
| `pnpm db:test` | exit 0, Files=11, Tests=779, PASS (baseline 10 / 668) |
| `pnpm db:lint` | exit 0 (Fase 1) |
| `pnpm worker:check` / `pnpm build` / `git diff --check` | exit 0 / exit 0 (Compiled successfully) / exit 0 |
| `pnpm test:integration:import-commit` | 11/11 lulus |
| `pnpm test:integration:` `import` / `achievements` / `dashboard` / `activity` / `projects` / `m2` / `ai` / `ai-review` / `evidence` / `storage` | 21 / 5 / 4 / 6 / 7 / 8 / 13 / 21 / 14 / 1 lulus, semua exit 0 |
| `pnpm test:e2e:` `achievements` / `import` / `m2` / `dashboard` / `auth` / `ui` / `activity` / `projects` / `ai` / `ai-review` / `evidence` | 4 / 7 / 1 / 1 / 1 / 1 / 1 / 1 / 2 / 11 / 8 lulus, semua exit 0 |

Catatan: log Playwright `WebServer` menampilkan `Error: The destination stream closed early` dari Next dev server saat koneksi ditutup browser; tidak mempengaruhi hasil (exit 0, semua test lulus).
`test:e2e:m2` dijalankan dengan `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan tanpa melemahkan assertion.

## Acceptance yang terbukti

- §1.15: unit render en/id — achievement import menampilkan label + excerpt, tanpa `sourceUnavailable`, tanpa tautan Activity; achievement `activity` dengan activity terhapus tetap menampilkan pesan lama;
  tampilan activity + peringatan `sourceChanged` tidak berubah; achievement `manual` tanpa sumber tidak merender kartu. `test:e2e:achievements` (4) lulus.
- §1.17: seluruh suite T06–T15 lulus tanpa melemahkan assertion (perubahan di suite lama hanya fixture `import_staging.test.sql`, lihat receipt Fase 1 Ruling 1).
- §1.16 (grep): tidak ada `console.`/logger di `src/features/import`; suite integration menyaring sentinel (Fase 3).

## Acceptance yang belum terbukti

- Race commit hanya dibuktikan pada satu putaran per skenario (hasil serial yang sah, tanpa deadlock); tidak ada uji stres berulang.
- Jalur produksi (Supabase hosted, backup/purge nyata) tidak diverifikasi; kesiapan produksi tidak diklaim.
- UI S03 (T17), CV freshness untuk perubahan profil lewat commit (T20), dan penghapusan akun/purge batch `review` yang ditinggalkan (T17/T23) di luar scope.

## Langkah berikutnya

Gate review Claude (§9), lalu Fase 5 (decision 0022, `T16-import-commit.md`, README) setelah temuan P0–P2 selesai.
