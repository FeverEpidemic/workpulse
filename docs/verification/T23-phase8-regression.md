# T23 Fase 8 — Regresi penuh

- Tanggal: 9–10 Oktober 2026 (dijalankan 23:40–00:15 WIB)
- Eksekutor: Claude Sonnet 5.5
- HEAD yang diuji: `56ff182` (HEAD Fase 0: `7e874b6`)
- Docker: stack Supabase, `workpulse-t10-clamav` (healthy), `workpulse-t15-gotenberg`, `workpulse-t21-pdf` hidup selama run. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan untuk seluruh run (termasuk `test:e2e:m2` dan `test:e2e:m3`); `SUPABASE_SECRET_KEY` memakai `SERVICE_ROLE_KEY` JWT.

## Hasil (satu skrip berurutan, 44 command, semuanya exit 0)

| Command | Hasil |
| --- | --- |
| `pnpm lint`, `typecheck`, `worker:check`, `db:lint`, `build` | exit 0 |
| `pnpm test` | **113 file / 1034 test** (baseline 104 / 962) |
| `pnpm db:test` | **17 file / 1439 assertion**, PASS (baseline 15 / 1290) |
| `pnpm test:pdf` | 46 test |
| `test:integration:account-deletion` | 2 file / **14** |
| `test:integration:cv-export` | 3 file / **35** (baseline 35) |
| `test:integration:cv-freshness` / `cv-builder` / `cv` | 11 / 7 / 10 |
| `test:integration:achievements` / `projects` / `activity` / `dashboard` | 5 / 7 / 6 / 4 |
| `test:integration:import-commit` / `import-review` / `import` | 11 / 6 / **21** (baseline 21) |
| `test:integration:m2` / `m3` / `m4` | 8 / 7 / 17 |
| `test:integration:ai` / `ai-review` | 13 / 21 |
| `test:integration:evidence` / `storage` | **14** (baseline 14) / **1** (baseline 1) |
| `test:e2e:account-deletion` | **7 passed** |
| `test:e2e:cv-export` | 12 passed |
| `test:e2e:cv-freshness` / `cv` | 11 / 8 |
| `test:e2e:achievements` / `projects` / `dashboard` | 4 / 1 / 1 |
| `test:e2e:auth` / `ui` / `activity` | 1 / 1 / 1 (baseline auth: 1) |
| `test:e2e:import` / `import-review` | 7 / 10 |
| `test:e2e:ai` / `ai-review` / `evidence` | 2 / 11 / 8 |
| `test:e2e:m2` / `m3` / `m4` | 1 / 2 / 1 |

Tidak ada test yang flaky atau dilewati dalam run ini. Semua suite yang butuh ClamAV, Gotenberg T15, dan renderer T21 dijalankan (bukan "tidak dijalankan"). Perubahan perilaku pada `ui-dialog` (centering) terbukti tidak merusak suite E2E yang memakai dialog (`ai`, `ai-review`, `import-review`, `evidence`, `cv`, `projects`, `achievements`).

## Hygiene diff (sejak `7e874b6`)

- `supabase/migrations`: hanya dua file baru, `20261009090000_t23_account_deletion.sql` dan `20261009100000_t23_retention.sql`; tidak ada migration lama yang berubah. Parity lokal **33/33**.
- Daftar file berubah sesuai §4. Tambahan di luar daftar §4 yang perlu dilihat reviewer:
  - `src/server/auth/clear-cookies.ts` (baru, hasil memindahkan `clearAuthCookies` agar dipakai bersama);
  - `src/domain/import/review-view.ts` (field opsional `last_activity_at`);
  - `src/components/ui/field-control.tsx` (tipe `ref`);
  - `tests/integration/account-deletion-support.ts` dan `tests/e2e/helpers/account-deletion-worker.ts` (helper);
  - `tests/unit/cv-contracts.test.ts`, `cv-export-status-route.test.ts`, `auth-errors.test.ts`, `import-review-view-service.test.ts`, `tests/integration/cv-export.test.ts` (daftar kunci dan kolom aman diperbarui, tidak ada assertion dilemahkan);
  - `src/app/globals.css` (`.ui-dialog { margin: auto }`, cacat dialog bersama yang ditemukan lewat screenshot).
- Diff kumulatif juga memuat `docs/verification/CI01-implementation-plan.md` dari commit `92306ad` (rencana CI01 oleh pengguna, masuk ke branch ini di antara Fase 0 dan Fase 1; tidak terkait T23).
- `console.` di `src/features/account`, `src/domain/account`, `workers/account-deletion-worker.ts`, `workers/supabase-account-deletion-gateway.ts`, `src/server/auth/reauthenticate.ts`: nol hasil.
- `git diff --check 7e874b6..HEAD`: bersih.
- Setelah run: nol user Auth `t23-*`/`acd-*`, nol receipt, nol storage job terbuka tersisa. Screenshot T22 dan T23 yang tertimpa E2E dikembalikan ke versi ter-commit (efek samping regenerasi, bukan perubahan).

## Daftar acceptance yang belum terbukti atau punya batas (untuk gate review)

| Acceptance | Status |
| --- | --- |
| §1.13 runbook retensi dan status backup | **Belum**: dokumen runbook dan decision 0029 adalah Fase 9 (setelah gate). Angka lokal: requested → completed 1,9 detik (integration) dan 2 detik (hasil `ACCOUNT-DELETION-DURATION-SECONDS`). Retensi backup ≤ 30 hari **belum terverifikasi** (T25). |
| §1.19 password, email, dan isi karier tidak di log, URL, receipt, atau error | Terbukti oleh unit, grep `console.`, dan E2E (keluaran worker tanpa sentinel dan email). Satu butir tinjauan manual: error `AccountDeletionError` tidak membawa teks pengguna. |
| §1.20 tanpa regresi | Terbukti oleh run ini. Perubahan assertion lama hanya yang tercatat di receipt Fase 2, 3, dan 6. |
| Race guard tulis (§2.2.1) | Tidak diuji paralel; argumen untuk decision 0029. |
| Sisa risiko access token JWT sampai `exp` | Dicatat dan dibuktikan bahwa penulisan ditolak guard; PostgREST tetap menerima token itu untuk pembacaan sampai `exp`. |

## Penyimpangan dari plan yang harus diputuskan reviewer

1. Guard tulis aktif hanya untuk role DB `authenticated` yang membawa `sub` (bukan sekadar `auth.uid()` terisi). Alasan dan bukti di receipt Fase 1.
2. Gate M4 belum memiliki verdict saat T23 dimulai; mulai berdasarkan perintah ulang pengguna (receipt Fase 0).
3. Tabel internal tanpa FK (`evidence_scan_jobs`, `evidence_reservation_requests`) ikut dipurge (receipt Fase 0).
4. Penggunaan `Select-String`/PowerShell tidak mempengaruhi file; semua penulisan berkas non-ASCII memakai Edit atau `WriteAllText` UTF-8 tanpa BOM.

## Serah terima ke reviewer

- Hash commit: `67464ed` (Fase 0), `b95876b` (1), `8d68df7` (2), `9859618` (3), `e74bf33` (4), `786d9a7` (5), `1fe37ab` (6), `56ff182` (7), receipt ini (8).
- Receipt Fase 0–8: `docs/verification/T23-phase*.md`. Screenshot: `docs/verification/T23-screenshots/`.
- Tidak dilakukan: Fase 9 (decision 0029, runbook retensi, laporan akhir, README), perubahan `IMPLEMENTATION_STATUS.md`, dan penandaan DONE. Semuanya menunggu gate review.
