# User–Server Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist gateway hosts per-user in Turso DB via a `user_servers` join table; `admin@minion.hub` sees all hosts; localStorage caches hosts for instant load.

**Architecture:** A new `user_servers` table links `user.id → servers.id` (many-to-many). Servers remain org-scoped and deduplicated by URL. On `addHost`, after upserting the server row, we insert a `user_servers` link. On `loadHosts`, we query servers joined through `user_servers` for the current user (admin bypasses the join). The existing `servers` table and API shape are unchanged.

**Tech Stack:** Drizzle ORM (libsql/Turso), SvelteKit server hooks, Svelte 5 `$state` runes.

---

### Task 1: Add `user_servers` schema table

**Files:**
- Create: `src/server/db/schema/user-servers.ts`
- Modify: `src/server/db/schema/index.ts`
- Modify: `src/server/db/relations.ts`

**Step 1: Create the table file**

```ts
// src/server/db/schema/user-servers.ts
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { user } from './auth';
import { servers } from './servers';

export const userServers = sqliteTable(
  'user_servers',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.serverId] })],
);
```

**Step 2: Export from schema index**

In `src/server/db/schema/index.ts`, add:
```ts
export { userServers } from './user-servers';
```

**Step 3: Add relations in `src/server/db/relations.ts`**

Import `userServers` at the top alongside existing imports, then add:
```ts
export const userServersRelations = relations(userServers, ({ one }) => ({
  user: one(user, { fields: [userServers.userId], references: [user.id] }),
  server: one(servers, { fields: [userServers.serverId], references: [servers.id] }),
}));
```
Also extend `userRelations` to include `many(userServers)` and `serverRelations` (if it exists) similarly — but only if those relation objects exist; don't create them from scratch.

**Step 4: Push schema to local DB**

```bash
bun run db:push
```
Expected: prints "Changes applied" with the new `user_servers` table. No errors.

**Step 5: Commit**

```bash
git add src/server/db/schema/user-servers.ts src/server/db/schema/index.ts src/server/db/relations.ts
git commit -m "feat(schema): add user_servers join table for user-host linking"
```

---

### Task 2: Update `server.service.ts` — filter by user, admin bypass

**Files:**
- Modify: `src/server/services/server.service.ts`

**Step 1: Update `listServers` to accept userId + userEmail**

Replace the existing `listServers` function with:

```ts
export async function listServers(
  ctx: TenantContext,
  userId?: string,
  userEmail?: string,
) {
  const isAdmin = userEmail === 'admin@minion.hub';

  // Admin sees everything; no-user-context falls back to all org servers
  if (isAdmin || !userId) {
    const rows = await ctx.db
      .select({
        id: servers.id,
        name: servers.name,
        url: servers.url,
        token: servers.token,
        tokenIv: servers.tokenIv,
        lastConnectedAt: servers.lastConnectedAt,
      })
      .from(servers)
      .where(eq(servers.tenantId, ctx.tenantId))
      .orderBy(servers.createdAt);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      token: row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token,
      lastConnectedAt: row.lastConnectedAt,
    }));
  }

  // Regular user: only servers they're linked to
  const rows = await ctx.db
    .select({
      id: servers.id,
      name: servers.name,
      url: servers.url,
      token: servers.token,
      tokenIv: servers.tokenIv,
      lastConnectedAt: servers.lastConnectedAt,
    })
    .from(servers)
    .innerJoin(userServers, eq(userServers.serverId, servers.id))
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(userServers.userId, userId)))
    .orderBy(servers.createdAt);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    token: row.tokenIv ? decryptToken(row.token, row.tokenIv) : row.token,
    lastConnectedAt: row.lastConnectedAt,
  }));
}
```

Add `userServers` to the imports at the top of the file:
```ts
import { servers, userServers } from '$server/db/schema';
```

**Step 2: Update `upsertServer` to link the user after upsert**

Replace the existing `upsertServer` with:

```ts
export async function upsertServer(
  ctx: TenantContext,
  s: ServerInput,
  userId?: string,
) {
  const now = nowMs();
  const id = s.id ?? newId();
  const { encrypted, iv } = encryptToken(s.token);

  await ctx.db
    .insert(servers)
    .values({
      id,
      tenantId: ctx.tenantId,
      name: s.name,
      url: s.url,
      token: encrypted,
      tokenIv: iv,
      lastConnectedAt: s.lastConnectedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [servers.tenantId, servers.url],
      set: {
        name: s.name,
        token: encrypted,
        tokenIv: iv,
        lastConnectedAt: s.lastConnectedAt ?? null,
        updatedAt: now,
      },
    });

  // Resolve actual server id (conflict may have used existing row)
  const [row] = await ctx.db
    .select({ id: servers.id })
    .from(servers)
    .where(and(eq(servers.tenantId, ctx.tenantId), eq(servers.url, s.url)));
  const finalId = row?.id ?? id;

  // Link user → server
  if (userId) {
    await ctx.db
      .insert(userServers)
      .values({ userId, serverId: finalId, createdAt: now })
      .onConflictDoNothing();
  }

  return finalId;
}
```

**Step 3: Commit**

```bash
git add src/server/services/server.service.ts
git commit -m "feat(servers): filter by user_id, admin bypass, link on upsert"
```

---

### Task 3: Pass user context through API routes

**Files:**
- Modify: `src/routes/api/servers/+server.ts`
- Modify: `src/routes/api/servers/[id]/+server.ts`

**Step 1: Update GET in `/api/servers/+server.ts`**

Pass `locals.user?.id` and `locals.user?.email` to `listServers`:

```ts
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getTenantCtx(locals);
  if (!ctx) return json({ servers: [] });
  try {
    const servers = await listServers(ctx, locals.user?.id, locals.user?.email);
    return json({ servers });
  } catch (e) {
    console.error('[GET /api/servers]', e);
    return json({ servers: [] });
  }
};
```

**Step 2: Update POST in `/api/servers/+server.ts`**

Pass `locals.user?.id` to `upsertServer`:

```ts
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getOrCreateTenantCtx(locals);
  try {
    const body = await request.json();
    await upsertServer(ctx, body, locals.user?.id);
    return json({ ok: true });
  } catch (e) {
    console.error('[POST /api/servers]', e);
    return json(
      { ok: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    );
  }
};
```

**Step 3: Check `[id]/+server.ts` for PUT**

Open `src/routes/api/servers/[id]/+server.ts`. Find the PUT handler that calls `upsertServer`. Add `locals.user?.id` as the third argument there too.

**Step 4: Commit**

```bash
git add src/routes/api/servers/+server.ts src/routes/api/servers/[id]/+server.ts
git commit -m "feat(api): pass user id/email to server service for filtering"
```

---

### Task 4: Add localStorage caching to `loadHosts`

**Files:**
- Modify: `src/lib/state/hosts.svelte.ts`

**Step 1: Update `loadHosts` to seed from cache then refresh**

Replace the existing `loadHosts` function:

```ts
const HOSTS_CACHE_KEY = 'minion-dash-hosts-cache';

export async function loadHosts() {
  // Seed state immediately from localStorage cache for instant UI
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(HOSTS_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as Host[];
        if (Array.isArray(cached) && cached.length > 0) {
          hostsState.hosts = cached;
        }
      }
    } catch { /* ignore corrupt cache */ }
  }

  // Fetch fresh data from DB
  try {
    const res = await fetch('/api/servers');
    if (res.ok) {
      const data = await res.json();
      hostsState.hosts = data.servers as Host[];
      // Persist fresh list to cache
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(HOSTS_CACHE_KEY, JSON.stringify(data.servers));
      }
    }
  } catch {
    // Keep cached hosts if network fails
  }

  // Restore last-active preference
  const lastId =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('minion-dash-last-host')
      : null;
  if (lastId && hostsState.hosts.some((h) => h.id === lastId)) {
    hostsState.activeHostId = lastId;
  } else if (hostsState.hosts.length > 0) {
    hostsState.activeHostId = hostsState.hosts[0].id;
  }
}
```

**Step 2: Invalidate cache in `addHost`, `updateHost`, `removeHost`**

Add a helper at the top:
```ts
function updateHostsCache(hosts: Host[]) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(HOSTS_CACHE_KEY, JSON.stringify(hosts));
  }
}
```

In `addHost`, after `hostsState.hosts.push(newHost)`:
```ts
updateHostsCache(hostsState.hosts);
```

In `updateHost`, after `Object.assign(h, updates)`:
```ts
updateHostsCache(hostsState.hosts);
```

In `removeHost`, after `hostsState.hosts = hostsState.hosts.filter(...)`:
```ts
updateHostsCache(hostsState.hosts);
```

**Step 3: Commit**

```bash
git add src/lib/state/hosts.svelte.ts
git commit -m "feat(hosts): localStorage caching for instant host list on load"
```

---

### Task 5: Push schema to production Turso

**Step 1: Push to production**

```bash
TURSO_DB_URL=<production-url> TURSO_DB_AUTH_TOKEN=<production-token> bun run db:push
```

Or if `.env` already has production credentials set:
```bash
bun run db:push
```

Expected: `user_servers` table created in Turso. No data loss.

**Step 2: Deploy to Vercel**

```bash
vercel --prod
```

Expected: build succeeds, deployment live at `minionhub.admin-console.dev`.

**Step 3: Verify**

1. Log in as a regular user → add a host → log out → log back in → host is still there
2. Log in as `admin@minion.hub` → can see all hosts from all users

---

### Task 6: Handle existing servers (migration)

Existing `servers` rows have no `user_servers` links. They will be invisible to non-admin users until linked.

**Step 1: Link existing servers to admin**

If there are existing servers that should be visible to someone, run a one-time migration query in `bun run db:studio` or add a seed script:

```ts
// One-time: link all existing servers to admin@minion.hub
const adminUser = await db.select({ id: user.id }).from(user).where(eq(user.email, 'admin@minion.hub')).limit(1);
if (adminUser[0]) {
  const allServers = await db.select({ id: servers.id }).from(servers);
  const now = Date.now();
  for (const s of allServers) {
    await db.insert(userServers).values({ userId: adminUser[0].id, serverId: s.id, createdAt: now }).onConflictDoNothing();
  }
}
```

This ensures the admin can see all pre-existing servers immediately after the migration.

---
