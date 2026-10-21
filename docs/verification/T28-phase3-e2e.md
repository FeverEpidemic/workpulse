# T28 Fase 3: E2E dan aksesibilitas

- Tanggal: 21 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, tanpa sub-agent.
- antislop: mode during (session override). `antislop` core, `antislop-copywriting`, `antislop-human` dibaca sebelum fase ini; `antislop-ui` tidak dibaca ulang karena fase ini tidak menambah elemen visual baru selain yang dibuat di Fase 2 (dicek di Delivery Gate Fase 4).
- Tujuan: bukti browser untuk acceptance 1-5, 7-9, 12, dan langkah upload pengguna consent di spec lain disesuaikan tanpa melemahkan assertion.

## Cek terhadap `Design.md`

- §25: tidak ada dua tombol primary dalam satu keputusan; kedua tombol konfirmasi `button-secondary`, sama seperti dua kartu T26.
- §26.3 dan §27: aksi yang berdampak (mematikan AI untuk akun) memakai konfirmasi eksplisit. Pencabutan bisa dibatalkan di Pengaturan, jadi tombolnya tidak memakai varian destructive; sama dengan konfirmasi pencabutan S12 (`ai.consent.withdrawConfirm` juga `secondary`).
- §24.1: fokus berpindah ke judul konfirmasi dan kembali ke Baca tanpa AI; ring fokus memakai gaya global yang sudah ada.
- Spasi: `.import-mode-confirm` memakai `--space-5` di atas seperti `.import-mode-options`, gap `--space-2` seperti isi kartu; tombol min 44 px seperti tombol kartu.

## Skenario baru di `tests/e2e/import-onboarding.spec.ts`

| Test | Plan | Yang dibuktikan |
| --- | --- | --- |
| "T28 a user with consent sees the choice; Use AI uploads with AI and leaves consent untouched" | (a) | Pengguna consent: Upload membuka dialog (fokus di judul), kartu Tanpa AI memuat `rulesAiOff`, belum ada batch; Use AI → batch `ai`; `profiles.revision` tidak berubah; consent tetap. Axe pada dialog pengguna consent. Acceptance 1, 2. |
| "T28 Read without AI asks first; Back, Enter and Escape change nothing; confirming turns AI off everywhere" | (b) + (d) | Baca tanpa AI → konfirmasi di dialog yang sama, fokus di judul konfirmasi, tanpa Use AI, kedua tombol kelas sama; axe tampilan konfirmasi. Enter di judul: tidak ada batch, consent tetap. Tab: Matikan lalu Kembali; Kembali → fokus Baca tanpa AI dan kartu kembali. Esc dari konfirmasi: dialog tertutup, "Selected: rules.pdf" masih tampil, tidak ada batch, consent tetap; Upload lagi mulai dari kartu. Konfirmasi: consent `null`, batch `rules`, worker selesai, *Review candidates* tampil, tidak ada `ai_jobs` untuk batch itu, unit `import` di `internal.ai_usage` tidak bertambah. Lalu S12 *Not allowed*, dan *Analyze with AI* di aktivitas baru membuka *Allow AI processing?*; tidak ada `ai_jobs`. Acceptance 3, 4, 5, 8, 12. |
| "T28 allowing AI and then turning it off in one page visit uses the newest profile revision" | (c) | Tanpa consent: Use AI → batch `ai`, consent tersimpan; batal; Coba file lain; Upload → kartu Tanpa AI kini memuat `rulesAiOff`; Baca tanpa AI → Matikan: berhasil, tanpa pesan konflik, consent `null`, batch `["ai", "rules"]`. Acceptance 7. |
| "T28 a user with consent at the AI import limit still uploads, reading without AI" | (e) | Plan `free`, unit import harian dan bulanan diisi 3 lewat `internal.ai_usage` (pola `setUnits` suite integration). Dropzone tampil; di dialog kartu AI memuat *CV import limit reached*, Use AI nonaktif, Read without AI aktif; axe; alur konfirmasi → batch `rules`, consent `null`. Acceptance 9. |
| "T28 both dialog views at 360 and 1440 in light and dark: axe, no overflow, focus on each heading" | axe | 8 kombinasi (2 lebar × 2 tema × 2 tampilan): fokus di judul masing-masing, panel dialog dan halaman tanpa overflow horizontal, axe WCAG 2.2 AA tanpa pelanggaran. Tidak ada batch, consent tetap. Acceptance 12. |

Pemanggil `snapshot()` menjalankan `expectNoWcagViolations` dan melampirkan screenshot full page.

## Langkah upload pengguna consent di spec lain

Hanya langkah yang kini membuka dialog yang diubah: setelah *Upload and extract*, pilih *Use AI* di dialog. Tidak ada assertion lain yang diubah atau dilemahkan.

| Spec | Lokasi | Perubahan |
| --- | --- | --- |
| `import-onboarding.spec.ts` | test "unsupported, password-protected and duplicate files" (4 upload), "transient AI failure", "cancel while waiting", "empty extraction and Indonesian copy" (2 upload, label Indonesia), "layouts at 360 and 1440" | helper `uploadWithAi(page, locale)` |
| `import-onboarding.spec.ts` | "T26 a new user reads the CV without AI ..." | teks disclosure lama `import.disclosureNoConsent` diganti `import.disclosureChoice` (key diganti §2.2.8, perubahan disengaja) |
| `import-review.spec.ts` | helper `uploadAndExtract` | pilih *Use AI* (keyboard lewat `activate` saat `keyboard`, klik bila tidak) |
| `m3-assisted-journey.spec.ts` | test "malformed and unsupported files are refused in S02 ..." | pilih *Use AI* setelah kedua upload. Kedua file lolos cek klien (MIME/ekstensi), jadi dialog muncul; server tetap menolak dan tidak ada batch |
| `release-a11y.spec.ts` | `beforeAll`, aktor `rich` | pilih *Use AI* agar S03 tetap diuji dengan batch AI seperti sebelumnya |

Tidak berubah: `m2-manual-journey.spec.ts:172` (hanya cek tombol nonaktif), `m3:139` (pengguna baru, sudah memakai dialog T26).

## Bukti gagal dulu (TDD)

Skenario E2E ditulis setelah implementasi Fase 2. Untuk membuktikan test benar-benar menguji perubahan, kelima test T28 dijalankan terhadap `src/` dari commit Fase 1 (`git checkout 092b00c -- src`, lalu dikembalikan `git checkout HEAD -- src`; `git diff --quiet HEAD -- src` benar sebelum dan sesudah):

`node node_modules/@playwright/test/cli.js test --config playwright.import.config.ts tests/e2e/import-onboarding.spec.ts --grep "T28"`: exit 1, **5 failed**:

1. (a) dialog *How should we read your CV?* tidak ditemukan (pengguna consent langsung upload).
2. (b) gagal pada langkah dialog yang sama.
3. (c) kartu *Without AI* tidak ditemukan pada upload kedua (setelah consent tersimpan, dialog tidak muncul).
4. (e) dropzone tidak ditemukan (tampilan kuota habis hanya *Start manually*).
5. axe matrix: judul dialog tidak ditemukan.

## Command dan hasil (kode HEAD `a1d17c1` + perubahan spec fase ini)

| Command | Hasil |
| --- | --- |
| `test:e2e:import` | exit 0, **16 passed** (2,1 menit): 11 lama + 5 T28 |
| `test:e2e:import-review` | exit 0, **10 passed** (1,4 menit) |
| `test:e2e:m3` | exit 0, **2 passed** (45,8 detik) |
| `test:e2e:release` | exit 0, **21 passed** (3,7 menit) |

Semua lewat `node node_modules/@playwright/test/cli.js test --config <config> [spec]` (catatan Fase 0). PNG tracked di `docs/verification/T25-screenshots/` dan `T27-screenshots/` dikembalikan dengan `git checkout` setelah `release`.

## Acceptance yang terbukti (E2E)

1, 2, 3, 4, 5, 7, 8, 9, 12 seperti tabel skenario di atas. Acceptance 6 dan 10 dibuktikan unit (Fase 1 dan 2). Acceptance 11 unit (Fase 2) ditambah teks yang dicek di E2E (`rulesAiOff`, isi konfirmasi, disclosure). Acceptance 13 di Fase 4.

## Warning, kegagalan, blocker

- Log `[WebServer] Error: The destination stream closed early.` muncul di `import` dan `release` tanpa menggagalkan test (sama dengan baseline Fase 0).
- Skenario (d) menandai onboarding selesai lewat admin (`display_name`, `timezone`, `onboarding_completed_at`, pola `ai-consent.spec.ts`) supaya halaman aktivitas dapat dibuka; ini fixture, bukan alur yang diuji.
- Tidak ada blocker. Stop condition §8 tidak terpicu.

## Langkah berikutnya

Fase 4: regresi §7 lengkap dan Delivery Gate antislop dengan klik-through per elemen.
