# T25 Fase 7b · Deploy staging ke server pribadi

- Tanggal: 17 Oktober 2026. Ditulis Claude (Opus 5.5); dijalankan operator di server.
- Status: **panduan, sudah dijalankan sekali** (17 Oktober 2026). Hasil tiap langkah dicatat di [receipt Fase 7](T25-phase7-staging.md); temuan S2/S3 dari run itu sudah masuk ke panduan ini.
- Prasyarat selesai: Fase 7a (migrasi hosted, bucket, URL Auth) serta SMTP MXroute dan dua template Auth.
- Acuan: [runbook rilis](T25-release-runbook.md) §2–§5, [scanner](T10-scanner-runbook.md), [renderer DOCX](T15-renderer-runbook.md), [renderer PDF](T21-pdf-renderer-runbook.md).

## 1. Topologi

```
browser → Cloudflare (proxied, myworkpulse.my.id)
        → reverse proxy di VPS (TLS)
        → tunnel ke server pribadi → web :3000
server pribadi (Debian, 4 vCPU, 12 GB, Docker):
  web ─────────────── egress → Supabase hosted
  worker ──────────── egress → Supabase hosted
     └── jaringan internal `scan` (tanpa internet) ── clamav :3310, gotenberg-docx :3000, gotenberg-pdf :3000
  clamav ──────────── egress hanya untuk FreshClam
```

Semua layanan didefinisikan di [`deploy/staging/compose.yaml`](../../deploy/staging/compose.yaml). Batas memori: ClamAV 4 GB, tiap Gotenberg 2 GB, web 1 GB, worker 1 GB; total 10 GB dari 12 GB.

Hanya web yang membuka port, dan hanya di alamat yang dijangkau reverse proxy VPS (`WEB_BIND`). ClamAV dan Gotenberg tidak membuka port sama sekali: clamd TCP tanpa autentikasi, jadi tidak boleh terjangkau dari luar host.

## 2. Image

CI membangun dan menguji kedua image di setiap run, tetapi baru mempublikasikannya ke GHCR untuk push ke `main` atau tag `v*`. Commit image CI (`8ecd632`) masih di branch `claude/cd-docker-images`, jadi GHCR belum berisi image WorkPulse. Pilih satu:

**A. Build di server (disarankan untuk staging pertama).** Tidak perlu login registry.

```bash
sudo mkdir -p /opt/workpulse && sudo chown "$USER" /opt/workpulse
git clone git@github.com:FeverEpidemic/workpulse.git /opt/workpulse/src
cd /opt/workpulse/src && git checkout claude/cd-docker-images
export WORKPULSE_TAG=$(git rev-parse --short=12 HEAD)
docker build --target web    -t workpulse-web:$WORKPULSE_TAG .
docker build --target worker -t workpulse-worker:$WORKPULSE_TAG .
```

Clone lewat SSH memerlukan deploy key read-only untuk repo ini di server (GitHub → repo Settings → Deploy keys, tanpa "Allow write access"). Jangan memakai SSH key akun pribadi di server.

**B. Tarik dari GHCR** setelah branch di-merge ke `main` dan job `images` hijau. Package GHCR privat secara default: `docker login ghcr.io` di server dengan token `read:packages` saja, lalu isi `WORKPULSE_IMAGE_PREFIX=ghcr.io/feverepidemic/workpulse` dan `WORKPULSE_TAG=sha-<commit penuh 40 karakter>`, misalnya `sha-1de73187792325e948fbd08215733540968a15c4`. Jangan memakai tag `main`: tag itu berpindah di setiap push, sehingga rollback di §7 tidak menunjuk image yang pasti.

Catat tag atau commit yang di-deploy di receipt.

## 3. File konfigurasi di server

Contoh di panduan ini memakai `/opt/workpulse/staging` sebagai direktori deploy. Server staging pertama memakai `/home/ilham827/workpulse` (lihat receipt). Bila direktorimu berbeda, ganti di semua perintah, termasuk baris cron di §6.

```bash
mkdir -p /opt/workpulse/staging && cd /opt/workpulse/staging
cp /opt/workpulse/src/deploy/staging/compose.yaml .
touch web.env worker.env && chmod 600 web.env worker.env
```

Buat juga `/opt/workpulse/staging/.env` (dibaca compose untuk substitusi, bukan secret):

```dotenv
WORKPULSE_TAG=<tag dari langkah 2>
# Alamat tunnel server pribadi yang dijangkau VPS, misalnya IP WireGuard/Tailscale. Jangan 0.0.0.0.
WEB_BIND=<ip-tunnel>
# Port host untuk web; default 3000. Container tetap mendengar di 3000.
# WEB_PORT=3000
# Hanya untuk opsi B:
# WORKPULSE_IMAGE_PREFIX=ghcr.io/feverepidemic/workpulse
```

`web.env`, hanya variabel web (runbook §2: web tidak menerima variabel AI, renderer, scanner, atau alert):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
WORKPULSE_SITE_URL=https://myworkpulse.my.id
```

`worker.env`. Mode scanner dan renderer beserta alamatnya sudah diisi di `compose.yaml`, jadi tidak diulang di sini:

```dotenv
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
WORKPULSE_WORKER_POLL_INTERVAL_MS=5000
WORKPULSE_CLAMD_TIMEOUT_MS=15000
WORKPULSE_DOCX_RENDER_TIMEOUT_MS=30000
WORKPULSE_PDF_RENDER_TIMEOUT_MS=60000
# AI: biarkan unavailable sampai pemilik produk memutuskan mode AI staging.
WORKPULSE_AI_MODE=unavailable
```

Ambil key dari dashboard Supabase (Project Settings → API Keys) langsung ke file di server. Jangan menempelnya di chat, receipt, atau commit. `NODE_ENV=production` dipasang compose; jangan menimpanya, karena mode `fake` hanya diterima di development atau test.

## 4. Urutan start: worker lalu web

```bash
cd /opt/workpulse/staging
docker compose up -d clamav gotenberg-docx gotenberg-pdf
docker compose ps        # tunggu clamav "healthy"; muat signature pertama bisa beberapa menit
docker compose up -d worker
docker compose exec -T worker node workers/check.ts
docker compose exec -T worker node workers/run.ts --once
docker compose up -d web
curl -fsS -D - http://<ip-tunnel>:<WEB_PORT, default 3000>/api/health
```

| Pemeriksaan | Lulus bila |
| --- | --- |
| `docker compose ps` | clamav `healthy`; gotenberg-docx, gotenberg-pdf, worker, web `running` |
| `workers/check.ts` | JSON `status: ready`, `service: workpulse-worker`, sembilan `registeredJobs`. Ini hanya bootstrap, tidak menghubungi dependensi |
| `workers/run.ts --once` | satu baris JSON hitungan, exit 0. Scanner dan renderer tidak boleh dilaporkan `unavailable`; AI memang `unavailable` |
| `/api/health` lokal | 200, `Cache-Control: no-store`, body `status: ok`, `service: workpulse-web`, tanpa header `X-Powered-By` |

Bila clamav tidak pernah `healthy`, periksa `docker compose logs clamav`; bila image ternyata tidak memuat `clamdcheck.sh`, ganti test healthcheck dengan `["CMD-SHELL", "echo PING | nc -w 2 127.0.0.1 3310 | grep -q PONG"]` dan catat di receipt.

## 5. Reverse proxy di VPS

Arahkan `myworkpulse.my.id` ke `http://<ip-tunnel>:<WEB_PORT>` (default 3000; contoh di bawah memakai 3000). Kebutuhan, apa pun proxy-nya:

- Teruskan header `Host` asli dan `X-Forwarded-For`/`X-Forwarded-Proto`. Server action dan route `/api/*` membandingkan `Origin` dengan `WORKPULSE_SITE_URL`, jadi domain publik harus sampai utuh.
- Batas body minimal 50 MB: upload evidence dan impor CV lewat web (`/api/evidence/[id]/upload`, `/api/imports`), dan bucket menerima sampai 50 MiB.
- Timeout baca minimal 120 detik.
- TLS di VPS dengan sertifikat valid, dan SSL Cloudflare **Full (strict)**.

Contoh nginx:

```nginx
server {
    listen 443 ssl;
    server_name myworkpulse.my.id;
    # ssl_certificate ... (origin cert Cloudflare atau Let's Encrypt)
    client_max_body_size 55m;
    location / {
        proxy_pass http://<ip-tunnel>:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
```

Contoh Caddy: `myworkpulse.my.id { request_body { max_size 55MB } reverse_proxy <ip-tunnel>:3000 }`.

Lalu dari luar: `curl -fsS -D - https://myworkpulse.my.id/api/health` harus memenuhi baris `/api/health` di tabel §4.

## 6. Cron ops:check

Di server, `crontab -e`:

```cron
WORKPULSE_DIR=/opt/workpulse/staging
*/5 * * * * { cd "$WORKPULSE_DIR" && docker compose exec -T worker node workers/ops-check.ts; echo "ops:check exit $? $(date -u +\%FT\%TZ)"; } >> "$HOME/workpulse-ops.log" 2>&1
```

Isi `WORKPULSE_DIR` dengan direktori deploy dari §3. Kurung kurawal membuat kegagalan `cd` ikut tercatat, dan log ditulis di `$HOME` supaya tetap bisa ditulis walaupun path deploy salah. Tanda `%` wajib di-escape di crontab.

Exit 0 normal, 2 ada alert, 1 pemeriksaan gagal berjalan (runbook §5). Baris `ops:check exit` di log mencatat kode itu di setiap run. Kanal alert belum ada; sampai operator memilihnya, log dicek manual. Saat kanal dipilih, tambahkan pengirimnya sebagai perintah nyata, bukan placeholder. Keluaran tidak memuat URL, key, atau teks pengguna.

Setelah 5 menit, `tail -n 5 ~/workpulse-ops.log` harus berisi JSON `ops:check` dan baris `ops:check exit <kode>`. Log kosong berarti cron tidak jalan sama sekali; periksa `grep CRON /var/log/syslog` atau `journalctl -u cron`.

## 7. Update dan rollback

- Update: build atau tarik tag baru, ubah `WORKPULSE_TAG` di `.env`, lalu `docker compose up -d worker` dan periksa §4, baru `docker compose up -d web`. Worker lama menerima SIGTERM dan diberi 150 detik untuk menyelesaikan pass.
- Rollback: kembalikan `WORKPULSE_TAG` ke tag sebelumnya dan ulangi urutan yang sama, dengan syarat migration sejak tag itu aditif (runbook §6). Image lama jangan dihapus sampai deploy baru terbukti.

## 8. Setelah deploy: smoke Fase 7

Jalankan dengan akun uji yang sudah ada di staging (lihat receipt, bagian lanjutan 16 Oktober):

1. Klik link konfirmasi dari email terbaru → `/auth/confirm` → masuk. Minta recovery lagi dan selesaikan sampai `/update-password`. Sign out.
2. Catat aktivitas, konfirmasi achievement, upload evidence PDF sampai `ready` (scanner nyata).
3. Impor CV DOCX sampai jumlah halaman terbaca (Gotenberg DOCX).
4. Export CV ke PDF, unduh, teks hasil ekstraksi cocok (Gotenberg PDF).
5. AI hanya bila pemilik produk mengizinkan.
6. Hapus akun lewat aplikasi sampai `completed`; `ops:check` exit 0; `auth.users` dan `profiles` nol.
7. Catat digest image, versi engine dan umur signature ClamAV, latensi render, dan hasil tiap langkah di receipt.
