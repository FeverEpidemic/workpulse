# Copy landing page (draf v1)

Copy untuk T32, `id` dan `en` berdampingan. Urutan mengikuti §3.2 plan T32 dan [mockup](https://claude.ai/artifact/D1ugHFSU15aeh6bCG2mK9G). Gaya `id`: santai seperti reels ("kamu", "gak", "udah"). Gaya `en`: polos dan langsung. Semua nama orang, perusahaan, dan isi kerja di data contoh fiktif.

Status: **disetujui pemilik produk, 29 Oktober 2026.** Teks ini masuk ke `src/i18n/messages.ts` dengan prefix `landing.` dan `legal.`.

## Metadata

| Key | id | en |
| --- | --- | --- |
| `landing.meta.title` | WorkPulse: catat kerjaan, susun CV dari catatan sendiri | WorkPulse: log your work, build your CV from your own notes |
| `landing.meta.description` | Catat kerjaan tiap hari, ubah jadi achievement yang kamu setujui, lalu unduh CV PDF satu kolom. Pilot gratis. | Log your work each day, turn it into achievements you approve, then download a one-column PDF CV. Free pilot. |

## Header

| Key | id | en |
| --- | --- | --- |
| `landing.skip` | Langsung ke konten | Skip to content |
| `landing.nav.label` | Akun dan bahasa | Account and language |
| `landing.locale.label` | Bahasa | Language |
| `landing.locale.id` | Bahasa Indonesia | Bahasa Indonesia |
| `landing.locale.en` | English | English |
| `landing.signIn` | Masuk | Sign in |
| `landing.signUp` | Daftar | Sign up |

Tombol toggle menampilkan `ID` dan `EN`. Nama lengkapnya dipakai sebagai `aria-label`, dalam bahasa itu sendiri.

## Hero

| Key | id | en |
| --- | --- | --- |
| `landing.hero.eyebrow` | Pilot gratis udah buka | The free pilot is open |
| `landing.hero.title` | Mau update CV. Terus lupa setahun kemarin ngerjain apa aja. | You sit down to update your CV and can't remember what you did last year. |
| `landing.hero.body` | Catat kerjaan tiap selesai kerja, singkat aja. Pas butuh CV, kamu tinggal pilih dari catatan sendiri. | Write a short note after each workday. When you need a CV, pick from your own notes. |
| `landing.hero.cta` | Daftar pilot gratis | Join the free pilot |
| `landing.hero.signIn` | Udah punya akun? Masuk | Already have an account? Sign in |
| `landing.hero.exampleLabel` | Contoh tampilan WorkPulse: satu catatan Activity dan usulan Achievement dari catatan itu | Example of WorkPulse: one Activity note and the Achievement suggested from it |
| `landing.hero.replay` | Putar ulang contoh | Replay example |

### Cerita hero (data contoh)

| Bagian | id | en |
| --- | --- | --- |
| Meta Activity | Kam, 14 Agu 2025 · Retur Gudang | Thu, 14 Aug 2025 · Warehouse returns |
| Catatan yang diketik (≤ 90 karakter) | Cek data retur bareng tim gudang. Banyak yang balik karena label alamat kepotong. | Checked returns with the warehouse team. Many were cut-off address labels. |
| Label bawah Activity | Activity · disimpan apa adanya | Activity · saved as written |
| Penghubung | AI usulin achievement | AI suggests an achievement |
| Badge usulan | Usulan AI | AI suggestion |
| Badge status | Perlu kamu cek | Needs your review |
| Judul achievement | Analisis penyebab retur pengiriman | Root-cause analysis of shipping returns |
| Kontribusi | Menelusuri data retur bersama tim gudang dan menemukan pola label alamat yang terpotong saat dicetak. | Traced return data with the warehouse team and found a pattern of address labels cut off at printing. |
| Tombol | Konfirmasi · Edit dulu | Confirm · Edit first |
| Status akhir | Disetujui | Approved |

Catatan yang diketik: `id` 82 karakter, `en` 74 karakter. Versi `en` 96 karakter ("Went through returns with the warehouse team. Many came back because address labels were cut off.") tidak dipakai karena melewati batas 90.

## Panel demo

| Key | id | en |
| --- | --- | --- |
| `landing.demo.eyebrow` | Cara kerjanya | How it works |
| `landing.demo.title` | Dari catatan harian ke CV, tanpa mulai dari nol | From daily notes to a CV, without starting from scratch |
| `landing.demo.tablist` | Langkah WorkPulse | WorkPulse steps |
| `landing.demo.tab.log` | Catat Activity | Log an Activity |
| `landing.demo.tab.review` | Cek Achievement | Review an Achievement |
| `landing.demo.tab.cv` | Susun CV | Build your CV |
| `landing.demo.log.title` | Catat selesai kerja, satu-dua kalimat cukup | Log it after work, a sentence or two is enough |
| `landing.demo.log.body` | Tulis apa yang kamu kerjain hari ini, sesantai catatan di HP. Tanggalnya otomatis, dan catatan aslinya disimpan apa adanya. | Write what you worked on today, as casually as a note on your phone. The date fills itself in, and your note is saved exactly as written. |
| `landing.demo.review.title` | AI ngusulin, kamu yang mutusin | AI suggests, you decide |
| `landing.demo.review.body` | Dari catatanmu, AI bisa nyusun draf achievement: apa kontribusimu dan apa hasilnya. Gak ada yang jadi achievement sebelum kamu cek dan setujuin. AI juga bisa dimatiin, semuanya tetap bisa diisi manual. | From your note, AI can draft an achievement: what you contributed and what came of it. Nothing becomes an achievement until you review and approve it. You can also turn AI off and fill everything in yourself. |
| `landing.demo.cv.title` | Pilih yang mau masuk CV, terus unduh PDF | Pick what goes in your CV, then download the PDF |
| `landing.demo.cv.body` | Satu master CV, format satu kolom. Teks di PDF-nya teks asli, bukan gambar, jadi bisa diseleksi dan dicari. | One master CV in a single column. The PDF holds real text, not an image, so it can be selected and searched. |

### Titik langkah

| Key | id | en |
| --- | --- | --- |
| `landing.steps.1` | Catat | Log |
| `landing.steps.2` | AI usulkan | AI suggests |
| `landing.steps.3` | Setujui | Approve |
| `landing.steps.4` | Pilih ke CV | Add to CV |
| `landing.steps.5` | Unduh PDF | Download PDF |
| `landing.steps.status` | Langkah {from}-{to} dari 5 | Steps {from}-{to} of 5 |
| `landing.steps.statusOne` | Langkah {step} dari 5 | Step {step} of 5 |

### Data contoh di panel

| Bagian | id | en |
| --- | --- | --- |
| Judul Quick log | Quick log | Quick log |
| Label field | Kamu ngerjain apa? | What did you work on? |
| Isi catatan | Rapat sama vendor kurir soal SLA pengiriman luar Jawa. Aku bikin rekap keluhan pelanggan sebulan terakhir buat bahan diskusi. | Met the courier vendor about delivery SLAs outside Java. I put together last month's customer complaints for the discussion. |
| Meta | Hari ini · Retur Gudang | Today · Warehouse returns |
| Tombol | Simpan activity | Save activity |
| Hasil | Template label baru diusulkan ke supervisor dan diuji di satu lini packing. | A new label template was proposed to the supervisor and tried on one packing line. |
| Kalimat CV | Menganalisis data retur pengiriman dan mengusulkan perbaikan template label alamat bersama tim gudang. | Analysed shipping return data and proposed a fix to the address label template with the warehouse team. |
| Kutipan sumber | Catatan asli: "Cek data retur bareng tim gudang…" | Original note: "Checked returns with the warehouse team…" |
| CV: nama dan peran | Rani Prameswari · Operations Analyst · Surabaya | Rani Prameswari · Operations Analyst · Surabaya |
| CV: pengalaman | Operations Analyst · PT Contoh Logistik; Staf Data Entry · PT Contoh Niaga | Operations Analyst · PT Contoh Logistik; Data Entry Staff · PT Contoh Niaga |
| CV: pendidikan | S1 Manajemen · Universitas Contoh | Bachelor of Management · Universitas Contoh |
| Badge contoh | Contoh | Example |

Heading seksi CV (Pengalaman, Pendidikan) dan format tanggal ikut dari komponen `CvPreview` dan locale CV, bukan copy landing.

## Import CV lama

| Key | id | en |
| --- | --- | --- |
| `landing.import.eyebrow` | Udah punya CV? | Already have a CV? |
| `landing.import.title` | Gak perlu mulai dari kosong | You don't have to start from a blank page |
| `landing.import.body` | Upload CV lama dalam PDF atau DOCX. WorkPulse membacanya jadi draf pengalaman, pendidikan, dan skill, lalu kamu pilih mana yang disimpan. Mau pakai AI atau tanpa AI, kamu yang pilih tiap kali upload. | Upload your old CV as a PDF or DOCX. WorkPulse reads it into draft experience, education, and skills, and you choose what to keep. With AI or without, you choose on every upload. |
| Contoh: file | CV-lama.pdf · dibaca tanpa AI | old-CV.pdf · read without AI |
| Contoh: pilihan | Simpan · Lewati | Keep · Skip |

## Data kamu

| Key | id | en |
| --- | --- | --- |
| `landing.data.eyebrow` | Data kamu | Your data |
| `landing.data.title` | Catatan kerjamu, kamu yang pegang | Your work notes stay in your hands |
| `landing.data.ai.title` | AI cuma jalan kalau kamu izinin | AI only runs when you allow it |
| `landing.data.ai.body` | Fitur AI mati sampai kamu nyalain sendiri, dan bisa dimatiin lagi kapan aja. Usulannya baru tersimpan setelah kamu setujui. | AI stays off until you turn it on, and you can turn it off again at any time. A suggestion is only saved once you approve it. |
| `landing.data.source.title` | Catatan asli gak pernah ditimpa | Your original note is never overwritten |
| `landing.data.source.body` | Apa yang kamu tulis tetap tersimpan persis begitu. Achievement dan CV dibuat di sampingnya, bukan menggantikannya. | What you write is kept exactly as written. Achievements and your CV are built next to it, not in its place. |
| `landing.data.delete.title` | Akun bisa kamu hapus sendiri | You can delete your account yourself |
| `landing.data.delete.body` | Dari halaman Profil, hapus akun beserta semua catatan, file, dan CV-nya. Gak perlu kirim email minta tolong. | From your Profile, delete your account with all its notes, files, and CV. No need to email anyone. |

## Dari pembuat

| Key | id | en |
| --- | --- | --- |
| `landing.maker.eyebrow` | Dari pembuat | From the maker |
| `landing.maker.quote` | Semoga dengan adanya tools ini, kalian jadi gak lupa apa aja sih yang pernah dikerjakan selama kalian bekerja. | I hope this tool helps you remember everything you've worked on throughout your career. |
| `landing.maker.name` | Ilham Aisy Rasyid | Ilham Aisy Rasyid |
| `landing.maker.email` | halo@myworkpulse.my.id | halo@myworkpulse.my.id |

Kalimat `id` dari pemilik, dengan "tidak" diganti "gak" supaya senada dengan landing. Versi asli: "Semoga dengan adanya tools ini, kalian jadi tidak lupa apa aja sih yang pernah dikerjakan selama kalian bekerja".

## Penutup dan footer

| Key | id | en |
| --- | --- | --- |
| `landing.closing.title` | Mulai catat dari hari ini, biar CV berikutnya gak mulai dari nol | Start logging today, so your next CV doesn't start from zero |
| `landing.closing.body` | Pilot gratis. Daftar pakai email, langsung bisa dipakai. | Free pilot. Sign up with your email and start right away. |
| `landing.closing.cta` | Daftar pilot gratis | Join the free pilot |
| `landing.footer.label` | Footer | Footer |
| `landing.footer.privacy` | Kebijakan Privasi | Privacy Policy |
| `landing.footer.terms` | Syarat Layanan | Terms of Service |

## Halaman legal

| Key | id | en |
| --- | --- | --- |
| `legal.draftNotice` | Draf, belum berlaku. Bagian bertanda kuning masih diisi. Halaman ini tidak diindeks mesin pencari sampai versi final terbit. | Draft, not yet in effect. Highlighted parts are still being filled in. Search engines won't index this page until the final version is published. |
| `legal.effective` | Berlaku sejak {date} | Effective from {date} |
| `legal.toc` | Di halaman ini | On this page |
| `legal.privacy.title` | Kebijakan Privasi | Privacy Policy |
| `legal.terms.title` | Syarat Layanan | Terms of Service |
| `legal.signUpNote` | Dengan membuat akun, kamu setuju dengan {terms} dan {privacy}. | By creating an account, you agree to the {terms} and {privacy}. |

Isi `/privacy` dan `/terms` diambil dari `docs/legal/*-id-draft.md` dan `docs/legal/*-en-draft.md`.

## Cek kata terlarang

Dicek manual di kedua bahasa, 28 Oktober 2026: tidak ada "ATS", testimoni, persen, "x lebih", jumlah pengguna, nama provider AI, region atau negara server, "freemium", "berbayar", "premium", "waitlist", atau "kuota". Angka yang muncul hanya di data contoh (tanggal, "satu lini packing", "sebulan terakhir") dan di langkah "dari 5". "ATS" hanya ada di Syarat Layanan bagian 5 (penyangkalan), bukan di landing.
