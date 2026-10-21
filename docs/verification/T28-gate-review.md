# T28 gate review (read-only)

- Tanggal: 21 Oktober 2026
- Reviewer: Claude (Opus 5.5), sesi terpisah dari pelaksana, worktree `claude/t28-gate-review-5493dd` (bersih, `pnpm install --frozen-lockfile` sendiri).
- Yang direview: `claude/t28-import-mode-choice`, commit `4fafc42`..`de511be` di atas plan `88095dd` (Fase 0-4), terhadap `T28-implementation-plan.md` §1, §9, §10.
- Dibaca: plan T28, decision 0033 #2 dan #10 (lewat kutipan plan), lima receipt Fase 0-4, diff penuh `src/` dan `tests/`.

## Verdict

**Belum PASS: tertunda lingkungan, bukan karena kode.**

Review kode tidak menemukan P0, P1, atau P2. Lint, typecheck, unit, dan `git diff --check` lulus saat diulang di worktree ini dengan angka yang sama dengan receipt. Namun rerun independen `test:e2e:import` gagal 13/16 karena storage Supabase lokal bersama rusak (setiap upload object `500`, Postgres `42P10`), sehingga butir pertama §9 ("ulang checks utama di worktree bersih") belum terpenuhi untuk E2E. Restart stack (`supabase stop` lalu `supabase start` dari `D:\Project\WorkPulse`, tanpa reset) disetujui pengguna lewat sesi induk, tetapi ditolak oleh pemeriksa izin sesi review ini, jadi tidak dijalankan.

Tidak perlu rencana remediasi kode. Syarat menjadi PASS:

1. Stack lokal dijalankan ulang dari checkout utama (yang mem-pin storage `v1.80.2`), tanpa `db:reset`.
2. `test:e2e:import` (harapan 16) dan `test:e2e:import-review` (harapan 10) lulus di worktree ini; bila memungkinkan juga `test:e2e:m3` (2) dan `test:e2e:release` (21, lalu `git checkout` PNG T25/T27).
3. Bila keempatnya lulus tanpa perubahan kode, verdict menjadi **PASS** dan Fase 5 boleh dimulai. Bila ada kegagalan yang bukan lingkungan, review ini dibuka lagi.

## Checks yang diulang

| Command | Exit | Hasil | Receipt |
| --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | lockfile cocok | - |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | 0 | bersih | exit 0 |
| `pnpm typecheck` | 0 | bersih | exit 0 |
| `pnpm test` | 0 | **134 file / 1270 test** | 134 / 1270 |
| `git diff --check 88095dd..de511be` | 0 | bersih | - |
| `git diff 88095dd..de511be -- supabase src/app/api workers src/server package.json pnpm-lock.yaml` | 0 | **0 baris** | 0 baris |
| `supabase/migrations` | - | 38 file | 38/38 |
| `test:e2e:import` (lewat `node node_modules/@playwright/test/cli.js`) | 1 | **3 passed, 13 failed** (lingkungan, lihat bawah) | 16 passed |
| `test:e2e:import-review`, `test:e2e:m3`, `test:e2e:release` | - | **tidak dijalankan**: semuanya meng-upload dan akan gagal dengan sebab yang sama | 10 / 2 / 21 |
| `pnpm build`, `test:integration:*`, `test:e2e:ai`, `ai-review`, `m2` | - | tidak dijalankan (T28 tidak menyentuh server; `build` sudah tercakup oleh webServer Playwright, yang lulus build) | lulus |

### Kegagalan E2E dan sebabnya

- Tiga test yang lulus adalah yang tidak meng-upload: "S02 closing the read-mode choice …", "T26 Escape and Cancel close the choice …", dan "T28 both dialog views at 360 and 1440 in light and dark: axe, no overflow, focus on each heading". Yang terakhir membuktikan ulang acceptance 12 (axe dan overflow kedua tampilan, fokus judul) secara independen.
- Ketiga belas yang gagal berhenti di langkah upload: S02 menampilkan "The service is temporarily unavailable" dan tidak ada `status`.
- Log `supabase_storage_WorkPulse`: setiap `POST /object/workpulse-private/...` berakhir `500`, `database error, code: 42P10`.
- Sebab: stack di-restart pukul 21:47 (bukan oleh sesi ini) dari checkout tanpa `supabase/.temp/storage-version`, sehingga container storage memakai image default CLI `v1.72.1`. Skema `storage.objects` di database bersama sudah dimigrasi oleh `v1.80.2` (index `objects_bucket_id_name_version_key`, pin di `D:\Project\WorkPulse\supabase\.temp\storage-version`), dan `v1.72.1` memakai `ON CONFLICT` yang tidak cocok dengan constraint itu. Tidak ada kaitan dengan perubahan T28 (T28 tidak menyentuh server atau storage).

### Probe tambahan (sementara, tidak di-commit)

Untuk menguji dugaan bahwa fokus jatuh ke tombol *Read without AI* saat dialog dibuka lagi setelah konfirmasi (state `modeStep` tertinggal `confirm`), satu test sementara ditambahkan ke `import-onboarding.spec.ts`, dijalankan, lalu dibuang dengan `git checkout`. Skenario: pengguna consent, Baca tanpa AI, konfirmasi (pencabutan berhasil, upload gagal karena storage), lalu Upload lagi. Hasil: consent `null`, dialog terbuka, `document.activeElement` = `H2` *How should we read your CV?*. Dugaan tidak terbukti; bukan temuan.

## Checklist §9

| Butir | Status | Bukti |
| --- | --- | --- |
| Receipt Fase 0-4 lengkap dengan angka aktual; checks utama diulang | **Sebagian** | Receipt lengkap dan angka unit cocok. E2E upload belum bisa diulang (lingkungan). |
| Pengguna consent tidak pernah upload tanpa dialog; Pakai AI tidak menyimpan consent ulang | Lulus (kode, unit) | `upload()` tanpa `mode` selalu membuka dialog (`import-start.tsx:183-188`); satu-satunya pemanggil dengan mode adalah `runChoice`. `chooseImportMode` hanya memanggil `saveConsent` untuk `ai` tanpa consent (`import-start.tsx:71`), diuji unit. E2E (a) belum diulang. |
| Pencabutan hanya dari tombol lanjut; Kembali/Esc/backdrop/Batal tidak mencabut dan tidak upload | Lulus (kode) | `chooseMode("rules")` dengan consent hanya mengganti `modeStep` (`import-start.tsx:238`); `withdrawConsent` hanya tercapai lewat `runChoice("rules")` dengan `granted`, yang dipanggil dari `onConfirmRules` (`import-start.tsx:446`). Kembali, Esc, backdrop, dan Batal memanggil `backToChoice`/`closeModeDialog`, yang tidak menyentuh consent atau upload. Esc dan Batal dari tampilan pilihan dibuktikan ulang oleh test T26 yang lulus di rerun ini. |
| Error pencabutan tidak diikuti upload; revisi profil dari hasil action terakhir | Lulus (kode, unit) | `chooseImportMode` mengembalikan error sebelum `upload` (`import-start.tsx:72-75`), unit untuk `withdrawConsent` gagal. `setConsent` membaca `state.data.revision` dan menyimpannya (`import-start.tsx:228-229`); service mengembalikan `revision` dari RPC (`consent-service.ts`). |
| Kesetaraan dialog 0033 #2: varian sama, tanpa rekomendasi, fokus di judul pada kedua tampilan | Lulus | Kedua tombol konfirmasi `variant="secondary"` (`import-mode-dialog.tsx:78-81`), unit memeriksa kelas dan tidak ada `button-primary`; judul konfirmasi `tabIndex={-1}` dan difokus oleh effect (`import-mode-dialog.tsx:55-61`); E2E matrix fokus lulus di rerun ini. |
| Copy en/id sesuai §2.2.8, jujur, tanpa em dash; Delivery Gate antislop tanpa FAIL | Lulus | Teks di `messages.ts` dibandingkan kata per kata dengan §2.2.8: identik. U+2014 pada baris `import.mode.*`/`import.disclosureChoice`: 0. Key `import.disclosure` dan `import.disclosureNoConsent` tidak dirujuk lagi di `src/` (grep: 0). Klaim "hasilnya dibuang" sesuai perilaku `CONSENT_WITHDRAWN` yang dikutip plan. Delivery Gate di receipt Fase 4 tanpa FAIL, dengan keterbatasan zoom 200% tercatat. |
| Perubahan assertion lama hanya yang terdaftar dan beralasan | Lulus | Baris yang dihapus di `tests/unit` hanya: disclosure lama, "no mode dialog for a user who already consented", bagian `consented` di test kuota, test kuota *Start manually* di `ai-usage-limits.test.tsx`, dan signature lama `chooseImportMode`. Semuanya ada di daftar Fase 0/2 dan diberi komentar "T28 (intended change)". Diff E2E `import-review`, `m3`, `release-a11y` hanya menambah langkah pilih *Use AI*, tanpa baris yang dihapus. |

## Review focus §10

1. **Revisi basi**: tertutup. `profileRevision` di state, diperbarui dari hasil action (`import-start.tsx:115`, `:228-229`). E2E acceptance 7 belum diulang.
2. **Pencabutan tanpa konfirmasi**: tertutup (lihat §9 butir 3). `onOpenChange(false)` hanya memanggil `onCancel`.
3. **Upload setelah pencabutan gagal**: tertutup (unit).
4. **Fokus mendorong pilihan**: tertutup. Fokus di judul konfirmasi; probe membuktikan dialog yang dibuka lagi setelah konfirmasi tetap fokus di judul.
5. **Kuota habis masih menutup import**: tertutup. Cabang `showChooser && limited && granted` dihapus, bukan dipindah; `aiNotice` diteruskan tanpa syarat `granted` (`import-start.tsx:447`). Unit `ai-usage-limits` lulus.
6. **`granted` tidak sinkron**: tertutup. `setGranted(choice === "allow")` dan `setView(withConsentWithdrawn)` setelah pencabutan berhasil (`import-start.tsx:230-231`); `withConsentWithdrawn` (`import-view.ts:128-131`) sama dengan cabang `consent` di `toImportView` (tidak menimpa `expired`/`exhausted`, tidak menyentuh batch `rules`).

## Dua penyimpangan yang dicatat pelaksana

- **Dialog dirender bersama chooser (`showChooser`), bukan tanpa syarat (§2.2.1).** Diterima. Satu-satunya pemicu dialog adalah tombol Upload di chooser, `runChoice` menutup dialog sebelum upload, dan `upload()` mereset `modeStep` ke `choose` setiap kali dialog dibuka, jadi unmount saat S02 pindah ke status batch tidak meninggalkan state yang salah. Niat §2.2.1 (dialog untuk semua pengguna, tidak bergantung `granted`) terpenuhi.
- **`profileRevision` ditambahkan di Fase 1, bukan Fase 2.** Diterima. Langkah `withdrawConsent` di Fase 1 tidak benar tanpa revisi terbaru; urutan fase bukan kontrak.

## Temuan

| ID | Level | Temuan | Status |
| --- | --- | --- | --- |
| G1 | P3 | **Batal dan Esc tetap aktif selama pencabutan berjalan.** Tombol Batal (`import-mode-dialog.tsx:122`) tidak ikut `busy`. Bila pengguna menekan Batal/Esc setelah *Turn off AI and read CV* tetapi sebelum action selesai, `closeModeDialog` mengosongkan `modeChoice` (`import-start.tsx:213-219`), pencabutan tetap selesai, dan upload dilewati (`import-start.tsx:257`). State tetap jujur (`granted` false, kartu S12 *Not allowed*) dan pengguna memang sudah mengonfirmasi, jadi bukan pelanggaran acceptance 5. Pola sama dengan T26 untuk *Use AI*. Usulan: nonaktifkan Batal saat `busy`, atau tampilkan pesan bahwa AI sudah dimatikan; test: unit markup `disabled` pada Batal saat `pending`. | Follow-up |
| G2 | P3 | **Batal dan backdrop dari tampilan konfirmasi tidak diuji E2E.** E2E (b) menguji Esc dan Kembali; Batal dan backdrop dari tampilan konfirmasi hanya dibuktikan lewat jalur kode yang sama (`onCancel`) dan inspeksi `dialog.tsx`. Usulan: tambahkan dua langkah ke E2E (b). | Follow-up |
| G3 | P3 | **Zoom 200% tidak diuji untuk dialog** (dicatat jujur di receipt Fase 4). | Follow-up |
| G4 | P3 (lingkungan) | **Restart stack dari worktree tanpa pin `supabase/.temp` merusak storage lokal bersama** (`v1.72.1` di atas skema `v1.80.2`, upload `42P10`). Bukan bug produk. Usulan: catat di runbook lokal bahwa `supabase start` hanya dijalankan dari checkout utama, atau pin versi service di `supabase/config.toml`. | Follow-up |

P0: 0. P1: 0. P2: 0. P3: 4.

## Batas review ini

- Lokal saja, bukan staging atau production.
- E2E upload (acceptance 1-5, 7-9 pada level browser) belum diulang secara independen; buktinya saat ini receipt Fase 3/4 plus review kode dan unit.
- Tidak ada kode produk yang diubah. `IMPLEMENTATION_STATUS.md` tidak disentuh dan T28 tidak ditandai DONE.
