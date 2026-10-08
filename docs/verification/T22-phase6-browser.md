# T22 Fase 6 — Browser acceptance dan screenshot

- Tanggal: 7–8 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- Basis: `a7f5336` (Fase 5).
- Status: **selesai**. 12 skenario E2E lulus dua kali berturut-turut (135 dan 134 detik) dengan Supabase Auth/Storage/database nyata, renderer Chromium nyata (`workpulse-t21-pdf`), dan worker sebagai proses anak. Semua 18 halaman PDF dan 8 dari 24 screenshot keadaan S14 saya buka dan periksa. Satu temuan visual yang belum diperbaiki (F1, §5).

## 1. Tujuan

Membuktikan di browser nyata: S14 hanya menampilkan revision tersimpan, aksi eksplisit dan status yang diperbarui otomatis, halaman PDF nyata di canvas, unduhan, aturan Retry/Regenerate, konflik dua tab, isolasi akun, aksesibilitas, responsif, dan inspeksi gambar halaman.

## 2. File berubah

| Aksi | File |
| --- | --- |
| Create | `playwright.cv-export.config.ts` (port 3014; web server tanpa `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`, `WORKPULSE_DOCX_*`, `WORKPULSE_GOTENBERG_*`, `WORKPULSE_PDF_*`) |
| Create | `tests/e2e/helpers/export-worker.ts` (menguras `workers/run.ts --once`; env anak `NODE_ENV=test`, `WORKPULSE_PDF_RENDERER_MODE=gotenberg|fake|unavailable`) |
| Create | `tests/e2e/cv-export.spec.ts` |
| Create | `docs/verification/T22-screenshots/` (24 `s14-<state>-<360|1440>-<light|dark>.png` dan 18 `pdf-<id|en>-page-<n>.png`, 4,43 MB) |
| Modify | `package.json` (`test:e2e:cv-export`), `src/features/cv/cv-export-page.tsx`, `src/features/cv/cv-pdf-pages.tsx` (dua perbaikan dari temuan E2E, §4), `tests/pdf/cv-pdf-layout.test.ts` (satu baris log celah, §5) |

## 3. Skenario dan hasil

| # | Skenario | Yang dibuktikan |
| ---: | --- | --- |
| 1 | **access** | anonim → `/sign-in?returnTo=%2Fcv%2Fpreview` dan kembali ke S14; akun tanpa CV melihat empty state dengan tautan ke `/cv` dan `cv_documents` tetap 0 (halaman tidak membuat CV); item navigasi *CV* aktif; `GET /api/cv/exports/<id>` anonim → 401 `no-store` |
| 2 | **graduate, keyboard** | S13: tiga record dipilih dengan fokus + Enter, ringkasan diketik, tautan *Preview and export* nonaktif sampai *Save changes*; S14 menampilkan `Saved revision N` (N dari database) dan ringkasan tersimpan; *Export PDF* → `Waiting to start`, fokus pindah ke status, satu baris `queued`; worker dengan renderer nyata → `PDF ready` lewat polling; halaman PDF nyata (*Page 1 of N*, N = `page_count`, label canvas), piksel tidak kosong dan tepi tinta dalam margin; HTML awal tanpa `token=` atau URL Storage; *Download PDF* → event download, nama `WorkPulse-CV-<tanggal>.pdf`, isi `%PDF-`; konsol bersih |
| 3 | **unsaved** | wording diketik tanpa Save → tautan `aria-disabled` dengan alasan terlihat *Save your changes first.* (`aria-describedby`), klik tidak berpindah halaman; S14 di tab lain menampilkan revision tersimpan dan tidak memuat teks draf |
| 4 | **release: hapus sumber** | sumber terpilih dihapus → blocker `ITEM_DELETED` dengan tautan `/cv#cv-item-<id>`, *Export PDF* `aria-disabled` dengan alasan, klik tidak membuat export; di S13 *Remove* → S14 siap |
| 5 | **changed + Keep saved wording** | `ITEM_CHANGED` memblokir sampai *Keep saved wording*; export dengan renderer nyata memuat wording tersimpan dan **tidak** teks sumber baru (diperiksa dari objek Storage lewat parser `pdf-export`) |
| 6 | **gagal → Retry → sukses; lalu edit CV** | renderer `unavailable` → `RENDERER_UNAVAILABLE`, alasan terjemahan (tanpa kode), hanya *Retry export*; Retry → antre → renderer nyata → `PDF ready` (satu baris export); CV diubah → *Regenerate PDF* + *Download PDF*; export gagal kedua lalu CV diubah lagi → hanya *Regenerate* (tanpa *Retry*, utama maupun di riwayat) |
| 7 | **kedaluwarsa** | `expires_at` dimundurkan lewat SQL admin → `Download expired`, tanpa halaman PDF dan tanpa *Download*, *Regenerate PDF* membuat export baru; riwayat dua baris |
| 8 | **halaman PDF gagal dimuat** | request Storage diabort → pesan *The PDF pages could not be shown…*, `data-phase="error"`, *Download PDF* tetap tampil dan aktif; setelah jaringan kembali, *Try again* → halaman tergambar |
| 9 | **dua tab** | CV disimpan di tab B, *Export PDF* di tab A → notice `stale` + *Reload* (fokus pada notice), **0 export** (database), tidak ada request ulang otomatis; *Reload* → revision baru |
| 10 | **isolasi** | akun B: `GET /api/cv/exports/<id A>`, UUID acak, dan `not-a-uuid` → 404 identik (kode, pesan, kunci; `correlationId` berbeda) `no-store`; anonim → 401; halaman, seluruh respons teks/JSON, dan konsol B tidak memuat `WP-PRIVATE-CV-SENTINEL-<uuid>` milik A (yang tampil di halaman A sendiri) |
| 11 | **aksesibilitas dan responsif** | Axe (helper proyek: **semua** pelanggaran WCAG 2.0/2.1/2.2 A/AA, lebih ketat dari "serious/critical") tanpa pelanggaran pada enam keadaan × 360 dan 1440 px × terang dan gelap (24 kombinasi) dan tanpa overflow horizontal; keyboard: *Export PDF* memiliki outline fokus, Enter mengantre, status berperan `status` `aria-live="polite"` dan menerima fokus; `prefers-reduced-motion: reduce` → durasi transisi semua tombol/tautan `0s` |
| 12 | **CV panjang id dan en** | 12 achievement standalone dan 24 achievement bersarang (bullet ≥ 640 karakter), renderer nyata: 9 halaman (1 < 9 ≤ 20) per bahasa; setiap halaman: ditunggu sampai canvas selesai digambar, tepi tinta (piksel) di dalam margin A4, screenshot `pdf-<id|en>-page-<n>.png`; teks tersimpan memuat awal dan akhir bullet (`START-/END-` A1, A12, P1, P24) |

Keadaan "running" diperoleh dengan memindahkan export yang antre ke `running` lewat SQL (lease 30 menit) karena worker menyelesaikan job terlalu cepat untuk ditangkap; keadaan "failed" memakai mode renderer `unavailable` (jalur kode produksi yang sama).

## 4. Temuan selama fase ini dan perbaikannya

| # | Temuan | Jenis | Perbaikan |
| --- | --- | --- | --- |
| 1 | Setelah aksi, fokus dipindah dengan `requestAnimationFrame` sebelum notice sempat di-render; pada skenario dua tab `noticeRef` masih kosong dan fokus tidak pindah | **cacat aplikasi** | `focusSoon` kini memicu state yang diproses `useEffect` setelah commit (`cv-export-page.tsx`) |
| 2 | pdf.js menggambar bertahap; test yang menunggu "ada sedikit tinta" mengukur canvas yang baru sebagian tergambar (screenshot halaman 1 4 KB, tepi kiri tinta 0) | cacat test dan kekurangan aksesibilitas kecil | canvas diberi `aria-busy="true"` selama menggambar lalu `data-rendered="<halaman>"` (`cv-pdf-pages.tsx`); test menunggu penanda itu |
| 3 | `click({ force: true })` tidak menunggu visibilitas, sedangkan konten hasil streaming sesaat masih berada di kontainer React tersembunyi (DOM ada, belum ditampilkan) | cacat test | `toBeVisible()` sebelum klik force |
| 4 | Antrean job bersifat global: export yang ditinggalkan skenario aksesibilitas ikut diklaim skenario CV panjang (`claimed: 2`) | cacat isolasi test | `test.beforeEach` menguras antrean dengan renderer fake |
| 5 | Urutan deklarasi `BLOCKERS` di spec (typecheck) | cacat test kecil | dipindah |

Run pertama sebelum perbaikan 4: 11 lulus, 1 gagal (CV panjang). Setelah semua perbaikan: **12 lulus** pada run pertama dan kedua.

## 5. Inspeksi gambar halaman PDF

Saya membuka **setiap** gambar: `pdf-id-page-1` … `-9` dan `pdf-en-page-1` … `-9` (18 gambar, canvas hasil render dari PDF nyata pada lebar kolom ±400 px).

- **Tidak ada**: heading yatim di dasar halaman, teks terpotong di tepi, teks bertumpuk, glyph hilang, atau bullet terbelah antarhalaman. Setiap bullet berakhir dengan `END-…` pada halaman yang sama dengan `START-…`. Heading *Proyek/Projects* dan *Pencapaian/Achievements* selalu bersama entry pertamanya (halaman 2 dan 7). Halaman lanjutan project dimulai dengan child tanpa mengulang judul project (sesuai template). Tanggal mengikuti bahasa CV (`10 Mei 2023` / `May 10, 2023`), label section mengikuti bahasa CV, teks sumber tidak diterjemahkan. Garis tipis hijau pada tepi gambar adalah border CSS canvas S14, bukan bagian PDF.
- **F1 (temuan, belum diperbaiki): halaman 1 hampir kosong.** Pada fixture E2E halaman 1 hanya memuat nama (`pdf-id-page-1.png`, `pdf-en-page-1.png`, 4 KB): seluruh entry project (24 child bullet panjang, lebih dari satu halaman) dimulai di halaman 2. Penyebabnya adalah `break-inside: avoid` pada `.entry`: untuk entry yang tidak mungkin muat satu halaman, Chromium tetap memindahkannya ke awal halaman berikutnya, lalu memecahnya di halaman 2–7. Di fixture QA (`tests/pdf`, yang punya ringkasan dan experience) halaman sebelum entry panjang menyisakan **436 pt (58% halaman)** kosong (`PDF-QA long entry gap: the page before it ends at y=481`). Acceptance §1.11 mengizinkan entry yang lebih panjang dari satu halaman terbelah dan mencatatnya; yang dilanggar bukan itu, melainkan kualitas tampilan halaman yang sebelumnya.
  - Mengapa tidak saya perbaiki: aturan CSS saja tidak dapat memenuhi dua tuntutan sekaligus. Tanpa `break-inside: avoid` pada entry, entry pendek (muat satu halaman) dapat terbelah, melanggar §1.11 dan sapuan 60 varian; dengan `:has()`/`nth-child` ambang jumlah child tidak mewakili tinggi (6 child × 8 baris sudah lebih dari satu halaman). Perbaikan yang tepat memerlukan keputusan di dalam template berdasarkan perkiraan tinggi entry (kelas tambahan pada entry panjang), yaitu logika di luar "aturan break/spacing" (stop condition §8). Opsi untuk reviewer: (a) menerima sebagai P3 dan mendokumentasikan (entry > 1 halaman jarang: ≥ 24 bullet panjang), (b) menambah kelas `entry-flow` untuk entry dengan perkiraan tinggi > ±90% halaman dan menghapus `break-inside: avoid` hanya untuk kelas itu, dengan sapuan QA diperluas.
- **F2 (kosmetik):** pada keadaan *failed* kalimat "Your CV is unchanged." muncul dua kali (label status dan alasan). Tidak memengaruhi fungsi atau aksesibilitas.
- **F3 (kosmetik):** kolom preview S14 sticky dengan `max-height` sama seperti S13, sehingga screenshot `fullPage` memotong preview HTML di dasar (kolom itu menggulir di dalam). Perilaku diwarisi dari S13.

Screenshot keadaan S14 yang saya buka: `blocked-360-light`, `failed-1440-dark`, `succeeded-1440-light`, `succeeded-1440-dark`, `succeeded-360-dark`, `running-1440-light`, `expired-360-dark`, `ready-1440-dark`. Tema terang dan gelap berbeda sebagaimana mestinya (ukuran PNG yang hampir sama hanya kebetulan). 16 lainnya tidak saya buka satu per satu; Axe dan pemeriksaan overflow berlaku untuk seluruh 24 kombinasi.

## 6. Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test:e2e:cv-export` (run 1) | exit 0, **12 passed** (2,2 menit) |
| `pnpm test:e2e:cv-export` (run 2, menyimpan ulang screenshot) | exit 0, **12 passed** (2,2 menit), tanpa flaky |
| `pnpm test` | exit 0, 103 file / 954 test |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | exit 0 (route `ƒ /cv/preview` terdaftar) |
| `pnpm test:pdf` | exit 0, 1 file / 36 test |

Env tiap command: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY` hanya di env proses, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`; `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan. Container `workpulse-t21-pdf`, Gotenberg T15, dan ClamAV T10 sempat mati dua kali karena restart Docker dan dinyalakan kembali dengan `docker start` (suite gagal keras saat renderer tidak terjangkau, tanpa fallback ke fake).

## 7. Penyimpangan dari plan

- Skenario hapus sumber memakai RPC `delete_achievement` (seperti E2E T20), bukan dialog hapus S07.
- "Keyboard saja" memakai `focus()` + Enter pada kontrol yang dituju (pola E2E proyek ini), bukan menelusuri urutan Tab.
- Skenario 9 plan (aksesibilitas) dan inspeksi halaman panjang dipisah menjadi dua test (11 dan 12); dua skenario tambahan (access dan halaman PDF gagal) ditambahkan untuk §1.1 dan §1.6.
- Helper Axe proyek menegakkan nol pelanggaran WCAG A/AA, lebih ketat dari "tanpa serious/critical".

## 8. Acceptance §1 yang dibuktikan di fase ini

§1.1, §1.2 (dua tab), §1.3, §1.4, §1.5, §1.6, §1.7 (event download), §1.8, §1.9 (dua baris riwayat; lima baris dan label *Earlier revision* di render statis Fase 3), §1.13 (inspeksi gambar, F1 tercatat), §1.15, §1.16.

## 9. Langkah berikutnya

Fase 7: regresi penuh (seluruh §7 plan), cek diff terhadap `fe64466` (migration kosong, hanya file §4 plus yang tercatat), grep `console.`, `git diff --check`, receipt Fase 7, lalu serah-terima ke reviewer termasuk F1.
