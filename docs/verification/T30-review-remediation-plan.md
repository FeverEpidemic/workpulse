# T30 gate review dan rencana remediasi

- Tanggal: 23 Oktober 2026
- Reviewer: **Claude** (Opus), read-only terhadap kode produk. Probe review hanya di `.tmp/` (git-ignored).
- Branch: `claude/t30-motion-loading`, HEAD review `a60fa0f` (baseline handoff `dcd146d`, 8 commit pelaksana).
- Pelaksana: ChatGPT Sol 6.1 (reasoning medium), Fase 0 sampai 5.
- antislop: during (session override).
- **Verdict: BELUM LULUS.** Satu P2 terbuka (RV1). T30 tetap **PARTIAL**; Fase 6 belum boleh dimulai.

## Ringkasan

Implementasi rapi dan sesuai plan untuk hampir semua acceptance. Token, tombol pending, skeleton tanpa gradient, `ProgressStatus`, transisi dialog/sheet/toast, highlight item baru, dan reduced motion terbukti di kode dan di run ulang reviewer. Receipt jujur: angka unit, build, dan release yang diulang reviewer cocok dengan receipt.

Satu cacat perilaku lolos dari test pelaksana: animasi masuk halaman diputar ulang setelah hydration pada setiap pemuatan dokumen penuh, sehingga konten yang sudah tampil berkedip ke transparan lalu muncul lagi (RV1). Helper Axe pelaksana bahkan mencatat gejala ini ("starts its animation only after hydration") tanpa memperlakukannya sebagai bug.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| RV1 | P2 | Animasi halaman diputar ulang setelah hydration pada pemuatan dokumen penuh (kedip) | Terbuka |
| N1 | P3 | Escape memanggil `onOpenChange(false)` dua kali | Follow-up |
| N2 | P3 | Semua `Button` menjadi 8 px lebih lebar, beda dengan link bergaya tombol | Follow-up |
| N3 | P3 | Perubahan kontrak §2.2.7/§8 berdasar persetujuan di sesi ChatGPT; perlu konfirmasi pengguna di sini | Butuh konfirmasi |
| N4 | P3 | Konflik merge dengan T28 di `import-mode-dialog.test.tsx` dan `import-start.tsx` | Catatan merge |

### RV1 (P2): kedip setelah hydration

- **Gejala.** Pada pemuatan dokumen penuh ke halaman workspace (buka app di tab baru, redirect setelah sign-in, reload ke path lain dari path terakhir tab), konten hasil SSR sudah ter-paint, lalu `data-page-enter="true"` dipasang setelah hydration dan animasi `ui-page-enter` mulai dari `opacity: 0`. Pengguna melihat konten, lalu konten hilang sekejap dan fade masuk. Di perangkat atau jaringan lambat jeda paint ke hydration jauh lebih panjang, jadi kedipnya lebih jelas.
- **Bukti.** Probe reviewer `.tmp/t30-review-probe.spec.ts` pada build produksi (Chromium, lokal): `/activity` dibuka penuh setelah sign-in ke `/dashboard` menghasilkan `first-contentful-paint` 380 ms dan `animationstart ui-page-enter` 428.5 ms. `/dashboard` (path sama dengan path terakhir) tidak beranimasi.
- **Penyebab.** `src/app/(workspace)/template.tsx:12-27`: keputusan animasi dibuat di `useLayoutEffect` dengan membandingkan path di sessionStorage. Pada mount pertama setelah pemuatan dokumen, efek berjalan setelah HTML server sudah tampil. Test `tests/e2e/motion-loading.spec.ts:69-72` justru mengharapkan animasi terjadi setelah `signIn` (pemuatan penuh), sehingga mengunci perilaku yang salah.
- **Perbaikan minimal.** Animasi masuk hanya untuk navigasi client. Di `template.tsx`, flag tingkat modul (mis. `let hydratedOnce = false`): mount pertama setelah pemuatan dokumen memasang `data-page-enter="false"` lalu menyetel flag; mount berikutnya (template di-remount Next hanya saat segmen berganti) memasang `"true"`. Logika sessionStorage dan `document.referrer` dihapus. Filter GET tetap tidak beranimasi karena filter memuat ulang dokumen. `shouldEnterWorkspace` dan test unitnya disesuaikan atau dihapus.
- **Test regresi (gagal dulu, lalu lulus).**
  1. Ubah `motion-loading.spec.ts` "page entry": setelah `signIn` ke `/activity` (pemuatan penuh), jumlah `animationstart ui-page-enter` harus **0**; klik sidebar Projects harus menambah tepat 1; submit filter GET tetap 0.
  2. Tambah assertion: pada pemuatan penuh `/activity` dengan `prefers-reduced-motion: no-preference`, `.workspace-page-enter` punya `data-page-enter="false"` setelah hydration.
  3. Unit untuk fungsi keputusan baru (mount pertama vs berikutnya) dengan `renderToStaticMarkup` atau fungsi murni.
- **Checks yang wajib diulang.** `pnpm lint --ignore-pattern ".claude/**"`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e:release`, `pnpm test:e2e:ui`. Receipt `T30-phase5b-remediation.md`.

### N1 (P3): Escape memanggil `onOpenChange(false)` dua kali

`src/components/ui/dialog.tsx:49-53` kini punya `onCancel={() => onOpenChange(false)}`, lalu event `close` native ikut memanggil `onOpenChange(false)` lewat `onClose`. Konsumen yang punya efek samping (`unsaved-changes.tsx:263` memanggil `cancelNavigation`, `import-start.tsx:425` dan `import-review.tsx:384` menjadwalkan fokus, `import-mode-dialog.tsx:43` memanggil `onCancel`) terpanggil dua kali. Tidak ada kerusakan yang teramati di suite. Follow-up: lewati `onClose` bila `onCancel` sudah melapor, dengan unit yang menghitung panggilan.

### N2 (P3): lebar semua `Button` berubah

`globals.css` `[data-ui-button="true"] { padding-inline: calc(var(--space-4) + var(--space-1)); }` membuat setiap `Button` 20 px padding kiri-kanan, sedangkan link bergaya `.button-primary` tetap 16 px. Tujuannya ruang spinner supaya lebar tidak berubah saat pending, dan itu tercapai. Efek sampingnya, tombol dan link berdampingan kini berbeda lebar. Follow-up: samakan padding untuk semua kelas tombol, atau letakkan spinner di dalam padding 16 px yang ada.

### N3 (P3): perubahan kontrak navigasi pending

Plan §2.2.7 dan §8 awalnya mewajibkan berhenti bila `useLinkStatus` tidak memberi `pending`. Pelaksana menemukan hook kembali idle ketika `loading.tsx` tampil, lalu menambah store lifecycle fallback (`navigation-loading-store.ts`, `navigation-loading.tsx`, `pending-link-content.tsx`) dengan kutipan persetujuan "Boleh, perbaiki dan catat perubahan kontrak". Reviewer tidak dapat memverifikasi percakapan itu. Mekanismenya sendiri sehat: token per mount, cleanup hanya melepas token sendiri, tanpa timer tebakan, dan dibatasi frame workspace (`application-frame.tsx`); delapan unit dan enam E2E menjaganya. Pengguna diminta mengonfirmasi persetujuan ini di chat reviewer.

### N4 (P3): konflik dengan T28

T28 (belum merge) juga mengubah `tests/unit/import-mode-dialog.test.tsx` dan `src/features/import/import-start.tsx`. Saat salah satu merge ke `main`, yang lain perlu rebase dan menjalankan ulang `pnpm test` dan `pnpm test:e2e:import`.

## Checklist §9

| Butir | Hasil |
| --- | --- |
| Receipt Fase 0 sampai 5 lengkap dengan angka aktual | PASS |
| Tidak ada gradient baru; loop hanya skeleton dan spinner selama loading | PASS (`globals.css`, grep `gradient` 0 di diff) |
| Reduced motion: indikator punya teks, spinner diganti ikon statis | PASS (`globals.css` blok reduced motion, `LoadingIndicator`) |
| Tombol pending: label tetap, lebar tetap, opacity 1, tanpa submit ganda | PASS (lihat N2 untuk efek samping lebar) |
| `ProgressStatus` tidak membacakan waktu tiap detik, tanpa angka progress | PASS (waktu `aria-hidden`, di luar region `status`) |
| Dialog: Escape, tutup, backdrop, fokus kembali | PASS (lihat N1) |
| Chrome tidak ikut animasi; filter URL tidak memicu animasi | PASS untuk navigasi client; **FAIL** untuk pemuatan dokumen penuh (RV1) |
| Tepat satu toast setelah Quick log | PASS (`mobile-chrome.tsx:76-80` tidak menambah toast; `ActionFeedback` yang menampilkan) |
| Copy en/id tanpa em dash; Delivery Gate tanpa FAIL | PASS untuk copy; Delivery Gate pelaksana perlu diulang setelah RV1 (R-19, C-4) |

## Verifikasi ulang reviewer

Dijalankan di worktree T30 pada HEAD `a60fa0f`, env Supabase lokal hanya di proses, env var AI dikosongkan.

| Command | Exit | Hasil |
| --- | --- | --- |
| `pnpm lint --ignore-pattern ".claude/**"` | 0 | bersih |
| `pnpm typecheck` | 0 | bersih |
| `pnpm test` | 0 | 149 file / 1347 test (cocok dengan receipt) |
| `pnpm build` | 0 | compiled |
| `git diff --check dcd146d..HEAD` | 0 | bersih |
| probe `.tmp/t30-review-probe.spec.ts` | 0 | 2 passed; FCP 380 ms, animasi 428.5 ms di `/activity` (RV1) |
| release suite (config `.tmp/playwright.t30-reuse-build.config.ts`, testMatch sama dengan `playwright.release.config.ts`) | 0 | 42 passed (9.2 menit), termasuk 13 test `motion-loading.spec.ts` dan 8 test T30 di `release-a11y.spec.ts`; warning `The destination stream closed early` sama dengan baseline. Screenshot T25/T27/T30 yang ditulis ulang suite dipulihkan dari HEAD |

Tidak dijalankan ulang oleh reviewer: `test:e2e:ai-review`, `test:e2e:import`, `test:e2e:cv-export`, `test:e2e:m2`, `test:e2e:m5`, `build-storybook`. Receipt Fase 5 mencatat semuanya lulus; diff domain di area itu kecil (pemasangan `ProgressStatus`) dan tercakup run release untuk state pending dan progress. Wajib diulang pelaksana setelah RV1.

## Batas

Semua bukti lokal di Chromium. Belum diuji di Safari/Firefox, perangkat iOS, staging, atau production. Ambang lambat 30/45/60 detik tetap hipotesis.
