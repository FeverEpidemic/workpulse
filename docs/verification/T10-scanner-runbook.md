# T10 local scanner and worker runbook

This runbook covers R07/F05 backend verification. It does not deploy hosted staging or production.
Use the pinned Node/pnpm/Supabase versions from package.json and the existing local stack.
Never print service credentials or persist real attachment content in logs.

## Real scanner

Start the official image on loopback only, without mounting user files:

```powershell
docker run -d --name workpulse-t10-clamav --publish 127.0.0.1:13310:3310 --memory 4g clamav/clamav@sha256:0e31ce089574268aefa0b543767d66b70240ab51ed49eec53e07f18d5629d817
docker exec workpulse-t10-clamav clamdscan --version
```

For a container that already exists, inspect its health rather than creating a duplicate.
Allow startup/signature initialization to finish. Keep FreshClam running and monitor its status.
clamd TCP has no authentication/encryption; staging must restrict it to a trusted private network.
The worker transmits bounded file bytes through INSTREAM, not local paths or filenames.

Set these server/worker variables in the local environment (not in browser configuration):

```dotenv
WORKPULSE_SCANNER_MODE=clamav
WORKPULSE_CLAMD_HOST=127.0.0.1
WORKPULSE_CLAMD_PORT=13310
WORKPULSE_CLAMD_TIMEOUT_MS=15000
```

Also supply SUPABASE_URL and SUPABASE_SECRET_KEY from the existing local configuration.
Do not put credentials into commands, this document, test output, or Notion.

Run `pnpm worker:run` in a separate process, or `pnpm worker:once` for one bounded sweep.
Both load `.env.local`. The worker defaults to a five-second polling interval; configure
`WORKPULSE_WORKER_POLL_INTERVAL_MS` if needed. A failed sweep must remain visible to the
process supervisor while durable jobs retain retry/lease state in PostgreSQL.

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --configLoader native tests/integration/evidence-scanner-real.test.ts
```

The test uses clean bytes and the harmless standard EICAR antivirus-test signature in memory.
It requires actual clamd responses and never substitutes fake-clean. Scanner unavailable or a
malformed response must never transition a file to ready.

## Failure recovery and acceptance

- Failed upload: start a new reservation; do not reuse a failed reservation for different bytes.
- Transient scanning: keep evidence unavailable and retry through persisted queue attempts.
- Stale lease: let a new worker claim; old attempt tokens cannot complete a job.
- Cleanup: retry persisted jobs and verify object absence; parent/account deletion must not
  remove the only cleanup receipt. Review backlog/oldest age against the 24-hour target.
- Expiry: abandoned uploading reservations release capacity after 15 minutes; orphan scanning
  must use an age grace and exclude active evidence. Recovery cannot rely on a web request staying alive.

Hosted staging acceptance must repeat owner isolation, clean/infected/unavailable outcomes,
worker restart/lease recovery, quota races, and cleanup with the deployed worker/scanner/storage.
Record scanner engine/signature age, network isolation, worker supervisor/restart configuration,
and observed cleanup timing. Local fixtures do not prove staging operations or production retention.

## Stop local verification scanner

```powershell
docker stop workpulse-t10-clamav
docker rm -v workpulse-t10-clamav
```

These commands target only the named T10 container and its anonymous volume. They do not stop
the existing WorkPulse Supabase stack. The pinned image may be retained for subsequent tests.
