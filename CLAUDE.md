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
4. When `dev` is stable and ready for release, merge `dev` into `main` and push.

Never commit directly to `main`. Use `dev` as the integration branch.

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

## Local Setup

Copy `.env.example` to `.env`. For local dev, `TURSO_DB_URL` defaults to `file:./data/minion_hub.db` (SQLite file, no Turso account needed). Run `db:push` then `db:seed` to initialise.

In production: set `TURSO_DB_URL` (libsql://…) and `TURSO_DB_AUTH_TOKEN` for Turso. `B2_*` vars are only needed for file upload features.

## Architecture

### Frontend state (`src/lib/state/`)

All global state is Svelte 5 `$state` runes in `.svelte.ts` modules. Key ones:

| File | Purpose |
|---|---|
| `hosts.svelte.ts` | List of gateway hosts; active host ID (persisted in SQLite via `/api/servers`; last-active ID in localStorage) |
| `connection.svelte.ts` | WebSocket connection status (`connected`, `connecting`, `particleHue`, etc.) |
| `gateway-data.svelte.ts` | Data received from the active gateway: agents, sessions, presence, config |
| `chat.svelte.ts` | Per-agent chat messages and activity spark-bins |
| `workshop.svelte.ts` | Workshop canvas state (agents on canvas, relationships, camera; auto-saved to localStorage) |

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

CSS variables for the full colour palette. Theme presets in `src/lib/themes/presets.ts`, applied via `applyTheme()` in `src/lib/state/theme.svelte.ts`.
