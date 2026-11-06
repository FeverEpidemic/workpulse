# Decision 0043: fade dua arah saat scroll di landing

Date: 3 November 2026

Status: Accepted. Pilihan perilaku dari interview pengguna di chat, desain singkat disetujui pengguna pada tanggal yang sama. Dieksekusi Claude Opus 5.5 di branch `claude/t32-landing`. Mengganti "reveal sekali" dari decision 0042 #6. Tanpa migration (parity tetap 38), tanpa dependency.

## References

- **Decision 0042** #6 (MOTION 3 khusus landing, cek scroll).
- **Design.md** §16.4.

## Context

Landing hanya punya fade-in sekali per section. Pengguna meminta fade-out juga saat scroll, dengan tujuan halaman terasa lebih hidup. Ini tujuan kesan, bukan bantuan membaca, dan dicatat apa adanya untuk R-19 antislop. Kalau di browser terasa ramai, langkah pertama adalah melepas hero dari fade.

## Decisions

1. **Dipicu posisi, dua arah, bukan terikat scroll.** Item memudar keluar dan masuk dengan durasi tetap `--motion-slow`. Larangan scroll-linked motion di §16.4 tetap berlaku. *Alasan:* pilihan pengguna, dan scroll yang berhenti tidak meninggalkan item setengah pudar.
2. **Per item, bukan per section.** Status ada di `[data-reveal-item]`, dan atribut `data-reveal` serta `data-revealed` di section dihapus. *Alasan:* dengan batas di tepi layar, section utuh hanya memudar saat tinggal potongan terakhirnya, jadi efeknya nyaris tidak terlihat.
3. **Batas pudar: kurang dari 5% tinggi item dan kurang dari 24 px tersisa di layar** (`src/features/marketing/reveal-state.ts`). *Alasan:* 5% saja pada judul kecil sekitar 3 px, jadi fade-nya tidak terlihat. Geseran 12 px menjauhkan item yang sudah pudar dari batas, jadi status tidak bolak-balik di tepi.
4. **Hero ikut memudar saat keluar**, tanpa fade-in saat halaman dibuka, dan cerita hero tidak diulang.
5. **Stagger 80 ms hanya sampai item pernah keluar sekali** (`data-reveal-settled`). *Alasan:* jeda saat scroll balik terasa lambat.
6. **Tetap cek scroll dengan `requestAnimationFrame`, sekarang aktif selama halaman terbuka.** Ditambah `resize` dan `ResizeObserver` pada `body`, karena tab demo dengan tinggi lain menggeser item tanpa scroll, dan item itu tidak boleh tetap pudar di layar.
7. **Dua pengaman.** Item yang memuat fokus keyboard tidak pernah pudar (`:not(:focus-within)`), dan `@media print` menampilkan semua item.
8. **Pengecekan axe dan layout mematikan fade dulu.** `settleLanding` melepas `is-reveal-ready`. *Alasan:* axe melewati elemen `opacity: 0` tanpa gagal, jadi cakupan kontras bisa hilang diam-diam.

## Not promised

- Belum diuji di Safari, Firefox, perangkat nyata, staging, atau production. Bukti berasal dari Chromium lokal.
- Biaya listener yang selalu aktif (17 item diukur per frame) belum diukur di HP sungguhan.
