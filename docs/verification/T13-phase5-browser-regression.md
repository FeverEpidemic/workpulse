# T13 Fase 5 — Browser acceptance dan regresi penuh

- Tanggal: 27 September 2026. Basis kode: `da04e5f` ditambah dokumen dan script live (commit Fase 5).
- Environment:
  - Supabase lokal aktif, tanpa reset.
  - `SUPABASE_SECRET_KEY` diambil dari `supabase status -o env` dan hanya disimpan di env proses.
  - ClamAV nyata `clamav/clamav@sha256:0e31ce08…` sesuai runbook T10. Container dijalankan untuk sesi ini, lalu dihentikan dan dihapus setelah regresi.

## Browser acceptance baru

File baru: `tests/e2e/ai-consent.spec.ts`, `playwright.ai.config.ts` (port 3007), dan script `test:e2e:ai`.

| Skenario | Bukti |
| --- | --- |
| 1. Menolak | Status awal *Not allowed*. Enter membuka dialog dan fokus berada di *Continue manually*. Escape menutup dialog dan fokus kembali ke *Allow AI…*. *Continue manually* juga menutup dialog. DB tetap NULL/NULL |
| 2. Allow (keyboard saja) | Tab ke *Allow AI*, lalu Enter. Hasilnya *Allowed since …* dan *Consent version ai-processing-v1*, fokus pindah ke status, dan DB berisi versi serta timestamp. Status bertahan setelah reload. *Save profile* tetap berhasil setelah revisi profil naik |
| 3. Withdraw | Konfirmasi inline dengan fokus di *Keep AI allowed*. Batal mengembalikan fokus ke *Withdraw consent*. *Withdraw now* mengubah status menjadi *Not allowed* dan DB menjadi NULL. Quick log tetap tersimpan, detail activity tidak memuat klaim analisis, `analysis_state = not_requested`, dan tidak ada `ai_jobs` untuk user ini |
| 4. Konflik | Tab kedua dengan revisi lama menekan allow setelah tab pertama sudah allow. Tab kedua menampilkan pesan konflik, dialog tertutup, status tetap *Not allowed*, lalu *Reload* menampilkan *Allowed since* |
| 5. Locale id | Dialog berbahasa Indonesia dan menyebut OpenAI, bahwa file bukti tidak dikirim, serta bahwa entri manual dan CV tetap tersedia. *Lanjutkan manual* tidak mengubah DB |
| 6. Aksesibilitas dan responsif | Axe WCAG 2.2 A/AA bersih pada S12 (off/on), dialog en, dialog id, dan S12 360 dark. Tidak ada overflow horizontal pada 360×800 dan 1440×900, light dan dark (screenshot terlampir di `testInfo`) |

## Stabilitas

Run awal gagal karena beberapa hal:

- Selector toast ganda.
- `service_role` tidak memiliki SELECT pada `activities` (desain T06). Pengecekan diganti membaca lewat sesi owner.
- `signOut()` default menarik sesi global browser. Diganti `scope: "local"`.
- Overflow email di S12 (lihat receipt Fase 4).
- Race fokus, 1 kegagalan dalam 6 run. Setelah perbaikan fokus: 6/6 dan 6/6 lulus berturut-turut.

## Regresi penuh

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm test` | 0 | 51 file / 268 test |
| `pnpm db:test` | 0 | 8 file / 470 assertion |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm test:integration:ai` | 0 | 12/12 |
| `pnpm test:integration:activity` | 0 | 6/6 |
| `pnpm test:integration:achievements` | 0 | 5/5 |
| `pnpm test:integration:projects` | 0 | 7/7 |
| `pnpm test:integration:dashboard` | 0 | 4/4 |
| `pnpm test:integration:m2` | 0 | 8/8 |
| `pnpm test:integration:storage` | 0 | 1/1 |
| `pnpm test:integration:evidence` | 1, lalu 0 | Run pertama: `evidence-pipeline` gagal dengan *Local Supabase environment required*. Ini P3 N2 dari Gate M2, karena suite tersebut tidak memuat `.env.local`. Setelah URL dan publishable key dari `.env.local` dimasukkan ke env proses: 14/14 dengan ClamAV nyata |
| `pnpm test:e2e:ai` | 0 | 2/2 |
| `pnpm test:e2e:auth` | 0 | 1/1 |
| `pnpm test:e2e:ui` | 0 | 1/1 |
| `pnpm test:e2e:activity` | 0 | 1/1 |
| `pnpm test:e2e:projects` | 0 | 1/1 |
| `pnpm test:e2e:achievements` | 0 | 4/4 |
| `pnpm test:e2e:dashboard` | 0 | 1/1 |
| `pnpm test:e2e:evidence` | 0 | 8/8 (ClamAV nyata) |
| `pnpm test:e2e:m2` | 1, lalu 0 | Lihat catatan environment di bawah. Setelah perbaikan env: 1/1, termasuk S12 yang kini memuat kartu consent. Assertion env AI **tidak** diubah |
| `pnpm worker:check` | 0 | `evidence-scan, evidence-cleanup, ai-detect` |
| `pnpm build` | 0 | berhasil |
| `pnpm test:ai:live` (tanpa `WORKPULSE_AI_LIVE`) | 0 | 1 lulus, 3 di-skip sesuai desain |
| `pnpm lint` / `pnpm typecheck` / `git diff --check` | 0 / 0 / 0 | bersih |

## Catatan environment (bukan kegagalan produk)

- Harness sesi ini menyuntikkan `AI_AGENT` dan `ANTHROPIC_BASE_URL` ke env proses. Keduanya cocok dengan regex *AI-free* milik journey M2, sehingga run pertama gagal di assertion tersebut. Kedua variabel dihapus dari env proses untuk run E2E, dan assertion tetap utuh. Tidak ada variabel `WORKPULSE_AI_*` di proses web maupun E2E, karena konfigurasi AI hanya dibaca worker dari `.env.ai.local`.
- Run awal regresi E2E memakai `Select-Object -First`. Opsi itu memutus pipeline dan membunuh proses pnpm (exit -1). Semua suite lalu dijalankan ulang tanpa pemotongan; hasil di atas berasal dari run ulang tersebut.
- Warning Next.js `destination stream closed early` tetap muncul seperti pada T12 dan Gate M2, tanpa assertion yang gagal.

## Belum dijalankan

- Smoke live OpenAI (Fase 6) masih menunggu `.env.ai.local` berisi key dari pengguna beserta persetujuan panggilan.
- Staging, hosted, production, dan performa T24 berada di luar scope.
