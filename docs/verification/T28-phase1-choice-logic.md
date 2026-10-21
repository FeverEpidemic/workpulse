# T28 Fase 1: logika pilihan

- Tanggal: 21 Oktober 2026
- Eksekutor: Claude (Opus 5.5), single-agent, tanpa sub-agent.
- antislop: mode during (session override, dipilih pengguna di sesi ini). Fase ini hanya menyentuh logika dan komentar kode.
- Tujuan: `chooseImportMode` mengenal consent (§2.2.2): empat kombinasi mode × consent, dan error langkah consent menghentikan upload.

## File berubah

| File | Perubahan |
| --- | --- |
| `src/features/import/import-start.tsx` | `chooseImportMode(mode, granted, steps)` dengan `steps: { saveConsent, withdrawConsent, upload }`. Langkah consent dipilih dari `mode` dan `granted`: `ai` tanpa consent menyimpan, `rules` dengan consent mencabut, dua kombinasi lain tidak menyentuh consent. Pemanggil `chooseMode` meneruskan `granted` dan memakai helper `setConsent("allow" \| "withdraw")`. State baru `profileRevision` (awal dari `consent.profileRevision`) diperbarui dari `state.data.revision` hasil `setAiConsentAction` (§2.2.6). `granted` mengikuti hasil (allow = true, withdraw = false). |
| `tests/unit/import-start-ui.test.tsx` | Test T26 "saves consent before an ai upload ..." diganti tiga test yang memakai signature baru (lihat di bawah). |

`profileRevision` dimasukkan di fase ini, bukan Fase 2, karena `withdrawConsent` tanpa revisi terbaru akan `CONFLICT` setelah `saveConsent` di sesi halaman yang sama; logika pilihan tidak lengkap tanpanya.

## TDD

1. Test ditulis dulu. `pnpm exec vitest run tests/unit/import-start-ui.test.tsx`: exit 1, **3 failed | 17 passed (20)**, semua `TypeError: steps.saveConsent is not a function` (signature lama).
2. Implementasi. Test yang sama: exit 0, **20 passed (20)**.

Test baru di `T26 S02 upload steps`:

- "without consent: Use AI saves consent then uploads ai, Read without AI uploads rules and never touches consent": urutan `["save", "upload:ai"]` dan `["upload:rules"]`.
- "with consent: Use AI uploads ai at once, Read without AI withdraws consent then uploads rules": urutan `["upload:ai"]` dan `["withdraw", "upload:rules"]`.
- "returns the consent error and never uploads when saving or withdrawing consent fails": `saveConsent` gagal → pesan dikembalikan, `["save"]`, `upload` tidak dipanggil; `withdrawConsent` gagal → pesan dikembalikan, `["withdraw"]`, `upload` tidak dipanggil.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `pnpm test` | exit 0, **134 file / 1263 test** (baseline 1261, minus 1 test lama, plus 3 test baru) |
| `pnpm typecheck` | exit 0 |
| `pnpm exec eslint . --max-warnings 0 --ignore-pattern ".claude/**"` | exit 0 |

## Acceptance yang terbukti (unit)

- Acceptance 2 (bagian logika): pengguna consent yang memilih Pakai AI langsung upload `ai` tanpa `saveConsent`.
- Acceptance 4 (bagian urutan): `rules` dengan consent menjalankan `withdrawConsent` sebelum `upload("rules")`.
- Acceptance 6: `withdrawConsent` gagal → pesan error dikembalikan dan tidak ada upload.

Belum terbukti di fase ini: dialog untuk semua pengguna, tampilan konfirmasi, dan bukti E2E (Fase 2 dan 3). Di UI saat ini pengguna consent belum membuka dialog, jadi jalur `withdrawConsent` belum bisa dicapai dari layar sampai Fase 2.

## Warning, kegagalan, blocker

Tidak ada. Stop condition §8 tidak terpicu: revisi tersedia di `state.data.revision`.

## Langkah berikutnya

Fase 2: dialog `step` choose/confirm, S02 merender dialog untuk semua pengguna, disclosure netral, cabang kuota habis dihapus, copy §2.2.8.
