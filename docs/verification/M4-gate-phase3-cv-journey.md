# Gate M4 — Fase 3: E2E journey F07

- Tanggal: 9 Oktober 2026.
- Pelaksana: Claude Sonnet 5.5.
- Tujuan: membuktikan kriteria §1.1, §1.2, §1.5, §1.7, §1.9 dan §1.12 lewat satu journey di browser nyata.

## File

| File | Isi |
| --- | --- |
| `playwright.m4.config.ts` | Salinan config cv-export: port **3016**, `testMatch` `m4-cv-journey.spec.ts`, 1 worker, timeout 900 s. Web server tanpa `WORKPULSE_AI_*`, `OPENAI_*`, `DOCX_*`, `GOTENBERG_*`, `PDF_*` |
| `package.json` | `test:e2e:m4` (dan `test:integration:m4` untuk Fase 4) |
| `tests/e2e/m4-cv-journey.spec.ts` | Satu test, 12 langkah. Memakai ulang `helpers/accessibility.ts` dan `helpers/export-worker.ts` (renderer nyata `gotenberg`, `fake` hanya untuk mengosongkan antrean sebelum mulai, `unavailable` untuk langkah gagal) |
| `tests/e2e/cv-freshness.spec.ts` | Satu test tambahan untuk T20 F1 (lihat temuan) |

Akun, drain worker, dan pemajuan `expires_at` lewat SQL admin adalah satu-satunya jalan di luar UI. Test juga menegaskan tidak ada variabel env AI di proses.

## Langkah (sesuai handoff §5 Fase 3)

1. **Graduate, keyboard:** sign in → onboarding hanya display name → S12 tambah education → Quick log note → `/projects/new` project `completed` → lampirkan activity → achievement turunan → Confirm tanpa metrics/evidence. Fokus dipindah dengan Tab (`tabTo`) dan aksi dengan Enter.
2. **S04:** Dashboard memuat *1 confirmed achievement is not on your CV.* (tautan `/cv#cv-pool-achievements`); `cv_items` kosong setelah confirm; tautan dibuka dengan keyboard.
3. **S13:** Add achievement → project parent ikut (2 item di *Projects*), Add education, bahasa CV Bahasa Indonesia (UI tetap English), override `Pengelolaan anggaran Rp1,5 miliar — “tepat waktu”`, dua kali *Move Education section up*, Save eksplisit.
4. **S14:** `Saved revision N` = `cv_documents.revision`; Export (keyboard) → status *Waiting to start* berfokus → renderer nyata → *PDF ready* → halaman 1 digambar → *Download PDF* (keyboard).
5. **PDF-1:** `%PDF-`, A4 (±1,5 pt), jumlah halaman = `page_count`, teks memuat nama, *Pendidikan*, *Proyek*, institusi, kualifikasi, judul project, override persis (setelah NFKC); *Pendidikan* muncul sebelum *Proyek* (urutan section ikut layout); tidak memuat wording sumber, `evidence`, `http(s):`, `.pdf`, `storage`. sha256 objek tersimpan = sha256 unduhan.
6. **S08 + freshness:** achievement kedua dibuat dari halaman project, *Add to CV* menyorot kandidat tanpa menambah (jumlah `cv_items` tetap), Enter menambah. Edit wording achievement pertama di S08 → S13 *Source changed* + *Manual wording*, preview tetap memuat override → *Keep my wording* → override utuh, fokus tetap di kontrol → S14 siap → **PDF-2** memuat override dan wording kedua, bukan teks sumber baru.
7. **Delete:** achievement kedua dihapus di S08 → S14 blocker `ITEM_DELETED` bertaut ke `/cv#cv-item-<id>` (Export dinonaktifkan, klik paksa tidak membuat export) → *Remove* di S13 → S14 siap → **PDF-3** tanpa wording kedua.
8. **PDF lama tidak berubah:** unduhan dari baris riwayat PDF-1 = sha256 PDF-1; objek tersimpan dan `md5(snapshot)` export PDF-1 sama dengan nilai awal.
9. **Retry dan Regenerate (keyboard):** renderer `unavailable` → *Export failed. Your CV is unchanged.* hanya *Retry* → Enter → status berfokus, export yang sama, renderer nyata → sukses (jumlah baris tidak bertambah). `expires_at` dimundurkan → *Download expired* → Enter pada *Regenerate* → export baru. PDF-1 tetap identik.
10. **Isolasi:** akun B membuka `/dashboard`, `/cv`, `/cv/preview`, `/achievements`, `/projects`, `/activity`, `/timeline`: tidak ada nama, judul, override, atau wording A. `GET /api/cv/exports/<id A | acak | bukan-uuid>` → 404 dengan badan identik (`EXPORT_NOT_FOUND`). Lewat API: `cv_exports`, `cv_documents`, `cv_items` milik A kosong bagi B, `get_cv_export_download` pesan galat sama untuk id A dan acak, `createSignedUrl` dan `download` objek A gagal.
11. **Aksesibilitas:** Axe WCAG A/AA tanpa pelanggaran pada S13 (selection, override, review *changed*) dan S14 (siap, terblokir, sukses dengan halaman PDF, sukses akhir). Satu pass 360 × 800 dark pada S13 dan S14 tanpa overflow horizontal dan tanpa pelanggaran Axe. Fokus tidak jatuh ke `body` setelah *Add* dan *Keep my wording*.
12. **AI-free:** `getByText(/analy[sz]|menganalisis|AI suggestion|saran AI/i)` pada setiap halaman journey = 0 (disclaimer eksplisit diizinkan).

Test juga menegaskan tidak ada `pageerror` selama journey.

## Hasil run

Run lulus ber-turut pada HEAD sesudah perbaikan: 3 kali (1,3 menit per run, test 53 detik). Run terakhir dengan `--reporter=html` dan `PLAYWRIGHT_HTML_OPEN=never` (laporan di `playwright-report/`, tidak di-track) menghasilkan sembilan screenshot lampiran: `s13-selection`, `s13-override`, `s13-review-changed`, `s14-ready`, `s14-succeeded-pdf1`, `s14-blocked`, `s14-succeeded-final`, `s13-360-dark`, `s14-360-dark`. Dua screenshot S13 dibuka dan diperiksa: preview mengikuti layout, tidak ada teks terpotong, bar samping fixed di tengah halaman adalah artefak `fullPage`. Tidak ada file di `docs/verification/T22-screenshots/` yang ditulis.

| PDF | Halaman | sha256 |
| --- | ---: | --- |
| PDF-1 | 1 | `c83390dbb756fc1da564ae0e414707d4210ff20bb21324f0f9b1111e8219ddc2` |
| PDF-2 | 1 | `f1f3e6cfe7d77f9a77728c5f0f67a9fb733e03c8145a9135029576a1ae905992` |
| PDF-3 | 1 | `062ea0d389b03d04d76e93113d15cc3b774c4047ed56bd7b65ead765df82de70` |

Nilai sha256 berubah pada setiap run karena metadata PDF memuat waktu pembuatan; yang diuji adalah kesamaan antar unduhan PDF-1, bukan nilai absolut.

Riwayat run selama penyusunan test (semua kegagalan nyata, tidak ada asersi yang dilemahkan):

| Run | Hasil | Penyebab | Jenis |
| --- | --- | --- | --- |
| 1 | gagal | Dua kali tekan *Move Education section up* berturut-turut: yang kedua jatuh karena aksi pertama belum selesai | test (ditunggu per perpindahan) |
| 2 | gagal | `expectFocusKept` dibaca sekali, sebelum efek fokus berjalan setelah `router.refresh()` | test (di-poll 8 detik) |
| 3 | gagal | Setelah CV berubah, aksi utama S14 adalah *Regenerate*, bukan *Export* | test (selector gabungan) |
| 4 | gagal | **Axe `scrollable-region-focusable` (serious) pada `.cv-preview-column` di S14 terblokir** | **produk → RV-A11Y, P2** |
| 5 | gagal | Asersi isolasi saya salah: akun B memang memiliki `cv_documents` sendiri | test |
| 6 | gagal | `pageerror` tak tertangkap: 78 × `TypeError: Cannot read properties of undefined (reading 'startsWith')` | **produk → RV-QL, P2** |
| 7 | gagal | sama dengan run 6, dengan URL dan stack (`/activity/new`, `onBeforeInput`) | produk |
| 8, html, 9 | **lulus** | — | — |

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV-A11Y | P2 | `.cv-preview-column` (`globals.css:2304`) sticky dengan `max-height: calc(100vh - …)` dan `overflow: auto`. Bila isinya lebih tinggi dari viewport dan tidak memuat kontrol yang dapat difokuskan, wilayah gulirnya tidak dapat dijangkau keyboard (WCAG 2.1.1, Axe serious). Terjadi di S14 (halaman PDF belum termuat atau terblokir) dan dapat terjadi di S13 untuk CV panjang. Fixture T19/T20/T22 terlalu pendek untuk memicunya | **Fixed** `3a6d8fb` (`role="region"`, `aria-label` *Preview*/*Pratinjau*, `tabIndex=0` di `cv-builder.tsx` dan `cv-export-page.tsx`). Test: unit `cv-builder-ui.test.tsx`, `cv-export-page-ui.test.tsx` (merah → hijau) dan Axe pada journey (run 4 merah → run 8 hijau) |
| RV-QL | P2 | `src/features/activity/activity-capture-form.tsx` (Quick log) membaca `event.nativeEvent.inputType.startsWith("delete")` di `onBeforeInput`. React membangun event itu dari `textInput`/`keypress`, yang tidak punya `inputType`, sehingga setiap karakter yang diketik melempar `TypeError` yang tidak tertangkap, dan penjaga batas 10.000 code point saat mengetik tidak pernah berjalan (jalur paste dan validasi server tetap berfungsi). Tidak ada kehilangan data. M2 dan T07 tidak mendeteksinya karena tidak memeriksa `pageerror` | **Fixed** `e67b8a6`: fungsi murni `src/features/activity/before-input.ts` (`insertedTextOf`), unit `tests/unit/activity-before-input.test.ts` (merah karena modul tidak ada → hijau 4/4), journey lulus tanpa `pageerror` |
| RV-F1 | P2 | T20 F1 (dari Fase 1/2): fokus jatuh ke `body` setelah `CV_SOURCE_CHANGED` | **Fixed** (kode `cv-builder.tsx` masuk dalam commit `3a6d8fb` bersama RV-A11Y karena satu file; test di commit `41c4af0`). Test E2E baru di `cv-freshness.spec.ts` merah (`activeElement` = `BODY` setelah 8 detik) → hijau; seluruh `test:e2e:cv-freshness` 11/11 |
| E-1 | P3 | Aksi server *download* hanya diuji lewat service/unit, bukan dari browser dengan id asing: aksi menerima `export_id` dari klien, tidak ada tombol yang membawa id A di halaman B. Isolasi aksi dibuktikan di integration M4-12 pada service yang sama (dan RPC mentah) | Catat |
| E-2 | P3 | `The destination stream closed early` muncul di log web server (sudah dikenal, T20 catatan non-temuan) | Catat |

## Blocker dan langkah berikutnya

Tidak ada. Fase 4: integration lintas domain.
