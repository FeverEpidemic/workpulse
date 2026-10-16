# T25 Fase 1 — Audit acceptance dan matriks rilis

- Tanggal: 10 Oktober 2026
- Eksekutor: Claude Sonnet 5.5 (single-agent, tanpa sub-agent)
- HEAD awal: `24f1f33` (`docs(t25): add phase 0 baseline receipt`)
- Tidak ada edit kode, migration, atau test. File baru: `T25-release-matrix.md` dan receipt ini.

## Tujuan dan file berubah

Menelusuri R01–R10, enam skenario rilis PRD, empat skenario lintas subsistem rencana §6, dan PRD §4 ke test yang ada, lalu menetapkan gap yang menentukan isi Fase 2–5.

| File | Aksi |
| --- | --- |
| `docs/verification/T25-release-matrix.md` | create |
| `docs/verification/T25-phase1-acceptance-audit.md` | create |

## Metode

- PRD (`WorkPulse_PRD_v0.1.docx`) dan Wireframe (`WorkPulse_Wireframe_Screen_by_Screen_v0.1.docx`) diekstrak ulang dari `word/document.xml` dengan `python -I` dan `zipfile` (script sementara di scratchpad, bukan di repo). Isi PRD §2, §3, §4, §5 dan S01–S14 dibaca penuh.
- Nama test diambil dari source dengan pencarian `it(`/`test(` di `tests/integration` (213), `tests/e2e` (82) dan daftar file `tests/unit` (103) serta `supabase/tests/database` (18). Setiap baris matriks menyebut nama test yang dibaca, bukan ringkasan dari ingatan.
- Tidak ada suite yang dijalankan ulang di Fase 1. Kolom "Run terakhir" membedakan suite yang dijalankan di baseline Fase 0 dari yang menunggu Fase 8.

## Hasil

| Bagian matriks | Tercakup | Sebagian | Gap |
| --- | --- | --- | --- |
| R01–R10 (11 baris; R01 punya dua acceptance condition) | 10 | 1 (R01 isolasi) | 0 |
| Skenario rilis PRD (6) | 5 | 1 (skenario 6, kepemilikan setiap tabel dan path) | 0 |
| Lintas subsistem (4) | 4 | 0 | 0 |
| PRD §4 (8 area) | 5 | 3 (Privacy, Usability, Deletion) | 0 |

Delapan defect P2 (D1–D8), tidak ada P0 atau P1, empat catatan P3 (O1–O4). Tidak ada kebocoran lintas akun, kehilangan data, atau rahasia terekspos yang ditemukan di fase ini, jadi stop condition P0 tidak terpicu.

| Defect | Ringkas | Fase |
| --- | --- | --- |
| D1 | Tidak ada penjaga katalog (RLS, guard, privilege `anon`, tabel `internal`, `search_path`, bucket) | 2 |
| D2 | Isolasi dua akun tidak sistematis (tabel, RPC ber-ID, storage, route, RPC worker) | 2 |
| D3 | Kontras token tidak diukur | 4 |
| D4 | Tidak ada matriks S01–S14 × 360/1440 × light/dark, teks 200%, snapshot aria | 4 |
| D5 | Tidak ada journey keyboard penuh dan focus indicator terukur | 4 |
| D6 | Tidak ada pemeriksaan bundle browser bebas rahasia server (tambahan; tidak ada di plan, lihat di bawah) | 4 |
| D7 | Kalimat pemberitahuan event S12 belum ada (disetujui §2.4.3) | 4 |
| D8 | Replay penghapusan setelah restore tidak diuji; tidak ada alert backlog | 2 dan 3 |

## Hal yang perlu keputusan reviewer

1. **D6 tidak ada di plan.** Acceptance §1 tidak memuat pemeriksaan bundle browser, padahal PRD §4 *Privacy* ("AI keys remain server side") dan definisi P0 §9 ("secret di browser") bergantung padanya. Usulan: satu test di `release-a11y.spec.ts` (config `playwright.release.config.ts` sudah melakukan `next build`) yang memindai `.next/static` untuk pola `sb_secret_`, JWT service role lokal, dan nama variabel rahasia server (`SUPABASE_SECRET_KEY`, `WORKPULSE_AI_*`, `WORKPULSE_OPENAI_*`). Tidak menambah file di luar §4. Mohon konfirmasi.
2. **Penyesuaian angka dari merge main (P-1 di receipt Fase 0).** Migration T25 menjadi 36/36, clean rebuild mengharapkan 36 migration dan 20 file pgTAP.
3. **Batas matriks E2E.** Auth lokal membatasi 30 sign-in per 5 menit per IP (T23 F9). Desain Fase 4: satu akun per spec, satu sign-in per spec (`storageState`), tidak sign-in per layar. Perlu dipertahankan agar matriks 14 layar × 4 kombinasi tidak flaky.
4. **Skenario 2 dan 3 berstatus "tercakup (rangkaian)".** Tidak ada satu test UI yang memulai dari onboarding sampai PDF (skenario 2) atau dari AI unavailable → edit → retry → stale dalam satu alur (skenario 3). Plan §1.2 menerima "rangkaian test bernama"; saya tidak menulis test tambahan kecuali reviewer meminta.

## Acceptance Fase 1

- Matriks R01–R10, skenario, dan PRD §4: ditulis, setiap baris menyebut test nyata atau ditandai gap dengan defect.
- Daftar defect dan fase tujuan: ada.
- P3 lama dinilai ulang: G1 tertutup oleh merge `origin/main`; G5 dan retensi backup menjadi blocker B1 dan B2; G7 tetap P3.
- Stop condition §8: tidak ada yang terpicu.

## Blocker dan catatan

- Menunggu checkpoint reviewer sebelum Fase 2 (plan §5 Fase 1: "Checkpoint Claude sebelum Fase 2").
- Blocker rilis (bukan defect kode): B1 staging, B2 retensi backup dan replay restore, B3 otorisasi deploy/domain/SMTP.

## Langkah berikutnya

Setelah checkpoint: Fase 2 (`release_catalog.test.sql`, `release-ownership.test.ts`, `release-restore.test.ts`, script `test:integration:release`), TDD, dengan bukti bahwa setiap penjaga dapat gagal.
