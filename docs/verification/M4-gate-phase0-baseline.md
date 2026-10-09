# Gate M4 — Fase 0: baseline

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5 (satu sesi, tanpa sub-agent). Verdict Gate M4 bukan wewenang pelaksana.
- Tujuan: mencatat kondisi awal sebelum review. Tanpa edit kode.
- File berubah: hanya receipt ini.

## Kondisi repository

| Item | Hasil |
| --- | --- |
| Branch | `claude/clever-archimedes-gbu7qd` (ahead 3 dari origin) |
| HEAD | `7a93932` (`docs(m4): add gate review handoff plan`), turunan `4757a76` |
| Working tree | hanya `?? .claude/setting.local.json` (tidak dilacak, milik pengguna) |
| `pnpm install --frozen-lockfile` | exit 0 |
| Migration lokal | 31 file di `supabase/migrations`, `migration list --local` 31/31 sinkron, terakhir `20261005090000` |

## Environment

Docker Desktop baru saja restart: semua container berstatus `Exited` saat sesi dimulai. Dinyalakan ulang tanpa `db reset`: `pnpm db:start` (exit 0) lalu `docker start` untuk tiga container.

| Container | Image | Port |
| --- | --- | --- |
| `workpulse-t21-pdf` | `gotenberg/gotenberg:8` (`sha256:f29984bd1e22…`) | 127.0.0.1:13401 |
| `workpulse-t15-gotenberg` | sama | 127.0.0.1:13400 |
| `workpulse-t10-clamav` | `clamav/clamav@sha256:0e31ce089574…` | 127.0.0.1:13310 |

Supabase lokal sehat. `supabase_vector_WorkPulse` terus restart (logging, tidak dipakai suite). `SUPABASE_SECRET_KEY` diambil dari `SERVICE_ROLE_KEY` lokal ke env proses saja. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401` hanya di proses suite.

## Hasil baseline

| Command | Exit | Hasil | Harapan |
| --- | --- | --- | --- |
| `pnpm lint` | 0 | bersih | lulus |
| `pnpm typecheck` | 0 | bersih | lulus |
| `pnpm worker:check` | 0 | `ready`, 8 job terdaftar | lulus |
| `pnpm test` | 0 | 103 file / 956 test | 103 / 956 |
| `pnpm db:test` | 0 | 15 file / 1290 assertion, PASS | 15 / 1290 |
| `pnpm db:lint` | 0 | `results: []` | — |
| `pnpm test:pdf` | 0 | 46 test | 46 |
| `pnpm test:integration:cv-export` | 0 | 35 test (20 + 7 + 8) | 35 |
| `pnpm test:e2e:cv-export` | 0 | 12 test | 12 |

Semua angka sama dengan harapan handoff.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| B1 | P3 | Konfirmasi T22 N3: `test:e2e:cv-export` menulis ulang 24 PNG di `docs/verification/T22-screenshots/` yang dilacak git. Dikembalikan dengan `git restore docs/verification/T22-screenshots`; working tree kembali bersih | Terbuka (sudah tercatat T22 N3) |
| B2 | P3 | Log WebServer E2E memuat `Error: The destination stream closed early` berulang (digest `2954661464`) pada run yang lulus 12/12. Kemungkinan stream respons yang ditutup klien saat navigasi/aborted fetch; tidak memengaruhi hasil | Catatan |
| B3 | Info | Stderr `@napi-rs/canvas` tidak ditemukan saat pdf.js memuat; test tetap lulus (pdf.js memakai fallback) | Catatan |

## Blocker dan langkah berikutnya

Tidak ada blocker. Lanjut Fase 1 (audit acceptance T18–T22).
