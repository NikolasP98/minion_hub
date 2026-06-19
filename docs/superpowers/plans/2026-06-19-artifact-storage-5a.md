# DB-Backed Dynamic Artifacts + Manual Create (5a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store per-org, per-agent artifacts in the DB, serve them org-scoped alongside the built-ins, and let an admin manually create one (name/icon/paste HTML bundle) that appears in the agent's gallery and opens in a draggable window.

**Architecture:** A `agent_artifacts` Postgres table (forced RLS via the `app.current_org_id` GUC) + an org-scoped store service + an async registry that merges built-in + DB descriptors + an org-aware serving route + admin REST (create/delete) + a create modal wired to the gallery `+`.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Drizzle (Postgres/Supabase gxv), `withOrgCore` (RLS), Paraglide, Vitest, Bun. Hub, branch `dev`.

## Global Constraints

- Svelte 5 runes only; TS strict, no `any`; no `@ts-nocheck`.
- i18n in BOTH `messages/en.json` + `messages/es.json`; `bun run i18n:compile` before `bun run check`.
- `bun run check` 0/0; `bun run test` green. Commits UNSIGNED (`git -c commit.gpgsign=false`); never `git add` a lockfile or `sdd/`.
- Validate every `.svelte` with the Svelte MCP autofixer before committing.
- **Tenancy:** all DB access goes through `withOrgCore({ db: getCoreDb(), tenantId: ctx.tenantId }, fn)` — RLS-enforced; never raw `getCoreDb()` for org data. Write APIs require `requireAdmin(locals)`; all routes resolve `requireCoreCtx(locals)`.
- **Migration applies to PRODUCTION gxv** — the controller applies it (Task 1 hand-off), not a subagent.

## Reference: verified shapes

- `CoreCtx = { db, tenantId, profileId? }` (`$server/auth/core-ctx`); `requireCoreCtx(locals): Promise<CoreCtx>`; `requireAdmin(locals): AuthUser` (`$server/auth/authorize`).
- `withOrgCore(scope: { db, tenantId }, fn: (tx) => Promise<T>): Promise<T>` (`$server/db/with-org-core`) — sets `app.current_org_id` GUC in a txn; `getCoreDb()` from `$server/db/pg-client`.
- Drizzle PG idiom (from `pg-finance-schema.ts`): `pgTable('name', { id: uuid('id').primaryKey().defaultRandom(), orgId: text('org_id').notNull(), …, createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow() }, (t) => ({ idx: index('…').on(t.orgId, t.agentId) }))`.
- Migration idiom (meta-repo root `supabase/migrations/<ts>_*.sql`): `create table if not exists public.<t> (...)`; `grant select,insert,update,delete on public.<t> to app_ledger;`; `alter table public.<t> enable row level security;` + `force row level security;`; `create policy <t>_org_guc on public.<t> for all using (org_id = current_setting('app.current_org_id', true)) with check (org_id = current_setting('app.current_org_id', true));`.
- `ArtifactDescriptor` (`$lib/agents/artifacts`): `{ id, agentId, slot, title, description, icon, kind, entrypoint }`. `overviewDescriptorFor`/`triageDescriptorFor` build the built-ins.
- Registry (`$lib/server/artifacts/registry.ts`): `getArtifactsForAgent(agentId): ArtifactDescriptor[]` (SYNC today, built-in only) + `getArtifactContext(ctx, agentId, artifactId)`.
- Serving route `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`: `BUNDLES` map of built-in `?raw` HTML; `GET` serves under CSP `frame-ancestors 'self'`. Built-in ids: `overview`, `triage`.
- Roster load `(app)/agents/autonomous/+page.server.ts`: builds `artifactsByAgent = Object.fromEntries(systemAgents.map((a) => [a.id, getArtifactsForAgent(a.id)]))`. Detail `[id]/+page.server.ts`: `artifacts: getArtifactsForAgent(agent.id)`. Both have `locals` (use `requireCoreCtx`).
- `ArtifactGallery.svelte`: props `{ artifacts, canAdd, onopen }`; renders icon tiles (Popover) + an admin-only `+` stub (Popover "coming soon"). `AutonomousAgentCard.svelte` renders `<ArtifactGallery artifacts={...} canAdd={data.isAdmin} onopen={(a) => agentWindows.openArtifact(a)} />`.
- `resolvePluginIcon(name)` (`$lib/plugins/icon-map`) maps lucide names (curated set in `PLUGIN_ICON_MAP`, `Puzzle` fallback).
- `invalidateAll`/`invalidate` from `$app/navigation` to refresh page loads after a mutation.

---

### Task 1: Schema + migration

**Files:**
- Create: `src/server/db/pg-artifacts-schema.ts`
- Create (META-REPO ROOT, absolute path): `/home/nikolas/Documents/CODE/MINION/supabase/migrations/20260619190000_agent_artifacts.sql`

**Interfaces — Produces:** `agentArtifacts` Drizzle table; `AgentArtifactRow = typeof agentArtifacts.$inferSelect`.

- [ ] **Step 1: Drizzle table** — `src/server/db/pg-artifacts-schema.ts`:

```ts
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Hub-native dynamic artifacts — per-org, per-agent visual bundles (single
 * self-contained index.html). Built-ins stay code-registered; these are
 * DB-stored (manual create now, LLM-generated later). Tenancy: `org_id text`
 * (== messages.org_id), enforced by withOrgCore (role app_ledger +
 * app.current_org_id GUC). Policy/grants in the companion migration
 * 20260619190000_agent_artifacts.sql (meta-repo root).
 */
export const agentArtifacts = pgTable(
  'agent_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    agentId: text('agent_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    icon: text('icon').notNull().default('LayoutDashboard'),
    html: text('html').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgAgentIdx: index('agent_artifacts_org_agent_idx').on(t.orgId, t.agentId),
  }),
);

export type AgentArtifactRow = typeof agentArtifacts.$inferSelect;
```

- [ ] **Step 2: Migration** — create `/home/nikolas/Documents/CODE/MINION/supabase/migrations/20260619190000_agent_artifacts.sql` (absolute path — meta-repo root, NOT the hub worktree):

```sql
-- Hub-native dynamic artifacts: per-org, per-agent self-contained HTML bundles.
-- Manual admin create now; LLM-generated (5b) later. Org isolation via the
-- existing app_ledger role + app.current_org_id GUC (same pattern as sched_*/fin_*).

create table if not exists public.agent_artifacts (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  agent_id    text not null,
  title       text not null,
  description text not null default '',
  icon        text not null default 'LayoutDashboard',
  html        text not null,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agent_artifacts_org_agent_idx on public.agent_artifacts (org_id, agent_id);

grant select, insert, update, delete on public.agent_artifacts to app_ledger;

alter table public.agent_artifacts enable row level security;
alter table public.agent_artifacts force  row level security;

create policy agent_artifacts_org_guc on public.agent_artifacts
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 3: Verify schema compiles** — `bun run check` → 0 (the Drizzle table must typecheck).

- [ ] **Step 4: Commit** (commit ONLY the hub schema file from the worktree; the migration lives in the separate meta-repo and is committed/applied by the controller):
```bash
git add src/server/db/pg-artifacts-schema.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): agent_artifacts Drizzle table + migration"
```

> **CONTROLLER HAND-OFF after Task 1:** the controller (a) commits the migration in the meta-repo, and (b) applies it to **production gxv** (`mcp__supabase__apply_migration` on project `gxvsaskbohavnurfvshr`, or psql), verifying forced RLS. Do NOT proceed to Task 2 dependent on the table existing until the controller confirms applied. (Tasks 2-6 are code and don't need the live table to typecheck.)

---

### Task 2: Store service

**Files:**
- Create: `src/lib/server/artifacts/store.ts`
- Test: `src/lib/server/artifacts/store.test.ts`

**Interfaces — Produces:**
- `artifactRowToDescriptor(row: AgentArtifactRow): ArtifactDescriptor` (pure) — `{ id: row.id, agentId: row.agentId, slot: 'detail', title: row.title, description: row.description, icon: row.icon, kind: 'static', entrypoint: 'index.html', deletable: true }`.
- `listArtifactRows(ctx, agentId): Promise<AgentArtifactRow[]>`
- `getArtifactRow(ctx, id): Promise<AgentArtifactRow | null>`
- `createArtifactRow(ctx, input: { agentId: string; title: string; description: string; icon: string; html: string }): Promise<AgentArtifactRow>`
- `deleteArtifactRow(ctx, id): Promise<void>`

> `ArtifactDescriptor.deletable?: boolean` is added in Task 3 (artifacts.ts). For Task 2, `artifactRowToDescriptor` returns it; if `bun run check` flags the unknown field before Task 3, add the optional field to `ArtifactDescriptor` here instead (whichever task touches `artifacts.ts` first owns it — note it in the report).

- [ ] **Step 1: Write failing test** — `src/lib/server/artifacts/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { artifactRowToDescriptor } from './store';
import type { AgentArtifactRow } from '$server/db/pg-artifacts-schema';

const row: AgentArtifactRow = {
  id: '11111111-1111-1111-1111-111111111111',
  orgId: 'org1', agentId: 'reminders', title: 'My Dash', description: 'desc',
  icon: 'BarChart3', html: '<!doctype html>', createdBy: 'u1',
  createdAt: new Date(0), updatedAt: new Date(0),
};

describe('artifactRowToDescriptor', () => {
  it('maps a row to a deletable static descriptor', () => {
    expect(artifactRowToDescriptor(row)).toEqual({
      id: '11111111-1111-1111-1111-111111111111', agentId: 'reminders', slot: 'detail',
      title: 'My Dash', description: 'desc', icon: 'BarChart3', kind: 'static',
      entrypoint: 'index.html', deletable: true,
    });
  });
});
```

- [ ] **Step 2: Run red** — `bun run test -- src/lib/server/artifacts/store.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/lib/server/artifacts/store.ts`:

```ts
import { eq, and, desc } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { agentArtifacts, type AgentArtifactRow } from '$server/db/pg-artifacts-schema';
import type { ArtifactDescriptor } from '$lib/agents/artifacts';

export function artifactRowToDescriptor(row: AgentArtifactRow): ArtifactDescriptor {
  return {
    id: row.id, agentId: row.agentId, slot: 'detail', title: row.title,
    description: row.description, icon: row.icon, kind: 'static',
    entrypoint: 'index.html', deletable: true,
  };
}

const scope = (ctx: CoreCtx) => ({ db: getCoreDb(), tenantId: ctx.tenantId });

export function listArtifactRows(ctx: CoreCtx, agentId: string): Promise<AgentArtifactRow[]> {
  return withOrgCore(scope(ctx), (tx) =>
    tx.select().from(agentArtifacts)
      .where(and(eq(agentArtifacts.orgId, ctx.tenantId), eq(agentArtifacts.agentId, agentId)))
      .orderBy(desc(agentArtifacts.createdAt)),
  );
}

export function getArtifactRow(ctx: CoreCtx, id: string): Promise<AgentArtifactRow | null> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.select().from(agentArtifacts).where(eq(agentArtifacts.id, id)).limit(1);
    return rows[0] ?? null;
  });
}

export function createArtifactRow(
  ctx: CoreCtx,
  input: { agentId: string; title: string; description: string; icon: string; html: string },
): Promise<AgentArtifactRow> {
  return withOrgCore(scope(ctx), async (tx) => {
    const rows = await tx.insert(agentArtifacts).values({
      orgId: ctx.tenantId, agentId: input.agentId, title: input.title,
      description: input.description, icon: input.icon, html: input.html,
      createdBy: ctx.profileId ?? null,
    }).returning();
    return rows[0];
  });
}

export function deleteArtifactRow(ctx: CoreCtx, id: string): Promise<void> {
  return withOrgCore(scope(ctx), async (tx) => {
    await tx.delete(agentArtifacts).where(eq(agentArtifacts.id, id));
  });
}
```

- [ ] **Step 4: Run green** — `bun run test -- src/lib/server/artifacts/store.test.ts` → PASS. `bun run check` → 0 (depends on Task 3's `deletable` field; if not yet present, add `deletable?: boolean` to `ArtifactDescriptor` in `src/lib/agents/artifacts.ts` now).

- [ ] **Step 5: Commit**
```bash
git add src/lib/server/artifacts/store.ts src/lib/server/artifacts/store.test.ts
git -c commit.gpgsign=false commit -m "feat(artifacts): org-scoped agent_artifacts store + row→descriptor mapper"
```

---

### Task 3: Registry async merge + descriptor field

**Files:**
- Modify: `src/lib/agents/artifacts.ts` (add `deletable?: boolean` to `ArtifactDescriptor` if not already added in Task 2)
- Modify: `src/lib/server/artifacts/registry.ts`
- Modify: `src/routes/(app)/agents/autonomous/+page.server.ts`
- Modify: `src/routes/(app)/agents/autonomous/[id]/+page.server.ts`

**Interfaces — Produces:** `getArtifactsForAgent(ctx: CoreCtx, agentId: string): Promise<ArtifactDescriptor[]>` (async; built-in + DB). `getArtifactContext` resolves DB (uuid) artifact ids to the base context.

- [ ] **Step 1: `deletable` field** — ensure `ArtifactDescriptor` in `src/lib/agents/artifacts.ts` has `deletable?: boolean;` (built-ins omit it).

- [ ] **Step 2: Async registry merge** — in `src/lib/server/artifacts/registry.ts`:
```ts
import { listArtifactRows, getArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';
// ...
export async function getArtifactsForAgent(ctx: CoreCtx, agentId: string): Promise<ArtifactDescriptor[]> {
  const builtins =
    agentId === 'alert-watcher'
      ? [triageDescriptorFor(agentId, m.artifact_triage_title(), m.artifact_triage_desc())]
      : [overviewDescriptorFor(agentId, m.artifact_overview_title(), m.artifact_overview_desc())];
  const dbRows = await listArtifactRows(ctx, agentId).catch(() => []);
  return [...builtins, ...dbRows.map(artifactRowToDescriptor)];
}
```
And in `getArtifactContext`, after the `overview`/`triage` branches, add: if `artifactId` is neither built-in, resolve the DB row org-scoped and return the base context:
```ts
  // DB (dynamic) artifact: base context (per-artifact data providers come with 5b)
  const row = await getArtifactRow(ctx, artifactId).catch(() => null);
  if (row && row.agentId === agentId) return base; // `base` = agentVmToArtifactContext(vm), already computed
  return null;
```
(Ensure `base` is computed before this branch as it is for overview/triage; if the current code returns early, refactor so `base` is available.)

- [ ] **Step 3: Update roster load** — `(app)/agents/autonomous/+page.server.ts`:
```ts
import { requireCoreCtx } from '$server/auth/core-ctx';
// in load({ locals }):
const ctx = await requireCoreCtx(locals);
const artifactsByAgent = Object.fromEntries(
  await Promise.all(systemAgents.map(async (agent) => [agent.id, await getArtifactsForAgent(ctx, agent.id)] as const)),
);
```

- [ ] **Step 4: Update detail load** — `[id]/+page.server.ts`:
```ts
const ctx = await requireCoreCtx(locals);
return { agent, artifacts: await getArtifactsForAgent(ctx, agent.id) };
```

- [ ] **Step 5: Verify** — `bun run check` → 0; `bun run test -- src/lib/agents/artifacts.test.ts` → still green.

- [ ] **Step 6: Commit**
```bash
git add src/lib/agents/artifacts.ts src/lib/server/artifacts/registry.ts "src/routes/(app)/agents/autonomous/+page.server.ts" "src/routes/(app)/agents/autonomous/[id]/+page.server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): async registry merges built-in + DB artifacts per org"
```

---

### Task 4: Org-aware serving route

**Files:** Modify `src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts`.

> No unit test (route glue); verified by `bun run check` + live (built-ins still served; DB bundle serves; cross-org 404s).

- [ ] **Step 1: Branch on built-in vs DB** — make `GET` async; keep built-ins synchronous from `BUNDLES`; for unknown ids resolve ctx + DB:
```ts
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getArtifactRow } from '$lib/server/artifacts/store';

export const GET: RequestHandler = async ({ params, locals }) => {
  const builtin = BUNDLES[params.artifactId]?.[params.path];
  if (builtin) return serve(builtin.body, builtin.type);
  // DB (dynamic) artifact — org-scoped, single index.html
  if (params.path !== 'index.html') throw error(404, 'artifact asset not found');
  const ctx = await requireCoreCtx(locals);
  const row = await getArtifactRow(ctx, params.artifactId).catch(() => null);
  if (!row) throw error(404, 'artifact not found');
  return serve(row.html, 'text/html; charset=utf-8');
};

function serve(body: string, type: string): Response {
  return new Response(body, {
    headers: {
      'content-type': type,
      'content-security-policy': "frame-ancestors 'self'",
      'cache-control': 'no-store',
    },
  });
}
```
(Refactor the existing inline `new Response(...)` into the shared `serve()` helper.)

- [ ] **Step 2: Verify** — `bun run check` → 0.

- [ ] **Step 3: Commit**
```bash
git add "src/routes/artifacts/[artifactId]/ui/[...path]/+server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): serve DB artifact bundles org-scoped (404 cross-org)"
```

---

### Task 5: Admin REST (create + delete)

**Files:**
- Create: `src/routes/api/artifacts/+server.ts` (POST)
- Create: `src/routes/api/artifacts/[id]/+server.ts` (DELETE)

> No unit test (route glue); admin-gating + org-scoping verified live.

- [ ] **Step 1: POST create** — `src/routes/api/artifacts/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { createArtifactRow, artifactRowToDescriptor } from '$lib/server/artifacts/store';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = (await request.json().catch(() => null)) as
    | { agentId?: string; title?: string; description?: string; icon?: string; html?: string }
    | null;
  if (!body?.agentId || !body.title || !body.html) throw error(400, 'agentId, title, html required');
  const row = await createArtifactRow(ctx, {
    agentId: body.agentId, title: body.title, description: body.description ?? '',
    icon: body.icon || 'LayoutDashboard', html: body.html,
  });
  return json(artifactRowToDescriptor(row), { status: 201 });
};
```

- [ ] **Step 2: DELETE** — `src/routes/api/artifacts/[id]/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { deleteArtifactRow } from '$lib/server/artifacts/store';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  await deleteArtifactRow(ctx, params.id);
  return json({ ok: true });
};
```

- [ ] **Step 3: Verify** — `bun run check` → 0.

- [ ] **Step 4: Commit**
```bash
git add "src/routes/api/artifacts/+server.ts" "src/routes/api/artifacts/[id]/+server.ts"
git -c commit.gpgsign=false commit -m "feat(artifacts): admin REST — create + delete dynamic artifacts (org-scoped)"
```

---

### Task 6: Create modal + gallery wiring

**Files:**
- Create: `src/lib/components/artifacts/ArtifactCreateModal.svelte`
- Modify: `src/lib/components/artifacts/ArtifactGallery.svelte`
- Modify: `src/lib/components/agents/AutonomousAgentCard.svelte`
- Modify: `messages/en.json`, `messages/es.json`

- [ ] **Step 1: i18n** — add to BOTH locales: `artifact_create_title` ("New artifact" / "Nuevo artefacto"), `artifact_create_name` ("Title"/"Título"), `artifact_create_desc` ("Description"/"Descripción"), `artifact_create_icon` ("Icon"/"Icono"), `artifact_create_html` ("HTML bundle"/"Paquete HTML"), `artifact_create_html_hint` ("Self-contained HTML. Use the artifact bridge for live data." / "HTML autocontenido. Usa el puente de artefactos para datos en vivo."), `artifact_create_submit` ("Create"/"Crear"), `artifact_delete` ("Delete"/"Eliminar"). (Reuse the existing `artifact_add` for the `+` aria-label; drop the now-unused `artifact_add_soon` only if nothing else references it — else leave it.)

- [ ] **Step 2: Create modal** — `src/lib/components/artifacts/ArtifactCreateModal.svelte` using `ui/Modal`: bindable `open`; props `{ agentId, oncreated }`. Fields: title (text), description (text), icon (a `<select>` of a curated set of lucide names present in `PLUGIN_ICON_MAP` — e.g. `LayoutDashboard, BarChart3, Activity, Megaphone, Bell, Gauge, LineChart, Table`), html (`<textarea>`, monospace, with the `artifact_create_html_hint` below it). A "Create" button: disabled unless title+html non-empty; on click `POST /api/artifacts` with `{agentId, title, description, icon, html}`, then `oncreated()` + close + reset fields. Show a small inline error on non-2xx. Token-styled, Svelte 5 runes (`$state`, `$bindable`).

- [ ] **Step 2b: Validate** — Svelte MCP autofixer on the modal; apply correctness fixes.

- [ ] **Step 3: Gallery — create + delete** — in `ArtifactGallery.svelte`: add props `oncreate?: () => void` and `ondelete?: (a: ArtifactDescriptor) => void`. Replace the `+` Popover "coming soon" body/stub with a button whose `onclick={() => oncreate?.()}` (keep the `canAdd` gate + `artifact_add` aria-label). For each tile where `a.deletable && canAdd`, add a small **delete** control inside its Popover panel (a button with a `Trash2` icon + `m.artifact_delete()` that calls `ondelete?.(a)`). Remove the `<!-- TODO: wire "+" … -->` comment.

- [ ] **Step 3b: Validate** — Svelte autofixer on the gallery.

- [ ] **Step 4: Card wiring** — in `AutonomousAgentCard.svelte`: import `ArtifactCreateModal` + `invalidateAll` from `$app/navigation`; add `let showCreate = $state(false)`. Pass to the gallery: `oncreate={() => (showCreate = true)}` and `ondelete={async (a) => { await fetch(`/api/artifacts/${a.id}`, { method: 'DELETE' }); await invalidateAll(); }}`. Render `<ArtifactCreateModal bind:open={showCreate} agentId={agent.id} oncreated={() => invalidateAll()} />`.

- [ ] **Step 4b: Validate** — Svelte autofixer on the card.

- [ ] **Step 5: Verify** — `bun run i18n:compile && bun run check` → 0.

- [ ] **Step 6: Commit**
```bash
git add src/lib/components/artifacts/ArtifactCreateModal.svelte src/lib/components/artifacts/ArtifactGallery.svelte src/lib/components/agents/AutonomousAgentCard.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(artifacts): manual create modal + gallery create/delete wiring"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → 0/0.
- [ ] **Step 2:** `bun run test` → green; `store.test.ts` passes; pre-existing `aci-backend.test.ts` git-env flake (if it appears) is unrelated — confirm no NEW failures.
- [ ] **Step 3: Live (best-effort, requires the gxv migration applied)** — as a FACES admin on `/agents/autonomous`: click `+` on an agent → fill title/icon/description + paste a small HTML bundle → Create → the tile appears + opens in a draggable window rendering the bundle; delete removes it; built-in `overview`/`triage` still open. If no connected instance, note deferred.
- [ ] **Step 4:** Commit any fixes.

---

## Self-Review

**Spec coverage:** `agent_artifacts` table + forced-RLS migration (T1) ✓; store CRUD + `artifactRowToDescriptor` (T2) ✓; async registry merge + DB context branch + both loads (T3) ✓; org-aware serving, 404 cross-org (T4) ✓; admin create + delete REST (T5) ✓; create modal + gallery `+`/delete wiring (T6) ✓; single-file HTML blob + uuid descriptor id + `deletable` flag ✓; i18n en/es (T6) ✓; store mapper unit test (T2) ✓. Out-of-scope (5b builder, data providers, multi-file, versioning) absent. Manual-create included per the decision.

**Placeholder scan:** none — complete code/commands. The Task 2↔3 `deletable`-field ownership note is an explicit ordering instruction, not a placeholder.

**Type consistency:** `getArtifactsForAgent(ctx, agentId)` async signature (T3) consumed by both loads (T3). `artifactRowToDescriptor`/`listArtifactRows`/`getArtifactRow`/`createArtifactRow`/`deleteArtifactRow` (T2) consumed by registry (T3), serving (T4), REST (T5). `ArtifactDescriptor.deletable` (T2/T3) consumed by the gallery (T6). `withOrgCore({db,tenantId}, fn)` + `requireAdmin`/`requireCoreCtx` used per their real signatures. DB descriptor id = row uuid; serving + context branch on built-in (`overview`/`triage`) vs uuid — consistent across T3/T4. Migration table/columns match the Drizzle schema (T1).
