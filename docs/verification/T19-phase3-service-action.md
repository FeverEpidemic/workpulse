# T19 Fase 3 — Service, action, i18n (30 September 2026)

- Tujuan: `saveEdits` di service, `saveCvEditsAction`, pemetaan `CV_OVERRIDE_UNSUPPORTED`, dan perbaikan correlation ID (P3 F2 dari gate T18).
- File: `src/features/cv/{cv-service,cv-errors,actions}.ts`, `src/i18n/messages.ts` (`cv.error.overrideUnsupported`, en + id; paritas dijaga tipe `Record<keyof en, string>`), `tests/unit/{cv-service,cv-actions}.test.ts`.
- `saveCvEditsAction` menerima `expected_revision` dan `edits` (JSON string, hanya field berubah); `expected_revision` di dalam `edits` ditimpa; payload tidak valid ditolak tanpa panggilan database; `revalidatePath('/cv')` hanya setelah sukses.
- F2: `run()` membuat satu `correlationId` dan meneruskannya ke service dan `failure()`; tes menunjukkan ID error = ID service untuk kegagalan tak terduga dan konflik.
- Kunci i18n UI S13 (`cv.*`) ditambahkan di Fase 4 bersama komponen yang memakainya.

| Command | Hasil |
| --- | --- |
| `pnpm test` | 85 file / 609 test PASS |
| `pnpm typecheck` / `pnpm lint` | exit 0 / exit 0 |

