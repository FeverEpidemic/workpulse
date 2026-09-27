# T13 Fase 4 — UI consent S12

- Tanggal: 27 September 2026. Commit: `da04e5f`.
- Tujuan: menambahkan kartu *AI processing* di S12 dan `AiConsentDialog` bersama, dengan copy en/id dan CSS berbasis token.

## File berubah

- `src/components/ui/ai-consent-dialog.tsx` (baru). Dialog bersama ini memakai primitive `Dialog` (native `<dialog>`). Pemanggil mengisi slot `allowControl`; tombol *Continue manually* sudah bawaan komponen dan hanya menutup dialog. Fokus awal jatuh ke *Continue manually* agar consent tidak pernah terberi karena Enter yang tidak disengaja.
- `src/features/profile/ai-consent-card.tsx` (baru). Kartu menampilkan status *Not allowed* / *Allowed since `<tanggal, timezone profil>`* beserta versi, atau status *outdated* bila versi berbeda. Allow berjalan lewat dialog. Withdraw memakai konfirmasi inline (*Keep AI allowed* / *Withdraw now*). Conflict menampilkan pesan dan tautan *Reload*.
- `src/features/profile/profile-workspace.tsx`: kartu ditempatkan di antara *Personal details* dan *Career records*.
- `src/app/globals.css`: kelas `.ai-consent-*`, memakai token `--space-*`, `--radius-*`, `--color-*`, tanpa gradient maupun sparkle.
- `src/features/profile/profile-editor.tsx`: satu kelas `[overflow-wrap:anywhere]` pada baris *Sign-in email*. Lihat temuan di bawah.

## Temuan

- **Overflow S12 bawaan T03 (diperbaiki).** Email login yang panjang (email fixture sekitar 60 karakter tanpa titik patah) membuat S12 meluap menjadi 416–420 px pada viewport 360. Penyebabnya adalah text node di `<p>` *Sign-in email*, bukan kartu consent. Diagnostik rect teks di E2E menemukan node ini. Perbaikannya berupa satu utilitas CSS tanpa perubahan perilaku.
- **Race fokus (diperbaiki).** Versi awal memindahkan fokus ke status lewat `requestAnimationFrame`. Cara itu kadang kalah oleh restorasi fokus bawaan `dialog.close()` ke tombol pemicu yang sudah di-unmount, dan E2E sempat gagal 1 dari 6 run. Sekarang fokus dipindahkan dari effect yang berjalan setelah dialog benar-benar tertutup (effect child di-flush lebih dulu). Setelah perbaikan, E2E lulus 12/12 dalam dua batch 6 run.
- Dialog juga ditutup saat terjadi error, agar pesan konflik tidak tersembunyi di balik modal. Fokus kemudian pindah ke tautan *Reload*.
- Hidden `expected_revision` pada editor profil ikut diperbarui setelah consent menaikkan revisi profil. E2E membuktikan *Save profile* tetap berhasil setelah allow.

## Command dan hasil

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm typecheck` / `pnpm lint` | 0 / 0 | Bersih. ESLint sempat menolak `setState` sinkron di effect; target fokus diubah menjadi ref |
| `pnpm test:e2e:ai` | 0 | 2/2. Riwayat run dicatat di receipt Fase 5 |
