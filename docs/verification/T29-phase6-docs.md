# T29 Fase 6: draft dokumen

Tanggal: 22 Oktober 2026. Pelaksana: Claude (Opus 5.5). Worktree `D:\Project\WorkPulse-t29`, branch `claude/t29-google-oauth`, mulai dari `3a6d1b9` (setelah gate review PASS).

## Tujuan

Decision record, runbook provider untuk pemilik produk, dan dokumen bukti dengan draft entry status. Tanpa klaim DONE dan tanpa menyentuh bagian authoritative `IMPLEMENTATION_STATUS.md`.

## File berubah

- `docs/decisions/0039-t29-google-oauth.md` (baru). Nomor 0038 sudah dipakai draft decision T28 di `origin/claude/t28-import-mode-choice`; `origin/main` berhenti di 0037. Plan menulis 0038; nomor dicek ulang saat merge.
- `docs/verification/T29-google-oauth-runbook.md` (baru): OAuth client, provider hosted, flag, smoke 5.1-5.7, bukti, dan tabel gejala. Menutup gate N4.
- `docs/verification/T29-google-oauth.md` (baru): matriks acceptance, checks, file, temuan terbuka, draft entry status.
- `docs/verification/T29-phase6-docs.md` (receipt ini).

## Pemeriksaan

- Dockerfile tidak memberi nilai `NEXT_PUBLIC_*` saat build, dan kode server yang ada sudah membaca `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` saat runtime di staging; `getBrowserSupabaseOrigin()` membaca `NEXT_PUBLIC_SUPABASE_URL` dengan cara yang sama. Runbook §1 mewajibkan `SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_URL` di `web.env` ber-origin sama.
- Rujukan path di keempat dokumen dicek ada di repo; `git diff --check` dan pencarian em dash dicatat di bawah.

## Command dan hasil

| Command | Hasil |
| --- | --- |
| skrip cek tautan relatif `.md`, em dash, dan mojibake di enam dokumen T29 | semua tautan ada, 0 em dash, 0 mojibake |
| `vitest run tests/unit/release-docs.test.ts` | exit 0, 7/7 |
| `git diff --cached --check` | exit 0 |

Perubahan dokumentasi saja, jadi build dan test aplikasi tidak dijalankan ulang. `release-docs.test.ts` dijalankan karena runbook T25 merujuk runbook T29. Plan §4 dan §5 Fase 6 diperbarui ke nomor 0039.

## Blocker

Tidak ada untuk dokumen. Smoke staging menunggu pemilik produk.

## Langkah berikutnya

Closeout T29 (decision status, `IMPLEMENTATION_STATUS.md`, `AGENTS.md`/README bila perlu) setelah pengguna memutuskan apakah DONE butuh smoke staging lebih dulu, lalu PR ke `main`.
