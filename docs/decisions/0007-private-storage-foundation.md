# 0007 Private storage foundation

Status: accepted for T05 implementation.
Date: 17 September 2026.

## Context

WorkPulse needs a private Storage boundary for R01 and R07 that can later serve evidence,
import, export, and account cleanup. The database source requires owner-scoped object keys,
short-lived downloads, and cleanup receipts that survive parent deletion. T05 must not create
the evidence workflow, import staging, an export renderer, or a malware vendor integration.

## Decisions

1. Use one private Supabase bucket named workpulse-private. Keep the same 50 MiB hard ceiling
   in local configuration and migration, with PDF, PNG, JPEG, and DOCX MIME allowlisting.
2. Canonical object keys contain exactly owner_uuid/category/object_uuid. Categories are
   limited to import, evidence, and export. UUIDs must be lowercase canonical text.
   The server creates object UUIDs; original filenames never enter the key.
3. Do not add a client grant or Storage policy for anon or authenticated. Supabase creates the
   Storage tables under supabase_storage_admin and gives the API roles platform-level table
   privileges; the WorkPulse migration role cannot revoke those owner grants. Keep row-level
   security enabled with no WorkPulse policy so user-token object operations remain denied.
   Grant trusted Storage access to the server-only service_role. Browser code never creates URLs.
4. Create one non-persistent Supabase admin client in a server-only module. Resolve request
   ownership from the existing server auth context. Before signing or deleting, compare the
   actor with the key owner and validate the provider metadata. Missing and foreign objects
   return the same safe error code. Download expiry must be an integer from 1 through 300 seconds
   and uses attachment disposition.
5. Keep cleanup receipts in internal.storage_jobs, without a foreign key to a profile or
   parent. Enqueue is idempotent; claim uses skip-locked ordering, a 120-second lease, and a new
   attempt token. Completion and failure require the current unexpired token. A failed receipt
   returns to queued only through explicit retry.
6. Define a malware scanner contract with clean, infected, unavailable, and failed outcomes.
   No configuration returns unavailable. A fake clean scanner can be selected only explicitly
   for development or tests and is rejected elsewhere. T05 does not claim real malware screening
   or mark domain files ready.

## Consequences

The provider-owned Storage ACL remains unchanged because the project migration role is not the
table owner; acceptance therefore checks the RLS boundary and exercises denied user-token
operations with a real object. On the local Storage API, an RLS-filtered remove may return without
an error while leaving the object unchanged; integration verification checks the stored metadata
after owner and foreign-user delete attempts. T10 and T15 must add reservation, actual-byte and
signature validation, quarantine lifecycle, and real screening before any file can become ready.
T21 must define its export size policy.
Workers can use the bounded queue transitions when a later task adds an object deletion consumer;
T05 does not add a polling daemon or worker registration. The signed URL is a short-lived bearer
credential, so the service must not log or serialize it anywhere except the authorized response.

The source requirements are PRD R01/R07 and Database Schema §4 and §6. Related task and gate:
T05 Private storage foundation and Gate M1. The design does not alter the source PRD, User Flow,
Wireframe, Database Schema, or Design.md.
