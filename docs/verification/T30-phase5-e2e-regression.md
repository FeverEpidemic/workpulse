# T30 Fase 5: E2E dan regresi, BLOCKED

- Tanggal: 22 Oktober 2026.
- Status: **BLOCKED**, dihentikan sebelum regresi lengkap dan Delivery Gate visual. T30 belum DONE. Tidak push, tidak PR, tidak Fase 6, tidak mengubah IMPLEMENTATION_STATUS.md.
- Fase 0 sampai 4 selesai. Fase 5 disimpan sebagai WIP untuk review blocker.

## Alasan berhenti

Kontrak §2.2.7 mengatakan bila useLinkStatus tidak memberi pending pada build dev/prod, stop dan jangan mengganti dengan state buatan. Pada produksi Next 16.3.5, hook memang sempat true, tetapi kembali false ketika fallback loading sudah di-commit, sebelum konten tujuan selesai. Jadi masalahnya bukan hook selalu false: durasi pending tidak memenuhi acceptance 8 yang meminta indikator sampai navigasi selesai.

Test browser menahan respons RSC non-prefetch HTTP 200 untuk /activity. Pada saat respons masih ditahan, observasi nyata adalah:

```text
pathname: /activity
skeletons: 9
pageHeading: Loading activity…
hook sidebar dan tab: false, false
mutasi: SPAN true, A true, SPAN false, A false
```

[Bukti JSON dari output command aktual](T30-navigation-pending-blocker.json). Atribut anchor mengikuti hook dengan benar, sehingga ini bukan hanya kegagalan efek pencerminan DOM. Ini konsisten dengan status optimistic Next berakhir saat fallback navigasi terpasang. Kode lokal Next app-dir/link.js memakai useOptimistic dengan nilai dasar IDLE_LINK_STATUS. Tidak ada perubahan pada Next atau state pending pengganti.

Di Fase 0, fixture dev dengan prefetch=false dan route baru menunjukkan pending=true selama respons awal ditunda. Pembuktian itu tidak cukup untuk perilaku produksi workspace dengan loading boundary yang sudah tersedia. Ini selisih bukti penting, bukan alasan mengubah assertion supaya hijau.

## Command dan hasil aktual

| Command | Exit | Hasil |
| --- | --- | --- |
| test page entry baru, sebelum guard pathname | 1 | 1 failed; filter GET menaikkan jumlah animasi dari 1 ke 2 |
| test page entry setelah guard, port 3017 | 1 | 1 failed; port ternyata digunakan server checkout lain, hasil tidak dipakai sebagai bukti implementasi |
| `pnpm exec playwright test --config .tmp/playwright.t30-release.config.ts --grep "T30 page entry"` | 0 | 1 passed, 33.2 s termasuk build, pada port 3030 |
| `pnpm test:e2e:release --config .tmp/playwright.t30-release.config.ts --grep "T30 navigation\|every dialog opens"` | 1 | 2 failed (pending 360/1440), 1 passed (dialog keyboard), 1.1 menit termasuk build |
| `pnpm test:e2e:release --config .tmp/playwright.t30-release.config.ts --grep "T30 navigation pending and slow loading at 1440"` | 1 | 1 failed; diagnosis true lalu false ketika 9 skeleton masih ada dan respons ditahan |
| `pnpm lint --ignore-pattern ".claude/**"` pada WIP akhir | 0 | 0 error, 0 warning lint |
| `pnpm typecheck` pada WIP akhir | 0 | 0 error |
| `pnpm test` pada WIP akhir | 0 | 147 file / 1336 test passed, 0 failed |
| `pnpm build` pada WIP akhir, env proses lokal | 0 | compiled, TypeScript, page generation dan optimization berhasil |
| `git diff --check` | 0 | tanpa whitespace error |
| audit baris baru U+2014 / CSS gradient | 0 | 0 / 0 match |
| diff dependency, migration, config Next, server/action, status authoritative dan sumber desain | 0 | tidak ada perubahan pada path tersebut |

Tidak ada assertion lama diubah di Fase 5. Assertion pending yang gagal dipertahankan. Test baru page entry memakai jumlah event animationstart yang disimpan lintas dokumen, sehingga filter GET benar-benar diperiksa, bukan hanya remount React.

## Perubahan Fase 5 sebelum stop

- `tests/e2e/motion-loading.spec.ts` dan helper motion-loading: route RSC ditahan, assertion pending, rencana checks skeleton/reload dan screenshot. Checks setelah assertion pending belum tercapai.
- `playwright.release.config.ts`: memasukkan spec T30, tanpa script npm baru.
- `src/app/(workspace)/template.tsx`: guard pathname pada template client. Filter Activity yang nyata memakai GET document navigation; template CSS polos memutar animasi lagi. Guard memakai sessionStorage, dengan fallback referrer bila storage tidak tersedia, tanpa mengubah form atau alur filter. Unit shouldEnterWorkspace dan E2E page entry lulus. CSS tetap animasi masuk saja.
- `tests/unit/motion-copy.test.tsx`: menambah kontrak guard pathname.
- Plan, receipt ini dan JSON diagnosis. Tidak ada screenshot T30 yang dibuat karena assertion pending gagal sebelum langkah capture.

## Matriks acceptance 1 sampai 14

Terbukti berarti seluruh bukti acceptance yang diminta tersedia. Bukti unit tanpa E2E yang diwajibkan tetap dicatat belum.

| # | Status | Bukti / kekurangan |
| --- | --- | --- |
| 1 | terbukti | motion-tokens, 8 test; receipt Fase 1; tetap lulus pada WIP akhir |
| 2 | belum | CSS scale(0.97) ada; native mouse.down semua variant belum dijalankan |
| 3 | belum | button-pending dan story lulus; ukuran aktual, opacity dan delay browser belum dibuktikan |
| 4 | belum | E2E double-save belum ditambahkan/dijalankan |
| 5 | terbukti | button-pending dan grep hanya SubmitButton sebagai sumber pending tombol; dua pembaca lain adalah feedback/guard konflik |
| 6 | belum | loading-pages en/id dan CSS pulse ada; computed animation-name E2E belum tercapai |
| 7 | belum | slow-loading-notice fake timers lulus; klik Reload nyata belum tercapai |
| 8 | gagal | pending false saat respons masih ditahan dan sembilan skeleton ada; gagal 360 dan 1440 px |
| 9 | belum | progress-status-view dan markup/story lulus; E2E job fake, visibility dan unmount browser belum dijalankan |
| 10 | belum | satu test dialog keyboard nyata lulus; seluruh motion dialog/sheet/backdrop/toast belum diukur |
| 11 | belum | parser marker dan toast lifecycle lulus; Quick log satu toast serta highlight kedua daftar belum E2E |
| 12 | terbukti | E2E page entry: chrome di luar wrapper, filter GET tidak menambah animasi, route Projects menambah satu |
| 13 | belum | CSS statis dan story konfigurasi tersedia; emulateMedia reduce di E2E belum dijalankan |
| 14 | belum | copy en/id dan kontras token lulus; matrix Axe pending/progress/skeleton 4 kombinasi belum dijalankan |

## Regresi §7 dan lingkungan

| Suite | Hasil terakhir sesi | Keterbatasan |
| --- | --- | --- |
| test:e2e:ui | Fase 0, 1 passed | belum diulang pada WIP akhir |
| test:e2e:release | Fase 0, 21 passed | Fase 5 hanya subset di atas, bukan full release hijau |
| test:e2e:activity | belum | stop condition |
| test:e2e:dashboard | belum | stop condition |
| test:e2e:ai-review | belum | stop condition; tidak memakai provider live |
| test:e2e:import | belum | stop condition |
| test:e2e:cv-export | belum | stop condition; renderer tersedia, bukan alasan skip |
| test:e2e:m2 | belum | stop condition |
| test:e2e:m5 | belum | stop condition |
| build-storybook | belum | stop condition; story tests browser melalui pnpm test lulus |

- Worktree tidak memiliki .env.local. API URL, publishable key, DATABASE_URL dan legacy SERVICE_ROLE_KEY hanya di env proses, tidak dicetak/disimpan ke file. .env.ai.local tidak dibaca.
- Container workpulse-t21-pdf, workpulse-t15-gotenberg dan workpulse-t10-clamav yang sudah ada dinyalakan pada Fase 0. Supabase tidak di-reset/start/stop.
- Port 3017 dipakai server Next dari checkout lain saat pengulangan page entry. Proses itu tidak dihentikan. Salinan config git-ignored di .tmp memakai 3030, testDir ../tests/e2e dan cwd worktree ini; webServer tetap build lalu start, serta env/site URL dan baseURL disamakan ke 3030.
- Server uji T30 3030 sudah berhenti setelah Playwright. Tidak ada worker sesi lain yang dihentikan. Screenshot T25/T27 dari baseline sudah dipulihkan.
- Warning NO_COLOR/FORCE_COLOR dan Next destination stream closed early muncul pada navigasi/response yang dibatalkan. Vite/Google Fonts transient baseline tercatat di receipt Fase 0 dan 2. Tidak dijadikan alasan melemahkan assertion.

## Pilihan untuk reviewer dan pemilik produk

Belum satu pun opsi berikut diterapkan:

1. Menerima pending link hanya sampai fallback terpasang, lalu skeleton/teks memuat menjadi indikator utama. Ini mengubah acceptance 8 dan perlu keputusan produk tertulis.
2. Mengevaluasi prefetch=false untuk link workspace supaya status hook mengikuti request navigasi awal lebih lama. Dampak ke kecepatan dan cache perlu dibuktikan; belum diasumsikan akan menyelesaikan semua kasus.
3. Mengizinkan mekanisme pending lain, misalnya transisi yang dikendalikan aplikasi. Ini bertentangan dengan larangan fallback otomatis di plan saat ini dan memerlukan revisi kontrak sebelum implementasi.

Setelah keputusan: perbaiki atau sesuaikan kontrak secara eksplisit, lanjutkan acceptance 2-14 yang belum lengkap, jalankan seluruh §7, screenshots dan Delivery Gate. Tidak ada pengajuan merge untuk WIP ini.

## Delivery Gate antislop: FAIL, bukan pengiriman UI

Ini laporan penghentian. PASS di bawah hanya untuk bukti yang tersedia; FAIL juga digunakan ketika bukti browser wajib belum ada, bukan klaim bahwa setiap butir itu sudah terbukti cacat. Tidak ada klaim gate visual lulus. Bukti klik-tembus yang tersedia: [page entry dan navigasi](../../tests/e2e/motion-loading.spec.ts), [Escape/fokus dialog](../../tests/e2e/release-keyboard.spec.ts) pada command subset yang lulus, serta [diagnosis pending](T30-navigation-pending-blocker.json).

### Hard Gate

| Butir | Status | Bukti |
| --- | --- | --- |
| R-02 em dash | PASS | audit baris baru 0 match; motion-copy unit |
| R-03 overflow/layout mobile | FAIL | matrix visual baru belum dijalankan |
| R-17 statistik tanpa sumber | PASS | tidak menambah statistik produk; waktu tunggu dari clock, test progress-status-view |
| R-18 testimoni fiktif | PASS | diff UI tidak menambah testimoni |
| R-23 aset/navigasi tanpa arahan | PASS | tidak menambah aset atau tujuan navigasi; scope sesuai plan |
| R-24 link ke tujuan tidak ada | PASS | route tidak ditambah; klik Activity dan Projects nyata pada E2E |
| R-25 kontras | FAIL | theme-contrast 6/6 lulus, tetapi matrix Axe state baru belum dijalankan |
| R-26 kontrol tanpa perilaku | FAIL | handler ada, tetapi klik Reload dan semua pending state belum dibuktikan |
| R-27 empty/loading/error | PASS | import-start-ui, AI panel, CV export unit tetap lulus; loading fallback ditambah dan diuji |
| R-28 FAQ generik | PASS | tidak ada FAQ baru pada diff |
| R-32 keyboard/fokus | FAIL | dialog keyboard satu test lulus; seluruh state T30 belum diperiksa |
| R-33 patch source lewat skrip pengganti | PASS | production source ditulis melalui patch langsung; tidak memakai skrip string replacement |
| R-34 tema | FAIL | visual pending/progress/skeleton dua tema belum diverifikasi |
| R-35 build dan seluruh klik-tembus | FAIL | build exit 0; klik-tembus T30 belum lengkap |
| R-36 klaim palsu | PASS | tidak ada klaim security/performance/pengguna baru; angka receipt dari output aktual |
| R-37 arah desain | PASS | Design.md dan design T30 disetujui; Design Read Fase 0 |
| R-38 konten realistis fiktif | PASS | tidak menambah data produk fiktif; fixtures tetap test-only |

### Purpose Gate

| Butir | Status | Bukti |
| --- | --- | --- |
| R-01 gradient/glow | PASS | audit CSS baru 0 gradient, tidak menambah glow |
| R-04 ikon | PASS | LoaderCircle/Clock3 berarti proses/menunggu; helper loading-indicator dan receipt Fase 2 |
| R-06 tipografi | PASS | font existing Plus Jakarta Sans tidak diubah, build memakai font asli |
| R-07 pola latar | PASS | tidak ada pola latar baru |
| R-08 panah dekoratif | PASS | tidak ada panah CTA baru |
| R-09 badge | PASS | tidak ada badge dekoratif baru |
| R-10 glass | PASS | tidak menambah blur; backdrop existing tetap |
| R-12 shadow | PASS | elevasi dialog/toast existing, tanpa shadow baru |
| R-13 glow menyeluruh | PASS | tidak ada glow baru |
| R-14 kartu seragam | PASS | tidak mengubah komposisi kartu; fallback tetap mengikuti layout existing |
| R-19 alasan motion | PASS | alasan per efek tertulis di receipt Fase 1-4, loop hanya indikator loading |
| R-22 ilustrasi | PASS | tidak ada ilustrasi baru |

### Liveliness

| Butir | Status | Bukti |
| --- | --- | --- |
| Dials eksplisit | PASS | ENERGY 1 / RHYTHM 1 / MOTION 2, receipt Fase 0 |
| Hasil sesuai dials | FAIL | visual menyeluruh belum diinspeksi; pending contract gagal |
| Focal point setiap layar | FAIL | belum visual review 4 kombinasi |
| Whitespace struktural | FAIL | token spacing dipakai, tetapi visual baru belum diverifikasi |
| Satu aksen sengaja | PASS | highlight memakai sage existing, pasangan kontras diuji |
| Motif identitas | PASS | save confirmation sage mengikuti Design.md 28.1, receipt Fase 4 |
| Design Read sebelum implementasi | PASS | dinyatakan sebelum edit dan dicatat Fase 0 |

### Craftsmanship dan Quality Locks

| Butir | Status | Bukti |
| --- | --- | --- |
| C-1 keputusan sengaja | PASS | alasan setiap efek dan timing di receipt Fase 1-4 |
| C-2 semua kontrol bekerja | FAIL | klik-tembus baru belum lengkap |
| C-3 komposisi mengikuti konten | PASS | tidak menambah section template; status baru mendampingi proses yang sudah ada |
| C-4 resilience | FAIL | acceptance 8 gagal dan matrix state/theme belum selesai |
| C-5 evidence over claims | PASS | angka command dan diagnosis dicatat apa adanya |
| R-05 layout template | PASS | layout produk tetap, wrapper hanya untuk motion |
| R-11 radius | PASS | token radius existing dipakai, tanpa perubahan radius |
| R-15 CTA | PASS | Reload/Muat ulang menyebut tindakan konkret, messages.ts |
| R-16 buzzword | PASS | lima key baru tidak memakai buzzword, audit copy Fase 4 |
| R-20 identitas visual | FAIL | belum review visual hasil baru |
| R-21 tema dipaksakan/toggle ditunda | PASS | pilihan tema existing dipertahankan |
| R-29 palet | PASS | tanpa warna baru, highlight memakai primary-100/800 |
| R-30 menyalin produk | PASS | tidak mengubah komposisi mengikuti produk lain |
| R-31 alasan keputusan | PASS | receipt tiap fase menyebut tujuan motion dan indikator |

### Checklist UI, human dan mobile

| Butir skill | Status | Bukti |
| --- | --- | --- |
| UI: palet, aksen, tanpa emoji, rhythm, tanpa bentuk template, tanpa badge H1 | PASS | Design.md dipertahankan; diff hanya motion/status |
| UI: semua kontrol, motion nyata dan semua breakpoint/state | FAIL | pending gagal, browser matrix belum lengkap |
| UI: dose cap, dot status, komposisi app, data dan placeholder jujur | PASS | tidak menambah dekorasi/data produk, clock dan marker berasal dari event nyata |
| UI: empty/loading/error memberi konteks | PASS | unit domain existing dan fallback loading en/id lulus |
| Human: seluruh pasangan kontras dan batas indikator | FAIL | token unit lulus, state visual browser belum lengkap |
| Human: fokus dan keyboard seluruh state | FAIL | hanya dialog subset terbukti |
| Human: empty/loading/error dapat dipersepsi | PASS | teks status terlihat dan unit markup lulus |
| Human: teks 200% dan keyboard mobile | FAIL | belum diulang untuk T30 |
| Mobile: reflow, rentang lebar, skala, grid, overflow | FAIL | belum matrix visual baru |
| Mobile: target sentuh, jarak, pointer/touch | FAIL | native press dan ukuran state baru belum diuji |
| Mobile: navigasi/safe area | FAIL | struktur existing tetap, tetapi visual T30 belum lengkap |
| Mobile: verifikasi breakpoint | FAIL | pending baru diuji dan gagal; bukan bukti layout lulus |

Gate keseluruhan FAIL. Tidak ada hasil UI yang dinyatakan siap kirim. Siap untuk gate review Claude atas blocker ini, bukan klaim Fase 5 selesai.
