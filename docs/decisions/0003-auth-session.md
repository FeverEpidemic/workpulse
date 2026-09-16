# Decision 0003 — Auth, session, and profile boundary

Date: 16 September 2026

Status: accepted for WorkPulse MVP v0.1

## Context

T03 implements R01/F01 and screens S01/S12 on top of the T02 profile lifecycle and
revision-checked foundation RPCs. Auth state is available during provisional
onboarding, so profile existence alone cannot mean the workspace is ready. Email
confirmation and password recovery also need a trusted callback origin and a local
way to verify actual email delivery without claiming production SMTP readiness.

## Decisions

1. Each Server Component or Server Action creates a fresh cookie-bound Supabase SSR
   client. `src/proxy.ts` refreshes cookies and performs only an optimistic redirect
   for protected document requests. Server-side user checks, RLS, and mutation RPCs
   remain the authorization boundary; Server Actions return an in-place session error
   so a draft is not lost.
2. The profile lifecycle is authoritative after authentication. Anonymous users go to
   sign-in, provisional profiles go through the manual onboarding choice, and completed
   profiles go to an allowlisted internal destination. Return paths reject absolute,
   protocol-relative, malformed, callback, and unsupported routes. A locale cookie is
   only the pre-login/provisional fallback; a saved profile locale takes precedence.
3. Auth email redirects use the trusted server setting `WORKPULSE_SITE_URL`; they are
   never built from the request `Host` header. Local configuration explicitly permits
   the 127.0.0.1 and localhost confirmation routes. Confirmation consumes the
   verification token or PKCE code and redirects without retaining the credential in
   the URL. Sign-out revokes the current local session and clears its browser cookies.
4. Signup requires only email and password. A verified first-time user chooses import
   or manual entry; import remains unavailable until T17. Manual onboarding requires
   only a real display name. Locale (`en`/`id`) and IANA timezone are optional choices
   with `en` and `UTC` fallbacks. Database onboarding writes name, locale, timezone,
   completion timestamp, and one revision increment atomically under the authenticated
   owner and expected revision.
5. Recovery always returns the same success message for registered and unregistered
   addresses. Password changes require a valid Supabase user session and recent,
   verified recovery proof. Local `verifyOtp(type=recovery)` records JWT
   `amr.method = otp`; that proof is accepted only after the server successfully
   verifies an explicit `type=recovery` callback and sets the short-lived HttpOnly
   recovery-flow cookie. A cookie alone is not proof. A PKCE callback without an
   explicit type requires a recent `amr.method = recovery` claim. Local email
   templates deliver `token_hash` to the app's confirmation route; production delivery
   remains an SMTP/domain setup item. Supabase documents the `amr` JWT claim in its
   [JWT claims reference](https://supabase.com/docs/guides/auth/jwt-fields).
6. Profile and foundation mutations use a discriminated, localized action result.
   Zod validates server input; the database remains authoritative for ownership and
   revision checks. Existing foundation edits/deletes use the T02 RPCs. Experience
   deletion reports the linked project count and uses the established context-clearing
   RPC rather than deleting projects. Partial dates use the T02 canonical date/precision
   representation; unknown dates remain `(NULL, NULL)`.
7. Draft recovery uses `sessionStorage` for non-password fields only. An expired
   session returns an actionable sign-in prompt without automatically redirecting a
   mutation. A stale save keeps the draft and offers explicit reload or review-and-retry.
8. A typed Supabase database contract is generated from the migrated local schema and
   compared against the checked-in file; the output matches after line-ending
   normalization. A clean `db:reset` was run on disposable project
   `workpulse-t03-disposable-20260916`; all five migrations and seed fixtures applied,
   then 117 pgTAP assertions and DB lint passed. The disposable stack and volumes were
   removed, while the original WorkPulse volume was preserved and restarted.

## Scope boundary

This decision covers email/password auth, confirmation/recovery, lifecycle routing,
profile settings, locale selection, onboarding, and profile foundation editors only.
It does not add OAuth, magic-link sign-in, MFA, project editing, AI, import success,
account deletion, public profiles, or production email delivery. The final app frame
and design system remain T04.

## Consequences

- A user may authenticate before completing onboarding, but cannot enter the dashboard
  until the profile lifecycle is complete.
- Confirmation and recovery work locally through Supabase Auth and Mailpit. Hosted
  SMTP configuration and redirect allowlisting must be completed separately before
  production email can be claimed.
- Generated database type parity, migration application and clean reset, seed fixture
  checks, all 117 pgTAP assertions, DB lint, and Mailpit Playwright acceptance pass
  locally with email confirmation enabled. T03 local acceptance is DONE; production
  SMTP remains a separate integration item.
