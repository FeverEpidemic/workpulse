# T33 Gate review dan rencana remediasi

- Tanggal: 5 November 2026
- Reviewer: Claude Opus 5.5, read-only terhadap kode.
- Commit yang direview: `1380bf9` di `claude/t33-cv-multi-select-288f9f`, base `e3e522a`.
- Verdict: **BELUM LULUS.** Satu P1 dan satu P2 terbuka. T33 tetap PARTIAL. Fase 4 menunggu remediasi dan gate ulang.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P1 | Bila record pertama yang dicentang sudah hilang, batch buntu dan pesannya tanpa jumlah | Terbuka |
| RV2 | P2 | Record yang tercentang lalu masuk sebagai induk muncul lagi dalam keadaan tercentang setelah dihapus | Terbuka |
| N1 | P3 | `landing.spec.ts:308` gagal 2 dari 3 run, juga di base | Follow-up |
| N2 | P3 | Selama `router.refresh()` setelah jawaban stale, tombol tambah masih bisa diklik dan memicu konflik lagi | Follow-up |

### RV1 (P1): gagal di record pertama

**Gejala.** Tiga record dicentang, record pertama dihapus di sesi lain, lalu "Add 3 to CV" ditekan. Hasil probe:

- `cv_items` tetap 0, dan notice hanya berisi "This record is no longer available for your CV." tanpa menyebut record atau jumlah.
- Baris record yang terhapus tetap tampil dan tetap tercentang. Tombol tetap "Add 3 to CV".
- Klik ulang gagal dengan pesan yang sama. Pengguna harus memuat ulang halaman, atau menghapus centang satu per satu tanpa tahu mana yang bermasalah.

Acceptance 7 mensyaratkan pesan yang menyebut jumlah. Dulu tombol per baris langsung menunjukkan record mana yang gagal, jadi jalan buntu ini baru muncul dengan multi-select.

**Penyebab.** `src/features/cv/cv-builder.tsx:264-268`: `cv.notice.partialAdd` dan `router.refresh()` hanya berjalan bila `result.added.length > 0`, dan `fail()` hanya me-refresh untuk konflik. Plan §3 langkah 5 menulis syarat yang sama, jadi celahnya berasal dari plan, bukan dari pelaksana.

**Perbaikan minimal.**

1. Pada semua jalur gagal, pastikan pool dimuat ulang. Hindari refresh kedua bila `fail()` sudah melakukannya.
2. Tampilkan `cv.notice.partialAdd` bila `options.length > 1`, termasuk saat `added.length === 0` ("0 of 3 added. ..."). Batch satu record cukup memakai notice error.

**Test regresi (gagal lalu lulus).** E2E baru di `cv-builder.spec.ts`: hapus record pertama dalam daftar, tekan tombol, lalu pastikan:

- info notice berbunyi "0 of 3 added. The rest stay selected so you can try again."
- checkbox record yang hilang `toHaveCount(0)`, dua sisanya tetap tercentang, dan tombol "Add 2 to CV"
- fokus bukan di `BODY`
- klik ulang menghasilkan `cv_items` = 2

### RV2 (P2): centang tertinggal

**Gejala.** Project dan achievement anaknya sama-sama dicentang, lalu tombol section Achievements ditekan. Project ikut masuk sebagai induk. Setelah project dihapus lewat ikon sampah, project kembali ke daftar dalam keadaan tercentang dengan tombol "Add 1 to CV" (probe: `parentChecked: true`, `childChecked: false`).

Plan §2.2.11 menyatakan record yang sudah masuk gugur dari pilihan. Tidak ada write tanpa tombol, jadi dampaknya tidak langsung. Baris "tanpa centang" di klik-through receipt Fase 3 hanya benar untuk record yang ditambahkan lewat tombol section-nya sendiri.

**Penyebab.** `src/features/cv/cv-builder.tsx:251` hanya mengeluarkan record dari `result.added`. Induk yang masuk otomatis tetap di `chosen`. `addableSelection` menyembunyikannya selama record itu `selected`, jadi centangnya muncul lagi begitu record kembali ke pool.

**Perbaikan minimal.** Keluarkan dari `chosen` setiap `sourceId` yang `selected` di pool saat ini, lewat fungsi murni di `cv-builder-state.ts`, dan jalankan saat `savedKey` berubah. Juga mencakup record yang masuk dari sesi lain.

**Test regresi (gagal lalu lulus).** Unit untuk fungsi murni tersebut, dan E2E skenario di atas: setelah project dihapus, checkbox-nya tidak tercentang dan tombol section Projects "Add to CV" dengan `aria-disabled`.

### Follow-up P3

- **N1.** `/ @360: small targets halo@myworkpulse.my.id (200x44, landing-text-link)`. Tiga kali ulang: 2 gagal, 1 lulus di `1380bf9`, dan hasil yang sama di base `e3e522a`. T33 tidak menyentuh landing. Ukurannya tampak dibulatkan ke 44, jadi kemungkinan tinggi sebenarnya sedikit di bawah batas, tapi ini belum diukur. Milik T32 atau PR berikutnya di area landing.
- **N2.** Dilaporkan receipt Fase 3 (warning 4). `runOperation` lama punya celah serupa, dan data tidak rusak.

## Risiko yang diperiksa dan tidak terbukti

- **Fokus saat semua record section masuk sekaligus.** `selectCvSourceAction` memanggil `revalidatePath`, dan `pendingFocus` baru diisi setelah batch selesai, sementara tombol hilang setelah batch. Lima kali run keyboard di 360 dark: fokus selalu berakhir di `#cv-section-heading-achievements`.
- **Refresh per item.** Empat request per batch tiga record: tiga POST action dan satu GET RSC. Baris tidak berubah sampai batch selesai, jadi §2.2.6 terpenuhi.
- **Suggested.** Checkbox fokus dan tercentang, `cv_items` 0 sampai tombol ditekan, dan batch dua record lolos.
- **Assertion test.** Diff `tests/` dibaca penuh; assertion lama diganti padanan yang setara.
- **Diff `s13-cv.aria.yml`.** 13 tambah dan 7 hapus, semuanya di area daftar.

## Hasil verifikasi ulang

Worktree segar di commit `1380bf9`, build produksi, lokal.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 163 file / 1575 test |
| `git diff --check e3e522a HEAD` | 0 | |
| `test:e2e:cv` | 0 | 13 lulus |
| `test:e2e:release` | 1 | 78 lulus, 1 gagal (`landing.spec.ts:308`, N1), 1 skip |
| `landing.spec.ts:308 --repeat-each 3` di `1380bf9` | 1 | 1 lulus, 2 gagal |
| `landing.spec.ts:308 --repeat-each 3` di `e3e522a` | 1 | 1 lulus, 2 gagal |
| Probe Playwright sementara (tidak di-commit) | 0 | 8 skenario, nilai dicatat di atas |
| Parity migration | | 38/38 |
| `git diff e3e522a HEAD` pada `supabase/migrations`, `package.json`, `pnpm-lock.yaml`, `actions.ts` | | Kosong |

**Tidak dijalankan ulang:** `test:e2e:cv-freshness`, `test:e2e:cv-export`, `test:e2e:m4`, `test:e2e:m5`. Angkanya masih dari receipt Fase 3 (§9 tidak mewajibkannya).

**Batas bukti:** cek langsung memakai Playwright pada build produksi Chromium, bukan pane browser. Tampilan bahasa Indonesia hanya dibuktikan unit. Belum diuji di Safari, Firefox, perangkat nyata, staging, atau production.

## Gate ulang (6 November 2026): LULUS

Commit `d8831ca` (remediasi `eca526b`, receipt `T33-phase3b-remediation.md`). Diulang di worktree segar dengan build produksi lokal.

| ID | Status | Bukti |
| --- | --- | --- |
| RV1 | Ditutup | `cv-builder.tsx`: pool dimuat ulang pada semua jalur gagal, tanpa refresh kedua setelah konflik. Notice jumlah tampil untuk batch lebih dari satu record, termasuk "0 of 3". E2E `cv-builder.spec.ts:678` lulus. |
| RV2 | Ditutup | Fungsi murni `pruneChosen` di `cv-builder-state.ts` dijalankan saat `savedKey` berubah. Unit dan E2E `cv-builder.spec.ts:708` lulus. |
| N1, N2 | Tetap P3 | Tidak dikerjakan, sesuai rencana. |

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint`, `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | 1577 test |
| `git diff --check e3e522a HEAD` | 0 | |
| `test:e2e:cv` | 0 | 15 lulus |
| `test:e2e:release` | 1 | 77 lulus, 2 gagal, 1 skip |
| `landing-motion.spec.ts:39 --repeat-each 3` | 0 | 3 lulus |
| File terlarang (`supabase/migrations`, `package.json`, `pnpm-lock.yaml`, `actions.ts`) | | Tidak berubah |

**Dua kegagalan di run release tidak berasal dari T33.** T33 tidak menyentuh landing. Perubahan CSS-nya hanya kelas `.cv-pool-*`.

- `landing.spec.ts:308` adalah N1, yang juga gagal di base.
- `landing-motion.spec.ts:39`: cerita hero berhenti di `idle`. Tes ini lulus 3 dari 3 saat diulang, dan lulus di run release gate pertama.

**Run release yang tidak dihitung.** Run sebelumnya pada commit yang sama macet sekitar dua jam di `release-a11y` 1440 dark lalu dihentikan, mirip run 2 Fase 3. Penyebabnya tidak diselidiki. Kemungkinan bentrok dengan sesi pelaksana yang menjalankan suite di DB lokal yang sama pada waktu itu.

**Tidak dijalankan ulang oleh reviewer:** `test:e2e:cv-freshness`, `test:e2e:cv-export`, `test:e2e:m4`, `test:e2e:m5`. Angka freshness diambil dari receipt 3b, sisanya dari receipt Fase 3.

Langkah berikutnya: Fase 4 (decision 0044 dan `T33-cv-multi-select.md`), lalu closeout oleh reviewer.

## Yang harus diulang setelah remediasi

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e:cv`, `pnpm test:e2e:cv-freshness`, `pnpm test:e2e:release`, `git diff --check`. Tulis hasilnya di `docs/verification/T33-phase3b-remediation.md`, lalu minta gate ulang. Jangan lanjut ke Fase 4 sebelum gate ulang lulus.
