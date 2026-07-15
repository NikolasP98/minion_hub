# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Minion Hub** is a SvelteKit web dashboard for managing and monitoring AI agent gateways. It connects to one or more remote "gateway" servers (via WebSocket) and provides a UI to view agents, sessions, chat history, reliability metrics, and a visual "workshop" canvas for agent interaction.

## Git Workflow

**Feature branches → `dev` → `main`** is the standard workflow.

1. Start every feature in an isolated git worktree branched off `dev`:
   ```bash
   git worktree add .worktrees/my-feature -b feature/my-feature origin/dev
   ```
2. Develop and commit inside the worktree.
3. Merge (or PR) the feature branch into `dev`.
4. When `dev` is stable and ready for release, merge `dev` into `master` and push.

Never commit directly to `master`. Use `dev` as the integration branch.

## Commands

```bash
bun run dev          # Start dev server
bun run build        # Production build
bun run check        # Type-check (svelte-check + tsc)
bun run test         # Run all tests (vitest)
bun run test:watch   # Vitest in watch mode

# Run a single test file
bun run vitest run src/lib/utils/format.test.ts

# Database
bun run db:push      # Push schema to DB (dev)
bun run db:generate  # Generate migration files
bun run db:migrate   # Run migrations
bun run db:seed      # Seed initial tenant + admin user
bun run db:studio    # Open Drizzle Studio UI
```

### Green baseline (as of 2026-05-29)

The repo is **fully green** and must stay that way:

- `bun run check` → **0 errors, 0 warnings**
- `bun run test` → **all tests pass** (0 failures)
- `bun run build` → succeeds cleanly (the only output is harmless "modules failed to locate dependencies" notices for optional native peers: `bufferutil`, `utf-8-validate`, `@react-email/render`, `supports-color`, `@neon-rs/load` — do not chase these)

There is **no longer a tolerated baseline of pre-existing errors/warnings**. Any check error, test failure, or Svelte compiler warning you see is a regression — fix it before considering work done. Notes:

- SvelteKit `$env/*` virtual modules don't resolve under vitest; they're aliased to stubs in `vitest.config.ts` → `src/server/test-utils/env-stubs/`. Per-test `vi.mock('$env/...')` still overrides.
- `let foo = $state(prop.field ?? default)` (seeding editable form state once from a prop) is correct — suppress `state_referenced_locally` with `// svelte-ignore`, do NOT convert to `$derived` (that wipes user edits). Convert to `$derived` only for pure read-through props.
- Cache-key `d` descriptors for `keys.hub()` must be `Record<string, string|number>` — use `scopeData()` from `src/server/services/base.ts` to drop optional/undefined filters.

## Local Setup

Copy `.env.example` to `.env`. For local dev, `TURSO_DB_URL` defaults to `file:./data/minion_hub.db` (SQLite file, no Turso account needed). Run `db:push` then `db:seed` to initialise.

In production: set `TURSO_DB_URL` (libsql://…) and `TURSO_DB_AUTH_TOKEN` for Turso. `B2_*` vars are only needed for file upload features.

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

SvelteKit server-only code. Multi-tenant SQLite via Drizzle ORM + libsql/Turso.

- `db/client.ts` — singleton `getDb()` returning the Drizzle client
- `db/schema/` — one file per table (servers, agents, sessions, tenants, users, …)
- `services/` — service functions grouped by domain; all take a `TenantContext` (`{ db, tenantId }`)
- `auth/` — password hashing (argon2) and session cookie management

Auth is handled in `src/hooks.server.ts`: sets `locals.tenantCtx` from either a session cookie or a Bearer server token (used by gateway metrics push). API routes that need to work without auth (marketplace browsing, server CRUD) fall back to the first tenant in the DB.

### API routes (`src/routes/api/`)

RESTful. Nested under `/api/servers/[id]/` for all server-scoped resources (agents, skills, sessions, missions, settings). Unauthenticated fallback pattern for local usage:

```ts
async function getTenantCtx(locals) {
  if (locals.tenantCtx) return locals.tenantCtx;
  const db = getDb();
  const rows = await db.select({ id: tenants.id }).from(tenants).limit(1);
  if (rows.length === 0) return null;
  return { db, tenantId: rows[0].id };
}
```

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

### Auth (`src/lib/auth/`)

Better Auth configuration (`auth.ts`) and client (`auth-client.ts`) with barrel `index.ts`.

- Better Auth uses **scrypt** for passwords (not argon2). Reset via: `import { hashPassword } from 'better-auth/crypto'`
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
