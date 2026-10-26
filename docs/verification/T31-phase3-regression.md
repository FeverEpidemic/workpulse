# T31 Fase 3: regresi, aksesibilitas, Delivery Gate

- Tanggal: 26 Oktober 2026
- Eksekutor: Claude Sonnet 5.5
- antislop: mode **during** (pilihan pengguna di chat sesi ini, menjawab pertanyaan mode). Core, `antislop-ui`, `antislop-human`, `antislop-layoutmobile` dibaca dari `.claude/skills/<nama>/SKILL.md`.
- Status: Fase 3 selesai. **Berhenti untuk gate review Claude (Opus 5.5).** T31 belum ditandai DONE.

## Command dan hasil (worktree `t31-impl`, commit `b3ee047` ditambah screenshot)

| Command | Hasil |
| --- | --- |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **154 file, 1446 test lulus** |
| `pnpm build` | exit 0 |
| `pnpm test:e2e:ui` | exit 0, 1 lulus (40 d) |
| `pnpm test:e2e:release` | exit 0, **43 lulus** (8,8 menit); baseline 42 + 1 test 768 px baru |
| `pnpm test:e2e:activity` | exit 0, 1 lulus (51 d) |
| `pnpm test:e2e:m2` | exit 0, 1 lulus (53 d) |
| Paritas migration (`supabase migration list --local`) | 38/38, 0 selisih, dicek ulang setelah semua suite |

Env: `SUPABASE_SECRET_KEY` dari `SERVICE_ROLE_KEY`, variabel AI harness dikosongkan, container `workpulse-t10-clamav`, `-t15-gotenberg`, `-t21-pdf` berjalan. Screenshot tracked di `T25`, `T27`, `T30` yang ditulis ulang oleh suite dikembalikan dengan `git checkout`.

## Axe (acceptance 10)

Lulus di `mobile-tab-bar.spec.ts` (bagian dari run release): dashboard expanded dan compact, composer, Profile, Menu lainnya, di 360 px light dan dark. Compact light ditambahkan di T31. Matriks `release-a11y` 360 dan 1440 px light/dark ikut lulus.

## Klik-tembus (acceptance 9, 5, animasi)

Dijalankan lewat spec scratch (dihapus, tidak di-commit) di 360 × 640 dan 768 × 900, light dan dark, build produksi. Setiap skenario: scroll bawah-atas di `/activity`, tap gutter, tap +, navigasi dari compact, Menu lainnya di Profile.

- **Scroll ke bawah**: lebar kapsul turun 344 → 268 px (360 px) atau 480 → 268 px (768 px) dalam 15-16 sampel tiap 20 ms, **monoton**, 7 nilai antara per run, sehingga terlihat sebagai gerak halus, bukan lompatan. Pada setiap sampel tidak ada link atau tombol yang keluar dari tepi kapsul. Tidak terlihat patah di Chromium (pengamatan dari angka; belum ditonton di perangkat sentuh nyata).
- **Scroll ke atas**: kembali ke lebar expanded dan `data-compact="false"` di keempat skenario.
- **Tap gutter**: titik 4 px di luar kapsul compact jatuh ke konten dan membuka detail aktivitas di bawahnya (bukan expand bar). Di 360 px dan 768 px keduanya meneruskan tap.
- **Tap +**: sheet Quick log terbuka di keempat skenario; Escape menutup.
- **Navigasi dari compact**: ke `/projects`, halaman baru mulai expanded.
- **Menu lainnya**: sheet terbuka di keempat skenario.
- Tidak ada `console error` atau `pageerror` di keempat run.

## Acceptance

| # | Hasil | Bukti |
| --- | --- | --- |
| 1 | PASS | E2E: left 8, right 352, bottom 632, border 1 px × 4, radius = `--radius-lg`, shadow ada, `backdrop-filter: none` |
| 2 | PASS | E2E: compact 268 px, terpusat (≤ 1 px), tinggi list 52, kembali 344 px saat scroll atas dan tap di dalam kapsul |
| 3 | PASS | unit (CSS) dan E2E: `width` 0,18 s `cubic-bezier(0.2, 0, 0, 1)`; list `height`, `column-gap`, `padding` 0,18 s |
| 4 | PASS | E2E reduced motion: durasi ≤ 0,01 ms pada kapsul, list, header, tab; compact tetap berganti |
| 5 | PASS | E2E `elementFromPoint` di gutter bukan bagian bar; klik-tembus membuka konten |
| 6 | PASS | E2E `scrollWidth ≤ clientWidth` untuk semua label termasuk Dashboard aktif tebal (sisa 0,3 px) |
| 7 | PASS | E2E: semua target ≥ 44 × 44; jarak antar target di compact ≥ 8 px |
| 8 | PASS | E2E: kontrol terbawah di atas tepi atas kapsul, padding `main` ≥ 72, tanpa scroll horizontal di lima rute, toast di atas kapsul |
| 9 | PASS | `test:e2e:release` 43/43, `test:e2e:ui`, `activity`, `m2` lulus; unit T27 lulus; tidak ada assertion dilemahkan (hanya padding 64 → 72, lihat `T31-phase2-e2e.md`) |
| 10 | PASS | lihat Axe di atas |

## Delivery Gate antislop

Design Read dari plan: workspace karier privat, bahasa visual tenang `docs/Design.md` §16, ENERGY 1 / RHYTHM 1 / MOTION 2. Perubahan ini murni CSS satu komponen; bagian halaman, copy, dan ikon tidak disentuh.

**Block 1: Hard Gate (semua harus "tidak")**

- R-02 em dash: tidak ada. Dicek dengan pencarian `—` di `globals.css`, spec, test unit, dan receipt T31. PASS
- R-03 overflow/rusak di mobile: tidak ada. Acceptance 8: nol scroll horizontal di lima rute di 360 px; label tidak terpotong. PASS
- R-17, R-18, R-36, R-38 statistik, testimoni, klaim, konten fiktif: tidak ada konten baru. PASS
- R-23 aset dibuat tanpa instruksi: tidak ada logo, foto, atau struktur navigasi baru; lima slot dan label tidak berubah. PASS
- R-24 tautan ke halaman tidak ada: tidak ada tautan baru. PASS
- R-25 kontras di bawah AA: warna teks dan latar tidak berubah; axe 0 pelanggaran di 360 px light/dark, expanded dan compact. PASS
- R-26 kontrol tidak berfungsi: klik-tembus membuka sheet +, Menu lainnya, navigasi, expand/compact. PASS
- R-27 state kosong/loading/error: tidak ada data view baru. PASS
- R-28, R-33: bukan FAQ; CSS ditulis di sumber (`globals.css`), tanpa script patch. PASS
- R-32 keyboard dan fokus: `release-keyboard` lulus (+ dibuka dengan Enter/Space, Escape mengembalikan fokus); `outline` tidak disentuh. PASS
- R-34 tema: light dan dark dijalankan di axe, screenshot, dan klik-tembus. PASS
- R-35 dijalankan dan diklik: build produksi, lima suite, klik-tembus di dua lebar dan dua tema. PASS
- R-37 arah desain: ada (`docs/Design.md`, dial dari plan). PASS

**Block 2: Purpose-Gate (alasan tertulis)**

- R-10 glass: tidak ada blur di bar (`backdrop-filter: none` diuji). Satu-satunya `blur(2px)` di `.ui-dialog::backdrop` sudah ada sebelum T31. PASS
- R-11 radius: `--radius-lg` (16 px) dari token, bukan pill penuh, sama dengan kartu dan dialog. Alasan: kapsul tetap sejalan dengan skala radius yang ada. PASS
- R-12 shadow: satu `--shadow-md` pada satu-satunya elemen yang melayang di chrome mobile; penanda elevasi karena bar tidak lagi menempel di tepi. PASS
- R-13 glow, R-01 gradien, R-07 grid, R-08 panah, R-09 badge, R-14 kartu seragam, R-22 ilustrasi: tidak ada. PASS
- R-19 gerak: satu perubahan lebar 180 ms (`--motion-normal`, `--ease-out`) dipicu scroll pengguna; tidak ada loop; konsisten dengan MOTION 2; reduced motion mematikan transisi. PASS
- R-04 ikon: tidak ada ikon baru. PASS

**Block 3: Liveliness**

- Dial dinyatakan (1 / 1 / 2) dan konsisten dengan hasil. Satu aksen tetap: tombol + (tidak berubah). Titik fokus per layar dan identitas visual tidak berubah karena ini bukan layar baru. PASS

**Block 4: Craftsmanship**

- C-1: tiap keputusan punya alasan (gutter 8 px dari pengukuran label, batas 480 px dari §2.2.3, padding 7 px dari border). PASS
- C-2: tidak ada elemen interaktif tanpa fungsi. PASS
- C-4: tidak patah di tema, breakpoint 360/768/1440, atau tanpa mouse. PASS
- R-05 template: tidak relevan (bukan tata letak halaman). PASS

**Checklist `antislop-ui`, `antislop-human`, `antislop-layoutmobile`**

- Aksen hanya +; shadow dan radius pada dosis; motion mengikuti dial. PASS
- Kontras: pasangan warna tidak berubah dan axe bersih. PASS
- Batas kapsul (`--color-border-default` `#dde5dc` pada kanvas `#f7faf6`, `#2b352e` pada `#111613`) rasio rendah. Kapsul adalah kontainer, bukan batas kontrol; tiap tab punya kontras sendiri dan tab aktif punya border + bobot huruf, bukan hanya warna. Sama dengan perlakuan kartu `app-card`. Dicatat di P3 di bawah.
- Fokus terlihat di semua tab (aturan `:focus-visible` global, tidak diubah). PASS
- Reflow: expanded `min(100% - 16 px, 480 px)`, compact 268 px; 360, 768, dan 1440 diuji (1440 menyembunyikan bar). PASS
- Target ≥ 44 × 44 dengan jarak 8 px saat compact. Saat expanded slot Dashboard, Activity, Projects, Profile saling menempel (66,8 px lebar, tidak ada gap); tidak diubah dari T27 dan dicatat di P3.
- Bar tidak menutup konten dan menghormati safe area: padding bawah dan toast memakai `--tab-bar-offset` (gutter + `env(safe-area-inset-bottom)`). Safe area nyata di perangkat belum diuji (Chromium desktop mengembalikan 0). PASS dengan catatan.

Hasil gate: **tidak ada FAIL**.

## Temuan, catatan, dan keterbatasan (untuk reviewer)

- **P3** Dashboard tebal hanya sisa 0,3 px di slot kapsul 344 px. Font fallback atau penskalaan teks bisa memotongnya ("Dashboar…" lewat ellipsis). Tidak ada test yang memperbesar teks di dalam bar, jadi kasus itu tidak terbukti aman. Opsi tindak lanjut: label 11 px atau gutter 4 px; tidak dilakukan karena pengguna memilih gutter 8 px.
- **P3** Slot expanded saling menempel (gap 0). Warisan T27.
- **P3** Tepi kapsul di dark mode hanya ditopang border 1 px `#2b352e`; shadow token yang sama hampir tak terlihat di latar gelap. Sesuai plan (tanpa token shadow baru); lihat screenshot `bar-compact-360-dark-dashboard.png`.
- Safe area bawah pada perangkat nyata dan gestur sentuh tidak diverifikasi (hanya Chromium desktop).
- Screenshot di `docs/verification/T31-screenshots` ditulis ulang oleh run Fase 3 (data akun berbeda); yang di-commit adalah run terakhir.

## Blocker

Tidak ada.

## Berikutnya

Gate review Claude (§9). Setelah lulus: Fase 4 (Design.md dua salinan, decision 0041, ringkasan acceptance). `Design.md` dan `docs/Design.md` di checkout utama punya perubahan lokal belum di-commit; edit dilakukan hanya di worktree.
