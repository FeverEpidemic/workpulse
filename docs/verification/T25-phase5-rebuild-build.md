# T25 Fase 5 — Clean rebuild dan production build

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- Tidak ada edit source atau migration. Satu-satunya file baru adalah receipt ini.

## Clean migration rebuild (§1.14, §2.2.6)

Stack sekali pakai di luar repo; stack aktif tidak disentuh dan tidak di-reset.

| Item | Nilai |
| --- | --- |
| Direktori kerja | salinan `supabase/` di direktori scratch sesi (di luar repo), tanpa `.temp` dan `.branches` |
| `project_id` | `workpulse-t25-rebuild` |
| Port | api 55321, db 55322, shadow 55320, pooler 55329, studio 55323, inbucket 55324, analytics 55327, inspector edge runtime 8183 (stack aktif memakai 8083). `netsh` memastikan blok 55320–55329 tidak tereservasi; tidak ada pergeseran ke 56xxx |
| Seed | `supabase/seed.sql` bawaan repo, tanpa seed tambahan |

| Command | Hasil |
| --- | --- |
| `supabase start --workdir <scratch>` | exit 0; **36 migration diterapkan dari nol** (`Applying migration …` 36 baris, terakhir `20261012090000_t25_operational_health.sql`), seed dan bucket `workpulse-private` dibuat |
| `supabase test db --workdir <scratch>` | exit 0, **20 file / 1638 assertion**, `Result: PASS` (sama dengan stack aktif) |
| `supabase gen types typescript --local --schema public --workdir <scratch>` | exit 0; **identik byte demi byte** dengan `src/server/supabase/database.types.ts` (82.184 karakter, diff kosong) |
| `supabase stop --no-backup --workdir <scratch>` | exit 0; kontainer `rebuild`: 0, volume `rebuild`: 0 |
| `supabase migration list --local` (stack aktif sesudahnya) | **36 migration, local = remote**, kontainer `supabase_*_WorkPulse` tetap hidup |

Angka plan disesuaikan oleh P-1 (receipt Fase 0): plan menulis 35 migration dan 20 file pgTAP; 36 dan 20 adalah angka yang benar setelah merge `origin/main`. pgTAP total menjadi 1638 (baseline Fase 0: 1577).

## Production build (§1.15)

| Command | Hasil |
| --- | --- |
| `pnpm build` | exit 0 (`next build`, kompilasi produksi berhasil) |
| `next start --port 3018` lalu `GET /api/health` | **200**, header `Cache-Control: no-store`, body `{"status":"ok","service":"workpulse-web","version":"0.1.0"}`; proses dihentikan dan port tidak lagi menjawab |

Catatan: `pnpm start` adalah `next start`; port diberikan lewat argumen karena 3000 dipakai pengembangan. Build produksi yang sama sudah dipakai suite `test:e2e:release` (Fase 4).

## Worker (§1.15)

| Konfigurasi | Command | Hasil |
| --- | --- | --- |
| tanpa env worker (scanner, renderer, AI semuanya `unavailable`) | `node workers/check.ts` | exit 0, `status: ready`, 9 job terdaftar |
| sama | `node --env-file-if-exists=.env.local workers/run.ts --once` | exit 0; satu baris ringkasan, seluruh penghitung 0 |
| dependensi lokal nyata: ClamAV `127.0.0.1:13310`, Gotenberg DOCX `:13400`, Gotenberg PDF `:13401`; AI tetap `unavailable` | `node … workers/run.ts --once` | exit 0; ringkasan sama; tanpa penanda `explicit-test-fake` |
| sama | `node workers/check.ts` | exit 0 |

Keterbatasan yang dicatat: antrean stack aktif kosong saat run (`ops:check` semua 0), sehingga satu pass tidak mengklaim job dan tidak ada yang bisa gagal. Perilaku fail-closed (scanner `unavailable` tidak pernah bersih, renderer `unavailable` menggagalkan job tanpa fallback ke fake, AI `unavailable` menggagalkan job yang dapat diulang) dibuktikan oleh suite T10, T13, T15, T21 (mis. `evidence-scanner-real` › "never accepts an unavailable scanner as clean", `cv-export-renderer-real` › "never falls back to the fake renderer"), yang dijalankan ulang di Fase 8. Ringkasan worker tidak memuat key, URL, atau teks pengguna.

## Temuan

Tidak ada defect baru dan tidak ada catatan P3 baru di fase ini.

## Acceptance Fase 5

- §1.14 clean rebuild: terbukti (36 migration dari nol, pgTAP 20/1638, tipe identik, stack aktif utuh).
- §1.15 build dan worker: terbukti (build produksi, `/api/health` 200 `no-store`, `worker:check` dan `worker:once` dalam dua konfigurasi).
- Stop condition §8: tidak ada yang terpicu.

## Langkah berikutnya

Fase 6: `T25-release-runbook.md`, `T25-release-checklist.md`, dan `tests/unit/release-docs.test.ts` (gagal lebih dulu).
