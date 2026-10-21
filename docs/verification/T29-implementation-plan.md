# Handoff T29 Masuk dengan Google (OAuth): eksekusi single-agent

> **Untuk agen pelaksana:** kerjakan fase secara berurutan dan centang checkbox (`- [ ]`) yang selesai. Gunakan TDD: tulis test yang gagal, jalankan dan lihat gagal, buat implementasi minimal, jalankan ulang sampai lulus, lalu commit. Jangan membuat sub-agent. Jangan melompati fase. Bila ragu, baca Â§8 (stop conditions) sebelum berimprovisasi.

- Tanggal: 21 Oktober 2026
- Status plan: **siap dieksekusi**. Pengguna menyetujui Â§2.2 butir 6, 7, dan 9 pada 21 Oktober 2026: "Setuju dengan Â§2.2 butir 6, 7, dan 9 seperti di plan T29." Belum ada kode yang diubah.
- Dependensi: T03 (auth, callback `/auth/confirm`) **DONE**, T23 (hapus akun dengan reautentikasi) **DONE**, T25 **DONE**, Gate M5 **PASSED** dengan pengecualian (`466b2f8`).
- Asal task: penambahan scope oleh pengguna pada 21 Oktober 2026. T29 **tidak ada** di `IMPLEMENTATION_PLAN.md` Â§5. Decision 0003 *Scope boundary* menyatakan T03 tidak menambah OAuth; T29 membuka batas itu untuk satu provider, Google.
- Branch: `claude/t29-google-oauth` dari `origin/main` (`466b2f8`).
- Eksekutor: satu agent **Claude**. Semua fase dikerjakan berurutan tanpa delegasi.
- Reviewer: **Claude** (Opus). Gate review read-only wajib setelah Fase 5; Fase 6 (draft dokumen) dikerjakan setelah gate.
- antislop: mode belum dipilih untuk T29. Sebelum Fase 4 (UI), pelaksana mengikuti CLAUDE.md: tanyakan mode bila belum ada instruksi sesi atau preferensi global, lalu baca `.claude/skills/antislop/SKILL.md`, `antislop-ui`, `antislop-copywriting`, dan `antislop-human`.
- Acuan:
  - PRD R01; User Flow F01 (daftar, masuk, onboarding); Wireframe S01 (sign-in) dan S12 (*Privacy and account*).
  - `AGENTS.md` *Ownership, transaksi, dan revisi* (identitas dari session server) dan *Files, import, dan cleanup* (account deletion mencabut session).
  - `docs/decisions/0003-auth-session.md` (#2 lifecycle, #3 redirect tepercaya, #5 bukti recovery), `0029-t23-account-deletion-retention.md`, `0036-shared-staging-pilot-project.md`.

**Goal:** Pengguna dapat masuk atau mendaftar di S01 dengan tombol **Lanjutkan dengan Google**. Pengguna baru dari Google melewati onboarding yang sama (hanya display name wajib, diisi awal dari nama Google tetapi tetap disimpan oleh pengguna). Pengguna yang sudah punya akun email/password dengan email Google yang sama masuk ke akun yang sama. Akun yang sedang dihapus ditolak. Pengguna yang hanya punya identitas Google tetap dapat menghapus akun di S12 dengan reautentikasi Google yang baru (â‰¤ 5 menit), bukan password. Tombol hanya tampil bila flag server menyala, sehingga provider dapat disiapkan di proyek hosted tanpa langsung terlihat oleh pengguna pilot.

**Architecture:** Tanpa migration: trigger `internal.handle_auth_user_created` (`supabase/migrations/20260916090000_foundation_schema.sql:415-432`) sudah membuat profil provisional untuk setiap baris `auth.users`, termasuk dari OAuth. Alur memakai PKCE Supabase SSR: Server Action memanggil `signInWithOAuth` lewat `AuthAdapter` dengan `redirectTo` = `getAuthCallbackUrl()` (`src/server/supabase/config.ts:82-84`), lalu `redirect()` ke URL provider. Callback memakai route yang sudah ada `/auth/confirm`, yang sudah menukar `code` (`src/app/auth/confirm/route.ts:36-40`). Return path dan niat reautentikasi dibawa lewat cookie HttpOnly berumur pendek, bukan query string di `redirectTo`, karena `additional_redirect_urls` adalah daftar URL persis (`supabase/config.toml:164-168`). Bukti reautentikasi Google memakai klaim JWT `amr` (`method = oauth`) dengan pola yang sama seperti bukti recovery (`src/server/auth/recovery-session.ts:4-16`).

**Tech stack:** Next.js 16 App Router, React 19, TypeScript 6 strict, `@supabase/ssr` dan `@supabase/supabase-js` yang sudah ada, Zod 4, Vitest, Playwright + axe-core, pnpm dari lockfile. **Tidak ada dependency baru**, tidak ada SDK Google di browser.

---

## 0. Cara memakai handoff ini

Baca dokumen ini sampai selesai sebelum mengubah kode. Setelah itu baca `AGENTS.md`, entry teratas `docs/IMPLEMENTATION_STATUS.md`, decision 0003, 0029, dan 0036, `Design.md` (tombol, state, aksesibilitas), lalu `docs/verification/T23-implementation-plan.md` sebagai pola format dan sumber kontrak reautentikasi. Bila perlu memastikan isi PRD R01, F01, S01, atau S12, ekstrak DOCX dengan alat ekstraksi; jangan menebak isinya.

Kutipan sumber yang mengikat (parafrase ringkas):

- **AGENTS.md:** identitas pengguna diambil dari session server. Error aman, terlokalisasi, tidak membocorkan keberadaan akun lain. Jangan mencatat secret ke log.
- **Decision 0003 #2:** lifecycle profil menentukan tujuan setelah autentikasi: provisional ke onboarding, complete ke tujuan internal yang di-allowlist. Return path menolak URL absolut, protocol-relative, callback, dan route tak dikenal.
- **Decision 0003 #3:** redirect Auth memakai `WORKPULSE_SITE_URL`, tidak pernah dari header `Host`. Callback menukar token/code lalu redirect tanpa menyisakan credential di URL.
- **Decision 0003 #4:** onboarding hanya mewajibkan display name. T29 tidak menambah field wajib.
- **Decision 0029 (T23):** hapus akun butuh reautentikasi dan konfirmasi email; kegagalan sebelum `begin_account_deletion` tidak mengubah apa pun. Akun `deleting` ditolak saat masuk (`src/server/auth/actions.ts:70-74`).
- **Decision 0036:** proyek Supabase hosted dipakai bersama staging dan pilot. Setiap perubahan konfigurasi Auth hosted langsung mengenai pengguna pilot.

Pertahankan perubahan lokal pengguna. Checkout utama `D:\Project\WorkPulse` sedang berisi pekerjaan T28; kerjakan T29 di worktree `D:\Project\WorkPulse-t29`. Jangan menandai T29 DONE dan jangan menulis bagian authoritative `IMPLEMENTATION_STATUS.md`. Pada akhir setiap fase, tulis **receipt** di `docs/verification/T29-phaseN-<slug>.md` berisi: tujuan, file berubah, command beserta hasil aktual (exit code dan angka pass/fail), acceptance yang terbukti, warning/kegagalan, blocker, dan langkah berikutnya. Angka yang ditulis harus hasil command yang benar-benar dijalankan.

## 1. Acceptance inti T29

T29 lulus hanya jika setiap poin berikut dibuktikan dengan hasil nyata:

1. **Tombol tergantung flag.** Dengan `WORKPULSE_AUTH_GOOGLE_ENABLED` tidak diset atau bukan `true`, S01 tidak merender tombol Google dan action menolak dengan `UNAVAILABLE`. Dengan flag `true`, tombol tampil di mode *Sign in* dan *Create account*, tidak di mode recovery. Dibuktikan unit (markup) dan E2E.
2. **Memulai OAuth dengan aman.** Action memanggil `signInWithOAuth({ provider: "google" })` dengan `redirectTo` persis `getAuthCallbackUrl()`, `skipBrowserRedirect: true`, dan scope default (tanpa scope tambahan). Action me-`redirect()` hanya ke URL yang origin-nya sama dengan `NEXT_PUBLIC_SUPABASE_URL`. Return path disimpan di cookie `wp-oauth-return` (HttpOnly, SameSite=Lax, path `/`, maxAge 600, `secure` di production) setelah `sanitizeReturnTo`. Dibuktikan unit dengan adapter palsu.
3. **Redirect ke Google lewat Supabase lokal.** Klik tombol di S01 berakhir di `/auth/v1/authorize?provider=google` milik Supabase lokal, yang meneruskan ke `accounts.google.com` dengan `redirect_uri` = callback Supabase dan `code_challenge` ada. Request ke Google dicegat Playwright, tidak dimuat. Dibuktikan E2E.
4. **Callback OAuth mengikuti lifecycle.** `/auth/confirm?code=â€¦` tanpa `type` dari OAuth: pengguna baru (profil provisional) ke onboarding, pengguna lama (complete) ke return path dari cookie atau `/dashboard`. Cookie `wp-oauth-return` dihapus pada setiap hasil callback. Return path tetap disanitasi ulang saat dibaca. Dibuktikan unit route handler.
5. **Akun `deleting` ditolak di callback.** Callback OAuth untuk profil dengan `deleting_at` terisi melakukan sign-out lokal, menghapus cookie auth, dan redirect ke `/sign-in?notice=accountDeleting`. Perilaku callback verifikasi email dan recovery tidak berubah. Dibuktikan unit.
6. **Batal dan gagal di provider.** Callback dengan `error` (mis. `access_denied`) dan tanpa `code` redirect ke `/sign-in?notice=oauthFailed` dengan pesan netral en/id, bukan `verificationFailed`. `error_description` tidak ditampilkan dan tidak dicatat. Dibuktikan unit.
7. **Satu akun per email terverifikasi.** Pengguna email/password yang sudah terverifikasi lalu masuk dengan Google ber-email sama berakhir di `user.id` yang sama, dengan dua identitas (`email`, `google`). Dibuktikan integration terhadap Auth lokal **atau** dicatat sebagai bukti staging bila Auth lokal tidak bisa mensimulasikan provider (Â§2.2 butir 6, Â§8).
8. **Onboarding diisi awal dari Google.** Untuk pengguna provisional dengan `user_metadata.full_name` (atau `name`), field display name di onboarding terisi awal (trim, dipotong ke batas field), tetapi profil tetap provisional sampai pengguna menekan simpan. Nilai kosong, hanya spasi, atau bukan string tidak mengisi apa pun. Dibuktikan unit.
9. **Hapus akun untuk pengguna Google saja.** Untuk akun tanpa identitas `email`, kartu hapus S12 tidak menampilkan field password. Tombol **Konfirmasi dengan Google** memulai OAuth dengan cookie niat `wp-reauth=delete-account`; callback mengembalikan ke S12 dengan dialog hapus terbuka. Server menerima penghapusan hanya bila `amr` berisi `oauth` dengan timestamp â‰¤ 5 menit, identitas `google` ada, dan konfirmasi email cocok. Tanpa bukti segar: `REAUTH_REQUIRED`, tidak ada `begin_account_deletion`. Dibuktikan unit service dan unit klaim.
10. **Hapus akun dengan password tidak berubah.** Akun yang punya identitas `email` (termasuk yang juga punya `google`) tetap memakai jalur password T23. Suite `account-deletion` integration dan E2E tetap lulus tanpa perubahan assertion. Dibuktikan regresi.
11. **Tidak ada credential di URL atau log.** Setelah callback, URL akhir tidak berisi `code`, `state`, `error_description`, atau token. Tidak ada `console`/logger yang menulis URL provider, code, atau email. Dibuktikan unit (redirect target) dan grep di receipt Fase 5.
12. **Copy dan aksesibilitas.** Key baru ada di en dan id, tanpa em dash. Tombol Google memakai varian `secondary` yang ada, label teks lengkap, fokus terlihat, tanpa logo merek dari luar repo (Â§2.2 butir 8). Pemisah "atau" bukan satu-satunya penanda. Axe tanpa pelanggaran WCAG 2.2 AA pada S01 (dua mode) dan dialog hapus S12 versi Google, di 360 px dan 1440 px, light dan dark, tanpa overflow horizontal. Dibuktikan E2E.
13. **Tidak ada regresi.** `test:e2e:auth`, `test:e2e:ui`, `release`, `m5`, dan integration `account-deletion` tetap lulus dengan flag mati maupun menyala. Dibuktikan suite regresi Â§7.

## 2. Scope dan keputusan yang dibekukan

### 2.1 Dalam scope

- `src/server/auth/adapter.ts`: `signInWithGoogle(redirectTo)` dan `getUser()` yang ikut mengembalikan daftar provider identitas dan metadata nama.
- `src/server/auth/actions.ts`: `signInWithGoogleAction` (S01) dan `startGoogleReauthAction` (S12).
- `src/server/auth/oauth-session.ts` (baru): nama/opsi cookie, `hasRecentOAuthProof`, pembaca nama Google.
- `src/server/auth/recovery-session.ts`: ekspor helper `hasRecentMethod` atau pindahkan ke modul bersama, tanpa mengubah perilaku dua fungsi yang ada.
- `src/app/auth/confirm/route.ts`: cabang OAuth (cookie return, cookie niat, cek `deleting_at`, parameter `error`).
- `src/server/supabase/config.ts`: `isGoogleAuthEnabled()` membaca `WORKPULSE_AUTH_GOOGLE_ENABLED`.
- `src/app/sign-in/page.tsx`, `src/features/auth/sign-in-client.tsx`: tombol dan notice `oauthFailed`.
- Onboarding: `src/features/profile/onboarding-form.tsx` dan page pemanggilnya untuk nilai awal display name.
- `src/features/account/{deletion-service.ts,actions.ts,delete-account-card.tsx,delete-account-state.ts}` dan `src/features/profile/profile-workspace.tsx`: jalur reautentikasi Google.
- `src/i18n/messages.ts`: key baru en/id.
- `supabase/config.toml`: blok `[auth.external.google]` dengan nilai dari env.
- `.env.example`: nama variabel baru dengan placeholder.
- Test unit/integration/E2E, receipt, draft decision, runbook provider.

### 2.2 Keputusan implementasi

1. **Satu provider: Google.** Tidak ada abstraksi multi-provider, tidak ada GitHub/Apple/magic link. `enable_manual_linking` tetap `false`.
2. **Flag server `WORKPULSE_AUTH_GOOGLE_ENABLED`.** Hanya nilai string `true` yang menyalakan. Default mati di semua lingkungan. Alasan: proyek hosted dipakai bersama pilot (decision 0036); provider dapat dikonfigurasi dan diuji smoke sebelum tombol terlihat. Flag dibaca di server dan diteruskan ke `SignInClient` sebagai prop, seperti `configured`.
3. **PKCE lewat Server Action.** `signInWithOAuth` dipanggil pada client SSR cookie-bound (`createSupabaseServerClient`), sehingga code verifier tersimpan di cookie oleh `@supabase/ssr`. Action memakai `skipBrowserRedirect: true` lalu `redirect(data.url)`. Validasi origin `data.url` terhadap URL Supabase publik sebelum redirect.
4. **Return path dan niat lewat cookie, bukan query.** `redirectTo` selalu persis `/auth/confirm` agar cocok dengan allowlist URL persis di Supabase lokal dan hosted. Cookie `wp-oauth-return` (return path tersanitasi) dan `wp-reauth` (hanya nilai `delete-account`) berumur 10 menit, HttpOnly, SameSite=Lax (callback datang dari navigasi lintas situs, sama dengan alasan `wp-recovery-flow`, `route.ts:63-64`). Callback menghapus keduanya di setiap cabang.
5. **Pembeda callback.** Callback dengan `code` tanpa `type` dan tanpa klaim recovery diperlakukan sebagai OAuth bila `amr` berisi `oauth`. Urutan cek di route: parameter `error` â†’ tukar code â†’ user â†’ klaim â†’ recovery (perilaku lama) â†’ profil `deleting_at` (hanya cabang OAuth) â†’ niat reauth â†’ lifecycle. Cabang `token_hash` tidak diubah.
6. **Penautan akun mengikuti automatic linking Supabase.** Email Google yang terverifikasi dan sama dengan akun yang ada ditautkan ke `user.id` yang sama. WorkPulse tidak menulis kode penautan sendiri. Bila Fase 0 menemukan Supabase membuat akun kedua atau menolak masuk untuk kasus akun email yang **belum** terverifikasi, catat perilaku nyata di receipt dan berhenti untuk keputusan pengguna (Â§8). Disetujui pengguna 21 Oktober 2026.
7. **Reautentikasi hapus akun untuk pengguna Google saja: masuk ulang dengan Google.** Bukti = `amr.method = oauth` dengan umur â‰¤ 300 detik (toleransi skew 60 detik seperti recovery). Akun dengan identitas `email` tetap memakai password. Alternatif yang ditolak: kode OTP email (butuh perubahan template dan SMTP untuk satu alur) dan "tanpa reautentikasi" (melemahkan T23). Risiko yang diterima: Google dapat memakai session Google yang sedang aktif di browser tanpa meminta password lagi; parameter `prompt=select_account` dikirim agar pengguna setidaknya memilih akun secara sadar. Disetujui pengguna 21 Oktober 2026.
8. **Tampilan tombol.** Teks *Lanjutkan dengan Google* / *Continue with Google*, varian tombol `secondary` yang ada, ikon tidak wajib. Bila ikon dipakai, gunakan SVG logo "G" resmi sesuai pedoman branding Google, disimpan di repo (bukan dari CDN). lucide-react tidak punya logo merek; ini satu-satunya pengecualian keluarga ikon dan harus dicatat di decision. Letak: di atas form email, dipisah garis dengan teks "atau".
9. **Nama Google hanya mengisi awal.** Nilai awal display name onboarding dari `user_metadata.full_name`, lalu `name`. Tidak ada penyimpanan otomatis, tidak ada pengisian ke profil yang sudah complete, tidak ada foto profil. Disetujui pengguna 21 Oktober 2026.
10. **Recovery tetap tersedia.** Pengguna Google saja yang meminta recovery dapat membuat password lewat alur T03; ini perilaku Supabase dan tidak diblokir. Setelah itu akun punya identitas `email` dan hapus akun memakai password.
11. **Tanpa migration, tanpa event produk baru.** Parity migration tetap 38. `internal.product_events` tidak mencatat metode masuk.

### 2.3 Di luar scope

- Provider lain, magic link, MFA, One Tap, `signInWithIdToken`.
- Halaman *Connected accounts* (tautkan/lepas identitas) di S12.
- Foto profil dari Google (follow-up foto profil T27).
- Konfigurasi provider di proyek hosted dan Google Cloud Console: dikerjakan pemilik produk mengikuti runbook Fase 6, bukan pelaksana. Credential tidak pernah ditempel di chat.
- Verifikasi brand OAuth consent screen Google dan URL kebijakan privasi: item checklist production T25.

## 3. Kontrak teknis

### 3.1 Konfigurasi

`supabase/config.toml` (lokal):

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false
```

Perubahan `config.toml` butuh restart stack Supabase (`supabase stop` lalu `pnpm db:start`), **bukan** `db:reset`; volume dipertahankan. Untuk E2E lokal tanpa Google nyata, pelaksana mengisi kedua env dengan placeholder non-rahasia di shell sesi test. Bila CLI menolak start dengan nilai kosong atau placeholder, catat pesan error di receipt Fase 0 dan ikuti Â§8.

`.env.example` (baru, hanya nama dan placeholder):

```text
WORKPULSE_AUTH_GOOGLE_ENABLED=false
# Dibaca Supabase CLI saat db:start. Jangan commit nilai asli.
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
```

### 3.2 Server

```ts
// src/server/auth/adapter.ts
signInWithGoogle(input: { redirectTo: string; selectAccount: boolean }):
  Promise<{ url: string | null; error: AuthError | null }>;
getUser(): Promise<{ user: { id: string; email: string | undefined; providers: string[]; fullName: string | null } | null; error: AuthError | null }>;

// src/server/auth/oauth-session.ts
export const OAUTH_RETURN_COOKIE = "wp-oauth-return";
export const REAUTH_INTENT_COOKIE = "wp-reauth";
export function hasRecentOAuthProof(amr: unknown, nowSeconds?: number): boolean; // window 300 s, skew 60 s
export function googleDisplayNameSuggestion(metadata: unknown, maxLength: number): string | null;
```

- `providers` dibaca dari `user.identities[].provider`; bila kosong, fallback ke `app_metadata.providers`. Fase 0 memastikan field mana yang terisi pada Supabase lokal.
- `signInWithGoogleAction(_prev, formData)`: flag mati â†’ `UNAVAILABLE`. Error adapter â†’ `authFailureState`. URL kosong atau origin salah â†’ `UNAVAILABLE`. Sukses â†’ set cookie return â†’ `redirect(url)`.
- `startGoogleReauthAction(_prev, _formData)`: butuh user session dengan provider `google`; set cookie niat; `selectAccount: true`.
- `deletion-service.ts`: input menjadi union `{ method: "password", password, confirmation } | { method: "google", confirmation }`. Metode `google` ditolak bila akun punya identitas `email` (`VALIDATION`), atau bila `hasRecentOAuthProof` gagal (`REAUTH_REQUIRED`, key baru). Klaim dibaca lewat dependensi yang dapat diganti di test, bukan langsung `client.auth.getClaims()` di service.

### 3.3 Callback `/auth/confirm`

| Kondisi | Hasil |
| --- | --- |
| `error` ada, tanpa `code` | `/sign-in?notice=oauthFailed` |
| tukar code gagal | `/sign-in?notice=verificationFailed` (perilaku lama) |
| recovery (logika lama) | `/update-password` + cookie recovery (tidak berubah) |
| OAuth, profil `deleting_at` | sign-out lokal, hapus cookie auth, `/sign-in?notice=accountDeleting` |
| OAuth, cookie `wp-reauth=delete-account`, profil complete | `/settings/profile?reauth=delete-account` |
| OAuth, lain | lifecycle (`destinationForLifecycle`) dengan return path dari cookie |

Pelaksana memastikan route S12 dan nama notice yang benar di Fase 0 (`src/app/sign-in/page.tsx:11` untuk peta notice, route S12 dari `src/app/(workspace)/settings/profile/page.tsx`). Query `reauth` di S12 hanya membuka dialog; tidak memberi hak apa pun.

### 3.4 UI

- S01: tombol Google di mode *Sign in* dan *Create account*, berupa `<form action={signInWithGoogle}>` dengan `returnTo` tersembunyi dan `SubmitButton` (state pending bawaan). Error action tampil lewat `ActionFeedback`.
- S12: `DeleteAccountCard` menerima `reauthMethod: "password" | "google"` dan `reauthFresh: boolean`. Mode `google` tanpa bukti segar menampilkan penjelasan dan tombol *Konfirmasi dengan Google*; dengan bukti segar menampilkan field konfirmasi email dan tombol hapus. Fokus saat dialog terbuka: field pertama yang ada (password atau konfirmasi), atau tombol Google.
- Onboarding: prop `initialDisplayName` ke form; draft `sessionStorage` yang sudah ada menang atas nilai awal.

## 4. Struktur file

Baru:

- `src/server/auth/oauth-session.ts`
- `tests/unit/oauth-session.test.ts`
- `tests/unit/auth-google-action.test.ts`
- `tests/unit/auth-confirm-oauth.test.ts`
- `tests/e2e/auth-google.spec.ts` (masuk `playwright.auth.config.ts`)
- `docs/verification/T29-google-oauth-runbook.md`
- `docs/verification/T29-phase{0..6}-*.md`, `docs/verification/T29-google-oauth.md`
- `docs/decisions/0038-t29-google-oauth.md` (nomor berikutnya yang kosong di `main` saat merge; T28 juga menulis draft decision)

Berubah: file di Â§2.1, `tests/unit/account-reauthenticate.test.ts` atau test service hapus akun yang ada, `tests/unit/auth-routing.test.ts` bila peta notice diuji di sana.

## 5. Fase eksekusi

### Fase 0: Baseline tanpa edit kode

- [ ] `git status` bersih di worktree, branch `claude/t29-google-oauth`, HEAD turunan `466b2f8`.
- [ ] Parity migration 38/38 (`supabase migration list --local`).
- [ ] Baseline: `pnpm lint`, `pnpm typecheck` exit 0; `pnpm test` harapan 135 file / 1262 test (angka setelah merge T27 di entry M5); `pnpm test:e2e:auth` dan `pnpm test:e2e:ui` masing-masing 1. Catat angka nyata. `pnpm db:test` di database lokal bersama boleh gagal 3 assertion karena M5-N3; catat, jangan perbaiki di T29.
- [ ] Verifikasi file:baris yang dikutip plan ini masih benar: `adapter.ts`, `actions.ts:70-74`, `route.ts:36-40` dan `63-64`, `recovery-session.ts:4-16`, `config.ts:82-84`, `config.toml:164-168` dan blok `[auth.external.apple]`, trigger profil `:415-432`, `deletion-service.ts:86-95`, peta notice `sign-in/page.tsx:11`.
- [ ] Spike tanpa commit: tambahkan blok Google ke `config.toml` dengan placeholder env, restart stack, panggil `GET /auth/v1/authorize?provider=google&redirect_to=<callback>` dengan `curl -I`, catat status dan host `Location`. Catat bentuk `amr` dan `identities` dari satu user lokal. Kembalikan `config.toml` bila spike tidak dilanjutkan di Fase 1.
- [ ] Receipt `T29-phase0-baseline.md`.

### Fase 1: Konfigurasi dan helper murni

- [ ] Test gagal `oauth-session.test.ts`: `hasRecentOAuthProof` (segar, 301 detik, skew, method lain, bentuk rusak), `googleDisplayNameSuggestion` (full_name, fallback name, spasi, non-string, pemotongan), sanitasi cookie return.
- [ ] Implementasi `oauth-session.ts`; refactor kecil `recovery-session.ts` dengan test lama tetap lulus.
- [ ] `isGoogleAuthEnabled()` + test.
- [ ] Commit blok `config.toml` dan `.env.example`.
- [ ] Receipt `T29-phase1-config-helpers.md`.

### Fase 2: Adapter dan action

- [ ] Test gagal `auth-google-action.test.ts`: flag mati, `redirectTo` persis, origin URL salah ditolak, cookie return di-set dengan atribut Â§2.2 butir 4, error adapter dipetakan, `startGoogleReauthAction` hanya untuk akun dengan provider `google`.
- [ ] Implementasi adapter dan dua action.
- [ ] Receipt `T29-phase2-actions.md`.

### Fase 3: Callback dan hapus akun

- [ ] Test gagal `auth-confirm-oauth.test.ts` untuk setiap baris tabel Â§3.3, termasuk cookie dihapus dan URL akhir tanpa parameter sensitif. Test callback email dan recovery yang ada tetap lulus.
- [ ] Implementasi cabang callback.
- [ ] Test gagal service hapus akun: metode `google` dengan bukti segar dan konfirmasi cocok memanggil `begin_account_deletion`; tanpa bukti segar `REAUTH_REQUIRED` dan RPC tidak dipanggil; metode `google` untuk akun ber-identitas `email` ditolak; metode `password` tidak berubah.
- [ ] Implementasi service dan action.
- [ ] `pnpm test:integration:account-deletion` lulus tanpa perubahan assertion.
- [ ] Receipt `T29-phase3-callback-deletion.md`.

### Fase 4: UI (setelah mode antislop ditentukan)

- [ ] Test markup gagal: tombol hanya saat flag menyala, di dua mode; notice `oauthFailed`; kartu hapus mode `google` (tanpa field password, dua state); nilai awal onboarding dan prioritas draft.
- [ ] Implementasi S01, onboarding, S12; key en/id.
- [ ] Receipt `T29-phase4-ui.md` dengan Delivery Gate antislop.

### Fase 5: E2E dan regresi penuh

- [ ] `tests/e2e/auth-google.spec.ts`: flag mati tanpa tombol; flag menyala, klik tombol, cegat request ke `accounts.google.com`, assert `redirect_uri` dan `code_challenge`; callback `?error=access_denied` menampilkan notice; axe S01 dua mode dan dialog hapus versi Google (state dibuat dengan fixture Â§6) di 360/1440, light/dark.
- [ ] Bila Auth lokal tidak dapat menyelesaikan login Google, acceptance 7 dan jalur penuh acceptance 9 ditandai **menunggu smoke staging** di receipt, bukan lulus.
- [ ] Regresi Â§7 dengan flag mati, lalu `test:e2e:auth`, `release`, `m5` sekali lagi dengan flag menyala.
- [ ] `rg -n "console\.|logger" src/server/auth src/app/auth` dan pastikan tidak ada URL/code/email yang dicatat.
- [ ] Receipt `T29-phase5-e2e-regression.md`. **Gate review Claude dijalankan di sini.**

### Fase 6: Draft dokumen (setelah gate)

- [ ] `docs/decisions/0038-t29-google-oauth.md`: Â§2.2 beserta alasan, pengecualian ikon merek, batas yang diterima, seam ke production.
- [ ] `docs/verification/T29-google-oauth-runbook.md` untuk pemilik produk: buat OAuth client *Web application* di Google Cloud, authorized redirect URI `https://cotmocgufdxjtiuakwdh.supabase.co/auth/v1/callback`, aktifkan provider Google di dashboard Supabase, tambahkan `https://myworkpulse.my.id/auth/confirm` ke Redirect URLs bila belum ada, smoke dengan flag masih mati lewat URL authorize langsung, lalu nyalakan `WORKPULSE_AUTH_GOOGLE_ENABLED` di web, smoke masuk, penautan akun, hapus akun Google, dan hapus akun uji lewat S12 (decision 0036 #4).
- [ ] `docs/verification/T29-google-oauth.md` (bukti, tanpa klaim DONE) dan draft entry status untuk closeout.

## 6. Fixture

- Akun A: email/password terverifikasi, profil complete (jalur lama, regresi hapus akun).
- Akun G: dibuat lewat Admin API lokal dengan identitas `google` saja (`app_metadata.provider = google`), `user_metadata.full_name = "Sentinel Google T29"`, profil provisional, untuk onboarding dan kartu hapus versi Google. Bila Admin API tidak bisa membuat identitas Google, buat user lalu catat keterbatasannya; state kartu diuji di unit.
- Akun D: profil `deleting_at` terisi, untuk callback ditolak.
- Sentinel: nama `Sentinel Google T29` tidak boleh muncul di log server test.
- Semua akun dibersihkan oleh teardown spec, seperti spec auth yang ada.

## 7. Commands

Yang sudah ada di `package.json`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm worker:check`, `pnpm db:start`, `pnpm db:test`, `pnpm test:e2e:auth`, `pnpm test:e2e:ui`, `pnpm test:e2e:release` dan `pnpm test:e2e:m5` (cek nama persis di Fase 0), `pnpm test:integration:account-deletion`.

Tidak ada script baru: `auth-google.spec.ts` ditambahkan ke pola file `test:e2e:auth`, sehingga script itu diubah dari satu file menjadi dua file. Catat perubahan itu di receipt.

## 8. Stop conditions

Berhenti dan tulis blocker di receipt bila:

- Working tree worktree tidak bersih di awal fase, atau perubahan T28 di checkout utama ikut terbawa.
- Supabase CLI menolak start dengan blok `[auth.external.google]` dan tidak ada cara tanpa credential nyata.
- Automatic linking menghasilkan dua `user.id` untuk satu email terverifikasi, atau perilaku akun belum terverifikasi tidak jelas (Â§2.2 butir 6).
- `amr` tidak berisi `method = oauth` dengan timestamp setelah login OAuth (Â§2.2 butir 7 tidak dapat dibuktikan).
- Butuh migration, `db:reset`, atau perubahan perilaku callback email/recovery dan jalur password T23.
- Ada yang meminta client ID, secret, atau credential Google nyata di chat, atau perubahan konfigurasi Auth di proyek hosted. Itu tugas pemilik produk lewat runbook.
- Scope melebar ke provider lain, connected accounts, atau foto profil.

## 9. Gate review Claude

Read-only, di worktree bersih pada commit ujung Fase 5:

- [ ] Ulangi `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e:auth`, `pnpm test:integration:account-deletion`; angka cocok dengan receipt.
- [ ] Baca diff `route.ts` baris per baris: cabang `token_hash` dan recovery identik secara perilaku, semua cabang menghapus cookie OAuth, tidak ada redirect yang dibangun dari input request selain return path tersanitasi.
- [ ] `redirect()` di action hanya ke origin Supabase; tidak ada open redirect lewat `data.url`.
- [ ] Hapus akun metode `google` tidak bisa dipakai akun ber-password, dan tidak lolos tanpa `amr` segar.
- [ ] Flag mati benar-benar menyembunyikan tombol dan menolak action.
- [ ] Tidak ada secret di repo (`rg -n "GOCSPX|apps.googleusercontent.com"` hanya cocok di dokumen sebagai contoh format, bukan nilai).
- [ ] Copy en/id dan axe.

P0â€“P2 memblokir Fase 6. P3 dicatat sebagai follow-up.

## 10. Review focus

1. **Open redirect atau credential bocor di callback.** Return path dari cookie dan `data.url` dari Supabase adalah input. Dijaga oleh unit action (origin) dan unit callback (sanitasi, URL akhir bersih).
2. **Akun `deleting` masuk lagi lewat Google.** Callback lama tidak memeriksa `deleting_at`; sign-in password memeriksanya. Dijaga oleh acceptance 5.
3. **Reautentikasi palsu untuk hapus akun.** Query `?reauth=delete-account` atau cookie niat saja tidak cukup; hanya `amr` segar. Dijaga oleh unit service (acceptance 9).
4. **Callback recovery salah klasifikasi sebagai OAuth.** Urutan cek Â§2.2 butir 5. Dijaga oleh test callback recovery yang ada ditambah kasus `amr` campuran.
5. **Penautan akun diam-diam membuat akun ganda.** Bergantung perilaku Supabase. Dijaga oleh acceptance 7 (integration lokal atau smoke staging tercatat).
6. **Konfigurasi hosted mengenai pilot.** Flag default mati dan runbook mengurutkan smoke sebelum flag menyala (decision 0036).
