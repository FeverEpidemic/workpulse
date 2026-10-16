# T25 Fase 3 — Health operasional (`get_operational_health`, `ops:check`)

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `7a60815` (receipt Fase 2). Satu migration baru; parity lokal **36/36**.

## Tujuan dan file berubah

Menutup bagian alert dari D8: operator mendapat satu pemeriksaan tanpa konten untuk backlog penghapusan, cleanup, purge retensi, upload macet, job gagal, dan lease habis.

| File | Aksi |
| --- | --- |
| `supabase/tests/database/operational_health.test.sql` | create (35 assertion; ditulis dan dijalankan **gagal lebih dulu**: fungsi belum ada) |
| `supabase/migrations/20261012090000_t25_operational_health.sql` | create |
| `src/server/supabase/database.types.ts` | regenerasi (diff: hanya `get_operational_health`) |
| `tests/unit/ops-check.test.ts` | create (10 test; gagal lebih dulu: modul belum ada) |
| `workers/ops-check.ts` | create |
| `package.json` | script `ops:check` (satu baris, lewat index; perubahan Storybook sesi lain tidak ikut) |
| `.env.example` | delapan variabel ambang (dikomentari) |

## Kontrak

`public.get_operational_health(p_now timestamptz default now()) returns table (metric text, value integer)`; `security definer`, `stable`, `search_path = pg_catalog`, `EXECUTE` hanya `service_role`, komentar berlabel `T25`. Dua kolom saja, tanpa user id, email, nama, key objek, atau teks error.

| # | Metrik | Definisi (dari kolom nyata, diverifikasi Fase 0) | Ambang default |
| --- | --- | --- | --- |
| 1 | `account_deletion_overdue` | `status <> 'completed'` dan `requested_at <= p_now - 24 jam` (aturan yang sama dengan `get_account_deletion_backlog`) | > 0 |
| 2 | `storage_cleanup_failed` | `internal.storage_jobs.status = 'failed'` | > 0 |
| 3 | `storage_cleanup_overdue` | `storage_jobs` queued/running dan `created_at <= p_now - 24 jam` | > 0 |
| 4 | `import_purge_overdue` | batch `failed/cancelled/committed`, `purged_at is null`, `coalesce(failed_at, cancelled_at, committed_at) <= p_now - 24 jam` | > 0 |
| 5 | `export_purge_overdue` | export `succeeded`, `purged_at is null`, `finished_at <= p_now - 24 jam` | > 0 |
| 6 | `evidence_stuck` | `uploading`/`scanning` dan `updated_at <= p_now - 1 jam` | > 0 |
| 7 | `jobs_failed_24h` | `ai_jobs`, `cv_exports` gagal (`finished_at`) dan `import_batches` gagal (`failed_at`) dalam 24 jam sampai `p_now` | > 20 |
| 8 | `jobs_expired_lease` | `running` dengan `lease_expires_at <= p_now - 10 menit` di enam tabel (AI, export, import job, evidence scan, cleanup, deletion) | > 0 |

Tidak ada kolom atau tabel baru, dan tidak ada fungsi T02–T24 yang diganti.

`pnpm ops:check` (`workers/ops-check.ts`): membaca `SUPABASE_URL` dan `SUPABASE_SECRET_KEY`, memanggil RPC, membandingkan dengan ambang (override `WORKPULSE_ALERT_*`, integer 0–1.000.000), mencetak satu baris JSON.

| Exit | Arti | Keluaran |
| --- | --- | --- |
| 0 | semua metrik di dalam ambang | `{"status":"ok","metrics":[{metric,value,threshold,alert}…]}` |
| 2 | satu atau lebih metrik di atas ambang | `{"status":"alert",…}` |
| 1 | konfigurasi tidak valid atau backend tidak menjawab dengan benar | `{"status":"unavailable","code":"OPS_CONFIG_INVALID"\|"OPS_BACKEND_UNAVAILABLE","metrics":[]}` |

Satu penambahan di luar bentuk di plan §3.2: field `code` pada status `unavailable`, agar operator dapat membedakan konfigurasi salah dari backend mati tanpa membaca log. Tidak membawa URL, key, pesan error, atau stack.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| `supabase test db …/operational_health.test.sql` sebelum migration | exit 1, test 1 gagal ("function does not exist") |
| `supabase migration up --local` | exit 0, `20261012090000` diterapkan |
| `supabase test db …/operational_health.test.sql` | exit 0, **35 assertion**, PASS |
| `pnpm db:test` | exit 0, **20 file / 1638 assertion**, PASS |
| `pnpm db:lint` | exit 0, `{"results":[]}` |
| `supabase migration list --local` | **36 migration, local = remote**, terakhir `20261012090000` |
| `vitest run tests/unit/ops-check.test.ts` sebelum implementasi | gagal, modul tidak ditemukan |
| `vitest run tests/unit/ops-check.test.ts` | exit 0, **10 test** |
| `eslint workers/ops-check.ts tests/unit/ops-check.test.ts --max-warnings 0` | exit 0 |
| `tsc --noEmit` | exit 0 |
| `pnpm test` | exit 0, 122 file / 1080 test (lihat catatan Storybook) |
| `pnpm ops:check` (stack lokal, key dari `SERVICE_ROLE_KEY`) | **exit 0**, `status: ok`, kedelapan metrik 0 |
| `node workers/ops-check.ts` tanpa `SUPABASE_SECRET_KEY` | exit 1, `OPS_CONFIG_INVALID` |
| `node workers/ops-check.ts` dengan key salah | exit 1, `OPS_BACKEND_UNAVAILABLE` |

## Bukti terhadap risiko §10.6 ("alert yang diam")

- Exit 1 untuk RPC gagal, jawaban bukan array, metrik hilang atau tambahan, nilai negatif, pecahan atau string, dan konfigurasi hilang atau salah (unit, 9 + 7 kasus). Hanya jawaban yang tepat delapan metrik bernama dan berisi integer ≥ 0 yang dapat menghasilkan exit 0 atau 2.
- Definisi overdue penghapusan identik dengan `get_account_deletion_backlog` (pgTAP membandingkan keduanya).
- Setiap metrik naik tepat 1 dengan fixture yang dimundurkan waktunya; kasus "nyaris" (23 jam, 59 menit, 9 menit, sudah dipurge, sudah selesai) tidak dihitung.
- Keluaran tidak memuat URL, key, `ECONNREFUSED`, atau stack walau backend melempar error yang memuatnya (unit).

## Temuan

| ID | Prio | Temuan |
| --- | --- | --- |
| O7 | P3 | `jobs_expired_lease` mencakup lease yang habis lebih dari 10 menit; lease kerja sehat berumur 120 detik, jadi pass worker normal tidak memicunya. Pass yang berhenti memicu alert setelah 10 menit, bukan seketika. Ambang dapat diubah lewat env. |
| O8 | P3 | Jalur `ops:check` tidak menjalankan notifikasi (email, Slack): sesuai keputusan §2.4.5, kanal alert adalah langkah operator di runbook. |
| N2 | info | `import.meta.main` dipakai agar `ops-check.ts` hanya berjalan sebagai skrip, tidak saat diimpor test. |
| N3 | info | Suite unit lokal memuat 122 file / 1080 test karena konfigurasi Storybook sesi lain ikut menjalankan 7 file story (+29 test). Selisih murni dari ops-check: +1 file, +10 test dari baseline 114/1041. |

## Acceptance Fase 3 (§1.13)

- `get_operational_health()` hanya `service_role`, hitungan tanpa konten: terbukti (pgTAP).
- `pnpm ops:check` exit 0 / 2 / 1 menurut aturan, keluaran hanya nama metrik, angka, ambang: terbukti (unit + satu run nyata).
- Stop condition §8: tidak ada yang terpicu (tidak ada kolom baru, satu migration baru saja, kontrak RPC lama utuh).

## Langkah berikutnya

Fase 4: `theme-contrast.test.ts` (kontras token), matriks aksesibilitas dan layout, keyboard, teks 200%, snapshot aria, tes bundle browser (D6), dan kalimat S12. Mode antislop **during** (skill `antislop-ui`, `antislop-human`, `antislop-layoutmobile`, `antislop-copywriting` dibaca sebelum menyentuh UI atau copy).
