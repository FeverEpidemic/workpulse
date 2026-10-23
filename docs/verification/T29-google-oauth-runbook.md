# Runbook T29: provider Google di staging dan pilot

Untuk pemilik produk. Pelaksana kode tidak menyentuh Google Cloud Console, dashboard Supabase hosted, atau server web. Credential tidak pernah ditempel di chat, receipt, atau repo.

Lingkungan: proyek Supabase hosted `Workpulse` (`cotmocgufdxjtiuakwdh`), dipakai bersama staging dan pilot `https://myworkpulse.my.id` ([decision 0036](../decisions/0036-shared-staging-pilot-project.md)). T29 tanpa migration, jadi syarat backup-sebelum-migration 0036 #2 tidak berlaku. Syarat akun uji 0036 #3 dan #4 tetap berlaku.

Acuan: [decision 0039](../decisions/0039-t29-google-oauth.md), [plan](T29-implementation-plan.md), [gate review](T29-gate-review.md).

## 1. Prasyarat

- Image web dan worker dari commit yang memuat T29 sudah di-deploy, dengan `WORKPULSE_AUTH_GOOGLE_ENABLED` **belum** diset (tombol tersembunyi).
- Di `web.env`, `SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_URL` sama-sama `https://cotmocgufdxjtiuakwdh.supabase.co`. Bila origin keduanya berbeda, tombol Google gagal dengan pesan layanan tidak tersedia (action menolak URL authorize di luar origin publik).
- Satu akun Google uji yang bukan akun pribadi utama, dan satu alamat email uji lain untuk penautan (langkah 5.3).

## 2. OAuth client di Google Cloud Console

1. Buat atau pilih project Google Cloud untuk WorkPulse.
2. **OAuth consent screen:** nama aplikasi `WorkPulse`, email dukungan, domain `myworkpulse.my.id`. Scope cukup `openid`, `email`, `profile` (tidak sensitif). Selama status **Testing**, hanya akun yang didaftarkan sebagai test user yang bisa masuk. Daftarkan akun uji dan, bila pilot memakai Google, akun peserta. Publikasi ke **In production** butuh URL kebijakan privasi dan verifikasi brand; itu item checklist production (T25), bukan syarat smoke ini.
3. **Credentials > Create credentials > OAuth client ID**, tipe **Web application**.
   - Authorized redirect URI: `https://cotmocgufdxjtiuakwdh.supabase.co/auth/v1/callback`
   - Authorized JavaScript origin (opsional): `https://myworkpulse.my.id`
4. Simpan Client ID dan Client secret di pengelola rahasia Anda.

## 3. Provider di Supabase hosted

1. Dashboard proyek `Workpulse` > **Authentication > Sign In / Providers > Google**: aktifkan, isi Client ID dan Client secret, simpan.
2. **Authentication > URL Configuration:** Site URL `https://myworkpulse.my.id`; daftar Redirect URLs berisi `https://myworkpulse.my.id/auth/confirm` (sudah ada sejak T25; pastikan tidak terhapus). Jangan menambah URL dengan query string: callback T29 selalu memakai URL persis itu.
3. Biarkan manual linking mati. Automatic linking ke email terverifikasi adalah perilaku bawaan Supabase dan memang yang dipakai (0039 #6).

## 4. Nyalakan tombol

1. Tambahkan `WORKPULSE_AUTH_GOOGLE_ENABLED=true` ke `web.env` (hanya nilai persis `true` yang dihitung).
2. Recreate container web, misalnya `docker compose -f deploy/staging/compose.yaml up -d web` dengan `WORKPULSE_TAG` yang sama.
3. Buka `https://myworkpulse.my.id/sign-in`: tombol **Continue with Google** tampil di atas form email.

Untuk mematikan lagi, hapus variabel itu dan recreate web. Akun Google yang sudah ada tetap bisa menghapus akunnya di S12 walau tombol tersembunyi (0039 #9).

## 5. Smoke

Catat hasil tiap langkah: lulus/gagal, waktu, dan pesan yang tampil. Jangan menyalin data pribadi peserta.

1. **Daftar baru dengan Google.** Jendela incognito > Continue with Google > pilih akun Google uji > izinkan. Hasil yang diharapkan: mendarat di pilihan onboarding import. Pilih isi manual: field Display name sudah berisi nama Google dengan catatan "Filled in from your Google account. You can change it." Simpan, lalu masuk ke dashboard.
2. **Masuk ulang dan return path.** Keluar. Buka `https://myworkpulse.my.id/sign-in?returnTo=%2Fprojects` > Continue with Google. Hasil: mendarat di `/projects`, dan URL akhir tidak berisi `code=` atau `state=`.
3. **Penautan akun (acceptance 7).** Daftar dengan email dan password memakai alamat Gmail uji kedua, verifikasi email, lalu buat satu activity. Keluar. Continue with Google dengan akun Google yang sama. Hasil: activity tadi terlihat (akun yang sama, bukan akun baru). Bukti tambahan di SQL editor dashboard, hanya agregat: `select provider from auth.identities where user_id = (select id from auth.users where email = '<email uji>');` mengembalikan `email` dan `google`.
4. **Batal di Google.** Continue with Google > tutup atau tolak di layar Google. Hasil: kembali ke S01 dengan "Signing in with Google did not finish. Try again, or sign in with your email and password."
5. **Hapus akun Google saja.** Masuk dengan akun dari langkah 1 > Profile > Delete account. Hasil: dialog menjelaskan bahwa akun ini masuk dengan Google, tanpa field password; klik **Confirm with Google** > pilih akun yang sama. Hasil: kembali ke Profile dengan dialog terbuka sendiri, berisi "Google confirmed it is you." dan field email. Ketik email > Delete account permanently. Hasil: keluar ke S01 dengan notice akun dihapus. Ini sekaligus membuktikan login Google tercatat `amr.method = oauth` (tanpa itu dialog tidak terbuka sendiri dan penghapusan ditolak).
6. **Konfirmasi kedaluwarsa (opsional).** Ulangi langkah 5 dengan akun Google uji lain, tetapi tunggu lebih dari 5 menit sebelum menekan hapus. Hasil: pesan "Confirm with Google again. A confirmation lasts 5 minutes." dan tombol Google muncul lagi.
7. **Bersihkan.** Hapus akun dari langkah 3 lewat S12 dengan password. Pastikan receipt `internal.account_deletions` untuk kedua akun `completed` dan `get_operational_health()` kembali 0 untuk `account_deletion_overdue` dan `storage_cleanup_failed` (0036 #4). Akun uji tidak didaftarkan `set_pilot_participant`.

## 6. Bukti

Tulis hasil di `docs/verification/T29-phase7-staging.md`: tanggal, tag image web/worker dari `docker ps` host, status flag, hasil langkah 5.1-5.7, dan keluaran agregat langkah 5.3 dan 5.7. Tanpa client secret, token, cookie, atau email peserta.

## 7. Bila gagal

| Gejala | Kemungkinan penyebab |
| --- | --- |
| Tombol tidak tampil | flag tidak persis `true`, atau container web belum di-recreate |
| Klik tombol menampilkan pesan layanan tidak tersedia | `SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_URL` di `web.env` berbeda origin, atau provider Google belum aktif di dashboard |
| Google menampilkan `redirect_uri_mismatch` | Authorized redirect URI di Google Cloud bukan `https://cotmocgufdxjtiuakwdh.supabase.co/auth/v1/callback` |
| Google menampilkan "Access blocked" untuk akun tertentu | consent screen masih Testing dan akun belum terdaftar sebagai test user |
| Kembali ke S01 dengan "confirmation link is invalid" | Redirect URL `https://myworkpulse.my.id/auth/confirm` hilang dari allowlist Supabase, atau cookie code verifier tidak terkirim (domain/HTTPS) |
| Langkah 5.3 menghasilkan akun baru tanpa activity | email akun password belum terverifikasi, atau Supabase tidak menautkan; catat perilaku nyata dan jangan lanjut ke production |
| Dialog hapus tidak terbuka sendiri setelah Confirm with Google | `amr` tidak berisi `oauth`, atau akun yang dipilih di Google berbeda dari akun yang login |
