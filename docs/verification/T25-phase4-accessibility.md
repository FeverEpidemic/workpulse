# T25 Fase 4 — Aksesibilitas, responsive, keyboard, dan copy S12

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- Mode antislop: **during** (pilihan pengguna di sesi ini). Skill yang dibaca sebelum menyentuh UI atau copy: core, `antislop-human`, `antislop-copywriting`, `antislop-layoutmobile`, `antislop-ui` (daftar checklist).
- Tidak ada migration. Perubahan source: `src/styles/tokens.css`, `src/app/globals.css`, `src/i18n/messages.ts`, `src/features/account/delete-account-card.tsx`.

## Tujuan dan hasil

Menutup D3 (kontras), D4 (matriks layar, teks 200%, snapshot aria), D5 (keyboard), D6 (bundle browser), D7 (kalimat S12).

| File | Aksi |
| --- | --- |
| `tests/unit/theme-contrast.test.ts` | create (5 test, 37 pasangan token, dua tema) |
| `tests/unit/account-deletion-i18n.test.ts` | +1 test kalimat S12 (gagal lebih dulu) |
| `playwright.release.config.ts`, script `test:e2e:release` | create, port **3017**, `next build && next start`, `workers: 1` |
| `tests/e2e/release-a11y.spec.ts` | create (10 test) |
| `tests/e2e/release-keyboard.spec.ts` | create (5 test) |
| `tests/e2e/helpers/release-fixture.ts` | create (akun dan data; di luar daftar §4, dipakai bersama kedua spec) |
| `tests/e2e/helpers/accessibility.ts` | +`collectWcagViolations` (aturan Axe yang sama, dikembalikan bukan di-assert) |
| `docs/verification/T25-screenshots/` | 88 PNG (20 keadaan layar × 4 + 8 Indonesia), `<screen>-<width>-<theme>.png`, email ditutup (mask) |
| `docs/verification/T25-aria/` | 5 snapshot accessibility tree terkunci |

## Defect yang ditemukan dan diperbaiki (test gagal lebih dulu)

| ID | Prio | Temuan | Perbaikan | Commit |
| --- | --- | --- | --- | --- |
| D9 | P2 | Tema **dark**: tepi kontrol `--color-border-control` `#65746a` pada `--color-bg-elevated` `#222b25` = **2,96:1** (< 3:1, WCAG 1.4.11). Terlihat pada tepi input di dalam dialog (mis. password di dialog penghapusan akun). Tema light lulus semua. | `#6a796f` (3,18:1 pada elevated, 3,38:1 pada subtle); tidak terlihat berbeda secara visual | `55a17b3` |
| D10 | P3 | Tema dark: teks yang diseleksi (`::selection`) memakai `--color-text-primary` `#f1f5f2` di atas `--color-primary-200` `#d1e0cc` = **1,25:1**; seleksi tidak terbaca. | Token baru `--color-selection-bg` (light `#d1e0cc`, dark `#435e45` = 6,52:1) dipakai `::selection` | `55a17b3` |
| D11 | P2 | Dengan font-size root 200%, satu kata panjang pada judul achievement ("Mempercepat") mendorong S08 menjadi **410 px pada viewport 320 px** (dan overflow yang sama pada 360 px): scroll horizontal dokumen. Kata dari pengguna dapat panjang. | `overflow-wrap: anywhere` pada `.workspace-content` dan `.ui-dialog-panel` | `cd3b964` |

Tidak ada pelanggaran Axe pada 80 tampilan (20 keadaan layar × 360/1440 × light/dark) dan 8 tampilan Indonesia. Tidak ada error konsol browser.

## Hasil

| Command | Hasil |
| --- | --- |
| `vitest run tests/unit/theme-contrast.test.ts` (sebelum perbaikan token) | gagal: dark `border-control` pada elevated 2,96; dark `text-primary` pada `primary-200` 1,25 |
| `vitest run tests/unit/theme-contrast.test.ts` | exit 0, 5 test |
| `vitest run tests/unit/account-deletion-i18n.test.ts` (sebelum key) | gagal: kalimat belum ada |
| `vitest run tests/unit/account-deletion-i18n.test.ts` | exit 0, 6 test |
| `playwright test --config playwright.release.config.ts` (satu run, golden dibandingkan) | **15 passed** (5,0 menit, build produksi) |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **123 file / 1086 test** (baseline 114/1041: +16 test dari T25; sisanya +29 test dan +7 file dari config Storybook sesi lain) |

Catatan eksekusi Playwright: di working tree ini `pnpm exec playwright` memanggil `playwright@1.64.0` (hasil `"playwright": "latest"` yang ditambahkan perubahan Storybook sesi lain) sementara `@playwright/test` terkunci di `1.63.0`, sehingga runner menolak `test.beforeAll()`. Suite dijalankan lewat `node node_modules/@playwright/test/cli.js test …`, yang memakai versi yang cocok. Di HEAD yang bersih (tanpa perubahan Storybook) `pnpm test:e2e:release` memakai biner yang benar.

## Isi pemeriksaan

**Matriks (§1.8).** Untuk setiap keadaan layar di 360×800 dan 1440×900, light dan dark: konten data tampil (bukan empty/skeleton), tepat satu `h1`, tepat satu `main`, `lang="en"`, `data-theme` sesuai, `scrollWidth <= clientWidth`, Axe WCAG 2.2 A/AA, tanpa error konsol, screenshot.

Keadaan layar: S01 masuk; S02 impor (akun kosong); S03 review impor (batch nyata dari S02 + worker); S04 dashboard berisi dan kosong; S05 catatan dan form; S06 daftar berisi, daftar kosong, detail; S07 daftar; S08 confirmed dan draft; S09 daftar; S10 detail; S11 timeline; S12 pengaturan dan dialog penghapusan akun terbuka (counts termuat); S13 CV; S14 preview dengan export PDF sukses (renderer nyata).

**Indonesia.** Akun berlocale `id`: S04, S05, S12, S13 pada dua lebar, `lang="id"`, Axe, tanpa overflow.

**Teks 200% (§1.10).** `html { font-size: 200% }` pada 720 px (1440 px pada zoom 200%), 360 px, dan 320 px (lebar sempit WCAG 1.4.10): S04, S05, S08, S13 tidak memotong teks (`overflow` bukan `visible` dan `scrollWidth`/`scrollHeight` melebihi kotak, kecuali kutipan tiga baris di daftar activity yang disengaja) dan tidak menambah scroll horizontal.

**Proxy screen reader (§1.11).** `body.ariaSnapshot()` untuk S04, S05, S08, S13, S14 dikunci di `docs/verification/T25-aria/`, dinormalisasi (UUID, email, jam), dan dibandingkan pada run berikutnya (run kedua lulus tanpa perubahan). Tambahan: setiap snapshot punya heading dan tidak ada kontrol tanpa nama.

**Keyboard (§1.9).** Journey tanpa mouse: sign-in → skip link → Quick log → simpan activity → Create Achievement → isi dan **Confirm** → **Add to CV** → tombol Add → tautan preview → `/cv/preview`. Setiap Tab stop dicek: ring (outline atau box-shadow) ≥ 2 px dan ≥ **3:1** terhadap warna di belakangnya (latar induk, karena ring berada di luar kotak dengan offset 2 px). Empat dialog: drawer navigasi 360 px, dialog hapus bernama (project), dialog "Leave without saving?", dialog penghapusan akun, masing-masing dibuka dengan Enter dan Space, ditutup dengan Escape, dan fokus kembali ke pemicu. Konflik revisi (dua tab) tampil sebagai panel di halaman, bukan dialog, dan dioperasikan dengan keyboard.

**Kalimat S12 (§1.12).** Satu kalimat di kartu "Privacy and account" (S12), paragraf sendiri sebelum paragraf penghapusan, `text-sm` warna `--wp-muted` (sama dengan saudaranya):

- en: "WorkPulse records which actions happen, such as saving an activity or exporting a CV, without their content, to measure how reliably the product works."
- id: "WorkPulse mencatat jenis aksi yang terjadi, seperti menyimpan aktivitas atau mengekspor CV, tanpa isinya, untuk mengukur keandalan produk."

Isi kalimat ditegaskan oleh T24: trigger mencatat nama aksi (`activity_saved`, `career_record_created`, `achievement_confirmed`, `import_committed`, `cv_export_finished`) dengan properti dari allowlist, dan pgTAP serta integration product-events membuktikan tidak ada teks, nama file, id, atau email di kolom event. Kalimat ini sama untuk semua akun (trigger berlaku untuk semua akun; hanya laporan T24 yang memfilter peserta pilot).

**Bundle browser (D6).** Pemindaian 38 file `.next/static` (2,1 MB) dan HTML `/sign-in` dan `/`: nol `sb_secret_`, nol nama variabel rahasia server (`SUPABASE_SECRET_KEY`, `WORKPULSE_OPENAI_API_KEY`, `WORKPULSE_AI_MODE`, `SERVICE_ROLE_KEY`), nol nilai key server dari env, dan setiap JWT yang ditemukan dibaca payload-nya: tidak ada yang berperan `service_role`.

## Bukti penjaga dapat gagal (§2.2.4)

- Kontras: unit "fails by token name on a colour it cannot parse" dan pemeriksaan hitung rasio (hitam/putih 21; `#777777` 4,48; putih/`#999999` 2,85). Run awal gagal dengan dua pasangan nyata (D9, D10).
- Ring fokus: test pada DOM sintetis melaporkan "tanpa ring", "ring 1 px", dan "ring terlalu pucat", dan menerima ring gelap 2 px.
- Layout dan Axe: test pada DOM sintetis melaporkan halaman 900 px di viewport 360 px, dua `h1`, tombol tanpa nama, dan gambar tanpa `alt`; dokumen bersih tidak dilaporkan.
- Helper kontras ring pernah salah menghitung latar (memakai latar tombol itu sendiri, 1,41:1); diperbaiki menjadi latar induk karena outline berada di luar kotak. Itu cacat pengukuran, bukan cacat produk.
- Snapshot aria: perbedaan teks apa pun gagal dengan nama layar.

## Delivery Gate antislop dan Human Skill Checklist (layar yang diubah: S12, token warna, tata letak teks)

| Gate | Jawaban dan bukti |
| --- | --- |
| R-02 em dash | Tidak ada; test i18n menolak `—` pada kedua bahasa |
| R-03 mobile | PASS: matriks 360 px tanpa overflow; teks 200% pada 720/360/320 px |
| R-17/R-18/R-36/R-38 klaim | PASS: kalimat menyatakan perilaku nyata (T24), tanpa angka, tanpa klaim keamanan baru |
| R-23/R-24/R-26 | PASS: tidak ada aset, navigasi, atau kontrol baru |
| R-25 kontras | PASS: 37 pasangan dihitung di dua tema (≥ 4,5 teks, ≥ 3 non-teks) dan Axe `color-contrast` bersih |
| R-27 state | Tidak berubah (kartu tidak memuat data) |
| R-32 keyboard | PASS: journey, empat dialog dan panel konflik; ring ≥ 3:1 di setiap Tab stop |
| R-34 tema | PASS: kedua tema pada 20 keadaan layar |
| R-35 diverifikasi | PASS: build produksi dijalankan; klik-tembus oleh spec: dialog hapus, drawer, Leave without saving, Delete account, Confirm, Add to CV, preview, Save changes dan Review and retry |
| R-31 alasan | Kalimat di kartu S12 karena wireframe S12 menaruh penjelasan retensi di "privacy detail" dan kartu itu satu-satunya detail privasi; paragraf terpisah agar kalimat penghapusan tidak berubah; urutan: informasi umum dulu, tindakan hapus setelahnya |
| Block 2 (R-01, R-04 … R-22) | PASS: tidak ada gradien, ikon, badge, glow, bayangan, animasi, atau ilustrasi baru |
| Block 3 liveliness | Tidak berlaku: bukan layar baru; arah visual dari `Design.md` tidak diubah (satu paragraf dan dua nilai token) |
| Human checklist | Kontras terverifikasi dengan skrip dan tes; non-teks 3:1; fokus terlihat di dua tema; keyboard dan Escape; empty/loading/error tidak berubah dan dicakup matriks; 200% tanpa pemotongan |

## Temuan non-defect

| ID | Prio | Temuan |
| --- | --- | --- |
| O9 | P3 | Landmark `region "Your workspace is ready"` bersarang dengan nama yang sama di S04 (terlihat di snapshot aria). Tidak melanggar aturan WCAG A/AA; nama landmark unik hanya praktik terbaik. |
| O10 | P3 | Token ukuran font berupa piksel (`--font-size-md: 16px`), jadi pengaturan ukuran font default browser tidak menskalakan sebagian besar teks; zoom halaman (WCAG 1.4.4) bekerja. Bagian yang memakai `rem` (kelas Tailwind) ikut membesar, itulah yang diuji sebagai "font-size root 200%". |
| O11 | P3 | Log server Next mencetak `Error: The destination stream closed early` saat browser menutup respons streaming (navigasi diputus). Tidak ada kegagalan tampilan; terjadi pada semua run. |
| O12 | env | Konflik versi Playwright dari perubahan Storybook sesi lain (lihat catatan eksekusi). |
| O13 | P3 | Pesan commit `55a17b3` menjadi satu baris karena amend; isi benar, bentuk kurang rapi. |

## Acceptance Fase 4 (§1.7 sampai §1.12)

- §1.7 kontras token: terbukti, dua pelanggaran diperbaiki.
- §1.8 matriks: terbukti, 0 temuan Axe, 88 screenshot.
- §1.9 keyboard dan focus: terbukti.
- §1.10 teks 200%: terbukti setelah D11.
- §1.11 proxy screen reader: snapshot aria terkunci; pemeriksaan **NVDA nyata belum dijalankan** (dicatat di laporan akhir dan checklist §6.4).
- §1.12 kalimat S12: terbukti (unit + E2E).
- D6: terbukti.
- Stop condition §8: tidak ada yang terpicu.

## Langkah berikutnya

Fase 5: clean rebuild di stack sekali pakai (36 migration, 20 file pgTAP, diff tipe kosong), `pnpm build`, `pnpm start` dengan `/api/health`, dan `pnpm worker:check` dua konfigurasi.
