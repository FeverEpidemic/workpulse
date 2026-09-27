# Gate M2 — Fase 0 baseline

- Tanggal: 26 September 2026
- Pelaksana: Claude (Opus 5.5), satu sesi, tanpa sub-agent.
- Handoff: [M2-gate-review-plan.md](M2-gate-review-plan.md) §5 Fase 0.

## Tujuan

Mencatat baseline repository, dependensi, parity migration, gate cepat, dan scanner nyata sebelum review.

## Working tree

Awal sesi: branch `claude/clever-archimedes-gbu7qd`, HEAD `e00b38b docs(m2): add gate M2 integration review handoff`.
Working tree berisi `?? .claude/` **dan** dua perubahan tracked yang belum di-commit:
`tests/e2e/helpers/accessibility.ts` (menunggu animasi finite sebelum Axe) dan
`tests/e2e/achievements-ui.spec.ts` (assert warna dark pada tombol `retry`). Ini memicu stop condition §6.
Pelaksana berhenti dan bertanya; pengguna memilih **commit dulu, lalu lanjut**. Commit dibuat:
`845375c test(e2e): settle finite animations before axe scans`. Setelah itu status hanya `?? .claude/`.

Baseline review: **HEAD `845375c`**.

## Command dan hasil

| Command | Exit | Hasil aktual |
| --- | --- | --- |
| `node --version` / `pnpm --version` | 0 | v24.18.0 / 11.19.0 |
| `pnpm install --frozen-lockfile` | 0 | Already up to date |
| `docker ps -a` | 0 | 6 container `supabase_*_WorkPulse` aktif (db, auth, rest, storage, kong, inbucket); imgproxy/pooler tidak berjalan (tidak dibutuhkan) |
| `pnpm exec supabase migration list --local` | 0 | **21/21** local = remote, terakhir `20260927090000` |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | **44 file / 203 test** lulus |
| `pnpm db:test` | 0 | **7 file / 386 assertion**, PASS |

`pnpm db:status` tidak dijalankan terpisah; status stack diambil dari `docker ps` dan `migration list` yang terhubung ke DB lokal.

## ClamAV nyata

- Container `workpulse-t10-clamav` belum ada; dibuat sesuai runbook (image ter-pin `sha256:0e31ce…d817`, `127.0.0.1:13310`, `--memory 4g`).
- Health: `healthy` setelah ±40 detik; log `socket found, clamd started`.
- `clamdscan --version`: **ClamAV 1.5.4 / daily 28129 / Sun Sep 20 06:26:26 2026** → umur signature ±6 hari pada saat start (bawaan image; FreshClam berjalan di container).
- Fake scanner tidak dipakai.

## Temuan

Tidak ada temuan produk. Deviasi proses: dua perubahan test pengguna di-commit atas persetujuan pengguna sebelum baseline.

## Blocker

Tidak ada.

## Langkah berikutnya

Fase 1 — audit acceptance T06–T12.
