# T34 — WorkPulse sebagai remote MCP server (desain)

Tanggal: 6 November 2026
Status: draft desain, menunggu review product owner
Pendekatan: A (OAuth 2.1 server bawaan Supabase Auth + endpoint MCP di Next.js)
Nomor task dan decision bersifat sementara: T34, decision 0044.

## 1. Tujuan

User WorkPulse bisa menambahkan WorkPulse sebagai connector di claude.ai dan ChatGPT, login dengan akun WorkPulse, memberi izin, lalu:

- meminta AI mencatat pekerjaan dari percakapan sebagai Activity, atau sebagai draft Achievement;
- meminta AI membaca data kariernya (Activity, Achievement, Project, Experience, Education, Skill, metadata evidence) untuk membantu menulis, merangkum, atau mencocokkan dengan lowongan.

### Kriteria sukses

1. Akun pilot di staging berhasil menyambungkan claude.ai dan ChatGPT lewat OAuth tanpa langkah manual selain login dan consent.
2. Dari chat, AI bisa membuat Activity dan draft Achievement yang muncul di app dengan tanda sumbernya.
3. AI bisa membaca data karier yang diizinkan.
4. Token yang diberikan ke client tidak bisa membaca CV, kontak profil, isi file evidence, atau data akun lain, baik lewat endpoint MCP maupun langsung ke API Supabase.
5. Memutuskan aplikasi di S12 menghentikan akses pada request berikutnya.

### Di luar cakupan

- Edit, hapus, atau confirm record lewat MCP.
- Apa pun yang menyentuh CV, termasuk export.
- Upload atau download isi evidence.
- Memicu analisis AI internal (detection/refinement) dari MCP.
- Pencarian full-text, MCP resources, MCP prompts.
- Client lokal berbasis stdio, dan personal access token.

## 2. Keputusan dari interview

| Topik | Keputusan |
|---|---|
| Arah | WorkPulse menjadi MCP server |
| Kegunaan | Baca dan tulis |
| Batas tulis | Activity dan draft Achievement. Confirm hanya di app (prinsip T14) |
| Client rilis pertama | claude.ai dan ChatGPT: remote MCP, OAuth 2.1, dynamic client registration |
| Scope | `career:read` (wajib), `career:write` (opsional) |
| Data yang boleh dibaca | Activity, Achievement (draft dan confirmed), Project, Experience, Education, Skill, metadata evidence |
| Data yang tidak boleh dibaca | Isi CV dan wording, kontak profil (email, telepon, lokasi, link), isi file evidence |
| Rollout | Di balik flag. Staging dan akun pilot dulu, production setelah blocker T25 selesai |

## 3. Arsitektur

```
claude.ai / ChatGPT
   │  1. POST /api/mcp tanpa token → 401 + WWW-Authenticate (resource_metadata)
   │  2. GET /.well-known/oauth-protected-resource → authorization server = Supabase Auth
   │  3. DCR + authorization code + PKCE ke Supabase Auth
   │        └─ Supabase redirect ke /oauth/consent?authorization_id=… (halaman WorkPulse)
   │  4. Access token (JWT Supabase, claim client_id) + refresh token
   ▼
Next.js  /api/mcp  (Streamable HTTP, stateless, SDK MCP TypeScript resmi)
   │  validasi JWT → panggil RPC public.mcp_* dengan token user
   ▼
PostgreSQL
   - public.mcp_* (security definer): cek grant, scope, akses pilot, rate limit,
     lalu baca atau tulis lewat fungsi internal yang sudah ada
   - db-pre-request PostgREST: token ber-client_id hanya boleh memanggil /rpc/mcp_*
   - policy restrictive di storage.objects: token ber-client_id ditolak
```

### 3.1 Prinsip penegakan: database yang menentukan

Access token dari OAuth server Supabase adalah JWT Supabase biasa untuk user tersebut, ditambah claim `client_id`. Client pihak ketiga yang memegang token itu bisa saja memanggil PostgREST atau Storage Supabase secara langsung, tanpa lewat `/api/mcp`. Karena itu batas scope tidak boleh hanya ditegakkan di endpoint MCP:

1. **Hook `db-pre-request` PostgREST** (`internal.reject_oauth_outside_mcp()`). Kalau `auth.jwt() ? 'client_id'` dan `request.path` bukan `/rpc/mcp_…`, request ditolak dengan `42501`. Akibatnya, token OAuth tidak bisa membaca tabel apa pun secara langsung dan tidak bisa memanggil RPC app biasa (`create_activity_idempotent`, `get_cv_freshness`, dan lainnya).
2. **Policy restrictive di `storage.objects`** untuk semua operasi: `using (not internal.is_oauth_token())`. Token OAuth tidak bisa membuat signed URL atau mengunduh objek.
3. **Realtime:** publikasi `supabase_realtime` harus tetap kosong. Ditegaskan oleh pgTAP.
4. **RPC `public.mcp_*`** adalah satu-satunya pintu. Masing-masing memanggil `internal.require_mcp_call(p_tool_class)` sebelum melakukan apa pun (lihat §5.3).

Endpoint `/api/mcp` tetap memvalidasi token dan memetakan error. Namun kalau endpoint itu salah atau dilewati, database tetap menolak.

Token sesi web biasa tidak punya `client_id`, jadi dua kebalikannya juga berlaku: token web tidak bisa memanggil `mcp_*` (ditolak `require_mcp_call`), dan endpoint `/api/mcp` menolaknya dengan `401`.

## 4. Tool MCP

Aturan umum:

- Nama field output di bawah adalah kontrak MCP. Pemetaannya ke kolom tabel yang sudah ada ditulis di handoff plan; kalau nama kolom berbeda, kontrak ini yang dipertahankan.
- Output berupa JSON dari serializer allowlist. Tidak ada dump baris tabel.
- List memakai keyset pagination: `cursor` opaque, maksimal 30 item per halaman, `next_cursor` bernilai `null` di halaman terakhir.
- Tanggal ditulis `YYYY-MM-DD` dan waktu ditulis ISO 8601 UTC.
- Setiap record yang dikembalikan membawa `app_url` (URL absolut ke halaman record di app) supaya model bisa mengarahkan user ke app untuk mengedit atau mengonfirmasi.
- Deskripsi tool ditulis dalam bahasa Inggris, karena model client memilih tool dari deskripsi itu. Tiap deskripsi tool tulis menyebut bahwa hasilnya draft dan user mengonfirmasinya di WorkPulse.

### 4.1 Semua scope

| Tool | Input | Output |
|---|---|---|
| `whoami` | — | `display_name`, `scopes`, `ui_language` (`en`/`id`). Tanpa email |

### 4.2 `career:read`

| Tool | Input | Output per item |
|---|---|---|
| `list_activities` | `from?`, `to?`, `project_id?`, `experience_id?`, `cursor?` | `id`, `occurred_on`, `text`, `role`, `scope`, `outcome`, `project_id`, `experience_id`, `source`, `app_url` |
| `get_activity` | `id` | field list ditambah `achievement_ids`, `created_at`, `updated_at` |
| `list_achievements` | `status?` (`draft`/`confirmed`), `project_id?`, `experience_id?`, `cursor?` | `id`, `title`, `status`, `achieved_on`, `outcome`, `skills`, `source`, `app_url` |
| `get_achievement` | `id` | field list ditambah `contribution`, `scope`, `metrics`, `cv_bullet`, `activity_id`, `project_id`, `experience_id` |
| `list_career_context` | — | `experiences[]` (`id`, `organization`, `title`, `start`, `end`), `education[]` (`id`, `institution`, `program`, `start`, `end`), `projects[]` (`id`, `name`, `status`, `start`, `end`, `experience_id`). Maksimal 200 per jenis; kalau lebih, `truncated: true` |
| `list_skills` | — | `id`, `name`, `confirmed_achievement_count` |
| `list_evidence` | `parent_type` (`activity`/`achievement`/`project`), `parent_id` | `id`, `file_name`, `mime_type`, `size_bytes`, `scan_status`, `created_at`. Tanpa URL |

`source` bernilai `{ "kind": "app" }` atau `{ "kind": "mcp", "client_name": "…", "client_host": "…" }`.

`cv_bullet` dikembalikan karena merupakan field milik Achievement, bukan wording CV. Override wording di `cv_items` tidak pernah dikembalikan.

### 4.3 `career:write`

| Tool | Input | Perilaku |
|---|---|---|
| `create_activity` | `text` (1–10.000), `occurred_on`, `role?`, `scope?`, `outcome?` (≤ 5.000), `project_id?`, `experience_id?`, `request_id?` | `mcp_create_activity` → `internal.create_activity` dengan `capture_mode = 'mcp'`. Mengembalikan Activity seperti `get_activity` |
| `create_draft_achievement` | salah satu dari `activity_id`, `project_id`, `experience_id`; `title` (1–200), `contribution?`, `scope?`, `outcome?` (≤ 5.000), `achieved_on?`, `skills?` (≤ 20 nama) | `mcp_create_draft_achievement`: membuat dan mengisi Achievement dalam satu transaksi, status selalu `draft`. Tidak ada parameter status. Mengembalikan Achievement seperti `get_achievement` |

Batas panjang mengikuti constraint tabel yang sudah ada dan divalidasi di dua tempat: skema input tool (supaya error cepat) dan database (sebagai otoritas).

**Idempotensi.** `operation_key = uuid_v5(NS, client_id || ':' || request_id)`, dengan `NS` berupa konstanta UUID tetap yang ditulis sekali di kode Fase 2 dan tidak pernah diubah, kalau `request_id` dikirim (string 1–128). Tanpa `request_id`, server membuat key acak. Deskripsi tool menyarankan model mengirim `request_id`.

**Kepemilikan konteks.** `project_id`, `experience_id`, dan `activity_id` harus milik user. Id milik akun lain dijawab `NOT_FOUND`, sama persis dengan id acak (pola T25).

## 5. Data dan database

### 5.1 Tabel baru

`public.mcp_grants`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid | fk profil, `on delete cascade` |
| `client_id` | text | dari claim `client_id` |
| `client_name` | text | disalin dari registrasi client saat consent, ≤ 120 karakter, karakter kontrol dibuang |
| `client_host` | text | host redirect URI yang di-approve |
| `scopes` | text[] | subset `{career:read, career:write}`, selalu berisi `career:read` |
| `created_at`, `updated_at` | timestamptz | |
| `last_used_at` | timestamptz | di-update paling sering sekali per 5 menit |
| `revoked_at` | timestamptz null | |

- Unique `(user_id, client_id)`. Connect ulang memperbarui baris yang sama dan mengosongkan `revoked_at`.
- RLS: user hanya bisa select miliknya sendiri. Tidak ada grant tulis untuk API role; semua perubahan lewat RPC.
- Kena trigger guard `ACCOUNT_DELETING` dan masuk urutan purge T23.

`internal.mcp_access`: `user_id` pk, `enabled_at`, `enabled_by`. Ini daftar akun pilot yang boleh memakai MCP. Tabel ini sengaja terpisah dari `internal.pilot_participants` (T24), karena enroll metrik dan akses fitur adalah dua persetujuan yang berbeda.

`internal.mcp_usage`: penghitung rate limit per `(grant_id, window_kind, window_start)` dan per `(user_id, 'write_day', window_start)`, mengikuti pola `internal.ai_usage` (decision 0032).

### 5.2 Kolom baru

- `activities.capture_mode`: constraint diperluas menjadi `('note', 'form', 'chat', 'mcp')`.
- `activities.source_grant_id` dan `achievements.source_grant_id`: uuid null, fk ke `mcp_grants`, `on delete set null`. Nilainya diisi hanya oleh `mcp_*`.
- Product events T24: properti enum baru `source` (`app`/`mcp`) di event simpan activity dan event pembuatan achievement.

### 5.3 Fungsi

| Fungsi | Akses | Isi |
|---|---|---|
| `internal.is_oauth_token()` | internal | `coalesce(auth.jwt() ? 'client_id', false)` |
| `internal.reject_oauth_outside_mcp()` | hook `db-pre-request` | lihat §3.1 |
| `internal.require_mcp_call(p_tool_class text)` | internal | Memastikan token punya `client_id`, profil tidak `deleting`, user ada di `mcp_access`, grant aktif, dan scope cocok dengan kelas (`identity`/`read`/`write`). Lalu menagih rate limit dan menyentuh `last_used_at`. Mengembalikan baris grant. Error: `MCP_NO_GRANT`, `MCP_OUT_OF_SCOPE`, `MCP_RATE_LIMITED` (dengan detik retry di `detail`) |
| `public.mcp_whoami`, `mcp_list_activities`, `mcp_get_activity`, `mcp_list_achievements`, `mcp_get_achievement`, `mcp_list_career_context`, `mcp_list_skills`, `mcp_list_evidence`, `mcp_create_activity`, `mcp_create_draft_achievement` | `authenticated`, security definer, `search_path = pg_catalog` | memanggil `require_mcp_call` terlebih dahulu, lalu fungsi internal yang sudah ada. Mengembalikan `jsonb` sesuai §4 |
| `public.approve_mcp_grant(p_client_id, p_client_name, p_client_host, p_scopes)` | `authenticated`, **hanya token tanpa `client_id`** | dipanggil oleh server consent memakai sesi web user. Menolak akun non-pilot dan host di luar allowlist |
| `public.revoke_mcp_grant(p_grant_id)` | `authenticated`, hanya token tanpa `client_id` | mengisi `revoked_at` |
| `public.set_mcp_access(p_user_id, p_enabled)` | service role | operator meng-enroll akun pilot |
| `begin_account_deletion` (diubah) | — | mengisi `revoked_at` di semua grant milik akun dalam transaksi yang sama |

`internal.mcp_settings` adalah satu baris berisi allowlist host redirect dan tiga batas rate limit (§7.1). Nilai default ditulis di migration, dan operator mengubahnya lewat service-role RPC `set_mcp_settings`. Database adalah satu-satunya sumber, supaya consent, `approve_mcp_grant`, dan `require_mcp_call` selalu memakai nilai yang sama di semua instance web.

## 6. OAuth dan consent

### 6.1 Konfigurasi

- `[auth.oauth_server] enabled = true`, `allow_dynamic_registration = true`, `authorization_url_path = "/oauth/consent"`, hanya di environment dengan flag menyala. Lokal mengikuti flag test.
- `GET /.well-known/oauth-protected-resource` mengembalikan `resource` (URL `/api/mcp`), `authorization_servers` (issuer Supabase Auth), `scopes_supported` (`career:read`, `career:write`), dan `bearer_methods_supported: ["header"]`.
- Respons `401` dari `/api/mcp`: `WWW-Authenticate: Bearer resource_metadata="<url>"`.

### 6.2 Alur halaman `/oauth/consent`

1. Belum login → ke halaman login dengan `next` kembali ke URL consent.
2. Server mengambil detail otorisasi dari Supabase (`authorization_id`): nama client, redirect URI, dan scope yang diminta.
3. Pemeriksaan berurutan, masing-masing dengan layar penjelasan:
   1. flag mati → 404;
   2. onboarding belum selesai → minta diselesaikan dulu;
   3. akun tidak ada di `mcp_access` → belum tersedia;
   4. host redirect di luar allowlist → ditolak.
4. Form berisi dua pilihan. Baca selalu tercentang dan tidak bisa diubah; tulis default tidak tercentang.
5. **Izinkan** → `approve_mcp_grant`, lalu approve otorisasi di Supabase, lalu redirect ke client. Kalau approve di Supabase gagal setelah grant tertulis, grant tetap ada tetapi tidak berguna tanpa token; user melihat pesan gagal dan bisa mencoba lagi (idempoten).
6. **Tolak** → deny otorisasi di Supabase, lalu redirect ke client dengan error `access_denied`.

Kalau client tidak meminta `career:write`, pilihan tulis tidak ditampilkan.

### 6.3 Pencabutan

- `revoke_mcp_grant` langsung memutus akses, karena `require_mcp_call` memeriksa grant di setiap panggilan.
- Server juga mencabut otorisasi atau refresh token di Supabase untuk pasangan user dan client. Mekanismenya diverifikasi di Fase 0. Kalau API-nya tidak ada, refresh token tetap bisa menghasilkan access token baru, tetapi setiap panggilan ditolak `MCP_NO_GRANT`; ini dicatat sebagai keterbatasan.

## 7. Endpoint `/api/mcp`

- Route handler Next.js dengan transport Streamable HTTP dari `@modelcontextprotocol/sdk`, mode stateless (tanpa session id, tanpa SSE jangka panjang). Versi SDK di-pin exact.
- Langkah per request:
  1. flag mati → 404;
  2. ambil bearer token; kalau tidak ada → 401;
  3. validasi JWT lewat JWKS Supabase (signature, `exp`, `iss`, `aud` sesuai temuan Fase 0);
  4. tanpa claim `client_id` → 401;
  5. buat client Supabase dengan token itu;
  6. jalankan handler MCP. `tools/list` memanggil `mcp_whoami` untuk tahu scope, lalu hanya mencantumkan tool yang diizinkan.
- Pemetaan error database ke hasil tool:

| Asal | Hasil |
|---|---|
| `MCP_NO_GRANT`, `ACCOUNT_DELETING`, JWT tidak valid | HTTP `401` + `WWW-Authenticate` |
| `MCP_OUT_OF_SCOPE` | tool error `OUT_OF_SCOPE` |
| record tidak ada atau milik akun lain | tool error `NOT_FOUND` |
| validasi skema atau constraint | tool error `INVALID_INPUT` dengan `field` dan `limit` |
| `MCP_RATE_LIMITED` | tool error `RATE_LIMITED` dengan `retry_after_seconds` |
| lainnya | tool error `UNAVAILABLE` tanpa detail internal |

Pesan tool error ditulis untuk model, dalam bahasa Inggris, satu kalimat. Contohnya untuk `OUT_OF_SCOPE`: "This connection can read WorkPulse data but cannot add to it. Ask the user to disconnect WorkPulse and connect again with permission to add activities."

### 7.1 Rate limit (angka awal)

| Batas | Default | Kolom `internal.mcp_settings` |
|---|---|---|
| Baca per grant | 120 panggilan per menit | `read_per_minute` |
| Tulis per grant | 30 per jam | `write_per_hour` |
| Tulis per akun | 100 per hari | `write_per_day` |

Angka ini tebakan awal tanpa data pemakaian dan disetel ulang selama pilot lewat `set_mcp_settings`. Client tidak pernah bisa mengirim nilai batas.

### 7.2 Log

- Satu baris per panggilan: nama tool, kode hasil, durasi, `client_id`, jumlah item.
- Tidak pernah ditulis ke log: argumen, isi hasil, token, header `Authorization`.
- `get_operational_health()` mendapat hitungan `mcp_rate_limited_last_hour`, dengan ambang `WORKPULSE_ALERT_MCP_RATE_LIMITED`.

## 8. UI di app

Semua copy dalam en dan id lewat sistem i18n yang sudah ada. Pola kartu dan dialog mengikuti S12.

### 8.1 Kartu S12 "Aplikasi terhubung" / "Connected apps"

Muncul hanya kalau flag menyala dan akun ada di `mcp_access`.

| Elemen | id | en |
|---|---|---|
| Judul | Aplikasi terhubung | Connected apps |
| Kosong | Belum ada aplikasi yang terhubung. Untuk menghubungkan Claude atau ChatGPT, tambahkan connector dengan alamat ini: | No apps are connected. To connect Claude or ChatGPT, add a connector with this address: |
| Tombol salin | Salin | Copy |
| Setelah salin (live region) | Alamat disalin | Address copied |
| Izin baca | Bisa membaca | Can read |
| Izin baca dan tulis | Bisa membaca dan menambah draft | Can read and add drafts |
| Terakhir dipakai | Terakhir dipakai {date} | Last used {date} |
| Belum dipakai | Belum pernah dipakai | Not used yet |
| Tombol | Putuskan | Disconnect |

Satu baris per grant aktif berisi nama client, `client_host`, izin, dan waktu terakhir dipakai. Grant yang dicabut tidak ditampilkan.

Dialog putuskan:

| Elemen | id | en |
|---|---|---|
| Judul | Putuskan {name}? | Disconnect {name}? |
| Isi | {name} tidak bisa lagi membaca atau menambah data di WorkPulse. Activity dan draft yang sudah dibuatnya tetap ada. | {name} will no longer be able to read or add data in WorkPulse. Activities and drafts it already created stay. |
| Tombol | Putuskan · Batal | Disconnect · Cancel |
| Sukses (live region) | {name} diputuskan | {name} disconnected |

### 8.2 Tanda sumber

- List Activity dan Achievement: teks kecil di sebelah tanggal, "Dari {name}" / "From {name}".
- Halaman detail: "Dari {name} · {host}" / "From {name} · {host}".
- `source_grant_id` null pada record ber-`capture_mode = 'mcp'` (grant sudah dihapus karena purge): "Dari aplikasi terhubung" / "From a connected app".
- `{name}` dirender sebagai teks biasa, tidak pernah sebagai HTML atau link.

### 8.3 Halaman consent

| Elemen | id | en |
|---|---|---|
| Judul | {name} ingin terhubung ke WorkPulse | {name} wants to connect to WorkPulse |
| Baris host | Akan kembali ke {host} | Returns to {host} |
| Pilihan baca | Membaca activity, achievement, project, pengalaman, pendidikan, skill, dan daftar file lampiran | Read activities, achievements, projects, experience, education, skills and the list of attached files |
| Pilihan tulis | Menambah activity dan draft achievement. Anda tetap yang mengonfirmasi achievement di WorkPulse. | Add activities and draft achievements. You still confirm achievements in WorkPulse. |
| Yang tidak dibagikan | Tidak dibagikan: CV, kontak di profil, dan isi file lampiran. | Not shared: your CV, the contact details in your profile, and the contents of attached files. |
| Catatan data | Data yang dibaca {name} dikirim ke penyedia {name} dan diatur oleh kebijakan mereka. | Data that {name} reads is sent to the company behind {name} and handled under its policies. |
| Tombol | Izinkan · Tolak | Allow · Deny |
| Belum onboarding | Selesaikan pengisian profil dulu sebelum menghubungkan aplikasi. | Finish setting up your profile before connecting an app. |
| Non-pilot | Menghubungkan aplikasi belum tersedia untuk akun Anda. | Connecting apps isn't available for your account yet. |
| Host ditolak | WorkPulse belum mendukung aplikasi yang kembali ke {host}. | WorkPulse doesn't support apps that return to {host} yet. |
| Gagal | Izin tidak tersimpan. Coba lagi. | Permission wasn't saved. Try again. |

Draft copy final ini masih harus lolos review copy (antislop-copywriting dan Delivery Gate) di Fase 3.

## 9. Flag dan rollout

- `WORKPULSE_MCP_ENABLED` (default `false`). Kalau mati:
  - `/api/mcp`, `/.well-known/oauth-protected-resource`, dan `/oauth/consent` mengembalikan 404;
  - kartu S12 disembunyikan;
  - label sumber pada record yang sudah dibuat lewat MCP tetap tampil, karena itu bagian dari data;
  - `[auth.oauth_server]` dibiarkan mati di environment tersebut.
- Staging: flag menyala, allowlist berisi `claude.ai` dan `chatgpt.com` ditambah host yang ditemukan di Fase 0, diisi lewat `set_mcp_settings`.
- Production: tidak dinyalakan sebelum blocker T25 selesai dan pilot staging dinilai.

## 10. Fase

| Fase | Isi | Selesai kalau |
|---|---|---|
| 0. Spike (dibuang) | Nyalakan OAuth server dan DCR di staging; endpoint minimal dengan `whoami`; consent seadanya | Pertanyaan §10.1 terjawab dan dicatat di `docs/verification/T34-phase0-spike.md`. Kode tidak di-merge. Connect dari client asli dikerjakan product owner (§14.2). Kalau claude.ai atau ChatGPT gagal sampai `whoami`, eksekutor berhenti dan melapor; product owner yang memutuskan pindah ke pendekatan B (OAuth server sendiri) |
| 1. Skema | §5 seluruhnya, hook pre-request, policy storage | pgTAP hijau, guard release T25 hijau |
| 2. Endpoint | §7, sepuluh tool | unit dan integrasi hijau |
| 3. Consent dan S12 | §6.2, §8 | e2e hijau, review copy lolos |
| 4. Staging | flag menyala di staging, akun pilot menyambung dari claude.ai dan ChatGPT (dikerjakan product owner, §14.2) | smoke manual dengan screenshot tercatat, lalu gate review |

### 10.1 Pertanyaan yang dijawab Fase 0

1. claude.ai dan ChatGPT berhasil DCR, login, consent, dan memanggil `whoami` lewat staging.
2. Isi claim access token: `client_id`, `aud`, `role`, dan apakah `auth.uid()` bekerja di PostgREST.
3. Token OAuth memang diterima langsung oleh PostgREST dan Storage (alasan §3.1), dan hook `db-pre-request` bisa diaktifkan di hosted Supabase.
4. API untuk mencabut otorisasi atau refresh token per client.
5. Cara mengambil detail otorisasi dan approve/deny dari server Next.js.
6. Redirect URI yang dipakai tiap client, untuk mengisi allowlist.
7. Apakah scope custom (`career:read`, `career:write`) diteruskan oleh Supabase dan muncul di halaman consent. Kalau tidak, scope ditentukan sepenuhnya di form consent kita dan `scopes_supported` tetap diumumkan untuk client.

## 11. Testing

| Suite | Isi |
|---|---|
| Unit (`pnpm test`) | skema input tiap tool; turunan `operation_key`; pemetaan error; filter `tools/list` per scope; serializer allowlist (field CV, wording, dan kontak tidak pernah lolos meskipun ada di input) |
| pgTAP (`pnpm db:test`) | RLS `mcp_grants`; setiap fungsi `public.mcp_*` memanggil `require_mcp_call` (dibaca dari katalog); `approve_mcp_grant`/`revoke_mcp_grant` menolak token ber-`client_id`; `mcp_create_draft_achievement` selalu `draft` dan atomik; guard `ACCOUNT_DELETING` di tabel baru; rate limit; pencabutan saat `begin_account_deletion`; publikasi realtime kosong |
| Integrasi (`pnpm test:integration:mcp`, baru) | Supabase lokal dengan client MCP SDK lewat HTTP. Token OAuth disimulasikan dengan JWT berclaim `client_id` yang dimint test. Skenario: dua akun dengan id akun lain dijawab sama dengan id acak; grant baca saja; token web ditolak; token OAuth ditolak langsung di PostgREST (`select` tabel, RPC app biasa) dan Storage; pencabutan berlaku pada request berikutnya; akun `deleting` dan purge; retry `request_id`; kegagalan di tengah draft tanpa sisa; rate limit; flag mati; kebersihan log dengan sentinel; product event `source = mcp` |
| E2E (`pnpm test:e2e:mcp`, baru) | consent: login dulu, pilihan tulis opsional, host ditolak, non-pilot, belum onboarding, Tolak; kartu S12: kosong, salin, putuskan dengan keyboard; label sumber di list dan detail; 360/1440 px, light/dark, Axe; masuk matriks `test:e2e:release` |
| Manual (Fase 4) | claude.ai dan ChatGPT asli di staging: connect, baca, tulis, putuskan, connect ulang dengan scope berbeda |

### 11.1 Yang tidak bisa dibuktikan lokal

- Perilaku claude.ai dan ChatGPT yang sebenarnya.
- Pencabutan refresh token di Supabase hosted.
- Angka rate limit yang tepat.

Ketiganya dicatat apa adanya di dokumen verifikasi T34.

## 12. Risiko

| Risiko | Mitigasi |
|---|---|
| OAuth server Supabase masih baru dan perilakunya berubah | Fase 0 sebelum kode produk; versi CLI di-pin; jalur pindah ke pendekatan B |
| Token pihak ketiga dipakai langsung ke API Supabase | §3.1: hook pre-request, policy storage, `mcp_*` sebagai satu-satunya pintu; dites di integrasi |
| Client palsu meniru nama Claude lewat DCR | Host redirect ditampilkan dan di-allowlist selama pilot |
| Data karier dikirim ke penyedia AI pihak ketiga | Consent menyebutnya secara eksplisit; scope baca tidak mencakup CV, kontak, dan isi file |
| Model membuat activity berulang | `request_id` idempoten; rate limit tulis |
| Hook pre-request memperlambat semua request | Fungsinya hanya membaca claim dan path; diukur dengan `pnpm test:perf` sebelum dan sesudah |

## 13. Dokumen lanjutan

- Handoff plan `docs/verification/T34-implementation-plan.md`, ditulis setelah spec ini disetujui.
- Decision 0044, entri `IMPLEMENTATION_STATUS`, dan README ditulis saat closeout.

## 14. Eksekusi

### 14.1 Peran

| Peran | Siapa | Tugas |
|---|---|---|
| Eksekutor | Claude Sonnet 5.5, single agent | Mengerjakan fase 0–4 satu per satu sesuai handoff plan dan menulis receipt per fase |
| Gate reviewer | Claude Opus | Review read-only setelah Fase 3 dan setelah Fase 4, menjalankan ulang check, memberi temuan P0–P3 dan verdict |
| Product owner | user | Mengerjakan langkah yang memerlukan akunnya sendiri (§14.2) dan menyetujui perubahan di staging |

Hanya gate reviewer yang menulis status resmi dan menandai T34 DONE.

### 14.2 Langkah yang tidak bisa dikerjakan eksekutor

Eksekutor tidak boleh login ke akun pihak ketiga milik user dan tidak boleh mengubah project hosted tanpa persetujuan. Jadi langkah berikut ditulis di handoff sebagai instruksi untuk product owner, dan eksekutor berhenti sampai product owner melaporkan hasilnya:

1. Menambahkan connector WorkPulse di claude.ai dan ChatGPT, login, consent, lalu meminta `whoami` dan tool lain (Fase 0 dan Fase 4).
2. Menyalakan OAuth server, DCR, dan hook `db-pre-request` di Supabase staging, kalau perubahan itu tidak bisa dilakukan lewat migration yang di-review.
3. Meng-enroll akun pilot staging dengan `set_mcp_access` dan mengisi allowlist dengan `set_mcp_settings`.

### 14.3 Aturan untuk eksekutor

Handoff plan menuliskan aturan ini secara eksplisit, tanpa mengandalkan memori sesi lain:

- Antislop memakai mode `during` (session override), jadi eksekutor tidak perlu bertanya lagi soal mode.
- Quirk lingkungan lokal ditulis di dalam handoff: sumber secret key, pin image Supabase worktree (`42P10`), jebakan pipeline PowerShell, dan `.env.ai.local`.
- Kode spike Fase 0 dikerjakan di branch terpisah dan tidak pernah di-merge.
- Tanpa push, PR, atau menandai DONE.
- **Kondisi berhenti** (lapor ke product owner, jangan improvisasi):
  - Fase 0 gagal di salah satu dari §10.1 nomor 1, 3, atau 5. Pindah ke pendekatan B diputuskan product owner, bukan eksekutor.
  - Implementasi menuntut pelonggaran §3.1, misalnya token OAuth harus boleh memanggil RPC app biasa.
  - Ada check yang masih gagal setelah dua kali perbaikan.
  - Perlu perubahan di project hosted yang tidak tercantum di handoff.
  - Perlu menambah dependency di luar SDK MCP resmi.
