# Handoff remediation P3 T29: eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca §7 (stop conditions) sebelum berimprovisasi.

- Tanggal: 22 Oktober 2026
- Status plan: **siap gate review**. Fase 0–4 telah dieksekusi; bukti ada pada receipt tiap fase. Verdict Claude dan pembaruan status authoritative masih menunggu reviewer.
- Dasar: [gate review T29](T29-gate-review.md) (PASS, tanpa P0-P2, P3 N1-N8), [decision 0039](../decisions/0039-t29-google-oauth.md), [plan T29](T29-implementation-plan.md), [bukti T29](T29-google-oauth.md).
- Dependensi: T29 **DONE** lokal dan sudah di `main` (PR #35, merge `0910fd8`). T28 juga sudah di `main` (PR #34).
- Branch: `claude/t29-p3-remediation` dari `origin/main` `0910fd8`, di worktree `D:\Project\WorkPulse-t29`.
- Eksekutor: ChatGPT (Sol 6.1, reasoning medium), satu agen, tanpa delegasi.
- Reviewer: **Claude**, gate review read-only setelah Fase 4. Pelaksana tidak menandai DONE dan tidak menulis bagian authoritative `docs/IMPLEMENTATION_STATUS.md`.
- antislop: mode **during** (pilihan pengguna untuk T29). RV2 menambah copy dan UI, jadi pelaksana membaca `.codex/skills/antislop/SKILL.md`, `antislop-copywriting`, `antislop-ui`, dan `antislop-human` (atau salinan `.claude/skills/` yang sama) sebelum Fase 2, dan menjalankan Delivery Gate di receipt Fase 4.

**Goal:** Menutup temuan P3 T29 yang bisa ditutup dengan kode atau dokumen: callback tidak lagi bergantung pada jendela waktu untuk mengenali login Google (N1), pengguna diberi tahu bila reautentikasi berakhir di akun Google lain (N2), suite E2E Google gagal dengan pesan yang jelas bila provider lokal mati (N3), dan receipt Fase 0 dikoreksi (N6).

**Architecture:** Tanpa migration, route API, RPC, atau dependency baru. Perubahan di `src/server/auth/oauth-session.ts` (helper baru), `src/app/auth/confirm/route.ts` (klasifikasi dan satu cabang redirect), halaman S12 dan `DeleteAccountCard` (notice), copy en/id, `tests/e2e/auth-google.spec.ts` (preflight), dan dokumen.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, Supabase JS/SSR, Vitest (unit `node`, `renderToStaticMarkup`), Playwright + axe-core, pnpm dari lockfile.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai. Lalu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md` (T29), decision 0039, gate review T29 (bagian *Temuan*), dan receipt [Fase 3](T29-phase3-callback-deletion.md) serta [Fase 5](T29-phase5-e2e-regression.md) sebagai pola.

Kutipan yang mengikat (parafrase):

- **Decision 0039 #5:** callback dengan `code`, tanpa `type`, bukan recovery, dan `amr` berisi `oauth` diperlakukan sebagai login Google. Hanya cabang ini yang menolak `deleting_at`, membaca cookie return, dan membaca cookie niat. Cabang `token_hash` dan recovery tidak boleh berubah.
- **Decision 0039 #7 dan #8:** bukti hapus akun Google tetap `amr.method = oauth` ≤ 5 menit di service. Cookie niat `wp-reauth` berisi `delete-account.<user id>`; dialog hapus hanya terbuka untuk user itu.
- **AGENTS.md:** identitas dari session server; error aman dan terlokalisasi; jangan mencatat email, token, atau URL provider ke log.

Pada akhir setiap fase, tulis receipt `docs/verification/T29-p3-phaseN-<slug>.md`: tujuan, file berubah, command beserta hasil aktual (exit code, angka pass/fail), acceptance yang terbukti, warning, blocker, langkah berikutnya. Angka harus hasil command yang benar-benar dijalankan.

## 1. Item remediation

| ID | Temuan | Tindakan |
| --- | --- | --- |
| RV1 | N1: `isOAuthSession` di `src/app/auth/confirm/route.ts:70` memakai `hasRecentOAuthProof` (jendela 300 detik, skew 60 detik). Jam server yang meleset membuat login Google tidak dikenali, sehingga cek `deleting_at` dan cookie return terlewat. | Klasifikasi memakai helper baru `hasOAuthMethod(amr)` tanpa jendela waktu. `hasRecentOAuthProof` tetap dipakai untuk bukti hapus akun. |
| RV2 | N2: bila pengguna memilih akun Google lain saat reautentikasi S12, session berganti tanpa pemberitahuan dan pengguna mendarat di dashboard akun lain. | Callback mengarahkan ke `/settings/profile?reauth=switched` bila cookie niat ada tetapi untuk user lain; S12 menampilkan notice yang menyebut email akun yang sekarang aktif dan bahwa tidak ada yang dihapus. |
| RV3 | N3: `test:e2e:auth-google` gagal dengan pesan yang membingungkan (`Unsupported provider` di halaman, atau stub tidak tampil) bila stack lokal di-restart dari checkout tanpa blok `[auth.external.google]`. | Preflight di `beforeAll` spec: baca `/auth/v1/settings`; bila `external.google` bukan `true`, gagal dengan pesan yang menyebut penyebab dan cara memperbaiki. |
| RV4 | N6: `docs/verification/T29-phase0-baseline.md:48` menulis `client_id` "kosong" saat env tidak diset; yang benar teks literal `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`. | Tambah catatan koreksi di receipt Fase 0, tanpa menghapus teks lama. |

Tidak dikerjakan, dengan alasan:

- **N4** sudah tertutup oleh runbook T29.
- **N5** (smoke staging dengan Google nyata) adalah tugas pemilik produk lewat `docs/verification/T29-google-oauth-runbook.md`. Pelaksana tidak menyentuh Google Cloud, dashboard Supabase hosted, atau server.
- **N7** hanya catatan riwayat.
- **N8** (nama Google tidak dipakai di onboarding lewat import) sesuai decision 0039 #10; mengubahnya menyentuh domain import dan butuh keputusan produk baru.

## 2. Acceptance

Remediation lulus hanya jika semua poin ini terbukti dengan hasil lokal nyata:

1. **RV1 klasifikasi tanpa jendela.** Callback `?code=…` dengan `amr` `[{ method: "oauth", timestamp: now - 400 }]` diperlakukan sebagai login Google: profil `deleting_at` ditolak ke `/sign-in?notice=accountDeleting`, dan cookie `wp-oauth-return` dipakai. Unit `hasOAuthMethod`: `oauth` dengan timestamp berapa pun → `true`; `password`, `otp`, `recovery`, array kosong, `null`, entri tanpa `method` string → `false`. Dibuktikan unit.
2. **RV1 tidak mengubah jalur lain.** Lima test "keeps the email and recovery paths" di `tests/unit/auth-confirm-oauth.test.ts` tetap lulus tanpa diubah, termasuk `amr` campuran `recovery` + `oauth` lama yang tetap ke `/update-password`. `hasRecentOAuthProof` dan test-nya tidak berubah. Dibuktikan unit.
3. **RV2 callback.** Sesi OAuth dengan cookie `wp-reauth` yang tidak kosong tetapi bukan untuk user sesi, dan profil complete, diarahkan ke `/settings/profile?reauth=switched`. Cookie milik user sendiri tetap ke `/settings/profile?reauth=delete-account`. Tanpa cookie tetap ke return path atau `/dashboard`. Profil provisional tetap ke onboarding (tanpa notice). Kedua cookie OAuth tetap dihapus. Dibuktikan unit.
4. **RV2 S12.** `/settings/profile?reauth=switched` menampilkan notice `role="status"` di kartu *Privacy and account* yang memuat email session, en dan id. Nilai `reauth` lain atau kosong tidak menampilkan notice. Notice tidak membuka dialog dan tidak mengubah data. Dibuktikan unit markup dan E2E (axe 360/1440, light/dark, tanpa overflow).
5. **RV3 preflight.** Bila `GET /auth/v1/settings` lokal tidak mengembalikan `external.google === true`, `beforeAll` suite `auth-google` melempar error yang menyebut: provider Google lokal mati, penyebab umumnya (stack di-restart dari checkout tanpa blok `[auth.external.google]`), dan cara memperbaiki (`pnpm db:stop` lalu `pnpm db:start` dari checkout yang punya blok itu; di worktree baru, salin dulu file versi image `supabase/.temp`). Saat provider aktif, suite lulus seperti sebelumnya. Dibuktikan dengan membaca kode di receipt dan run suite (aktif); jalur gagal tidak perlu dipicu dengan me-restart stack.
6. **RV4 koreksi.** Receipt Fase 0 punya catatan koreksi yang merujuk receipt Fase 5.
7. **Copy.** Key baru ada di en dan id, tanpa em dash, mengikuti nada `account.delete.*`.
8. **Tanpa regresi.** Suite di §6 lulus.

## 3. Kontrak teknis

### 3.1 RV1

```ts
// src/server/auth/oauth-session.ts
/** True when the session's `amr` records an OAuth sign-in, whatever its age. Callback classification only. */
export function hasOAuthMethod(amr: unknown): boolean;
```

- Implementasi: `Array.isArray(amr) && amr.some((entry) => entry && typeof entry === "object" && "method" in entry && entry.method === "oauth")`.
- `route.ts:70`: ganti `hasRecentOAuthProof(claimsData?.claims.amr)` dengan `hasOAuthMethod(claimsData?.claims.amr)`. Syarat lain (`!type && usableCode && !isRecoverySession && !claimsError`) tetap.
- Alasan aman: `amr` adalah milik session yang baru dibuat oleh exchange code di request ini. Konfirmasi email dan recovery tidak mencatat `oauth`, dan recovery sudah disingkirkan lebih dulu oleh `!isRecoverySession`.
- Import `hasRecentOAuthProof` di `route.ts` dihapus bila tidak dipakai lagi (lint akan memberi tahu).

### 3.2 RV2

- `route.ts`, di dalam `if (isOAuthSession)` (sekarang baris 106-110), urutan:
  1. `const intentCookie = request.cookies.get(REAUTH_INTENT_COOKIE)?.value;`
  2. `readReauthIntent(intentCookie, user.id)` dan profil complete → `/settings/profile?reauth=delete-account` (tidak berubah).
  3. Baru: `intentCookie` tidak kosong, `readReauthIntent` `null`, dan profil complete → `/settings/profile?reauth=switched`.
  4. Lainnya: lifecycle dengan return path dari cookie (tidak berubah).
- `src/app/(workspace)/settings/profile/page.tsx`: `params.reauth === "switched"` → prop baru `reauthNotice="switched"` ke `ProfileWorkspace`, diteruskan ke `DeleteAccountCard`. Hanya nilai persis itu yang dihitung.
- `src/features/account/delete-account-card.tsx`: prop opsional `reauthNotice?: "switched"`. Bila ada, render `<p role="status" className="...">` sebelum tombol pemicu, berisi `t(locale, "account.delete.googleSwitched", { email: accountEmail })`. Pakai kelas yang sudah ada (mis. pola notice `rounded-lg bg-[var(--wp-subtle)] px-4 py-3 text-sm` di `src/features/auth/sign-in-client.tsx`). Tanpa ikon, warna, atau komponen baru.
- Copy (draft; boleh diperbaiki pelaksana di bawah antislop, dengan alasan di receipt):
  - en `account.delete.googleSwitched`: "You confirmed with a different Google account, so you are now signed in as {email}. Nothing was deleted."
  - id `account.delete.googleSwitched`: "Anda mengonfirmasi dengan akun Google lain, jadi sekarang Anda masuk sebagai {email}. Tidak ada yang dihapus."

### 3.3 RV3

- `tests/e2e/auth-google.spec.ts`, `test.beforeAll` (sekarang baris 129): ubah menjadi `async`, baca `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` dari env yang sudah dimuat `config()`, `fetch(`${SUPABASE_ORIGIN}/auth/v1/settings`, { headers: { apikey } })`. Bila respons gagal atau `external?.google !== true`, `throw new Error(...)` dengan pesan §2 poin 5 dalam bahasa Inggris (pesan test di repo ini berbahasa Inggris).
- `config()` (baris 28) ikut mengembalikan publishable key; error bila kosong.

### 3.4 RV4

Tambahkan di bawah paragraf yang memuat `client_id` di `docs/verification/T29-phase0-baseline.md`:

> **Koreksi (22 Oktober 2026, remediation P3 RV4):** `client_id` tidak kosong. Saat env tidak diset, Supabase CLI meneruskan teks literal `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`. Ditemukan di Fase 5 ([receipt](T29-phase5-e2e-regression.md), *Kegagalan di tengah jalan* butir 3).

## 4. Struktur file

Berubah: `src/server/auth/oauth-session.ts`, `src/app/auth/confirm/route.ts`, `src/app/(workspace)/settings/profile/page.tsx`, `src/features/profile/profile-workspace.tsx`, `src/features/account/delete-account-card.tsx`, `src/i18n/messages.ts`, `tests/unit/oauth-session.test.ts`, `tests/unit/auth-confirm-oauth.test.ts`, `tests/unit/auth-google-ui.test.tsx`, `tests/e2e/auth-google.spec.ts`, `docs/verification/T29-phase0-baseline.md`, `docs/decisions/0039-t29-google-oauth.md` (bagian pembaruan, Fase 4).

Baru: `docs/verification/T29-p3-phase{0..4}-*.md`.

## 5. Fase eksekusi

### Fase 0: Baseline tanpa edit kode

- [x] Worktree `D:\Project\WorkPulse-t29` bersih, branch `claude/t29-p3-remediation`, HEAD turunan `0910fd8`.
- [x] Parity migration 38/38 (`pnpm exec supabase migration list --local`).
- [x] Provider Google lokal aktif: `GET http://127.0.0.1:54321/auth/v1/settings` (header `apikey` = publishable key) → `external.google` `true`. Bila `false`, ikuti §7 sebelum lanjut.
- [x] Image Storage `public.ecr.aws/supabase/storage-api:v1.80.2` (`docker inspect supabase_storage_WorkPulse --format '{{.Config.Image}}'`). Bila berbeda, ikuti §7.
- [x] `pnpm lint`, `pnpm typecheck` exit 0; `pnpm test` (catat angka file/test; ini baseline baru setelah merge T28); `pnpm test:e2e:auth-google` 13 lulus.
- [x] Verifikasi baris yang dikutip plan ini masih benar (`route.ts:70`, `:106-110`, `oauth-session.ts:39`, `page.tsx:46-60`, `delete-account-card.tsx:45-55`, spec `:28` dan `:129`, receipt Fase 0 `:48`).
- [x] Receipt `T29-p3-phase0-baseline.md`.

### Fase 1: RV1

- [x] Test gagal: `hasOAuthMethod` di `tests/unit/oauth-session.test.ts`; di `tests/unit/auth-confirm-oauth.test.ts`, kasus `amr` `oauth` berumur 400 detik untuk (a) profil `deleting_at` → `accountDeleting` dan (b) cookie return `/projects` → `/projects`.
- [x] Jalankan, lihat gagal.
- [x] Implementasi §3.1.
- [x] Jalankan dua file test itu dan `tests/unit/recovery-session.test.ts`; semua lulus, lima test jalur email/recovery tidak diubah.
- [x] Commit `fix(t29): recognise Google callbacks without a time window`.
- [x] Receipt `T29-p3-phase1-oauth-classification.md`.

### Fase 2: RV2 (antislop during)

- [x] Baca skill antislop core, copywriting, ui, human.
- [x] Test gagal: unit callback (cookie niat user lain + complete → `switched`; provisional → onboarding; tanpa cookie → `/dashboard`); unit markup `DeleteAccountCard` dengan `reauthNotice="switched"` (notice `role="status"` berisi email, en dan id) dan tanpa prop (tidak ada notice).
- [x] Implementasi §3.2 dan copy en/id.
- [x] E2E di `tests/e2e/auth-google.spec.ts`: akun Google `delete` yang sudah ada di spec, buka `/settings/profile?reauth=switched`, notice tampil dengan email akun itu, dialog tidak terbuka; `/settings/profile?reauth=other` tanpa notice; axe dan overflow di 360/1440 light/dark (pola test S12 yang ada).
- [x] Commit `feat(t29): tell the user when Google reauthentication switched accounts`.
- [x] Receipt `T29-p3-phase2-switched-notice.md`.

### Fase 3: RV3 dan RV4

- [x] Implementasi §3.3. Jalankan `pnpm test:e2e:auth-google` dengan provider aktif: semua lulus.
- [x] Catat potongan kode pesan error di receipt (jalur gagal tidak dipicu).
- [x] RV4 §3.4.
- [x] Commit `test(t29): fail the Google suite early when the local provider is off` dan `docs(t29): correct the phase 0 client_id note`.
- [x] Receipt `T29-p3-phase3-preflight-docs.md`.

### Fase 4: Regresi dan draft dokumen

- [x] Suite §6.
- [x] Kembalikan screenshot lama yang ditulis ulang suite (`git checkout -- docs/verification/T23-screenshots docs/verification/T25-screenshots docs/verification/T27-screenshots`); simpan perubahan di `docs/verification/T29-screenshots/` hanya bila memang dari test baru.
- [x] `docs/decisions/0039-t29-google-oauth.md`: tambah bagian `## Pembaruan 22 Oktober 2026 (remediation P3)` yang menyebut RV1 (klasifikasi tanpa jendela; bukti hapus akun tetap ≤ 5 menit) dan RV2 (notice `switched`), lalu ubah kalimat N1/N2 di *Batas yang diterima* menjadi "ditutup oleh remediation P3". Jangan ubah keputusan lain.
- [x] Delivery Gate antislop (core blok 1-4 + checklist copywriting dan human) di receipt.
- [x] Draft entry status untuk reviewer di receipt (bukan di `IMPLEMENTATION_STATUS.md`).
- [x] Receipt `T29-p3-phase4-regression.md`. Berhenti di sini untuk gate review Claude.

## 6. Commands

Semua ada di `package.json`:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm worker:check
pnpm test:e2e:auth-google
pnpm test:e2e:auth
pnpm test:e2e:account-deletion
pnpm test:integration:account-deletion
pnpm test:e2e:release
```

Lingkungan lokal di mesin ini (Windows, PowerShell 5.1, stack Supabase lokal dipakai bersama sesi lain):

- `.env.local` tidak memuat `SUPABASE_SECRET_KEY`. Untuk suite integration/E2E, set di environment proses: nilai `SERVICE_ROLE_KEY` dari `pnpm exec supabase status -o env` (jangan dicetak, jangan disimpan ke file). Muat juga variabel `.env.local` ke environment proses yang sama.
- Bila harness Anda menyuntikkan variabel lingkungan yang namanya mengandung `AI`, `OPENAI`, atau `ANTHROPIC`, kosongkan untuk proses test (suite `m2` menolak env AI); jangan melemahkan assertion.
- Jangan memotong output suite dengan `Select-Object -First` (membunuh proses). Tangkap dengan `Out-String`, lalu filter.
- Pengeditan file berisi karakter non-ASCII: jangan `Get-Content -Raw | Set-Content` (merusak `§`, `≤`, `→` jadi mojibake). Pakai alat edit file, atau `[IO.File]::ReadAllText/WriteAllText` dengan UTF-8 tanpa BOM.
- `test:e2e:release` dan `test:e2e:account-deletion` menulis ulang screenshot tracked; kembalikan setelah run.
- Batas Auth lokal: 30 sign-in per 5 menit per IP. Suite memakai ulang session; jangan menambah sign-in di loop.

## 7. Stop conditions

Berhenti, tulis blocker di receipt, dan minta keputusan pengguna bila:

- Worktree tidak bersih di awal fase, atau ada perubahan yang bukan milik pelaksana.
- `external.google` lokal `false`, atau image Storage bukan `v1.80.2`. Penanganan yang boleh dilakukan **hanya setelah pengguna setuju**: pastikan tidak ada proses Playwright/Next/Vitest lain yang memakai stack, lalu dari `D:\Project\WorkPulse-t29` jalankan `pnpm exec supabase stop` dan `pnpm db:start` (tanpa `db:reset`). Bila worktree tidak punya `supabase/.temp/{storage,postgres,gotrue,rest}-version` dan `storage-migration`, salin lima file itu dari `D:\Project\WorkPulse\supabase\.temp\` lebih dulu; jangan salin `project-ref` atau `linked-project.json`.
- Butuh migration, `db:reset`, perubahan perilaku callback email/recovery, perubahan bukti hapus akun (≤ 5 menit), atau perubahan jalur password T23.
- Test lama perlu diubah agar lulus, selain penambahan kasus baru.
- Ada yang meminta credential Google, akses dashboard hosted, atau deploy.
- Scope melebar ke N5, N8, provider lain, atau *Connected accounts*.

## 8. Gate review Claude (setelah Fase 4)

Read-only, di worktree bersih pada ujung Fase 4:

- [ ] Ulangi `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e:auth-google`, `pnpm test:e2e:auth`, `pnpm test:integration:account-deletion`; angka cocok dengan receipt.
- [ ] Diff `route.ts`: hanya baris klasifikasi dan cabang `switched` yang berubah; cabang `token_hash`, recovery, dan `deleting_at` tetap.
- [ ] `hasRecentOAuthProof` masih satu-satunya bukti di `deletion-service.ts` dan halaman S12.
- [ ] Notice `switched` tidak membuka dialog, tidak membaca cookie, hanya menampilkan email session.
- [ ] Copy en/id dan axe.

P0-P2 memblokir. P3 dicatat.

## 9. Review focus

1. **RV1 melonggarkan bukti hapus akun.** Dijaga: unit service hapus akun yang ada tidak berubah dan tetap menolak `oauth` 301 detik.
2. **RV1 salah mengenali konfirmasi email sebagai OAuth.** Dijaga: test "does not check deleting_at on an email confirmation, as before" tetap lulus tanpa diubah.
3. **RV2 bocor informasi akun lain.** Notice hanya memakai email session saat ini, bukan nilai cookie; unit callback memeriksa redirect target, unit markup memeriksa email yang tampil.
4. **RV3 menyembunyikan kegagalan.** Preflight melempar error, bukan `test.skip`.
