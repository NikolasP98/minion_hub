# Gateway Registry → Postgres (Wave 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `gateway` + `user_gateway` Postgres tables, a per-user credential resolver, a Drizzle-PG runtime client (`getCoreDb()`), and a Settings → "Gateways" admin page so admins can add/link gateways and per-user gateway resolution works from Supabase.

**Architecture:** Install `postgres-js` + wire `getCoreDb()` (Drizzle over Supavisor pooler). Add PG `gateway`/`user_gateway` tables (mirroring Turso `servers`/`user_servers` with uuid PKs and `profile_id → profiles(id)`, token sealed with hub's existing AES-GCM). New `getUserGatewayCredentials(profileId)` replaces the system-wide "oldest server" fallback in `gateway-rpc.ts`. The existing `/api/servers` CRUD + `HostsTab` in Settings continues to back the Turso layer unchanged during this wave (strangler-fig: dual-write in Wave 2). A new Settings → "Gateways" tab (/settings/gateways) gives admins UI to manage PG-backed gateways.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Bun, Drizzle ORM (postgres-js adapter), postgres-js, Supabase Postgres (Supavisor pooler port 6543), AES-256-GCM (existing `$server/auth/crypto.ts`), supabase-js (service role for RLS-bypass reads).

**Spec:** `docs/superpowers/specs/2026-05-26-gateway-registry-pg-migration-design.md`

**Conventions:**
- Tests: `bun run vitest run <file>`. Full check: `bun run check` (ignore ~20 pre-existing unrelated errors).
- All new PG tables in `packages/db/src/pg/schema/`; generate migration via `cd packages/db && bunx drizzle-kit generate --config drizzle.pg.config.ts`; apply via MCP `apply_migration`.
- API route pattern: `requireAdmin(locals)` / `requireAuth(locals)` from `$server/auth/authorize`. Return `json(...)`, throw `error(...)`.
- Svelte 5: `$props()`, `$state()`, `$derived()`, `onclick={}`, `Snippet`, `{@render}`. No legacy patterns.
- Branch: `dev`. Don't touch `master`.

**Pre-flight (before starting Task 1):**
You need a Supabase Postgres pooler DSN. In the Supabase dashboard for project `gxvsaskbohavnurfvshr`, go to Settings → Database → Connection string → choose **Transaction mode (port 6543)** and copy the URI. Set it as `SUPABASE_DB_URL=postgresql://postgres.[ref]:6543/postgres?sslmode=require` in `minion_hub/.env.local`. The direct DSN (port 5432) is only used for drizzle-kit migrations (already configured in `packages/db/drizzle.pg.config.ts`).

---

## Phase 0 — Postgres client infrastructure

### Task 1: Install postgres-js and wire `getCoreDb()`

**Files:**
- Install: `postgres` npm package (run from `minion_hub/`)
- Create: `src/server/db/pg-client.ts`
- Test: `src/server/db/pg-client.test.ts`

- [ ] **Step 1: Install postgres-js**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion_hub
bun add postgres
```
Expected: `postgres` appears in `package.json` dependencies.

- [ ] **Step 2: Write a failing test**

`src/server/db/pg-client.test.ts`:
```ts
import { describe, test, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_DB_URL: 'postgresql://test:test@localhost:5432/test' },
}));

describe('getCoreDb', () => {
  test('returns a drizzle instance (not null)', async () => {
    // We can't connect in tests, but we verify the factory runs and returns an object.
    // The actual DB call path is integration-tested via the service tests.
    const { getCoreDb } = await import('./pg-client');
    const db = getCoreDb();
    expect(db).toBeTruthy();
    expect(typeof db.select).toBe('function');
  });
});
```

Run: `bun run vitest run src/server/db/pg-client.test.ts`
Expected: FAIL ("Cannot find module './pg-client'").

- [ ] **Step 3: Implement `pg-client.ts`**

`src/server/db/pg-client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';

let _db: ReturnType<typeof createDrizzle> | null = null;

function createDrizzle() {
  const url = env.SUPABASE_DB_URL;
  if (!url) throw new Error('SUPABASE_DB_URL is required for the PG core client');
  // Transaction mode (Supavisor port 6543): prepare:false required.
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client);
}

/** Singleton Drizzle-PG client. Reads/writes the relational-core tables in Supabase. */
export function getCoreDb() {
  if (!_db) _db = createDrizzle();
  return _db;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun run vitest run src/server/db/pg-client.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Add `SUPABASE_DB_URL` to `.env.local`**

Open `minion_hub/.env.local` and add (use the Supavisor transaction-mode URI from pre-flight):
```
SUPABASE_DB_URL=postgresql://postgres.[your-ref]:6543/postgres?sslmode=require&pgbouncer=true
```

- [ ] **Step 6: Commit**

```bash
git add src/server/db/pg-client.ts src/server/db/pg-client.test.ts package.json bun.lockb
git commit -m "feat(db): add getCoreDb() drizzle-postgres-js client for PG core tables"
```

---

## Phase 1 — PG schema: gateway + user_gateway

### Task 2: PG schema for `gateway` and `user_gateway`

**Context:** These mirror the Turso `servers` + `user_servers` tables with uuid PKs, `profile_id → profiles(id)`, and `legacy_server_id` to bridge Turso event rows. Run all drizzle-kit commands from `packages/db`.

**Files (meta-repo):**
- Create: `packages/db/src/pg/schema/gateway.ts`
- Modify: `packages/db/src/pg/schema/index.ts`
- Generated: `supabase/migrations/<timestamp>_gateway_user_gateway.sql`

- [ ] **Step 1: Write the schema**

`packages/db/src/pg/schema/gateway.ts`:
```ts
import { pgTable, uuid, text, boolean, timestamp, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { profiles } from './profiles.js';

/**
 * Supabase-backed registry of Minion gateway servers.
 * Mirrors Turso `servers`. legacy_server_id preserves the old Turso text PK
 * so Turso event rows (which still carry the old id) can join here.
 */
export const gateway = pgTable('gateway', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Old Turso servers.id (text) — kept so Turso log/event rows still join.
  legacyServerId: text('legacy_server_id'),
  name: text('name').notNull(),
  url: text('url').notNull(),
  // AES-256-GCM ciphertext + iv (same format as user_identities.secret_ciphertext/iv).
  tokenCiphertext: text('token_ciphertext').notNull().default(''),
  tokenIv: text('token_iv').notNull().default(''),
  authMode: text('auth_mode', { enum: ['token', 'none'] }).notNull().default('token'),
  lastConnectedAt: timestamp('last_connected_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('gateway_uniq_url').on(t.url),
  index('idx_gateway_legacy').on(t.legacyServerId),
]);

/**
 * Per-user gateway link. Mirrors Turso `user_servers`.
 * profile_id references profiles.id (== auth.users.id), NOT the legacy text id.
 */
export const userGateway = pgTable('user_gateway', {
  profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  gatewayId: uuid('gateway_id').notNull().references(() => gateway.id, { onDelete: 'cascade' }),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.profileId, t.gatewayId] }),
  index('idx_user_gateway_gateway').on(t.gatewayId),
]);
```

- [ ] **Step 2: Export from index**

In `packages/db/src/pg/schema/index.ts`, add:
```ts
export { gateway, userGateway } from './gateway.js';
```

- [ ] **Step 3: Generate migration**

```bash
cd /home/nikolas/Documents/CODE/MINION/packages/db
SUPABASE_DB_URL_DIRECT="$SUPABASE_DB_URL_DIRECT" bunx drizzle-kit generate --config drizzle.pg.config.ts
```
Expected: a new `supabase/migrations/<timestamp>_*.sql` with `CREATE TABLE "gateway"` and `CREATE TABLE "user_gateway"`. Verify the file — it must NOT recreate `profiles`, `join_request`, `join_link`.

- [ ] **Step 4: Apply migration via MCP**

Use `mcp__claude_ai_Supabase__apply_migration` (or `mcp__supabase__apply_migration`) with the generated SQL contents.

Verify: `mcp__supabase__list_tables` and confirm `gateway`, `user_gateway` exist.

- [ ] **Step 5: Hand-write RLS migration**

Create `supabase/migrations/<next-timestamp>_gateway_rls.sql`:
```sql
alter table public.gateway enable row level security;
--> statement-breakpoint
alter table public.user_gateway enable row level security;
--> statement-breakpoint

-- Linked users can read their own gateway.
create policy "gateway_linked_select" on public.gateway
  for select using (
    exists (
      select 1 from public.user_gateway ug
      where ug.gateway_id = id and ug.profile_id = auth.uid()
    )
  );
--> statement-breakpoint

-- Admins can read/write all gateways.
create policy "gateway_admin_all" on public.gateway
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
--> statement-breakpoint

-- Users can see their own links.
create policy "user_gateway_self_select" on public.user_gateway
  for select using (profile_id = auth.uid());
--> statement-breakpoint

-- Admins manage all links.
create policy "user_gateway_admin_all" on public.user_gateway
  for all using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
```

Apply via `mcp__supabase__apply_migration`.

- [ ] **Step 6: Commit (meta-repo)**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add packages/db/src/pg/schema/gateway.ts packages/db/src/pg/schema/index.ts supabase/migrations/
git commit -m "feat(db): add gateway + user_gateway PG tables with RLS"
```

---

## Phase 2 — Gateway service (PG)

### Task 3: `gateway.service.ts` — create/list/delete/resolve

**Files (hub):**
- Create: `src/server/services/gateway.pg.service.ts`
- Test: `src/server/services/gateway.pg.service.test.ts`

This service wraps `supabaseAdmin()` (PostgREST, service-role) for writes and `getCoreDb()` for direct SQL reads. Token sealed with `encrypt`/`decrypt` from `$server/auth/crypto.ts`.

- [ ] **Step 1: Write failing tests (mocked)**

`src/server/services/gateway.pg.service.test.ts`:
```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const calls: any = {};
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: any) => ({ select: () => ({ single: async () => ((calls.inserted = row), { data: { id: 'g1', ...row }, error: null }) }) }),
      select: () => ({ eq: () => ({ order: () => ({ data: calls.gateways ?? [], error: null }) }) }),
      delete: () => ({ eq: async () => ((calls.deleted = true), { error: null }) }),
    }),
  }),
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({
  select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => calls.credRow ? [calls.credRow] : [] }) }) }) }),
}) }));
vi.mock('$server/auth/crypto', () => ({
  encrypt: vi.fn((t: string) => ({ ciphertext: `enc:${t}`, iv: 'iv1' })),
  decrypt: vi.fn((c: string, _iv: string) => c.replace('enc:', '')),
}));
// Import gateway schema for table refs used in getCoreDb query
vi.mock('@minion-stack/db/pg', () => ({ gateway: {}, userGateway: {} }));

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe('gateway.pg.service', () => {
  test('createGateway seals token and inserts', async () => {
    const { createGateway } = await import('./gateway.pg.service');
    const g = await createGateway({ name: 'prod', url: 'ws://gw', token: 'secret', profileId: 'p1' });
    expect(calls.inserted.token_ciphertext).toBe('enc:secret');
    expect(calls.inserted.token_iv).toBe('iv1');
    expect(g.id).toBe('g1');
  });

  test('getUserGatewayCredentials returns decrypted token', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    calls.credRow = { url: 'ws://gw', token_ciphertext: 'enc:secret', token_iv: 'iv1' };
    const cred = await getUserGatewayCredentials('p1');
    expect(cred?.url).toBe('ws://gw');
    expect(cred?.token).toBe('secret');
  });

  test('getUserGatewayCredentials returns null when no gateway linked', async () => {
    const { getUserGatewayCredentials } = await import('./gateway.pg.service');
    calls.credRow = null;
    const cred = await getUserGatewayCredentials('p1');
    expect(cred).toBeNull();
  });
});
```

Run: `bun run vitest run src/server/services/gateway.pg.service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement**

`src/server/services/gateway.pg.service.ts`:
```ts
import { supabaseAdmin } from '$server/supabase';
import { getCoreDb } from '$server/db/pg-client';
import { encrypt, decrypt } from '$server/auth/crypto';
import { gateway, userGateway } from '@minion-stack/db/pg';
import { eq, and } from 'drizzle-orm';

export interface GatewayInput {
  name: string;
  url: string;
  /** Plain-text token. Sealed before storage. */
  token: string;
  profileId: string;
  isDefault?: boolean;
}

export interface GatewayRow {
  id: string;
  name: string;
  url: string;
  authMode: string;
  createdAt: string;
}

export async function createGateway(input: GatewayInput): Promise<{ id: string }> {
  const { ciphertext, iv } = encrypt(input.token);
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('gateway')
    .insert({
      name: input.name,
      url: input.url,
      token_ciphertext: ciphertext,
      token_iv: iv,
      auth_mode: 'token',
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'createGateway failed');
  // Link to the creating user.
  await sb.from('user_gateway').insert({
    profile_id: input.profileId,
    gateway_id: data.id,
    is_default: input.isDefault ?? true,
  });
  return { id: data.id };
}

export async function listGatewaysForAdmin(): Promise<GatewayRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from('gateway')
    .select('id,name,url,auth_mode,created_at')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as GatewayRow[];
}

export async function deleteGateway(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from('gateway').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Return the URL + decrypted token for a user's default (or first) linked gateway.
 * Used by gateway-rpc to resolve per-user credentials from Postgres.
 */
export async function getUserGatewayCredentials(
  profileId: string,
): Promise<{ url: string; token: string } | null> {
  const db = getCoreDb();
  const rows = await db
    .select({ url: gateway.url, tokenCiphertext: gateway.tokenCiphertext, tokenIv: gateway.tokenIv })
    .from(userGateway)
    .leftJoin(gateway, eq(userGateway.gatewayId, gateway.id))
    .where(eq(userGateway.profileId, profileId))
    .limit(1);
  if (!rows.length || !rows[0].url) return null;
  const row = rows[0];
  const token = decrypt(row.tokenCiphertext, row.tokenIv);
  return { url: row.url, token };
}

export async function linkGatewayToUser(profileId: string, gatewayId: string): Promise<void> {
  const { error } = await supabaseAdmin().from('user_gateway').insert({
    profile_id: profileId,
    gateway_id: gatewayId,
    is_default: false,
  });
  if (error && !error.message.includes('duplicate')) throw new Error(error.message);
}

export async function unlinkGatewayFromUser(profileId: string, gatewayId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('user_gateway')
    .delete()
    .eq('profile_id', profileId)
    .eq('gateway_id', gatewayId);
  if (error) throw new Error(error.message);
}
```

Note: `@minion-stack/db/pg` is the PG schema export from `packages/db`. In the hub it resolves via the workspace package.

- [ ] **Step 3: Run tests — expect PASS**

Run: `bun run vitest run src/server/services/gateway.pg.service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add src/server/services/gateway.pg.service.ts src/server/services/gateway.pg.service.test.ts
git commit -m "feat(gateway): PG gateway service (create/list/delete/resolve per-user creds)"
```

---

### Task 4: Wire per-user credential resolution into `gateway-rpc.ts`

**Files:**
- Modify: `src/lib/server/gateway-rpc.ts:51-65` (`resolveCredentials`)
- Modify: `src/hooks.server.ts` — pass `supabaseId` into the RPC resolution context

The `resolveCredentials()` function currently ignores the user and picks the oldest server. Replace it with per-user lookup from PG (falling back to the old system-wide Turso lookup during Wave 1 transition, then env).

- [ ] **Step 1: Read the current resolveCredentials in full**

Open `src/lib/server/gateway-rpc.ts` lines 51–66 (already shown in plan context above). The signature is `async function resolveCredentials(): Promise<{ url, token }>`.

- [ ] **Step 2: Write the updated function**

Replace `resolveCredentials` and add a new exported overload `resolveCredentialsForUser`:

In `src/lib/server/gateway-rpc.ts`, replace lines 51–66:
```ts
/**
 * Resolve gateway credentials for a specific user (Supabase profile id).
 * PG user_gateway is the primary source; Turso `servers` is the fallback
 * during Wave 1 transition; env vars are the last-resort bootstrap.
 */
export async function resolveCredentialsForUser(
  profileId: string | undefined,
): Promise<{ url: string; token: string }> {
  // 1. Per-user PG lookup (new path).
  if (profileId) {
    try {
      const { getUserGatewayCredentials } = await import('$server/services/gateway.pg.service');
      const creds = await getUserGatewayCredentials(profileId);
      if (creds) return { url: toWsUrl(creds.url), token: creds.token };
    } catch (err) {
      console.warn('[gateway-rpc] PG per-user lookup failed, falling back', err);
    }
  }
  // 2. Turso system-wide fallback (Wave 1 transition — removed in Wave 2).
  try {
    const creds = await getSystemGatewayCredentials(getDb(), env.MINION_GATEWAY_PRIMARY_URL);
    if (creds) return { url: toWsUrl(creds.url), token: creds.token };
  } catch (err) {
    console.warn('[gateway-rpc] Turso credential lookup failed, trying env fallback', err);
  }
  // 3. Bootstrap env fallback (empty DB / fresh deploy).
  const fallbackUrl = env.MINION_GATEWAY_URL ?? env.OPENCLAW_GATEWAY_URL ?? '';
  const fallbackToken = env.OPENCLAW_GATEWAY_TOKEN ?? '';
  if (!fallbackUrl) throw new Error('No gateway configured. Add a gateway in Settings → Gateways.');
  if (!fallbackToken) throw new Error('No gateway token configured.');
  return { url: toWsUrl(fallbackUrl), token: fallbackToken };
}

// Keep the internal resolver used by gatewayCall (no user context available for server-side calls).
async function resolveCredentials(): Promise<{ url: string; token: string }> {
  return resolveCredentialsForUser(undefined);
}
```

Also add `import { getDb } from '$server/db/client';` if not already present.

- [ ] **Step 3: Use per-user resolution in `/api/plugins/ui-list`**

Find the route that calls `gatewayCall` for plugin UI. Search: `grep -rn "gatewayCall\|getGatewayHttpUrl" src/routes/api/plugins/ | head`. Update the call site to use `resolveCredentialsForUser(locals.user?.supabaseId)` — or pass the profileId through. If `gatewayCall` doesn't accept credentials directly, expose a `gatewayCallAsUser(method, params, profileId)` helper:

Add to `src/lib/server/gateway-rpc.ts`:
```ts
/** Same as gatewayCall but resolves credentials for the given Supabase profile id. */
export async function gatewayCallAsUser<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  profileId: string | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = await resolveCredentialsForUser(profileId);
  return gatewayCallWithCreds<T>(method, params, url, token, opts);
}
```

Then refactor the main `gatewayCall` to delegate to `gatewayCallWithCreds`:
```ts
async function gatewayCallWithCreds<T>(
  method: string,
  params: Record<string, unknown>,
  url: string,
  token: string,
  opts: { timeoutMs?: number },
): Promise<T> {
  // ... (move the existing WebSocket logic here) ...
}

export async function gatewayCall<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = await resolveCredentials();
  return gatewayCallWithCreds<T>(method, params, url, token, opts);
}
```

- [ ] **Step 4: Update the plugins/ui-list route**

Read `src/routes/api/plugins/ui-list/+server.ts` (or wherever it lives). Replace its `gatewayCall(...)` or `getGatewayHttpUrl()` invocation with `gatewayCallAsUser(..., locals.user?.supabaseId)` so per-user resolution applies.

- [ ] **Step 5: Typecheck the modified files**

Run: `bun run check 2>&1 | grep -E "gateway-rpc|plugins/ui-list|gateway\.pg"`
Expected: no new errors in these files (ignore pre-existing errors elsewhere).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/gateway-rpc.ts src/routes/api/plugins/
git commit -m "feat(gateway): per-user PG credential resolution in gateway-rpc + plugins/ui-list"
```

---

## Phase 3 — API routes

### Task 5: `/api/gateways` endpoints (admin-gated)

**Files:**
- Create: `src/routes/api/gateways/+server.ts`
- Create: `src/routes/api/gateways/[id]/+server.ts`
- Create: `src/routes/api/gateways/[id]/links/+server.ts`

Pattern: mirrors `/api/join-requests` (recently built). `requireAdmin` gates all endpoints. Add `/api/gateways` to `API_UNAUTH_FALLBACK_PATHS` in `hooks.server.ts` so the admin GET works without tenantCtx.

- [ ] **Step 1: `src/routes/api/gateways/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { createGateway, listGatewaysForAdmin } from '$server/services/gateway.pg.service';
import { assertSafeUrl, SsrfBlockedError } from '$server/services/ssrf-guard';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ gateways: await listGatewaysForAdmin() });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const admin = requireAdmin(locals);
  if (!admin.supabaseId) throw error(400, 'supabase session required');
  const b = (await request.json().catch(() => ({}))) as { name?: string; url?: string; token?: string };
  if (!b.name || !b.url || !b.token) throw error(400, 'name, url, and token required');
  try {
    await assertSafeUrl(b.url, 'gateway URL');
  } catch (e) {
    if (e instanceof SsrfBlockedError) return json({ ok: false, error: e.message }, { status: 422 });
    throw e;
  }
  const g = await createGateway({ name: b.name, url: b.url, token: b.token, profileId: admin.supabaseId });
  return json({ ok: true, id: g.id });
};
```

- [ ] **Step 2: `src/routes/api/gateways/[id]/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { deleteGateway } from '$server/services/gateway.pg.service';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  await deleteGateway(params.id!);
  return json({ ok: true });
};
```

- [ ] **Step 3: `src/routes/api/gateways/[id]/links/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { linkGatewayToUser, unlinkGatewayFromUser } from '$server/services/gateway.pg.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as { profileId?: string };
  if (!b.profileId) throw error(400, 'profileId required');
  await linkGatewayToUser(b.profileId, params.id!);
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as { profileId?: string };
  if (!b.profileId) throw error(400, 'profileId required');
  await unlinkGatewayFromUser(b.profileId, params.id!);
  return json({ ok: true });
};
```

- [ ] **Step 4: Add to `API_UNAUTH_FALLBACK_PATHS` in `hooks.server.ts`**

In `src/hooks.server.ts`, in the `API_UNAUTH_FALLBACK_PATHS` array, add `'/api/gateways'` (so admin GET/POST work without tenantCtx, same as `/api/servers`):
```ts
    '/api/gateways',
```

- [ ] **Step 5: Typecheck**

Run: `bun run check 2>&1 | grep -E "api/gateways|hooks\.server"`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/gateways/ src/hooks.server.ts
git commit -m "feat(api): gateway CRUD + user-link endpoints (/api/gateways)"
```

---

## Phase 4 — Settings UI

### Task 6: Settings → "Gateways" page

**Files:**
- Create: `src/routes/(app)/settings/gateways/+page.server.ts`
- Create: `src/routes/(app)/settings/gateways/+page.svelte`
- Modify: `src/lib/components/settings/SettingsTabBar.svelte` (add "Gateways" tab — check existing tab pattern first)

The existing Settings page (`/settings`) already has a `HostsTab` (Turso servers). The new Gateways page is a separate tab/sub-route under `/settings/gateways` for the PG-backed registry.

- [ ] **Step 1: Server load**

`src/routes/(app)/settings/gateways/+page.server.ts`:
```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listGatewaysForAdmin } from '$server/services/gateway.pg.service';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  return { gateways: await listGatewaysForAdmin() };
};
```

- [ ] **Step 2: Page UI**

`src/routes/(app)/settings/gateways/+page.svelte`:
```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  const { data } = $props();

  let name = $state('');
  let url = $state('');
  let token = $state('');
  let adding = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);

  async function addGateway() {
    if (adding) return;
    adding = true; error = null; success = null;
    const res = await fetch('/api/gateways', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), url: url.trim(), token: token.trim() }),
    });
    adding = false;
    if (res.ok) {
      name = ''; url = ''; token = '';
      success = 'Gateway added.';
      await invalidateAll();
    } else {
      const j = await res.json().catch(() => ({}));
      error = j.error ?? 'Could not add gateway.';
    }
  }

  async function deleteGateway(id: string) {
    await fetch(`/api/gateways/${id}`, { method: 'DELETE' });
    await invalidateAll();
  }
</script>

<div class="p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-4">Gateways</h1>

    <div class="border border-border rounded-lg overflow-hidden mb-6">
      <div class="relative px-4 py-3 border-b border-border bg-bg/60">
        <ScanLine speed={10} opacity={0.02} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">Add gateway</span>
      </div>
      <div class="p-4 space-y-3">
        <input bind:value={name} placeholder="Name (e.g. production)" class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={url} placeholder="URL (ws:// or wss://)" class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        <input bind:value={token} type="password" placeholder="Token" class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60" />
        {#if error}<p class="text-[11px] font-mono text-red-400">{error}</p>{/if}
        {#if success}<p class="text-[11px] font-mono text-green-400">{success}</p>{/if}
        <button onclick={addGateway} disabled={adding || !name || !url || !token}
          class="px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
          {adding ? 'Adding…' : 'Add gateway'}
        </button>
      </div>
    </div>

    {#if data.gateways.length === 0}
      <p class="text-sm text-muted">No gateways yet.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.gateways as g (g.id)}
          <li class="flex items-center justify-between border border-border rounded px-3 py-2">
            <div>
              <div class="text-sm text-foreground">{g.name}</div>
              <div class="text-xs text-muted font-mono">{g.url}</div>
            </div>
            <button onclick={() => deleteGateway(g.id)} class="text-xs text-red-400 hover:text-red-300">Remove</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
```

- [ ] **Step 3: Add "Gateways" to settings tab bar**

Read `src/lib/components/settings/SettingsTabBar.svelte` to understand the tab pattern, then add a "Gateways" entry linking to `/settings/gateways` (shown only when `isAdmin`). Follow the exact same pattern as existing tabs (inspect the file first; adapt the snippet below to match it):
```ts
// In the tabs array or equivalent structure in SettingsTabBar.svelte:
{ href: '/settings/gateways', label: 'Gateways', adminOnly: true }
```

- [ ] **Step 4: Manual verification**

Run dev server. Navigate to `/settings/gateways` as an admin → form renders. Add a test gateway (name "test", url `ws://localhost:9999`, token "t") → appears in the list. Remove it → list empties. As a non-admin → 403.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run check 2>&1 | grep -E "settings/gateways|SettingsTabBar"
git add "src/routes/(app)/settings/gateways/" src/lib/components/settings/SettingsTabBar.svelte
git commit -m "feat(settings): Gateways admin page (add/list/remove PG-backed gateways)"
```

---

## Final verification (Wave 1 complete)

- [ ] Run full test suite: `bun run test` — all green.
- [ ] Typecheck: `bun run check` — no new errors (ignore pre-existing ~20).
- [ ] E2E: add a gateway in Settings → Gateways → the gateway's WS token resolves for your user → `/api/plugins/ui-list` returns entries (if the gateway serves plugin UIs).
- [ ] Gateway token stays out of the URL (opaque; sealed in DB).
- [ ] Non-admin visiting `/settings/gateways` → 403.

## Spec coverage check

| Spec requirement | Task |
|---|---|
| PG `gateway` + `user_gateway` tables (uuid, `profile_id→profiles.id`, `legacy_server_id`, token sealed) | 2 |
| RLS on gateway + user_gateway | 2 |
| Drizzle-PG runtime client `getCoreDb()` | 1 |
| `getUserGatewayCredentials(profileId)` per-user resolver | 3 |
| Wire resolver into `gateway-rpc` + `plugins/ui-list` | 4 |
| Turso fallback during transition | 4 |
| `/api/gateways` CRUD (create/list/delete) + user-link endpoints | 5 |
| Settings → "Gateways" admin page (add/list/remove, gated `users.manage`) | 6 |
| SSRF guard on gateway URL | 5 |
| Token sealed AES-GCM with hub's crypto | 3 |

## What Wave 2 will do (out of scope here)

Dual-write `servers` → `gateway` for every `upsertServer` call, so newly added Turso servers also land in PG; begin per-table strangler-fig flags for `agents`, `sessions`, etc. This Wave 1 plan is self-contained and shippable without Wave 2.
