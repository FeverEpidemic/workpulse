# T26 Fase 5: E2E, aksesibilitas, regresi penuh

Tanggal: 19 Oktober 2026. Pelaksana: Claude (Opus 5.5). Status receipt: **lengkap**. Regresi §7 dijalankan setelah blocker port dibebaskan pengguna (lihat *Blocker*).

## Tujuan

Journey pengguna baru tanpa AI di browser nyata, axe pada dialog pilihan dan S02/S03 `rules`, 360/1440 light/dark, keyboard-only, lalu regresi §7.

## File berubah

- `tests/e2e/import-onboarding.spec.ts`: empat test T26 baru; dua test lama disesuaikan (lihat *Perubahan assertion*).
- `tests/e2e/m3-assisted-journey.spec.ts`: langkah consent di S02 memakai dialog pilihan (lihat *Perubahan assertion*).

## Test E2E T26

1. **Journey keyboard:** pengguna baru tanpa consent memilih file dengan keyboard, Enter pada *Upload and extract* membuka dialog; fokus ada di judul; Enter pada judul tidak memilih apa pun (dialog tetap terbuka, nol batch, consent tetap kosong); dua region berlabel *With AI*/*Without AI*; Tab dari judul ke *Use AI* lalu *Read without AI*; axe tanpa pelanggaran; Enter pada *Read without AI* → batch `extraction_mode = 'rules'`, consent tetap kosong; worker (ClamAV nyata, parser thread) tanpa sentinel, nama file, atau nama perusahaan di output; S02 *Extraction finished* + catatan `rules`; nol `ai_jobs`; S03 menampilkan catatan, role terisi *Senior Data Analyst*, pengguna memilih *Type* lalu *Save changes*, nama onboarding terisi *Rina Fiktif* dari kandidat profil; *Confirm import* → *Import saved* → dashboard → timeline menampilkan role; satu baris `experiences` dengan `kind = employment`; consent tetap kosong; console browser tanpa sentinel atau nama file.
2. **Esc dan Cancel:** keduanya menutup dialog tanpa batch dan tanpa consent; fokus kembali ke area file; kedua tombol pilihan berkelas sama; kedua kartu berukuran sama (selisih ≤ 1 px).
3. **Layout:** dialog di 360 dan 1440, light dan dark: kartu berdampingan di 1440 (y sama) dan bertumpuk di 360; tanpa overflow horizontal di dialog maupun halaman; axe tanpa pelanggaran. Lalu S02 siap dan S03 batch `rules` di keempat kombinasi: catatan `rules` tampil, tanpa overflow, axe bersih.
4. **Kosong, Indonesia:** fokus judul pada *Bagaimana CV Anda dibaca?*, *Baca tanpa AI*, hasil kosong memakai copy `import.emptyBodyRules`.

## Perubahan assertion (disengaja)

- `import-onboarding.spec.ts` test 1 (dulu *consent declined keeps the manual path*): pengguna tanpa consent kini melihat dialog pilihan, bukan `AiConsentDialog`; fokus awal di judul (dulu di *Continue manually*); Esc tetap tidak meng-upload dan fokus kembali ke area file. Nama test disesuaikan.
- `import-onboarding.spec.ts` test 2: *Allow AI* diganti *Use AI* di dialog pilihan; ditambah assertion bahwa consent tersimpan dan batch berkode `ai`.
- `m3-assisted-journey.spec.ts`: langkah consent yang sama memakai *Use AI*. Ini file di luar daftar §4 rencana; perubahannya akibat langsung acceptance 10 (dialog pilihan menggantikan dialog consent untuk import).

## Commands dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test:e2e:import` | **11/11 lulus** (7 lama, 4 T26), 1,8 menit |
| `pnpm lint` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm worker:check` | exit 0 |
| `pnpm test` | 121 file / 1151 test lulus |
| `pnpm build` | exit 0 |
| `git diff --check` | exit 0 |

### Regresi §7 pada `b105426` (19 Oktober 2026, 20:25-20:41)

Parity lokal 38/38 (`20261019090000` terakhir), image Storage v1.80.2, ClamAV/Gotenberg/PDF renderer nyata.

| Command | Hasil |
| --- | --- |
| `pnpm db:test` | **21 file / 1725 test, `Result: PASS`** |
| `pnpm db:lint` | exit 0, `results: []` |
| `pnpm test:integration:account-deletion` | 15/15 (dijalankan pertama, sesuai urutan CI) |
| `pnpm test:integration:import` | 25/25 |
| `pnpm test:integration:import-commit` | 12/12 |
| `pnpm test:integration:import-review` | 6/6 |
| `pnpm test:integration:m3` | 7/7 |
| `pnpm test:integration:release` | 12/12 |
| `pnpm test:integration:ai-usage` | 9/9 |
| `pnpm test:e2e:import` | 11/11 |
| `pnpm test:e2e:import-review` | 10/10 |
| `pnpm test:e2e:m3` | 2/2 |
| `pnpm test:e2e:release` | 15/15 |

Run pertama setelah Supabase menyala gagal di setup: database masih `57P03 the database system is starting up`, dan tiga container helper berhenti (`Exited (255)`) sehingga suite import tidak menemukan Gotenberg. Setelah DB siap dan container dinyalakan ulang, seluruh suite di atas lulus tanpa perubahan kode. Kegagalan itu lingkungan, bukan regresi.

Tidak ada assertion lama yang dilemahkan. Perubahan assertion yang disengaja tercatat di receipt Fase 1, 3, 4, dan 5.

## Belum dijalankan

Suite di luar §7 (`test:e2e:evidence`, `test:e2e:account-deletion`, `test:pdf`, `test:perf`, dan suite domain lain) tidak diulang; perubahan T26 tidak menyentuh domain itu. Verifikasi screen reader manusia (NVDA) tidak dilakukan. Uji kualitas ekstraksi pada CV nyata (decision 0033 *Open*) belum dilakukan.

## Blocker (selesai)

Setelah Docker Desktop dimulai ulang pukul 12:07 (bukan oleh sesi ini), Windows mencadangkan port TCP 54293-54392, termasuk port Supabase lokal, sehingga `pnpm db:start` gagal (`bind: ... forbidden by its access permissions`). Pengguna menjalankan `net stop winnat` dan `net start winnat` di shell admin; `pnpm db:start` lalu berhasil tanpa reset.

## Berikutnya

Stop untuk gate review Claude (rencana §9). Fase 6 (decision 0033 final, `T26-import-rules-extraction.md`) hanya setelah gate lulus.
