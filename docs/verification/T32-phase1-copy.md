# T32 Fase 1: copy deck dan terjemahan legal

- Tanggal: 28 Oktober 2026
- Pelaksana: Claude (Opus 5.5), branch `claude/t32-landing`, checkout utama `D:\Project\WorkPulse`.
- antislop: mode during (session override, dipilih pengguna 28 Oktober 2026).

## Tujuan

Menyiapkan semua teks landing (en dan id) dan terjemahan English draf legal, lalu meminta persetujuan pengguna sebelum kode ditulis.

## File berubah

- `docs/marketing/landing-copy-v1.md` (baru)
- `docs/legal/privacy-policy-en-draft.md` (baru)
- `docs/legal/terms-of-service-en-draft.md` (baru)

Sesi fork sempat menulis draf pertama ketiga file ini dan receipt ini secara paralel. Versi yang ada sekarang ditulis ulang oleh sesi ini, dan versi inilah yang diajukan untuk disetujui.

## Sumber

- Teks mockup (`Main.dc.html` di [canvas](https://claude.ai/artifact/D1ugHFSU15aeh6bCG2mK9G)) untuk semua elemen yang ada di sana.
- Brief landing dan naskah reels untuk cerita hero.
- Elemen baru yang tidak ada di mockup: catatan hero yang diketik (≤ 90 karakter, sesuai acceptance 10), titik langkah dan teks statusnya, tombol putar ulang, metadata, label aksesibilitas, label draf legal, dan kalimat persetujuan di bawah form daftar.

## Keputusan yang perlu disetujui

1. **Catatan hero dipendekkan.** Catatan di mockup sekitar 165 karakter, jadi efek ketiknya melewati batas cerita 3,5 detik. Versi `id` di copy deck 82 karakter. Versi `en` 96 karakter, ada alternatif 74 karakter kalau batas 90 dipegang.
2. **Kutipan pembuat.** "tidak" diganti "gak" supaya senada dengan landing (sama dengan mockup). Versi asli dicatat di copy deck.
3. **Kalimat di form daftar.** `legal.signUpNote`: "Dengan membuat akun, kamu setuju dengan Syarat Layanan dan Kebijakan Privasi." Tanpa checkbox, sesuai §2.2.9.
4. **Terjemahan legal.** Versi Indonesia tetap sumber bila ada selisih, sampai keduanya di-review.

## Delivery Gate antislop-copywriting

| Butir | Hasil | Bukti |
| --- | --- | --- |
| Tanpa angka, testimoni, nama, tanggal, atau klaim karangan | PASS | Persona dan perusahaan fiktif ("PT Contoh ...", "Universitas Contoh"), berlabel contoh. Angka hanya di data contoh dan "dari 5". Tanpa jumlah pengguna, persen, atau kutipan pelanggan. |
| Buzzword diganti bahasa spesifik | PASS | Tidak ada unlock, seamless, elevate, revolutionary, atau padanan Indonesianya. |
| Tanpa em dash | PASS | Copy deck tidak memakai em dash atau en dash. Rentang tanggal CV ikut format `CvPreview`. |
| Tanda kutip seperlunya | PASS | Hanya untuk kutipan catatan asli dan contoh nama jenis aksi di legal. |
| Tanpa kapital untuk penekanan | PASS | "ID"/"EN" adalah kode bahasa. |
| Setiap kalimat punya pelaku | PASS dengan catatan | "Template label baru diusulkan ke supervisor" pasif, tapi ini data contoh dari mockup yang sudah disetujui. |
| CTA spesifik | PASS | "Daftar pilot gratis" / "Join the free pilot", "Udah punya akun? Masuk". |
| Tanpa ritme AI | PASS | Tiga baris Data kamu adalah tiga fakta produk dari brief, bukan deret tiga yang dipaksakan. Tidak ada "bukan sekadar X". |
| Ada suara | PASS | `id` santai seperti reels, `en` polos. |
| Dibaca keras | PASS | Dibaca ulang per section di kedua bahasa. |

## Kata terlarang (acceptance 6)

Dicek manual di copy deck kedua bahasa: tidak ada "ATS", testimoni, persen, "x lebih", jumlah pengguna, nama provider AI, region atau negara server, "freemium", "berbayar", "premium", "waitlist", atau "kuota". "ATS" muncul di Syarat Layanan bagian 5 sebagai penyangkalan. Itu teks legal di luar scan acceptance 6.

## Terjemahan legal

- Kedua file English mengikuti draf ID bagian per bagian (12 bagian masing-masing).
- Isian kosong menjadi placeholder English (`[CITY]`, `[AI PROVIDER NAME AND COUNTRY]`, dan seterusnya).
- Kebijakan Privasi bagian 6 berisi tabel, jadi model konten §2.2.9 perlu blok `table` selain `p` dan `ul`. Dicatat untuk Fase 4.

## Checks

Tidak ada kode yang berubah, jadi tidak ada test yang dijalankan.

## Persetujuan

29 Oktober 2026, pengguna: "Setuju, lanjut". Yang disetujui: copy deck, kedua terjemahan legal, keputusan 1-4, dan pemecahan `ActivityListRow`/`AchievementListRow` dengan `href` opsional (Fase 0, menyentuh stop condition §8 butir 3).

Untuk keputusan 1, pengguna tidak memilih versi `en`. Yang dipakai versi 74 karakter karena acceptance 10 membatasi catatan ≤ 90 karakter. Copy deck dan kutipan sumber di panel sudah disesuaikan.

## Blocker

Tidak ada.

## Berikutnya

Fase 2 (route, locale, mode sign-in).
