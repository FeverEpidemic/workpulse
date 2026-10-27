# T29 Fase 7 · Smoke staging Google

- Tanggal: 25 Oktober 2026. Dijalankan pemilik produk di `https://myworkpulse.my.id` mengikuti [runbook T29](T29-google-oauth-runbook.md); ditulis Claude (Opus 5.5) dari laporan pemilik produk di chat. Claude tidak mengamati staging secara langsung.
- Lingkungan: proyek Supabase hosted `Workpulse` (`cotmocgufdxjtiuakwdh`), dipakai bersama staging dan pilot (0036).
- Image web/worker: dibangun dari `main`. Tag dari `docker ps` tidak dicatat.
- Flag: `WORKPULSE_AUTH_GOOGLE_ENABLED=true` di `web.env` saat smoke (tombol tampil di S01).
- Provider: OAuth client Google dan provider Google di dashboard Supabase dikonfigurasi pemilik produk. Credential tidak ditulis di sini.

## Hasil

| Langkah | Hasil | Catatan |
| --- | --- | --- |
| 5.1 Daftar baru dengan Google | Lulus | |
| 5.2 Masuk ulang dan return path | Lulus | |
| 5.3 Penautan akun (acceptance 7) | Lulus lewat UI | Activity dari akun password terlihat setelah masuk dengan Google. Query agregat `auth.identities` tidak dijalankan, jadi pasangan identitas `email` + `google` tidak dibuktikan dari database. |
| 5.4 Batal di Google | Lulus | |
| 5.5 Hapus akun Google saja | Lulus | Dialog terbuka sendiri setelah Confirm with Google, yang menunjukkan `amr.method = oauth` tercatat. |
| 5.6 Konfirmasi kedaluwarsa | Tidak dijalankan | Opsional; dilewati atas keputusan pemilik produk. Batas 5 menit hanya terbukti di test lokal. |
| 5.7 Bersihkan | Lulus | Receipt `internal.account_deletions` kedua akun uji `completed`; `get_operational_health()` 0 untuk `account_deletion_overdue` dan `storage_cleanup_failed`. |

Tidak ada pesan yang menyimpang dari runbook.

## Celah yang tersisa

- Tag image yang diuji tidak tercatat, sehingga hasil ini tidak terikat ke commit tertentu.
- Bukti penautan 5.3 hanya dari UI. Bila perlu bukti database, jalankan query agregat runbook 5.3 pada akun uji berikutnya.
- 5.6 belum dijalankan di staging.
- Status consent screen Google (Testing atau In production) tidak dilaporkan. Verifikasi brand dan URL kebijakan privasi tetap item checklist production (T25).
