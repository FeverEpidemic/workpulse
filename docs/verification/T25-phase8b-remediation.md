# T25 Fase 8b · Remediasi review RV1

- Tanggal: 11 Oktober 2026.
- Eksekutor: Claude (Opus), reviewer T25, atas permintaan pengguna ("kamu aja langsung yang ngerjain RV1"). Review ulang tidak independen penuh karena reviewer juga mengerjakan perbaikannya.
- Mode antislop: **during** (session override). Tidak ada perubahan UI atau copy.
- Rencana: `T25-review-remediation-plan.md` §2.
- HEAD awal: `79d775d`. Commit perbaikan: `617cae3`.

## Tujuan dan file berubah

Snapshot aria yang dikunci (§1.11) harus cocok di checkout mana pun, termasuk Windows dengan `core.autocrlf=true`.

| File | Aksi |
| --- | --- |
| `tests/e2e/helpers/aria-snapshot.ts` | create: `compareAriaSnapshot(expected, actual)`, normalisasi `\r\n`, baris pertama yang berbeda (1-based), baris hilang dilaporkan `<end of file>` |
| `tests/e2e/release-a11y.spec.ts` | perbandingan golden memakai helper; pesan menyebut nomor baris dan kedua isi |
| `tests/unit/aria-snapshot-compare.test.ts` | create, 4 test |

Penyimpangan dari §2 rencana: helper ditaruh di file baru `aria-snapshot.ts`, bukan di `accessibility.ts`, karena `accessibility.ts` mengimpor `@playwright/test` dan `@axe-core/playwright` yang tidak dimuat di Vitest. Golden aria, `src/`, `workers/`, `supabase/`, dan dependency tidak berubah. Tidak ada `.gitattributes` baru.

## Bukti gagal lebih dulu

| Run | Hasil |
| --- | --- |
| `pnpm test:e2e:release` pada HEAD `4574d9a`, worktree baru (golden CRLF: 86 CR / 86 LF) | 1 failed, 14 passed; kelima layar "at line 0: expected undefined, got undefined" (gate review §4) |
| `vitest run tests/unit/aria-snapshot-compare.test.ts` sebelum helper ada | exit 1, `Cannot find module '../e2e/helpers/aria-snapshot'` |

## Mutasi

| Mutasi | Hasil |
| --- | --- |
| Helper tanpa `replace(/\r\n/g, "\n")` | unit exit 1: 2 dari 4 gagal ("treats a CRLF golden as equal…", "names the first differing line…"); dipulihkan |
| Golden `s04-dashboard.aria.yml` di worktree scratch: `button "Sign out"` → `button "Log out"` | E2E exit 1: `s04-dashboard: accessibility tree differs … at line 24: expected "  - button \"Log out\"", got "  - button \"Sign out\""`; dipulihkan dengan `git checkout` |

Percobaan mutasi pertama mengganti teks yang tidak ada di golden (`changed: False`), jadi run itu lulus tanpa membuktikan apa pun. Run tersebut tidak dihitung.

## Command dan hasil (worktree baru di `617cae3`, golden CRLF)

Env dimuat per proses: `.env.local`, `SERVICE_ROLE_KEY` sebagai `SUPABASE_SECRET_KEY`, `WORKPULSE_PDF_GOTENBERG_URL`, `AI_AGENT` dan `ANTHROPIC_BASE_URL` dikosongkan.

| Command | Exit | Hasil |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | lockfile cocok |
| `pnpm lint` | 0 | lulus |
| `pnpm typecheck` | 0 | lulus |
| `pnpm test` | 0 | 118 file / 1068 test (gate review: 117 / 1064; +1 file, +4 test) |
| `pnpm test:e2e:release` | 0 | **15 passed** (4,5 menit), golden CRLF tidak diubah |
| `git diff --check 4574d9a..HEAD` | 0 | bersih |

`test:e2e:release` di working tree pelaksana (golden LF) tidak dijalankan ulang: working tree itu membawa perubahan Storybook sesi lain (O12), dan helper menormalkan kedua sisi sehingga LF/LF identik dengan perilaku sebelumnya (unit "ignores trailing whitespace" dan run Fase 8 15/15). Screenshot T25 yang tertulis ulang oleh run E2E hanya berada di worktree scratch dan dibuang bersamanya.

## Status

- RV1: **FIXED**.
- Tidak ada P0–P2 terbuka. P3 N1–N6 tetap seperti di rencana remediasi.
- Status T25 yang direkomendasikan tetap **PARTIAL**: Fase 7 staging BLOCKED (B1) dan retensi backup belum terverifikasi (B2).

## Langkah berikutnya

Fase 9 plan: decision 0031, `T25-release-handoff.md`, README, plus perbaikan dokumen N1 (checklist bagian 3) dan N2 (angka receipt Fase 8), serta kalimat N4 di runbook §7.
