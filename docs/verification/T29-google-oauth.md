# T29 Masuk dengan Google: bukti

Tanggal: 22 Oktober 2026. Branch `claude/t29-google-oauth` dari `466b2f8`. Status saat dokumen ini ditulis: **acceptance lokal lulus, smoke staging belum dijalankan**. Dokumen ini tidak menandai T29 DONE; itu keputusan closeout.

[Rencana](T29-implementation-plan.md), [gate review](T29-gate-review.md), [decision 0039](../decisions/0039-t29-google-oauth.md), [runbook provider](T29-google-oauth-runbook.md). Receipt: [Fase 0](T29-phase0-baseline.md), [1](T29-phase1-config-helpers.md), [2](T29-phase2-actions.md), [3](T29-phase3-callback-deletion.md), [4](T29-phase4-ui.md), [5](T29-phase5-e2e-regression.md), [6](T29-phase6-docs.md).

## Ringkasan

Tombol **Continue with Google** di S01 (di balik flag server `WORKPULSE_AUTH_GOOGLE_ENABLED`) memulai PKCE lewat Supabase Auth, dan callback `/auth/confirm` yang ada menyelesaikannya. Pengguna baru melewati onboarding yang sama, dengan nama Google sebagai isian awal. Akun yang sedang dihapus ditolak. Akun Google saja menghapus akun di S12 dengan login Google ulang ≤ 5 menit, sedangkan akun ber-password tetap memakai password. Tanpa migration, tanpa dependency baru.

## Matriks acceptance (plan §1)

| # | Acceptance | Status | Bukti |
| --- | --- | --- | --- |
| 1 | Tombol tergantung flag | lulus lokal | unit flag dan markup; E2E `auth` (mati), `auth-google` (menyala, dua mode, bukan recovery) |
| 2 | Memulai OAuth dengan aman | lulus lokal | unit action (redirectTo persis, origin, cookie); E2E cookie return dan code verifier |
| 3 | Redirect ke Google lewat Supabase lokal | lulus lokal | E2E: `code_challenge` s256 ke Supabase, `redirect_uri` dan `state` ke Google |
| 4 | Callback mengikuti lifecycle | lulus lokal (unit) | `auth-confirm-oauth.test.ts`; login Google nyata menunggu staging 5.1-5.2 |
| 5 | Akun `deleting` ditolak di callback | lulus lokal (unit) | `auth-confirm-oauth.test.ts` |
| 6 | Batal dan gagal di provider | lulus lokal | unit dan E2E notice `oauthFailed` |
| 7 | Satu akun per email terverifikasi | **menunggu staging** | runbook 5.3 |
| 8 | Onboarding diisi awal dari Google | lulus lokal | unit helper dan markup; E2E nama terisi, profil belum tersimpan |
| 9 | Hapus akun untuk akun Google saja | lulus lokal sebagian | unit service/action/view; E2E langkah sebelum konfirmasi; jalur penuh menunggu staging 5.5 |
| 10 | Hapus akun dengan password tidak berubah | lulus lokal | integration `account-deletion` 15/15, E2E `account-deletion` 7, tanpa assertion diubah |
| 11 | Tidak ada credential di URL atau log | lulus lokal | unit URL akhir callback; grep logging 0 baris; grep secret repo bersih |
| 12 | Copy dan aksesibilitas | lulus lokal | 0 em dash; axe 360/1440 light/dark di S01 dan S12 versi Google; screenshot `T29-screenshots/` |
| 13 | Tidak ada regresi | lulus lokal | regresi Fase 5 dengan flag mati dan menyala; verifikasi ulang reviewer di worktree bersih |

## Checks terakhir

| Command | Hasil | Sumber |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm worker:check` | exit 0 | gate review (worktree bersih `363293f`) |
| `pnpm test` | 139 file / 1322 test | gate review |
| `pnpm test:e2e:auth-google` | 13 lulus | gate review |
| `pnpm test:e2e:auth` | 1 lulus | gate review |
| `pnpm test:e2e:account-deletion` | 7 lulus | gate review |
| `pnpm test:integration:account-deletion` | 15/15 | gate review |
| `pnpm test:e2e:ui`, `test:e2e:release`, `test:e2e:m5` | 1, 21, 1 (flag mati dan menyala) | receipt Fase 5 |

Tidak dijalankan: `pnpm db:test`/`db:lint` (tanpa migration; database lokal bersama gagal 3 assertion karena M5-N3), smoke staging (butuh OAuth client nyata, runbook), WebKit/Safari, NVDA manusia.

## File

- Baru: `src/server/auth/oauth-session.ts`, `playwright.auth-google.config.ts`, `tests/e2e/auth-google.spec.ts`, `tests/unit/{oauth-session,auth-google-action,auth-confirm-oauth}.test.ts`, `tests/unit/auth-google-ui.test.tsx`, `docs/decisions/0039-t29-google-oauth.md`, dokumen T29 di `docs/verification/`, `docs/verification/T29-screenshots/`.
- Berubah: `src/server/auth/{adapter,actions,recovery-session}.ts`, `src/server/supabase/config.ts`, `src/app/auth/confirm/route.ts`, `src/app/sign-in/page.tsx`, `src/app/(workspace)/settings/profile/page.tsx`, `src/features/auth/sign-in-client.tsx`, `src/features/profile/{onboarding-form,profile-workspace}.tsx`, `src/features/account/{actions,deletion-service,delete-account-card,delete-account-state}.ts(x)`, `src/domain/account/deletion.ts`, `src/i18n/messages.ts`, `src/app/globals.css`, `supabase/config.toml`, `.env.example`, `package.json`, `docs/verification/T25-release-runbook.md` (tiga baris variabel), test hapus akun dan `auth-profile.spec.ts`.

## Temuan terbuka

P3 dari gate review: N1 (klasifikasi sesi OAuth bergantung jendela waktu `amr`), N2 (memilih akun Google lain saat reautentikasi mengganti session tanpa pemberitahuan), N3 (E2E Google tidak hermetis di stack lokal bersama), N5 (smoke staging), N6-N7 (catatan receipt), N8 (nama Google tidak dipakai di onboarding lewat import). N4 tertutup oleh runbook ini.

## Draft entry `IMPLEMENTATION_STATUS.md` (untuk closeout)

> ## T29 Masuk dengan Google: acceptance lokal, 22 Oktober 2026
>
> Status T29: menunggu keputusan closeout (acceptance lokal lulus, smoke staging belum). Tombol Continue with Google di S01 di balik flag `WORKPULSE_AUTH_GOOGLE_ENABLED` (default mati), PKCE lewat Supabase Auth dan callback `/auth/confirm` yang ada, onboarding dengan nama Google sebagai isian awal, penolakan akun `deleting`, dan hapus akun untuk akun Google saja dengan login Google ≤ 5 menit.
>
> - Pelaksana Fase 0-6 dan gate review: Claude (Opus 5.5); independensi review terbatas. Gate pada `363293f`: PASS, tanpa P0-P2, P3 N1-N8.
> - Dependensi: T03, T23, T25 DONE; Gate M5 PASSED. T29 permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5.
> - Keputusan: decision 0039 (membuka batas OAuth decision 0003 untuk Google). Tanpa migration (parity 38), tanpa dependency baru.
> - Checks: lint, typecheck, build exit 0; unit 139/1322; E2E `auth-google` 13, `auth` 1, `account-deletion` 7, `ui` 1, `release` 21, `m5` 1; integration `account-deletion` 15/15.
> - Belum dijalankan: smoke staging (runbook T29), WebKit, NVDA.
> - Risiko: penautan akun dan bentuk `amr` OAuth hanya terbukti dengan Google nyata.
>
> Berikutnya: merge PR T29, jalankan runbook di staging, lalu putuskan flag untuk pilot.
