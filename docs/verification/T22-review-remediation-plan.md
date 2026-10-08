# Rencana Remediasi Review T22 — Saved preview dan PDF QA

Status plan: **TODO**.

- Tanggal: 8 Oktober 2026.
- Reviewer: Claude (Opus). Gate review read-only setelah Fase 7, mengacu ke `T22-implementation-plan.md` §9–§10.
- HEAD yang direview: `d68ad3e`, branch `claude/clever-archimedes-gbu7qd`. Baseline `fe64466`; sepuluh commit T22 `4ff415d..d68ad3e`.
- Verdict awal (HEAD `d68ad3e`): **BELUM LULUS — satu temuan P2 terbuka (RV1).**
  - Tidak ada P0 atau P1.
  - T22 tetap **PARTIAL**: bagian authoritative `IMPLEMENTATION_STATUS.md` tidak diubah sampai review ulang lulus.
- Batas eksekusi remediasi:
  - satu agent, tanpa sub-agent, dengan TDD (test gagal → perbaikan minimal → lulus);
  - tanpa migration, tanpa perubahan RPC/SQL T18–T21, tanpa perubahan worker export atau cek nama RV1 T21;
  - tanpa `db reset` dan tanpa dependency baru.
- Setelah review ulang lulus, lanjutkan Fase 8 plan: decision 0028, `T22-saved-preview-pdf-qa.md`, dan README.

## 1. Ringkasan temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | Entry teratas (experience/project) yang lebih tinggi dari satu halaman dipindah utuh ke halaman berikutnya. Akibatnya halaman sebelumnya kosong sebagian besar, dan pada CV tanpa summary halaman 1 hanya berisi nama | OPEN |
| N1 | P3 | Pada keadaan *failed*, kalimat *Your CV is unchanged.* tampil dua kali (badge status dan alasan kegagalan); F2 receipt Fase 6 | Follow-up copy |
| N2 | P3 | Halaman PDF ditampilkan dalam satu canvas untuk halaman aktif, bukan satu canvas per halaman dengan render lazy ±1 (§2.2.2). Navigasi, label *Page n of N*, dan jumlah halaman tetap memenuhi §1.6 dan S14 | Diterima; catat di decision 0028 |
| N3 | P3 | Setiap run `test:e2e:cv-export` menulis ulang 34 PNG yang di-track di `docs/verification/T22-screenshots/`, sehingga working tree kotor setelah regresi biasa. Reviewer harus `git checkout` setelah run | Follow-up hermetisitas: tulis screenshot hanya bila diminta env, mis. `WORKPULSE_E2E_SCREENSHOTS=1` |
| N4 | P3 | *Retry* tidak memeriksa readiness. Sumber yang berubah atau di-unconfirm tanpa menaikkan revision CV tetap dicetak dari snapshot lama. Ini sesuai keputusan §2.4.3 dan backend T21 (0027 N2); delete sumber menaikkan revision, jadi Retry hilang | Diterima; catat di decision 0028, tinjau di T23 bersama retensi snapshot |
| N5 | P3 | `cv/preview/page.tsx:43` membaca CV, readiness, dan export dengan tiga query paralel tanpa snapshot bersama. Save di tab lain di antara query dapat menampilkan readiness revision lain. Request tetap dijaga `expected_revision` (`STALE_REVISION`), jadi tidak ada export salah | Diterima |
| N6 | P3 | *Retry*, *Regenerate*, dan *Download* di E2E diklik dengan pointer, bukan keyboard. Ketiganya tombol standar yang dapat difokuskan; Export, Next page, dan tautan S13 sudah diuji dengan keyboard | Follow-up test |
| N7 | P3 | Flaky bawaan `activity-ui.spec.ts:356` gagal 2 dari 5 percobaan pada run Fase 7 dan tingkatnya tidak diukur pada baseline | Follow-up T24/hardening test |
| N8 | P3 | Kolom preview S14 sticky dengan `max-height` (warisan S13) sehingga screenshot `fullPage` memotong preview HTML; F3 receipt Fase 6 | Diterima (perilaku S13) |

## 2. RV1 — Entry panjang meninggalkan halaman kosong (P2)

### Gejala

Screenshot `docs/verification/T22-screenshots/pdf-en-page-1.png` dan `pdf-id-page-1.png` sudah dibuka reviewer:

- Halaman 1 dari 9 hanya memuat nama *Budi Santoso*, dan sisanya kosong.
- Seluruh entry *Program Transformasi Digital* dimulai di halaman 2, beserta heading *Projects*/*Proyek*.

Fixture QA `tests/pdf` menunjukkan pola yang sama: halaman sebelum entry panjang berakhir di y = 481 pt, menyisakan 436 pt (58%) kosong. Log `PDF-QA long entry gap` mencatatnya.

Pemicunya realistis. `buildCvOutline` (`src/domain/cv/outline.ts:73`) menaruh achievement kontekstual sebagai child di bawah experience **dan** project. Satu pekerjaan atau project yang panjang dengan sekitar 10 achievement terpilih, masing-masing 2–3 baris, sudah lebih tinggi dari area konten 751 pt. Pengguna seperti ini mendapat PDF dengan halaman nyaris kosong. Hasil itu melanggar PRD R10 (*correct page breaks*) dan tujuan inspeksi halaman §1.13. Receipt Fase 6 mencatatnya sebagai F1, tetapi tidak menutupnya.

### Penyebab

`src/server/export/cv-print-template.ts:26` menerapkan `.entry { break-inside: avoid; page-break-inside: avoid; }` ke **setiap** entry teratas, termasuk entry yang tidak mungkin muat satu halaman. Chromium tetap memindahkan blok itu ke awal halaman berikutnya dan baru memecahnya di sana.

Suite §1.11 hanya menguji dua hal: tidak ada heading yatim, dan entry yang muat tidak terbelah. Belum ada assertion tentang ruang kosong sebelum entry panjang. Akibatnya cacat ini lolos meskipun sapuan 60 varian lulus.

### Perbaikan minimal (template saja)

Reviewer menyetujui perbaikan ini sebagai aturan break §2.2.11. Kelas break dipilih oleh fungsi murni dari model. Font, warna, struktur konten, model, dan preview S13 tidak berubah.

1. Tambahkan fungsi murni di `cv-print-template.ts` (atau helper relatif di sebelahnya) yang menaksir tinggi minimum entry teratas dalam pt dari model.
   - **Masukan:** jumlah baris headline/meta/teks/child. Jumlah baris = `ceil(panjang / CHARS_PER_LINE_UPPER)`, ditambah baris baru eksplisit karena `pre-line`.
   - **Tinggi per baris:** `line-height` 1,45 × 10 pt; meta 9 pt.
   - **Margin:** margin `.child` dan `.entry`.
   - **Sifat wajib:** taksiran adalah **batas bawah**. Pakai jumlah karakter per baris yang sengaja terlalu besar, mis. 120 untuk kolom 493 pt pada 10 pt, sehingga entry yang ditandai benar-benar lebih tinggi dari satu halaman.
2. Bila taksiran > tinggi area konten (842 − 2 × 16 mm ≈ 751 pt), render `<li class="entry entry-flow">`.
3. Tambahkan CSS berikut:

   ```css
   .entry-flow { break-inside: auto; page-break-inside: auto; }
   .entry-flow > .entry-meta, .entry-flow > .entry-text { break-after: avoid; page-break-after: avoid; }
   ```

   `.child` tetap `break-inside: avoid`, dan `h2`/`h3` tetap `break-after: avoid`. Dengan begitu heading dan kepala entry tetap bersama child pertama, dan setiap bullet tetap utuh.
4. Entry yang tidak ditandai tetap `break-inside: avoid`. Jarak sebelum entry yang muat satu halaman tetap mungkin (dibatasi tinggi entry itu sendiri); itu konsekuensi aturan §1.11 yang disetujui.
5. Bila pendekatan ini tidak dapat memenuhi test di bawah tanpa mengubah font, struktur, atau model, **stop** dan laporkan alternatifnya ke reviewer.

### Test regresi (gagal dulu, lalu lulus)

Semua test di `tests/pdf/cv-pdf-layout.test.ts` memakai renderer nyata.

- **Fixture bentuk E2E** (nama saja, tanpa summary, satu project dengan 24 child panjang): halaman 1 memuat heading section, judul entry, dan minimal satu child utuh (`START-…` dan `END-…` child pertama di halaman 1). Tidak ada halaman yang hanya berisi header profil.
- **Fixture QA panjang yang sudah ada:** baris terakhir halaman sebelum halaman pertama entry panjang berada dalam jarak ≤ tinggi satu child terpanjang + 24 pt dari margin bawah. Ganti log `PDF-QA long entry gap` dengan assertion.
- **Experience panjang:** satu experience dengan ≥ 12 achievement kontekstual 2–3 baris, didahului summary sekitar setengah halaman. Assertion: tidak ada celah > tinggi satu child di halaman sebelum experience, heading *Experience* tidak yatim, dan tidak ada child yang terbelah.
- **Batas bawah taksiran:** setiap entry yang diberi `entry-flow` di semua fixture terukur lebih tinggi dari 751 pt (jumlah segmen per halaman dari posisi y pdf.js). Tambahkan juga fixture entry yang hampir satu halaman tetapi muat (sekitar 90% tinggi konten): entry ini **tidak** ditandai dan tidak terbelah.
- **Tanpa regresi:**
  - sapuan 60 varian tetap 0 heading yatim dan 0 entry terbelah;
  - CV multipage en/id tetap 1 < halaman ≤ 20, dan setiap bullet `START-/END-` tetap di satu halaman;
  - §1.10 (cocok model) dan §1.12 (margin/A4) tetap lulus.
- **Mutasi:** hapus sementara kelas `entry-flow` atau aturannya. Test fixture bentuk E2E dan experience panjang harus gagal; catat hasilnya di receipt, lalu pulihkan.
- **Unit `tests/unit/cv-print-template.test.ts`:**
  - entry pendek tanpa `entry-flow`;
  - entry dengan banyak child panjang mendapat `entry-flow`;
  - fungsi taksiran deterministik;
  - test lama tidak diubah.
- **E2E:** jalankan ulang `test:e2e:cv-export` dengan screenshot. Buka `pdf-en-page-1.png` dan `pdf-id-page-1.png`: halaman 1 harus memuat awal entry project. Catat jumlah halaman baru dan temuan visual di receipt.

## 3. Checks yang wajib diulang setelah remediasi

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:pdf
pnpm test:integration:cv-export
pnpm test:e2e:cv-export
pnpm build
pnpm worker:check
git diff --check
```

Env per command mengikuti §7 plan: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, dan `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`. Kosongkan `AI_AGENT` dan `ANTHROPIC_BASE_URL`. Template dipakai worker, jadi `test:integration:cv-export` (renderer nyata) wajib ikut.

Tulis receipt `docs/verification/T22-phase7b-remediation.md` berisi:

- test yang gagal sebelum perbaikan (output);
- perubahan template beserta alasan per aturan;
- tabel mutasi;
- jumlah halaman fixture sebelum dan sesudah perbaikan;
- inspeksi screenshot;
- command, exit code, dan angka.

Commit `fix(t22): let entries taller than a page flow instead of leaving a blank page`, lalu `test(t22): record review remediation receipt`.

## 4. Hasil verifikasi ulang reviewer (HEAD `d68ad3e`)

Semua command dijalankan reviewer sendiri pada 8 Oktober 2026. Docker hidup, parity migration 31/31, dan `workpulse-t21-pdf`, Gotenberg T15, serta ClamAV T10 berjalan. Env dimuat per proses.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm exec supabase migration list --local` | 0 | 31/31, terakhir `20261005090000` |
| `pnpm lint` | 0 | lulus |
| `pnpm typecheck` | 0 | lulus |
| `pnpm test` | 0 | 103 file / 954 test |
| `pnpm worker:check` | 0 | lulus |
| `pnpm test:pdf` | 0 | 1 file / 36 test (renderer nyata) |
| `pnpm test:integration:cv-export` | 0 | 3 file / 35 test |
| `pnpm db:test` | 0 | 15 file / 1290 assertion, PASS |
| `pnpm db:lint` | 0 | `results: []` |
| `pnpm test:integration:storage` | 0 | 1 / 1 |
| `pnpm test:integration:evidence` | 0 | 3 file / 14 test |
| `pnpm test:integration:cv-freshness` | 0 | 1 file / 11 test |
| `pnpm test:integration:cv-builder` | 0 | 1 file / 7 test |
| `pnpm test:e2e:cv-export` | 0 | 12 passed (2,6 menit) |
| `pnpm test:e2e:cv` | 0 | 8 passed |
| `pnpm test:e2e:cv-freshness` | 0 | 10 passed |
| `pnpm test:e2e:evidence` | 0 | 8 passed (adapter storage aditif, unduhan evidence tidak berubah) |
| `pnpm test:e2e:m2` | 0 | 1 passed (assertion env tidak dilemahkan) |
| `pnpm test:e2e:m3` | 0 | 2 passed |
| `pnpm build` | 0 | route `ƒ /cv/preview` terdaftar |
| `git diff --check fe64466..HEAD` | 0 | bersih |
| `git diff fe64466..HEAD -- supabase workers pnpm-lock.yaml` | — | kosong |
| grep `console.` di `src/features/cv`, `src/app/(workspace)/cv`, `src/app/api/cv`, `src/domain/cv`, `src/server/export` | — | 0 |

Angka di atas cocok dengan receipt Fase 7. Suite lain dari §7 tidak diulang oleh reviewer; buktinya receipt Fase 7. Reviewer tidak mengulangnya karena perubahan T22 tidak menyentuh jalur domain tersebut. Run E2E reviewer menulis ulang PNG screenshot (N3), dan file itu dipulihkan dengan `git checkout`.

## 5. Yang sudah lulus review (tidak perlu diubah)

- **Revision tersimpan.** S14 hanya membaca baris tersimpan (`getCv` tanpa `ensure`, lalu `buildCvPreviewModel`). `expected_revision` sama dengan `savedRevision` yang ditampilkan. `STALE_REVISION` memunculkan notice *Reload* tanpa request ulang otomatis, dan E2E dua tab mencatat 0 export. Draft S13 tidak pernah sampai ke S14, dan tautan *Preview and export* nonaktif dengan alasan selama status ≠ `saved`.
- **Aksi.** `exportActions` sesuai §2.4.3: *Retry* hanya untuk `failed`, kode retriable, `attempt_count < 3`, dan revision saat ini; selain itu *Regenerate*. Kode permanen mengarah ke S13. Setiap keadaan punya satu aksi utama. Idempotency key baru per klik, dan klik ganda ditahan `inFlight`.
- **Unduhan.** Signed URL dibuat saat klik lewat action (TTL 300 detik, `exp` diuji di integration) dan tidak ada di HTML awal (E2E). Nama file generik `WorkPulse-CV-<UTC>.pdf`; `filename` dari form diabaikan. `inline` hanya diterbitkan untuk pemilik lewat RPC owner-scoped yang sama.
- **pdf.js.** Build browser dimuat dinamis, dan worker terbundel lewat `new URL(...)` (probe Fase 0 + E2E). pdfjs-dist 6.3.289 tidak punya opsi `isEvalSupported` dan `build/pdf.mjs`/worker tidak memuat `eval`/`new Function`. Byte PDF hanya di memori, dan dokumen di-destroy saat unmount.
- **Route status.** Hanya pemilik (RLS + filter `user_id`). Kolom yang dikembalikan aman (`EXPORT_COLUMNS` tanpa `object_key`, `attempt_token`, atau `snapshot`). ID asing, acak, dan bukan UUID mendapat 404 identik dengan `no-store`, dan anonim mendapat 401.
- **QA PDF.** Analisis memakai posisi teks pdf.js dari Chromium nyata. Uji mutasi Fase 4 membuktikan sapuan benar-benar menekan heading ke dasar halaman. Aturan `overflow-wrap: anywhere` minimal dan beralasan: token panjang sebelumnya menyusutkan seluruh dokumen. Reviewer membuka halaman PDF 1, 2, 7, dan 9 serta screenshot keadaan failed, succeeded, dan blocked; satu-satunya cacat visual adalah RV1.
- **Batas scope.** Tidak ada migration, perubahan RPC/worker, dependency, AI, evidence, atau fitur T23–T25. Adapter storage aditif: tanpa opsi, pemanggil lama tetap memanggil adapter dengan dua argumen, dan E2E evidence lulus.

## 6. Catatan lingkungan (bukan temuan T22)

Selama review, working tree mendapat perubahan yang bukan berasal dari reviewer maupun T22:

- `AGENTS.md` mendapat blok `<!-- antislop:start -->…<!-- antislop:end -->`;
- muncul file baru `CLAUDE.md` dan direktori `.codex/`.

Perubahan ini tidak di-commit reviewer. `AGENTS.md` root dan `docs/AGENTS.md` sekarang tidak identik. Pengguna perlu memutuskan apakah blok itu dipertahankan; bila ya, salin juga ke `docs/AGENTS.md`.
