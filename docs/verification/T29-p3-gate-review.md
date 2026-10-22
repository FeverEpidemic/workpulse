# T29 remediation P3: gate review

Tanggal: 22 Oktober 2026. Reviewer: Claude (Opus 5.5). Pelaksana: ChatGPT Sol 6.1 (reasoning medium). Diperiksa: branch `claude/t29-p3-remediation`, ujung `0a84bf1`, lima commit sejak baseline handoff `e58962c` (18 file, +495/−42). Verifikasi ulang di worktree bersih terpisah `D:\Project\WorkPulse-t29-rv-review` (detached `0a84bf1`, `pnpm install --frozen-lockfile`, URL Supabase dipaksa ke `http://127.0.0.1:54321` di proses test).

Acuan: [plan remediation](T29-p3-remediation-plan.md), receipt [Fase 0](T29-p3-phase0-baseline.md), [1](T29-p3-phase1-oauth-classification.md), [2](T29-p3-phase2-switched-notice.md), [3](T29-p3-phase3-preflight-docs.md), [4](T29-p3-phase4-regression.md), [gate review T29](T29-gate-review.md), [decision 0039](../decisions/0039-t29-google-oauth.md).

## Verdict

**PASS untuk cakupan lokal.** Tidak ada temuan P0, P1, atau P2. Enam P3 dicatat (R1-R6). RV1-RV4 menutup temuan gate T29 N1, N2, N3, dan N6. Pelaksana dan reviewer berbeda (ChatGPT dan Claude). Smoke staging dengan Google nyata (N5) tetap di luar remediation ini.

## Checklist plan §8

| Item | Hasil | Bukti |
| --- | --- | --- |
| Ulangi lint, typecheck, unit, `auth-google`, `auth`, integration `account-deletion` | PASS; angka cocok dengan receipt Fase 4 | tabel command di bawah |
| Diff `route.ts` hanya klasifikasi dan cabang `switched` | PASS | dua perubahan: `hasRecentOAuthProof` → `hasOAuthMethod` di baris klasifikasi, dan satu `if` baru `intentCookie && !reauth && profile.onboarding_completed_at`. Cabang `token_hash`, recovery, dan `deleting_at` tidak berubah |
| `hasRecentOAuthProof` tetap satu-satunya bukti hapus akun | PASS | `deletion-service.ts`, `recovery-session.ts`, dan test-nya identik dengan `e58962c` (`git diff --quiet`); halaman S12 tetap memakai `hasRecentOAuthProof` untuk `fresh` |
| Notice `switched` tidak membuka dialog, tidak membaca cookie, hanya email session | PASS | `page.tsx` meneruskan `"switched"` hanya untuk nilai persis itu; kartu memakai `accountEmail` dari `context.user.email`; E2E memeriksa `dialog[open]` 0 dan antrean `internal.account_deletions` 0 |
| Copy en/id dan axe | PASS | `account.delete.googleSwitched` en/id tanpa em dash, register `account.delete.*`; axe dan overflow bersih untuk en/id × 360/1440 × light/dark |

## Review focus §9

1. **RV1 melonggarkan bukti hapus akun.** Tidak. Service hapus akun tidak tersentuh; unit service yang menolak `oauth` 301 detik tetap lulus.
2. **RV1 mengenali konfirmasi email sebagai OAuth.** Tidak. Test "does not check deleting_at on an email confirmation, as before" dan empat test jalur email/recovery lain tidak diubah dan lulus. `hasOAuthMethod` hanya mencocokkan `method === "oauth"`, dan recovery sudah disingkirkan lebih dulu oleh `!isRecoverySession`.
3. **RV2 membocorkan akun lain.** Tidak. Notice tidak membaca nilai cookie atau query selain penanda `switched`, dan email yang tampil adalah email session. Query buatan pengguna lain hanya menampilkan email miliknya sendiri.
4. **RV3 menyembunyikan kegagalan.** Tidak. Preflight melempar `Error`, bukan `test.skip`. Kesalahan jaringan dan respons non-OK juga menghasilkan pesan yang sama.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| R1 | P3 | `pnpm test:e2e:auth-google` gagal 1 dari 17 test pada run pertama di worktree review (setelah `pnpm build` dan unit penuh); dua run berikutnya 17/17. Test yang gagal tidak teridentifikasi karena suite berikutnya menimpa `test-results/`. Kandidat: test `switched` yang mengubah `profiles.locale` akun fixture bersama (lihat R5), atau batas sign-in Auth lokal. Perbaikan: `outputDir` per config Playwright agar artefak tidak tertimpa, lalu ulangi suite beberapa kali untuk menemukan test yang tidak stabil. | follow-up |
| R2 | P3 | Receipt Fase 0 remediation menulis "SUPABASE_URL di .env.local menunjuk hosted". Isi `.env.local` di kedua checkout menunjuk `http://127.0.0.1:54321`, dan variabel itu tidak ada di environment User/Machine Windows; nilai hosted datang dari environment proses pelaksana, yang tidak ditimpa `process.loadEnvFile`. Run itu memakai kunci lokal, sehingga proyek hosted menolak request-nya (receipt: tidak ada fixture yang berhasil dibuat). Bahayanya sudah ada sebelumnya di semua spec: bila suatu proses punya URL dan kunci hosted, fixture admin bisa menulis ke proyek pilot. Perbaikan: helper E2E bersama yang menolak `SUPABASE_URL` selain `127.0.0.1`/`localhost` sebelum membuat client admin; test unit helper. | follow-up |
| R3 | P3 | `AGENTS.md` dan `docs/AGENTS.md` tidak identik di `main` (`0910fd8`): `docs/AGENTS.md` belum memuat T29. Berasal dari merge T28/T29, bukan dari pelaksana. Melanggar aturan "jaga kedua salinan tetap identik". Perbaikan: salin saat closeout. | tutup di closeout |
| R4 | P3 | `hasOAuthMethod` (`src/server/auth/oauth-session.ts:38`) tanpa komentar dokumentasi, padahal kontrak §3.1 plan menyertakannya dan helper di sekitarnya punya. Pembaca bisa salah memakainya sebagai bukti reautentikasi. | follow-up kecil |
| R5 | P3 | Test E2E `switched` mengubah `profiles.locale` akun fixture `delete` yang dipakai bersama ke `id`, lalu mengembalikannya ke `en` hanya di akhir. Bila test gagal di tengah, akun tetap `id` untuk test lain dalam run yang sama. Perbaikan: `try/finally` untuk pengembalian locale. | follow-up |
| R6 | P3 | Kesalahan plan (reviewer): acceptance §2 butir 3 RV2 secara langsung mengubah satu assertion lama (`/dashboard` → `?reauth=switched`), sementara stop condition §7 melarang mengubah test lama. Pelaksana berhenti dan meminta persetujuan pengguna, sehingga hanya menimbulkan interupsi. Untuk plan berikutnya, sebut assertion yang sengaja berubah. | catatan |

## Command, exit, hasil (worktree review `0a84bf1`)

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 139 file / 1354 test |
| `pnpm build` | 0 | compiled |
| `pnpm worker:check` | 0 | bersih |
| `pnpm test:e2e:auth-google` run 1 | 1 | 16 lulus / 1 gagal (R1) |
| `pnpm test:e2e:auth-google` run 2 | 0 | 17 lulus |
| `pnpm test:e2e:auth-google` run 3 | 0 | 17 lulus |
| `pnpm test:e2e:auth` | 0 | 1 lulus |
| `pnpm test:e2e:account-deletion` | 0 | 7 lulus |
| `pnpm test:integration:account-deletion` | 0 | 2 file / 15 test |
| `pnpm test:e2e:release` | 0 | 21 lulus |
| `git diff --check e58962c..HEAD` | 0 | kosong |
| `AGENTS.md` = `docs/AGENTS.md` | - | tidak identik (R3, dari `main`) |

Sebelum run: provider Google lokal `true`, image Storage `v1.80.2`, port 3000/3015/3016/3017 bebas, tidak ada proses Playwright/Next/Vitest lain.

Tidak dijalankan: `db:test`/`db:lint` (tanpa migration), `test:e2e:m5` dan `test:e2e:ui` (tidak menyentuh jalur yang berubah; `release` mencakup S12 dan S01), smoke staging (N5), NVDA, WebKit.

## Receipt

Jujur dan lengkap: setiap klaim lulus punya command, exit code, dan angka; kegagalan awal (Docker mati, URL hosted di environment proses, port 3017 dipakai T30) dicatat beserta pemulihannya; pelaksana tidak me-restart stack, tidak push, dan tidak menulis `IMPLEMENTATION_STATUS.md`. Satu atribusi penyebab tidak akurat (R2). Commit membawa trailer `Co-Authored-By: ChatGPT Sol 6.1`.

## Langkah berikutnya

Closeout remediation: entry `IMPLEMENTATION_STATUS.md`, salin `AGENTS.md` ke `docs/AGENTS.md` (R3), status plan remediation, lalu PR ke `main`. R1, R2, R4, dan R5 dapat digabung sebagai satu follow-up kecil. N5 tetap menunggu smoke staging pemilik produk.
