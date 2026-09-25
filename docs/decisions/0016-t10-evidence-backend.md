# 0016 — T10 evidence reservation, quarantine, and screening

Date: 2026-09-25. Scope: R07, F05, Database §4/§6, T10.
Status: DONE under the user-authorized local-only acceptance boundary.

## Decisions

- Keep the T05 private bucket and restrictive server-only Storage policy. Evidence uploads
  pass through a bounded authenticated server endpoint; clients receive no upload credential.
  An object uses one random reservation key with `upsert: false`. A retry may only reuse
  the identical bytes/hash; it cannot replace bytes after screening.
- Keep the source schema's canonical evidence columns and exactly-one owned parent.
  Operational fields/RPC aliases are additive. Reserve account bytes and parent slots in
  PostgreSQL, never by UI counters. Uploading/scanning/ready consume quota; failed/deleting
  release logical quota while a durable receipt retains physical cleanup responsibility.
- Reservation is valid for 15 minutes. Require actual bytes to equal the declared reservation
  size; a changed file needs a new reservation. This prevents increasing reserved capacity
  after upload. Validate format, signature, MIME, and SHA-256 before finalize/enqueue.
- Quarantine is a domain state within private evidence storage, not a public location.
  Generic Storage signing/deletion rejects evidence keys. Only the evidence domain can issue
  download URLs, after ready/owner/parent/account checks. Download authorization linearizes at
  that check; already authorized in-flight URLs expire within 300 seconds. No active inline preview.
- Use ClamAV clamd INSTREAM over a trusted private connection as the first real MalwareScanner.
  No external analysis provider receives evidence. Unavailable/timeout never means clean.
  Fake clean is explicit development/test only and cannot satisfy scanner integration acceptance.
- Worker runs separately from web requests and reuses PostgreSQL durable queue conventions:
  120-second lease, fresh attempt token, guarded completion, persisted retries. Clean completion
  is bound to the same immutable object hash and current evidence/account state.
- Deletion/expiry persist object identity in a queue without account/parent foreign keys.
  Parent removal preserves cleanup responsibility before FK cascade. Object deletion must be
  verified before its job/retained metadata can be completed. Reconciliation handles late uploads
  and aged orphan objects; it must not delete an active valid reservation.
- T10 adds the minimal storage worker required now; it does not wait for T13's AI worker work.
  T11 still owns attachment UI and explicit move interactions.

## Scanner verification environment

Official image resolved for local testing:
`clamav/clamav@sha256:0e31ce089574268aefa0b543767d66b70240ab51ed49eec53e07f18d5629d817`.
Bind clamd only to loopback for local use, port 13310. The official image has signature databases;
record engine/database versions and health in verification. This local test container proves the
T10 local acceptance boundary, but is not evidence of hosted staging or production rollout.
On 26 September 2026 the user explicitly prohibited external services and accepted local-only
execution for T10; no external resources are required for DONE.

Reference: [official ClamAV Docker instructions](https://docs.clamav.net/manual/Installing/Docker.html).
