# T24 Fase 6 — Regresi penuh

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD saat regresi: `d77d27f`; HEAD Fase 0 (basis diff): `f6b5237`
- Tidak ada perubahan kode di fase ini. File baru: receipt ini.

## Cara menjalankan

Satu runner sementara di luar repo menjalankan §7 berurutan (satu command pada satu waktu, tanpa suite lain, tanpa `next dev` lain). `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY` hasil `supabase status -o env` ke env proses saja; `.env.local` dimuat; `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan; `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`. ClamAV T10, Gotenberg T15, dan renderer T21 hidup selama run. Runner akan mengulang sekali command yang gagal dan mencatatnya; **tidak ada command yang gagal**, jadi tidak ada rerun dan tidak ada flaky. Run berlangsung 33 menit (11:52–12:26).

## Hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm lint`, `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **114 file / 1041 test** |
| `pnpm db:test` | 0 | **18 file / 1573 assertion**, `Result: PASS` |
| `pnpm db:lint` | 0 | `results: []` |
| `supabase migration list --local` | 0 | **34/34**, terakhir `20261011090000` |
| `supabase migration up --local` | 0 | `applied: []` |
| `test:integration:product-events` | 0 | 1 file / **9** |
| `test:integration:account-deletion` | 0 | 2 file / **14** |
| `test:pdf` | 0 | 1 file / **46** |
| `test:integration:cv-export` | 0 | 3 file / **35** |
| `test:integration:cv-freshness` / `cv-builder` / `cv` | 0 | 11 / 7 / 10 |
| `test:integration:achievements` / `projects` / `activity` | 0 | 5 / 7 / 6 |
| `test:integration:dashboard` / `import-commit` / `import-review` / `import` | 0 | 4 / 11 / 6 / 21 |
| `test:integration:m2` / `m3` / `m4` | 0 | 8 / 7 / 17 |
| `test:integration:ai` / `ai-review` | 0 | 13 / 21 |
| `test:integration:evidence` / `storage` | 0 | 14 / 1 |
| `test:e2e:account-deletion` | 0 | **7 passed** |
| `test:e2e:cv-export` / `cv-freshness` / `cv` | 0 | 12 / 11 / 8 passed |
| `test:e2e:achievements` / `projects` / `dashboard` | 0 | 4 / 1 / 1 passed |
| `test:e2e:auth` / `ui` / `activity` | 0 | 1 / 1 / 1 passed |
| `test:e2e:import` / `import-review` | 0 | 7 / 10 passed |
| `test:e2e:ai` / `ai-review` / `evidence` | 0 | 2 / 11 / 8 passed |
| `test:e2e:m2` / `m3` / `m4` | 0 | 1 / 2 / 1 passed (env AI dikosongkan, assertion tidak dilemahkan) |
| `pnpm worker:check` | 0 | `status: ready` |
| `pnpm build` | 0 | |
| `git diff --check HEAD` | 0 | |

Tidak dijalankan: `test:ai:live` (T24 tanpa AI, sesuai §7). Tidak ada command §7 yang dilewati.

`test:perf` tidak diulang di fase ini (sudah tiga run penuh di Fase 5, dijalankan sendirian).

## Diff dan hygiene terhadap `f6b5237`

| Pemeriksaan | Hasil |
| --- | --- |
| `git diff -- supabase/migrations` | satu file: `A 20261011090000_t24_product_events.sql` (tidak ada migration indeks, tidak ada migration lama diubah) |
| `git diff -- src workers` | satu file: `M src/server/supabase/database.types.ts` (+24 baris, dua fungsi `public`) |
| `pnpm db:types` vs file di repo | identik |
| File berubah | 18 file, seluruhnya di §4: migration, pgTAP, `database.types.ts`, `product-events.test.ts`, `tests/perf/{perf-support,seed,stats,read-write}`, `perf-stats.test.ts`, `vitest.perf.config.ts`, `package.json`, `T24-perf-results.json`, receipt Fase 0–5 |
| `git diff --check f6b5237..HEAD` | exit 0 |
| `console.` di `tests/perf` | 0 |
| Secret, JWT, `sb_secret`/`sb_publishable`, sentinel lengkap, UUID di receipt dan `T24-perf-results.json` | 0 (hanya label fixture statis `t24-perf-{p,q}@example.test` dari plan) |
| Akun `t24-%` / `acd-t24%` tersisa | **0** |
| Dependency baru | tidak ada (`package.json` hanya dua script) |

Catatan hygiene:

- Suite E2E menulis ulang 32 PNG di `docs/verification/T22-screenshots` dan `T23-screenshots` (tracked). Itu artefak run, bukan perubahan T24; dikembalikan dengan `git checkout` dan tidak di-commit.
- `public.profiles` 226 → **229** setelah regresi. Akun `t24-*` dan `acd-t24%` tidak tersisa; tiga profil tambahan berasal dari suite lama yang tidak menghapus akunnya lewat jalur T23 (gejala T6 di receipt Fase 0), tidak dibersihkan di sini.

## Status acceptance §1

| § | Status | Bukti |
| --- | --- | --- |
| 1 Event semua jalur | terbukti | pgTAP per trigger dan jalur; integration: activity (Note/Form/Chat), foundation, project, achievement, **apply AI**, import commit, export worker nyata |
| 2 Atomik dan idempotent | terbukti | pgTAP (`STALE_REVISION`, `IMPORT_ITEM_INVALID`, kunci sama, commit kedua) dan integration |
| 3 Metadata minimal | terbukti | enam kolom; 18 penolakan CHECK; sentinel di lima jenis konten dan nol di tabel event |
| 4 Tidak dapat diakses klien | terbukti | pgTAP (privilege) dan PostgREST `authenticated`/`anon` |
| 5 Kohort terpisah | terbukti | pgTAP empat kode error, epoch, penarikan final, non-kohort; integration |
| 6 Activation | terbukti | pgTAP batas 23:59:59 / 24:00:00, `pending` |
| 7 Value completion | terbukti | pgTAP batas 7 hari, export gagal |
| 8 Return capture | terbukti | pgTAP minggu ISO, `local_date`, batas 28 hari |
| 9 Export reliability | terbukti | pgTAP dan integration dengan worker nyata |
| 10 Laporan jujur | **sebagian** | kolom, `rate` NULL, target terbukti; **review runbook belum ada** (Fase 7) |
| 11 Ikut terhapus | terbukti | integration lewat jalur T23 penuh dengan akun berpopulasi (experience, project, achievement, activity, export); pgTAP untuk akun tanpa experience |
| 12 Dataset nyata | terbukti | `count(1)` 1.000/200/50, akun Q sama |
| 13 p95 baca < 2 detik | terbukti | 10 operasi × 50 sampel; p95 tertinggi 206,2 ms antar tiga run |
| 14 p95 simpan < 1 detik | terbukti | 6 operasi × 50 sampel dengan trigger aktif; p95 tertinggi 198,4 ms |
| 15 Metode tercatat | terbukti | file hasil; batas: buffer tidak dikosongkan |
| 16 Plan dan indeks | terbukti | receipt Fase 4; tidak ada migration indeks |
| 17 Privasi dan log | terbukti | grep; **review reviewer menunggu gate** |
| 18 Tanpa regresi | terbukti | tabel di atas; tidak ada suite lama diubah |

## Yang belum terbukti atau memerlukan keputusan reviewer

1. **Dokumen Fase 7** belum ada: decision 0030, runbook metrik pilot (termasuk peringatan hipotesis dan n ≤ 20), laporan verifikasi, README. Karena itu §1.10 hanya sebagian.
2. **Kode error tambahan** `22023 INVALID_PILOT_PARTICIPANT` (tidak ada di §2.2.7); perlu konfirmasi atau diganti `23514`.
3. **Draft achievement kosong** menghitung `career_record_created` (T1 Fase 0). Sesuai kalimat §1.1, tetapi membuat Activation terpenuhi oleh satu klik "new achievement".
4. **Seq Scan literal** pada cek `exists(activities)` di `get_dashboard_summary` (0,007 ms) dinilai bukan alasan indeks (receipt Fase 4); reviewer yang memutuskan.
5. **Batas metode performa:** satu mesin, satu pengguna, loopback, tanpa evidence, cold tanpa pengosongan buffer; tidak membuktikan target di staging (T25).
6. **Pelaporan `get_pilot_metrics`:** `pending` untuk Return/Value menghitung akun yang sudah "teraktivasi" tetapi jendelanya belum selesai; definisi ini dipilih pelaksana dari §1.6–1.8 dan perlu ditinjau.
7. Event `reopen → confirm` ganda hanya diuji di pgTAP.

## Serah-terima ke gate review Claude (§9)

- Commit: `adca357` (migration + pgTAP + types), `b3efd14` (integration), `fed6ff8` (alat ukur), `437a4f0` (pengukuran p95), dan receipt `6047ce7`, `5a48eb5`, `80cc2fc`, `3ee27e8`, `972f40c`, `d77d27f`, serta commit receipt ini.
- Receipt Fase 0–6: `docs/verification/T24-phase{0-baseline,1-database,2-integration,3-perf-tooling,4-query-plans,5-p95,6-regression}.md`.
- Hasil performa mentah: `docs/verification/T24-perf-results.json` (`samplesMs` per operasi untuk hitung ulang p95).
- Output command: tabel di atas; log penuh ada di scratchpad pelaksana, bukan di repo.
- Setelah gate dan perbaikan P0–P2: Fase 7. Status `IMPLEMENTATION_STATUS.md` tidak diubah dan T24 tidak ditandai DONE.
