# T22 Fase 7b — Remediasi review RV1

- Tanggal: 8 Oktober 2026.
- Pelaksana: Claude (Opus), reviewer yang sama. Pengguna menyetujui (8 Oktober 2026, "Setuju, kamu kerjakan RV1 sendiri") agar perbaikan dikerjakan reviewer. Karena itu review ulang tidak independen penuh.
- Basis: `93174e8` (gate review). Commit perbaikan: `369b016`.
- Status: **selesai**. RV1 ditutup dan tidak ada P0–P2 terbuka. Rencana: `T22-review-remediation-plan.md`.

## 1. Tujuan dan file berubah

RV1: entry teratas yang lebih tinggi dari satu halaman tidak boleh lagi dipindah utuh ke halaman berikutnya sehingga halaman sebelumnya kosong.

| Aksi | File |
| --- | --- |
| Modify | `src/server/export/cv-print-template.ts`: dua aturan CSS, fungsi murni `minEntryHeightPt` dan `entryFlowsAcrossPages`, serta kelas `entry entry-flow` pada `renderEntry` |
| Modify | `tests/pdf/fixtures.ts`: tiga fixture `longEntryFirst`, `longExperience(summaryLines)`, dan `nearlyPageEntry` |
| Modify | `tests/pdf/pdf-layout.ts`: helper `CONTENT_HEIGHT`, `blockExtent`, dan `bottomGaps` |
| Modify | `tests/pdf/cv-pdf-layout.test.ts`: blok RV1 berisi 10 test; log celah lama diganti assertion di blok RV1 |
| Modify | `tests/unit/cv-print-template.test.ts`: dua test baru; test lama tidak diubah |
| Modify | `docs/verification/T22-screenshots/`: screenshot run E2E sesudah perbaikan. CV panjang kini 8 halaman, jadi `pdf-{en,id}-page-9.png` yang basi dihapus |

Tidak ada perubahan font, warna, struktur konten, model, preview S13, worker, SQL, atau dependency.

## 2. Aturan template dan alasannya

```css
.entry-flow { break-inside: auto; page-break-inside: auto; }
.entry-flow > .entry-meta, .entry-flow > .entry-text { break-after: avoid; page-break-after: avoid; }
```

- **`entry-flow`**: entry yang ditandai boleh terbelah di antara child-nya. `.child` tetap `break-inside: avoid`, jadi setiap bullet tetap utuh. Entry lain tetap `break-inside: avoid` (§1.11).
- **Kepala entry**: meta dan teks entry yang mengalir tidak boleh menjadi baris terakhir halaman tanpa child pertamanya. `h3` sudah `break-after: avoid`. Uji mutasi §4 menunjukkan aturan ini memang diperlukan.
- **Penanda.** `entryFlowsAcrossPages(entry)` bernilai true bila `minEntryHeightPt(entry)` lebih dari tinggi area teks (A4 841,89 pt − 2 × 16 mm ≈ 751 pt).
  - Taksiran adalah batas bawah untuk teks biasa: 120 karakter per baris (kolom 493 pt menampung sekitar 95–100 karakter Noto Sans 10 pt), `line-height` 1,45, meta 9 pt, dan margin template.
  - Baris baru dihitung untuk teks `pre-line`. Child yang dihapus tidak dihitung.
  - Dengan begitu entry yang ditandai benar-benar lebih tinggi dari halaman, dan entry yang muat tidak pernah dibiarkan terbelah.

## 3. TDD: gagal sebelum perbaikan

Template di `93174e8` (`pnpm test:pdf`): **9 gagal**, 36 lulus (45).

| Test | Kegagalan sebelum perbaikan |
| --- | --- |
| CV bentuk E2E en/id: project dimulai di halaman 1 | `page 1 holds more than the profile header: expected 1 to be greater than 1` (halaman 1 hanya nama) |
| Celah halaman `long entry first` en/id | `page 1 leaves 732 pt` |
| Celah halaman `owner A long` en/id | `page 1 leaves 436 pt` |
| Celah halaman `long experience` | `page 1 leaves 343 pt` |
| Experience panjang dimulai di halaman 1 | halaman 1 hanya profil dan ringkasan |
| Hanya entry > 1 halaman yang ditandai | tidak ada entry yang ditandai |

Sesudah perbaikan semua test lulus.

| Fixture | Halaman | Celah per halaman (pt) | Batas (child terpanjang + 72) |
| --- | ---: | --- | ---: |
| long entry first (en) | 5 | 116, 89, 89, 89 | 198 |
| long entry first (id) | 5 | 116, 89, 17, 17 | 213 |
| owner A long (en) | 9 | 88, 89, 89, 89, 89, 56, 73, 73 | 198 |
| owner A long (id) | 9 | 88, 89, 46, 17, 17, 165, 48, 73 | 213 |
| long experience (id) | 2 | 35 | 140 |

Entry yang ditandai dan tinggi terukurnya (posisi y pdf.js, dijumlah per halaman):

| Fixture | Entry | Tinggi |
| --- | --- | --- |
| long entry first (en) | Program Transformasi Digital | 3222 pt, halaman 1–5 |
| owner A long (en) | Program Transformasi Digital | 3482 pt, halaman 1–6 |
| long experience | Kepala Operasional | 943 pt, halaman 1–2 |

Entry hampir satu halaman (`nearlyPageEntry`, 647 pt = 86% area teks) tidak ditandai dan tidak terbelah: seluruhnya di halaman 2. Fixture `owner A` dan `graduate` tidak punya entry yang ditandai.

## 4. Uji mutasi (sementara, lalu dipulihkan)

| Mutasi | Hasil (subset RV1 + sapuan + multipage) |
| --- | --- |
| Tidak pernah menandai `entry-flow` | **gagal**: 9 test |
| Hapus aturan `.entry-flow { break-inside: auto }` | **gagal**: 8 test |
| Hapus aturan kepala (`break-after: avoid` pada meta/teks) | **gagal** pada sapuan kepala: 6 dari 36 varian (`n=37..42`) menaruh kepala experience di dasar halaman 1 tanpa child pertamanya. Sebelum sapuan kepala ditambahkan, mutasi ini tidak tertangkap, sehingga sapuan itu ditambahkan |
| Template sesudah perbaikan | sapuan kepala 36 varian: 0 masalah, 6 varian menaruh kepala di 200 pt terakhir halaman |

Sapuan 60 varian lama tidak berubah: `orphanPages=0 splitEntries=0 headingsNearBottom=71 headingsPushedToNextPage=102 maxEntryHeight=133.7pt`.

## 5. Inspeksi gambar halaman (E2E, renderer nyata)

Saya membuka `pdf-en-page-1.png`, `pdf-id-page-6.png`, dan `pdf-id-page-8.png` hasil run sesudah perbaikan.

- **Halaman 1** kini memuat nama, heading *Projects*, judul *Program Transformasi Digital*, meta, dan child *Hasil program 1–4* lengkap (`START-…`/`END-…`). Sebelumnya halaman ini hanya berisi nama.
- **Halaman 6** dimulai dengan heading *Pencapaian* bersama entry pertamanya.
- **Halaman 8** (terakhir) memuat *Pencapaian 11–12*.
- Tidak ada heading yatim, teks terpotong, atau bullet terbelah.
- CV panjang E2E kini **8 halaman** per bahasa (sebelumnya 9).

## 6. Command dan hasil

Env per command: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`. `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm test:pdf` (sebelum perbaikan) | 1 | 9 gagal / 36 lulus (45) |
| `pnpm test:pdf` | 0 | 1 file / **46 test** |
| `pnpm lint` | 0 | lulus |
| `pnpm typecheck` | 0 | lulus |
| `pnpm test` | 0 | 103 file / **956 test** (+2 unit template) |
| `pnpm test:integration:cv-export` | 0 | 3 file / 35 test (worker + renderer nyata dengan template baru) |
| `pnpm worker:check` | 0 | lulus |
| `pnpm build` | 0 | route `ƒ /cv/preview` terdaftar |
| `pnpm test:e2e:cv-export` | 0 | **12 passed** (2,5 menit) |
| `git diff --check` | 0 | bersih |

Tidak dijalankan ulang setelah perbaikan: suite domain lain (T02–T20, M2/M3), `db:test`, dan `db:lint`. Perubahan hanya menyentuh template cetak dan test PDF. Hasil suite itu pada `d68ad3e` tercatat di §4 rencana remediasi.

## 7. Sisa

- P3 N1–N8 di rencana remediasi tetap follow-up atau diterima.
- Dalam sapuan, satu entry yang muat satu halaman tetapi tidak muat sisa halaman masih pindah utuh ke halaman berikutnya. Celahnya dibatasi tinggi entry itu sendiri; ini konsekuensi aturan §1.11 yang disetujui.
- Taksiran 120 karakter per baris adalah batas bawah untuk teks prosa. Teks patologis dari glyph sangat sempit (mis. ratusan `i`) dapat membuat taksiran meleset; dampaknya terbatas pada satu entry yang terbelah di antara child.
- Langkah berikutnya: Fase 8 plan (decision 0028, `T22-saved-preview-pdf-qa.md`, README), lalu closeout T22.
