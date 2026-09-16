# 0005 — Design system and application frame

- Status: accepted
- Date: 16 September 2026
- Scope: T04, R01, F01, S04, S05, S06, S07, S09, S10, S11, and S12

## Context

T04 needs a shared visual foundation and authenticated workspace shell while T05–T25 are
still pending. Dashboard and Profile already have T03 server guards and action contracts;
new destinations must not imply that their business features or data persistence exist.

## Decisions

1. Keep the existing canonical URLs and move Dashboard/Profile into a Next.js route group.
   The shared frame renders only for a session with a completed profile. Protected pages
   still check the server session and onboarding state; proxy redirects remain an early
   navigation check rather than the authorization boundary.
2. Keep Lucide as the single icon family selected in decision 0001. Pin `lucide-react`
   to 1.46.0. Use the browser's native `<dialog>` for the mobile drawer and named
   confirmation dialogs; it supplies modal semantics, Escape handling, and focus return
   without a second dialog dependency.
3. Pin `@axe-core/playwright` to 4.12.1 for route scans. Automated scans are an additional
   check; keyboard and focus flows remain explicit Playwright assertions and manual review.
4. Keep Design.md's sage and dark token palette. Add a separate
   `--color-border-control` token for form-control and secondary-button boundaries; the
   existing decorative border tokens do not reach the 3:1 non-text contrast target at
   their actual control use. Unit tests measure text pairs at 4.5:1 and control/focus
   boundaries at 3:1 in both themes.
5. Store explicit light/dark theme choice in the `wp-theme` same-site cookie. An absent
   or invalid cookie means `system`; a small root-head script resolves `prefers-color-scheme`
   before the workspace paints. Choosing either theme replaces `system` with that explicit
   choice. No profile field or database migration is added.
6. Activity placeholder filters are only `from`, `to`, and `project`. They use GET and
   canonical `/activity` URLs, omit empty values, validate calendar dates, and ignore
   other query parameters as filter state. Quick log focuses its note field after one
   navigation action; the note stays in component memory, and saving remains unavailable
   until the activity persistence task.
7. Achievement, Project, Timeline, and CV destinations render an unavailable state with
   no sample records or fake success action. No schema, worker, storage, or business-domain
   behavior is introduced in T04.

## Consequences

- T03 field names, server actions, ownership checks, revisions, conflict recovery, and
  profile draft storage remain the data contract. The delete flow adds a named review
  dialog but still submits the same revision-checked server action.
- System theme choice follows the operating-system setting on each new page load until
  the user picks light or dark. The cookie can be read by the server and never contains
  account data.
- Placeholder screens are intentionally short-lived. Their links and labels establish
  navigation only; later feature tasks replace their unavailable states.
- Verification lives in `docs/verification/T04-design-system-app-frame.md`.
