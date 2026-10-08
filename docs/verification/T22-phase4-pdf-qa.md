# T22 Fase 4 — QA PDF nyata (`tests/pdf/`)

- Tanggal: 7 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `a93dc7a` (Fase 3).
- Status: **selesai**. Suite memakai renderer Chromium nyata (`workpulse-t21-pdf`, Gotenberg 8.37, Noto Sans) dan analisis posisi teks pdf.js; tanpa database dan tanpa renderer fake (suite gagal keras bila renderer tidak terjangkau). Satu cacat template ditemukan oleh suite dan diperbaiki dengan satu aturan break.

## 1. Tujuan

Membuktikan dengan PDF nyata (bukan keberadaan file saja): teks hasil ekstraksi cocok dengan model, heading tidak yatim, entry yang muat satu halaman tidak terbelah, tidak ada teks terpotong atau terskala, A4, dan Unicode (R10, §1.10–§1.14).

## 2. File berubah

| Aksi | File |
| --- | --- |
| Create | `vitest.pdf.config.ts`, `tests/pdf/pdf-layout.ts` (render nyata + analisis pdf.js), `tests/pdf/fixtures.ts`, `tests/pdf/cv-pdf-layout.test.ts` |
| Modify | `package.json` (script `test:pdf`) |
| Modify | `src/server/export/cv-print-template.ts` (satu aturan, lihat §5), `tests/unit/cv-print-template.test.ts` (satu test baru; test lama tidak diubah) |

## 3. Cara kerja analisis

- Render: `renderCvPrintHtml(model)` → `GotenbergPdfRenderer` nyata (`WORKPULSE_PDF_GOTENBERG_URL`); hasil dicache per dokumen. Model fixture dibangun lewat jalur worker: baris CV tersimpan → `exportSnapshotFrom` → `cvExportSnapshotSchema` → `buildExportRenderModel`. Model sapuan dibangun langsung (yang diuji adalah template).
- Analisis: pdf.js legacy `getTextContent` dengan `transform`; item dikelompokkan per baris (y ± 1 pt). Heading dikenali dari **teks** (label section `CV_LABELS` dan judul entry/child model), bukan dari ukuran font. Baris terakhir halaman = baris dengan y terkecil.
- Kecocokan dengan model: `printedStrings(model)` menurunkan semua string cetak berurutan dari **model** (nama, headline, kontak, ringkasan, heading, headline/subline·tanggal/teks entry dan child); `matchInOrder` mencarinya berurutan dalam teks PDF (boleh terlipat atau melintasi halaman) dan mengembalikan teks sisa di antaranya. Sisa harus kosong (selain penanda bullet).
- Batas pengukuran: pdf.js tidak dapat menggambar piksel di Node tanpa canvas (tidak ada dependency baru). Karena itu pengecekan margin memakai posisi teks, dan pengecekan piksel (kotak tinta per halaman) dilakukan di E2E Fase 6 pada canvas browser.

## 4. Fixture (plan §6)

| Fixture | Isi |
| --- | --- |
| Owner A `en` dan `id` | 4 experience (current, **tumpang tindih**, **tanggal tidak diketahui**, presisi tahun), project berkonteks experience, achievement kontekstual (satu **override**) dan standalone, education, skill SQL, certification dengan `credential_url`, override profil `headline` dan `website`, bullet `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, nama `Siti Nurhaliza Ç. Ñuñez`, **sentinel** `WP-PRIVATE-CV-SENTINEL-…` di judul, ringkasan, dan override |
| Owner A panjang `en` dan `id` | 12 achievement standalone dan 26 achievement bersarang di satu project, semuanya dengan bullet ≥ 640 karakter (`START-<tag> … END-<tag>`) → satu entry lebih panjang dari satu halaman |
| Graduate `id` | tanpa experience; education, project akademik, satu achievement |
| Nama non-Latin | `李小龙`, `محمد عبدالله`, `प्रिया शर्मा` |
| Sapuan | 60 varian: ringkasan *n* baris pendek (n = 1…60) mendorong empat section berisi entry bertanda (`EA`, `PB`, `ED`, `AC`) melewati dasar halaman |

Owner B dan sentinel lintas akun untuk isolasi diuji di integration dan E2E (Fase 5–6), bukan di suite tanpa database ini.

## 5. TDD: kegagalan yang tercatat dan perbaikan template

| Run | Template | Hasil |
| --- | --- | --- |
| 1 | saat ini (`a93dc7a`) | 29 lulus, 2 gagal: (a) bug test saya (urutan `mustPrint`: project dicetak sebelum achievement standalone) — diperbaiki di test; (b) token tanpa spasi (lihat di bawah) |
| 2 | saat ini, test sudah diperbaiki dan ditambah assertion ukuran font | 35 lulus, **1 gagal**: *a long unbroken word … does not run off the page* |
| 3 | + `overflow-wrap: anywhere` pada `body` | **36 lulus** |

**Cacat yang ditemukan.** Bila sebuah string tanpa spasi lebih lebar dari kolom (mis. URL panjang di website, bullet, atau tautan), Chromium menyusutkan **seluruh dokumen** supaya muat: font 20/10/9 pt tercetak 13,33/6,67/6,00 pt (±2/3) dan sisa token terpotong (dari 150 karakter hanya 121 tercetak). Itu bukan clipping di tepi saja, melainkan seluruh CV menjadi kecil. Perbaikan §2.2.11: satu aturan break pada `body` (diwariskan ke heading, paragraf, dan list):

```css
body { …; overflow-wrap: anywhere; }
```

Alasan: aturan itu hanya mengatur *di mana teks boleh putus*; tidak mengubah font, warna, struktur, atau model. Bukti tidak ada efek samping: ukuran byte PDF fixture normal identik sebelum dan sesudah (multipage `en` 58.424 byte, `id` 54.149 byte); nama, ringkasan, dan semua bullet fixture lulus cocok-dengan-model sesudah perubahan. Setelah perubahan, token 150 karakter terbungkus di margin: 150 `b` dan 110 `a` utuh (spasi antar baris diabaikan), ukuran font tetap 20 pt, dan tak ada item melewati margin kanan.

Unit test template: satu test baru (`overflow-wrap: anywhere` pada `body`), RED lebih dulu (`Tests 1 failed | 13 passed`) lalu 14 lulus. Tidak ada test lama yang diubah.

### Uji kekuatan suite (mutasi sementara pada template, lalu dipulihkan)

| Mutasi | Hasil `pnpm test:pdf` |
| --- | --- |
| hapus `break-after: avoid` pada `h2`/`h3` | **gagal**: sapuan `orphanPages=46`; test CV multipage nyata juga gagal |
| hapus `break-inside: avoid` pada `.entry` dan `.child` | **gagal**: sapuan `splitEntries=91`; test CV multipage nyata juga gagal |
| hapus `overflow-wrap: anywhere` | **gagal**: test token panjang |
| template saat ini | 36 lulus |

Hasil mutasi membuktikan sapuan benar-benar menempatkan heading di dasar halaman (§10.2 plan). Tanpa mutasi: `headingsNearBottom=71` (heading yang jatuh di 150 pt terakhir halaman) dan `headingsPushedToNextPage=102` (heading dipindah ke halaman berikutnya padahal halaman sebelumnya masih punya ≥ 100 pt kosong); test mewajibkan ≥ 10 dan ≥ 3.

## 6. Hasil per acceptance (template saat ini)

- **§1.10 ekstraksi cocok model:** untuk lima fixture, semua string model (37, 37, 127, 127, 12 string) ditemukan berurutan, **teks sisa kosong** (tidak ada teks di luar model), tidak ada evidence/`credential_url`/UUID/`workpulse-private`/`/export/`/`null`/`undefined`/`NaN`/`Invalid Date`. Tanggal tidak diketahui tidak menghasilkan placeholder atau pemisah menggantung (`Komunitas Relawan` tanpa `· …`). Heading mengikuti bahasa CV (en/id) dan teks sumber tidak diterjemahkan. Override menggantikan teks sumber (teks sumber tidak tercetak).
- **§1.11 page break:** 60 varian, **0 halaman berakhir di heading** (section, judul entry, judul child), **0 entry terbelah** (entry tertinggi 133,7 pt, jauh di bawah tinggi konten 751 pt). Pada CV multipage nyata (9 halaman, en dan id) tidak ada halaman yang berakhir dengan heading dan **setiap bullet panjang (38 per CV) berada utuh di satu halaman**. Entry yang lebih panjang dari satu halaman ("Program Transformasi Digital") terbelah di halaman 2–7 dari 9, sesuai aturan (dicatat). Tabel varian di §7.
- **§1.12 A4 dan clipping:** setiap halaman 594,96 × 841,92 pt (A4 ± 1); setiap item teks berada di dalam margin `@page` (18 mm kiri/kanan, 16 mm atas/bawah) ± 2 pt untuk semua fixture; ukuran font tidak diskalakan (nama 20 pt, isi 10 pt, kontak 9 pt, tidak ada item < 8,5 pt). CV multipage 9 halaman (1 < 9 ≤ 20). Awal (`START-…`) dan akhir (`END-…`) setiap bullet ≥ 640 karakter ada di teks, berurutan, dan tidak terbelah.
- **§1.14 Unicode (N4):** teks Indonesia `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, `Ç Ñ ś ñ`, kutip melengkung, dan nama `Siti Nurhaliza Ç. Ñuñez` cocok setelah NFKC. Nama Han, Arab, dan Devanagari: PDF berhasil dirender (1 halaman) dan lolos pemeriksaan nama worker (`exportTextShowsName` lewat parser thread `pdf-export`); pencocokan **maju** nama itu tidak ada (`forwardMatch=false` untuk ketiganya) sedangkan heading section tercetak (`headingsPrinted=true`) dan sisa CV tetap dapat dicari (`Improved a process by 12 percent.`). Ini batas searchability per aksara dari decision 0027 N4 dan tidak diklaim lebih.

## 7. Tabel varian sapuan (60 varian, template saat ini)

Kolom halaman memuat baris terakhir halaman tersebut (teks bertanda dan koordinat y dalam pt, dibulatkan). Heading adalah `Experience`, `Projects`, `Education`, `Achievements`/`Selected achievements`, serta judul `…Judul entri` dan `…child`; tak satu pun muncul sebagai baris terakhir.

| n (summary lines) | pages | page 1: last line (y pt) | page 2 | page 3 | page 4 | orphan |
| ---: | ---: | --- | --- | --- | --- | --- |
| 1 | 3 | PB1c2 bullet pendek (82) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) |  | no |
| 2 | 3 | PB1c2 bullet pendek (67) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) |  | no |
| 3 | 3 | PB1c2 bullet pendek (53) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) |  | no |
| 4 | 3 | PB0c2 bullet pendek (183) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 5 | 3 | PB0c2 bullet pendek (169) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 6 | 3 | PB0c2 bullet pendek (155) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 7 | 3 | PB0c2 bullet pendek (140) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 8 | 3 | PB0c2 bullet pendek (126) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 9 | 3 | PB0c2 bullet pendek (111) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 10 | 3 | PB0c2 bullet pendek (96) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 11 | 3 | PB0c2 bullet pendek (82) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 12 | 3 | PB0c2 bullet pendek (68) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 13 | 3 | PB0c2 bullet pendek (53) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) |  | no |
| 14 | 3 | EA1c2 bullet pendek (213) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 15 | 3 | EA1c2 bullet pendek (199) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 16 | 3 | EA1c2 bullet pendek (184) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 17 | 3 | EA1c2 bullet pendek (170) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 18 | 3 | EA1c2 bullet pendek (156) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 19 | 3 | EA1c2 bullet pendek (141) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 20 | 3 | EA1c2 bullet pendek (126) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 21 | 3 | EA1c2 bullet pendek (112) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 22 | 3 | EA1c2 bullet pendek (98) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 23 | 3 | EA1c2 bullet pendek (83) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 24 | 3 | EA1c2 bullet pendek (69) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 25 | 3 | EA1c2 bullet pendek (54) | ED0c2 bullet pendek (174) | AC2c2 bullet pendek (198) |  | no |
| 26 | 4 | EA0c2 bullet pendek (185) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 27 | 4 | EA0c2 bullet pendek (170) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 28 | 4 | EA0c2 bullet pendek (156) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 29 | 4 | EA0c2 bullet pendek (141) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 30 | 4 | EA0c2 bullet pendek (126) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 31 | 4 | EA0c2 bullet pendek (112) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 32 | 4 | EA0c2 bullet pendek (98) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 33 | 4 | EA0c2 bullet pendek (83) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 34 | 4 | EA0c2 bullet pendek (69) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 35 | 4 | EA0c2 bullet pendek (54) | PB2c2 bullet pendek (198) | AC1c2 bullet pendek (174) | AC2c2 bullet pendek (663) | no |
| 36 | 4 | Baris ringkasan 36 (214) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 37 | 4 | Baris ringkasan 37 (200) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 38 | 4 | Baris ringkasan 38 (186) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 39 | 4 | Baris ringkasan 39 (171) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 40 | 4 | Baris ringkasan 40 (156) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 41 | 4 | Baris ringkasan 41 (142) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 42 | 4 | Baris ringkasan 42 (128) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 43 | 4 | Baris ringkasan 43 (113) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 44 | 4 | Baris ringkasan 44 (99) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 45 | 4 | Baris ringkasan 45 (84) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 46 | 4 | Baris ringkasan 46 (69) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 47 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (174) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 48 | 4 | Baris ringkasan 46 (69) | PB1c2 bullet pendek (132) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 49 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (132) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 50 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (118) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 51 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (103) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 52 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (89) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 53 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (75) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 54 | 4 | Baris ringkasan 47 (55) | PB1c2 bullet pendek (60) | AC0c2 bullet pendek (168) | AC2c2 bullet pendek (518) | no |
| 55 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (191) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |
| 56 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (176) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |
| 57 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (162) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |
| 58 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (147) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |
| 59 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (132) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |
| 60 | 4 | Baris ringkasan 47 (55) | PB0c2 bullet pendek (118) | ED1c2 bullet pendek (198) | AC2c2 bullet pendek (348) | no |

## 8. Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test:pdf` | exit 0, **1 file / 36 test** (renderer nyata `http://127.0.0.1:13401`, ±22 detik) |
| `pnpm test` | exit 0, **103 file / 954 test** (sebelumnya 953: +1 test template) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test:integration:cv-export` | exit 0, 3 file / 28 test (renderer nyata ikut; template berubah, hasil T21 tetap lulus) |

Satu error typecheck sempat muncul pada fixture (`certificationSnapshot` tidak dapat dioverride dengan tipe union) dan diperbaiki sebelum commit.

## 9. Warning dan batas

- Suite ini tidak menggambar piksel (tanpa canvas di Node); pengecekan tinta/margin pada piksel dan inspeksi gambar halaman dilakukan di Fase 6.
- `item.width` pdf.js dipercaya hanya bila dokumen tidak diskalakan; assertion ukuran font menjaga hal itu (kasus token panjang membuktikan mengapa).
- Aksara Han/Arab/Ibrani/Devanagari tetap kurang dapat dicari (N4); tidak diperbaiki karena di luar aturan break/spacing.

## 10. Langkah berikutnya

Fase 5: integration lintas lapis (`cv-export-preview.test.ts` diperluas): worker nyata + route, polling `queued` → `running` → `succeeded`, export revision lama + edit CV → `regenerate`, kedaluwarsa, dan satu kasus `inline` yang diparse pdf.js dari renderer nyata.
