# 0001 — T01 foundation stack: pinned versions and project layout

Date: 2026-09-14 (T01). Status: accepted.

## Context

T01 bootstraps a runnable repository. `IMPLEMENTATION_PLAN.md` §2 states that the
proposed stack is a baseline, not an installed dependency set, and that T01 must
"verify compatibility through official documentation, pin versions, then keep one
lockfile". The T01 brief supplied concrete candidate versions; every one of them was
checked against the npm registry before being written into `package.json`.

Verified present on the registry at the time of writing: `next@16.3.5`,
`react@19.3.0`, `react-dom@19.3.0`, `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`,
`eslint@9.39.1`, `eslint-config-next@16.3.5`, `vitest@5.0.0`, `@playwright/test@1.63.0`,
`typescript@7.0.2`, `typescript@6.0.3`, `supabase@2.117.0`, `pnpm@11.19.0`,
`@types/node@24.13.4`.

Two of the proposed pins did not survive verification.

## Decision 1 — TypeScript is pinned to 6.0.3, not 7.0.2

`eslint-config-next@16.3.5` depends on `typescript-eslint@^8.46.0`, whose peer range is
`typescript >=4.8.4 <6.1.0`. With `typescript@7.0.2` installed, `pnpm lint` fails
before linting anything:

```text
typescript-eslint does not support TS 7.0.
See https://github.com/typescript-eslint/typescript-eslint/issues/10940
Error: typescript-eslint does not support TS 7.0.  (exit code 2)
```

TypeScript 7 is the native (Go) port and does not expose the JavaScript compiler API
that `typescript-eslint` parses with. The upstream guidance is to run TypeScript 6 and 7
side by side, aliasing `typescript` to the TS 6 API package for API consumers and adding
a second alias for the TS 7 `tsc` binary
(<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>). In this project
that would mean two compiler installs plus an explicitly pathed `tsc` for `typecheck`
and the Next.js build.

The user chose the single-compiler option: **`typescript@6.0.3`**. It satisfies
`eslint-config-next@16.3.5` (its own release tests use `typescript@6.0.2`),
`typescript-eslint@8.70.0`, and `next@16.3.5`, and `pnpm typecheck` plus `pnpm lint`
both pass with it. This is a deliberate, recorded deviation from the brief's `7.0.2`.

Follow-up: revisit when `typescript-eslint` supports TS ≥ 7.1, or when the documented
side-by-side alias becomes the project's preferred setup.

## Decision 2 — ESLint stays on 9.39.1

`eslint@9.39.1` is marked deprecated on the registry ("no longer supported"). The user
asked for `eslint@10.10.0`, which is inside `eslint-config-next`'s peer range
(`>=9.0.0`). That combination was installed and verified, and it fails hard:

```text
ESLint: 10.10.0
TypeError: scopeManager.addGlobals is not a function
    at addDeclaredGlobals (.../eslint/lib/languages/js/source-code/source-code.js:221:15)
```

`eslint-config-next` pins its own parser wrapper around Next's bundled
`@babel/eslint-parser`, which still targets the ESLint 9 scope-manager API. ESLint 10
therefore cannot lint this configuration. The lockfile keeps **`eslint@9.39.1`**, which
passes `eslint . --max-warnings 0` with zero findings.

Open risk (carried in `IMPLEMENTATION_STATUS.md`): ESLint 9 is end-of-life upstream, so
this pin will need to move once `eslint-config-next` ships a parser that is compatible
with the ESLint 10 scope API, or once the config stops relying on the Next.js parser
(which would mean declaring `typescript-eslint` directly as a dependency).

## Decision 3 — single-package pnpm project, exact pins

- One package at the repository root; no workspace packages and no monorepo.
- `packageManager: pnpm@11.19.0` with `engines.node: ">=24.18.0 <25"`. The local Node
  is 24.18.0 (LTS). The runner is provided by Corepack shims.
- `.npmrc` sets `save-exact=true`, `resolution-mode=highest`, `auto-install-peers=false`
  and `strict-peer-dependencies=true`, so nothing installs as a floating range and no
  phantom dependency is satisfied by accident.
- pnpm 11 no longer reads settings from `package.json`'s `pnpm` field, so the one
  allow-list entry it requires lives in `pnpm-workspace.yaml` (`allowBuilds:
  unrs-resolver: true`). That file deliberately has no `packages` key, which is what
  keeps this a single-package project rather than a workspace. Without the entry,
  pnpm 11 exits non-zero with `ERR_PNPM_IGNORED_BUILDS`.
- `"type": "module"` is set on the package, so `vitest.config.ts`, `playwright.config.ts`
  and the worker entrypoint are all loaded as ESM without Node's
  `MODULE_TYPELESS_PACKAGE_JSON` reparse warning on stderr.

## Decision 4 — Next.js app shape

- `next.config.ts` enables `reactStrictMode` and disables `poweredByHeader`; nothing else
  is configured yet.
- Tailwind CSS v4 is wired through `@tailwindcss/postcss` and `@import "tailwindcss"`.
  Only the shared font family token is declared in T01; the muted sage palette, spacing
  scale and light/dark themes are T04 work (`Design.md`).
- `next build` owns `tsconfig.json`'s JSX setting: it rewrote `jsx` to `react-jsx`, set
  `allowJs: true` and added `.next/dev/types/**/*.ts` to `include`. That file is
  committed exactly as Next.js wrote it. `vitest.config.ts` additionally pins the
  automatic React runtime for its own transform, so the unit suite does not depend on
  how Next.js writes tsconfig.
- No component library is installed yet. Radix packages (and any other primitive) get
  added selectively when a concrete component needs them, and Lucide is the single icon
  family. The shadcn generator is deliberately not run.

## Decision 5 — service contracts

- `GET /api/health` is a liveness probe only: a static JSON body
  (`{"status":"ok","service":"workpulse-web","version":"0.1.0"}`), `Cache-Control:
  no-store`, HTTP 200. It never probes the database, storage or AI dependencies and
  never echoes configuration, so it is safe to expose and cannot leak secrets.
  `dynamic = "force-dynamic"` keeps it from being prerendered. The service version is
  asserted against `package.json` in the unit suite so the two cannot drift.
- `pnpm worker:check` prints one JSON line
  (`{"status":"ready","service":"workpulse-worker","registeredJobs":[]}`) and exits 0.
  It proves only that a worker process starts. The durable queue, leases, attempt tokens
  and job handlers remain T13 scope; `registeredJobs` stays empty until then.

## Decision 6 — Supabase local development

- `supabase init` was run with the pinned CLI (`supabase@2.117.0`, also declared as a
  devDependency so `pnpm db:*` scripts use that exact binary rather than whatever is on
  the PATH) and generated `supabase/config.toml` plus `supabase/.gitignore`.
- `pnpm db:start` / `db:status` / `db:stop` wrap `supabase start|status|stop`. No script
  passes `--no-backup`, so stopping the stack never deletes data volumes.
- Local development uses the CLI stack only. No hosted project and no production
  credential is used, and `.env.example` documents the variable names with empty values.
- The new-style publishable/secret keys are documented
  (`sb_publishable_...` / `sb_secret_...`); the legacy anon and service-role keys are
  not used.
