# 0008 Private Storage restrictive policy

Status: accepted for T05 review remediation.
Date: 17 September 2026.

## Context

The T05 foundation migration removed policies that mentioned `workpulse-private`, but it could
leave a generic permissive policy on `storage.objects` in place. PostgreSQL combines permissive
policies with OR, so a broad policy such as `USING (true)` could expose WorkPulse object rows and
let a browser token request its own signed URL with an expiry longer than the server limit.

The provider-owned Storage grants cannot be treated as revoked by the WorkPulse migration role.
R01 and R07 require private, owner-authorized files. Database Schema §4 and §6 require private
storage and server-side authorization for Storage operations.

## Decision

1. Add a forward-only migration instead of changing the already-applied T05 migration.
2. Install the stable policy `workpulse_private_server_only` on `storage.objects` as
   `AS RESTRICTIVE FOR ALL TO anon, authenticated`.
3. Use `bucket_id <> 'workpulse-private'` in both `USING` and `WITH CHECK`. Restrictive policies
   are ANDed with applicable permissive policies, so generic policies cannot grant browser access
   to a WorkPulse row or write one into the WorkPulse bucket.
4. Limit the restriction to the WorkPulse bucket. Do not remove or rewrite generic policies that
   may serve other buckets; their own policies continue to govern those buckets.
5. Keep server Storage operations on the service credential. The server must still authorize the
   current owner before signing or deleting and enforce an integer signed URL lifetime of 1–300
   seconds. The policy does not replace these domain checks.

## Consequences and boundaries

The restrictive predicate covers browser roles `anon` and `authenticated` and all row commands.
The `service_role` path is unchanged; service credentials remain server-only, and service code
continues to enforce owner and TTL rules because privileged Storage access bypasses browser RLS.

Provider-owned ACLs on `storage.objects` remain unchanged. The database regression test verifies
that both browser roles remain denied even when generic permissive policies are present, while an
unrelated fixture bucket continues to follow those policies. The Storage integration continues to
verify the owner-authorized attachment URL, direct signing rejection for 3,600 seconds by both
accounts, and actual URL expiry. These are local test guarantees; they do not claim hosted Storage,
real malware screening, quota reservation, or production deployment.

Related task and gate: T05 Private storage foundation and Gate M1. This decision does not start T06
or change the source PRD, User Flow, Wireframe, Database Schema, or Design.md.
