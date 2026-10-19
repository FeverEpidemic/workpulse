# T26 Fase 5: E2E, aksesibilitas, regresi penuh

Tanggal: 19 Oktober 2026. Pelaksana: Claude (Opus 5.5). Status receipt: **sementara**. Regresi §7 yang butuh database belum selesai karena blocker lingkungan (lihat *Blocker*).

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

Hasil Fase 1-4 yang sudah tercatat: pgTAP 21/1725, `db:lint` exit 0, integration `account-deletion` 15, `import` 25, `import-commit` 12, `import-review` 6, `m3` 7, `release` 12, `ai-usage` 9.

## Belum dijalankan

Regresi §7 berikut belum dijalankan ulang setelah perubahan Fase 4-5: `db:test`, `db:lint` (tidak ada perubahan SQL sejak Fase 1), `test:integration:*` (kecuali yang tercatat), `test:e2e:import-review`, `test:e2e:m3`, `test:e2e:release`, serta suite §7 lain. Verifikasi screen reader manusia (NVDA) tidak dilakukan.

## Blocker

Setelah Docker Desktop dimulai ulang pukul 12:07 (bukan oleh sesi ini), Windows mencadangkan rentang port TCP **54293-54392** (`netsh int ipv4 show excludedportrange protocol=tcp`), termasuk port Supabase lokal 54321/54322. `pnpm db:start` gagal: `bind: An attempt was made to access a socket in a way forbidden by its access permissions`. Perbaikan butuh shell admin (`net stop winnat` lalu `net start winnat`, kemudian `pnpm db:start`, tanpa reset) atau reboot. Sesi agen tidak berjalan sebagai admin.

## Berikutnya

Setelah port dibebaskan: jalankan regresi §7 lengkap, lengkapi receipt ini dengan angka aktual, commit, lalu berhenti untuk gate review Claude.
