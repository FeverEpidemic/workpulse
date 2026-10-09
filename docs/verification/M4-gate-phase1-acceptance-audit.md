# Gate M4 — Fase 1: audit acceptance T18–T22

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5. Read-only, tanpa edit kode.
- Sumber yang dibaca: receipt dan gate review T18–T22, decision 0024–0028, `IMPLEMENTATION_PLAN.md:277`, teks S13/S14 dari Wireframe DOCX (diekstrak dengan `python -I` + `zipfile`), kode `src/features/cv/cv-builder.tsx`, daftar nama test di `tests/{integration,e2e,unit,pdf}` dan `supabase/tests/database`, serta screenshot `T20-screenshots/cv-review-360-light.png`.
- Catatan metode: tanda di bawah merujuk ke nama test yang ada di repository. Angka dan hasil run diverifikasi ulang di Fase 0 (baseline) dan Fase 5. Acceptance tidak diaudit ulang butir per butir bila receipt dan nama test cocok; butir yang saya periksa langsung di kode ditandai.

## 1. Matriks acceptance × bukti

| Task | Acceptance (ringkas) | Tanda | Bukti konkret |
| --- | --- | --- | --- |
| T18 | First open serentak → satu CV | Terbukti | `cv-selection.test.ts:170` (lima `ensure` paralel); pgTAP `cv_selection.test.sql` |
| T18 | Draft tidak eligible | Terbukti | `cv-selection.test.ts:211`; `cv-selection.test.ts:504` (onboarding wajib) |
| T18 | Child memasukkan parent; duplikat ditolak | Terbukti | `cv-selection.test.ts:170`, `:233` |
| T18 | Mutasi child menaikkan revision CV tepat 1 | Terbukti | pgTAP `cv_selection`; `cv-selection.test.ts:259` (dua session, tanpa `40P01`) |
| T18 | Sumber dihapus/dibuka ulang saat dipilih | Terbukti | `cv-selection.test.ts:286`, `:361` (enam tipe) |
| T19 | Graduate dengan education/project menyusun CV | Terbukti | `cv-builder.test.ts:180`; E2E `cv-builder.spec.ts:156`; `cv-export.test.ts:151` |
| T19 | Wording manual tidak mengubah canonical | Terbukti | `cv-builder.test.ts:180`, `:231`, `:343` |
| T19 | Parent removal menangani child | Terbukti | `cv-builder.test.ts:298`; E2E `cv-builder.spec.ts:268` |
| T19 | Edit basi bersamaan tidak overwrite | Terbukti | `cv-builder.test.ts:269`; E2E `cv-builder.spec.ts:308`, `:353` |
| T20 | Edit sumber kedua membatalkan acknowledgement lama | Terbukti | E2E `cv-freshness.spec.ts:261`; `cv-freshness.test.ts:243` |
| T20 | Refresh mempertahankan override | Terbukti | `cv-freshness.test.ts:243`, `:323`; E2E `cv-freshness.spec.ts:223` |
| T20 | Delete/reopen sumber memblokir | Terbukti | `cv-freshness.test.ts:409`; E2E `cv-freshness.spec.ts:286`; `cv-export.test.ts:104` |
| T20 | Edit activity sumber memunculkan review tanpa overwrite | Terbukti | `cv-freshness.test.ts:368` |
| T20 | Race edit/delete/relink vs resolusi | Terbukti | `cv-freshness.test.ts:486`–`:577` (a)–(d) |
| T21 | Edit/delete/reopen berlomba dengan export | Terbukti | `cv-export.test.ts:312` (lima skenario × 3 putaran), `:204`, `:217` |
| T21 | Render gagal mempertahankan CV | Terbukti | `cv-export.test.ts:408`, `:438` |
| T21 | Lease timeout, export ganda, kedaluwarsa 24 jam | Terbukti | `cv-export.test.ts:350`, `:385`, `:452` |
| T21 | PDF A4, searchable, Indonesia, bullet panjang | Terbukti | `cv-export-renderer-real.test.ts:119`, `:156` (renderer Chromium nyata) |
| T22 | Ekstraksi cocok snapshot, tanpa evidence | Terbukti | `tests/pdf/cv-pdf-layout.test.ts:71` (lima fixture), `test:pdf` 46 |
| T22 | Heading tidak yatim, bullet tidak terbelah, tanpa clipping | Terbukti | `cv-pdf-layout.test.ts` (sapuan 60 varian, RV1) |
| T22 | URL unduhan owner-scoped ≤ 5 menit | Terbukti | `cv-export-preview.test.ts:63`, `:290` |
| T22 | Inspeksi halaman render | Terbukti sebagian | Screenshot `T22-screenshots/pdf-*.png` ada, tetapi E2E menimpanya pada setiap run (B1); inspeksi manual dilakukan reviewer sebelumnya. Gate membuka ulang sebagian di Fase 3 |
| T22 | Retry vs Regenerate, riwayat | Terbukti sebagian | Unit `cv-export-view.test.ts`, E2E `cv-export.spec.ts:472`, `:512`. Aksi hanya diuji dengan pointer (N6) → Fase 3 langkah 9 |

Tidak ada baris **Tidak terbukti**.

## 2. Peta F07 (langkah 1–6), S13 dan S14

| Langkah F07 | Test yang ada | Cakupan lintas lapis | Celah untuk gate |
| --- | --- | --- | --- |
| 1 CV unik akun, label id/en, template A4 | `cv-selection.test.ts:170`, E2E `cv-builder.spec.ts:251` | UI + DB | — |
| 2 Pilih dan urutkan; child → parent; standalone di *Selected achievements* | E2E `cv-builder.spec.ts:156`, `cv-export.spec.ts:320` | UI + DB | Masuk dari S04/S08 lalu S13 → S14 satu alur: belum ada |
| 3 Layout awal tanpa AI; override terpisah | `cv-builder.test.ts:231`, `:180` | DB + service | Pembuktian AI = 0 pada alur export: belum eksplisit |
| 4 Simpan → S14 revision persis; validasi | E2E `cv-export.spec.ts:320`, `:389`; `cv-export.test.ts:151` | UI + DB + worker | — |
| 5 Sumber berubah → S13 → Keep → siap; hilang → hapus/perbaiki | E2E `cv-export.spec.ts:414`, `:443`; `cv-freshness.spec.ts:223`, `:261`, `:286` | UI + DB | Alur lintas S08 (edit) → S13 → S14 → PDF dengan override tercetak, dan delete dari S07, belum satu alur |
| 6 Export terikat snapshot; sukses/gagal/Retry; edit berjalan tidak mengubah | `cv-export.test.ts:204`, `:217`, `:408`; E2E `cv-export.spec.ts:472` | UI + DB + worker | Retry/Regenerate/Download via keyboard (N6); sha256 PDF lama setelah export baru |

S13 (Wireframe: unsaved, saved, changed source, manual override, deleted source, unconfirmed source; Keep wording / Replace from source; satu CV saja; move accessible):

| State S13 | Bukti |
| --- | --- |
| unsaved / saved / konflik | E2E `cv-builder.spec.ts:156`, `:308`; unit `cv-builder-state.test.ts` |
| changed source | E2E `cv-freshness.spec.ts:183` |
| manual override | E2E `cv-freshness.spec.ts:223`, `cv-builder.spec.ts:156` |
| deleted source | E2E `cv-freshness.spec.ts:286`, `cv-export.spec.ts:414` |
| unconfirmed source | E2E `cv-freshness.spec.ts:286` |
| Keep / Replace; tanpa overwrite diam-diam | E2E `cv-freshness.spec.ts:223`, `:342` |
| move aksesibel | E2E `cv-builder.spec.ts:156`, `:439` |

S14: snapshot persis (`cv-export.spec.ts:389`, `:564`), navigasi halaman (`:320`, `:538`), status export (`:320`), blocker bertaut S13 (`:414`, `:443`), Retry vs Regenerate (`:472`, `:512`), unduhan lewat URL pendek (`cv-export-preview.test.ts:63`), tanpa evidence (`cv-pdf-layout.test.ts:71`). Seluruh state Wireframe punya bukti.

## 3. Skenario rilis PRD yang relevan

| Skenario | Bukti yang ada | Yang dibuat gate |
| --- | --- | --- |
| Graduate tanpa CV/employment → education + project akademik → capture → confirm → export | `cv-export.test.ts:151` (service, SQL seed), E2E `cv-export.spec.ts:320` | E2E M4 langkah 1–5 lewat UI penuh dari onboarding (Fase 3) |
| Edit achievement terpilih setelah override → refresh tanpa kehilangan override → hapus sumber → export terblokir | `cv-freshness.test.ts:243`, `cv-export.test.ts:104` | E2E M4 langkah 6–8; integration M4 skenario 3–4 dengan sha256 |
| Ownership dua akun + ekstraksi PDF, Indonesia, bullet panjang, multipage | `cv-export.test.ts:494`, `cv-export-preview.test.ts:63`, E2E `cv-export.spec.ts:595`, `cv-export-renderer-real.test.ts:119`, `:156` | E2E M4 langkah 10; integration M4 skenario 11–12 (semua RPC/route/action CV) |

## 4. Celah lintas domain yang menjadi skenario gate

| # | Celah | Skenario gate |
| --- | --- | --- |
| G1 | Tidak ada test yang menghubungkan data import (experience, achievement hasil commit) ke CV, lalu membersihkan batch dan memeriksa CV/export | Integration M4-1 |
| G2 | Delete activity sumber achievement terpilih hanya diuji untuk freshness (`cv-freshness.test.ts:368`); belum untuk export dan sha256 | Integration M4-2 |
| G3 | PDF lama tidak pernah dibandingkan dengan byte sebelum perubahan, kecuali `cv-export-preview.test.ts:312` (satu export) | E2E langkah 8; integration M4-2/3 |
| G4 | Export dengan blocker diuji untuk achievement saja di jalur export; project, experience, education, skill, certification hanya lewat freshness/readiness unit | Integration M4-4 |
| G5 | `ITEM_UNCONFIRMED` hanya sebagai race (`cv-export.test.ts:267`); belum reopen → confirm ulang → export | Integration M4-5 |
| G6 | Relink project ke experience lain setelah achievement kontekstual dipilih: freshness saja (`cv-freshness.test.ts:368`), belum PDF tanpa duplikat | Integration M4-6 |
| G7 | Evidence `ready` di achievement/project terpilih tidak pernah ada di fixture export (assertion `not.toContain("evidence")` hanya pada teks tanpa evidence) | Integration M4-7 |
| G8 | `PROFILE_CHANGED` → Keep → export, dan edit kedua membatalkan acknowledgement, hanya race (`cv-export.test.ts:297`) | Integration M4-8 |
| G9 | Retry/Regenerate/Download dengan keyboard | E2E langkah 9 |
| G10 | Dashboard akun B tidak boleh memuat judul A: tidak ada assertion | E2E langkah 10 |
| G11 | Penghitung adapter AI = 0 selama alur CV: tidak ada | Integration M4-10 |

## 5. P3 terbuka dan acceptance "tidak dijalankan"

| ID | Level lama | Level gate | Alasan | Tindakan |
| --- | --- | --- | --- | --- |
| T18 F1 flaky `test:e2e:activity` | P3 | P3 | Tidak muncul di baseline gate; penyebab tidak terkonfirmasi | Catat; ulang di Fase 5 |
| T18 F3 race tidak deterministik | P3 | P3 | Diterima; gate menambah putaran lewat skenario 9 | Catat |
| **T20 F1** fokus hilang setelah `CV_SOURCE_CHANGED` | P3 | **P2** | Diperiksa di kode: `cv-builder.tsx:150-158` mengosongkan `openReviews` dan memanggil `router.refresh()`; panel review yang memuat tombol aksi yang sedang fokus ter-unmount. `pendingFocus` sudah di-null di `cv-builder.tsx:186`, dan efek fokus hanya jalan saat `savedKey` berubah (`:74`, `:126-130`), padahal edit sumber tidak mengubah `savedKey`. Hasilnya fokus jatuh ke `body`. Handoff §2.3 menyebut "fokus hilang setelah konflik" sebagai contoh P2, dan kehilangan fokus tanpa pemulihan melanggar WCAG 2.2 SC 2.4.3 untuk pengguna keyboard | Reproduksi sebagai test gagal lalu perbaiki (Fase 6) |
| T20 F2 tabel review 360 px | P3 | P3 | Screenshot `cv-review-360-light.png` dibuka: tidak ada overflow horizontal dan tidak ada konten terpotong (SC 1.4.10 terpenuhi), tetapi kolom label memotong kata (`Descripti`/`on`) dan kolom nilai sempit. Ini keterbacaan, bukan hilangnya konten atau fungsi | Follow-up (susun bertumpuk di bawah breakpoint) |
| T20 F3 copy unconfirmed / `parentAdded` | P3 | P3 | Copy | Follow-up |
| T20 F4 assertion ganda M2 | P3 | P3 | Dikonfirmasi: `m2-manual-journey.spec.ts:339` dan `:341` identik | Follow-up (jangan diubah di gate: suite lama) |
| T20 F6 biaya baca freshness | P3 | P3 → T24 | Perlu diukur pada fixture T24 | T24 |
| T21 N2 Retry tanpa validasi ulang | P3 | P3 → T23 | Dibekukan di `T23-implementation-plan.md` §2.4.6–7 | T23 |
| T21 N3 kolom snapshot/key terbaca pemilik via PostgREST | P3 | P3 | Policy storage menutup bucket; tidak ada akses objek tanpa signed URL. Diverifikasi lagi di Fase 2 | Catat |
| T21 N4 searchability Han/Arab/Ibrani/Devanagari | P3 | P3 | Batas ToUnicode Chromium; di luar kriteria §1.7 (Latin/Indonesia) | Catat; scope kriteria dinyatakan di laporan |
| T21 N5 rute LibreOffice di renderer; timeout 90 s vs 80 s | P3 | P3 → T25 | Hardening | T25 |
| T21 N6 export hampir kedaluwarsa dipakai ulang | P3 | P3 | T22 menutup dari sisi UI (`cv-export.spec.ts:512` Regenerate) | Catat |
| T21 N7 biaya reconcile | P3 | P3 → T24 | Perlu ukuran | T24 |
| T21 N8 trim NBSP SQL vs TS | P3 | P3 | Hanya nama NBSP via RPC langsung | Catat |
| T22 N1 copy *failed* ganda | P3 | P3 | Copy; akan terlihat di E2E gate langkah 9 | Catat |
| T22 N2 satu canvas | P3 | P3 | Diterima (decision 0028) | — |
| T22 N3 / B1 E2E menulis ulang screenshot ter-track | P3 | P3 | Dikonfirmasi di Fase 0 (24 PNG berubah) | Catat; `git restore` setelah run |
| T22 N4 → T23 | P3 | P3 → T23 | Dibekukan | T23 |
| T22 N5 tiga query paralel | P3 | P3 | Dijaga `expected_revision` | Catat |
| **T22 N6** Retry/Regenerate/Download belum diuji keyboard | P3 | P3 bersyarat | Tombol standar. Kriteria §1.9 mewajibkan bukti keyboard; jika langkah 9 gagal dengan keyboard, naik ke P2 | Fase 3 langkah 9 |
| T22 N7 flaky `activity-ui.spec.ts:356` | P3 | P3 | Catat saat Fase 5 | Fase 5 |
| T22 N8 kolom preview sticky | P3 | P3 | Diterima | — |

Acceptance "tidak dijalankan" dari bukti T18–T22: `test:e2e` gabungan, `test:ai:live` (tanpa AI), stres race berskala, p95 (T24), staging/production. Gate ini juga tidak menjalankannya (lihat batas di laporan akhir).

## 6. Hasil dan langkah berikutnya

- Tidak ada acceptance **Tidak terbukti**; dua baris **Terbukti sebagian** (inspeksi halaman PDF, Retry/Regenerate keyboard) ditutup oleh Fase 3.
- Satu temuan naik ke **P2**: T20 F1 (fokus). Akan direproduksi dengan test gagal, lalu diperbaiki di Fase 6.
- Sebelas celah lintas domain (G1–G11) menjadi skenario E2E dan integration gate.
- Blocker: tidak ada. Lanjut Fase 2.
