# Keputusan kontrak service Activity setelah review

Tanggal: 17 September 2026

## Konteks

Review T06 menemukan tiga ketidaksesuaian pada batas service Activity: session hilang diklasifikasikan sebagai gangguan dependency, create replay membaca row Activity yang dapat berubah, dan error tidak membawa message key atau correlation ID. Keputusan ini menutup ketiganya tanpa mengubah persistence T06, RPC, RLS, atau scope UI T07.

Acuan: PRD R04 dan Content/AI behavior, User Flow F02 dan shared recovery, Wireframe S05/S06, Database Schema §§1–3/6, serta `docs/IMPLEMENTATION_PLAN.md` §§1, 3, dan 4.

## Keputusan

### Auth session

Service memakai type guard resmi dari `@supabase/supabase-js@2.116.0`: `isAuthSessionMissingError`, `isAuthRetryableFetchError`, dan `isAuthError`. Missing session, status auth HTTP 401/403, serta code credential/session yang dikenal (`bad_jwt`, `invalid_jwt`, `no_authorization`, `session_expired`, `session_not_found`) menjadi `UNAUTHENTICATED`. Retryable fetch, error provider lain, exception transport, dan hasil yang kontradiktif menjadi `UNAVAILABLE`. Klasifikasi tidak membaca substring pesan error. Actor hanya berasal dari user valid yang dikembalikan session.

### Error service

Setiap `ActivityServiceError` membawa code aman, `MessageKey`, UUID acak dari `randomUUID()`, optional `fieldErrors` bertipe `MessageKey`, dan pesan diagnostics generik yang tidak berisi provider/database message. Pemetaan menggunakan key dictionary yang sudah ada di `en` dan `id`:

| Code | Message key |
| --- | --- |
| `VALIDATION` | `error.validation` |
| `UNAUTHENTICATED` | `auth.signInRequired` |
| `NOT_FOUND` | `error.notFound` |
| `CONFLICT` | `error.conflict` |
| `IDEMPOTENCY_KEY_REUSED` | `error.operationKeyReused` |
| `UNAVAILABLE` | `error.unavailable` |

`latestRecord` hanya tersedia pada conflict setelah pembacaan dengan owner dari session. Record asing dan record hilang tetap menghasilkan `NOT_FOUND` dengan pesan yang sama.

### Create receipt

`createActivity()` memvalidasi tepat satu row receipt RPC, owner hasil session, revision awal `1`, tanggal exact, dan capture mode. Service mengembalikan object immutable lima field: `activityId`, `userId`, `revision`, `occurredOn`, dan `captureMode`. Tidak ada query Activity live pada jalur create. Pemanggil yang memerlukan source, optional context, atau Chat memakai `getActivity(activityId)` sebagai pembacaan terpisah.

Operation ledger tetap menjadi boundary privacy: receipt tidak menyalin `raw_text`, role, scope, outcome, Chat content, atau context ID. Replay setelah edit atau propagation context tetap mengembalikan receipt awal.

## Dampak dan verifikasi

- Tidak ada perubahan SQL, migration, RPC signature, grants, RLS, operation hash, schema, package version, lockfile, worker, atau UI.
- `src/server/supabase/database.types.ts` tidak diregenerasi karena tidak ada perubahan schema/RPC.
- Unit regression menguji missing/invalid/retryable/unknown/contradictory auth, error mapping, field errors, UUID unik, sanitasi, dan validasi receipt. Activity integration menguji anonymous session, immediate/concurrent replay, replay sesudah edit dan context propagation, changed payload, owner boundary, revision conflict, pagination, dan lifecycle yang sudah ada.
- Acceptance akhir dan command aktual dicatat pada `docs/verification/T06-activity-persistence.md` serta `docs/IMPLEMENTATION_STATUS.md`.
