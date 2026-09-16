# Decision 0004 — T03 draft isolation, conflict handling, and create replay

Date: 16 September 2026

Status: accepted for WorkPulse MVP v0.1

## Context

T03 remediation closes three gaps in the auth/profile workspace: browser drafts were
not owner-scoped, conflict recovery copied untrusted record fields into forms, and
foundation create retries could insert duplicates after an ambiguous response.
Profile identity is the authenticated Supabase user ID; a client-supplied owner is
never an authorization input.

## Decisions

1. Session drafts use versioned sessionStorage keys scoped by encoded owner ID and
   form key. Only named, enabled content controls are persisted. Passwords, files,
   buttons, hidden/server-controlled values, and record identity or revision fields
   are excluded. Legacy unscoped draft keys are removed. Sign-out clears only the
   current owner's versioned drafts; storage errors do not block sign-out.
2. Conflict resolution uses an explicit editable-field map for each form. Reload
   copies only those fields and the form's known partial-date fields, then assigns
   expected_revision through a separate positive-integer check. Experience kind is
   mapped to experience_kind; the hidden form discriminator and all ownership,
   identity, timestamp, and lifecycle fields remain protected. Retry preserves local
   inputs and advances only the expected revision before one resubmission.
3. Foundation creates use a client UUID stored per owner and create form in
   sessionStorage. The UUID survives validation, auth, and ambiguous request
   failures, and rotates only after an action reports success. The client sends no
   owner ID. Create input revision is 0 because there is no source row to revise.
4. A private internal.operation_requests ledger is unique on
   (user_id, operation_kind, operation_key) and stores a SHA-256 hash of canonical
   JSONB, plus the owned result type and ID. Typed authenticated RPCs derive ownership
   from auth.uid(), accept only each operation's exact field allowlist, and create
   the ledger entry and domain row in the same transaction. The internal ledger and
   helper are not callable by clients. INSERT ON CONFLICT DO NOTHING makes a
   competing identical request wait for the first transaction; after it commits, the
   replay returns the same owned row. Reusing the key with different input returns
   the stable IDEMPOTENCY_KEY_REUSED error and creates no second row.
5. Create actions map stable database conditions to localized action codes and never
   return raw database messages. Update and delete operations retain their existing
   revision-checked RPCs and owner-filtered conflict lookup.
6. database.types.ts has been updated to the applied RPC contract so static checks
   can run. It is not yet regenerated from local PostgreSQL; the Supabase CLI type
   dump cannot spawn Docker in the managed runner. Do not treat typecheck as evidence
   of generated-schema parity.

## Scope boundary

This decision is limited to T03 auth/profile drafts, conflict handling, and create
replay for experience, education, certification, and skill records. It does not
start T04, change source DOCX files, or add job queues, imports, evidence, or AI.

## Consequences

- Browser recovery is isolated by authenticated account, and sign-out removes that
  account's persisted form drafts.
- A stale editor can reload only recognized editable values or explicitly retry the
  user's local values against the latest revision.
- A local database replay is safe after a lost response and for competing identical
  requests. The local pgTAP suite and a two-session replay check provide database
  evidence; Auth/Mailpit browser acceptance and generated type parity remain separate
  verification gates before T03 can be marked DONE.
