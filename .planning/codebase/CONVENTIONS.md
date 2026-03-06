# Coding Conventions

**Analysis Date:** 2026-03-05

## Naming Patterns

**Files:**
- Svelte components: PascalCase `.svelte` files (e.g., `AgentRow.svelte`, `ChatPanel.svelte`, `SessionKanban.svelte`)
- State modules: kebab-case with `.svelte.ts` suffix (e.g., `hosts.svelte.ts`, `gateway-data.svelte.ts`, `sparkline-style.svelte.ts`)
- Server services: kebab-case with `.service.ts` suffix (e.g., `server.service.ts`, `mission.service.ts`, `bug.service.ts`)
- Test files: co-located, same name with `.test.ts` suffix (e.g., `server.service.test.ts`, `format.test.ts`)
- DB schema files: kebab-case, one table per file (e.g., `servers.ts`, `chat-messages.ts`, `reliability-events.ts`)
- Types: kebab-case `.ts` files in `src/lib/types/` (e.g., `gateway.ts`, `chat.ts`, `host.ts`)
- Utility modules: kebab-case `.ts` files (e.g., `format.ts`, `text.ts`, `uuid.ts`)

**Functions:**
- Use camelCase for all functions: `fmtTokens`, `loadHosts`, `upsertServer`, `createMission`
- Prefix convention for utility formatters: `fmt` prefix (e.g., `fmtTokens`, `fmtTimeAgo`, `fmtUptime`)
- Prefix convention for HTML helpers: `esc` prefix (e.g., `escHtml`)
- Server service functions follow CRUD naming: `create*`, `list*`, `get*`, `update*`, `delete*`, `upsert*`
- State actions: verb-first (e.g., `loadHosts`, `addHost`, `removeHost`, `saveLastActiveHost`)

**Variables:**
- Use camelCase for all variables and parameters
- Constants: UPPER_SNAKE_CASE for module-level constants (e.g., `MAX_CHAT_MESSAGES`, `SPARK_BIN_COUNT`, `SPARK_BIN_MS`)
- Storage keys: kebab-case strings (e.g., `'minion-dash-hosts-cache'`, `'minion-dash-last-host'`)

**Types:**
- Use PascalCase for interfaces and type aliases: `TenantContext`, `ServerInput`, `Host`, `Agent`, `Session`
- Prefix interface names with purpose, not `I`: `RequestFrame`, `ResponseFrame`, `EventFrame`
- Use TypeScript `interface` for object shapes, `type` for unions/intersections

**Database columns:**
- Use snake_case in SQLite schema definitions: `tenant_id`, `created_at`, `last_connected_at`
- Table names are plural snake_case: `servers`, `chat_messages`, `reliability_events`

## Code Style

**Formatting:**
- No Prettier or ESLint config files detected -- formatting is manual/IDE-driven
- Use single quotes for strings in TypeScript
- Use tabs for indentation in `.svelte` files, spaces in `.ts` files (mixed -- follow the file you are editing)
- Trailing commas in multi-line lists

**Linting:**
- `svelte-check` + `tsc` via `bun run check` for type checking
- TypeScript strict mode enabled (`"strict": true` in `tsconfig.json`)
- `checkJs: true` enabled -- JavaScript files are type-checked too

## Import Organization

**Order:**
1. External packages (`drizzle-orm`, `@sveltejs/kit`, `vitest`)
2. Server aliases (`$server/db/schema`, `$server/services/...`)
3. Lib aliases (`$lib/state/...`, `$lib/types/...`, `$lib/utils/...`)
4. Relative imports (`./base`, `./format`)

**Path Aliases:**
- `$lib` -> `src/lib/` (SvelteKit default)
- `$server` -> `src/server/` (defined in `svelte.config.js` and duplicated in `vitest.config.ts`)

**Svelte Component Imports:**
```svelte
<script lang="ts">
  import EChartsSparkline from "$lib/components/charts/EChartsSparkline.svelte";
  import StatusDot from "$lib/components/decorations/StatusDot.svelte";
  import { agentActivity, agentChat } from "$lib/state/chat/chat.svelte";
  import { ui } from "$lib/state/ui/ui.svelte";
  import type { Agent } from "$lib/types/gateway";
  import * as m from "$lib/paraglide/messages";
  import * as tooltip from "@zag-js/tooltip";
</script>
```

**i18n messages:** Import as namespace `import * as m from "$lib/paraglide/messages"` and use as `m.messageKey()`.

## Error Handling

**API Routes:**
- Wrap handler bodies in try/catch
- Log errors with bracketed route prefix: `console.error('[GET /api/servers]', e)`
- Return JSON error responses with `{ ok: false, error: message }` and appropriate HTTP status
- Use SvelteKit `error()` for auth failures: `if (!locals.tenantCtx) throw error(401)`
- Use SvelteKit `error(400, message)` for validation failures

```typescript
// Pattern for API route handlers
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) return json({ servers: [] });
  try {
    const result = await listServers(ctx);
    return json({ servers: result });
  } catch (e) {
    console.error('[GET /api/servers]', e);
    return json({ servers: [] });
  }
};
```

**Frontend state modules:**
- Use empty catch blocks for non-critical localStorage failures: `catch { /* ignore corrupt cache */ }`
- Throw `new Error(...)` with HTTP status for fetch failures: `throw new Error('Failed to save host: ${res.status}')`

**Global error handler (`src/hooks.server.ts`):**
```typescript
export const handleError: HandleServerError = ({ error, event }) => {
  console.error(`[handleError] ${event.request.method} ${event.url.pathname}`, error);
  return { message: 'Internal Error' };
};
```

## Logging

**Framework:** `console.error` and `console.log` (no structured logging library)

**Patterns:**
- Always prefix log messages with a bracketed context tag: `[hooks]`, `[GET /api/servers]`, `[handleError]`
- Log errors with the error object as second argument: `console.error('[context]', e)`
- Do not log in utility/pure functions -- only in API handlers and hooks

## Comments

**When to Comment:**
- JSDoc-style `/** */` comments for exported functions and complex utilities (see `src/server/test-utils/mock-db.ts`)
- Inline `//` comments for non-obvious logic or explaining "why" (e.g., `// Resolve actual server id (conflict may have kept an existing row with a different id)`)
- Section dividers using `// --- Section Name ---` pattern in large files (e.g., `// --- Public API ---` in `gateway.svelte.ts`)

**JSDoc/TSDoc:**
- Use `/** */` for public utility functions with usage examples
- Include `@example` blocks in shared test utilities
- No requirement for JSDoc on every function -- use when the purpose is not obvious from the name

## Function Design

**Size:** Functions are generally short (5-30 lines). Large orchestration functions like WebSocket message handlers are the exception.

**Parameters:**
- Server service functions always take `ctx: TenantContext` as first parameter, followed by domain-specific input
- Use typed input interfaces for create/update operations (e.g., `ServerInput`, mission input objects)
- Optional parameters use `?` suffix or `= defaultValue`

**Return Values:**
- Service create functions return the new entity's ID string
- Service list functions return arrays (never null)
- Service get-by-id functions return the entity or `null`
- API handlers return `json({ ... })` responses

## Module Design

**Exports:**
- Named exports only -- no default exports (except Svelte components which are default by convention)
- State modules export a single reactive state object plus action functions
- Service modules export individual CRUD functions

**Barrel Files:**
- `src/server/db/schema/index.ts` re-exports all table definitions from individual schema files
- `src/lib/state/index.ts` re-exports all state domain subdirectory barrels
- `src/lib/state/{domain}/index.ts` re-exports all modules in each state domain
- `src/lib/types/index.ts` re-exports all type definition files
- `src/lib/utils/index.ts` re-exports all utility modules (excluding test files)
- `src/lib/auth/index.ts` re-exports auth server config and client

## Svelte 5 Patterns

**State Management:**
- Use `$state()` rune for reactive state objects in `.svelte.ts` files
- Use `$derived()` and `$derived.by()` for computed values in components
- Use `$props()` with inline type annotations for component props

```svelte
<!-- Component props pattern -->
let {
  agent,
  selected,
  compact = false,
}: {
  agent: Agent;
  selected: boolean;
  compact?: boolean;
} = $props();
```

**State module pattern (`src/lib/state/{domain}/*.svelte.ts`):**
```typescript
export const conn = $state({
  connected: false,
  connecting: false,
  closed: true,
  particleHue: 'red' as 'blue' | 'amber' | 'red',
});
```

## API Route Patterns

**Tenant Context Resolution:**
- Use `getTenantCtx(locals)` for read operations (returns null if no tenant)
- Use `getOrCreateTenantCtx(locals)` for write operations that should auto-create
- Auth check: `if (!locals.tenantCtx) throw error(401);`

**Response Format:**
- Success: `json({ entityName: data })` for GETs, `json({ ok: true, id })` for creates
- Error: `json({ ok: false, error: message }, { status: 500 })`

## Database Patterns

**Schema Definition (`src/server/db/schema/*.ts`):**
```typescript
export const servers = sqliteTable(
  'servers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_servers_tenant').on(t.tenantId),
    uniqueIndex('servers_uniq_url').on(t.tenantId, t.url),
  ],
);
```

**ID Generation:**
- Use `newId()` from `$server/db/utils` for server-side IDs (cuid2, 24 chars)
- Use `uuid()` from `$lib/utils/uuid` for client-side IDs (UUID v4)

**Timestamps:**
- Store as integer milliseconds since epoch (`integer('created_at')`)
- Use `nowMs()` from `$server/db/utils` to generate

**Multi-tenancy:**
- Every table has `tenantId` column referencing `organization.id`
- All queries filter by `tenantId` from `TenantContext`

## Styling

**Framework:** Tailwind CSS v4 (via `@tailwindcss/vite` plugin)

**Approach:**
- Utility classes directly in Svelte template markup
- CSS custom properties for theming (defined in `src/lib/themes/presets.ts`)
- No CSS-in-JS or separate stylesheet files per component

---

*Convention analysis: 2026-03-05*
