# Plugin Flow Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat "plugin imports non-deletable flow rows" model with first-class **flow groups** — a plugin owns a non-deletable group container inside which the user freely creates/deletes editable duplicates of the plugin's templates; users can also create their own groups.

**Architecture:** A new `flow_groups` table plus a `flows.group_id` column. A pure `planReconcile()` function computes group create/update/seed/reassign/release actions from the gateway's plugin list; a `/api/flows/reconcile` endpoint executes that plan (idempotent, deletion-safe via the existing `user_preferences.pluginFlowInstalls` keys). The gateway's `flows.templates.list` is extended to return a `plugins[]` grouping (incl. disabled plugins + display name + enabled flag). The landing page renders collapsible group sections.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Bun, Drizzle ORM + libsql/Turso, Vitest, Paraglide i18n; gateway = TypeScript (tsdown), Vitest.

**Repos:** Tasks 1 is in `minion/` (gateway). Tasks 2–15 are in `minion_hub/`. Run hub commands from `/home/nikolas/Documents/CODE/MINION/minion_hub`, gateway commands from `/home/nikolas/Documents/CODE/MINION/minion`.

**CRITICAL — DB migrations:** Hub local-dev `.env` `TURSO_DB_URL` points at the **prod Turso** DB and the schema is **hand-managed** (no drizzle config). Apply schema changes ONLY via the surgical idempotent libsql script in Task 3. **NEVER run `drizzle-kit push` / `bun run db:push`** — it destructively diffs the hand-managed prod DB.

---

## File Structure

| File | Repo | Responsibility |
|---|---|---|
| `src/gateway/server-methods/flows-templates.ts` | minion | Add `collectFlowPlugins()`; return `{ templates, plugins }`. |
| `src/gateway/server-methods/flows-templates.test.ts` | minion | Cover the new `plugins[]` grouping. |
| `src/server/db/schema/flow-groups.ts` | hub | `flow_groups` Drizzle table. |
| `src/server/db/schema/flows.ts` | hub | Add `groupId` column to the `flows` table def. |
| `src/server/db/schema/index.ts` | hub | Export `flowGroups`. |
| `scripts/migrate-flow-groups.ts` | hub | One-off surgical libsql migration (create table + add column). |
| `src/lib/flows/groups.ts` | hub | Pure group helpers: kind classification + ordering. |
| `src/lib/flows/groups.test.ts` | hub | Unit tests for the helpers. |
| `src/lib/flows/reconcile-plan.ts` | hub | Pure `planReconcile()` — computes reconcile actions. |
| `src/lib/flows/reconcile-plan.test.ts` | hub | Unit tests for every reconcile branch. |
| `src/routes/api/flow-groups/+server.ts` | hub | `GET` groups, `POST` create user group. |
| `src/routes/api/flow-groups/[id]/+server.ts` | hub | `PATCH` rename, `DELETE` (plugin → 403; reassign flows). |
| `src/routes/api/flow-groups/flow-groups.server.test.ts` | hub | API tests. |
| `src/routes/api/flows/reconcile/+server.ts` | hub | Execute the reconcile plan (replaces `sync/`). |
| `src/routes/api/flows/+server.ts` | hub | `GET` returns `groupId`; `POST` accepts `groupId`+`templateId`. |
| `src/routes/api/flows/[id]/+server.ts` | hub | Drop instance delete-403; `GET` returns `groupId`. |
| `src/routes/api/flows/plugin-flows.server.test.ts` | hub | Flip: instances are now deletable. |
| `src/lib/components/flow-editor/NewFromTemplateMenu.svelte` | hub | Plugin-template dropdown → duplicate. |
| `src/lib/components/flow-editor/FlowGroupSection.svelte` | hub | One group: header + actions + cards. |
| `src/routes/(app)/flow-editor/+page.svelte` | hub | Load groups, iterate sections, call reconcile. |
| `messages/en.json`, `messages/es.json` | hub | New i18n strings. |

Delete after migration verified: `src/routes/api/flows/sync/+server.ts` (Task 9, final step).

---

## Task 1: Gateway — `flows.templates.list` returns `plugins[]`

**Files:**
- Modify: `src/gateway/server-methods/flows-templates.ts` (minion)
- Test: `src/gateway/server-methods/flows-templates.test.ts` (minion)

- [ ] **Step 1: Read the existing test file to match its harness**

Run: `sed -n '1,60p' src/gateway/server-methods/flows-templates.test.ts`
Note how it builds a `PluginRegistry` (likely via `createEmptyPluginRegistry()` + pushing `plugins` records) and calls `collectFlowTemplates`.

- [ ] **Step 2: Write the failing test for `collectFlowPlugins`**

Append to `src/gateway/server-methods/flows-templates.test.ts`:

```ts
import { collectFlowPlugins } from "./flows-templates.js";

describe("collectFlowPlugins", () => {
  function reg(records: Array<Partial<import("../../plugins/registry.js").PluginRecord>>) {
    const base = createEmptyPluginRegistry();
    base.plugins = records as import("../../plugins/registry.js").PluginRecord[];
    return base;
  }

  it("includes disabled flow-contributing plugins with enabled flag + displayName", () => {
    const r = reg([
      { id: "alert-watcher", name: "Alert Watcher", enabled: false, flows: [{ id: "pipeline", name: "P", nodes: [], edges: [] } as never] },
      { id: "no-flows", name: "No Flows", enabled: true },
    ]);
    const plugins = collectFlowPlugins(r);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({ pluginId: "alert-watcher", displayName: "Alert Watcher", enabled: false });
    expect(plugins[0].templates).toHaveLength(1);
    expect(plugins[0].templates[0].id).toBe("pipeline");
  });
});
```

(If the existing file already imports `createEmptyPluginRegistry`, reuse it; otherwise add `import { createEmptyPluginRegistry } from "../../plugins/registry.js";` at the top.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/gateway/server-methods/flows-templates.test.ts`
Expected: FAIL — `collectFlowPlugins is not a function` / not exported.

- [ ] **Step 4: Implement `collectFlowPlugins` + extend the handler**

In `src/gateway/server-methods/flows-templates.ts`, add after `collectFlowTemplates`:

```ts
export type FlowPluginGroup = {
  pluginId: string;
  displayName: string;
  enabled: boolean;
  templates: FlowTemplate[];
};

/** Pure: every flow-contributing plugin (enabled OR disabled), grouped. Exported for tests. */
export function collectFlowPlugins(registry: PluginRegistry): FlowPluginGroup[] {
  const out: FlowPluginGroup[] = [];
  for (const rec of registry.plugins) {
    if (!rec.flows || rec.flows.length === 0) {
      continue;
    }
    out.push({
      pluginId: rec.id,
      displayName: rec.name ?? rec.id,
      enabled: rec.enabled,
      templates: rec.flows,
    });
  }
  return out;
}
```

Then change the handler body:

```ts
    "flows.templates.list": ({ respond }) => {
      try {
        const registry = loadRegistry();
        const templates = collectFlowTemplates(registry);
        const plugins = collectFlowPlugins(registry);
        respond(true, { templates, plugins });
      } catch (err) {
        respondError(respond, ErrorCodes.UNAVAILABLE, String(err));
      }
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/gateway/server-methods/flows-templates.test.ts`
Expected: PASS (both old + new describes).

- [ ] **Step 6: Type-check**

Run: `pnpm tsgo` (gateway). Expected: no NEW errors in `flows-templates.ts`.

- [ ] **Step 7: Commit (in minion repo)**

```bash
cd /home/nikolas/Documents/CODE/MINION/minion
git add src/gateway/server-methods/flows-templates.ts src/gateway/server-methods/flows-templates.test.ts
git -c commit.gpgsign=false commit -m "feat(gateway): flows.templates.list returns plugins[] grouping (incl. disabled)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Hub — `flow_groups` schema + `flows.group_id` column

**Files:**
- Create: `src/server/db/schema/flow-groups.ts`
- Modify: `src/server/db/schema/flows.ts`, `src/server/db/schema/index.ts`

- [ ] **Step 1: Create the table definition**

`src/server/db/schema/flow-groups.ts`:

```ts
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const flowGroups = sqliteTable(
  'flow_groups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    userId: text('user_id'), // owner — null for legacy/shared
    tenantId: text('tenant_id'), // tenant scope
    // Set ⇒ plugin-owned (locked, non-deletable). Null ⇒ user-created group.
    pluginId: text('plugin_id'),
    // True ⇒ owning plugin is disabled → group renders dimmed. Always false for user groups.
    disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    ownerIdx: index('flow_groups_owner_idx').on(t.userId, t.tenantId),
  }),
);
```

- [ ] **Step 2: Add `groupId` to the flows table**

In `src/server/db/schema/flows.ts`, add after the `config` line (line 13):

```ts
  // FK→flow_groups.id; null ⇒ "My Flows" (ungrouped). Set at create/instantiate/reconcile.
  groupId: text('group_id'),
```

- [ ] **Step 3: Export from the barrel**

In `src/server/db/schema/index.ts`, after the `export { flowRuns } from './flow-runs';` line (line 37):

```ts
export { flowGroups } from './flow-groups';
```

- [ ] **Step 4: Type-check**

Run: `bun run check 2>&1 | tail -20`
Expected: no NEW errors (baseline is ~18 known errors; count must not increase).

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema/flow-groups.ts src/server/db/schema/flows.ts src/server/db/schema/index.ts
git -c commit.gpgsign=false commit -m "feat(flows): flow_groups table + flows.group_id column (schema)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Hub — surgical prod migration script

**Files:**
- Create: `scripts/migrate-flow-groups.ts`

- [ ] **Step 1: Write the idempotent migration script**

`scripts/migrate-flow-groups.ts`:

```ts
/**
 * One-off, idempotent schema migration for flow groups.
 *
 * The hub schema is hand-managed and the local .env points at PROD Turso, so we
 * NEVER use drizzle-kit push. This applies exactly two additive changes:
 *   1. CREATE TABLE IF NOT EXISTS flow_groups
 *   2. ALTER TABLE flows ADD COLUMN group_id (guarded — skipped if it exists)
 *
 * Run: bun run scripts/migrate-flow-groups.ts
 */
import { createClient } from '@libsql/client';

const url = process.env.TURSO_DB_URL;
const authToken = process.env.TURSO_DB_AUTH_TOKEN;
if (!url) throw new Error('TURSO_DB_URL not set');

const client = createClient({ url, authToken });

async function columnExists(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info(${table})`);
  return res.rows.some((r) => (r as Record<string, unknown>).name === column);
}

async function main() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS flow_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      tenant_id TEXT,
      plugin_id TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  console.log('✓ flow_groups table ensured');

  await client.execute(
    `CREATE INDEX IF NOT EXISTS flow_groups_owner_idx ON flow_groups (user_id, tenant_id)`,
  );
  console.log('✓ flow_groups_owner_idx ensured');

  if (await columnExists('flows', 'group_id')) {
    console.log('✓ flows.group_id already exists — skipping');
  } else {
    await client.execute(`ALTER TABLE flows ADD COLUMN group_id TEXT`);
    console.log('✓ flows.group_id added');
  }
  console.log('migration complete');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the migration against the configured DB**

Run: `bun run scripts/migrate-flow-groups.ts`
Expected output: the four `✓` lines + `migration complete`. (Re-running must be safe: second run prints "already exists — skipping".)

- [ ] **Step 3: Verify**

Run: `bun run scripts/migrate-flow-groups.ts` (second time)
Expected: `✓ flow_groups already...`, `✓ flows.group_id already exists — skipping`. Idempotent confirmed.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-flow-groups.ts
git -c commit.gpgsign=false commit -m "chore(db): idempotent flow_groups migration script (surgical, no drizzle push)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Hub — pure group helpers

**Files:**
- Create: `src/lib/flows/groups.ts`
- Test: `src/lib/flows/groups.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/flows/groups.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isPluginGroup, sortGroups, type FlowGroupMeta } from './groups';

const g = (o: Partial<FlowGroupMeta>): FlowGroupMeta => ({
  id: o.id ?? 'x', name: o.name ?? 'X', pluginId: o.pluginId ?? null,
  disabled: o.disabled ?? false, createdAt: o.createdAt ?? 0,
});

describe('isPluginGroup', () => {
  it('true when pluginId set, false otherwise', () => {
    expect(isPluginGroup(g({ pluginId: 'alert-watcher' }))).toBe(true);
    expect(isPluginGroup(g({ pluginId: null }))).toBe(false);
  });
});

describe('sortGroups', () => {
  it('orders user groups before plugin groups, then by createdAt', () => {
    const sorted = sortGroups([
      g({ id: 'p1', pluginId: 'plug', createdAt: 1 }),
      g({ id: 'u2', pluginId: null, createdAt: 5 }),
      g({ id: 'u1', pluginId: null, createdAt: 2 }),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['u1', 'u2', 'p1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/lib/flows/groups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

`src/lib/flows/groups.ts`:

```ts
/** Client+server pure helpers for flow groups. */
export type FlowGroupMeta = {
  id: string;
  name: string;
  /** Owning plugin id when plugin-managed; null for user groups. */
  pluginId: string | null;
  /** True ⇒ owning plugin disabled → render dimmed. */
  disabled: boolean;
  createdAt: number;
};

export function isPluginGroup(group: Pick<FlowGroupMeta, 'pluginId'>): boolean {
  return typeof group.pluginId === 'string' && group.pluginId.length > 0;
}

/** User groups first (by createdAt asc), then plugin groups (by createdAt asc). */
export function sortGroups<T extends FlowGroupMeta>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    const ap = isPluginGroup(a) ? 1 : 0;
    const bp = isPluginGroup(b) ? 1 : 0;
    if (ap !== bp) return ap - bp;
    return a.createdAt - b.createdAt;
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/lib/flows/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/flows/groups.ts src/lib/flows/groups.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): pure flow-group helpers (kind + ordering)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Hub — pure reconcile planner

**Files:**
- Create: `src/lib/flows/reconcile-plan.ts`
- Test: `src/lib/flows/reconcile-plan.test.ts`

This is the heart of the lifecycle. It is a pure function so every branch (ensure-group, update disabled/name, migrate-sweep, seed-once, uninstall-release) is unit-tested without a DB.

- [ ] **Step 1: Write the failing tests**

`src/lib/flows/reconcile-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planReconcile, type ReconcileInput } from './reconcile-plan';

const baseInput = (over: Partial<ReconcileInput>): ReconcileInput => ({
  existingGroups: [],
  ungroupedFlows: [],
  installedKeys: [],
  plugins: [],
  ...over,
});

const plugin = (id: string, enabled: boolean, templateIds: string[]) => ({
  pluginId: id,
  displayName: id.toUpperCase(),
  enabled,
  templates: templateIds.map((tid) => ({ id: tid, name: `${id}-${tid}`, nodes: [{ id: 'n' }], edges: [] })),
});

describe('planReconcile', () => {
  it('creates a group for a new flow-contributing plugin', () => {
    const p = planReconcile(baseInput({ plugins: [plugin('alert-watcher', true, [])] }));
    expect(p.groupsToCreate).toHaveLength(1);
    expect(p.groupsToCreate[0]).toMatchObject({ pluginId: 'alert-watcher', name: 'ALERT-WATCHER', disabled: false });
  });

  it('seeds one instance per template only for unseen keys when enabled', () => {
    const p = planReconcile(baseInput({
      plugins: [plugin('aw', true, ['pipeline', 'pipeline-telegram'])],
      installedKeys: ['aw:pipeline'],
    }));
    expect(p.flowsToSeed.map((f) => f.templateId)).toEqual(['pipeline-telegram']);
    expect(p.keysToAdd).toContain('aw:pipeline-telegram');
    // seeded flow targets the (to-be-created) group and carries source
    expect(p.flowsToSeed[0]).toMatchObject({ pluginId: 'aw', templateId: 'pipeline-telegram' });
  });

  it('does NOT seed when the plugin is disabled', () => {
    const p = planReconcile(baseInput({ plugins: [plugin('aw', false, ['pipeline'])] }));
    expect(p.flowsToSeed).toHaveLength(0);
    expect(p.groupsToCreate[0].disabled).toBe(true);
  });

  it('updates an existing group when disabled-state or name changed', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'OLD', pluginId: 'aw', disabled: false, createdAt: 0 }],
      plugins: [plugin('aw', false, [])],
    }));
    expect(p.groupsToCreate).toHaveLength(0);
    expect(p.groupsToUpdate).toContainEqual({ id: 'grp1', name: 'AW', disabled: true });
  });

  it('reassigns ungrouped plugin flows into an EXISTING group (migration sweep)', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'AW', pluginId: 'aw', disabled: false, createdAt: 0 }],
      ungroupedFlows: [{ id: 'f1', pluginId: 'aw' }, { id: 'f2', pluginId: null }],
      plugins: [plugin('aw', true, [])],
    }));
    expect(p.flowsToReassign).toEqual([{ flowId: 'f1', groupRef: 'grp1' }]);
  });

  it('reassigns ungrouped plugin flows into a NEWLY-CREATED group (first-run migration)', () => {
    const p = planReconcile(baseInput({
      existingGroups: [], // group does not exist yet
      ungroupedFlows: [{ id: 'f1', pluginId: 'aw' }],
      plugins: [plugin('aw', true, [])],
    }));
    expect(p.groupsToCreate[0].tempKey).toBe('new:aw');
    expect(p.flowsToReassign).toEqual([{ flowId: 'f1', groupRef: 'new:aw' }]);
  });

  it('releases a group whose plugin is no longer installed', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'GONE', pluginId: 'gone', disabled: false, createdAt: 0 }],
      plugins: [],
    }));
    expect(p.groupsToRelease).toEqual(['grp1']);
  });

  it('is a no-op when everything already reconciled', () => {
    const p = planReconcile(baseInput({
      existingGroups: [{ id: 'grp1', name: 'AW', pluginId: 'aw', disabled: false, createdAt: 0 }],
      installedKeys: ['aw:pipeline'],
      plugins: [plugin('aw', true, ['pipeline'])],
    }));
    expect(p.groupsToCreate).toHaveLength(0);
    expect(p.groupsToUpdate).toHaveLength(0);
    expect(p.flowsToSeed).toHaveLength(0);
    expect(p.flowsToReassign).toHaveLength(0);
    expect(p.groupsToRelease).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/lib/flows/reconcile-plan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the planner**

`src/lib/flows/reconcile-plan.ts`:

```ts
/** Pure reconcile planner — no DB. The endpoint executes the returned plan. */

export type ReconcilePlugin = {
  pluginId: string;
  displayName: string;
  enabled: boolean;
  templates: Array<{ id: string; name: string; nodes: unknown[]; edges: unknown[] }>;
};

export type ExistingGroup = {
  id: string;
  name: string;
  pluginId: string | null;
  disabled: boolean;
  createdAt: number;
};

/** An ungrouped flow with its resolved owning-plugin id (from config.source). */
export type UngroupedFlow = { id: string; pluginId: string | null };

export type ReconcileInput = {
  existingGroups: ExistingGroup[];
  ungroupedFlows: UngroupedFlow[];
  installedKeys: string[];
  plugins: ReconcilePlugin[];
};

export type GroupToCreate = { tempKey: string; name: string; pluginId: string; disabled: boolean };
export type GroupToUpdate = { id: string; name: string; disabled: boolean };
export type FlowToSeed = {
  pluginId: string;
  templateId: string;
  name: string;
  nodes: unknown[];
  edges: unknown[];
  /** Existing group id, or the tempKey of a group in groupsToCreate. */
  groupRef: string;
};
export type FlowToReassign = {
  flowId: string;
  /** Existing group id, or the tempKey of a group in groupsToCreate. */
  groupRef: string;
};

export type ReconcilePlan = {
  groupsToCreate: GroupToCreate[];
  groupsToUpdate: GroupToUpdate[];
  flowsToSeed: FlowToSeed[];
  flowsToReassign: FlowToReassign[];
  groupsToRelease: string[]; // group ids → set pluginId=null, disabled=false
  keysToAdd: string[];
};

export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const plan: ReconcilePlan = {
    groupsToCreate: [],
    groupsToUpdate: [],
    flowsToSeed: [],
    flowsToReassign: [],
    groupsToRelease: [],
    keysToAdd: [],
  };
  const installed = new Set(input.installedKeys);
  const pluginIds = new Set(input.plugins.map((p) => p.pluginId));

  for (const p of input.plugins) {
    const existing = input.existingGroups.find((g) => g.pluginId === p.pluginId);
    let groupRef: string;
    if (existing) {
      groupRef = existing.id;
      if (existing.disabled !== !p.enabled || existing.name !== p.displayName) {
        plan.groupsToUpdate.push({ id: existing.id, name: p.displayName, disabled: !p.enabled });
      }
    } else {
      groupRef = `new:${p.pluginId}`;
      plan.groupsToCreate.push({ tempKey: groupRef, name: p.displayName, pluginId: p.pluginId, disabled: !p.enabled });
    }

    // Migration sweep: ungrouped flows belonging to this plugin → into its group.
    // Uses groupRef (existing id OR the to-be-created tempKey) so first-run
    // migration works even when the group is created in the same pass.
    for (const f of input.ungroupedFlows) {
      if (f.pluginId === p.pluginId) {
        plan.flowsToReassign.push({ flowId: f.id, groupRef });
      }
    }

    // Seed unseen templates, only while enabled.
    if (p.enabled) {
      for (const t of p.templates) {
        const key = `${p.pluginId}:${t.id}`;
        if (installed.has(key)) continue;
        installed.add(key);
        plan.keysToAdd.push(key);
        plan.flowsToSeed.push({
          pluginId: p.pluginId,
          templateId: t.id,
          name: t.name,
          nodes: t.nodes,
          edges: t.edges,
          groupRef,
        });
      }
    }
  }

  // Release groups whose plugin is gone (uninstalled).
  for (const g of input.existingGroups) {
    if (g.pluginId && !pluginIds.has(g.pluginId)) {
      plan.groupsToRelease.push(g.id);
    }
  }

  return plan;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/lib/flows/reconcile-plan.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/flows/reconcile-plan.ts src/lib/flows/reconcile-plan.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): pure reconcile planner (ensure/seed/migrate/release)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Hub — `/api/flow-groups` GET + POST

**Files:**
- Create: `src/routes/api/flow-groups/+server.ts`
- Test: `src/routes/api/flow-groups/flow-groups.server.test.ts`

- [ ] **Step 1: Write the failing test**

`src/routes/api/flow-groups/flow-groups.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({
  getTenantCtx: (locals: unknown) => mockGetTenantCtx(locals),
}));

function makeLocals(): App.Locals {
  return {
    user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'],
    orgId: 'org-1',
    tenantCtx: undefined,
  } as App.Locals;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/flow-groups', () => {
  it('returns groups with pluginId + disabled', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      { id: 'g1', name: 'My', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false, createdAt: 1, updatedAt: 1 },
      { id: 'g2', name: 'AW', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: true, createdAt: 2, updatedAt: 2 },
    ]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals() } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.groups).toHaveLength(2);
    expect(body.groups[1]).toMatchObject({ id: 'g2', pluginId: 'alert-watcher', disabled: true });
  });
});

describe('POST /api/flow-groups', () => {
  it('creates a user group (pluginId null)', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flow-groups', { method: 'POST', body: JSON.stringify({ name: 'Marketing' }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank name with 400', async () => {
    const { db } = createMockDb();
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    let status = 0;
    try {
      await POST({
        locals: makeLocals(),
        request: new Request('http://x/api/flow-groups', { method: 'POST', body: JSON.stringify({ name: '' }) }),
      } as Parameters<typeof POST>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/routes/api/flow-groups/flow-groups.server.test.ts`
Expected: FAIL — `./+server` not found.

- [ ] **Step 3: Implement the route**

`src/routes/api/flow-groups/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups } from '$server/db/schema';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';

export const GET: RequestHandler = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const rows = await ctx.db
    .select()
    .from(flowGroups)
    .where(
      and(
        or(eq(flowGroups.userId, user.id), isNull(flowGroups.userId)),
        or(eq(flowGroups.tenantId, ctx.tenantId), isNull(flowGroups.tenantId)),
      ),
    )
    .orderBy(desc(flowGroups.createdAt));

  return json({
    groups: rows.map((g) => ({
      id: g.id,
      name: g.name,
      pluginId: g.pluginId,
      disabled: g.disabled,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const { name } = (await request.json()) as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw error(400, 'name is required');
  }

  const id = randomUUID();
  const now = Date.now();
  await ctx.db.insert(flowGroups).values({
    id,
    name: name.trim(),
    userId: user.id,
    tenantId: ctx.tenantId,
    pluginId: null, // user-created group
    disabled: false,
    createdAt: now,
    updatedAt: now,
  });

  return json({ id }, { status: 201 });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/routes/api/flow-groups/flow-groups.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/flow-groups/+server.ts src/routes/api/flow-groups/flow-groups.server.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): GET/POST /api/flow-groups (list + create user group)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Hub — `/api/flow-groups/[id]` PATCH + DELETE

**Files:**
- Create: `src/routes/api/flow-groups/[id]/+server.ts`
- Test: append to `src/routes/api/flow-groups/flow-groups.server.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

Append to `flow-groups.server.test.ts`:

```ts
describe('DELETE /api/flow-groups/[id]', () => {
  it('rejects deleting a plugin group with 403', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g2', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: false }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    let status = 0;
    try {
      await DELETE({ locals: makeLocals(), params: { id: 'g2' } } as Parameters<typeof DELETE>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(403);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('deletes a user group and reassigns its flows to ungrouped', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g1', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'g1' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled(); // flows.group_id → null
    expect(db.delete).toHaveBeenCalledTimes(1); // group removed
  });
});

describe('PATCH /api/flow-groups/[id]', () => {
  it('renames a user group', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g1', userId: 'user-1', tenantId: 'org-1', pluginId: null, disabled: false }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { PATCH } = await import('./[id]/+server');
    const res = await PATCH({
      locals: makeLocals(), params: { id: 'g1' },
      request: new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Renamed' }) }),
    } as Parameters<typeof PATCH>[0]);
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalled();
  });

  it('rejects renaming a plugin group with 403', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'g2', userId: 'user-1', tenantId: 'org-1', pluginId: 'alert-watcher', disabled: false }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { PATCH } = await import('./[id]/+server');
    let status = 0;
    try {
      await PATCH({
        locals: makeLocals(), params: { id: 'g2' },
        request: new Request('http://x', { method: 'PATCH', body: JSON.stringify({ name: 'Nope' }) }),
      } as Parameters<typeof PATCH>[0]);
    } catch (e) { status = (e as { status?: number }).status ?? 0; }
    expect(status).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/routes/api/flow-groups/flow-groups.server.test.ts`
Expected: FAIL — `./[id]/+server` not found.

- [ ] **Step 3: Implement the route**

`src/routes/api/flow-groups/[id]/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flowGroups, flows } from '$server/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import type { TenantContext } from '$server/services/base';

async function requireGroupOwnership(userId: string, tenantId: string, groupId: string, ctx: TenantContext) {
  const [group] = await ctx.db.select().from(flowGroups).where(eq(flowGroups.id, groupId));
  if (!group) throw error(404, 'Group not found');
  const ownedByUser = group.userId === userId;
  const legacyRow = group.userId === null;
  const sameTenant = group.tenantId === tenantId || group.tenantId === null;
  if ((!ownedByUser && !legacyRow) || !sameTenant) throw error(403, 'Forbidden');
  return group;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupOwnership(user.id, ctx.tenantId, params.id!, ctx);

  if (group.pluginId) throw error(403, 'Plugin-managed groups cannot be renamed.');

  const { name } = (await request.json()) as { name?: string };
  if (!name || typeof name !== 'string' || name.trim().length === 0) throw error(400, 'name is required');

  await ctx.db.update(flowGroups).set({ name: name.trim(), updatedAt: Date.now() }).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);
  const group = await requireGroupOwnership(user.id, ctx.tenantId, params.id!, ctx);

  // Plugin groups are managed by their plugin — reconcile would recreate them.
  if (group.pluginId) {
    throw error(403, `This group is managed by the "${group.pluginId}" plugin and cannot be deleted.`);
  }

  // Non-destructive: move the group's flows to "My Flows" (ungrouped), then drop the group.
  await ctx.db.update(flows).set({ groupId: null, updatedAt: Date.now() }).where(eq(flows.groupId, group.id));
  await ctx.db.delete(flowGroups).where(eq(flowGroups.id, group.id));
  return json({ ok: true });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/routes/api/flow-groups/flow-groups.server.test.ts`
Expected: PASS (all describes).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/flow-groups/[id]/+server.ts src/routes/api/flow-groups/flow-groups.server.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): PATCH/DELETE /api/flow-groups/[id] (rename; plugin-locked; reassign on delete)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Hub — `/api/flows` GET returns groupId; POST accepts groupId + templateId

**Files:**
- Modify: `src/routes/api/flows/+server.ts`

- [ ] **Step 1: Write the failing test**

Create `src/routes/api/flows/flows-grouping.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetTenantCtx = vi.fn<(locals: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx: (l: unknown) => mockGetTenantCtx(l) }));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'], orgId: 'org-1', tenantCtx: undefined } as App.Locals;
}
beforeEach(() => vi.clearAllMocks());

describe('GET /api/flows — groupId', () => {
  it('returns groupId on each flow', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', name: 'F', nodes: '[]', active: false, createdAt: 1, updatedAt: 1, config: '{}', groupId: 'g1' }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { GET } = await import('./+server');
    const res = await GET({ locals: makeLocals(), url: new URL('http://x/api/flows') } as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.flows[0].groupId).toBe('g1');
  });
});

describe('POST /api/flows — groupId + templateId', () => {
  it('persists groupId and the template source', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: new Request('http://x/api/flows', { method: 'POST', body: JSON.stringify({ name: 'New', groupId: 'g1', pluginId: 'aw', templateId: 'pipeline', nodes: [{ id: 'n' }], edges: [] }) }),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/routes/api/flows/flows-grouping.server.test.ts`
Expected: FAIL — `groupId` is `undefined` in GET output (column not selected/returned) and POST ignores groupId.

- [ ] **Step 3: Update GET + POST**

In `src/routes/api/flows/+server.ts`, in the GET `result` map (after `pluginId:` line ~48), add:

```ts
      groupId: row.groupId ?? null,
```

Replace the POST body destructure + insert (lines ~60-84) with:

```ts
  const body = await request.json();
  const { name, nodes, edges, groupId, pluginId, templateId } = body as {
    name?: string; nodes?: unknown; edges?: unknown;
    groupId?: string; pluginId?: string; templateId?: string;
  };

  if (!name || typeof name !== 'string') throw error(400, 'name is required');

  const nodesJson = Array.isArray(nodes) ? JSON.stringify(nodes) : '[]';
  const edgesJson = Array.isArray(edges) ? JSON.stringify(edges) : '[]';

  // When duplicating a plugin template into its group, record the source so the
  // card can show the origin pill. config.source no longer locks the flow.
  const config = pluginId
    ? JSON.stringify({ source: { pluginId, templateId } })
    : '{}';

  const id = randomUUID();
  const now = Date.now();

  await ctx.db.insert(flows).values({
    id,
    name,
    nodes: nodesJson,
    edges: edgesJson,
    userId: user.id,
    tenantId: ctx.tenantId,
    createdAt: now,
    updatedAt: now,
    groupId: groupId ?? null,
    config,
  });

  return json({ id }, { status: 201 });
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/routes/api/flows/flows-grouping.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/flows/+server.ts src/routes/api/flows/flows-grouping.server.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): /api/flows returns groupId; POST accepts groupId+templateId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Hub — instances deletable; `/api/flows/[id]` returns groupId

**Files:**
- Modify: `src/routes/api/flows/[id]/+server.ts`
- Modify: `src/routes/api/flows/plugin-flows.server.test.ts` (flip the 403 expectation)

- [ ] **Step 1: Flip the existing test**

In `src/routes/api/flows/plugin-flows.server.test.ts`, replace the `DELETE … plugin-managed flows are protected` describe block (lines 44-76) with:

```ts
describe('DELETE /api/flows/[id] — instances are deletable', () => {
  it('allows deleting a plugin-imported instance (no longer 403)', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', userId: 'user-1', tenantId: 'org-1', config: PLUGIN_CONFIG }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'f1' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('allows deleting a user-authored flow', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f2', userId: 'user-1', tenantId: 'org-1', config: '{}' }]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    const { DELETE } = await import('./[id]/+server');
    const res = await DELETE({ locals: makeLocals(), params: { id: 'f2' } } as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/routes/api/flows/plugin-flows.server.test.ts`
Expected: FAIL — the first new case gets a 403 thrown (guard still present).

- [ ] **Step 3: Remove the delete guard + add groupId to GET**

In `src/routes/api/flows/[id]/+server.ts`:

(a) In the `GET` return `flow` object (after `pluginId:` line ~44), add:
```ts
      groupId: flow.groupId ?? null,
```

(b) Delete the plugin-origin guard in `DELETE` (lines ~77-83) — remove the `import { flowPluginId }` usage there and the `if (owningPlugin) throw error(403, …)` block, leaving:

```ts
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const existing = await requireFlowOwnership(user.id, ctx.tenantId, params.id!, ctx);

  // Instances (incl. plugin-template duplicates) are user-owned and deletable.
  // The plugin's group container is what's protected — see /api/flow-groups/[id].
  await ctx.db.delete(flows).where(eq(flows.id, existing.id));

  return json({ ok: true });
};
```

(Keep the `flowPluginId` import — still used by `GET`.)

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/routes/api/flows/plugin-flows.server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/flows/[id]/+server.ts src/routes/api/flows/plugin-flows.server.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): instances deletable (drop plugin 403); GET returns groupId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Hub — `/api/flows/reconcile` endpoint (execute the plan)

**Files:**
- Create: `src/routes/api/flows/reconcile/+server.ts`
- Test: `src/routes/api/flows/reconcile/reconcile.server.test.ts`

- [ ] **Step 1: Write the failing integration test**

`src/routes/api/flows/reconcile/reconcile.server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const mockGetTenantCtx = vi.fn<(l: unknown) => Promise<unknown>>();
vi.mock('$server/auth/tenant-ctx', () => ({ getTenantCtx: (l: unknown) => mockGetTenantCtx(l) }));

const mockGetPrefs = vi.fn<(db: unknown, u: string) => Promise<Record<string, unknown>>>();
const mockUpsertPref = vi.fn<(db: unknown, u: string, s: string, v: unknown) => Promise<void>>();
vi.mock('$server/services/user-preferences.service', () => ({
  getUserPreferences: (db: unknown, u: string) => mockGetPrefs(db, u),
  upsertUserPreference: (db: unknown, u: string, s: string, v: unknown) => mockUpsertPref(db, u, s, v),
}));

function makeLocals(): App.Locals {
  return { user: { id: 'user-1', email: 't@t.com', displayName: 'T', role: 'user' },
    session: { userId: 'user-1' } as App.Locals['session'], orgId: 'org-1', tenantCtx: undefined } as App.Locals;
}
beforeEach(() => vi.clearAllMocks());

function body(plugins: unknown) {
  return new Request('http://x/api/flows/reconcile', { method: 'POST', body: JSON.stringify({ plugins }) });
}

describe('POST /api/flows/reconcile', () => {
  it('creates a group + seeds instances for a freshly enabled plugin', async () => {
    const { db, resolveSequence } = createMockDb();
    // 1st select → existing groups (none); 2nd select → ungrouped flows (none)
    resolveSequence([[], []]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetPrefs.mockResolvedValue({});
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: body([{ pluginId: 'aw', displayName: 'Alert Watcher', enabled: true,
        templates: [{ id: 'pipeline', name: 'P', nodes: [{ id: 'n' }], edges: [] }] }]),
    } as Parameters<typeof POST>[0]);
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(db.insert).toHaveBeenCalled(); // group + seeded flow inserted
    expect(mockUpsertPref).toHaveBeenCalled(); // installed key recorded
    expect(out.groupsCreated).toBe(1);
    expect(out.flowsSeeded).toBe(1);
  });

  it('is a no-op (no inserts) when already reconciled', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'g1', name: 'Alert Watcher', userId: 'user-1', tenantId: 'org-1', pluginId: 'aw', disabled: false, createdAt: 0 }],
      [],
    ]);
    mockGetTenantCtx.mockResolvedValue({ db, tenantId: 'org-1' });
    mockGetPrefs.mockResolvedValue({ pluginFlowInstalls: { keys: ['aw:pipeline'] } });
    const { POST } = await import('./+server');
    const res = await POST({
      locals: makeLocals(),
      request: body([{ pluginId: 'aw', displayName: 'Alert Watcher', enabled: true,
        templates: [{ id: 'pipeline', name: 'P', nodes: [], edges: [] }] }]),
    } as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockUpsertPref).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/routes/api/flows/reconcile/reconcile.server.test.ts`
Expected: FAIL — `./+server` not found.

- [ ] **Step 3: Implement the endpoint (executes `planReconcile`)**

`src/routes/api/flows/reconcile/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { flows, flowGroups } from '$server/db/schema';
import { and, eq, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getUserPreferences, upsertUserPreference } from '$server/services/user-preferences.service';
import { planReconcile, type ReconcilePlugin, type ExistingGroup, type UngroupedFlow } from '$lib/flows/reconcile-plan';
import { flowSourceFrom } from '$lib/flows/plugin-source';

const PREF_SECTION = 'pluginFlowInstalls';

export const POST: RequestHandler = async ({ locals, request }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals);
  if (!ctx) throw error(401);

  const { plugins: incoming } = (await request.json()) as { plugins?: ReconcilePlugin[] };
  const plugins = Array.isArray(incoming) ? incoming : [];

  const ownerFilter = and(
    or(eq(flowGroups.userId, user.id), isNull(flowGroups.userId)),
    or(eq(flowGroups.tenantId, ctx.tenantId), isNull(flowGroups.tenantId)),
  );
  const groupRows = await ctx.db.select().from(flowGroups).where(ownerFilter);
  const existingGroups: ExistingGroup[] = groupRows.map((g) => ({
    id: g.id, name: g.name, pluginId: g.pluginId, disabled: g.disabled, createdAt: g.createdAt,
  }));

  // Ungrouped flows (group_id null) owned by this user — for the migration sweep.
  const flowRows = await ctx.db
    .select()
    .from(flows)
    .where(
      and(
        isNull(flows.groupId),
        or(eq(flows.userId, user.id), isNull(flows.userId)),
        or(eq(flows.tenantId, ctx.tenantId), isNull(flows.tenantId)),
      ),
    );
  const ungroupedFlows: UngroupedFlow[] = flowRows.map((f) => ({
    id: f.id, pluginId: flowSourceFrom(f.config)?.pluginId ?? null,
  }));

  const prefs = await getUserPreferences(ctx.db, user.id);
  const recorded = prefs[PREF_SECTION] as { keys?: string[] } | undefined;
  const installedKeys = Array.isArray(recorded?.keys) ? recorded!.keys! : [];

  const plan = planReconcile({ existingGroups, ungroupedFlows, installedKeys, plugins });

  const now = Date.now();
  // Resolve group tempKeys → real ids as we create them.
  const tempIdToReal = new Map<string, string>();

  for (const g of plan.groupsToCreate) {
    const id = randomUUID();
    tempIdToReal.set(g.tempKey, id);
    await ctx.db.insert(flowGroups).values({
      id, name: g.name, userId: user.id, tenantId: ctx.tenantId,
      pluginId: g.pluginId, disabled: g.disabled, createdAt: now, updatedAt: now,
    });
  }
  for (const g of plan.groupsToUpdate) {
    await ctx.db.update(flowGroups).set({ name: g.name, disabled: g.disabled, updatedAt: now }).where(eq(flowGroups.id, g.id));
  }
  for (const r of plan.flowsToReassign) {
    const groupId = tempIdToReal.get(r.groupRef) ?? r.groupRef;
    await ctx.db.update(flows).set({ groupId, updatedAt: now }).where(eq(flows.id, r.flowId));
  }
  for (const s of plan.flowsToSeed) {
    const groupId = tempIdToReal.get(s.groupRef) ?? s.groupRef;
    await ctx.db.insert(flows).values({
      id: randomUUID(), name: s.name,
      nodes: JSON.stringify(s.nodes), edges: JSON.stringify(s.edges),
      userId: user.id, tenantId: ctx.tenantId, createdAt: now, updatedAt: now,
      active: false, groupId,
      config: JSON.stringify({ source: { pluginId: s.pluginId, templateId: s.templateId } }),
    });
  }
  for (const gid of plan.groupsToRelease) {
    await ctx.db.update(flowGroups).set({ pluginId: null, disabled: false, updatedAt: now }).where(eq(flowGroups.id, gid));
  }
  if (plan.keysToAdd.length > 0) {
    await upsertUserPreference(ctx.db, user.id, PREF_SECTION, { keys: [...installedKeys, ...plan.keysToAdd] });
  }

  return json({
    groupsCreated: plan.groupsToCreate.length,
    groupsUpdated: plan.groupsToUpdate.length,
    flowsSeeded: plan.flowsToSeed.length,
    flowsReassigned: plan.flowsToReassign.length,
    groupsReleased: plan.groupsToRelease.length,
  });
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun run vitest run src/routes/api/flows/reconcile/reconcile.server.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Delete the obsolete sync route**

Run: `git rm src/routes/api/flows/sync/+server.ts`

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/flows/reconcile/+server.ts src/routes/api/flows/reconcile/reconcile.server.test.ts
git -c commit.gpgsign=false commit -m "feat(flows): /api/flows/reconcile executes group reconcile plan; drop sync route

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Hub — `NewFromTemplateMenu.svelte`

**Files:**
- Create: `src/lib/components/flow-editor/NewFromTemplateMenu.svelte`

- [ ] **Step 1: Write the component**

`src/lib/components/flow-editor/NewFromTemplateMenu.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { Plus, ChevronDown } from 'lucide-svelte';

  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };
  let {
    pluginId,
    groupId,
    templates,
    disabled = false,
    onCreated,
  }: {
    pluginId: string;
    groupId: string;
    templates: Template[];
    disabled?: boolean;
    onCreated?: () => void;
  } = $props();

  let open = $state(false);
  let busy = $state(false);

  async function instantiate(t: Template) {
    if (busy) return;
    busy = true;
    open = false;
    try {
      const res = await fetch('/api/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: t.name,
          nodes: t.nodes,
          edges: t.edges,
          groupId,
          pluginId,
          templateId: t.id,
        }),
      });
      if (res.ok) {
        const { id } = await res.json();
        onCreated?.();
        goto(`/flow-editor/${id}`);
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="relative">
  <button
    type="button"
    {disabled}
    onclick={(e) => { e.stopPropagation(); open = !open; }}
    class="flex items-center gap-1 h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
  >
    <Plus size={12} /> New from template <ChevronDown size={11} />
  </button>
  {#if open && !disabled}
    <div class="absolute right-0 top-8 z-30 min-w-52 rounded-lg border border-border bg-bg2 shadow-lg py-1">
      {#each templates as t (t.id)}
        <button
          type="button"
          onclick={(e) => { e.stopPropagation(); instantiate(t); }}
          class="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-bg3 transition-colors"
        >
          {t.name}
        </button>
      {:else}
        <div class="px-3 py-1.5 text-xs text-muted italic">No templates</div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Validate with the Svelte MCP autofixer**

Use the `mcp__plugin_svelte_svelte__svelte-autofixer` tool on this file's contents (per the svelte plugin guidance) and apply any fixes it reports. Re-run until clean.

- [ ] **Step 3: Type-check**

Run: `bun run check 2>&1 | tail -20`
Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/flow-editor/NewFromTemplateMenu.svelte
git -c commit.gpgsign=false commit -m "feat(flow-editor): NewFromTemplateMenu — duplicate a plugin template into its group

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Hub — `FlowGroupSection.svelte`

**Files:**
- Create: `src/lib/components/flow-editor/FlowGroupSection.svelte`

This renders ONE group: header (kind-specific actions) + its flow cards. Card markup is lifted from the current `+page.svelte` grid.

- [ ] **Step 1: Write the component**

`src/lib/components/flow-editor/FlowGroupSection.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { GitBranch, Plus, Trash2, Clock, Puzzle, Lock, Pencil, ChevronDown, ChevronRight } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import NewFromTemplateMenu from './NewFromTemplateMenu.svelte';

  type FlowMeta = { id: string; name: string; nodeCount: number; updatedAt: number; pluginId?: string | null; groupId?: string | null };
  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };

  let {
    title,
    kind, // 'my' | 'user' | 'plugin'
    pluginId = null,
    groupId = null,
    disabled = false,
    flows,
    templates = [],
    onNewBlank,
    onDeleteFlow,
    onRenameGroup,
    onDeleteGroup,
    onChanged,
  }: {
    title: string;
    kind: 'my' | 'user' | 'plugin';
    pluginId?: string | null;
    groupId?: string | null;
    disabled?: boolean;
    flows: FlowMeta[];
    templates?: Template[];
    onNewBlank?: () => void;
    onDeleteFlow?: (flow: FlowMeta) => void;
    onRenameGroup?: () => void;
    onDeleteGroup?: () => void;
    onChanged?: () => void;
  } = $props();

  let collapsed = $state(false);

  function formatDate(ts: number) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

<section class="mb-6 {disabled ? 'opacity-50' : ''}">
  <header class="flex items-center justify-between mb-2">
    <button type="button" class="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted hover:text-foreground" onclick={() => (collapsed = !collapsed)}>
      {#if collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
      {#if kind === 'plugin'}<Puzzle size={12} class="text-accent" />{/if}
      <span class="text-foreground">{title}</span>
      {#if kind === 'plugin'}<Lock size={11} class="text-muted/50" />{/if}
      {#if disabled}<span class="px-1.5 py-0.5 rounded-full bg-bg3 text-muted text-[9px]">disabled</span>{/if}
      <span class="text-muted/50">({flows.length})</span>
    </button>
    <div class="flex items-center gap-1">
      {#if kind === 'plugin' && groupId}
        <NewFromTemplateMenu {pluginId} groupId={groupId} {templates} disabled={disabled} onCreated={onChanged} />
      {:else if onNewBlank}
        <button type="button" onclick={onNewBlank} class="flex items-center gap-1 h-7 px-2.5 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors">
          <Plus size={12} /> {m.flow_newFlow()}
        </button>
      {/if}
      {#if kind === 'user'}
        <button type="button" onclick={onRenameGroup} class="p-1.5 rounded text-muted hover:text-foreground hover:bg-bg3" title="Rename group" aria-label="Rename group"><Pencil size={13} /></button>
        <button type="button" onclick={onDeleteGroup} class="p-1.5 rounded text-muted hover:text-red-400 hover:bg-bg3" title="Delete group" aria-label="Delete group"><Trash2 size={13} /></button>
      {/if}
    </div>
  </header>

  {#if !collapsed}
    {#if flows.length === 0}
      <p class="text-muted/60 text-xs font-mono italic px-1 py-3">— empty —</p>
    {:else}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {#each flows as flow (flow.id)}
          <div
            role="button" tabindex="0"
            onclick={() => goto(`/flow-editor/${flow.id}`)}
            onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && goto(`/flow-editor/${flow.id}`)}
            class="group rounded-xl border bg-bg2 overflow-hidden cursor-pointer transition-all shadow-sm hover:shadow-md {flow.pluginId ? 'border-accent/40 ring-1 ring-accent/20 hover:border-accent/60' : 'border-border hover:border-accent/50'}"
          >
            <div class="aspect-video bg-bg3/50 flex items-center justify-center relative {flow.pluginId ? 'bg-gradient-to-br from-accent/[0.06] to-transparent' : ''}">
              <GitBranch size={32} class="text-muted/20 group-hover:text-muted/30 transition-colors" />
              {#if flow.pluginId}
                <div class="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/15 text-accent text-[9px] font-mono uppercase tracking-wider ring-1 ring-accent/20" title={m.flow_pluginManaged({ plugin: flow.pluginId })}>
                  <Puzzle size={9} /> {flow.pluginId}
                </div>
              {/if}
              <div class="absolute bottom-2 right-2 text-[10px] font-mono text-muted/50">
                {flow.nodeCount === 1 ? m.flow_nodeCount({ count: flow.nodeCount }) : m.flow_nodeCountPlural({ count: flow.nodeCount })}
              </div>
            </div>
            <div class="px-4 py-3 flex items-center justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-foreground truncate">{flow.name}</div>
                <div class="flex items-center gap-1 text-[10px] text-muted mt-0.5"><Clock size={10} /> {formatDate(flow.updatedAt)}</div>
              </div>
              <button onclick={(e) => { e.stopPropagation(); onDeleteFlow?.(flow); }} class="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded text-muted hover:text-red-400 hover:bg-bg3" title={m.flow_deleteFlow()} aria-label={m.flow_deleteFlow()}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>
```

- [ ] **Step 2: Validate with the Svelte MCP autofixer**

Run `mcp__plugin_svelte_svelte__svelte-autofixer` on the file; apply fixes; re-run until clean.

- [ ] **Step 3: Type-check**

Run: `bun run check 2>&1 | tail -20`
Expected: no NEW errors. (`flow_pluginManaged`, `flow_newFlow`, `flow_deleteFlow`, `flow_nodeCount*` already exist — verified in current `+page.svelte`.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/components/flow-editor/FlowGroupSection.svelte
git -c commit.gpgsign=false commit -m "feat(flow-editor): FlowGroupSection — group header + actions + flow cards

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Hub — i18n strings for group actions

**Files:**
- Modify: `messages/en.json`, `messages/es.json`

- [ ] **Step 1: Add the new message keys**

Add to `messages/en.json` (top-level keys, alongside the existing `flow_*` keys):

```json
  "flow_myFlows": "My Flows",
  "flow_newGroup": "New group",
  "flow_groupNamePrompt": "Group name",
  "flow_newFromTemplate": "New from template"
```

Add to `messages/es.json`:

```json
  "flow_myFlows": "Mis flujos",
  "flow_newGroup": "Nuevo grupo",
  "flow_groupNamePrompt": "Nombre del grupo",
  "flow_newFromTemplate": "Nuevo desde plantilla"
```

- [ ] **Step 2: Compile Paraglide messages**

Run: `bun run i18n:compile`
Expected: regenerates `src/lib/paraglide/messages` without error.

- [ ] **Step 3: Commit**

```bash
git add messages/en.json messages/es.json src/lib/paraglide
git -c commit.gpgsign=false commit -m "i18n(flows): group action strings (en/es)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Hub — refactor landing page to grouped sections

**Files:**
- Modify: `src/routes/(app)/flow-editor/+page.svelte`

- [ ] **Step 1: Rewrite the flows view of the page**

Replace the `<script>` body's flow-loading + the flows-view markup. The Skills toggle and `BuilderHub` branch are unchanged. New script section (replace lines ~7-120, keeping the `view` toggle and Skills branch):

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { GitBranch, Plus, BookOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import BuilderHub from '$lib/components/builder/BuilderHub.svelte';
  import FlowGroupSection from '$lib/components/flow-editor/FlowGroupSection.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { sortGroups, type FlowGroupMeta } from '$lib/flows/groups';

  let view = $state<'flows' | 'skills'>('flows');

  type FlowMeta = { id: string; name: string; nodeCount: number; createdAt: number; updatedAt: number; pluginId?: string | null; groupId?: string | null };
  type Template = { id: string; name: string; nodes: unknown[]; edges: unknown[] };
  type FlowPluginGroup = { pluginId: string; displayName: string; enabled: boolean; templates: Template[] };

  let flows = $state<FlowMeta[]>([]);
  let groups = $state<FlowGroupMeta[]>([]);
  let pluginTemplates = $state<Record<string, Template[]>>({}); // pluginId → templates
  let loading = $state(true);
  let createError = $state<string | null>(null);

  onMount(async () => {
    await loadAll();
    await reconcile(); // ensure groups, seed, migrate, release — then refresh
  });

  async function loadAll() {
    loading = true;
    try {
      const [fRes, gRes] = await Promise.all([fetch('/api/flows'), fetch('/api/flow-groups')]);
      if (fRes.ok) flows = (await fRes.json()).flows;
      if (gRes.ok) groups = (await gRes.json()).groups;
    } finally {
      loading = false;
    }
  }

  async function reconcile() {
    try {
      const res = (await sendRequest('flows.templates.list', {})) as { plugins?: FlowPluginGroup[]; templates?: { pluginId: string; id: string; name: string; nodes: unknown[]; edges: unknown[] }[] } | null;
      // Prefer the new plugins[] grouping; fall back to deriving it from flat templates.
      let plugins: FlowPluginGroup[] = res?.plugins ?? [];
      if (plugins.length === 0 && res?.templates?.length) {
        const byPlugin = new Map<string, Template[]>();
        for (const t of res.templates) {
          const arr = byPlugin.get(t.pluginId) ?? [];
          arr.push({ id: t.id, name: t.name, nodes: t.nodes, edges: t.edges });
          byPlugin.set(t.pluginId, arr);
        }
        plugins = [...byPlugin].map(([pluginId, templates]) => ({ pluginId, displayName: pluginId, enabled: true, templates }));
      }
      pluginTemplates = Object.fromEntries(plugins.map((p) => [p.pluginId, p.templates]));
      const syncRes = await fetch('/api/flows/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugins }),
      });
      if (syncRes.ok) {
        const out = await syncRes.json();
        if (out.groupsCreated || out.flowsSeeded || out.flowsReassigned || out.groupsReleased || out.groupsUpdated) {
          await loadAll();
        }
      }
    } catch {
      // gateway not connected yet — reconcile next visit
    }
  }

  // Buckets derived from flows + groups.
  const ungrouped = $derived(flows.filter((f) => !f.groupId));
  const orderedGroups = $derived(sortGroups(groups));
  function flowsIn(groupId: string) {
    return flows.filter((f) => f.groupId === groupId);
  }

  async function handleCreate(groupId: string | null) {
    createError = null;
    try {
      const name = `Flow ${new Date().toLocaleDateString()}`;
      const res = await fetch('/api/flows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, groupId }),
      });
      if (res.ok) {
        const { id } = await res.json();
        goto(`/flow-editor/${id}`);
      } else {
        createError = `Error ${res.status}: ${await res.text()}`;
      }
    } catch (e) {
      createError = e instanceof Error ? e.message : 'Unknown error';
    }
  }

  async function handleDeleteFlow(flow: FlowMeta) {
    const res = await fetch(`/api/flows/${flow.id}`, { method: 'DELETE' });
    if (res.ok) flows = flows.filter((f) => f.id !== flow.id);
  }

  async function handleNewGroup() {
    const name = prompt(m.flow_groupNamePrompt());
    if (!name) return;
    const res = await fetch('/api/flow-groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (res.ok) await loadAll();
  }

  async function handleRenameGroup(group: FlowGroupMeta) {
    const name = prompt(m.flow_groupNamePrompt(), group.name);
    if (!name) return;
    const res = await fetch(`/api/flow-groups/${group.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (res.ok) await loadAll();
  }

  async function handleDeleteGroup(group: FlowGroupMeta) {
    const res = await fetch(`/api/flow-groups/${group.id}`, { method: 'DELETE' });
    if (res.ok) await loadAll();
  }
</script>
```

- [ ] **Step 2: Replace the flows-view markup**

Replace the `{#if view === 'flows'}` content (the old grid block) with grouped sections. The header toggle row stays; replace the inner content (old lines ~156-241) with:

```svelte
    {#if view === 'flows'}
      <div class="flex-1 overflow-y-auto px-6 pb-6">
        {#if createError}
          <div class="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 font-mono">{createError}</div>
        {/if}

        <div class="flex items-center justify-end mb-4">
          <button onclick={handleNewGroup} class="flex items-center gap-1.5 h-7 px-3 text-[10px] font-mono uppercase tracking-wider rounded border border-border text-muted hover:bg-bg3 hover:text-foreground transition-colors">
            <Plus size={12} /> {m.flow_newGroup()}
          </button>
        </div>

        {#if loading}
          <p class="text-muted text-xs font-mono">{m.common_loading()}</p>
        {:else}
          <!-- My Flows (ungrouped) -->
          <FlowGroupSection
            title={m.flow_myFlows()} kind="my" flows={ungrouped}
            onNewBlank={() => handleCreate(null)} onDeleteFlow={handleDeleteFlow}
          />
          <!-- User + plugin groups -->
          {#each orderedGroups as group (group.id)}
            <FlowGroupSection
              title={group.name}
              kind={group.pluginId ? 'plugin' : 'user'}
              pluginId={group.pluginId}
              groupId={group.id}
              disabled={group.disabled}
              flows={flowsIn(group.id)}
              templates={group.pluginId ? (pluginTemplates[group.pluginId] ?? []) : []}
              onNewBlank={group.pluginId ? undefined : () => handleCreate(group.id)}
              onDeleteFlow={handleDeleteFlow}
              onRenameGroup={() => handleRenameGroup(group)}
              onDeleteGroup={() => handleDeleteGroup(group)}
              onChanged={loadAll}
            />
          {/each}
        {/if}
      </div>
    {:else}
      <BuilderHub only="skills" />
    {/if}
```

(Keep the surrounding `<div class="flex flex-col flex-1 min-h-0">` + the Flows/Skills toggle header exactly as they are.)

- [ ] **Step 3: Validate with the Svelte MCP autofixer**

Run `mcp__plugin_svelte_svelte__svelte-autofixer` on the file; apply fixes; re-run until clean.

- [ ] **Step 4: Type-check**

Run: `bun run check 2>&1 | tail -25`
Expected: no NEW errors vs. the ~18 baseline.

- [ ] **Step 5: Commit**

```bash
git add src/routes/(app)/flow-editor/+page.svelte
git -c commit.gpgsign=false commit -m "feat(flow-editor): grouped landing page (My Flows + user + plugin groups)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Full verification + live browser smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full hub test suite**

Run: `bun run test 2>&1 | tail -30`
Expected: the new flow-group/reconcile/grouping tests pass; total failures ≤ the known 7-baseline (no NEW failures).

- [ ] **Step 2: Full type-check**

Run: `bun run check 2>&1 | tail -25`
Expected: error count ≤ the ~18 baseline (no NEW errors).

- [ ] **Step 3: Gateway test + type-check (minion repo)**

Run: `cd /home/nikolas/Documents/CODE/MINION/minion && pnpm vitest run src/gateway/server-methods/flows-templates.test.ts && pnpm tsgo 2>&1 | tail -5`
Expected: flows-templates tests pass; no NEW tsgo errors.

- [ ] **Step 4: Live browser smoke test (browser-harness)**

Per `[[hub-ui-browser-testing]]`: the hub local dev at `localhost:5173` runs the `dev` branch with HMR. Start `bun run dev` if not running, then drive a real Chrome via `browser-harness` to `/flow-editor`:

```bash
browser-harness -c '
new_tab("http://localhost:5173/flow-editor")
wait_for_load()
print(page_info())
'
```

Verify by scraping the DOM (`js(...)`, since the canvas is WebGL):
- A **My Flows** section renders.
- An **Alert Watcher** plugin section renders with a Lock + 🧩, the **New from template** dropdown, and its seeded instances (pipeline / pipeline-telegram) swept in.
- A plugin instance card shows a working trash (delete) — confirm delete removes it and it does NOT reappear after reload (deletion-safe).
- (If a plugin can be toggled disabled in this env) the plugin section renders dimmed + "disabled" chip.

- [ ] **Step 5: Final summary commit (if any lint autofixes are pending)**

```bash
git add -A
git -c commit.gpgsign=false commit -m "chore(flows): lint/format pass for flow groups" || echo "nothing to commit"
```

---

## Notes for the executor

- **Deploy** is a separate, user-gated step (not part of this plan). Hub ships via `git push origin dev` then `dev:master` FF (see `[[hub-deploy-workflow]]`); the gateway change ships via `setup/utilities/deploy-bot-prd.sh` (see `[[netcup-gateway-deploy]]`) — and the hub falls back gracefully if the gateway isn't deployed first, so order is flexible.
- **Migration (Task 3)** runs against whatever `TURSO_DB_URL` resolves to — for local dev that is **prod Turso**. Running it is safe (idempotent, additive-only) but is a real prod DDL; confirm with the user before running against prod if unsure.
- All commits use `-c commit.gpgsign=false` (1Password signing breaks in this env — see `[[meta-repo-push-and-concurrency-hazards]]`).
- A concurrent GSD agent may own `minion/` — for the single gateway commit (Task 1), scope `git add` to only the two `flows-templates.*` files and do not push without checking.
```
