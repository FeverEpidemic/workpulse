# T33 Fase 3: E2E, regresi, Delivery Gate

- Tanggal: 5 November 2026
- Pelaksana: Claude Sonnet 5.5, satu agent. Branch `claude/t33-cv-multi-select-288f9f`.
- antislop: mode during (session override). Design Read: halaman app internal untuk pengguna yang menyusun CV, bahasa visual yang sudah ada di app, ENERGY 1 / RHYTHM 1 / MOTION 1 (plan §2.2.14).

## Tujuan

Memigrasikan test yang memakai tombol Add per baris, menambah E2E untuk acceptance 3, 4, 5, 6, 7, 9, 11, mengunci ulang aria S13, menjalankan regresi, dan melaporkan Delivery Gate dengan bukti klik per elemen.

## File berubah

- `tests/e2e/cv-builder.spec.ts`: helper `add()` (centang, tombol section, tunggu `cv-pool-added`), helper `addButton`, `poolCheckbox`, `addedRow`, `poolNames`, `cvRevision`, `cvItemCount`, `deleteAchievement`; migrasi semua pemakaian; lima test baru.
- `tests/e2e/cv-export.spec.ts`, `m4-cv-journey.spec.ts`, `m5-pilot-journey.spec.ts`: loop `#cv-add-<id>` menjadi `#cv-pool-check-<id>` (Space) lalu `cv-pool-add` (Enter) lalu `#cv-pool-added-<id>`. Di m4, fokus awal di checkbox Suggested yang tercentang, Tab ke tombol, Enter.
- `tests/e2e/cv-freshness.spec.ts`: dua tempat memakai `checkbox` + `cv-pool-add` + `cv-pool-added`.
- `tests/e2e/release-keyboard.spec.ts`: fokus awal di checkbox tercentang, lalu `activate` (Tab + Enter) ke `cv-pool-add`.
- `docs/verification/T25-aria/s13-cv.aria.yml`: dikunci ulang.
- `tests/unit/cv-builder-state.test.ts`: akhir baris dinormalkan ke LF (bagian yang saya tambah di Fase 1 sempat CRLF). Tidak ada perubahan isi.

Tidak berubah (diperiksa `git diff --stat base`): `supabase/migrations/*`, `package.json`, `pnpm-lock.yaml`, `src/features/cv/actions.ts`.

## Assertion lama: diganti padanan, tidak dibuang

| Lama | Baru |
| --- | --- |
| `getByRole("button", { name: "Add X to CV" }).click()` | centang `checkbox` X, klik `cv-pool-add` section itu |
| `button "X is already on the CV"` terlihat | `cv-pool-added` berisi "X is already on the CV" terlihat |
| `toHaveAttribute("aria-disabled","true")` pada tombol Added | checkbox X `toHaveCount(0)` dan `cv-pool-added` terlihat |
| `button /Masih draf/` count 0 | `checkbox /Masih draf/` count 0, teks "Masih draf" count 0, tombol `^Add .* to CV$` count 0 |
| `Add Sudah dikonfirmasi to CV` fokus | checkbox fokus dan tercentang, tombol "Add 1 to CV", `cv_items` kosong |
| Add SQL setelah removal di sesi lain (`cv-builder.spec.ts:369`) | centang SQL, klik `cv-pool-add` skills, assertion `cv-dropped-notice`, jumlah item, dan status tetap sama |
| `getByRole("button", { name: /^Add all/ })` count 0 | tetap, ditambah `getByText(/Select all/)` count 0 (`cv-builder.spec.ts:173` area). Unit `cv-builder-ui.test.tsx` juga tetap |

Di `m5-pilot-journey.spec.ts` sempat ada cabang "bila checkbox tidak ada, anggap sudah masuk"; saya buang lagi karena achievement m5 tidak membawa experience-nya, sehingga loop tetap ketat untuk kedua record.

## Commands

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | Tanpa warning |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 163 file / 1575 test (Fase 2) |
| `pnpm test:e2e:cv` (sesudah migrasi + test baru) | 0 | **13 lulus** (baseline 8, +5) |
| `pnpm test:e2e:cv-freshness` | 0 | 11 lulus |
| `pnpm test:e2e:cv-export` | 0 | 12 lulus |
| `pnpm test:e2e:m4` | 0 | 1 lulus |
| `pnpm test:e2e:m5` | 1 lalu 0 | Percobaan 1: gagal di `page.waitForEvent("filechooser")` (langkah import, sebelum CV, 15 s). Percobaan 2 dan 3 (loop ketat): 1 lulus |
| `pnpm test:e2e:release` (run 1, sebelum lock aria) | 1 | 76 lulus, 3 gagal, 1 skip: `landing.spec.ts:308` ("small targets halo@myworkpulse.my.id (200x44, landing-text-link)" di 360), `motion-loading.spec.ts:61`, `release-a11y.spec.ts:297` (diff aria S13, diharapkan). Dua yang pertama ada di daftar flaky plan §7 dan tidak menyentuh CV |
| `WORKPULSE_RELEASE_WRITE_ARIA=1 pnpm test:e2e:release -g "accessibility tree of S04"` | 0 | 1 lulus; lima file aria ditulis, hanya `s13-cv.aria.yml` berbeda isi, empat lainnya dikembalikan dengan `git checkout` |
| `pnpm test:e2e:release` (run 2, sesudah lock) | 1 | 67 lulus, 2 gagal, 10 tidak jalan: tes `release-a11y` "1440 dark" macet 4,4 menit ("worker produced no summary", `docker exec ... psql` gagal). Gangguan infrastruktur (Docker/worker), bukan assertion. Run total 34 menit |
| `pnpm test:e2e:release` (run 3) | 0 | **79 lulus**, 0 gagal, 1 skip (rekaman tempo hero, memang di-skip). `landing.spec.ts:308` dan `motion-loading.spec.ts:61` lulus kali ini (12,3 menit); `release-a11y` aria S13 dan `release-keyboard` lulus |
| Parity migration | 0 | 38 baris di `schema_migrations`, 38 file |

Screenshot T22/T25/T27/T30 yang ditimpa suite dikembalikan dengan `git checkout`; `git status` bersih kecuali perubahan T33.

## Diff aria S13 (area daftar saja)

Tiga daftar yang punya record tersedia (Experience, Skills, Certifications) berubah dari `paragraph` + `button "Add X to CV": Add` menjadi `checkbox "X"` + `text: X`, lalu `button "Add to CV" [disabled]` dan `paragraph: Select at least one record.` di bawah `list`. Baris Added di Achievements berubah dari `button "... is already on the CV" [disabled]: Added` menjadi `text: ... is already on the CV`. Tidak ada baris lain yang berubah (`git diff` 13 tambah, 7 hapus, semuanya di tiga daftar dan satu baris Added). Empat file aria lain tidak berubah isi.

## Bukti per acceptance (§1)

| # | Bukti |
| --- | --- |
| 1 | Unit "gives every record not yet on the CV one checkbox..."; E2E graduate journey: `getByRole("button", /^Add .* to CV$/)` count 0, checkbox per record |
| 2 | Unit "shows a record already on the CV as text..."; E2E: `cv-pool-added` terlihat, checkbox X count 0, "On the CV under Skripsi Sistem Antrian" tetap |
| 3 | E2E "ticking writes nothing...": `cv_items` = 0 setelah tiga centang, uncheck, centang ulang; "Add to CV" with highlight: `cv_items` kosong sampai tombol ditekan |
| 4 | E2E: "Add to CV" + `aria-disabled` + hint terlihat di 0 centang, klik paksa tidak menulis dan announcer kosong; "Add 3 to CV", "Add 2 to CV"; `cv-pool-add` count 1 saat hanya Achievements yang punya record; unit untuk id |
| 5 | E2E: tiga centang urutan terbalik, hasil `[names[1], names[2], names[3]]` (urutan daftar), `cv_documents.revision` naik tepat 3, tanpa panel konflik dan tanpa `cv-notice`. Unit: revision berantai 10, 12, 14 |
| 6 | E2E "two achievements of one project...": 3 item di Projects, 2 anak, `cv_items` = 3, tanpa notice |
| 7 | E2E "a record that disappears mid-batch...": satu masuk, tengah dihapus lewat `delete_achievement`, ketiga tetap tercentang, notice "This record is no longer available" dengan UUID correlation ID, info "1 of 3 added. The rest stay selected so you can try again.", baris pertama langsung tampil Added tanpa reload manual, fokus bukan BODY, coba lagi menambah sisanya |
| 8 | E2E "stale save..." dan "Add SQL" lulus dengan assertion yang sama; E2E "a batch keeps unsaved wording...": wording draft bertahan setelah batch dan setelah jawaban stale, batch kedua lolos setelah reload, tidak ada konflik palsu |
| 9 | E2E "Add to CV opens the CV...": checkbox Suggested tercentang dan fokus, `cv_items` kosong, setelah tombol ditekan `cv_items` = 1; tiga nilai highlight tidak valid: nol checkbox tercentang dan tombol `aria-disabled` |
| 10 | E2E reduced motion: checkbox fokus, Tab ke tombol, Enter, fokus pindah ke `#cv-section-heading-achievements`, announcer "Fokus tanpa animasi added to the CV."; `release-keyboard` lulus dengan cek cincin fokus pada checkbox; m4 dan cv-export lewat keyboard |
| 11 | E2E "pool rows are one 44 px target...": 360 dan 1440, light dan dark, tinggi `.cv-pool-label` >= 44, klik teks men-toggle checkbox, nama dengan token 80+ karakter membungkus, tanpa overflow, Axe nol temuan (`expectNoWcagViolations`). Kontras (receipt di bawah) |
| 12 | `Add all` count 0 di unit dan E2E; `Select all` count 0 |
| 13 | Suite CV, freshness, export, M4, M5 lulus. Release: lihat tabel. Parity 38/38 |

### Kontras (contrast-check.py dan piksel hasil render)

| Pasangan | Rasio | Hasil |
| --- | --- | --- |
| Batas checkbox tidak tercentang, light (diukur dari screenshot: `rgb(118,118,118)` di `#ffffff`) | 4,54:1 | PASS (>= 3) |
| Batas checkbox, dark (`rgb(133,133,133)` di `#171d19`) | 4,64:1 | PASS |
| Isi checkbox tercentang light (`#567657` di `#ffffff`) | 5,09:1 | PASS |
| Isi checkbox tercentang dark (`#8faf87` di `#171d19`) | 7,05:1 | PASS |
| Label "Added" light (`#59635c` di putih) | 6,24:1 | PASS |
| Label "Added" dark (`#b6c0b8` di `#171d19`) | 9,15:1 | PASS |
| Label tombol nonaktif (opacity 0,75) light, hasil campuran | 7,25:1 | PASS |
| Label tombol nonaktif dark, hasil campuran | sekitar 8,6:1 | PASS |
| Cincin fokus checkbox dan tombol | `solid 2px` (token `--color-focus-ring`) | PASS |

## Delivery Gate antislop (laporan)

Klik-through dijalankan dengan Playwright memakai build produksi (`next build` + `next start`), akun baru per viewport, di 1440 px light dan 360 px dark. Tidak ada error konsol. Skrip sementara dihapus setelah run (tidak di-commit).

### Klik per elemen (R-35)

| Elemen | Hasil di 1440 light dan 360 dark |
| --- | --- |
| Ringkasan "Available to add" | Klik menutup, klik lagi membuka daftar |
| "Add to CV" dengan 0 centang | `aria-disabled`, hint "Select at least one record." terlihat, tidak ada tulisan, announcer kosong |
| Checkbox (klik) | Tercentang, tombol berubah ke "Add 1 to CV" |
| Teks baris (klik, bukan kotak) | Menghapus centang |
| Checkbox (Space) | Mencentang |
| Tab dari checkbox | Mencapai tombol; cincin `solid 2px` pada checkbox dan tombol |
| "Add 1 to CV" (Enter) | Record masuk, fokus ke judul section, announcer "X added to the CV." |
| Baris Added (klik) | Tidak ada checkbox, tidak terjadi apa pun |
| "Add 2 to CV" (klik) | Dua record masuk, induk project ikut dibuat |
| Ikon sampah di record yang sudah masuk | Record kembali ke daftar tanpa centang |
| Edit wording, ketik, Save changes | Draft "Unsaved changes", lalu "All changes saved" |
| Move section down | Diumumkan "Projects section moved..." |
| CV language | Preview mengikuti (Pencapaian) |
| Remove parent | Dialog terbuka, Escape menutup |
| `/cv?highlight=<id>` | Checkbox tercentang dan fokus, belum ada tulisan |
| `/cv` tanpa highlight | Nol checkbox tercentang |
| Preview and export | Membuka `/cv/preview` |
| Konsol | Tidak ada error |

Catatan jujur: di 360 px, klik paksa (`force`) pada tombol nonaktif sempat mendarat di tab bar bawah karena Playwright melewati cek penutup; skrip diganti `dispatchEvent("click")` setelah `scrollIntoViewIfNeeded`. Itu artefak skrip, bukan perilaku pengguna.

### Block 1: Hard Gate

- R-02 PASS: tanpa em dash di copy baru (`messages.ts` 0 kemunculan; tabel plan dipakai persis).
- R-03 PASS: tanpa overflow di 360 px, label 44 px (E2E mengukur tinggi), nama panjang membungkus.
- R-17/R-18/R-36/R-38 PASS: tidak ada angka, testimoni, atau klaim baru; jumlah di tombol berasal dari centang nyata.
- R-23 PASS: tidak ada aset visual baru.
- R-24 PASS: tidak ada navigasi baru.
- R-25 PASS: semua pasangan teks dan batas komponen dihitung (tabel di atas).
- R-26 PASS: setiap kontrol punya perilaku (klik-through di atas); tombol nonaktif punya alasan terlihat.
- R-27 PASS: kosong ("No records to add in this section."), memuat (label tombol "Adding 2 of 3", live region, tombol dan checkbox `aria-disabled` selama proses), error (notice dengan correlation ID) tercakup.
- R-28 N/A: tidak ada FAQ.
- R-32 PASS: Tab, Space, Enter menjalankan seluruh alur; cincin fokus 2 px; tanpa `outline: none` baru.
- R-33 PASS: semua dikerjakan di source, tanpa skrip patch.
- R-34 PASS: light dan dark diverifikasi di 360 dan 1440 (Axe nol temuan di keduanya).
- R-35 PASS: build produksi dijalankan, klik per elemen tercatat di atas, konsol bersih.
- R-37 PASS: arahan ada (gaya app yang ada, plan §2.2.14, dial 1/1/1).

### Block 2: Purpose-Gate

R-01, R-07, R-10, R-12, R-13, R-14, R-19, R-22: PASS, tidak ada gradasi, grid, blur, bayangan, glow, kartu, animasi, atau ilustrasi baru. R-04 PASS: tanpa ikon baru. R-06 PASS: tanpa font baru. R-08 PASS: tanpa panah. R-09 PASS: tanpa badge baru; badge Suggested sudah ada dan menandai status nyata.

### Block 3: Liveliness

Dial ENERGY 1 / RHYTHM 1 / MOTION 1 dinyatakan di atas dan dipegang. Satu titik fokus per section: tombol tambah di bawah daftar. Aksen tunggal: warna `--color-action-primary` hanya pada centang. Motif identitas: pola daftar bergaris bawah yang sudah dipakai app. Design Read dideklarasikan di header.

### Block 4: Craftsmanship dan Quality Locks

C-1..C-5 PASS, R-05 PASS (tidak ada layout template), R-11 PASS (radius token yang ada), R-15 PASS (CTA "Add 3 to CV" menyebut aksi dan jumlah), R-16 PASS, R-20 PASS, R-21 PASS (kedua tema), R-29 PASS (tanpa warna baru), R-30 PASS, R-31 PASS (alasan tiap keputusan di receipt Fase 2).

### Checklist skill tambahan

- `antislop-human`: kontras teks dan non-teks terhitung, fokus terlihat di dua tema, keyboard penuh, status tidak bergantung warna (teks "Added", hint teks, label hitungan). Zoom 200%: `release-a11y` "text at 200%" lulus untuk S13 pada run 1 (Fase ini tidak mengubah hasilnya).
- `antislop-layoutmobile`: reflow di 360 dan 1440 diverifikasi; tengah rentang (768) tidak diuji khusus, daftar adalah satu kolom di semua lebar.
- `antislop-copywriting`: copy persis dari tabel plan; kalimat memakai pelaku ("Add 3 to CV"), tanpa buzzword, tanpa tanda kutip hias.

## Acceptance yang terbukti

1 sampai 12 sesuai tabel. 13: release run 3 79 lulus, parity 38/38, tanpa assertion dilemahkan.

## Warning dan temuan untuk diputuskan

1. `landing.spec.ts:308` dan `motion-loading.spec.ts:61` gagal di run 1; keduanya ada di daftar flaky plan dan tidak menyentuh CV. Keduanya lulus di run 3 pada kode yang sama, jadi flaky, bukan regresi T33.
2. Run release 2 macet karena worker/Docker (34 menit). Run 3 diulang penuh.
3. Docker Desktop mati saat sesi mulai dan dinyalakan dari sesi ini; stack lain yang berbagi DB perlu tahu.
4. Selama `router.refresh()` setelah jawaban stale, tombol tambah masih bisa diklik; klik kedua memakai revision lama dan menghasilkan konflik lagi (tidak merusak data). Tidak diubah karena di luar scope; bisa jadi follow-up bila dianggap perlu.
5. Pada 360 px bar bawah tetap menutupi sebagian halaman saat scroll; ini perilaku app yang sudah ada.

## Blocker

Tidak ada.

## Berikutnya

Berhenti. Gate review read-only (Opus 5.5) siap dijalankan pada commit terakhir branch. Fase 4 menunggu setelah gate.
