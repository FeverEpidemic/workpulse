# T26 Fase 2: domain extractor

Tanggal: 18 Oktober 2026. Pelaksana: Claude (Opus 5.5).

## Tujuan

`extractImportByRules(text)` murni yang mengusulkan kandidat `import.v1` (profil, experience, education, skills) dengan aturan §2.2.6, lulus `validateImportResult` tanpa kandidat terbuang, dan aman terhadap input jahat.

## File berubah

- Baru: `src/domain/import/rules-extract.ts` (398 baris, satu file; `rules-patterns.ts` tidak diperlukan).
- Baru: `tests/unit/import-rules-extract.test.ts` (35 test).
- Diubah: `tests/import-fixtures.ts` (fixture teks CV sintetis T26, orang dan perusahaan fiktif).
- Diubah: `src/domain/import/extract-result.ts`, hanya `export` pada `MONTHS` agar extractor memakai daftar bulan yang sama dengan validator (§2.2.6). Perilaku validator tidak berubah.

## Fixture

`RULES_CV_EN`, `RULES_CV_ID` (satu kolom en/id), `RULES_CV_DATE_VARIANTS` (`to`, `now`, `current`, `saat ini`, `s/d`, `Sep.`), `RULES_CV_NO_HEADINGS`, `RULES_CV_UNDATED_EXPERIENCE`, `RULES_CV_TWO_COLUMN` (dua kolom terbaca bersamaan), `RULES_HOSTILE_LINES` (14 baris; 12 di bawah 500 karakter sehingga semua pola benar-benar dijalankan, 2 di atasnya). Variasi pemisah (`at`, `|`, `–`, `,`, dua baris), intern/magang dan relawan, skills berlabel, dan heading penutup ada di fixture en/id.

## Keputusan implementasi dalam batas §2.2.6

- **Pengelompokan entri.** Satu run baris non-bullet dipecah per jangkar tanggal. Bila run diawali tanggal tanpa teks lain, entri dimulai di jangkar (tanggal, role, organisasi); selain itu entri berakhir di jangkar (maks. dua baris sebelum jangkar). Maks. tiga baris header per entri; bullet setelah run masuk entri terakhirnya.
- **Role/organisasi.** Pemisah pada baris header pertama diutamakan; selain itu dua baris berarti role lalu organisasi; satu baris tanpa pemisah memberi `null` untuk keduanya. `-` tanpa spasi bukan pemisah (`Front-end Developer`).
- **Excerpt.** Potongan teks asli dari baris header pertama sampai bullet terakhir yang masih muat dalam 1.000 karakter; description hanya berisi bullet yang ikut excerpt, sehingga angka di description selalu ada di excerpt.
- **Profil.** Excerpt dari awal blok header sampai baris terakhir yang dipakai, diperluas ke isi bagian summary bila potongannya tetap ≤ 1.000 karakter (bila tidak, summary `null`). Nama wajib 2-5 kata Title Case atau huruf besar, tanpa angka, `@`, atau URL; `Curriculum Vitae`, `Resume`, dan `Daftar Riwayat Hidup` tidak dianggap nama. Domain telanjang hanya dianggap website bila diawali `www.`, memuat `/`, atau ber-TLD umum (`com`, `id`, `net`, `org`, `io`, `dev`, `me`, `co`, `app`, `info`, `biz`, `xyz`), agar `S.Kom` tidak terbaca sebagai situs.
- **Batas.** Baris > 500 karakter bukan heading, jangkar, atau sumber kontak; baris skills > 1.000 karakter dilewati; maksimal 60 kandidat per tipe (batas validator dan database).
- **Pola.** Tanpa quantifier bersarang yang ambigu; regex email/domain memakai label yang dipisah titik sehingga tidak ada backtracking eksponensial. Regex global hanya dipakai lewat `matchAll`/`replace`.

## Commands dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm exec vitest run tests/unit/import-rules-extract.test.ts` sebelum implementasi | gagal: `Cannot find package '@/domain/import/rules-extract'` |
| sama, setelah implementasi | **35/35 lulus** |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | **120 file / 1119 test lulus** (sebelumnya 119/1084) |
| `node -e "import('./src/domain/import/rules-extract.ts')..."` | modul termuat di Node type stripping (syarat worker) |

Angka waktu (mesin lokal, Windows, Node 24.18): baris jahat **maks. 0,57 ms** dari 70 run (batas 50 ms); CV 60.000 karakter **9,1 ms** (batas 1 detik), 60 experience.

## Acceptance yang terbukti

- **5:** untuk enam fixture teks, `validateImportResult(extractImportByRules(text), text)` `ok: true` dan `dropped_ungrounded === 0`; setiap excerpt adalah potongan verbatim ≤ 1.000 karakter; `certifications` dan `achievements` selalu kosong.
- **6:** heading en/id case-insensitive dengan `:`; heading panjang atau berangka ditolak; pemisah role/organisasi; `Mon YYYY`, `MM/YYYY`, `YYYY`, kata present → `is_current: true` dan `end: null`, `day` selalu `null`; `kind` hanya `internship`/`volunteer` atau `null`; skills dipecah `,` `;` `•` `|` tanpa memecah `CI/CD`, label dibuang, duplikat case-insensitive dibuang, token > 50 karakter atau > 5 kata dibuang, maks. 60; isi di bawah heading penutup diabaikan. Kasus negatif (tanpa heading, experience tanpa tanggal, dua kolom) tidak crash dan tidak menghasilkan entri.
- **7 (bagian unit waktu):** baris jahat dan teks 60k jauh di bawah batas. Bagian thread (heap/timeout) dibuktikan di Fase 3.

## Warning

Tidak ada. Test waktu memakai `console.info` agar angka tercatat di output Vitest.

## Blocker

Tidak ada.

## Berikutnya

Fase 3: parser thread (`extract: true`), worker import, gateway, service dan route upload.
