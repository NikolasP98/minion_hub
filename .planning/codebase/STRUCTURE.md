# Codebase Structure

**Analysis Date:** 2026-03-05

## Directory Layout

```
minion_hub/
├── src/
│   ├── routes/                  # SvelteKit file-based routing (pages + API)
│   │   ├── +layout.svelte       # Root layout: auth, WS connect, theme, decorations
│   │   ├── +layout.ts           # Client-side layout load
│   │   ├── +page.svelte         # Main dashboard (Topbar + Sidebar + Detail)
│   │   ├── api/                 # REST API endpoints
│   │   │   ├── auth/            # Better Auth catch-all
│   │   │   ├── servers/         # Server CRUD + nested resources
│   │   │   │   └── [id]/        # Per-server: agents, sessions, missions, skills, settings, activity-bins
│   │   │   ├── metrics/         # Gateway push endpoints (heartbeats, credential-health, skill-stats)
│   │   │   ├── reliability/     # Reliability events + summary
│   │   │   ├── marketplace/     # Agent marketplace: browse, install, generate, sync
│   │   │   ├── flows/           # Flow editor CRUD
│   │   │   ├── bugs/            # Bug tracking
│   │   │   ├── files/           # File upload/download
│   │   │   ├── chat-history/    # Chat message persistence
│   │   │   ├── connection-events/ # Connection event logging
│   │   │   ├── device-identity/ # Device identity + signing
│   │   │   ├── users/           # User management
│   │   │   ├── tenants/         # Tenant info
│   │   │   └── workshop/        # Workshop saves
│   │   ├── login/               # Login page
│   │   ├── auth/                # OAuth callback (Google)
│   │   ├── config/              # Gateway config editor page
│   │   ├── sessions/            # Sessions list page
│   │   ├── reliability/         # Reliability dashboard page
│   │   ├── settings/            # App settings page
│   │   ├── users/               # User management page
│   │   ├── marketplace/         # Marketplace pages (agents, skills, tools, integrations, plugins)
│   │   ├── flow-editor/         # Visual flow editor page
│   │   └── workshop/            # Workshop canvas page
│   ├── lib/                     # Shared frontend code ($lib alias)
│   │   ├── state/               # Svelte 5 $state rune modules (domain subdirectories)
│   │   │   ├── gateway/         # connection, gateway-data
│   │   │   ├── features/        # hosts, flow-editor, marketplace, missions, session-tasks, user
│   │   │   ├── ui/              # theme, ui, locale, bg-pattern, logo, sparkline-style
│   │   │   ├── chat/            # chat
│   │   │   ├── workshop/        # workshop, workshop-conversations
│   │   │   ├── config/          # config, config-restart
│   │   │   ├── reliability/     # reliability, credential-health, skill-stats
│   │   │   ├── agents/          # agent-skills, agent-tools
│   │   │   └── index.ts         # Root barrel re-exporting all subdirectories
│   │   ├── services/            # Client-side services (gateway WS)
│   │   ├── components/          # Svelte components (domain subdirectories, no root files)
│   │   │   ├── agents/          # Agent list, detail, settings, skills, tools panels
│   │   │   ├── sessions/        # Session cards, kanban, monitor, viewer
│   │   │   ├── hosts/           # Host dropdown, pill, overlay
│   │   │   ├── chat/            # Chat message and panel
│   │   │   ├── tasks/           # Kanban column and task card
│   │   │   ├── charts/          # Chart, sparkline, activity bars, ECharts
│   │   │   ├── layout/          # Topbar, splitter, detail panel, particle canvas, etc.
│   │   │   ├── config/          # Config editor components
│   │   │   ├── decorations/     # Visual decoration components (BgPattern, ScanLine, etc.)
│   │   │   ├── flow-editor/     # Flow editor components (canvas, sidebar, nodes, edges)
│   │   │   ├── marketplace/     # Marketplace components
│   │   │   ├── reliability/     # Reliability dashboard components
│   │   │   ├── settings/        # Settings page components
│   │   │   ├── users/           # User management components
│   │   │   └── workshop/        # Workshop canvas components + overlays
│   │   ├── auth/                # Better Auth server config + client (barrel index.ts)
│   │   ├── workshop/            # Workshop engine (PixiJS, Rapier2D, sprites, physics)
│   │   ├── types/               # TypeScript type definitions (barrel index.ts)
│   │   ├── utils/               # Utility functions + tests (barrel index.ts)
│   │   ├── themes/              # Theme preset definitions
│   │   ├── actions/             # Svelte actions (holo.ts)
│   │   ├── paraglide/           # Generated i18n messages (compiled output)
│   │   └── i18n.ts              # i18n configuration
│   ├── server/                  # Server-only code ($server alias)
│   │   ├── db/
│   │   │   ├── client.ts        # Singleton Drizzle ORM client
│   │   │   ├── schema/          # One file per DB table (26 tables)
│   │   │   │   └── index.ts     # Barrel re-export of all tables
│   │   │   ├── relations.ts     # Drizzle relation definitions
│   │   │   └── utils.ts         # newId() (cuid2) and nowMs()
│   │   ├── services/            # Domain service functions (one per entity)
│   │   ├── auth/
│   │   │   ├── tenant-ctx.ts    # getTenantCtx / getOrCreateTenantCtx helpers
│   │   │   └── crypto.ts        # AES token encryption/decryption
│   │   ├── storage/             # File storage abstraction
│   │   ├── test-utils/          # Test helpers for server tests
│   │   └── seed.ts              # DB seed script (org + admin user)
│   ├── hooks.server.ts          # SvelteKit server hooks (auth, tenant resolution)
│   ├── app.css                  # Global CSS (Tailwind v4)
│   ├── app.d.ts                 # App-level type declarations
│   └── paraglide/               # Paraglide runtime (generated)
├── drizzle/                     # Generated migration files + meta
├── drizzle.config.ts            # Drizzle Kit configuration
├── project.inlang/              # Inlang i18n project config + message cache
├── scripts/                     # One-off scripts (e.g., migrate-existing-servers.ts)
├── static/                      # Static assets (favicon.svg, fonts/)
├── svelte.config.js             # SvelteKit config (Vercel adapter, $server alias)
├── vite.config.ts               # Vite config
├── vitest.config.ts             # Vitest config
├── tsconfig.json                # TypeScript config
├── package.json                 # Dependencies and scripts
└── CLAUDE.md                    # AI assistant guidance
```

## Directory Purposes

**`src/routes/`:**
- Purpose: All pages and API endpoints via SvelteKit file-based routing
- Contains: `+page.svelte` for pages, `+server.ts` for API handlers, `+layout.svelte` for layouts
- Key files: `+layout.svelte` (root), `+page.svelte` (dashboard), `api/servers/+server.ts` (server CRUD)

**`src/routes/api/servers/[id]/`:**
- Purpose: All server-scoped REST resources
- Contains: Nested endpoints for agents, sessions, missions, skills, settings, activity-bins
- Key pattern: Each endpoint resolves tenant context, delegates to a service function

**`src/lib/state/`:**
- Purpose: All global reactive state as Svelte 5 `$state` rune modules, organized into domain subdirectories
- Contains: 8 subdirectories (gateway, features, ui, chat, workshop, config, reliability, agents) each with `.svelte.ts` files and barrel `index.ts`
- Key files: `features/hosts.svelte.ts` (server list/selection), `gateway/gateway-data.svelte.ts` (live agent/session data), `chat/chat.svelte.ts` (per-agent chat + activity sparklines), `gateway/connection.svelte.ts` (WS status), `workshop/workshop.svelte.ts` (canvas state), `config/config.svelte.ts` (gateway config editor state), `ui/theme.svelte.ts` (theme preferences)

**`src/lib/services/`:**
- Purpose: Client-side service layer (currently only gateway WebSocket)
- Contains: `gateway.svelte.ts` -- the single most important frontend module
- Key files: `gateway.svelte.ts` (600+ lines, WS lifecycle, frame handling, polling)

**`src/lib/components/`:**
- Purpose: All Svelte UI components, organized into domain subdirectories (no loose root files)
- Contains: 15 subdirectories covering agents, sessions, hosts, chat, tasks, charts, layout, config, decorations, flow-editor, marketplace, reliability, settings, users, workshop
- Key files: `layout/Topbar.svelte`, `agents/AgentSidebar.svelte`, `agents/AgentDetail.svelte`, `layout/DetailPanel.svelte`, `layout/Splitter.svelte`, `sessions/SessionDropdown.svelte`

**`src/lib/workshop/`:**
- Purpose: Imperative PixiJS + Rapier2D engine code (not Svelte components)
- Contains: TypeScript modules for physics simulation, sprite rendering, camera, FSM, conversation management
- Key files: `simulation.ts` (main loop), `agent-sprite.ts`, `physics.ts`, `renderer-adapter.ts`, `camera.ts`

**`src/lib/components/workshop/`:**
- Purpose: Svelte component overlays and UI for the workshop canvas
- Contains: Canvas mount component, toolbar, overlays (inbox, pinboard, message board, rulebook, portal)
- Key files: `WorkshopCanvas.svelte`, `WorkshopToolbar.svelte`, `ChatPanel.svelte`

**`src/server/db/schema/`:**
- Purpose: One Drizzle table definition per file
- Contains: 26+ table schemas covering servers, agents, sessions, chat messages, reliability events, marketplace, etc.
- Key files: `index.ts` (barrel export), `servers.ts`, `agents.ts`, `sessions.ts`

**`src/server/services/`:**
- Purpose: All backend business logic, one service per domain
- Contains: `*.service.ts` files + corresponding `*.service.test.ts` test files
- Key files: `server.service.ts`, `metrics.service.ts`, `reliability.service.ts`, `marketplace.service.ts`, `chat.service.ts`

**`src/lib/types/`:**
- Purpose: Shared TypeScript type definitions for frontend
- Contains: Gateway protocol types, config schema types, skill/tool types
- Key files: `gateway.ts` (frame protocol + domain types), `config.ts` (gateway config shape), `host.ts` (Host interface)

**`src/lib/utils/`:**
- Purpose: Pure utility functions with co-located tests
- Contains: Formatters, text extraction, UUID generation, session key parsing, config schema, agent settings schema
- Key files: `format.ts`, `text.ts`, `uuid.ts`, `session-key.ts`, `config-schema.ts` (13K+ lines), `agent-settings-schema.ts` (24K+ lines)

## Key File Locations

**Entry Points:**
- `src/routes/+layout.svelte`: App shell -- auth check, host loading, WS connection, theme
- `src/routes/+page.svelte`: Main dashboard page layout
- `src/hooks.server.ts`: Server-side request interceptor (auth + tenant resolution)
- `src/lib/services/gateway.svelte.ts`: WebSocket client for gateway communication

**Configuration:**
- `svelte.config.js`: SvelteKit config, Vercel adapter, `$server` alias
- `vite.config.ts`: Vite build config
- `vitest.config.ts`: Test runner config
- `drizzle.config.ts`: Drizzle Kit DB config
- `tsconfig.json`: TypeScript compiler options
- `project.inlang/`: i18n project configuration
- `.env.example`: Environment variable template (do not read `.env`)

**Core Logic:**
- `src/lib/services/gateway.svelte.ts`: WebSocket lifecycle + event dispatch
- `src/lib/state/gateway/gateway-data.svelte.ts`: Live agent/session/presence state
- `src/lib/state/chat/chat.svelte.ts`: Chat messages + activity sparkline bins
- `src/lib/state/features/hosts.svelte.ts`: Server list management + active host selection
- `src/lib/state/workshop/workshop.svelte.ts`: Workshop canvas state (agents, relationships, camera)
- `src/server/auth/tenant-ctx.ts`: Tenant context resolution for all API calls

**Testing:**
- `src/server/services/*.service.test.ts`: Server service unit tests
- `src/lib/utils/*.test.ts`: Utility function unit tests
- `src/server/db/utils.test.ts`: DB utility tests

## Naming Conventions

**Files:**
- Components: `PascalCase.svelte` (e.g., `AgentDetail.svelte`, `Topbar.svelte`)
- State modules: `kebab-case.svelte.ts` (e.g., `gateway-data.svelte.ts`, `chat.svelte.ts`)
- Services: `kebab-case.service.ts` (e.g., `server.service.ts`, `bug.service.ts`)
- DB schema: `kebab-case.ts` (e.g., `chat-messages.ts`, `reliability-events.ts`)
- Types: `kebab-case.ts` (e.g., `gateway.ts`, `host.ts`)
- Utils: `kebab-case.ts` with co-located `kebab-case.test.ts`
- Tests: `*.test.ts` co-located with source file

**Directories:**
- `kebab-case` throughout (e.g., `flow-editor/`, `device-identity/`, `chat-history/`)
- Feature subdirectories under `components/` match route names where applicable

## Where to Add New Code

**New Page/Route:**
- Create directory: `src/routes/{page-name}/+page.svelte`
- If data loading needed: add `+page.ts` or `+page.server.ts`
- Add link in `src/lib/components/layout/Topbar.svelte`

**New API Endpoint:**
- Server-scoped (per gateway): `src/routes/api/servers/[id]/{resource}/+server.ts`
- Global: `src/routes/api/{resource}/+server.ts`
- Create matching service: `src/server/services/{resource}.service.ts`
- Create matching schema: `src/server/db/schema/{resource}.ts` and add to `src/server/db/schema/index.ts`

**New Svelte Component:**
- Place in the appropriate domain subdirectory: `src/lib/components/{domain}/{ComponentName}.svelte`
- Common domains: agents, sessions, hosts, chat, tasks, charts, layout, config, reliability, settings, workshop
- Workshop overlay: `src/lib/components/workshop/{Name}Overlay.svelte`

**New State Module:**
- Create in the appropriate domain subdirectory: `src/lib/state/{domain}/{name}.svelte.ts`
- Export a `$state` object and mutation functions
- Add to the subdirectory's `index.ts` barrel
- Import in `gateway.svelte.ts` if the state is populated from WS events

**New Server Service:**
- Create: `src/server/services/{domain}.service.ts`
- Accept `TenantContext` as first parameter on every exported function
- Create test: `src/server/services/{domain}.service.test.ts`

**New DB Table:**
- Schema: `src/server/db/schema/{table-name}.ts`
- Export from: `src/server/db/schema/index.ts`
- Add relations in: `src/server/db/relations.ts` (if needed)
- Generate migration: `bun run db:generate`

**New Utility:**
- Create: `src/lib/utils/{name}.ts`
- Co-locate test: `src/lib/utils/{name}.test.ts`

**New Workshop Engine Module:**
- Create: `src/lib/workshop/{name}.ts`
- Svelte overlay: `src/lib/components/workshop/{Name}Overlay.svelte`

## Special Directories

**`drizzle/`:**
- Purpose: Generated SQL migration files from Drizzle Kit
- Generated: Yes (via `bun run db:generate`)
- Committed: Yes

**`src/lib/paraglide/` and `src/paraglide/`:**
- Purpose: Compiled i18n message functions from Paraglide
- Generated: Yes (via `bun run i18n:compile`)
- Committed: Yes

**`data/`:**
- Purpose: Local SQLite database file (`minion_hub.db`)
- Generated: Yes (via `bun run db:push` + `bun run db:seed`)
- Committed: No (in `.gitignore`)

**`.svelte-kit/`:**
- Purpose: SvelteKit build output and type generation
- Generated: Yes
- Committed: No

**`static/`:**
- Purpose: Static assets served at root (favicon, fonts)
- Generated: No
- Committed: Yes

**`.worktrees/`:**
- Purpose: Git worktrees for feature branches
- Generated: Yes (via `git worktree add`)
- Committed: No

---

*Structure analysis: 2026-03-05*
