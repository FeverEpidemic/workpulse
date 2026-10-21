# T28 Fase 4: regresi penuh dan Delivery Gate antislop

- Tanggal: 21 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, tanpa sub-agent.
- antislop: mode during (session override). Skill dibaca: `antislop` (core), `antislop-ui`, `antislop-copywriting`, `antislop-human`.
- Tujuan: regresi §7 lengkap pada HEAD `11fd9ab`, Delivery Gate antislop dengan bukti, lalu berhenti untuk gate review.

## Regresi §7 (HEAD `11fd9ab`)

| Command | Hasil |
| --- | --- |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm test` | exit 0, **134 file / 1270 test** |
| `pnpm build` | exit 0 |
| `pnpm test:integration:import` | exit 0, **2 file / 25 test** |
| `pnpm test:integration:ai` | exit 0, **1 file / 13 test** |
| `pnpm test:integration:ai-usage` | exit 0, **1 file / 9 test** |
| `pnpm test:integration:m3` | exit 0, **1 file / 7 test** |
| `test:e2e:import` | exit 0, **16 passed** (1,8 menit) |
| `test:e2e:import-review` | exit 0, **10 passed** (1,3 menit) |
| `test:e2e:ai` | exit 0, **2 passed** (34,8 detik) |
| `test:e2e:ai-review` | exit 0, **11 passed** (1,5 menit) |
| `test:e2e:m2` | exit 0, **1 passed** (1,0 menit) |
| `test:e2e:m3` | exit 0, **2 passed** (1,1 menit) |
| `test:e2e:release` | exit 0, **21 passed** (4,7 menit) |

Semua dijalankan berurutan dalam satu proses dengan env dari `.env.local` dan JWT `SERVICE_ROLE_KEY`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan (syarat `m2`). Suite E2E lewat `node node_modules/@playwright/test/cli.js test` dengan argumen script `package.json` (catatan Fase 0). Container ClamAV, Gotenberg, dan renderer PDF hidup. PNG tracked T25/T27 dikembalikan dengan `git checkout` setelah run.

Dibanding baseline Fase 0: unit 1261 → 1270 (+9 test baru, test lama yang diganti dihitung satu-satu), `import` 11 → 16 (+5 T28), suite lain sama.

### Server dan migration

- `git diff 88095dd HEAD -- supabase src/app/api workers src/server package.json pnpm-lock.yaml`: **0 baris**. Tidak ada perubahan migration, RPC, route, worker, atau dependency (§2.2.9).
- `supabase/migrations`: 38 file, sama dengan baseline (parity 38/38 Fase 0).
- Total perubahan T28 terhadap plan (`88095dd`): 17 file, +883/−144.

### Assertion lama yang berubah

Hanya yang tercatat di receipt Fase 2 (unit) dan Fase 3 (E2E): perilaku "consent berarti upload langsung", "kuota habis berarti hanya Start manually", dan teks/key disclosure yang diganti. Tidak ada assertion lain yang dilemahkan (acceptance 13).

## Delivery Gate antislop

Design Read: layar aplikasi privat (dialog pilihan mode baca CV dan konfirmasi mematikan AI) untuk pencari kerja, bahasa visual sage tenang dari `Design.md`, dial **ENERGY 1 / RHYTHM 1 / MOTION 1** (sama dengan dialog T26 di `T26-phase4-ui.md`).

Lingkup gate: perubahan T28 saja (dialog `ImportModeDialog` kedua tampilan, S02 chooser, copy §2.2.8). Elemen T26 yang tidak berubah tetap memakai bukti T26.

### Block 1: Hard Gate (semua harus "no")

- R-02 em dash: **PASS (no)**. Test unit "has every new key in en and id, without em dashes" memeriksa key T26 dan T28 en/id; pencarian karakter U+2014 pada baris `import.mode.*` dan `import.disclosureChoice` di `messages.ts`: 0.
- R-03 mobile: **PASS (no)**. E2E "both dialog views at 360 and 1440 ..." memeriksa `scrollWidth <= clientWidth` untuk panel dialog dan halaman pada kedua tampilan di 360 px, light dan dark; tombol konfirmasi min 44 px (`.import-mode-confirm-actions > button`).
- R-17 angka tanpa sumber: **PASS (no)**. Satu-satunya angka adalah batas kuota dan jam reset dari `AiLimitNotice` (data server).
- R-18 testimoni: **PASS (no)**. Tidak ada.
- R-23 aset tanpa konfirmasi: **PASS (no)**. Tidak ada aset baru.
- R-24 navigasi mati: **PASS (no)**. Tidak ada item navigasi baru.
- R-25 kontras: **PASS (no)**. Axe (termasuk `color-contrast`) tanpa pelanggaran pada kedua tampilan, 360/1440, light/dark (8 kombinasi) dan pada dialog pengguna consent serta dialog kuota habis. Teks baru memakai kelas yang sudah ada (`field-help`, `field-error`, teks default).
- R-26 kontrol mati: **PASS (no)**. Setiap tombol punya perilaku nyata (klik-through di bawah).
- R-27 state: **PASS (no)**. Loading: tombol lanjut `loading` + `aria-busy` dan kedua tombol nonaktif (unit). Error: pesan pencabutan di konfirmasi `role="alert"` (unit). Tampilan kosong tidak relevan (dialog pilihan).
- R-28 FAQ: **PASS (no)**. Tidak ada.
- R-32 keyboard: **PASS (no)**. E2E (b): fokus judul konfirmasi, Enter tidak memilih, Tab ke Matikan lalu Kembali, Enter pada Kembali, Escape menutup; ring fokus memakai gaya global `Design.md` §24.1.
- R-33 patch script: **PASS (no)**. Semua perubahan di source.
- R-34 tema: **PASS (no)**. Axe dan overflow lulus di light dan dark untuk kedua tampilan.
- R-35 dijalankan dan diklik: **PASS (no)**. Build dan 7 suite E2E dijalankan; klik-through per elemen di bawah; tidak ada error konsol yang menggagalkan suite (log `[WebServer] The destination stream closed early.` sama dengan baseline).
- R-36 klaim palsu: **PASS (no)**. Copy hanya menyatakan perilaku nyata: pencabutan menghentikan AI analisis aktivitas (consent global, decision 0019), analisis yang sedang berjalan hasilnya dibuang (`CONSENT_WITHDRAWN`, `20260928090000_t13_ai_jobs_consent.sql:635-637`), data tidak berubah (pencabutan hanya mengubah kolom consent profil), bisa dinyalakan lagi di Pengaturan (kartu S12).
- R-37 arah desain: **PASS (no)**. `Design.md` dipakai (lihat Fase 3).
- R-38 konten rekaan: **PASS (no)**. Tidak ada.

### Block 2: Purpose-Gate (semua harus "no")

- R-01 gradient/glow: **PASS**. Tidak ada.
- R-04 ikon: **PASS**. Tidak ada ikon baru.
- R-06 tipografi: **PASS**. Judul konfirmasi memakai `.import-mode-option-title` yang sama dengan judul kartu; alasan: konfirmasi menggantikan kartu di tingkat hierarki yang sama.
- R-07 latar pola: **PASS**. Tidak ada.
- R-08 panah: **PASS**. Tidak ada.
- R-09 badge: **PASS**. Tidak ada (test unit T26 memeriksa tidak ada badge/rekomendasi).
- R-10 glass: **PASS**. Tidak ada.
- R-12 shadow: **PASS**. Tidak ada shadow baru; dialog memakai `.ui-dialog` yang ada.
- R-13 glow: **PASS**. Tidak ada.
- R-14 kartu seragam: **PASS**. Dua kartu sengaja setara (decision 0033 #2: pilihan netral tanpa rekomendasi); alasan tertulis di 0033 dan di komentar komponen.
- R-19 animasi: **PASS**. Tidak ada animasi baru; MOTION 1.
- R-22 ilustrasi: **PASS**. Tidak ada.

### Block 3: Liveliness (semua harus "yes")

- Dial dideklarasikan: **YES** (ENERGY 1 / RHYTHM 1 / MOTION 1).
- Konsisten dengan dial: **YES**. Konfirmasi tidak menambah dekorasi atau gerak; hanya mengganti isi dialog.
- Satu titik fokus per tampilan: **YES**. Tampilan pilihan: judul dialog lalu dua kartu setara (keputusan itu sendiri). Tampilan konfirmasi: judul konfirmasi.
- Whitespace struktural: **YES**. `--space-5` memisahkan header dialog dari isi, `--space-2` mengikat judul, isi, dan tombol konfirmasi (sama dengan kartu).
- Satu aksen: **YES**. Aksen sage tetap pada fokus ring dan elemen aplikasi yang ada; dialog tidak memakai `button-primary` (sengaja, pilihan netral).
- Motif identitas: **YES**. Pola konfirmasi-di-tempat yang sama dengan pencabutan consent S12 dan kartu bertepi `--color-border-strong` dari T26.
- Design Read sebelum generasi: **YES** (di atas; diputuskan sebelum Fase 2 mengikuti T26).

### Block 4: Craftsmanship & Quality Locks (semua harus "no")

- C-1: **PASS**. Setiap keputusan beralasan: fokus di judul (0033 #2, mencegah Enter tak sengaja mencabut consent), dua tombol setara (pilihan netral), konfirmasi di dialog yang sama (pola S12, tidak ada modal bertumpuk), tombol bukan destructive (pencabutan bisa dibatalkan).
- C-2: **PASS**. Tidak ada kontrol mati.
- C-3: **PASS**. Tampilan konfirmasi ada karena Baca tanpa AI dengan consent mengubah pengaturan akun.
- C-4: **PASS**. State loading/error teruji unit; tema, lebar, dan keyboard teruji E2E.
- C-5: **PASS**. Tidak ada klaim tanpa dasar (lihat R-36).
- R-05: **PASS**. Tidak ada template layout.
- R-11: **PASS**. Radius dari token yang ada (`--radius-md` kartu, tombol standar).
- R-15: **PASS**. CTA spesifik: "Turn off AI and read CV" / "Matikan AI dan baca CV" menyebut kedua efek; "Back" / "Kembali" untuk kembali ke pilihan.
- R-16: **PASS**. Tidak ada buzzword.
- R-20: **PASS**. Mengikuti identitas `Design.md` (sage, tenang).
- R-21: **PASS**. Light dan dark mengikuti toggle yang sudah ada; keduanya diuji.
- R-29: **PASS**. Tidak ada warna baru.
- R-30: **PASS**. Tidak meniru produk lain.
- R-31: **PASS**. Alasan satu baris tertulis di Block 2 dan C-1.

### Copywriting Skill Checklist (copy §2.2.8)

- Tidak ada fakta rekaan: **YES**. Setiap kalimat merujuk perilaku yang ada (lihat R-36).
- Bebas buzzword: **YES**.
- Tanpa em dash: **YES** (unit).
- Tanpa tanda kutip berlebih: **YES**.
- Tanpa kapital penekanan: **YES**.
- Aktor jelas: **YES**. "WorkPulse reads it itself", "You can turn AI back on". Satu pasif: "its result is discarded" / "hasilnya dibuang": pelaku (sistem) tidak relevan bagi pengguna dan objeknya (hasil) adalah subjek kalimat; diterima.
- CTA spesifik: **YES** (R-15).
- Tanpa pola ritme AI: **YES**. Body konfirmasi berupa empat kalimat dengan panjang berbeda, masing-masing satu fakta; bukan daftar tiga.
- Ada suara: **YES**. Mengikuti nada copy T26 dan S12 (langsung, tenang, "Anda").
- Terbaca wajar: **YES**. Teks en/id disetujui pengguna di chat konsep (plan §2.2.8) dan dipakai apa adanya.

### Human Skill Checklist

- Kontras teks diverifikasi: **YES** (axe `color-contrast`, 8 kombinasi + dua dialog lain).
- Kontras non-teks: **YES**. Tepi tombol dan kartu memakai token yang sama dengan T26 yang lulus axe.
- Fokus terlihat di setiap tema: **YES**. Ring global; E2E memeriksa fokus di kedua tema.
- Keyboard dan Escape: **YES** (E2E (b)).
- State tidak hanya warna: **YES**. Error berupa teks `role="alert"`; nonaktif memakai atribut `disabled`; pemberitahuan kuota berupa teks.
- Zoom 200% dan keyboard layar: **Tidak diuji khusus untuk dialog**. Dialog tidak punya input teks; layout memakai grid/flex wrap yang sama dengan T26. `release-a11y` "text at 200%" lulus untuk layar lain dan tidak mencakup dialog ini. Dicatat sebagai keterbatasan, bukan FAIL.

### Klik-through per elemen (R-35)

Dijalankan di Chromium Playwright pada `next dev`/build lokal, bukti dari test yang lulus di regresi di atas.

| Elemen | Aksi | Hasil teramati | Bukti |
| --- | --- | --- | --- |
| S02 *Upload and extract* (pengguna consent) | klik | dialog *How should we read your CV?* terbuka, fokus di judul, belum ada batch | E2E (a), (b), matrix |
| S02 *Upload and extract* (pengguna tanpa consent) | klik | dialog yang sama (T26), tanpa kalimat `rulesAiOff` | E2E (c) langkah pertama, unit S02 |
| Kartu Dengan AI, *Use AI* (consent) | klik | dialog tertutup, status *Waiting to start*, batch `ai`, revisi profil tetap | E2E (a) |
| *Use AI* (tanpa consent) | klik | consent tersimpan, batch `ai` | E2E (c), T26 "allow, upload ..." |
| *Use AI* saat kuota habis | lihat | nonaktif, pemberitahuan batas di kartu | E2E (e) |
| Kartu Tanpa AI, *Read without AI* (consent) | klik | isi dialog berganti ke konfirmasi, fokus judul konfirmasi, tidak ada batch, consent tetap | E2E (b) |
| *Read without AI* (tanpa consent) | klik | langsung batch `rules`, tanpa konfirmasi | T26 keyboard dan layout test |
| Judul konfirmasi | Enter | tidak terjadi apa-apa | E2E (b) |
| *Turn off AI and read CV* | Tab lalu klik | consent `null`, batch `rules`, tidak ada `ai_jobs`, unit import tetap, review siap | E2E (b), (c), (e) |
| *Back* | Tab + Enter | kembali ke dua kartu, fokus di *Read without AI*, consent tetap | E2E (b) |
| Escape di konfirmasi | tekan | dialog tertutup, file tetap terpilih, consent tetap, tidak ada batch; Upload berikutnya mulai dari kartu | E2E (b) |
| Escape di tampilan pilihan | tekan | dialog tertutup | matrix, T26 Escape test |
| *Cancel* (ghost) | klik | dialog tertutup, fokus ke area file | T26 "Escape and Cancel ..." |
| Backdrop | klik | menutup lewat `dialog.close()` yang sama dengan Escape (`Dialog` primitive `onClick` target = dialog) | inspeksi kode `src/components/ui/dialog.tsx:53-55`; tidak diklik di E2E T28 |
| S12 setelah pencabutan | buka | *Not allowed* | E2E (d) |
| *Analyze with AI* setelah pencabutan | klik | dialog *Allow AI processing?* terbuka, tidak ada `ai_jobs` | E2E (d) |
| Retry batch `ai` setelah pencabutan | state | alasan consent, Retry nonaktif | unit `withConsentWithdrawn` |

Hasil gate: tidak ada FAIL. Satu keterbatasan tercatat (zoom 200% tidak diuji khusus untuk dialog; backdrop dibuktikan lewat inspeksi kode).

## Acceptance §1, ringkasan bukti

| # | Status | Bukti |
| --- | --- | --- |
| 1 | terbukti | unit S02, E2E (a) |
| 2 | terbukti | unit `chooseImportMode`, E2E (a) revisi |
| 3 | terbukti | unit, E2E (b) |
| 4 | terbukti | unit urutan, E2E (b) database |
| 5 | terbukti | E2E (b): Back, Escape; Cancel/backdrop lewat jalur `onCancel` yang sama (T26 test Cancel, inspeksi backdrop) |
| 6 | terbukti | unit `chooseImportMode` withdraw gagal |
| 7 | terbukti | E2E (c) |
| 8 | terbukti | E2E (d) |
| 9 | terbukti | unit S02 dan `ai-usage-limits`, E2E (e) |
| 10 | terbukti | unit `withConsentWithdrawn`; client memanggilnya setelah pencabutan |
| 11 | terbukti | unit copy, E2E teks |
| 12 | terbukti | E2E (b) dan matrix axe |
| 13 | terbukti | regresi §7 di atas |

## Warning, blocker

- Tidak ada blocker. Stop condition §8 tidak terpicu.
- Lint penuh `pnpm lint` tetap gagal karena build output worktree lain di `.claude/worktrees/` (Fase 0); repo sendiri bersih.

## Langkah berikutnya

**Stop: gate review Claude (read-only, §9).** Fase 5 (decision 0036 dan ringkasan verifikasi) baru dikerjakan setelah gate lulus.
