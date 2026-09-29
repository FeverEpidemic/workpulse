# T15 Fase 0 — Baseline (receipt)

Tanggal: 29 September 2026. Eksekutor: Claude (pengguna meminta Claude mengeksekusi plan T15; lihat catatan reviewer di bawah).

Tujuan: memastikan titik awal bersih dan lingkungan siap sebelum edit kode.

## Hasil

| Pemeriksaan | Command | Hasil |
| --- | --- | --- |
| Git | `git status --short --branch` | bersih kecuali `.claude/`; HEAD `ae9a42e` |
| Install | `pnpm install --frozen-lockfile` | exit 0, lockfile up to date |
| Stack lokal | `pnpm db:start` | Docker sempat restart; stack dinyalakan ulang dari volume yang ada (tanpa reset) |
| Parity | `pnpm exec supabase migration list --local` | 24/24, terakhir `20260929100000` |
| Lint | `pnpm lint` | exit 0 |
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit | `pnpm test` | 57 file / 357 test lulus |
| pgTAP | `pnpm db:test` | 9 file / 540 assertion, PASS |
| Integration AI | `pnpm test:integration:ai` | 13/13 |
| Integration AI review | `pnpm test:integration:ai-review` | 21/21 |
| Integration evidence (ClamAV nyata) | `pnpm test:integration:evidence` | 14/14 |

## Runtime eksternal

- ClamAV: container `workpulse-t10-clamav` (image pinned runbook T10) dijalankan ulang di `127.0.0.1:13310`.
- Renderer: `gotenberg/gotenberg:8`, digest `sha256:f29984bd1e226bf1b93ba90af06000afa8b315853e99d27b9aaa41b93f15c769`, versi 8.37.0, dijalankan sebagai `workpulse-t15-gotenberg` di `127.0.0.1:13400` (health: chromium up, libreoffice up).
- `pdfjs-dist`: versi stabil terbaru di registry 6.3.289, lisensi Apache-2.0, `engines.node` `>=22.13.0 || >=24`. Dipasang di Fase 2.

## Verifikasi source (file:baris)

- Reader ZIP/OOXML evidence: `src/features/evidence/file-inspection.ts:80` (`readDocxParts`), `:257` (`inspectEvidenceBytes`), `:287` (`readBoundedBody`).
- Upload evidence: `src/features/evidence/evidence-service.ts:73-117`; helper origin/CSRF `src/features/evidence/http.ts:13`.
- Kategori storage `import` sudah ada: `src/server/storage/constants.ts:12`; `internal.storage_jobs` menerima prefix `import` (`20260917090000_t05_private_storage_foundation.sql:75`).
- Klaim cleanup evidence dibatasi prefix `evidence`: `20260925130000_t10_cleanup_claim_scope.sql:24`.
- Definisi AI terbaru: `request_ai_analysis`/`retry_ai_job` di `20260929090000_t14_ai_review.sql:183/246`; `complete_ai_job` T14 `:324`; `claim_ai_jobs`, `get_ai_job_input`, `fail_ai_job`, `internal.fail_ai_job_locked`, `expire_ai_job_leases`, `guard_ai_job_row` di `20260928090000_t13_ai_jobs_consent.sql:482/527/657/228/442/139`.
- Temuan penting: `expire_ai_job_leases`, `get_ai_job_input`, `complete_ai_job`, `fail_ai_job`, dan `retry_ai_job` mengunci/membaca `activities` lewat `activity_id`. Untuk job `import` (tanpa activity) lease tidak akan pernah kedaluwarsa dan input RPC akan menggagalkan job sebagai `STALE_INPUT`; karena itu kelimanya diganti di migration T15 (lihat receipt Fase 1).
- `numbersIn` privat di `src/domain/ai/detect-result.ts:139`.
- `AiConsentDialog` `src/components/ui/ai-consent-dialog.tsx:15`; `EVIDENCE_POLL_DELAYS` `src/features/evidence/evidence-attachments.tsx:17`.
- Port 3009 belum dipakai config Playwright mana pun.

## Catatan

- Output `pnpm db:start` mencetak key demo lokal Supabase (nilai default CLI lokal, bukan secret produksi). Tidak disalin ke dokumen ini.
- Reviewer: rencana menetapkan Claude sebagai reviewer. Karena pengguna meminta Claude mengeksekusi, pelaksana dan reviewer adalah pihak yang sama; ini dicatat sebagai batas independensi review.

Berikutnya: Fase 1 (database, TDD pgTAP).
