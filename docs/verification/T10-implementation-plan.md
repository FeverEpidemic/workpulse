# T10 — Evidence reservation dan screening backend

Tanggal: 25 September 2026. Status eksekusi: IN_PROGRESS.
Dependensi: T05 dan T09 DONE menurut checkpoint lokal dan pemeriksaan kode.
Acuan: PRD R07/file safety, F05, Database §4/§6, IMPLEMENTATION_PLAN §1/§3/§4/T10.

## Pembagian pelaksana

Target orchestrator yang diminta pengguna: Astra Medium (`gpt-6-astra`, `medium`).
Coder/explorer yang dipanggil eksplisit: Luna Max (`gpt-6-luna`, `max`).
Model task utama tidak diubah melalui tool; konfigurasi target tidak menjadi klaim perubahan runtime.
Tiga coder memiliki batas file: SQL/pgTAP; server upload/validation/routes; scanner/worker.
Orchestrator mengintegrasikan kontrak, shared files, acceptance, dan checkpoint.

## Paket kerja dan acceptance

1. **T10.1 Kontrak:** server-only upload, immutable object key, lifecycle
   uploading → scanning → ready; failure/expiry → failed; deletion → deleting.
   Retry upload gagal menggunakan reservasi baru. Worker retry tercatat terpisah.
2. **T10.2 Database:** evidence_files dengan ownership, satu parent, RLS, revision,
   idempotency; lock profile/parent untuk 3 slot per parent dan 50 MiB per account.
   uploading/scanning/ready dihitung. Ukuran >0 sampai 10 MiB; reservasi 15 menit.
3. **T10.3 Server:** identitas dari session, bounded request body, reserve sebelum upload,
   validasi actual bytes/signature/MIME/hash, object tanpa overwrite, atomic finalize + enqueue.
4. **T10.4 Worker/scanner:** ClamAV nyata, timeout dan fail-closed; claim atomik,
   lease 120 detik, attempt token, recheck account/state/hash, stale completion ditolak.
5. **T10.5 Expiry/cleanup:** quota release atomik, orphan reconciliation, delete receipt
   tanpa FK parent/account, verifikasi object hilang sebelum completion; parent deletion
   menutup akses dan mempertahankan receipt sebelum FK/source hilang.
6. **T10.6 Download:** hanya ready milik akun aktif, parent valid, attachment URL ≤300 detik.
   Jalur storage generik tidak boleh melewati evidence authorization.
7. **T10.7 Gate:** unit, integration PostgreSQL/Storage dua akun, quota races,
   finalize/expiry/deletion races, scanner clean/test-malware/outage, restart/lease recovery,
   pgTAP, DB lint, migration parity, disposable rebuild, regresi parent deletion,
   lint, typecheck, build, worker check. Dokumentasikan hasil aktual dan batas staging.

## Batas perubahan

Migration forward-only; database aktif tidak di-reset. Rebuild hanya pada stack disposable.
Perubahan pengguna yang sudah ada dipertahankan. UI S06/S08/S10 dan move attachment adalah T11;
T10 hanya menyediakan kontrak backend dan pengamanan integrasi deletion yang sudah aktif.
Tidak ada AI evidence analysis, import, CV, PDF, ataupun deployment production.

## File target

- supabase/migrations/20260925100000_t10_evidence_backend.sql dan database tests.
- src/features/evidence/, src/app/api/evidence/, src/server/storage/.
- workers/, tests/unit/, tests/integration/, database.types.ts.
- package.json, .env.example, README.md; docs/decisions/ dan docs/verification/.

## Kondisi awal yang diverifikasi

Queue T05 hanya kind delete; claim/lease/token sudah ada. Scanner hanya unavailable/fake
development-test. Worker bootstrap belum menjalankan consumer. StorageAdapter belum upload
atau baca bytes. Generic signing baru memeriksa owner/key/provider metadata, belum ready state.
Docker lokal tersedia melalui akses host; belum ada scanner nyata yang terverifikasi saat mulai.
Notion tertinggal pada checkpoint T09 PARTIAL; sinkronisasi harus memakai status lokal T09 DONE.

Keputusan awal mensyaratkan scanner staging nyata untuk DONE. Pada 26 September 2026 pengguna
mengubah lingkup acceptance secara eksplisit menjadi lokal saja dan melarang layanan luar. Bukti
lokal tetap dibedakan dari production readiness; tidak ada klaim deployment atau retention hosted.

## Execution checkpoint — 26 September 2026

T10.1–T10.7 implemented; local results are recorded in
[verification](T10-evidence-backend.md). T10 is DONE under the user-authorized local-only
acceptance boundary. Three GPT-6 Luna Max coders produced partial changes before reaching
their usage limits; the main agent completed integration and verification. Astra Medium was the
requested orchestrator setting; this record does not claim the active task model was switched.
Four forward-only T10 migrations are applied locally; T11/T12 remain TODO.
