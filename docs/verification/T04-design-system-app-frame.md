# T04 — Design system and application frame

- Date: 16 September 2026
- Status: DONE
- Dependencies: T01 Bootstrap, T02 Schema and tenant boundary, T03 Auth and profile — DONE
- Scope: design tokens, shared UI states, authenticated workspace frame, theme, route
  placeholders, Quick log entry, URL filter contract, responsive/accessibility checks

## Implemented

- Semantic muted-sage light and dark tokens, a distinct control-boundary token, typography,
  spacing, shape, elevation, focus, touch target, status, and reduced-motion rules.
- `data-theme` is resolved from the `wp-theme` cookie or system preference in the root
  bootstrap before the workspace paints. The toggle writes an explicit light/dark cookie;
  the default remains system until the user chooses.
- A route-group workspace layout protects the existing Dashboard/Profile URLs and only
  renders the frame for completed profiles. Provisional onboarding continues without the
  workspace frame.
- Desktop navigation and mobile drawer expose Dashboard, Activity, Achievements, Projects,
  Timeline, CV, Profile/settings, sign out, theme choice, and Quick log.
- `/activity` uses GET filters `from`, `to`, and `project`; valid values round-trip through
  the URL and browser history. Unknown query parameters are not interpreted as filter state.
- `/activity/new` focuses the work-note input after navigation. Saving is unavailable until
  the activity persistence work is implemented. Achievement, Project, Timeline, and CV
  routes use honest unavailable states without sample data or fake success actions.
- Shared primitives now cover buttons and fields, cards, badges, tooltips, native dialogs,
  toast/live feedback, skeletons, empty/error/unavailable states, unsaved navigation,
  named delete confirmation, and revision conflicts.
- Navigation, theme, Activity, Quick log, placeholder, and shared-state copy/accessibility
  labels are present in both English (`en`) and Bahasa Indonesia (`id`).
- Profile form/action contracts remain on the T03 server validation, ownership, revision,
  operation-key, and session-draft paths.

## Decisions and files

Decision record: [0005 — Design system and application frame](../decisions/0005-design-system-application-frame.md).
There are no T04 database migrations or schema changes. `lucide-react` is pinned at 1.46.0
and `@axe-core/playwright` 4.12.1 is pinned for browser accessibility scans. Native
`<dialog>` is used for modal behavior, so no additional dialog component dependency was added.

Primary file groups: `src/styles/tokens.css`; `src/app/globals.css` and root layout;
`src/app/(workspace)/`; `src/components/layout/`; `src/components/ui/`;
T03 profile/auth/form adaptations under `src/features/` and `src/components/forms/`;
`src/domain/theme/theme-preference.ts`; `src/domain/routes/url-filters.ts`;
`src/server/supabase/server.ts`; `src/i18n/messages.ts`; `tests/unit/` theme, filter,
and draft tests; `tests/e2e/app-frame.spec.ts`; `tests/e2e/auth-profile.spec.ts`;
Playwright UI configuration and the package manifest/lockfile; README and implementation
status.

## Acceptance evidence

- Six canonical primary destinations and their active states are asserted in Playwright.
- Explicit light/dark selection persists after reload. An absent cookie follows system
  preference. The test exercises both settings against the production server started by the
  UI Playwright config.
- URL filters survive reload and back/forward navigation; empty values are omitted, invalid
  dates are rejected, and unknown query keys do not populate controls.
- Quick log reaches `/activity/new` in one click, focuses the note input, and presents a
  disabled save action. No content is reported as saved.
- The unsaved-change flow can stay or continue, restores focus on cancel, and preserves the
  T03 session draft. Mobile drawer Escape closes it and returns focus to the menu button.
- Dashboard, Activity, Quick log, and Profile were checked at 360 px and 1440 px in light
  and dark themes with `scrollWidth <= clientWidth`. Dashboard desktop/mobile theme captures
  and the mobile drawer capture were visually inspected.
- The reduced-motion emulation yields a nonessential navigation transition duration of
  zero. Keyboard checks cover skip-link entry, main-content focus, navigation drawer, and
  Quick log.
- Axe scans on Dashboard, Activity, and Profile reported zero serious or critical issues.
  Token contrast unit assertions cover text at 4.5:1 and control/focus boundaries at 3:1
  for both themes.
- The full Auth/Profile regression passed with local Supabase and Mailpit, including
  confirmation, onboarding, recovery, two-account draft isolation, revision conflicts,
  partial dates, foundation CRUD, named delete, and sign out.

## Commands run

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed, zero warnings |
| `pnpm typecheck -- --incremental false` | Passed |
| `pnpm test` | Passed, 13 files / 51 tests |
| `pnpm build` | Passed, production build generated |
| `pnpm test:e2e` | Passed, 2 smoke tests |
| `pnpm test:e2e:auth` | Passed, 1 full Auth/Profile test on local Supabase/Mailpit |
| `pnpm test:e2e:ui` | Passed, 1 authenticated app-frame test; Axe serious/critical: 0 |

No hosted Supabase project, production SMTP, or production deployment was used.

## Not run and next step

Database reset/test/lint/type-generation commands were not run for T04 because the task
adds no database migration, schema, or generated database types. Hosted email delivery and
deployment checks are not T04 acceptance. There is no T04 blocker.

Next task: T05 Private storage foundation. Gate M1 remains open until the T05 acceptance
criteria are complete.
