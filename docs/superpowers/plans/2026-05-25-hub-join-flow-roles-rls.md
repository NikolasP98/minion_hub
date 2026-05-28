# Self-Serve Join Flow + Roles / Visibility / RLS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let un-invited OAuth users get into an org (request→approve or opaque join link) instead of hitting a dead-end 403, and add a `super_admin` role tier with a config-driven super-views bundle, a single `can()` visibility layer, and PG-only RLS.

**Architecture:** New `join_request`/`join_link` tables live in Supabase Postgres (`@minion-stack/db` PG schema); membership is still written to Turso `member`. A pure `$lib/access/policy.ts` (`ACCESS` map + `can()`) gates routes, nav, and elements; `SUPER_VIEWS` auto-registers super-only routes. Server code uses the service-role Supabase client (bypasses RLS); RLS is defense-in-depth.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Bun, Vitest, Drizzle (PG schema in `@minion-stack/db`), `@supabase/supabase-js` (service role), Resend, Turso/libsql.

**Spec:** `docs/superpowers/specs/2026-05-25-hub-join-flow-roles-rls-design.md`

**Conventions to follow (verified in codebase):**
- Run a single test file: `bun run vitest run <path>`. All tests: `bun run test`. Typecheck: `bun run check`.
- Pure, `$env`-free modules are unit-testable directly; modules importing `$env`/`$app` need `vi.mock` (see `src/lib/state/features/user.svelte.test.ts` for the pattern).
- PG migrations: edit schema in `packages/db/src/pg/schema/`, run drizzle-kit to emit into repo-root `supabase/migrations/`; hand-write RLS/enum migrations as separate `.sql` files there (see `supabase/migrations/20260525233700_identity_rls.sql`).
- API routes: `requireAdmin(locals)` / `requireAuth(locals)` from `$server/auth/authorize`; return `json(...)`, throw `error(...)`.
- Resend pattern: `src/server/services/email.service.ts` (gracefully no-ops when `RESEND_API_KEY` unset).
- `page.data.user` = `{ id, supabaseId?, email, displayName, role }`; `page.data.permissions` = `{ permissions: string[] }`.

**Branch:** Work on `dev` (current) or a feature branch off `dev`. Do NOT commit to master.

---

## Phase 0 — Access Foundation

### Task 1: Widen the role type to include `super_admin`

**Files:**
- Modify: `src/app.d.ts:16`
- Modify: `src/server/auth/supabase-bridge.ts` (ProfileRow.role, BridgedUser.role, mapProfileToUser)
- Modify: `src/lib/state/features/user.svelte.ts:7` (UserRole)
- Modify: `src/server/auth/authorize.ts` (add `requireSuperAdmin`)
- Test: `src/server/auth/supabase-bridge.test.ts`

- [ ] **Step 1: Add a failing test for super_admin mapping**

In `src/server/auth/supabase-bridge.test.ts`, add:

```ts
test('maps super_admin role through', () => {
  const u = mapProfileToUser(
    { id: 'p1', email: 'a@b.c', display_name: 'A', role: 'super_admin', legacy_user_id: null },
    'uuid-1',
  );
  expect(u.role).toBe('super_admin');
});
```

- [ ] **Step 2: Run it — expect FAIL (type error / role narrows to 'admin'|'user')**

Run: `bun run vitest run src/server/auth/supabase-bridge.test.ts`
Expected: FAIL (compile error on `role: 'super_admin'`, or value not preserved).

- [ ] **Step 3: Widen the union and mapping**

In `src/server/auth/supabase-bridge.ts`:

```ts
export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: 'user' | 'admin' | 'super_admin' | null;
  legacy_user_id: string | null;
}

export interface BridgedUser {
  id: string;
  email: string;
  displayName: string | null;
  role: 'user' | 'admin' | 'super_admin';
  supabaseId: string;
}

export function mapProfileToUser(profile: ProfileRow, supabaseId: string): BridgedUser {
  const role =
    profile.role === 'super_admin' ? 'super_admin' : profile.role === 'admin' ? 'admin' : 'user';
  return {
    id: profile.legacy_user_id ?? supabaseId,
    email: profile.email ?? '',
    displayName: profile.display_name ?? null,
    role,
    supabaseId,
  };
}
```

In `src/app.d.ts:16` change `role: 'user' | 'admin';` → `role: 'user' | 'admin' | 'super_admin';`.

In `src/lib/state/features/user.svelte.ts:7` change `type UserRole = 'user' | 'admin';` → `type UserRole = 'user' | 'admin' | 'super_admin';`.

In `src/server/auth/authorize.ts` append:

```ts
/** Require a super-admin user. Throws 401 if not logged in, 403 otherwise. */
export function requireSuperAdmin(locals: App.Locals): AuthUser {
  const user = requireAuth(locals);
  if (user.role !== 'super_admin') throw error(403, 'Super-admin access required');
  return user;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun run vitest run src/server/auth/supabase-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.d.ts src/server/auth/supabase-bridge.ts src/lib/state/features/user.svelte.ts src/server/auth/authorize.ts src/server/auth/supabase-bridge.test.ts
git commit -m "feat(auth): add super_admin role tier to types and bridge"
```

---

### Task 2: Access policy + super-views registry (`can()`)

**Files:**
- Create: `src/lib/access/super-views.ts`
- Create: `src/lib/access/policy.ts`
- Test: `src/lib/access/policy.test.ts`

- [ ] **Step 1: Write the super-views registry**

`src/lib/access/super-views.ts`:

```ts
/** Curated bundle of super-admin-only views. Add one entry per super-only view. */
export const SUPER_VIEWS = [
  { key: 'reliability.monitor', route: '/reliability', navLabel: 'Reliability' },
  { key: 'orgs.all', route: '/orgs', navLabel: 'All Orgs' },
  { key: 'config.editor', route: '/config', navLabel: 'Config' },
] as const;

export type SuperViewKey = (typeof SUPER_VIEWS)[number]['key'];
```

- [ ] **Step 2: Write failing tests for `can()`**

`src/lib/access/policy.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { can } from './policy';

const user = { role: 'user' as const };
const admin = { role: 'admin' as const };
const sa = { role: 'super_admin' as const };

describe('can()', () => {
  test('admin-min cap: user denied, admin allowed, super allowed', () => {
    expect(can('users.manage', user)).toBe(false);
    expect(can('users.manage', admin)).toBe(true);
    expect(can('users.manage', sa)).toBe(true);
  });
  test('super-view cap: only super_admin', () => {
    expect(can('reliability.monitor', admin)).toBe(false);
    expect(can('reliability.monitor', sa)).toBe(true);
  });
  test('permission cap: granted via permission set', () => {
    expect(can('agents.publish', user, new Set(['marketplace:publish']))).toBe(true);
    expect(can('agents.publish', user, new Set())).toBe(false);
  });
  test('unknown key denies', () => {
    expect(can('nope', sa)).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL (module missing)**

Run: `bun run vitest run src/lib/access/policy.test.ts`
Expected: FAIL ("Cannot find module './policy'").

- [ ] **Step 4: Implement `policy.ts`**

`src/lib/access/policy.ts`:

```ts
import { SUPER_VIEWS } from './super-views';

type UserRole = 'user' | 'admin' | 'super_admin';
type Capability = { minRole?: UserRole; permission?: string };

const ROLE_RANK: Record<UserRole, number> = { user: 0, admin: 1, super_admin: 2 };

const BASE_ACCESS: Record<string, Capability> = {
  'users.manage': { minRole: 'admin' },
  'agents.publish': { permission: 'marketplace:publish' },
};

/** Super-view keys auto-register as super_admin-only. */
const SUPER_ACCESS: Record<string, Capability> = Object.fromEntries(
  SUPER_VIEWS.map((v) => [v.key, { minRole: 'super_admin' } as Capability]),
);

export const ACCESS: Record<string, Capability> = { ...BASE_ACCESS, ...SUPER_ACCESS };

/** Pure capability check. `perms` is the user's permission-string set. */
export function can(key: string, user?: { role: UserRole } | null, perms?: Set<string>): boolean {
  const cap = ACCESS[key];
  if (!cap) return false;
  const rank = ROLE_RANK[user?.role ?? 'user'];
  if (cap.minRole && rank >= ROLE_RANK[cap.minRole]) return true;
  if (cap.permission && perms?.has(cap.permission)) return true;
  return false;
}

/** Route → required access key, derived from SUPER_VIEWS (for server guards). */
export const ROUTE_ACCESS: Record<string, string> = Object.fromEntries(
  SUPER_VIEWS.map((v) => [v.route, v.key]),
);
```

- [ ] **Step 5: Run — expect PASS**

Run: `bun run vitest run src/lib/access/policy.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/lib/access/
git commit -m "feat(access): add can() policy layer and super-views registry"
```

---

### Task 3: `<RoleGate>` component + client `can` wrapper

**Files:**
- Create: `src/lib/access/can.svelte.ts`
- Create: `src/lib/components/access/RoleGate.svelte`
- Test: `src/lib/access/can.svelte.test.ts`

- [ ] **Step 1: Failing test for the client wrapper**

`src/lib/access/can.svelte.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';

vi.mock('$app/state', () => ({
  page: { data: { user: { role: 'admin' }, permissions: { permissions: ['marketplace:publish'] } } },
}));

describe('canClient', () => {
  test('reads role + permissions from page.data', async () => {
    const { canClient } = await import('./can.svelte');
    expect(canClient('users.manage')).toBe(true);
    expect(canClient('reliability.monitor')).toBe(false);
    expect(canClient('agents.publish')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `bun run vitest run src/lib/access/can.svelte.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the wrapper**

`src/lib/access/can.svelte.ts`:

```ts
import { page } from '$app/state';
import { can } from './policy';

/** Client-side capability check sourced from `page.data`. */
export function canClient(key: string): boolean {
  const user = (page.data as any)?.user ?? null;
  const perms: string[] = (page.data as any)?.permissions?.permissions ?? [];
  return can(key, user, new Set(perms));
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/lib/access/can.svelte.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement RoleGate (no test — trivial render wrapper)**

`src/lib/components/access/RoleGate.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { canClient } from '$lib/access/can.svelte';
  let { key, children, fallback }: { key: string; children: Snippet; fallback?: Snippet } = $props();
</script>

{#if canClient(key)}
  {@render children()}
{:else if fallback}
  {@render fallback()}
{/if}
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/access/can.svelte.ts src/lib/access/can.svelte.test.ts src/lib/components/access/RoleGate.svelte
git commit -m "feat(access): add canClient wrapper and RoleGate component"
```

---

## Phase 1 — Data Model

### Task 4: PG schema for `join_request` and `join_link`

**Files:**
- Create: `packages/db/src/pg/schema/join.ts`
- Modify: `packages/db/src/pg/schema/index.ts`

> Paths below are relative to repo root (`packages/db/...`). Run drizzle from `packages/db`.

- [ ] **Step 1: Write the schema**

`packages/db/src/pg/schema/join.ts`:

```ts
import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

// Partial unique index (one open request per user/org) is created in the
// hand-written migration (Task 5), since the WHERE-predicate form isn't
// expressed cleanly here. Keep this table definition free of an index callback.
export const joinRequest = pgTable('join_request', {
  id: uuid('id').primaryKey().defaultRandom(),
  supabaseId: uuid('supabase_id').notNull(),
  userId: text('user_id').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  message: text('message'),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).notNull().default('pending'),
  organizationId: text('organization_id').notNull(),
  requestedRole: text('requested_role').notNull().default('user'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const joinLink = pgTable('join_link', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(),
  organizationId: text('organization_id').notNull(),
  role: text('role').notNull(),
  createdBy: text('created_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  maxUses: integer('max_uses'),
  usesCount: integer('uses_count').notNull().default(0),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

> Note: the partial unique index predicate (`WHERE status='pending'`) can't be expressed inline cleanly in this drizzle version. Remove the `(t) => [...]` arg here and instead create the partial index in the hand-written migration (Task 5). Keep the table definition above without the index callback.

- [ ] **Step 2: Export from index**

In `packages/db/src/pg/schema/index.ts` add:

```ts
export { joinRequest, joinLink } from './join.js';
```

- [ ] **Step 3: Generate the migration**

```bash
cd packages/db
SUPABASE_DB_URL_DIRECT="$SUPABASE_DB_URL_DIRECT" bunx drizzle-kit generate --config drizzle.pg.config.ts
```
Expected: a new `supabase/migrations/<timestamp>_*.sql` creating `join_request` and `join_link`.

- [ ] **Step 4: Verify it typechecks**

```bash
cd packages/db && bunx tsc --noEmit -p tsconfig.json 2>/dev/null || bun run build
```
Expected: no type errors in `join.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/pg/schema/join.ts packages/db/src/pg/schema/index.ts supabase/migrations/
git commit -m "feat(db): add join_request and join_link PG tables"
```

---

### Task 5: Migrations — widen `profiles.role` enum, partial index, RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_join_and_super_admin_rls.sql` (hand-written; use the next timestamp after Task 4's generated file)

- [ ] **Step 1: Write the SQL migration**

```sql
-- Widen profiles.role to include super_admin (column is a text check, not a PG enum type).
alter table public.profiles drop constraint if exists profiles_role_check;
--> statement-breakpoint
alter table public.profiles
  add constraint profiles_role_check check (role in ('user','admin','super_admin'));
--> statement-breakpoint

-- Partial unique index: one open request per (user, org).
create unique index if not exists uq_join_request_pending
  on public.join_request (user_id, organization_id)
  where status = 'pending';
--> statement-breakpoint

-- Enable RLS (defense-in-depth; server uses service role and bypasses these).
alter table public.join_request enable row level security;
--> statement-breakpoint
alter table public.join_link enable row level security;
--> statement-breakpoint

-- Requester can read/insert their own requests.
create policy "join_request_self_select" on public.join_request
  for select using (auth.uid() = supabase_id);
--> statement-breakpoint
create policy "join_request_self_insert" on public.join_request
  for insert with check (auth.uid() = supabase_id);
--> statement-breakpoint

-- Admin / super-admin can read + update all requests.
create policy "join_request_admin_all" on public.join_request
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );
--> statement-breakpoint

-- Join links: admin / super-admin only, all ops.
create policy "join_link_admin_all" on public.join_link
  for all using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role in ('admin','super_admin'))
  );
```

- [ ] **Step 2: Apply via the Supabase MCP (remote project)**

Apply the migration to the Supabase project using `mcp__supabase__apply_migration` with the SQL above (name: `join_and_super_admin_rls`). Confirm with `mcp__supabase__list_migrations`.

> If the Supabase GitHub integration auto-applies `supabase/migrations/`, committing is sufficient — but apply via MCP now so dev/testing works immediately.

- [ ] **Step 3: Verify tables + policies exist**

Use `mcp__supabase__list_tables` and confirm `join_request`, `join_link` exist with RLS enabled.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): widen profiles.role enum, add join partial index + RLS policies"
```

---

## Phase 2 — Services

### Task 6: Pure helpers — token + link validity

**Files:**
- Create: `src/server/services/join/helpers.ts`
- Test: `src/server/services/join/helpers.test.ts`

- [ ] **Step 1: Failing tests**

`src/server/services/join/helpers.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { generateOpaqueToken, isLinkUsable } from './helpers';

describe('generateOpaqueToken', () => {
  test('is url-safe and unique', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('isLinkUsable', () => {
  const now = new Date('2026-05-25T00:00:00Z');
  const base = { revoked: false, expiresAt: null as Date | null, maxUses: null as number | null, usesCount: 0 };
  test('usable by default', () => expect(isLinkUsable(base, now)).toBe(true));
  test('revoked → false', () => expect(isLinkUsable({ ...base, revoked: true }, now)).toBe(false));
  test('expired → false', () =>
    expect(isLinkUsable({ ...base, expiresAt: new Date('2026-05-24T00:00:00Z') }, now)).toBe(false));
  test('maxed → false', () =>
    expect(isLinkUsable({ ...base, maxUses: 2, usesCount: 2 }, now)).toBe(false));
  test('under max → true', () =>
    expect(isLinkUsable({ ...base, maxUses: 2, usesCount: 1 }, now)).toBe(true));
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run vitest run src/server/services/join/helpers.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/server/services/join/helpers.ts`:

```ts
import { randomBytes } from 'node:crypto';

export function generateOpaqueToken(): string {
  return randomBytes(24).toString('base64url'); // 32 url-safe chars
}

export interface LinkUsability {
  revoked: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usesCount: number;
}

export function isLinkUsable(link: LinkUsability, now: Date = new Date()): boolean {
  if (link.revoked) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= now.getTime()) return false;
  if (link.maxUses != null && link.usesCount >= link.maxUses) return false;
  return true;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/server/services/join/helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/join/helpers.ts src/server/services/join/helpers.test.ts
git commit -m "feat(join): add opaque token + link-validity helpers"
```

---

### Task 7: `createMembership` (Turso) shared helper

**Files:**
- Create: `src/server/services/join/membership.ts`
- Test: `src/server/services/join/membership.test.ts`

- [ ] **Step 1: Failing test (in-memory libsql)**

`src/server/services/join/membership.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { member, user, organization } from '@minion-stack/db/schema';
import { createMembership } from './membership';

function freshDb() {
  const client = createClient({ url: ':memory:' });
  const db = drizzle(client);
  return { db, client };
}

describe('createMembership', () => {
  test('inserts member + ensures user row; idempotent', async () => {
    const { db } = freshDb();
    // minimal schema bootstrap
    await db.run(`create table organization (id text primary key, name text, slug text, created_at integer, metadata text, logo text)`);
    await db.run(`create table "user" (id text primary key, name text, email text, email_verified integer, image text, created_at integer, updated_at integer, personal_agent_id text, role text, alias text, role_id text)`);
    await db.run(`create table member (id text primary key, organization_id text, user_id text, role text, created_at integer)`);
    await db.insert(organization).values({ id: 'org1', name: 'Org', slug: 'org', createdAt: 0 } as any);

    await createMembership(db as any, { id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user');
    await createMembership(db as any, { id: 'u1', email: 'a@b.c', displayName: 'A' }, 'org1', 'user'); // idempotent

    const members = await db.select().from(member).where(eq(member.userId, 'u1'));
    const users = await db.select().from(user).where(eq(user.id, 'u1'));
    expect(members.length).toBe(1);
    expect(users.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run vitest run src/server/services/join/membership.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/server/services/join/membership.ts`:

```ts
import { eq, and } from 'drizzle-orm';
import { member, user, organization } from '@minion-stack/db/schema';
import type { Db } from '$server/db/client';

export interface MembershipUser {
  id: string;
  email: string;
  displayName: string | null;
}

/**
 * Ensure a Turso `user` row exists and the user is a `member` of `orgId`.
 * Idempotent: re-running with the same user/org is a no-op. The user row keeps
 * the bridged id (legacy_user_id ?? supabaseId) so the (app) layout resolves it.
 */
export async function createMembership(
  db: Db,
  u: MembershipUser,
  orgId: string,
  role: string,
): Promise<void> {
  const now = Date.now();
  const existingUser = await db.select({ id: user.id }).from(user).where(eq(user.id, u.id)).limit(1);
  if (existingUser.length === 0) {
    await db.insert(user).values({
      id: u.id,
      name: u.displayName ?? u.email.split('@')[0],
      email: u.email,
      emailVerified: true,
      image: null,
      createdAt: now,
      updatedAt: now,
      personalAgentId: `personal-${u.id}`,
      role: 'user',
      alias: null,
      roleId: null,
    } as any);
  }
  const existingMember = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, u.id), eq(member.organizationId, orgId)))
    .limit(1);
  if (existingMember.length === 0) {
    await db.insert(member).values({
      id: `m-${u.id.slice(0, 12)}-${orgId.slice(0, 8)}`,
      organizationId: orgId,
      userId: u.id,
      role: role === 'admin' ? 'admin' : 'member',
      createdAt: now,
    } as any);
  }
  void organization; // imported for schema clarity / future org validation
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/server/services/join/membership.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/join/membership.ts src/server/services/join/membership.test.ts
git commit -m "feat(join): add idempotent createMembership Turso helper"
```

---

### Task 8: `join-requests.service`

**Files:**
- Create: `src/server/services/join/requests.service.ts`
- Test: `src/server/services/join/requests.service.test.ts`

> This service uses `supabaseAdmin()` (PG) for request rows and `getDb()` (Turso) for membership on approve. Tests mock both.

- [ ] **Step 1: Failing test (mocked supabase + db + email)**

`src/server/services/join/requests.service.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const calls: any = {};
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      insert: (row: any) => ({ select: () => ({ single: async () => ((calls.inserted = row), { data: { id: 'r1', ...row }, error: null }) }) }),
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: calls.pending ?? null, error: null }) }) }),
        in: () => ({ data: calls.admins ?? [], error: null }),
      }),
      update: (patch: any) => ({ eq: () => ({ select: () => ({ single: async () => ((calls.updated = patch), { data: { id: 'r1', ...calls.row, ...patch }, error: null }) }) }) }),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({ createMembership: vi.fn(async () => { calls.membership = true; }) }));
vi.mock('$server/services/email.service', () => ({ sendJoinRequestEmail: vi.fn(async () => { calls.email = true; }) }));

beforeEach(() => { for (const k of Object.keys(calls)) delete calls[k]; });

describe('requests.service', () => {
  test('createRequest inserts pending + emails admins', async () => {
    const { createRequest } = await import('./requests.service');
    calls.admins = [{ email: 'admin@x.io', role: 'admin' }];
    const r = await createRequest({ id: 'u1', supabaseId: 's1', email: 'a@b.c', displayName: 'A' }, 'org1', 'hello');
    expect(calls.inserted.status).toBe('pending');
    expect(calls.email).toBe(true);
    expect(r.id).toBe('r1');
  });

  test('approve creates membership + marks approved', async () => {
    const { approveRequest } = await import('./requests.service');
    calls.row = { user_id: 'u1', email: 'a@b.c', display_name: 'A', organization_id: 'org1' };
    await approveRequest('r1', { reviewerId: 'admin1', role: 'user', organizationId: 'org1' });
    expect(calls.membership).toBe(true);
    expect(calls.updated.status).toBe('approved');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run vitest run src/server/services/join/requests.service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/server/services/join/requests.service.ts`:

```ts
import { supabaseAdmin } from '$server/supabase';
import { getDb } from '$server/db/client';
import { createMembership } from './membership';
import { sendJoinRequestEmail } from '$server/services/email.service';

export interface Requester {
  id: string;
  supabaseId: string;
  email: string;
  displayName: string | null;
}

export interface JoinRequestRow {
  id: string;
  user_id: string;
  supabase_id: string;
  email: string;
  display_name: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'denied';
  organization_id: string;
  requested_role: string;
}

export async function createRequest(
  who: Requester,
  organizationId: string,
  message?: string,
): Promise<{ id: string; status: string }> {
  const sb = supabaseAdmin();

  // Idempotent: return existing pending request if present.
  const { data: existing } = await sb
    .from('join_request')
    .select('id,status')
    .eq('user_id', who.id)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) return existing as { id: string; status: string };

  const { data, error } = await sb
    .from('join_request')
    .insert({
      supabase_id: who.supabaseId,
      user_id: who.id,
      email: who.email,
      display_name: who.displayName,
      message: message ?? null,
      status: 'pending',
      organization_id: organizationId,
      requested_role: 'user',
    })
    .select()
    .single();
  if (error) throw new Error(`createRequest failed: ${error.message}`);

  // Notify all admin + super-admin users.
  const { data: admins } = await sb
    .from('profiles')
    .select('email,role')
    .in('role', ['admin', 'super_admin']);
  for (const a of admins ?? []) {
    if (a.email) await sendJoinRequestEmail({ to: a.email, requesterEmail: who.email, requesterName: who.displayName ?? who.email });
  }

  return data as { id: string; status: string };
}

export async function listPendingRequests(): Promise<JoinRequestRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('join_request')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as JoinRequestRow[];
}

export async function approveRequest(
  id: string,
  opts: { reviewerId: string; role: string; organizationId: string },
): Promise<void> {
  const sb = supabaseAdmin();
  const { data: row, error: readErr } = await sb.from('join_request').select('*').eq('id', id).single();
  if (readErr || !row) throw new Error('request not found');
  if (row.status !== 'pending') return; // no-op

  await createMembership(
    getDb(),
    { id: row.user_id, email: row.email, displayName: row.display_name },
    opts.organizationId,
    opts.role,
  );

  const { error } = await sb
    .from('join_request')
    .update({ status: 'approved', reviewed_by: opts.reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
}

export async function denyRequest(id: string, reviewerId: string): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('join_request')
    .update({ status: 'denied', reviewed_by: reviewerId, reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/server/services/join/requests.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/join/requests.service.ts src/server/services/join/requests.service.test.ts
git commit -m "feat(join): add join-requests service (create/list/approve/deny)"
```

---

### Task 9: `join-links.service`

**Files:**
- Create: `src/server/services/join/links.service.ts`
- Test: `src/server/services/join/links.service.test.ts`

- [ ] **Step 1: Failing test (mocked supabase + db + membership)**

`src/server/services/join/links.service.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest';

const state: any = {};
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (row: any) => ({ select: () => ({ single: async () => ({ data: { id: 'l1', ...row }, error: null }) }) }),
      select: () => ({ eq: () => ({ single: async () => ({ data: state.link ?? null, error: state.link ? null : { message: 'none' } }) }) }),
      update: (patch: any) => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: state.consumeOk ? [{ id: 'l1' }] : [], error: null }) }) }), }),
    }),
  }),
}));
vi.mock('$server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('./membership', () => ({ createMembership: vi.fn(async () => { state.membership = true; }) }));

beforeEach(() => { for (const k of Object.keys(state)) delete state[k]; });

describe('links.service', () => {
  test('createLink returns token URL', async () => {
    const { createLink } = await import('./links.service');
    const l = await createLink({ organizationId: 'org1', role: 'user', createdBy: 'admin1' });
    expect(l.token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('consumeLink rejects unusable link', async () => {
    const { consumeLink } = await import('./links.service');
    state.link = { id: 'l1', token: 't', organization_id: 'org1', role: 'user', revoked: true, expires_at: null, max_uses: null, uses_count: 0 };
    await expect(consumeLink('t', { id: 'u1', email: 'a@b.c', displayName: 'A' })).rejects.toThrow();
    expect(state.membership).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run vitest run src/server/services/join/links.service.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

`src/server/services/join/links.service.ts`:

```ts
import { supabaseAdmin } from '$server/supabase';
import { getDb } from '$server/db/client';
import { createMembership, type MembershipUser } from './membership';
import { generateOpaqueToken, isLinkUsable } from './helpers';

export interface JoinLinkRow {
  id: string;
  token: string;
  organization_id: string;
  role: string;
  revoked: boolean;
  expires_at: string | null;
  max_uses: number | null;
  uses_count: number;
}

export async function createLink(opts: {
  organizationId: string;
  role: string;
  createdBy: string;
  expiresAt?: string | null;
  maxUses?: number | null;
}): Promise<{ id: string; token: string }> {
  const token = generateOpaqueToken();
  const { data, error } = await supabaseAdmin()
    .from('join_link')
    .insert({
      token,
      organization_id: opts.organizationId,
      role: opts.role,
      created_by: opts.createdBy,
      expires_at: opts.expiresAt ?? null,
      max_uses: opts.maxUses ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return { id: (data as any).id, token };
}

export async function resolveLink(token: string): Promise<JoinLinkRow | null> {
  const { data } = await supabaseAdmin().from('join_link').select('*').eq('token', token).single();
  return (data as JoinLinkRow) ?? null;
}

/**
 * Validate + consume a link: creates membership and atomically increments
 * uses_count guarding max_uses. Throws if the link is unusable or the race lost.
 */
export async function consumeLink(token: string, u: MembershipUser): Promise<{ organizationId: string }> {
  const link = await resolveLink(token);
  if (!link) throw new Error('link not found');
  const usable = isLinkUsable(
    {
      revoked: link.revoked,
      expiresAt: link.expires_at ? new Date(link.expires_at) : null,
      maxUses: link.max_uses,
      usesCount: link.uses_count,
    },
    new Date(),
  );
  if (!usable) throw new Error('link not usable');

  // Atomic guard: only succeeds while uses_count < max_uses (or max_uses null).
  const sb = supabaseAdmin();
  if (link.max_uses != null) {
    const { data: bumped } = await sb
      .from('join_link')
      .update({ uses_count: link.uses_count + 1 })
      .eq('token', token)
      .lt('uses_count', link.max_uses)
      .select();
    if (!bumped || bumped.length === 0) throw new Error('link no longer available');
  } else {
    await sb.from('join_link').update({ uses_count: link.uses_count + 1 }).eq('token', token);
  }

  await createMembership(getDb(), u, link.organization_id, link.role);
  return { organizationId: link.organization_id };
}

export async function listLinks(): Promise<JoinLinkRow[]> {
  const { data, error } = await supabaseAdmin().from('join_link').select('*').eq('revoked', false);
  if (error) throw new Error(error.message);
  return (data ?? []) as JoinLinkRow[];
}

export async function revokeLink(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from('join_link').update({ revoked: true }).eq('id', id);
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/server/services/join/links.service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/join/links.service.ts src/server/services/join/links.service.test.ts
git commit -m "feat(join): add join-links service (create/resolve/consume/revoke)"
```

---

### Task 10: `sendJoinRequestEmail`

**Files:**
- Modify: `src/server/services/email.service.ts` (append a new exported function)
- Test: `src/server/services/email.join.test.ts`

- [ ] **Step 1: Failing test (no API key → graceful skip)**

`src/server/services/email.join.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest';
vi.mock('$env/dynamic/private', () => ({ env: {} })); // no RESEND_API_KEY

describe('sendJoinRequestEmail', () => {
  test('no-ops gracefully when RESEND_API_KEY unset', async () => {
    const { sendJoinRequestEmail } = await import('./email.service');
    await expect(
      sendJoinRequestEmail({ to: 'admin@x.io', requesterEmail: 'a@b.c', requesterName: 'A' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bun run vitest run src/server/services/email.service.test.ts`  (file does not exist yet — use the new file)
Run: `bun run vitest run src/server/services/email.join.test.ts`
Expected: FAIL (function not exported).

- [ ] **Step 3: Implement (append to `email.service.ts`)**

```ts
interface JoinRequestEmailParams {
  to: string;
  requesterEmail: string;
  requesterName: string;
}

export async function sendJoinRequestEmail(params: JoinRequestEmailParams): Promise<void> {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping join-request email to ${params.to}.`);
    return;
  }
  const from = env.RESEND_FROM ?? 'Minion Hub <noreply@minion-ai.org>';
  const reviewUrl = `${env.PUBLIC_APP_URL ?? 'https://hub.minion-ai.org'}/users?tab=join-requests`;
  const html = `
<!DOCTYPE html><html><body style="margin:0;background:#0a0a0f;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#13131a;border:1px solid #1e1e2e;border-radius:12px">
<tr><td style="padding:32px;text-align:center">
  <h1 style="color:#e4e4e7;font-size:18px;margin:0 0 8px">New access request</h1>
  <p style="color:#71717a;font-size:14px;margin:0 0 24px;line-height:1.5">
    <strong style="color:#a1a1aa">${params.requesterName}</strong> (${params.requesterEmail}) requested to join Minion Hub.
  </p>
  <a href="${reviewUrl}" style="display:inline-block;background:#e91e8c;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 32px;border-radius:8px">Review request</a>
</td></tr></table></td></tr></table></body></html>`.trim();
  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: `Access request from ${params.requesterName} on Minion Hub`,
      html,
    });
  } catch (err) {
    console.error('[email] Failed to send join-request email:', err);
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `bun run vitest run src/server/services/email.join.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/email.service.ts src/server/services/email.join.test.ts
git commit -m "feat(email): add sendJoinRequestEmail notification"
```

---

## Phase 3 — Routes / API

### Task 11: Gate change + `/join` route

**Files:**
- Modify: `src/routes/(app)/+layout.server.ts:50-60`
- Create: `src/routes/join/+page.server.ts`
- Create: `src/routes/join/+page.svelte`
- Modify: `src/hooks.server.ts` (ensure `/join` is auth-required but not membership-gated — it already is, being outside `(app)`)

- [ ] **Step 1: Change the no-org branch to redirect (not 403)**

In `src/routes/(app)/+layout.server.ts`, replace the `if (memberships.length === 0)` block:

```ts
    if (memberships.length === 0) {
      // Super-admins operate cross-org and are never gated on membership.
      if (user.role !== 'super_admin') {
        throw redirect(303, '/join');
      }
    } else {
      const orgId = memberships[0].orgId;
      // …existing activeOrganizationId persistence + locals seeding…
    }
```

Add `redirect` to the import: `import { error, redirect } from '@sveltejs/kit';`. Keep the existing org-activation code inside the `else`/`memberships.length > 0` path (move lines 62-83 under it). For super-admins with no membership, seed a best-effort ctx: pick the first organization in the DB so queries work:

```ts
      if (user.role === 'super_admin') {
        const [firstOrg] = await db.select({ id: organization.id }).from(organization).limit(1);
        if (firstOrg) { locals.orgId = firstOrg.id; locals.tenantCtx = { db, tenantId: firstOrg.id }; }
      }
```

Add `organization` to the schema import on line 11.

- [ ] **Step 2: Write the `/join` server load**

`src/routes/join/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { consumeLink } from '$server/services/join/links.service';

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireAuth(locals); // redirects handled by hooks if unauth
  const token = url.searchParams.get('token');

  if (token) {
    try {
      await consumeLink(token, { id: user.id, email: user.email, displayName: user.displayName });
      throw redirect(303, '/');
    } catch (e) {
      if (e instanceof Response) throw e; // re-throw redirect
      return { linkError: true, email: user.email, displayName: user.displayName };
    }
  }
  return { linkError: false, email: user.email, displayName: user.displayName };
};
```

> Note: `requireAuth` throws 401, but an unauthenticated user reaching `/join` should go to `/login`. Confirm `hooks.server.ts` redirects unauth users on protected paths to `/login`; `/join` must NOT be in the unprotected list (so the redirect applies). If hooks only protects `(app)`, add `/join` to the authenticated-paths check.

- [ ] **Step 3: Write the `/join` page**

`src/routes/join/+page.svelte`:

```svelte
<script lang="ts">
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { logout } from '$lib/state/features/user.svelte';
  const { data } = $props();
  let message = $state('');
  let submitting = $state(false);
  let submitted = $state(false);
  let errorMsg = $state<string | null>(null);

  async function submitRequest() {
    if (submitting) return;
    submitting = true; errorMsg = null;
    const res = await fetch('/api/join-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    submitting = false;
    if (res.ok) submitted = true;
    else errorMsg = 'Could not submit your request. Please try again.';
  }
</script>

<div class="relative z-10 flex items-center justify-center min-h-screen">
  <div class="w-full max-w-sm mx-4">
    <div class="bg-bg2 border border-border rounded-lg overflow-hidden shadow-2xl">
      <div class="relative px-5 py-3.5 border-b border-border bg-bg/60 flex items-center justify-between">
        <ScanLine speed={10} opacity={0.025} />
        <span class="text-[10px] font-mono text-muted uppercase tracking-widest">request access</span>
        <div class="flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-red-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-yellow-500/60"></span>
          <span class="w-2 h-2 rounded-full bg-green-500/60"></span>
        </div>
      </div>
      <div class="px-6 py-8 text-center">
        <div class="inline-flex items-center select-none leading-none mb-5">
          <span class="bg-brand-pink text-black font-black text-[13px] tracking-wide px-2 py-0.5 rounded-l-md uppercase">MINION</span>
          <span class="text-white font-bold text-[13px] px-1.5 py-0.5">hub</span>
        </div>

        {#if submitted}
          <h1 class="text-lg font-semibold text-foreground mb-2">Request sent</h1>
          <p class="text-sm text-muted mb-6">You'll get access once an admin approves your request.</p>
          <button onclick={() => logout()} class="w-full px-4 py-2 rounded border text-sm font-mono bg-bg border-border text-muted hover:text-foreground hover:border-accent/40">Sign out</button>
        {:else}
          {#if data.linkError}
            <p class="text-[11px] font-mono text-yellow-400 bg-yellow-400/8 border border-yellow-400/20 rounded px-3 py-2 mb-4">That invite link is invalid or expired. You can request access below.</p>
          {/if}
          <h1 class="text-lg font-semibold text-foreground mb-2">You're not in a workspace yet</h1>
          <p class="text-sm text-muted mb-5">Signed in as {data.email}. Request access and an admin will let you in.</p>
          <textarea bind:value={message} rows="3" placeholder="Optional: a note for the admin"
            class="w-full bg-bg border border-border rounded px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/60 mb-3"></textarea>
          {#if errorMsg}<div class="text-[11px] font-mono text-red-400 bg-red-400/8 border border-red-400/20 rounded px-3 py-2 mb-3">{errorMsg}</div>{/if}
          <button onclick={submitRequest} disabled={submitting}
            class="w-full px-4 py-2 rounded border text-sm font-mono bg-accent/20 border-accent/30 text-accent hover:bg-accent/30 disabled:opacity-50">
            {submitting ? 'Sending…' : 'Request access'}
          </button>
          <button onclick={() => logout()} class="w-full mt-2 px-4 py-2 rounded border text-sm font-mono bg-bg border-border text-muted hover:text-foreground hover:border-accent/40">Sign out</button>
        {/if}
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Manual verification**

Run `bun run dev`. As a no-org user, visit `/my-agent` → should redirect to `/join`. Submit a request → "Request sent". Visit `/join?token=BADTOKEN` → link-error message.

- [ ] **Step 5: Typecheck + commit**

```bash
bun run check
git add "src/routes/(app)/+layout.server.ts" src/routes/join/ src/hooks.server.ts
git commit -m "feat(join): redirect no-org users to /join request page"
```

---

### Task 12: API — join-requests endpoints

**Files:**
- Create: `src/routes/api/join-requests/+server.ts` (POST create, GET list)
- Create: `src/routes/api/join-requests/[id]/approve/+server.ts`
- Create: `src/routes/api/join-requests/[id]/deny/+server.ts`

- [ ] **Step 1: Create POST/GET endpoint**

`src/routes/api/join-requests/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAuth, requireAdmin } from '$server/auth/authorize';
import { createRequest, listPendingRequests } from '$server/services/join/requests.service';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  if (!user.supabaseId) throw error(400, 'supabase session required');
  const body = (await request.json().catch(() => ({}))) as { message?: string };
  const [defaultOrg] = await getDb().select({ id: organization.id }).from(organization).limit(1);
  if (!defaultOrg) throw error(500, 'no organization configured');
  const r = await createRequest(
    { id: user.id, supabaseId: user.supabaseId, email: user.email, displayName: user.displayName },
    defaultOrg.id,
    body.message,
  );
  return json({ ok: true, id: r.id, status: r.status });
};

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ requests: await listPendingRequests() });
};
```

- [ ] **Step 2: Create approve endpoint**

`src/routes/api/join-requests/[id]/approve/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { approveRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const admin = requireAdmin(locals);
  const body = (await request.json().catch(() => ({}))) as { role?: string; organizationId?: string };
  if (!body.organizationId) throw error(400, 'organizationId required');
  await approveRequest(params.id!, {
    reviewerId: admin.id,
    role: body.role ?? 'user',
    organizationId: body.organizationId,
  });
  return json({ ok: true });
};
```

- [ ] **Step 3: Create deny endpoint**

`src/routes/api/join-requests/[id]/deny/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { denyRequest } from '$server/services/join/requests.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  const admin = requireAdmin(locals);
  await denyRequest(params.id!, admin.id);
  return json({ ok: true });
};
```

- [ ] **Step 4: Typecheck + commit**

```bash
bun run check
git add src/routes/api/join-requests/
git commit -m "feat(api): join-requests endpoints (create/list/approve/deny)"
```

---

### Task 13: API — join-links endpoints

**Files:**
- Create: `src/routes/api/join-links/+server.ts` (POST create, GET list)
- Create: `src/routes/api/join-links/[id]/revoke/+server.ts`

- [ ] **Step 1: Create POST/GET endpoint**

`src/routes/api/join-links/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { createLink, listLinks } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const admin = requireAdmin(locals);
  const b = (await request.json().catch(() => ({}))) as {
    organizationId?: string; role?: string; expiresAt?: string | null; maxUses?: number | null;
  };
  if (!b.organizationId || !b.role) throw error(400, 'organizationId and role required');
  const { id, token } = await createLink({
    organizationId: b.organizationId,
    role: b.role,
    createdBy: admin.id,
    expiresAt: b.expiresAt ?? null,
    maxUses: b.maxUses ?? null,
  });
  return json({ ok: true, id, url: `${url.origin}/join?token=${token}` });
};

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  return json({ links: await listLinks() });
};
```

- [ ] **Step 2: Create revoke endpoint**

`src/routes/api/join-links/[id]/revoke/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { revokeLink } from '$server/services/join/links.service';

export const POST: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  await revokeLink(params.id!);
  return json({ ok: true });
};
```

- [ ] **Step 3: Typecheck + commit**

```bash
bun run check
git add src/routes/api/join-links/
git commit -m "feat(api): join-links endpoints (create/list/revoke)"
```

---

## Phase 4 — Admin UI + Visibility Wiring

### Task 14: Join-requests admin page

**Files:**
- Create: `src/routes/(app)/users/join-requests/+page.server.ts`
- Create: `src/routes/(app)/users/join-requests/+page.svelte`

> Gated by `users.manage` (admin+). Uses the API endpoints from Tasks 12-13.

- [ ] **Step 1: Server load (guard + fetch pending + orgs)**

`src/routes/(app)/users/join-requests/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { listPendingRequests } from '$server/services/join/requests.service';
import { listLinks } from '$server/services/join/links.service';
import { getDb } from '$server/db/client';
import { organization } from '@minion-stack/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('users.manage', locals.user)) throw error(403, 'Admin access required');
  const orgs = await getDb().select({ id: organization.id, name: organization.name }).from(organization);
  return {
    requests: await listPendingRequests(),
    links: await listLinks(),
    orgs,
  };
};
```

- [ ] **Step 2: Page UI (approve/deny + link manager)**

`src/routes/(app)/users/join-requests/+page.svelte`:

```svelte
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  const { data } = $props();
  let busy = $state<string | null>(null);

  async function approve(id: string, organizationId: string, role: string) {
    busy = id;
    await fetch(`/api/join-requests/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId, role }) });
    busy = null; await invalidateAll();
  }
  async function deny(id: string) {
    busy = id;
    await fetch(`/api/join-requests/${id}/deny`, { method: 'POST' });
    busy = null; await invalidateAll();
  }
  let linkOrg = $state(data.orgs[0]?.id ?? '');
  let linkRole = $state('user');
  let createdUrl = $state<string | null>(null);
  async function mintLink() {
    const res = await fetch('/api/join-links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: linkOrg, role: linkRole }) });
    if (res.ok) { createdUrl = (await res.json()).url; await invalidateAll(); }
  }
  async function revoke(id: string) { await fetch(`/api/join-links/${id}/revoke`, { method: 'POST' }); await invalidateAll(); }
</script>

<div class="p-6 space-y-8">
  <section>
    <h1 class="text-lg font-semibold mb-3">Pending join requests</h1>
    {#if data.requests.length === 0}
      <p class="text-sm text-muted">No pending requests.</p>
    {:else}
      <ul class="space-y-2">
        {#each data.requests as r (r.id)}
          <li class="flex items-center justify-between gap-3 border border-border rounded px-3 py-2">
            <div>
              <div class="text-sm text-foreground">{r.display_name ?? r.email}</div>
              <div class="text-xs text-muted">{r.email}{#if r.message} — "{r.message}"{/if}</div>
            </div>
            <div class="flex items-center gap-2">
              <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={r.requested_role}>
                <option value="user">user</option><option value="admin">admin</option><option value="super_admin">super_admin</option>
              </select>
              <button disabled={busy === r.id} onclick={() => approve(r.id, r.organization_id, r.requested_role)} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Approve</button>
              <button disabled={busy === r.id} onclick={() => deny(r.id)} class="px-3 py-1 rounded border text-xs text-red-400 border-red-400/30">Deny</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h2 class="text-base font-semibold mb-3">Join links</h2>
    <div class="flex items-center gap-2 mb-3">
      <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={linkOrg}>
        {#each data.orgs as o}<option value={o.id}>{o.name}</option>{/each}
      </select>
      <select class="bg-bg border border-border rounded px-2 py-1 text-xs" bind:value={linkRole}>
        <option value="user">user</option><option value="admin">admin</option>
      </select>
      <button onclick={mintLink} class="px-3 py-1 rounded border text-xs bg-accent/20 border-accent/30 text-accent">Create link</button>
    </div>
    {#if createdUrl}<div class="text-xs font-mono text-accent break-all mb-3">{createdUrl}</div>{/if}
    <ul class="space-y-1">
      {#each data.links as l (l.id)}
        <li class="flex items-center justify-between text-xs border border-border rounded px-3 py-2">
          <span class="font-mono text-muted">…{l.token.slice(-8)} · {l.role} · uses {l.uses_count}{#if l.max_uses}/{l.max_uses}{/if}</span>
          <button onclick={() => revoke(l.id)} class="text-red-400">Revoke</button>
        </li>
      {/each}
    </ul>
  </section>
</div>
```

- [ ] **Step 3: Manual verification**

As admin, visit `/users/join-requests` → see pending list + link manager. Approve a request → it disappears; verify the user now loads `/my-agent`. Create a link → copy URL → open in a no-membership session → lands in the org.

- [ ] **Step 4: Typecheck + commit**

```bash
bun run check
git add "src/routes/(app)/users/join-requests/"
git commit -m "feat(users): join-requests + join-links admin page"
```

---

### Task 15: Super-view server guards + `/orgs` page

**Files:**
- Create: `src/routes/(app)/reliability/+page.server.ts`
- Create: `src/routes/(app)/config/+page.server.ts`
- Create: `src/routes/(app)/orgs/+page.server.ts`
- Create: `src/routes/(app)/orgs/+page.svelte`

- [ ] **Step 1: Guard reliability (super-admin only)**

`src/routes/(app)/reliability/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('reliability.monitor', locals.user)) throw error(403, 'Super-admin access required');
  return {};
};
```

- [ ] **Step 2: Guard config (super-admin only)**

`src/routes/(app)/config/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('config.editor', locals.user)) throw error(403, 'Super-admin access required');
  return {};
};
```

> If these routes already have a `+page.server.ts`, prepend the guard to the existing `load` instead of creating a new file.

- [ ] **Step 3: `/orgs` all-orgs view (super-admin only)**

`src/routes/(app)/orgs/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';
import { getDb } from '$server/db/client';
import { organization, member } from '@minion-stack/db/schema';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('orgs.all', locals.user)) throw error(403, 'Super-admin access required');
  const db = getDb();
  const orgs = await db.select({ id: organization.id, name: organization.name, slug: organization.slug }).from(organization);
  const counts = await db.select({ orgId: member.organizationId, c: sql<number>`count(*)` }).from(member).groupBy(member.organizationId);
  const countMap = new Map(counts.map((c) => [c.orgId, Number(c.c)]));
  return { orgs: orgs.map((o) => ({ ...o, members: countMap.get(o.id) ?? 0 })) };
};
```

`src/routes/(app)/orgs/+page.svelte`:

```svelte
<script lang="ts">
  const { data } = $props();
</script>
<div class="p-6">
  <h1 class="text-lg font-semibold mb-4">All organizations</h1>
  <ul class="space-y-2">
    {#each data.orgs as o (o.id)}
      <li class="flex items-center justify-between border border-border rounded px-3 py-2">
        <div><div class="text-sm text-foreground">{o.name}</div><div class="text-xs text-muted font-mono">{o.slug} · {o.members} members</div></div>
      </li>
    {/each}
  </ul>
</div>
```

- [ ] **Step 4: Manual verification**

As `admin` (not super), `/reliability`, `/config`, `/orgs` → 403. As `super_admin` → load. (Set your test account's `profiles.role` to `super_admin` via SQL to verify.)

- [ ] **Step 5: Typecheck + commit**

```bash
bun run check
git add "src/routes/(app)/reliability/+page.server.ts" "src/routes/(app)/config/+page.server.ts" "src/routes/(app)/orgs/"
git commit -m "feat(access): super-admin guards on reliability/config + /orgs view"
```

---

### Task 16: Nav visibility (hide super-only links unless super-admin)

**Files:**
- Modify: `src/lib/components/layout/sections.ts` (add `requires?` to relevant items)
- Modify: `src/lib/components/layout/Topbar.svelte` (gate the `/reliability` link + filter sections)

- [ ] **Step 1: Inspect and tag nav data**

Read `src/lib/components/layout/sections.ts`. For any section/item whose `href` is `/reliability`, `/config`, or `/orgs`, add a `requires` field set to the matching access key (`'reliability.monitor'`, `'config.editor'`, `'orgs.all'`). Example shape (adapt to the file's actual type):

```ts
// in the item objects:
{ href: '/config', label: m.nav_config(), requires: 'config.editor' },
```

Add `requires?: string;` to the item type/interface in that file.

- [ ] **Step 2: Filter in Topbar**

In `src/lib/components/layout/Topbar.svelte`:
- Import: `import { canClient } from '$lib/access/can.svelte';`
- Where `activeSection.items` is iterated (line ~81), filter: `{#each activeSection.items.filter((i) => !i.requires || canClient(i.requires)) as item (item.href)}`.
- Wrap the direct `/reliability` Tooltip/link (lines ~56-59) in a conditional: `{#if canClient('reliability.monitor')} … {/if}`.
- Apply the same `.filter(...)` to the mobile nav `section.items` loop (line ~167) and the mobile `/reliability` link (line ~155).

- [ ] **Step 3: Manual verification**

As `admin`: `/reliability`, `/config`, `/orgs` nav entries are hidden. As `super_admin`: they appear. Direct URL access is still blocked by Task 15 guards for non-super users.

- [ ] **Step 4: Typecheck + commit**

```bash
bun run check
git add src/lib/components/layout/sections.ts src/lib/components/layout/Topbar.svelte
git commit -m "feat(nav): hide super-admin-only views unless super_admin"
```

---

## Final Verification

- [ ] Run full test suite: `bun run test` — all green.
- [ ] Typecheck: `bun run check` — no errors.
- [ ] End-to-end manual (dev): no-org login → `/join` → request → approve in `/users/join-requests` → user loads app. Mint link → open as fresh no-org user → lands in org. Super-admin sees `/reliability`, `/config`, `/orgs`; admin does not.
- [ ] Dispatch a final code-reviewer over the whole branch.

## Spec Coverage Check

| Spec section | Task(s) |
|---|---|
| `join_request`/`join_link` tables | 4, 5 |
| `profiles.role` → super_admin | 1, 5 |
| Join flow (request) | 8, 11, 12, 14 |
| Join flow (opaque links) | 6, 9, 13, 14 |
| `createMembership` (Turso) | 7 |
| Email to all admins | 10, 8 |
| No-org → `/join` redirect | 11 |
| Super-admin tier + registry | 1, 2 |
| Role-based visibility (`can`/RoleGate/nav/guards) | 2, 3, 15, 16 |
| RLS (PG-only, defense-in-depth) | 5 |
| Shared-ready data layer | 4 |
