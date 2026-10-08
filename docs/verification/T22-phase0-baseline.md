# T22 Fase 0 — Baseline, probe, dan persetujuan

- Tanggal: 6 Oktober 2026
- Pelaksana: Claude Sonnet 5.5
- HEAD saat mulai: `3e3051f` (turunan `fe64466`); branch `claude/clever-archimedes-gbu7qd`; working tree bersih kecuali `.claude/`.
- **Status Fase 0: SELESAI** (7 Oktober 2026). Sesi pertama (6 Oktober) tertahan oleh blocker lingkungan (§2); setelah pengguna memulihkan port Supabase, seluruh baseline dan kedua probe diselesaikan. Tidak ada stop condition §8 yang terpicu.

## 1. Persetujuan keputusan produk §2.4

Pengguna menyetujui keenam keputusan §2.4 pada 6 Oktober 2026 ("Setuju semua"), sesuai rekomendasi plan. Tidak ditanyakan ulang:

1. Sumber batas halaman: halaman PDF nyata (pdf.js di browser) setelah export; HTML tersimpan sebelum export.
2. Nama file unduhan generik `WorkPulse-CV-<YYYY-MM-DD>.pdf`.
3. Retry hanya untuk revision tersimpan saat ini; selain itu Regenerate.
4. Riwayat ringkas lima export terakhir.
5. Polling otomatis dengan jeda bertahap sampai 30 detik.
6. Template boleh diubah hanya pada aturan break/spacing, bila QA membuktikan perlu.

Sampai sekarang tidak ada temuan yang menuntut penyimpangan dari salah satunya.

## 2. Insiden lingkungan (diselesaikan)

**Resolusi (7 Oktober 2026):** pengguna memulihkan port Supabase; `Test-NetConnection` ke 54321 dan 54322 → `True`, dan seluruh stack Supabase dapat dipakai. Tidak ada perubahan kode atau konfigurasi repo, tanpa `db:reset`. Docker sempat restart sekali lagi di tengah sesi (ketiga container `workpulse-*` kembali `Exited (255)`; `integration cv-export-renderer-real` gagal keras dengan "PDF renderer is not reachable" dan tidak jatuh ke fake) → `docker start` ulang, lalu suite diulang dan lulus. Catatan di bawah adalah bukti insiden awal.

Saat sesi dimulai, seluruh container Docker berstatus `Exited (255)` (restart Docker). Tindakan yang saya ambil:

| Tindakan | Hasil |
| --- | --- |
| `docker start workpulse-t21-pdf workpulse-t15-gotenberg workpulse-t10-clamav` | ketiganya hidup; `GET http://127.0.0.1:13401/health` → `chromium: up`; `GET http://127.0.0.1:13400/health` → 200; ClamAV `health: starting` saat dicek terakhir |
| `pnpm db:start` | exit 0, tetapi stack Supabase **tidak terjangkau dari host** |
| `docker restart supabase_db_WorkPulse`, lalu `supabase_kong_WorkPulse` | tetap tidak terjangkau |

Bukti:

- `Test-NetConnection 127.0.0.1 -Port 54321` dan `-Port 54322` → `TcpTestSucceeded: False`; `netstat` tidak menunjukkan listener.
- `docker inspect supabase_kong_WorkPulse` → `HostConfig.PortBindings` memuat `8000/tcp → 54321`, tetapi `NetworkSettings.Ports` = `{"8000/tcp":[]}` (Docker tidak berhasil mempublikasikan port). Container `workpulse-t21-pdf` dan `workpulse-t15-gotenberg` tetap terpublikasi normal (`127.0.0.1:13401`, `:13400` LISTENING).
- `netsh int ipv4 show excludedportrange protocol=tcp` memuat rentang cadangan Windows **`54181–54280`** dan **`54281–54380`**. Seluruh port Supabase lokal (54321 API, 54322 DB, 54323 Studio, 54324 Mailpit, dan seterusnya) jatuh di dalamnya, sehingga Docker tidak dapat mengikatnya.
- Sesi ini bukan administrator (`IsInRole(Administrator)` = `False`); layanan `winnat` berjalan.

Yang tidak saya lakukan, karena mengubah pengaturan sistem/jaringan di luar lingkup (dan `db reset` dilarang): `net stop winnat`/`net start winnat`, `wsl --shutdown`, reboot, atau mengubah port di `supabase/config.toml`/`.env.local`.

Perbaikan yang diperlukan dari sisi pengguna (hak administrator), setelah itu saya dapat melanjutkan Fase 0 tanpa perubahan kode:

```powershell
# PowerShell sebagai Administrator
net stop winnat
net start winnat
```

Lalu, dari repo, `pnpm db:stop` dan `pnpm db:start` (tanpa `--no-backup`, volume data dipertahankan; **tanpa** `db:reset`) agar container Supabase dibuat ulang dengan port terpublikasi, dan verifikasi `Test-NetConnection 127.0.0.1 -Port 54321`. Reboot Windows juga menghapus cadangan port itu.

**Kelalaian saya (dicatat):** output `pnpm db:start` mencetak JSON status Supabase termasuk key lokal (`SECRET_KEY`, `SERVICE_ROLE_KEY`, `ANON_KEY`, dll.) ke transcript sesi. Itu key dev lokal bawaan Supabase CLI untuk stack di `127.0.0.1`, bukan credential production, tetapi seharusnya tidak tercetak. Tidak ada key yang saya tulis ke file; output `db:start`/`db:status` selanjutnya saya saring.

## 3. Baseline

| Command | Harapan | Hasil aktual |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | — | exit 0, "Already up to date" |
| `pnpm lint` | lulus | **exit 0** |
| `pnpm typecheck` | lulus | **exit 0** |
| `pnpm worker:check` | lulus | **exit 0**, `status: ready`, delapan job terdaftar termasuk `cv-export`, `export-cleanup` |
| `pnpm test` | 98 file / 845 test | **exit 0**, `Test Files 98 passed (98)`, `Tests 845 passed (845)` |
| `pnpm exec supabase migration list --local` (parity 31/31) | 31/31 | **31/31** (JSON `migrations`: 31 baris, `local == remote` pada 31; terakhir `20261005090000`) |
| `pnpm db:test` | 15 file / 1290 assertion | **exit 0**, `Files=15, Tests=1290`, `Result: PASS` |
| `pnpm test:integration:cv-export` | 2 file / 27 test | **exit 0**, `Test Files 2 passed (2)`, `Tests 27 passed (27)` (renderer nyata `workpulse-t21-pdf`; run pertama gagal karena container mati, lihat §2) |
| `pnpm test:e2e:cv` | 8 | **exit 0**, `8 passed` |
| `pnpm test:e2e:cv-freshness` | 10 | **exit 0**, `10 passed` |

Catatan: `lint`/`typecheck`/`worker:check` memperlihatkan `NativeCommandError` di PowerShell 5.1 karena stderr dibungkus; angka exit code (0) diambil dari `$LASTEXITCODE`. Suite memakai env yang dimuat per command (`.env.local`, `SERVICE_ROLE_KEY` JWT sebagai `SUPABASE_SECRET_KEY` hanya di env proses, `WORKPULSE_PDF_GOTENBERG_URL=http://127.0.0.1:13401`); untuk E2E `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

## 4. Verifikasi source (file:baris)

| Area | Temuan |
| --- | --- |
| Halaman S13 | `src/app/(workspace)/cv/page.tsx:16` memakai `requireCompletedWorkspace("/cv")`; `:33` memanggil `service.ensure()` (S14 tidak boleh memanggilnya); `:35` memuat `getCv`, pool, freshness; `:44-55` pola `InlineError` + correlation ID + tautan *Retry*. `loading.tsx` ada (skeleton `app-card ... animate-pulse`). |
| Guard workspace | `src/server/auth/workspace-page.ts:6-16`: anonim → `/sign-in?returnTo=`, tanpa profil → `serviceUnavailable`, belum onboarding → `/onboarding/import`. |
| Proxy | `src/proxy.ts:8-18` dan `:68-84` sudah melindungi `/cv` dan `/cv/:path*` (optimistic redirect). |
| Navigasi | `src/components/layout/workspace-navigation.tsx:36-40`: `isCurrent("/cv/preview","/cv")` bernilai true (`startsWith("/cv/")`); tidak perlu perubahan. |
| **returnTo** | `src/domain/routes/safe-return.ts:13-23`: `APP_PATHS` hanya memuat `/^\/cv$/`. `sanitizeReturnTo("/cv/preview")` → `/dashboard` (lihat G1). |
| Pola route | `src/app/api/imports/[id]/route.ts:3-12` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`, `GET` memanggil `importHttp(request, false, ...)`); `src/features/import/http.ts:19-47` (sesi server, `Cache-Control: no-store`, error `{code,message,correlationId}`). |
| Builder dan preview | `src/features/cv/cv-builder.tsx:111` model dari `buildCvPreviewModel({ document: doc, items })`; `:466` `data-testid="cv-builder"`; `:468` `CvSaveBar`; `:497-501` `CvSettings`/`CvProfileEditor`; `:506-508` kolom preview memakai `<CvPreview model locale dirty />`. `src/features/cv/cv-preview.tsx:29-60` menerima model, bukan draft. |
| Anchor S13 | `#cv-review`: `src/features/cv/cv-review.tsx:154` (`<section id="cv-review">`). `#cv-item-<id>`: `src/features/cv/cv-section.tsx:78` (`<li id={`cv-item-${entry.itemId}`}>`). **Panel profil tidak punya `id="cv-profile"`**: `src/features/cv/cv-panels.tsx:129` (`<section ... aria-labelledby="cv-profile-heading">`), hanya heading `id="cv-profile-heading"` (`:130`); ringkasan review menautkan profil ke `#cv-profile-heading` (`cv-review.tsx:160`). Jadi `id="cv-profile"` harus ditambah (plan §2.2.9). |
| Export T21 | `src/features/cv/export-service.ts:79-165`: `getReadiness`, `listExports` (kolom aman `:28-29`, batas `:30`), `requestExport`, `retryExport`, `issueDownload :145` (memanggil `issueDownload(key, 300)` `:157`, tanpa opsi). `src/features/cv/actions.ts:171-189`: tiga action; `issueCvExportDownloadAction :185` mem-parse `downloadCvExportInput` hanya dengan `export_id`. |
| Domain export | `src/domain/cv/export.ts:16-20` konstanta; `:69` `buildExportRenderModel`; `:120` `isPermanentExportError`; `:125` `isExportExpired`. `src/domain/cv/preview.ts:34-40` `CvPreviewModel`; `labels.ts` `CV_LABELS`. |
| Storage | `src/server/storage/adapter.ts:8` `createSignedDownloadUrl(objectKey, expiresInSeconds)`; `supabase-storage-adapter.ts:64-70` selalu `{ download: true }`; `private-storage-service.ts:79-97` `issueDownload(objectKey, expiresInSeconds = 300)` memvalidasi TTL 1..300 lalu memanggil adapter tanpa opsi. |
| Polling | `src/features/evidence/evidence-attachments.tsx:17` `EVIDENCE_POLL_DELAYS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const`; dipakai ulang di `import-start.tsx:121`, `activity-analysis-panel.tsx:258`. |
| Worker | `workers/run.ts:16` `--once`; `:36` `resolvePdfRenderer()`; `:43` `runExportWorkerOnce({ ...exportGateway, renderer, parse: parseInThread })`; `:58` penanda `pdfRenderer: "explicit-test-fake"` untuk fake. Helper pola: `tests/e2e/helpers/import-worker.ts:6-52` (child env, `NODE_ENV=test`, `execFile` `workers/run.ts --once`, summary JSON baris terakhir). |
| Template | `src/server/export/cv-print-template.ts:14-31` STYLE: `@page { size: A4; margin: 16mm 18mm }`; `h2`/`h3` `break-after: avoid`; `.entry` dan `.child` `break-inside: avoid`. Tidak ada `orphans`/`widows`. |
| pdf.js | `pdfjs-dist` 6.3.289. Hanya `legacy/build/pdf.d.mts` yang ada; `build/pdf.mjs` tidak punya deklarasi tipe (lihat G2). Opsi `isEvalSupported` tidak ada di v6 (lihat G3). |
| Migration | 31 file; terakhir `20261005090000_t21_cv_export_backend.sql`. |

## 5. Ekstraksi DOCX (python + zipfile atas `word/document.xml`)

PRD R10, *CV freshness contract*, kriteria uji, F07 langkah 4–6, dan S14 diekstrak ulang dan cocok dengan kutipan §0 plan:

- **R10:** "Export the saved CV revision as searchable A4 text with correct page breaks. Failure preserves the draft and supports retry. Evidence is not embedded or linked."
- **Freshness:** deleted/unconfirmed memblokir export; "Previously downloaded PDFs remain unchanged."
- **Uji:** "Validate PDF text extraction, Indonesian characters, long bullets, and multipage output."; skenario graduate dan *delete its source and verify export is blocked until resolved*.
- **F07:** "Save the CV, then open S14. Preview uses that exact saved revision."; "Export queues a job tied to the immutable saved snapshot and CV revision. Success offers Download PDF. Failure shows Retry for the same snapshot; ongoing edits do not alter the running export."
- **S14:** "Show the exact saved snapshot, page boundaries, page navigation, and export status."; "Retry uses the same snapshot. Download remains available for 24 hours, through short lived authorized URLs; an expired file offers Regenerate. Evidence never appears in the PDF."

## 6. Probe pdf.js di build Next 16 — LULUS (dua putaran)

Putaran 1 (6 Oktober): PDF disajikan server Node lokal lintas origin karena Storage belum terjangkau. Putaran 2 (7 Oktober, §6.2): signed URL `inline` dari Storage lokal nyata. Keduanya lulus; tabel di bawah adalah putaran 1, putaran 2 di §6.2.

### 6.1 Putaran 1 — server CORS lokal

Metode: halaman scratch `src/app/probe-pdfjs/` (client component, `await import("pdfjs-dist/build/pdf.mjs")`, `GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()`), `pnpm exec next build` (Turbopack, Next 16.3.5) + `next start --port 3099`, di-drive Playwright Chromium. PDF: tiga halaman dari renderer nyata `workpulse-t21-pdf` (24.299 byte). Karena Storage tidak terjangkau (§2), PDF disajikan oleh server Node lokal di port 3098 (origin berbeda) dengan `Access-Control-Allow-Origin: *`. Seluruh file probe (halaman dan skrip) sudah dihapus; `git status` kembali bersih.

| Cek | Hasil |
| --- | --- |
| `next build` sukses | **ya**, exit 0 (`✓ Compiled successfully`, route `ƒ /probe-pdfjs`) |
| Worker terbundel | **ya**: Turbopack mengeluarkan `/_next/static/media/pdf.worker.min.<hash>.mjs`, 1.265.413 byte (sama dengan sumber `pdf.worker.min.mjs`) |
| Worker nyata, bukan *fake worker* | **ya**: `new PDFWorker({}).port instanceof Worker` = `true`; event Playwright `worker` memuat URL worker itu; tidak ada pesan konsol "fake worker" (`consoleMessages` kosong) |
| `fetch` lintas origin (`:3099` → `:3098`, `cache: "no-store"`, `credentials: "omit"`) | **ya**: status 200, 24.299 byte. `response.headers.get("access-control-allow-origin")` bernilai `null` di JS (header ACAO tidak diekspos ke JS; keberhasilan fetch mode `cors` yang membuktikan CORS) |
| Render canvas | **ya**: 3 halaman, masing-masing 594 × 841 px (skala 1); piksel non-putih 30.070, 57.833, dan 14.511 dari 499.554 → tidak kosong |
| Pesan konsol/`pageerror` | tidak ada |

### 6.2 Putaran 2 — signed URL Storage lokal nyata

Metode: skrip scratch (service role, env proses saja) mengunggah PDF throwaway dari renderer nyata (24.299 byte, 3 halaman) ke bucket `workpulse-private` di key berbentuk export `<uuid>/export/<uuid>` (owner acak, bukan akun nyata), menerbitkan tiga signed URL, memeriksa header, lalu halaman probe Next (build `next build` + `next start --port 3099`, origin `http://127.0.0.1:3099`) mengambil URL `inline` lintas origin ke `http://127.0.0.1:54321` dengan `fetch(url, { cache: "no-store", credentials: "omit" })` dan merender semua halaman ke canvas. Objek Storage dihapus sesudahnya (`removeError=none`); halaman probe dan skrip dihapus; token URL tidak dicetak.

| Cek | Hasil |
| --- | --- |
| `inline` (tanpa opsi `download`) | HTTP 200, `content-type: application/pdf`, **tanpa `content-disposition`**, `access-control-allow-origin: *`, isi `%PDF-`, 24.299 byte, URL **tanpa** parameter `download`, klaim JWT `exp − now` = **300** detik |
| `attachment` + nama generik (`createSignedUrl(key, 300, { download: "WorkPulse-CV-2026-10-07.pdf" })`) | HTTP 200, `content-disposition: attachment; filename=WorkPulse-CV-2026-10-07.pdf; filename*=UTF-8''WorkPulse-CV-2026-10-07.pdf`, ACAO `*`, `exp − now` = 300; nama tidak memuat nama pengguna |
| `attachment` perilaku adapter saat ini (`{ download: true }`) | HTTP 200, `content-disposition: attachment;` **tanpa nama file** (browser memakai nama objek/UUID) — dasar keputusan §2.2.3 |
| Preflight `OPTIONS` (Origin `:3099`, `Access-Control-Request-Method: GET`) | HTTP 200, ACAO `*`, `access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS,TRACE,CONNECT` (fetch yang dipakai S14 adalah *simple request*, tanpa preflight) |
| Browser: `fetch` `inline` lintas origin (`:3099` → `:54321`) | status 200, 24.299 byte; respons yang diamati Playwright (`response.allHeaders()`) memuat `access-control-allow-origin: *`, `content-type: application/pdf`, tanpa `content-disposition` |
| Worker | `realWorker: true`; event `worker` memuat `/_next/static/media/pdf.worker.min.3bl-ygmetel-a.mjs` |
| Canvas | 3 halaman 594 × 841 px; piksel non-putih 30.070 / 57.833 / 14.511 dari 499.554 |
| Konsol / `pageerror` | kosong; `getDocument` dipanggil tanpa `isEvalSupported` (G3) dan tanpa `useSystemFonts` |

Kesimpulan probe: tidak ada stop condition (worker terbundel, CORS Storage tidak ditolak, canvas tidak kosong).

## 7. Probe page break — 60 varian, template saat ini

Metode (skrip scratch di luar repo, tidak di-commit): model `CvPreviewModel` sintetis → `renderCvPrintHtml` → `GotenbergPdfRenderer` nyata (`http://127.0.0.1:13401`, tanpa jatuh ke fake) → pdf.js legacy (`getTextContent`, item dikelompokkan per baris y ± 1 pt). Ringkasan berisi *n* baris (n = 1…60, tiap baris 14,5 pt) menggeser empat section (Experience 2 entry, Projects 3, Education 2, Selected achievements 3; tiap entry berisi headline, subline·tanggal, teks, dan dua child) melewati dasar halaman dan sebaliknya. Heading dan judul entry/child dikenali dari teksnya (bukan ukuran font). Tinggi konten per halaman: y 45,35 … 796,57 pt (A4 841,92 pt, margin 16 mm).

Hasil: **60/60 varian dirender sukses** (3–4 halaman), **0 halaman** yang baris terakhirnya adalah heading section/judul entry/judul child, **0 entry** yang terbelah antarhalaman (setiap entry tinggi ±140 pt, muat satu halaman). Bukti bahwa sapuan benar-benar menggeser heading ke dasar halaman:

| n | Halaman 1: baris terakhir (y) | Letak heading setelah titik batas |
| --- | --- | --- |
| 13 | `PB0c2` (53) | `Projects` di halaman 1, y=200 (heading + entry pertama muat) |
| 14 | `EA1c2` (213,5) — ±168 pt kosong di dasar | `Projects` dipindahkan utuh ke dasar-atas halaman 2, y=785 |
| 25 | `EA1c2` (54,5) | `Projects`/`Education` mulai di halaman 2 (`Projects`@785) |
| 26 | `EA0c2` (185) | `EA1` dipindahkan utuh ke halaman 2; `Projects`@635 di halaman 2 |
| 35 | `EA0c2` (54,5) | `Experience`@200,5 di halaman 1 |
| 36 | `Baris ringkasan 36` (214) | `Experience`@785 di halaman 2 (heading + entry pertama ±176 pt > 168 pt tersisa) |

Interpretasi: `break-after: avoid` pada `h2`/`h3` dan `break-inside: avoid` pada `.entry`/`.child` bekerja di Chromium Gotenberg untuk entry yang muat satu halaman; tidak ada heading yatim dan tidak ada entry terbelah di sapuan ini. **Dengan sapuan ini, perubahan template §2.2.11 belum terbukti perlu.**

Batas probe ini (jangan dibaca lebih): semua entry pendek; bullet panjang (≥ 600 karakter), entry > 1 halaman, dan 12+ achievement belum tercakup. Itu fixture Fase 4 (`tests/pdf/`), yang menentukan final apakah template perlu diubah.

## 8. Temuan celah plan (untuk reviewer)

- **G1 — `returnTo` untuk `/cv/preview`.** `safe-return.ts` hanya mengizinkan `/^\/cv$/`; `/cv/preview` jatuh ke `/dashboard`. Acceptance §1.1 ("Anonim → sign-in dengan `returnTo` yang aman") memerlukan `/^\/cv(?:\/preview)?$/` di `APP_PATHS`. File itu tidak ada di tabel §4 plan. Rencana: tambah satu pola di `src/domain/routes/safe-return.ts` (aditif) dan test baru di `tests/unit/cv-export-page-state.test.ts` (tanpa mengubah test lama). Dicatat di receipt Fase 3.
- **G2 — tipe `pdfjs-dist/build/pdf.mjs`.** `next build` gagal type-check tanpa deklarasi (`TS7016`) karena hanya `legacy/build/pdf.d.mts` yang ada. Perlu shim deklarasi `declare module "pdfjs-dist/build/pdf.mjs" { export * from "pdfjs-dist"; }` (file tipe baru, bukan dependency) di Fase 3. Terbukti membuat build lulus di probe.
- **G3 — `isEvalSupported` tidak ada di pdfjs-dist 6.3.289** (tidak ada di `types/`; komentar `src/server/documents/pdf-text.ts` juga menyatakan v6 tidak memakai eval). Plan §2.2.2 menulis `isEvalSupported: false`; di v6 opsi itu tidak ada dan tidak akan dikirim. Tetap tanpa eval karena versinya; reviewer dapat memeriksa lewat tidak adanya error CSP di E2E.
- **G4 — cek ACAO.** `fetch` tidak mengekspos `access-control-allow-origin` ke JS; ACAO Storage diperiksa dari sisi node (header respons) dan dari Playwright (`response.allHeaders()`). Integration `cv-export-preview.test.ts` akan memeriksanya dari sisi node.
- **G5 — Storage `attachment`.** `createSignedUrl(key, ttl, { download: true })` menghasilkan `content-disposition: attachment;` tanpa nama file; nama generik hanya lewat `{ download: "<nama>" }`. Adapter diperluas sesuai §2.2.3 (pola nama `^[A-Za-z0-9._-]{1,80}\.pdf$`).

## 9. Acceptance yang terbukti / belum

- **Terbukti di Fase 0 (lokal):** baseline lengkap (lint, typecheck, worker:check, unit 98/845, parity 31/31, pgTAP 15/1290, integration cv-export 2/27, E2E cv 8, E2E cv-freshness 10); probe pdf.js dengan signed URL Storage nyata (§6.2); probe page break pada template saat ini (§7); verifikasi source (§4); ekstraksi DOCX (§5); persetujuan §2.4 (§1).
- **Belum terbukti:** semua acceptance §1 plan (1–18) — itu pekerjaan Fase 1–7. Fase 0 tidak mengubah kode.

## 10. Langkah berikutnya

Fase 1: domain murni `src/domain/cv/export-view.ts` dengan test lebih dulu (`tests/unit/cv-export-view.test.ts`), commit `feat(t22): add export view rules`.
