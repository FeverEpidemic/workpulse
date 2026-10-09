# T23 Fase 3 — Domain, reautentikasi, service, dan action

- Tanggal: 9 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- Mode antislop: during (pilihan pengguna di sesi ini). Fase ini menyentuh copy i18n; UI S12 ada di Fase 5.

## File berubah

| File | Perubahan |
| --- | --- |
| `src/domain/account/deletion.ts` | baru: schema input dan preview, `confirmationMatches`, kode error |
| `src/domain/import/review-retention.ts` | baru: `ABANDONED_REVIEW_DAYS`, `abandonedReviewDeadline` |
| `src/server/auth/reauthenticate.ts` | baru: `verifyAccountPassword` dengan client sekali pakai yang dapat disuntik |
| `src/server/auth/clear-cookies.ts` | baru: `clearAuthCookies` dipindah dari `auth/actions.ts` agar dipakai ulang |
| `src/server/auth/adapter.ts` | `signOutGlobal()` aditif |
| `src/server/auth/errors.ts` | `user_banned` dipetakan ke `auth.invalidCredentials` |
| `src/server/auth/context.ts` | `accountDeleting`; profil `deleting` = belum masuk |
| `src/server/auth/actions.ts` | `signInAction`: cabang profil `deleting`; memakai `clearAuthCookies` bersama |
| `src/app/sign-in/page.tsx` | notice `accountDeleted` dan `accountDeleting` |
| `src/features/account/deletion-service.ts`, `actions.ts` | baru: service, `deleteAccountAction`, `getAccountDeletionPreviewAction` |
| `src/domain/cv/contracts.ts`, `export-view.ts`, `src/features/cv/cv-errors.ts`, `export-service.ts` | `snapshot_purged_at`, `EXPORT_RETRY_UNAVAILABLE`, aturan Retry |
| `src/i18n/messages.ts` | 30 kunci baru, en dan id |
| 8 file baru di `tests/unit/`, 4 file lama diubah | lihat di bawah |

## Command (hasil nyata)

| Command | Hasil |
| --- | --- |
| `pnpm test` | **111 file / 1010 test** lulus (sebelum fase: 104 / 962) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| grep `console.` di `src/features/account`, `src/domain/account`, `reauthenticate.ts` | nol hasil |

## Test baru

- `account-deletion-domain`: schema (strict, batas panjang), `confirmationMatches` (huruf besar, spasi, email lain, kosong, sesi tanpa email), preview strict.
- `import-review-retention`: 30 hari UTC, input kosong atau tidak terbaca.
- `account-reauthenticate`: user id berbeda = `invalid`; `invalid_credentials` dan `user_banned` = `invalid`; 429 = `rate_limited`; jaringan, 500, konfigurasi hilang = `unavailable`; client baru tiap panggilan; sesi sekali pakai dibuang dengan `signOut({ scope: "local" })`; password tidak muncul di hasil.
- `account-deletion-service`: urutan verify, begin, ban, sign-out global, sign-out lokal; email dari sesi, bukan input; konfirmasi salah ditolak sebelum password diperiksa; kegagalan password atau begin tidak membuat ban atau sign-out; ban atau sign-out global gagal = sukses dengan `revokeDeferred`; password, email, dan hitungan tidak ada di error.
- `account-deletion-actions`: pengguna dari sesi, field `email` dan `user_id` pada form diabaikan, redirect `/sign-in?notice=accountDeleted`, cookie Auth dibersihkan tanpa menyentuh `wp-locale`, error di field `password` atau `confirmation`, rate limit, tanpa sesi, ban gagal tetap redirect, preview.
- `request-context-deleting`: profil `deleting` menghasilkan `user: null`, `accountDeleting: true`.
- `account-deletion-i18n`: kunci ada di en dan id, placeholder sama, tanpa em dash atau emoji, jendela 24 jam dan 30 hari ada di teks privasi.
- `auth-errors` (tambahan): `user_banned` = kredensial salah.
- `cv-export-view` (tambahan): Retry hanya bila CV siap dan snapshot ada.

## Perubahan pada test lama (perlu ditinjau reviewer)

Semuanya dipicu langsung oleh keputusan §2.2.15–16 dan §2.4.7, tanpa melemahkan assertion:

1. `cv-export-view.test.ts`: assertion "Retry ditawarkan untuk readiness READY **dan** BLOCKED" bertentangan dengan §2.4.7 (Retry ditolak bila CV terblokir). Diganti menjadi: Retry hanya untuk READY; BLOCKED atau NO_CV menghasilkan Regenerate dengan `disabledReason`. Ditambah kasus snapshot kosong dan invarian matriks (Retry berarti `ready` dan `snapshot_purged_at` NULL).
2. `cv-contracts.test.ts`: daftar kode error database bertambah `EXPORT_RETRY_UNAVAILABLE`.
3. `cv-export-status-route.test.ts`: daftar kolom aman bertambah `snapshot_purged_at` (hanya cap waktu; snapshot, token, dan object key tetap tidak keluar).

## Catatan

- **Urutan TDD tidak murni di fase ini.** Implementasi service dan reautentikasi ditulis sebelum testnya; test lalu ditulis lengkap dan lulus. Test yang menjaga perilaku kritis (urutan langkah, tanpa efek samping bila gagal) dibuat menguji panggilan, bukan sekadar hasil. Reviewer dapat menjalankan uji mutasi bila ingin bukti merah.
- **Pemetaan error ke UNAUTHENTICATED untuk guard database** (§1.5): `mapCvDatabaseError` sudah memetakan SQLSTATE `42501` ke `UNAUTHENTICATED`. Pemeriksaan service domain lain dilakukan dengan integration di Fase 6.
- **Sign-in akun deleting:** karena Auth memeriksa ban sebelum password, cabang `auth.accountDeleting` di `signInAction` hanya terjangkau bila ban gagal terpasang. Pada kondisi normal, pengguna melihat "Email atau kata sandi salah" (anti-enumerasi, sesuai probe Fase 0).
- Penyempitan guard database dari Fase 1 tidak berdampak pada kode TypeScript.

## Acceptance Fase 3 yang terbukti

§1.1 (service dan action, unit), §1.2 (konfirmasi, unit), §1.17 sebagian (unit `export-view`), §1.19 sebagian (grep `console.` bersih, tanpa password atau email di error).

## Langkah berikutnya

Fase 4: worker `account-deletion`, langkah retensi di pass import dan export, lalu integration awal.
