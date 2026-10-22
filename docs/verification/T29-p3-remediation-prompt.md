# Prompt eksekutor: remediation P3 T29

Untuk ChatGPT Sol 6.1, reasoning medium, sebagai agen coding di mesin pengguna. Salin blok di bawah apa adanya ke sesi baru. Plan lengkapnya: [`T29-p3-remediation-plan.md`](T29-p3-remediation-plan.md).

---

```text
Kamu adalah satu-satunya agen pelaksana untuk remediation P3 task T29 (masuk dengan Google) di repo WorkPulse.

Lokasi kerja
- Worktree: D:\Project\WorkPulse-t29
- Branch: claude/t29-p3-remediation (turunan origin/main 0910fd8). Jangan pindah branch, jangan bekerja di D:\Project\WorkPulse.
- Shell: Windows PowerShell 5.1.

Sumber kebenaran
Baca dulu sampai selesai, berurutan:
1. docs/verification/T29-p3-remediation-plan.md (plan ini mengikat; ikuti fase 0 sampai 4 persis)
2. AGENTS.md
3. Entry teratas docs/IMPLEMENTATION_STATUS.md (T29)
4. docs/decisions/0039-t29-google-oauth.md
5. docs/verification/T29-gate-review.md, bagian Temuan
Bila plan dan kode berbeda, catat perbedaannya di receipt dan ikuti stop conditions §7 plan. Jangan menebak.

Lingkup
Kerjakan hanya RV1, RV2, RV3, dan RV4 dari §1 plan. N4, N5, N7, dan N8 tidak dikerjakan. Jangan menambah migration, route API, RPC, dependency, provider lain, atau fitur di luar plan.

Cara kerja
- Fase berurutan: 0, 1, 2, 3, 4. Jangan melompat. Jangan membuat sub-agent.
- TDD per item: tulis test yang gagal, jalankan dan lihat gagal, implementasi minimal, jalankan sampai lulus, commit.
- Akhir setiap fase: tulis receipt docs/verification/T29-p3-phaseN-<slug>.md berisi tujuan, file berubah, command beserta exit code dan angka pass/fail aktual, acceptance yang terbukti, warning, blocker, langkah berikutnya. Jangan menulis angka yang tidak berasal dari command yang benar-benar kamu jalankan.
- Commit per langkah dengan pesan dari plan (format conventional commit, scope t29). Akhiri setiap pesan commit dengan baris kosong lalu: Co-Authored-By: ChatGPT Sol 6.1 <noreply@openai.com>
- Commit hanya file milikmu, berdasarkan path. Periksa git status sebelum commit.
- Jangan push, jangan buka PR, jangan merge. Pengguna yang memutuskan setelah gate review.
- Jangan menandai T29 atau remediation sebagai DONE, dan jangan menulis docs/IMPLEMENTATION_STATUS.md. Draft entry status masuk ke receipt Fase 4.
- Berhenti setelah Fase 4 dan laporkan. Gate review dilakukan Claude.

antislop
Gunakan antislop mode during untuk sesi ini. Sebelum Fase 2, baca .codex/skills/antislop/SKILL.md, .codex/skills/antislop-copywriting/SKILL.md, .codex/skills/antislop-ui/SKILL.md, dan .codex/skills/antislop-human/SKILL.md. Copy baru en dan id tanpa em dash, mengikuti nada key account.delete.* yang ada. Jalankan Delivery Gate antislop di receipt Fase 4.

Lingkungan lokal (penting, sudah menyebabkan kegagalan palsu sebelumnya)
- Stack Supabase lokal dipakai bersama sesi lain. Sebelum suite apa pun, pastikan provider Google lokal aktif (GET http://127.0.0.1:54321/auth/v1/settings dengan header apikey = NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, external.google harus true) dan image Storage public.ecr.aws/supabase/storage-api:v1.80.2. Bila tidak, berhenti dan tanya pengguna; jangan me-restart stack tanpa persetujuan. Langkah restart yang aman ada di §7 plan.
- Jangan pernah menjalankan pnpm db:reset atau supabase db reset.
- .env.local tidak memuat SUPABASE_SECRET_KEY. Untuk integration dan E2E, set SUPABASE_SECRET_KEY di environment proses dari nilai SERVICE_ROLE_KEY pada output `pnpm exec supabase status -o env`, dan muat variabel .env.local ke proses yang sama. Jangan mencetak atau menyimpan nilai kunci ke file, log, receipt, atau chat.
- Bila environment-mu punya variabel yang namanya mengandung AI, OPENAI, atau ANTHROPIC, kosongkan untuk proses test. Jangan melemahkan assertion yang menolaknya.
- Jangan memotong output suite dengan Select-Object -First. Tangkap dengan Out-String lalu filter.
- Untuk file berisi karakter non-ASCII (§, ≤, →, emoji), jangan pakai Get-Content -Raw lalu Set-Content: itu merusak karakter. Pakai alat edit file, atau [IO.File]::ReadAllText dan WriteAllText dengan UTF-8 tanpa BOM.
- test:e2e:release dan test:e2e:account-deletion menulis ulang screenshot tracked di docs/verification/T23-screenshots, T25-screenshots, dan T27-screenshots. Kembalikan dengan git checkout setelah run.
- Auth lokal membatasi 30 sign-in per 5 menit per IP. Pakai ulang session yang sudah ada di spec; jangan menambah sign-in di loop.
- Suite E2E memakai port 3000, 3015, 3016, dan 3017. Bila port terpakai proses lain, berhenti dan tanya.

Keamanan dan data
- Identitas pengguna selalu dari session server. Notice RV2 hanya boleh menampilkan email session saat ini, bukan nilai dari cookie atau query.
- Jangan mencatat email, token, code, cookie, atau URL provider ke log.
- Jangan menyentuh Google Cloud Console, dashboard Supabase hosted, server staging, atau credential apa pun. Bila ada langkah yang butuh itu, berhenti dan tanya.

Laporan akhir (setelah Fase 4)
Dalam Bahasa Indonesia, ringkas:
1. Hasil per RV1 sampai RV4 dengan acceptance §2 yang terbukti.
2. Tabel command, exit code, dan angka.
3. Daftar commit (hash dan pesan).
4. Penyimpangan dari plan beserta alasannya.
5. Yang tidak dijalankan beserta alasannya, dan blocker bila ada.
Jangan menyatakan selesai atau DONE; tulis "siap gate review".
```
