# AGENTS.md — Minion Hub

Provider-neutral contributor instructions for the Hub. `CLAUDE.md` includes this file.

## What This Is

**Minion Hub** is a SvelteKit web dashboard for managing and monitoring AI agent gateways. It connects to one or more remote "gateway" servers (via WebSocket) and provides a UI to view agents, sessions, chat history, reliability metrics, and a visual "workshop" canvas for agent interaction.

## Git Workflow

Read the Hub row in the meta-repo's canonical `repo-policy.yaml` before creating a feature checkout or PR. From that checkout, `node scripts/repo-policy.mjs show hub` prints the development/release branches, PR base and package manager. Follow that PR base; historical branch-flow notes are not authority.

Use an isolated feature checkout and scope commits to your files. Preserve other agents' changes, and do not switch existing branches, alter worktrees or use stash without explicit authorization. Never commit directly to a default or release branch. Nontrivial merges and production releases require the owner's approval after concrete review and qualification.

## Commands

```bash
bun run dev          # Start dev server
bun run build        # Production build
bun run check        # Type-check (svelte-check + tsc)
bun run test         # Run all tests (vitest)
bun run test:watch   # Vitest in watch mode

# Run a single test file
bunx vitest run src/lib/utils/format.test.ts

# Local QA and migration inspection
bun run qa:status   # Inspect the existing local stack
bun run dev:local   # Start the guarded loopback QA development workflow
bun run db:status   # Inspect migration state for the resolved target
bun run db:migrate  # Apply migrations only to an explicitly qualified target
```

### Required validation

Qualify the exact candidate; an old green result is not evidence for the current tree:

- `bun run check` → **0 errors, 0 warnings**
- `bun run test` → **all tests pass** (0 failures)
- `bun run build` → succeeds cleanly (the only output is harmless "modules failed to locate dependencies" notices for optional native peers: `bufferutil`, `utf-8-validate`, `@react-email/render`, `supports-color`, `@neon-rs/load` — do not chase these)

There is **no longer a tolerated baseline of pre-existing errors/warnings**. Any check error, test failure, or Svelte compiler warning you see is a regression — fix it before considering work done. Notes:

- SvelteKit `$env/*` virtual modules don't resolve under vitest; they're aliased to stubs in `vitest.config.ts` → `src/server/test-utils/env-stubs/`. Per-test `vi.mock('$env/...')` still overrides.
- `let foo = $state(prop.field ?? default)` (seeding editable form state once from a prop) is correct — suppress `state_referenced_locally` with `// svelte-ignore`, do NOT convert to `$derived` (that wipes user edits). Convert to `$derived` only for pure read-through props.
- Cache-key `d` descriptors for `keys.hub()` must be `Record<string, string|number>` — use `scopeData()` from `src/server/services/base.ts` to drop optional/undefined filters.

## Local Setup

Install with `bun install --frozen-lockfile`. Use the guarded loopback QA workflow in `docs/qa-stack.md`: it supplies Supabase Auth, PostgreSQL schema/fixtures and the legacy SQLite compatibility database. A SQLite file alone cannot run the current Hub. Inspect `bun run qa:status` before starting or resetting a stack another checkout may share.

`bun run dev` uses the resolved environment directly; it is not a local-data safety boundary. Keep production credentials out of QA, and never run schema push or seed commands copied from obsolete instructions. Only scripts declared in `package.json` are runnable entrypoints. B2 configuration is needed for the external blob-storage adapter; local fixtures use the QA transport.

## Testing against the local QA stack

Don't test UI features or database interactions against production. `bun run qa:up` gives you a
private, time-boxed, containerized copy of the Hub instead — real Supabase auth (GoTrue), real
Postgres on the production schema (restored from a committed snapshot, then brought current by
`scripts/db-migrate.ts` — the same runner Vercel's production build uses), every module
pre-seeded with deliberately awkward fixture data. Full design: `docs/qa-stack.md` and
`specs/2026-09-16-hub-local-qa-stack-spec.md`.

```bash
bun run qa:up [--ttl 2h] [--no-seed] [--fresh]   # start/reuse, bootstrap, seed, arm the TTL
bun run qa:status                                 # containers, pending migrations, TTL remaining
bun run qa:reset                                  # re-bootstrap + re-seed after a new migration
bun run qa:down [--volumes]                       # tear down (keeps DB volumes by default)
```

The app runs at `http://localhost:5199`. Personas (email/password for every `tenancy.user.*`
fixture, plus the `E2E_*` aliases the existing Playwright `ui-audit` suite already reads) are
printed by `qa:up` and live in `.env.qa.local` (gitignored, mode `600`) — never commit it, and
never point any of these scripts at a non-loopback `SUPABASE_DB_URL`/`PUBLIC_SUPABASE_URL` (they
refuse to run against one). QA agents and the bowser/Playwright runbook should always target
`E2E_BASE_URL=http://localhost:5199` with `.env.qa.local` credentials — never production.

**A schema change ships with its seed.** Any PR touching `supabase/migrations/*.sql` must also
touch `scripts/qa/seed/**` or `supabase/qa/baseline/**` — add matrix entries
(`scripts/qa/seed/matrix.ts`) for whatever the new table/column should exercise — or carry the
`seed-unaffected` label with a one-line reason in the PR body. CI's `migration-seed-pairing` job
(`scripts/qa/check-migration-seed-pairing.ts`) enforces this; `qa-stack` is the job that actually
boots the stack, applies the real migration runner, seeds, and smoke-tests the result. The seed
permutation matrix (every fixture's id, domain and reason) lives in `scripts/qa/seed/matrix.ts`;
the contract test that walks it is `scripts/qa/seed/seed.contract.test.ts` (`bun run
qa:seed:verify`).

For day-to-day development, prefer `bun run dev:local` over `qa:up`: it brings up the same
containerized, seeded Supabase backend (sharing `scripts/qa/backend.ts` with `qa:up` so the two
can't drift) but runs the SvelteKit dev server on the host instead of in a container, so you get
normal Vite hot reload. It forces `.env.qa`'s values into the dev server's environment so a
developer's `.env.local` production values can never leak into the DEV backend, and prints the
resolved Supabase host at startup as proof. Ctrl-C stops only the dev server. See `docs/qa-stack.md`
§"Day-to-day". The Minion CLI wraps this as `minion run hub` (`minion run hub --prd` for the
unmodified `bun run dev` against production).

## Architecture

### Frontend state (`src/lib/state/`)

All global state is Svelte 5 `$state` runes in `.svelte.ts` modules, organized into domain subdirectories:

| Directory      | Modules                                                                    | Purpose                                            |
| -------------- | -------------------------------------------------------------------------- | -------------------------------------------------- |
| `gateway/`     | `connection`, `gateway-data`                                               | WebSocket status, live agent/session/presence data |
| `features/`    | `hosts`, `flow-editor`, `marketplace`, `missions`, `session-tasks`, `user` | Feature-specific state                             |
| `ui/`          | `theme`, `ui`, `locale`, `bg-pattern`, `logo`, `sparkline-style`           | UI preferences and appearance                      |
| `chat/`        | `chat`                                                                     | Per-agent chat messages and activity spark-bins    |
| `workshop/`    | `workshop`, `workshop-conversations`                                       | Canvas state and conversation threads              |
| `config/`      | `config`, `config-restart`                                                 | Gateway config editor state                        |
| `reliability/` | `reliability`, `credential-health`, `skill-stats`                          | Health monitoring data                             |
| `agents/`      | `agent-skills`, `agent-tools`                                              | Agent capability state                             |

Each subdirectory has an `index.ts` barrel for clean imports (e.g., `import { conn } from '$lib/state/gateway'`).

### Gateway connection (`src/lib/services/gateway.svelte.ts`)

Manages the WebSocket lifecycle. Connects to the active host URL, handles the challenge/auth handshake (`connect.challenge` → `connect` request), then processes incoming frames (events + responses). Exposes `wsConnect()` / `wsDisconnect()`. All inbound events update the state modules directly.

The protocol is a custom JSON frame protocol with three frame types: `req`, `res`, and `event` (see `src/lib/types/gateway.ts`).

### Backend (`src/server/`)

SvelteKit server-only services use PostgreSQL for the relational core and Supabase Auth (GoTrue) for browser identity. The legacy LibSQL/Turso layer still supports compatibility mappings and selected server/user-agent records; it is not the sole database or the authentication authority.

- `db/pg-client.ts` and `db/pg-pool.ts` own PostgreSQL handles/pools. `db/with-org-core.ts` runs scoped transactions with `app_ledger` and organization/profile GUCs.
- `auth/core-ctx.ts` resolves `CoreCtx` from an authenticated tenant; `getServerCtx` additionally checks the caller's gateway link.
- `db/client.ts` exposes the legacy Drizzle/LibSQL handle. `auth/tenant-ctx.ts` only returns the tenant resolved by the identity provider; it does not invent a default organization.
- `auth/resolve-identity.ts` resolves Supabase sessions and the explicitly allowed gateway server-token routes. `hooks.server.ts` applies route gates; domain handlers still enforce their capabilities.
- Canonical shared PostgreSQL schemas come from `@minion-stack/db/pg`; Hub business schemas live in `db/pg-*.ts` and `db/pg-schema/`.

### API routes (`src/routes/api/`)

Use `requireAuth` and the route's explicit RBAC capability, then `getCoreCtx`/`requireCoreCtx` for business data or `getServerCtx` for gateway-scoped data. Absence of authenticated organization context is an authorization failure. Never select the first tenant as a fallback. A documented public endpoint or server-token endpoint must enforce its own narrowly defined authority; an `/api/internal/` prefix is not authentication.

### Path aliases

- `$lib` → `src/lib/` (SvelteKit default)
- `$server` → `src/server/` (defined in `svelte.config.js`)

### Workshop canvas (`src/lib/components/workshop/`, `src/lib/workshop/`)

PixiJS 8 + Rapier2D physics. Agents are rendered as sprites and can be connected with spring joints (shown as ropes). The canvas is mounted via a Svelte action (`use:pixiCanvas`) and managed imperatively. Sprites are cleared when the host disconnects and rebuilt on reconnect.

### Theming

CSS variables for the full colour palette. Theme presets in `src/lib/themes/presets.ts`, applied via `applyTheme()` in `src/lib/state/ui/theme.svelte.ts`.

### UI design governance: a REQUIRED build step (like i18n and RBAC)

**Before touching ANY UI (`.svelte`, styles, components, routes with markup), read
`.claude/skills/ui-design-governance/SKILL.md`.** The design-token contract is law:

- **Authority chain**: `@minion-stack/design-tokens` `contract.json` (machine truth) →
  meta-repo spec `specs/2026-07-13-hub-ui-coherence-implementation-spec.md` §D2 (naming law)
  → `scripts/DESIGN-LINT.md` (enforcement docs).
- **Semantic tokens only** — `--color-canvas`, `--color-surface-1..3`, `--color-text-*`,
  status triples, `--space-*`, `--radius-*`, `--layer-*` (never numeric z-index), `.t-*`
  type roles. Forbidden legacy names (`--accent`, `--color-primary`, `--color-error`, …)
  hard-fail `lint:tokens`.
- **Gates after every UI change**: `bun run lint:design && bun run lint:tokens`.
  Changed-file design debt may only DECREASE (ratchet, enforced in CI). Exceptions go in
  `scripts/design-lint-exceptions.json` (capped allowance + category + reason, never blanket).
- **Never hand-edit generated `tokens.css`** — extend `contract.json` in the meta-repo
  package and regenerate.

### Components (`src/lib/components/`)

All components are organized into domain subdirectories — no loose `.svelte` files at root:

| Directory      | Purpose                                               |
| -------------- | ----------------------------------------------------- |
| `agents/`      | Agent list, detail, settings, skills, tools panels    |
| `sessions/`    | Session cards, kanban, monitor, viewer                |
| `hosts/`       | Host dropdown, pill, overlay                          |
| `chat/`        | Chat message and panel                                |
| `tasks/`       | Kanban column and task card                           |
| `charts/`      | Chart, sparkline, activity bars                       |
| `layout/`      | Topbar, splitter, detail panel, particle canvas, etc. |
| `config/`      | Config editor components                              |
| `decorations/` | Visual effects (BgPattern, ScanLine, etc.)            |
| `flow-editor/` | Flow editor canvas, sidebar, nodes                    |
| `marketplace/` | Marketplace browsing components                       |
| `reliability/` | Reliability dashboard panels                          |
| `settings/`    | Settings page components                              |
| `users/`       | User management components                            |
| `workshop/`    | Workshop canvas overlays                              |

### Auth

Auth is **Supabase Auth (GoTrue)**, not Better Auth — Better Auth was removed in `6227f3b1` and `src/lib/auth/` no longer exists. Sessions are GoTrue cookies (`sb-*-auth-token`) written by `@supabase/ssr`'s `createServerClient` in `src/server/supabase.ts` (`supabaseServer(event)` request-scoped, `supabaseAdmin()` service-role); identity resolution lives in `src/server/auth/resolve-identity.ts`.

- Dev auth bypass needs BOTH `AUTH_DISABLED=true` (server) AND `PUBLIC_AUTH_DISABLED=true` (client) in `.env`
- Drizzle relations referencing non-existent columns fail silently at compile time — only crash at runtime in `extractTablesRelationalConfig`. If auth returns 500 with `Cannot read properties of undefined (reading 'notNull')`, check `src/server/db/relations.ts` for column mismatches.

### Auth-derived data: canonical load flow

Auth-derived data (`user`, `permissions`, `workspaces`, `personalAgent`, `hosts`, `preferences`)
flows through `(app)/+layout.server.ts` and per-page `+page.server.ts` loads. Client
components read via `page.data.X` (or via the getter wrappers in `$lib/state/features/user.svelte.ts`).
Mutations call `invalidate('app:X')` (or `'settings:X'` for per-page deps) to refresh.

**Anti-pattern (do NOT add)**: client `fetch('/api/me')`, `fetch('/api/users/me/permissions')`,
etc., from `$effect`/`onMount` to load auth-derived data. That's what the
2026-05-13 canonical-load-flow refactor removed because it produces a 401 race window
during the OAuth callback transition. If you need new auth-derived data, add it to the
appropriate `+layout.server.ts` or `+page.server.ts` load function.

Spec/plan: `docs/superpowers/specs/2026-05-13-hub-canonical-load-flow-design.md`

### RBAC gating: a REQUIRED build step (like i18n)

Just as every user-facing string must go through Paraglide (`m.*()` + `i18n:compile`),
**every new page, route, API endpoint, and section nav link must be wired into the
RBAC engine** (`$server/services/rbac.service.ts`). Shipping an ungated surface is a
bug, not a follow-up. The ERPNext-grade model is the single source of truth — UI, API,
and the agent's data tools all gate through it.

Checklist when adding a surface (do ALL that apply):

1. **Module/route view gate.** If the page belongs to a business or platform module,
   ensure its path is covered by `requiredViewPermForPath` (central guard in
   `(app)/+layout.server.ts`). New top-level module → add a `ROUTE_VIEW_PERMS` entry +
   emit its `*:view` from `capsToLegacyPermissions`. New subpage of an existing module →
   add a `MODULE_SUBRESOURCES` entry (it auto-wires the route guard + role-manager row).
2. **Nav visibility.** Sidebar/section-nav items carry `requires` (core/plugin nav) or
   are filtered by `canViewPath(href)` (section side-menus: FinanceNav/CrmNav/…). A link
   with no gate is a UX bug — it renders for roles that 403 on click.
3. **Write-API gate.** Mutating API handlers (POST/PUT/PATCH/DELETE) under a business or
   org-config prefix are gated centrally by `apiWriteCapability` in `hooks.server.ts`.
   A new gated prefix → add it to `API_WRITE_PREFIXES`. Admin/config pages call
   `requireOrgCapability(locals, module, action)` directly. NEVER gate a business write
   with bare `requireAuth`/`requireAdmin` alone.
4. **Record-level (if-owner).** If the table has an owner column and the module is in
   `OWNER_SCOPABLE_MODULES`, thread `ownerFilter(locals, module)` into its list/detail
   reads (`get*` should 404 a non-owned id, not 403 — no existence leak).
5. **Field-level (sensitive fields).** If the read exposes PII / cost / margin and the
   module is in `FIELD_LEVEL_MODULES`, mask those fields via `shouldMaskSensitive(locals,
module)` (use `maskPii` from `$lib/pii` for phone/email).

Rule of thumb: if you wrote a `+page.server.ts` / `+server.ts` and it reads or writes
org data without touching `rbac.service`, you are not done. Memory: `rbac-erpnext-framework`.

## Honesty & Accuracy Rules

You are committed to honesty and accuracy above all else. Follow these rules in every response:

1. **UNCERTAINTY** — If you are not fully certain about a fact, say so clearly. Use phrases like "I'm not certain, but...", "You should verify this...", or "I may be wrong here, but...". Never state uncertain things as facts.
2. **SOURCES** — Do not invent paper titles, URLs, or book references. If you cannot name a real, verifiable source, say so. It is better to admit you don't know the source than to fabricate one.
3. **STATISTICS & NUMBERS** — Flag any statistic you are not 100% confident in. Say "I believe this is approximately..." and recommend the user verify it from an official or primary source.
4. **RECENT EVENTS** — Remind the user when a topic may have changed since your knowledge cutoff. Do not guess at current events or present outdated info as current.
5. **PEOPLE & QUOTES** — Never attribute a quote to a real person unless you are certain they said it. If unsure, say "I cannot confirm this quote is accurate."

## Open-items ledger (agent handoff)

Finishing a task while leaving ANY open end — unwired implementation, known bug, hardcoded value, missing edge-case handling, skipped/weak test — requires documenting it TWICE before you stop: (1) an in-code `TODO(handoff): <what, why, pointer>` comment at the exact site, and (2) a proposal in minion-meta `proposals/` (new file or append to the matching open one). Undocumented open ends are defects, not shortcuts — the maintenance pipeline (base.minion-ai.org) consumes this ledger; what is not written down never gets fixed.
