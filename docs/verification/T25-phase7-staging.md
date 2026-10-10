# T25 Fase 7 — Verifikasi staging

- Tanggal: 10 Oktober 2026
- Status: **BLOCKED**. Tidak ada satu langkah staging yang dijalankan.
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)

## Alasan

Plan §2.4.1 dan §5 Fase 7 mensyaratkan dua hal sebelum pelaksana menyentuh lingkungan hosted, dan keduanya belum terpenuhi:

1. **Environment staging belum disediakan.** Tidak ada proyek Supabase hosted, host web, atau host worker yang disebut pengguna sejak persetujuan 10 Oktober 2026.
2. **Tidak ada otorisasi tertulis di chat** untuk men-deploy atau memakai key di lingkungan tertentu (plan §2.2.11, §8). Pelaksana tidak membuat akun cloud, tidak meminta key ditempel di chat, dan tidak men-deploy tanpa itu.

Menurut plan, T25 dengan Fase 7 BLOCKED direkomendasikan berstatus **PARTIAL**, dan Gate M5 tidak dapat PASSED.

## Yang dibutuhkan agar Fase 7 dapat dijalankan

| Kebutuhan | Rincian |
| --- | --- |
| Proyek Supabase hosted | nama penyedia, region, dan paket (untuk bagian retensi backup); proyek khusus staging, **bukan** proyek yang berisi data pengguna nyata |
| Host web | menjalankan `pnpm start` dari build lockfile; domain atau URL staging untuk `WORKPULSE_SITE_URL` (https) |
| Host worker | menjalankan `pnpm worker:run` dan cron `pnpm ops:check`; jaringan privat ke ClamAV dan dua Gotenberg |
| ClamAV, Gotenberg DOCX, Gotenberg PDF | kontainer sesuai runbook T10, T15, T21 di jaringan privat host worker |
| SMTP untuk Auth | penyedia email nyata agar signup, verifikasi, dan recovery terkirim ke kotak masuk sungguhan |
| Penyediaan secret | key diberikan ke host lewat env proses atau secret manager; **tidak** ditempel di chat atau repo |
| Otorisasi tertulis | satu pesan chat yang menyebut lingkungan itu dan mengizinkan migrate, deploy, dan pembuatan akun uji |
| Keputusan AI | apakah pemakaian key AI di staging diizinkan; bila tidak, mode `unavailable` dan jalur manual saja |

## Yang akan dijalankan begitu semuanya ada

1. Catat penyedia, region, paket, dan versi build (tanpa key dan tanpa URL internal sensitif).
2. `supabase db push` ke staging; `migration list` harus 36/36, terakhir `20261012090000`.
3. Deploy worker lalu web sesuai [runbook](T25-release-runbook.md); `/api/health` 200; `pnpm worker:check` dengan adapter nyata.
4. Smoke dengan akun uji yang dibuat untuk T25 (bukan akun pribadi):
   - signup dan verifikasi email nyata, recovery, sign-out;
   - capture activity, confirm achievement, upload evidence dengan pemindai nyata sampai `ready`;
   - export CV dengan renderer nyata, unduh PDF, ekstraksi teks cocok;
   - AI hanya bila diizinkan;
   - penghapusan akun sampai `completed`, `pnpm ops:check` exit 0;
   - p95 baca dan simpan dengan `WORKPULSE_PERF_OUT` ke file staging terpisah, bila dataset staging boleh di-seed.
5. Retensi backup mengikuti [T23 §3](T23-retention-runbook.md): paket, retensi, tautan dokumentasi resmi, tanggal akses, pemeriksa.
6. Bersihkan akun uji lewat jalur penghapusan; catat nol sisa.

## Dampak pada acceptance

| Acceptance (§1) | Status |
| --- | --- |
| §1.17 backup dan restore jujur | klaim retensi ≤ 30 hari **tetap belum terverifikasi**; checklist menahan production (BLOCKER) |
| §1.18 staging | **tidak terpenuhi** (BLOCKED) |
| Rencana T25, kalimat selesai | "integrasi nyata diverifikasi di staging" belum terpenuhi |

## Langkah berikutnya

Fase 8: regresi penuh di stack lokal dan hygiene diff, lalu serahkan ke reviewer.
