# T29 remediation P3 Fase 1: klasifikasi OAuth

Tanggal: 22 Oktober 2026. Pelaksana: ChatGPT Sol 6.1.

## Tujuan dan file berubah

RV1: helper hasOAuthMethod di src/server/auth/oauth-session.ts mengenali method oauth tanpa jendela waktu; callback memakai helper tersebut. Test baru di tests/unit/oauth-session.test.ts dan tests/unit/auth-confirm-oauth.test.ts. Receipt baseline dan checkbox plan turut dicatat.

## Commands dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| pnpm test -- tests/unit/oauth-session.test.ts tests/unit/auth-confirm-oauth.test.ts tests/unit/recovery-session.test.ts, sebelum implementasi | 1 | 16 gagal / 26 lulus, 2 file gagal / 1 lulus |
| Perintah sama, setelah implementasi | 0 | 3 file / 42 test lulus |

## Acceptance

RV1 §2.1–2: oauth berumur 400 detik tetap menolak deleting_at dan memakai cookie return /projects. Helper menerima timestamp nol, lama, masa depan, dan tidak ada; menolak metode lain dan bentuk malformed. Lima test email/recovery tetap identik. hasRecentOAuthProof dan test lama tidak berubah, termasuk penolakan 301 detik dan skew lebih dari 60 detik. Recovery helper dan route recovery tidak berubah.

## Warning

Warning MDX kosong dan hook Vite Vitest sama dengan baseline. Parameterisasi test baru memakai wrapper objek agar array kosong diuji sebagai array, bukan disebar oleh it.each. Tidak ada perubahan assertion lama.

## Blocker dan langkah berikutnya

Fase 2 menunggu keputusan pengguna: assertion lama untuk cookie niat akun lain mengharapkan /dashboard, bertentangan dengan RV2 switched. §7 melarang mengubah test lama tanpa keputusan. Pertanyaan sudah dikirim. Tidak memulai RV2–RV4.
