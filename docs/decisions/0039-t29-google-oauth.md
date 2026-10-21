# Decision 0039: T29 masuk dengan Google

Date: 22 Oktober 2026

Status: Accepted. Keputusan produk §2.2 butir 6, 7, dan 9 disetujui pengguna di chat pada 21 Oktober 2026: "Setuju dengan §2.2 butir 6, 7, dan 9 seperti di plan T29." Gate review 22 Oktober 2026 PASS tanpa P0-P2 (independensi terbatas: reviewer sama dengan pelaksana). Closeout 22 Oktober 2026: DONE lokal atas permintaan pengguna ("Tutup T29 sebagai DONE lokal sekarang (seperti T26/T27), smoke staging dicatat sebagai langkah berikutnya"). Smoke staging dengan Google nyata belum dijalankan. Task: T29 (permintaan terarah pengguna, tidak ada di `IMPLEMENTATION_PLAN.md` §5). [Rencana](../verification/T29-implementation-plan.md), [bukti](../verification/T29-google-oauth.md), [gate review](../verification/T29-gate-review.md), [runbook provider](../verification/T29-google-oauth-runbook.md). Tanpa migration (parity tetap 38).

Nomor: 0038 dipakai draft decision T28 di branch `claude/t28-import-mode-choice`. Bila urutan merge berbeda, nomor dicek ulang saat merge.

## References

- **PRD** R01; **User Flow** F01; **Wireframe** S01, S12.
- **AGENTS.md** *Ownership, transaksi, dan revisi* (identitas dari session server), *Files, import, dan cleanup* (penghapusan akun mencabut session), *UI dan aksesibilitas*.
- **Decision terkait:** [0003](0003-auth-session.md) (auth, callback, lifecycle; bagian *Scope boundary* menyatakan T03 tanpa OAuth), [0029](0029-t23-account-deletion-retention.md) (hapus akun dengan reautentikasi), [0036](0036-shared-staging-pilot-project.md) (staging dan pilot satu proyek Supabase).

## Context

WorkPulse hanya punya masuk dengan email dan password (T03). Pengguna meminta masuk dengan Google. Dua hal membuatnya lebih dari sekadar tombol. Pertama, hapus akun T23 memeriksa password, sedangkan akun yang dibuat lewat Google tidak punya password. Kedua, proyek Supabase hosted dipakai bersama pilot (0036), sehingga provider yang diaktifkan di sana langsung terlihat oleh pengguna pilot.

## Decisions

1. **Satu provider, Google.** Tanpa abstraksi multi-provider, magic link, One Tap, atau `signInWithIdToken`. `enable_manual_linking` tetap `false`. Ini membuka batas 0003 *Scope boundary* hanya untuk Google.
2. **Flag server `WORKPULSE_AUTH_GOOGLE_ENABLED`.** Hanya string persis `true` yang menampilkan tombol dan mengizinkan action masuk. Default mati di semua lingkungan, supaya provider hosted bisa diuji sebelum terlihat pengguna pilot.
3. **PKCE lewat Server Action.** `signInWithOAuth` dipanggil pada client SSR cookie-bound dengan `skipBrowserRedirect: true`; code verifier disimpan `@supabase/ssr` sebagai cookie. Action hanya me-redirect ke URL yang origin-nya sama dengan `NEXT_PUBLIC_SUPABASE_URL`; bila URL authorize dibangun dari `SUPABASE_URL` internal yang berbeda, action gagal tertutup dengan `UNAVAILABLE`.
4. **Callback memakai `/auth/confirm` yang ada.** `redirectTo` selalu persis `<WORKPULSE_SITE_URL>/auth/confirm`, cocok dengan allowlist URL persis Supabase. Return path dan niat reautentikasi dibawa cookie HttpOnly, SameSite Lax, 10 menit (`wp-oauth-return`, `wp-reauth`), bukan query. Setiap hasil callback menghapus keduanya.
5. **Sesi OAuth dikenali dari `amr`.** Callback dengan `code`, tanpa `type`, bukan recovery, dan `amr` berisi `oauth` ≤ 300 detik diperlakukan sebagai login Google. Hanya cabang ini yang menolak profil `deleting_at`, membaca cookie return, dan membaca cookie niat. Cabang `token_hash` dan recovery tidak berubah. Parameter `error` tanpa token/code menghasilkan notice `oauthFailed`, tanpa menampilkan `error_description`.
6. **Penautan akun mengikuti automatic linking Supabase** (disetujui pengguna). Email Google terverifikasi yang sama dengan akun yang ada masuk ke `user.id` yang sama. WorkPulse tidak menulis kode penautan.
7. **Hapus akun untuk akun Google saja memakai login Google yang baru** (disetujui pengguna). Bukti: `amr.method = oauth` ≤ 5 menit dari `getClaims()`, diperiksa di service, ditambah konfirmasi email yang sama dengan T23. Akun yang punya identitas `email` tetap memakai password. Reautentikasi meminta `prompt=select_account`. Risiko yang diterima: Google dapat meloloskan pengguna tanpa password lagi bila session Google di browser masih aktif.
8. **Niat reautentikasi terikat ke pengguna.** Cookie `wp-reauth` berisi `delete-account.<user id>`. Bila pengguna memilih akun Google lain di layar Google, dialog hapus tidak terbuka untuk akun itu. Ditetapkan di Fase 2; plan awal hanya menyimpan `delete-account`.
9. **Reautentikasi tidak bergantung pada flag.** Bila tombol masuk dimatikan lagi, akun Google yang sudah ada tetap bisa dihapus.
10. **Nama Google hanya isian awal** (disetujui pengguna). Form onboarding manual di S12 diisi `user_metadata.full_name`, lalu `name`, dirapikan dan dipotong ke 80 karakter, dengan catatan sumber yang terhubung lewat `aria-describedby`. Tidak ada penyimpanan otomatis, tidak ada foto profil. Jalur onboarding lewat import (draft S03) tetap memakai nama dari CV.
11. **Tombol teks, tanpa logo Google.** Varian `secondary` yang ada, di atas form email, dengan pemisah "or use your email" / "atau pakai email"; *Sign in* tetap satu-satunya aksi primer di S01. Logo merek adalah aset yang butuh instruksi eksplisit (antislop R-23), dan lucide-react tetap satu-satunya keluarga ikon.
12. **Tanpa migration dan tanpa event produk baru.** Trigger `internal.handle_auth_user_created` sudah membuat profil provisional untuk user OAuth.

## Consequences

- `AuthAdapter` mendapat `signInWithGoogle` dan `getUser()` yang mengembalikan `providers` dan `fullName`; `authProviders()` dipakai bersama oleh S12 dan service hapus akun.
- Kode error hapus akun bertambah `REAUTH_REQUIRED`; input hapus akun menjadi union strict `{ password, confirmation }` atau `{ method: "google", confirmation }`.
- `supabase/config.toml` punya blok `[auth.external.google]` dengan credential dari env. Supabase CLI meneruskan teks `env(...)` apa adanya bila env tidak diset; ini tidak masalah untuk test lokal, yang tidak pernah memuat Google.
- Suite baru `pnpm test:e2e:auth-google` (config sendiri, port 3016, flag menyala). `test:e2e:auth` memastikan tombol tersembunyi saat flag mati.
- Copy baru en/id: `auth.google.*`, `auth.oauthFailed`, `onboarding.displayNameFromGoogle`, `account.delete.google*`, `account.delete.error.reauthRequired`.

## Batas yang diterima

- Login Google nyata, penautan akun, bentuk `amr` OAuth, dialog yang terbuka otomatis setelah reautentikasi, dan penghapusan akun Google sampai selesai hanya terbukti di smoke staging (runbook).
- Klasifikasi sesi OAuth bergantung pada jendela waktu `amr` (gate N1). Jam server yang meleset lebih dari 60 detik membuat cek `deleting_at` di callback terlewat; pertahanan yang ada adalah ban akun `deleting` dan `getRequestContext`.
- Memilih akun Google lain saat reautentikasi mengganti session tanpa pemberitahuan (gate N2).

## Seam ke task berikutnya

- **Staging (pemilik produk):** runbook T29: OAuth client, provider di dashboard Supabase, Redirect URL, flag, smoke, hapus akun uji (0036 #4).
- **Production:** verifikasi brand OAuth consent screen Google dan URL kebijakan privasi masuk checklist rilis T25.
- **Follow-up opsional:** halaman *Connected accounts* di S12, foto profil dari Google (bersama follow-up foto profil T27).
