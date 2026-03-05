# Architecture

**Analysis Date:** 2026-03-05

## Pattern Overview

**Overall:** SvelteKit full-stack application with a WebSocket-driven frontend and RESTful API backend. The hub acts as a control plane that connects to remote AI agent gateways via WebSocket and persists operational data in SQLite/Turso.

**Key Characteristics:**
- Frontend state is fully reactive using Svelte 5 `$state` runes in `.svelte.ts` modules (no stores)
- Single WebSocket connection to the active gateway server drives all real-time agent/session data
- Multi-tenant backend using Drizzle ORM with a `TenantContext` pattern on every service call
- API routes delegate to service functions; no business logic lives in route handlers
- Workshop canvas uses PixiJS 8 + Rapier2D physics, managed imperatively outside Svelte's reactive system

## Layers

**Presentation Layer (Svelte Components):**
- Purpose: Render UI, handle user interaction, bind to reactive state
- Location: `src/lib/components/`
- Contains: `.svelte` components organized by feature domain
- Depends on: State layer (`$lib/state/`), Services layer (`$lib/services/`)
- Used by: Route pages (`src/routes/`)

**State Layer (Reactive Runes):**
- Purpose: Hold all global application state as Svelte 5 `$state` runes
- Location: `src/lib/state/`
- Contains: `.svelte.ts` modules, each exporting a `$state` object and mutation functions
- Depends on: Nothing (pure state); some modules fetch from API routes on init
- Used by: Components and Services

**Gateway Service (WebSocket Client):**
- Purpose: Manage WebSocket lifecycle, send requests, dispatch inbound events to state modules
- Location: `src/lib/services/gateway.svelte.ts`
- Contains: Single module with `wsConnect()`, `wsDisconnect()`, `sendRequest()`, message handler
- Depends on: All state modules (updates them on events), `$lib/types/gateway`
- Used by: Root layout (`src/routes/+layout.svelte`), components that trigger WS actions

**Route Pages:**
- Purpose: Compose components into page layouts, load data via SvelteKit mechanisms
- Location: `src/routes/`
- Contains: `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+page.ts` files
- Depends on: Components, State, sometimes API routes via fetch
- Used by: SvelteKit router

**API Layer (SvelteKit Endpoints):**
- Purpose: RESTful HTTP endpoints for CRUD operations and gateway metrics ingestion
- Location: `src/routes/api/`
- Contains: `+server.ts` files with GET/POST/PUT/DELETE handlers
- Depends on: Server services (`$server/services/`), auth context (`$server/auth/`)
- Used by: Frontend fetch calls, external gateway push

**Server Services:**
- Purpose: Business logic and database operations, always scoped to a tenant
- Location: `src/server/services/`
- Contains: `*.service.ts` files, one per domain (agent, server, chat, reliability, etc.)
- Depends on: DB client (`$server/db/client`), schema (`$server/db/schema/`), `TenantContext`
- Used by: API route handlers

**Database Layer:**
- Purpose: Schema definitions, Drizzle ORM client, migration support
- Location: `src/server/db/`
- Contains: `client.ts` (singleton), `schema/` (one file per table), `relations.ts`, `utils.ts`
- Depends on: `@libsql/client`, `drizzle-orm`
- Used by: Server services

**Workshop Engine (Imperative Canvas):**
- Purpose: PixiJS + Rapier2D physics simulation for agent interaction visualization
- Location: `src/lib/workshop/` (engine), `src/lib/components/workshop/` (UI overlays)
- Contains: Renderer, physics, sprite management, camera, FSM, conversation manager
- Depends on: `pixi.js`, `@dimforge/rapier2d-compat`, state layer for agent data
- Used by: Workshop route (`src/routes/workshop/`)

## Data Flow

**Gateway Connection Flow:**

1. Root layout `src/routes/+layout.svelte` calls `loadUser()` then `loadHosts()` on mount
2. If an active host exists, calls `wsConnect()` from `src/lib/services/gateway.svelte.ts`
3. WebSocket opens to gateway URL; gateway sends `connect.challenge` event with a nonce
4. Hub fetches device identity signature via `/api/device-identity/sign` POST
5. Hub sends `connect` request with auth token, device identity, and capabilities
6. Gateway responds with `HelloOk` containing snapshot (agents, presence, health, sessions)
7. `gateway.svelte.ts` populates all state modules: `gw.agents`, `gw.sessions`, `gw.presence`, etc.
8. Polling timers start for periodic `list.sessions`, `list.agents`, `list.presence` requests
9. Inbound events (`chat.event`, `session.update`, `presence.update`, etc.) update state in real time

**API Request Flow (Browser to DB):**

1. Component calls `fetch('/api/servers/[id]/agents')` or similar
2. `src/hooks.server.ts` intercepts: resolves auth (Better Auth session or Bearer token), sets `locals.tenantCtx`
3. Route handler in `src/routes/api/` calls `getTenantCtx(locals)` for the `TenantContext`
4. Handler delegates to a service function (e.g., `listServers(ctx, userId, role)`)
5. Service queries DB via Drizzle ORM, scoped by `ctx.tenantId`
6. JSON response returned to component

**Metrics Push Flow (Gateway to Hub):**

1. Gateway server sends HTTP POST to `/api/metrics/push` with Bearer token
2. `hooks.server.ts` resolves server token auth via `resolveServerTokenAuth()`
3. Sets `locals.tenantCtx` with the matching tenant and server ID
4. Metrics service persists reliability events, heartbeats, skill stats to SQLite

**State Management:**
- All frontend state is Svelte 5 `$state` runes in `src/lib/state/*.svelte.ts`
- No Svelte stores used; direct property mutation triggers reactivity
- Persistence: hosts cached in localStorage + SQLite via `/api/servers`; workshop state auto-saved to localStorage; activity bins flushed to SQLite on a 30s timer
- State is cleared on disconnect and repopulated on reconnect

## Key Abstractions

**TenantContext:**
- Purpose: Scopes all DB operations to a tenant (organization)
- Defined in: `src/server/services/base.ts`
- Pattern: `{ db: Db, tenantId: string }` passed as first arg to every service function
- Resolved in: `src/server/auth/tenant-ctx.ts` via `getTenantCtx(locals)` or `getOrCreateTenantCtx(locals)`

**Gateway Frame Protocol:**
- Purpose: Structured JSON message format for WebSocket communication
- Defined in: `src/lib/types/gateway.ts`
- Pattern: Three frame types: `RequestFrame` (`type: 'req'`), `ResponseFrame` (`type: 'res'`), `EventFrame` (`type: 'event'`)
- Request/response uses a `pending` map keyed by UUID for async promise resolution

**Host (Server):**
- Purpose: Represents a remote gateway server the hub connects to
- Defined in: `src/lib/types/host.ts` (frontend), `src/server/db/schema/servers.ts` (DB)
- Pattern: CRUD via `/api/servers`, active host selection drives WS connection. Tokens encrypted at rest with AES.

**Reactive State Module Pattern:**
- Purpose: Each `.svelte.ts` module in `src/lib/state/` exports a `$state` object and pure functions to mutate it
- Examples: `src/lib/state/connection.svelte.ts`, `src/lib/state/gateway-data.svelte.ts`, `src/lib/state/hosts.svelte.ts`
- Pattern: `export const gw = $state({ ... })` with exported mutation functions like `upsertSession()`, `clearSessions()`

## Entry Points

**Client Entry (Root Layout):**
- Location: `src/routes/+layout.svelte`
- Triggers: Every page load
- Responsibilities: Loads user, loads hosts, initiates WS connection, applies theme, renders global decorations (particles, background pattern, shutdown banner, hosts overlay)

**Main Dashboard Page:**
- Location: `src/routes/+page.svelte`
- Triggers: Navigation to `/`
- Responsibilities: Renders Topbar, AgentSidebar (with splitter), and DetailPanel in a flex layout

**Server Hook:**
- Location: `src/hooks.server.ts`
- Triggers: Every server-side request
- Responsibilities: Auth resolution (Better Auth session, Bearer token, AUTH_DISABLED bypass), tenant context injection, redirect unauthenticated users to `/login`, i18n handle

**Gateway Service:**
- Location: `src/lib/services/gateway.svelte.ts`
- Triggers: Called by root layout on mount; reconnects automatically on close
- Responsibilities: WebSocket lifecycle, challenge/auth handshake, frame parsing, event dispatch to state modules, periodic polling

**DB Seed:**
- Location: `src/server/seed.ts`
- Triggers: `bun run db:seed`
- Responsibilities: Creates initial organization and admin user

## Error Handling

**Strategy:** Defensive try/catch at API boundaries with console logging; frontend silently degrades on fetch failures.

**Patterns:**
- API route handlers wrap service calls in try/catch, return `{ ok: false, error: message }` with status 500
- `hooks.server.ts` exports `handleError` that logs and returns generic `{ message: 'Internal Error' }`
- Gateway WS: connection errors trigger reconnect with exponential backoff (800ms to 15s, factor 1.7)
- State modules use fallback defaults (empty arrays, null) when data is unavailable
- Host loading falls back to localStorage cache if network fetch fails

## Cross-Cutting Concerns

**Logging:** `console.error` / `console.warn` with bracket-prefixed context tags like `[hooks]`, `[hub]`, `[GET /api/servers]`

**Validation:** Minimal; API routes trust request bodies, relying on TypeScript types and DB constraints. Zag-js handles form widget state.

**Authentication:** Better Auth library (`better-auth` package) for session-based auth with Google OAuth support. Bearer token auth for gateway-to-hub metrics push. Optional `AUTH_DISABLED=true` for local dev. Fallback to first organization for unauthenticated API access.

**Authorization:** Role-based (`user` | `admin`) stored in `user.role` column. Admins see all servers; users see only linked servers via `userServers` join table.

**i18n:** Paraglide-SvelteKit for internationalization. Messages compiled to `src/lib/paraglide/messages/`. Locale state in `src/lib/state/locale.svelte.ts`.

**Theming:** CSS custom properties with theme presets in `src/lib/themes/presets.ts`. Applied via `applyTheme()` in `src/lib/state/theme.svelte.ts`. Accent color configurable per user.

---

*Architecture analysis: 2026-03-05*
