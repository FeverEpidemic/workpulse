# T26 gate review (Claude, read-only)

Tanggal: 20 Oktober 2026. Reviewer: Claude (Opus 5.5). Branch `claude/wizardly-thompson-18c6a2`, HEAD `650b375`, basis `22c9868` (di atas `claude/eloquent-jones-3c0191`, usage limits, decision 0032).

## Verdict

**PASS.** Tidak ada temuan P0, P1, atau P2. Tujuh catatan P3 di bawah. Fase 6 (decision 0033 final, `T26-import-rules-extraction.md`) boleh dikerjakan. T26 belum DONE: closeout menunggu Fase 6 dan keputusan merge basis usage limits (N1).

## Checklist §9

| Kriteria | Hasil | Bukti |
| --- | --- | --- |
| Receipt Fase 0-5 lengkap dengan angka aktual | PASS | enam receipt; angka di bawah cocok dengan run ulang |
| Signature lama ter-drop, grant/revoke/comment lengkap | PASS | migration `:146`, `:343`, `:417`, `:549-582`; pgTAP privilege di `import_rules.test.sql` |
| `stage_import_items` identik dengan logika lama | PASS | dibandingkan baris per baris dengan `t15:1392-1446`; `= any(p_allowed_types)` setara `in (...)` untuk tipe non-null; validasi summary tetap di `complete_import_ai_job` sebelum helper |
| Consent hanya untuk `ai` di `begin`, `complete_import_parse`, `retry` | PASS | migration `:191`, `:460-472` (cabang `rules` kembali sebelum cek consent `:483`), `:264`; charge 0032 hanya `ai` `:214`, `:283` |
| Batch `rules` tanpa `ai_jobs`, tidak gagal karena consent | PASS | pgTAP acceptance 3/9, integration `T26-*`, E2E journey (nol `ai_jobs`) |
| Extractor murni, regex linear, excerpt potongan asli, tanpa tebakan | PASS | `rules-extract.ts`: tanpa I/O; excerpt = `text.slice` baris asli; header entri dibatasi 1.000 karakter sebelum regex sisi baris dijalankan; field tidak yakin `null` |
| Dialog netral | PASS | `import-mode-dialog.tsx`: dua `section` berlabel, `secondary` keduanya, `focusTitle`, Esc/backdrop/Cancel lewat `onCancel` saja; `ai-consent-dialog.tsx` tidak berubah |
| Copy en/id sesuai §2.2.12, tanpa em dash | PASS | 14 key di `messages.ts` persis sama dengan rencana |
| Log/response tanpa teks CV atau nama file | PASS | thread menelan pesan exception; worker hanya mencatat kode; sentinel diuji di unit, integration, E2E |

## Matriks acceptance §1

| # | Status | Bukti utama |
| --- | --- | --- |
| 1 | PASS | pgTAP `import_rules`, integration import |
| 2 | PASS | pgTAP (trigger guard, `IDEMPOTENCY_KEY_REUSED` lintas mode) |
| 3 | PASS | pgTAP (review/done, nol `ai_jobs`, cancel → `stale`) |
| 4 | PASS | `import_staging.test.sql` hanya berubah di 3 string signature; suite T15-T17 lulus |
| 5 | PASS | unit `import-rules-extract` (6 fixture, `dropped_ungrounded === 0`) |
| 6 | PASS | unit (35 test) |
| 7 | PASS | unit waktu (maks. 0,57 ms/baris menurut receipt), `parse-in-thread` timeout |
| 8 | PASS | unit worker, pgTAP permanen |
| 9 | PASS | pgTAP, integration `T26-3` |
| 10 | PASS | unit dialog + E2E keyboard/Esc/Cancel |
| 11 | PASS | unit copy |
| 12 | PASS | integration (upload → purge, account deletion), E2E journey |
| 13 | PASS | integration akun B `NOT_FOUND`, sentinel 0 |
| 14 | PASS | E2E axe, 360/1440 light/dark, urutan tab. NVDA manusia tidak diuji (N7) |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| N1 | P3 | T26 bertumpuk di `claude/eloquent-jones-3c0191` (usage limits, decision 0032) yang belum di-push, belum ber-PR, dan belum di-gate. T26 tidak bisa di-merge ke `main` sebelum branch itu. Migration T26 juga sudah diterapkan di Supabase lokal bersama, jadi worktree lain yang belum punya kedua migration akan melihat parity maju. | Terbuka: pengguna memutuskan urutan merge |
| N2 | P3 | Urutan deploy: worker lama yang meng-claim job `rules` memanggil `complete_import_parse` tanpa `p_items` → `22023 INVALID_IMPORT_PARSE` → gateway error, lease habis berulang sampai `IMPORT_WORKER_TIMEOUT`. Migration dan worker harus dideploy bersamaan (alur T25). | Catat di decision 0033 dan panduan deploy staging |
| N3 | P3 | Setelah *Use AI* berhasil, `setGranted(true)` membuat `ImportModeDialog` di-unmount (`import-start.tsx`, `{granted ? null : ...}`) sehingga `closeModeDialog` tidak berjalan dan fokus tidak dikembalikan secara eksplisit selama upload. Belum diverifikasi apakah fokus jatuh ke `body`. Test: E2E *Use AI* memeriksa `document.activeElement` setelah dialog tertutup. | Follow-up |
| N4 | P3 | Deviasi yang disengaja dan beralasan: `p_extraction_mode default 'ai'`; output `rules` invalid menutup job `failed` dan tidak menyimpan teks; kartu AI menampilkan `AiLimitNotice` dan *Use AI* nonaktif saat kuota habis (simetri kartu berubah hanya di keadaan itu); header invalid → kode service `VALIDATION`. Diterima. | Catat di decision 0033 |
| N5 | P3 | `src/domain/import/contracts.ts:28` `IMPORT_ENTITY_TYPES =[` kehilangan spasi (lint lolos). | Perbaiki di Fase 6 |
| N6 | P3 | Em dash pada ringkasan error S03 di `import-review.tsx` sejak T17 (dicatat receipt Fase 4). | Follow-up di luar T26 |
| N7 | P3 | Belum ada uji kualitas ekstraksi pada CV nyata dan belum ada uji screen reader manusia (NVDA). | *Open* di decision 0033 |

## Verifikasi ulang independen

Worktree `wizardly-thompson-18c6a2` bersih di `650b375`. Supabase lokal bersama, parity 38/38 (`20261019090000` terakhir). ClamAV, Gotenberg, PDF renderer nyata. `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` di env proses; `AI_AGENT`/`ANTHROPIC_BASE_URL` dikosongkan.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm worker:check` | 0 | |
| `git diff --check 4db01aa HEAD` | 0 | |
| `pnpm test` | 0 | 121 file / 1151 test |
| `pnpm db:test` | 0 | 21 file / 1725 test, `Result: PASS` |
| `pnpm db:lint` | 0 | |
| `pnpm test:integration:account-deletion` | 0 | 15/15 (pertama) |
| `pnpm test:integration:import` | 0 | 25/25 |
| `pnpm test:integration:import-commit` | 0 | 12/12 |
| `pnpm test:integration:import-review` | 0 | 6/6 |
| `pnpm test:integration:m3` | 0 | 7/7 |
| `pnpm test:integration:release` | 0 | 12/12 |
| `pnpm test:integration:ai-usage` | 0 | 9/9 |
| `pnpm build` | 0 | |
| `pnpm test:e2e:import` | 0 | 11/11 |
| `pnpm test:e2e:import-review` | 0 | 10/10 |
| `pnpm test:e2e:m3` | 0 | 2/2 |
| `pnpm test:e2e:release` | 0 | 15/15 |
| `pnpm test:e2e:m2` (regresi manual) | 0 | lulus; jumlah test tidak tertangkap oleh filter output |

Log web server E2E memuat `Error: The destination stream closed early.` pada m3, release, dan m2; semua suite tetap lulus. Tidak diselidiki di gate ini.

## Tidak dijalankan

`test:e2e:evidence`, `test:e2e:account-deletion`, `test:pdf`, `test:perf`, dan suite domain lain: T26 tidak menyentuh domain itu. Run tidak dilakukan di clone segar, jadi risiko CRLF pada golden file tidak tercakup; T26 tidak menambah golden text.

## Batas

Semua hasil lokal, bukan staging atau production. Deploy staging ikut alur T25 setelah T26 DONE.
