# Consumption Accrual System (scheduling ↔ stock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A booked service accrues its expected stock consumption (potential spend); completing the booking posts the real stock issue (real spend); cancelling releases it — all without leaving the scheduling module.

**Architecture:** New `stk_accruals` table (parallel to the real append-only ledger, never touching it) + a new `stock-accruals.service.ts` that wraps the existing service-issue flow (`createServiceIssue`/`submitEntry`). Booking lifecycle hooks call accrual functions **after** their own tx commits (fail-soft: a booking must never fail because of accrual bookkeeping). UI lands entirely on `/scheduling/bookings` (there is no booking-detail page).

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Drizzle ORM on Supabase PG (`withOrgCore` org-scoping), Paraglide i18n (en+es), vitest with `createMockDb`.

**Spec:** `docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md` — read it before starting any task.

## Global Constraints

- Repo: `minion_hub`, branch `dev`. Commit with `git -c commit.gpgsign=false commit` (1Password GPG hangs otherwise). Scope every commit to your own files — the working tree carries OTHER SESSIONS' uncommitted WIP. NEVER `git add -A` / `git add .`. Never touch: `src/server/services/rbac.service.ts`, `rbac.service.test.ts`, `src/routes/api/roles/**`, `src/routes/api/users/[id]/member-role/**`, `src/lib/components/users/RbacRolesSection.svelte`, `src/routes/(app)/settings/team/**`, `supabase/migrations/20260702140000_org_roles.sql`.
- TypeScript strict; no `any`, no `@ts-nocheck`. Svelte 5 runes only (`$state`, `$derived`, `onclick=`).
- `+server.ts` files may export ONLY HTTP handlers (GET/POST/PATCH/…) — a stray `export const mySchema` builds locally but breaks the Vercel build. Keep schemas un-exported.
- Every user-facing string: Paraglide key in BOTH `messages/en.json` and `messages/es.json`, then `bun run i18n:compile`. Never interpolate with `{{x}}` (ICU trap) — use `{x}` params.
- Numeric PG columns come back as **strings** from Drizzle — wrap reads in `Number(...)`, writes in `String(...)`.
- The real stock ledger is append-only; ONLY `submitEntry`/`cancelEntry` write it. Never write `fin_*` tables from stock code.
- Migrations: write the SQL file + Drizzle schema, but **DO NOT apply to any database** — the orchestrator applies to prod manually. Never run `drizzle-kit push`.
- Green baseline: `bun run check` → 0 errors 0 warnings; `bun run test` → all pass. Run both before every commit.
- Tests: `bun run vitest run <file>` for one file.

---

### Task 1: Migration + Drizzle schema (`stk_accruals` + warehouse `is_default`)

**Files:**
- Create: `supabase/migrations/20260705230000_stock_accruals.sql`
- Modify: `src/server/db/pg-schema/stock.ts` (append table + add one column to `stkWarehouses`)

**Interfaces:**
- Produces: Drizzle export `stkAccruals` + type `StkAccrual`; `stkWarehouses.isDefault: boolean`. Columns exactly as below — later tasks import `stkAccruals` from `$server/db/pg-schema/stock`.

- [ ] **Step 1: Write the migration**

```sql
-- Consumption accruals (potential vs real stock spend) + default warehouse.
-- A booking accrues expected consumption at creation (status 'open'); completing
-- realizes it into a posted stk_entry; cancel/no-show releases it. Parallel to
-- the real ledger — NEVER a ledger writer. Tenancy: org_id + app_ledger role +
-- app.current_org_id GUC (withOrgCore), same as 20260702130000_stock.sql.
-- Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md.

create table if not exists public.stk_accruals (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  source            text not null,                 -- 'booking' (future: 'order')
  source_id         uuid not null,                 -- e.g. sched_bookings.id
  fin_product_id    uuid,                          -- soft ref → fin_products
  item_id           uuid not null references public.stk_items (id) on delete cascade,
  warehouse_id      uuid not null references public.stk_warehouses (id),
  qty_consumption   numeric not null,              -- expected, consumption uom
  qty               numeric not null,              -- expected, stock uom
  est_unit_cost     numeric not null default 0,    -- moving-avg cost at accrual time
  est_value         numeric not null default 0,    -- qty * est_unit_cost
  status            text not null default 'open',  -- open | realized | released
  realized_entry_id uuid,
  realized_qty      numeric,
  realized_value    numeric,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  realized_at       timestamptz,
  released_at       timestamptz
);
--> statement-breakpoint
create unique index if not exists stk_accruals_org_source_item_uniq
  on public.stk_accruals (org_id, source, source_id, item_id);
--> statement-breakpoint
create index if not exists stk_accruals_org_status_idx on public.stk_accruals (org_id, status);
--> statement-breakpoint
create index if not exists stk_accruals_org_item_wh_status_idx
  on public.stk_accruals (org_id, item_id, warehouse_id, status);
--> statement-breakpoint
create index if not exists stk_accruals_source_idx on public.stk_accruals (source, source_id);
--> statement-breakpoint
grant select, insert, update, delete on public.stk_accruals to app_ledger;
--> statement-breakpoint
alter table public.stk_accruals enable row level security;
--> statement-breakpoint
alter table public.stk_accruals force  row level security;
--> statement-breakpoint
create policy stk_accruals_org_guc on public.stk_accruals
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint

-- Default warehouse: accrual paths (booking create, agent actions) carry no
-- warehouse input; the org's flagged default (else earliest-created) is used.
alter table public.stk_warehouses add column if not exists is_default boolean not null default false;
--> statement-breakpoint
create unique index if not exists stk_warehouses_default_one_per_org
  on public.stk_warehouses (org_id) where is_default;
```

- [ ] **Step 2: Append the Drizzle table to `src/server/db/pg-schema/stock.ts`**

Add `isDefault` to `stkWarehouses` (after `parentId`):

```ts
    /** Accrual paths (booking create) have no warehouse input — this org's
     *  default is used, else the earliest-created. One per org (partial uniq). */
    isDefault: boolean('is_default').notNull().default(false),
```

Append at the end of the file (before the `export type` block):

```ts
/**
 * Consumption accruals — potential (committed) spend vs realized spend.
 * A booking accrues expected consumption at creation ('open'), realizes into a
 * posted stk_entry at completion, or releases on cancel/no-show. Parallel to
 * the real ledger; NEVER a ledger writer.
 * Companion migration: supabase/migrations/20260705230000_stock_accruals.sql.
 * Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md.
 */
export const stkAccruals = pgTable(
  'stk_accruals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    /** 'booking' today; 'order' later. Legacy /stock/consume issues never accrue. */
    source: text('source').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** Soft ref → fin_products (the sold service that drove the accrual). */
    finProductId: uuid('fin_product_id'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stkItems.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => stkWarehouses.id),
    /** Expected, consumption uom (what the gauge edits). */
    qtyConsumption: numeric('qty_consumption').notNull(),
    /** Expected, stock uom (server-converted via unitsPerStockUom). */
    qty: numeric('qty').notNull(),
    /** Moving-avg cost snapshot at accrual time. */
    estUnitCost: numeric('est_unit_cost').notNull().default('0'),
    estValue: numeric('est_value').notNull().default('0'),
    /** 'open' | 'realized' | 'released' */
    status: text('status').notNull().default('open'),
    realizedEntryId: uuid('realized_entry_id'),
    realizedQty: numeric('realized_qty'),
    realizedValue: numeric('realized_value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    realizedAt: timestamp('realized_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stk_accruals_org_source_item_uniq').on(t.orgId, t.source, t.sourceId, t.itemId),
    index('stk_accruals_org_status_idx').on(t.orgId, t.status),
    index('stk_accruals_org_item_wh_status_idx').on(t.orgId, t.itemId, t.warehouseId, t.status),
    index('stk_accruals_source_idx').on(t.source, t.sourceId),
  ],
);
```

And add to the type block at the bottom:

```ts
export type StkAccrual = typeof stkAccruals.$inferSelect;
```

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260705230000_stock_accruals.sql src/server/db/pg-schema/stock.ts
git -c commit.gpgsign=false commit -m "feat(stock): stk_accruals table + warehouse is_default (migration + drizzle)"
```

---

### Task 2: Generalize `createServiceIssue` + cost-stamped preview lines

**Files:**
- Modify: `src/server/services/stock.service.ts` (interfaces `InvoicePreviewLine`, `CreateServiceIssueInput`; functions `previewLinesForItemQtys`, `createServiceIssue`; new `findEntryBySource`)
- Test: `src/server/services/stock.service.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks rely on these EXACT shapes):
  - `InvoicePreviewLine` gains `estUnitCost: number; estValue: number;`
  - `CreateServiceIssueInput` gains `source?: string; sourceId?: string | null;`
  - `export async function findEntryBySource(ctx: CoreCtx, source: string, sourceId: string): Promise<StkEntry | null>` — latest NON-cancelled entry whose `metadata->>'source'`/`'sourceId'` match.
  - `createServiceIssue` throws `StockError('a stock issue already exists for this source', 'duplicate_source')` when `sourceId` is set and a non-cancelled entry already exists for it.

- [ ] **Step 1: Write the failing tests** (append to `stock.service.test.ts`)

```ts
describe('createServiceIssue — source generalization', () => {
  it('stamps metadata source/sourceId and blocks a duplicate for the same source', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p1', name: 'Botox' }], // product
      [{ id: 'e-existing' }], // dup check finds an existing non-cancelled entry
    ]);
    await expect(
      createServiceIssue(ctx(db), {
        finProductId: 'p1',
        quantity: 1,
        warehouseId: 'w1',
        lines: [{ itemId: 'i1', qty: 1 }],
        actor,
        source: 'booking',
        sourceId: 'b1',
      }),
    ).rejects.toMatchObject({ code: 'duplicate_source' });
  });

  it('legacy service issues (no sourceId) skip the dup guard entirely', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'p1', name: 'Botox' }], // product
      [], // resolveConsumptionLines item lookup (no qtyConsumption lines → skipped… next await is insert returning)
      [{ id: 'e1', orgId: 'org-1', type: 'issue', status: 'draft', metadata: { source: 'service' } }], // insert entries returning
      [], // insert lines
    ]);
    const entry = await createServiceIssue(ctx(db), {
      finProductId: 'p1',
      quantity: 1,
      warehouseId: 'w1',
      lines: [{ itemId: 'i1', qty: 1 }],
      actor,
    });
    expect(entry.id).toBe('e1');
  });
});

describe('findEntryBySource', () => {
  it('returns the latest non-cancelled entry for the source', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'e9', orgId: 'org-1', status: 'submitted', type: 'issue' }]]);
    const e = await findEntryBySource(ctx(db), 'booking', 'b1');
    expect(e?.id).toBe('e9');
  });
  it('returns null when none exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    expect(await findEntryBySource(ctx(db), 'booking', 'b1')).toBeNull();
  });
});
```

Add `findEntryBySource` to the test file's import list from `./stock.service`.

> NOTE on the mock: every awaited chain (selects, `insert(...).returning()`, plain inserts) consumes the NEXT `resolveSequence` entry, in call order. If a test fails with "undefined id", recount the awaits in the code path and adjust the sequence.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/services/stock.service.test.ts`
Expected: FAIL — `findEntryBySource` not exported; dup test gets no `duplicate_source`.

- [ ] **Step 3: Implement**

In `InvoicePreviewLine` (≈ line 693), append two fields:

```ts
  /** Moving-avg cost of one stock uom at this warehouse, at preview time. */
  estUnitCost: number;
  /** qty × estUnitCost — the line's potential spend. */
  estValue: number;
```

In `previewLinesForItemQtys` (≈ line 802): add `valuationRate: stkBins.valuationRate` to the bins select, build `const rateByItem = new Map(binRows.map((r) => [r.itemId, Number(r.valuationRate)]));`, and in the returned mapper add:

```ts
      estUnitCost: rateByItem.get(itemId) ?? 0,
      estValue: round4((rateByItem.get(itemId) ?? 0) * round4(consumptionToStockQty({ unitsPerStockUom }, qtyConsumption))),
```

(Compute `const qty = round4(consumptionToStockQty({ unitsPerStockUom }, qtyConsumption));` once and reuse it for both `qty:` and `estValue:` — don't call the conversion twice.)

In `CreateServiceIssueInput` (≈ line 920) append:

```ts
  /** Generic provenance: 'service' (default, /stock/consume) | 'booking' | future 'order'. */
  source?: string;
  /** When set, a same-tx dup guard refuses a second non-cancelled entry for
   *  (source, sourceId) — mirrors the invoice guard. Absent for legacy
   *  'service' issues, which legitimately repeat. */
  sourceId?: string | null;
```

In `createServiceIssue`, after the product lookup and BEFORE `resolveConsumptionLines`, add:

```ts
    if (input.sourceId) {
      const src = input.source ?? 'service';
      const [dup] = await tx
        .select({ id: stkEntries.id })
        .from(stkEntries)
        .where(
          and(
            eq(stkEntries.orgId, ctx.tenantId),
            ne(stkEntries.status, 'cancelled'),
            sql`${stkEntries.metadata}->>'source' = ${src}`,
            sql`${stkEntries.metadata}->>'sourceId' = ${input.sourceId}`,
          ),
        );
      if (dup) throw new StockError('a stock issue already exists for this source', 'duplicate_source');
    }
```

And change the insert's `metadata:` value to:

```ts
        metadata: {
          source: input.source ?? 'service',
          finProductId: input.finProductId,
          quantity: input.quantity,
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        },
```

Append `findEntryBySource` next to `findEntryByInvoice` (end of file):

```ts
/** Latest NON-cancelled entry stamped with metadata {source, sourceId} — the
 *  booking realize path's retry/idempotency anchor (a draft left behind by a
 *  negative-stock failure is found and re-submitted instead of duplicated). */
export async function findEntryBySource(ctx: CoreCtx, source: string, sourceId: string): Promise<StkEntry | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .select()
      .from(stkEntries)
      .where(
        and(
          eq(stkEntries.orgId, ctx.tenantId),
          ne(stkEntries.status, 'cancelled'),
          sql`${stkEntries.metadata}->>'source' = ${source}`,
          sql`${stkEntries.metadata}->>'sourceId' = ${sourceId}`,
        ),
      )
      .orderBy(desc(stkEntries.createdAt))
      .limit(1);
    return row ?? null;
  });
}
```

- [ ] **Step 4: Run tests**

Run: `bun run vitest run src/server/services/stock.service.test.ts`
Expected: ALL pass (including the pre-existing invoice/service tests — `estUnitCost`/`estValue` are additive).

- [ ] **Step 5: Commit**

```bash
git add src/server/services/stock.service.ts src/server/services/stock.service.test.ts
git -c commit.gpgsign=false commit -m "feat(stock): generalize createServiceIssue source/sourceId + dup guard; cost-stamped preview lines"
```

---

### Task 3: `stock-accruals.service.ts` — accrue / release / default warehouse

**Files:**
- Create: `src/server/services/stock-accruals.service.ts`
- Test: `src/server/services/stock-accruals.service.test.ts`

**Interfaces:**
- Consumes: `stkAccruals`, `stkWarehouses`, `stkItems`, `stkBins`, `stkConsumption` (Task 1); `consumptionToStockQty`, `round4` from `./stock.logic`.
- Produces (exact signatures later tasks call):
  - `export interface AccrualLineInput { itemId: string; qtyConsumption: number }`
  - `export async function accrueConsumption(ctx: CoreCtx, input: { source: string; sourceId: string; finProductId: string | null; warehouseId?: string | null; lines?: AccrualLineInput[] | null; quantity?: number }): Promise<number>` — rows written; `0` = logical no-op (no product / no mapping / no warehouse / already settled).
  - `export async function releaseAccruals(ctx: CoreCtx, source: string, sourceId: string): Promise<number>`
  - `export function resolveDefaultWarehouse(ctx: CoreCtx): Promise<string | null>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { accrueConsumption, releaseAccruals, resolveDefaultWarehouse } from './stock-accruals.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('resolveDefaultWarehouse', () => {
  it('prefers the flagged default over the earliest-created', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[
      { id: 'w-old', isDefault: false },
      { id: 'w-def', isDefault: true },
    ]]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-def');
  });
  it('falls back to the earliest-created; null when no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'w-old', isDefault: false }], []]);
    expect(await resolveDefaultWarehouse(ctx(db))).toBe('w-old');
    expect(await resolveDefaultWarehouse(ctx(db))).toBeNull();
  });
});

describe('accrueConsumption', () => {
  it('accrues explicit lines with server-side uom conversion and bin-rate cost', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals for source (none)
      [{ id: 'w1', isDefault: true }], // warehouses (default resolution)
      [{ id: 'i1', unitsPerStockUom: '500' }], // items (500 ml per caja)
      [{ itemId: 'i1', valuationRate: '100' }], // bins (S/100 per caja)
      [], // delete open rows
      [], // insert new rows
    ]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }], // 5 ml → 0.01 caja → est S/1
    });
    expect(n).toBe(1);
    expect(db.insert).toHaveBeenCalled();
  });

  it('computes defaults from stk_consumption when no lines are passed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // existing accruals
      [{ id: 'w1', isDefault: false }], // warehouses
      [{ itemId: 'i1', qtyPerUnit: '2' }], // mapping: 2 per unit
      [{ id: 'i1', unitsPerStockUom: null }], // item (no conversion)
      [], // bins (no bin yet → cost 0)
      [], // delete
      [], // insert
    ]);
    const n = await accrueConsumption(ctx(db), { source: 'booking', sourceId: 'b1', finProductId: 'p1' });
    expect(n).toBe(1);
  });

  it('is a no-op when the source is already settled (realized rows exist)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1', status: 'realized' }]]);
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the org has no warehouses', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // no accruals, no warehouses
    const n = await accrueConsumption(ctx(db), {
      source: 'booking',
      sourceId: 'b1',
      finProductId: 'p1',
      lines: [{ itemId: 'i1', qtyConsumption: 5 }],
    });
    expect(n).toBe(0);
  });

  it('is a no-op for an unmapped product (no lines, empty stk_consumption)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], [{ id: 'w1', isDefault: true }], []]); // no accruals, warehouse, empty mapping
    const n = await accrueConsumption(ctx(db), { source: 'booking', sourceId: 'b1', finProductId: 'p1' });
    expect(n).toBe(0);
  });
});

describe('releaseAccruals', () => {
  it('flips only open rows and reports the count', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'a1' }, { id: 'a2' }]]); // update(...).returning()
    const n = await releaseAccruals(ctx(db), 'booking', 'b1');
    expect(n).toBe(2);
    expect(db.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/services/stock-accruals.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/server/services/stock-accruals.service.ts`**

```ts
/**
 * Consumption accruals — potential (committed) stock spend vs realized spend.
 *
 * A booked service accrues its expected consumption ('open'); completion
 * realizes it into a posted stk_entry (via the existing createServiceIssue →
 * submitEntry path — this module NEVER writes the real ledger itself); cancel /
 * no-show releases it. All functions are plain ctx-level withOrgCore functions
 * called AFTER the booking tx commits (a statement error inside a PG tx poisons
 * the whole tx, so "fail-soft inside the booking tx" is impossible) — booking
 * call sites wrap them in try/catch, and business no-ops (no mapping, no
 * warehouse, already settled) return 0 instead of throwing.
 *
 * Design: docs/superpowers/specs/2026-07-05-consumption-accrual-scheduling-stock-design.md
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  stkAccruals,
  stkBins,
  stkConsumption,
  stkItems,
  stkLedger,
  stkWarehouses,
  type StkAccrual,
  type StkEntry,
} from '$server/db/pg-schema/stock';
import { consumptionToStockQty, round4 } from './stock.logic';

export interface AccrualLineInput {
  itemId: string;
  qtyConsumption: number;
}

async function defaultWarehouseTx(tx: CoreTx, orgId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: stkWarehouses.id, isDefault: stkWarehouses.isDefault })
    .from(stkWarehouses)
    .where(eq(stkWarehouses.orgId, orgId))
    .orderBy(asc(stkWarehouses.createdAt));
  return rows.find((w) => w.isDefault)?.id ?? rows[0]?.id ?? null;
}

/** Org's flagged default warehouse, else the earliest-created, else null. */
export function resolveDefaultWarehouse(ctx: CoreCtx): Promise<string | null> {
  return withOrgCore(ctx, (tx) => defaultWarehouseTx(tx, ctx.tenantId));
}

export interface AccrueInput {
  source: string;
  sourceId: string;
  finProductId: string | null;
  warehouseId?: string | null;
  /** Adjusted lines from the UI; absent → defaults from stk_consumption. */
  lines?: AccrualLineInput[] | null;
  /** Units of service for the defaults path (bookings are always 1). */
  quantity?: number;
}

/**
 * (Re)accrue the open consumption set for a source. Replaces existing OPEN
 * rows (idempotent re-adjust); a source with any realized/released row is
 * settled and never resurrected. Returns rows written; 0 = logical no-op.
 */
export async function accrueConsumption(ctx: CoreCtx, input: AccrueInput): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const orgId = ctx.tenantId;
    const existing = await tx
      .select({ id: stkAccruals.id, status: stkAccruals.status })
      .from(stkAccruals)
      .where(and(eq(stkAccruals.orgId, orgId), eq(stkAccruals.source, input.source), eq(stkAccruals.sourceId, input.sourceId)));
    if (existing.some((r) => r.status !== 'open')) return 0; // settled — never resurrect

    const warehouseId = input.warehouseId ?? (await defaultWarehouseTx(tx, orgId));
    if (!warehouseId) return 0; // nothing to commit against

    let lines = (input.lines ?? []).filter((l) => l.qtyConsumption > 0);
    if (!lines.length) {
      if (!input.finProductId) return 0;
      const quantity = input.quantity && input.quantity > 0 ? input.quantity : 1;
      const mapping = await tx
        .select({ itemId: stkConsumption.itemId, qtyPerUnit: stkConsumption.qtyPerUnit })
        .from(stkConsumption)
        .where(and(eq(stkConsumption.orgId, orgId), eq(stkConsumption.finProductId, input.finProductId)));
      const byItem = new Map<string, number>();
      for (const m of mapping) byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + quantity * Number(m.qtyPerUnit));
      lines = [...byItem].map(([itemId, qtyConsumption]) => ({ itemId, qtyConsumption }));
    }
    if (!lines.length) return 0; // unmapped product

    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const items = await tx
      .select({ id: stkItems.id, unitsPerStockUom: stkItems.unitsPerStockUom })
      .from(stkItems)
      .where(and(eq(stkItems.orgId, orgId), inArray(stkItems.id, itemIds)));
    const upsByItem = new Map(items.map((i) => [i.id, i.unitsPerStockUom == null ? null : Number(i.unitsPerStockUom)]));
    const bins = await tx
      .select({ itemId: stkBins.itemId, valuationRate: stkBins.valuationRate })
      .from(stkBins)
      .where(and(eq(stkBins.orgId, orgId), eq(stkBins.warehouseId, warehouseId), inArray(stkBins.itemId, itemIds)));
    const rateByItem = new Map(bins.map((b) => [b.itemId, Number(b.valuationRate)]));

    await tx
      .delete(stkAccruals)
      .where(and(eq(stkAccruals.orgId, orgId), eq(stkAccruals.source, input.source), eq(stkAccruals.sourceId, input.sourceId), eq(stkAccruals.status, 'open')));
    const rows = lines
      .filter((l) => upsByItem.has(l.itemId)) // unknown item id → skip, not fail
      .map((l) => {
        const qty = round4(consumptionToStockQty({ unitsPerStockUom: upsByItem.get(l.itemId) ?? null }, l.qtyConsumption));
        const rate = rateByItem.get(l.itemId) ?? 0;
        return {
          orgId,
          source: input.source,
          sourceId: input.sourceId,
          finProductId: input.finProductId,
          itemId: l.itemId,
          warehouseId,
          qtyConsumption: String(l.qtyConsumption),
          qty: String(qty),
          estUnitCost: String(rate),
          estValue: String(round4(qty * rate)),
        };
      });
    if (rows.length) await tx.insert(stkAccruals).values(rows);
    return rows.length;
  });
}

/** Cancel / no-show path: open rows → released. Idempotent. */
export async function releaseAccruals(ctx: CoreCtx, source: string, sourceId: string): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(stkAccruals)
      .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.source, source), eq(stkAccruals.sourceId, sourceId), eq(stkAccruals.status, 'open')))
      .returning({ id: stkAccruals.id });
    return rows.length;
  });
}
```

(`desc`, `sql`, `stkLedger`, `StkAccrual`, `StkEntry` imports are used by Task 4 — leave them; if `bun run check` flags unused imports, drop them here and re-add in Task 4.)

- [ ] **Step 4: Run tests**

Run: `bun run vitest run src/server/services/stock-accruals.service.test.ts`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/stock-accruals.service.ts src/server/services/stock-accruals.service.test.ts
git -c commit.gpgsign=false commit -m "feat(stock): accrual service — accrue/release + default-warehouse resolution"
```

---

### Task 4: Accrual service — preview, realize, queries

**Files:**
- Modify: `src/server/services/stock-accruals.service.ts`
- Test: `src/server/services/stock-accruals.service.test.ts` (append)

**Interfaces:**
- Consumes: Task 2's `findEntryBySource`, `createServiceIssue`, `submitEntry`, `StockError`, `Actor`, `CreateIssueFromInvoiceLine`, `buildServiceIssuePreview`, `InvoicePreviewLine` (all from `./stock.service`); Task 3's `resolveDefaultWarehouse`, `defaultWarehouseTx`.
- Produces (exact shapes for routes/UI tasks):

```ts
export interface AccrualPreviewLine extends InvoicePreviewLine { committedOther: number; atp: number }
export interface AccrualPreview { productName: string; productCode: string | null; warehouseId: string; hasMapping: boolean; lines: AccrualPreviewLine[] }
export async function buildAccrualPreview(ctx, input: { finProductId: string; quantity: number; warehouseId?: string | null; excludeSource?: { source: string; sourceId: string } | null }): Promise<AccrualPreview>

export interface RealizeResult { entry: StkEntry | null; realized: number; stockWarning: { code: string; message: string; draftEntryId?: string } | null }
export async function realizeAccruals(ctx, input: { source: string; sourceId: string; lines?: CreateIssueFromInvoiceLine[] | null; warehouseId?: string | null; finProductId?: string | null; partyId?: string | null; note?: string | null; actor: Actor }): Promise<RealizeResult>

export interface AccrualListRow extends StkAccrual { itemName: string; itemCode: string; itemUom: string; consumptionUom: string | null; unitsPerStockUom: string | null; subunitsPerStockUom: string | null; diagramEnabled: boolean }
export function listAccruals(ctx, filters?: { status?: string; itemId?: string; source?: string; sourceId?: string }): Promise<AccrualListRow[]>

export async function availableToPromise(ctx, itemId: string, warehouseId: string): Promise<number>
export async function committedSpend(ctx, filters?: { warehouseId?: string }): Promise<number>

export interface AccrualSourceSummary { sourceId: string; open: number; realized: number; released: number; estValue: number; realizedValue: number; realizedEntryId: string | null }
export async function accrualSummaryForSources(ctx, source: string, sourceIds: string[]): Promise<AccrualSourceSummary[]>
```

- [ ] **Step 1: Write the failing tests** (append to the test file)

```ts
import { realizeAccruals, accrualSummaryForSources, availableToPromise } from './stock-accruals.service';
// merge into the existing import from './stock-accruals.service'

const actor = { id: 'u1', name: 'Test User' };

describe('realizeAccruals', () => {
  it('no open accruals + no lines → clean no-op', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // open accruals
      [], // findEntryBySource
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r).toEqual({ entry: null, realized: 0, stockWarning: null });
  });

  it('a pre-existing SUBMITTED entry heals accruals without a second issue (idempotent retry)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 'a1', itemId: 'i1', qty: '0.01', qtyConsumption: '5', finProductId: 'p1', warehouseId: 'w1' },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'submitted', type: 'issue' }], // findEntryBySource
      [{ itemId: 'i1', qtyDelta: '-0.01', valueDelta: '-1' }], // ledger rows for e1
      [], // update accrual a1 → realized
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.entry?.id).toBe('e1');
    expect(r.realized).toBe(1);
    expect(r.stockWarning).toBeNull();
  });

  it('a draft that fails to submit returns stockWarning, leaves accruals open (negative-stock completion path)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        { id: 'a1', itemId: 'i1', qty: '10', qtyConsumption: '10', finProductId: 'p1', warehouseId: 'w1' },
      ], // open accruals
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue' }], // findEntryBySource → draft
      // submitEntry's internal sequence:
      [{ id: 'e1', orgId: 'org-1', status: 'draft', type: 'issue', humanId: null }], // entry for update
      [{ id: 'l1', entryId: 'e1', itemId: 'i1', qty: '10', uom: null, rate: null, fromWarehouseId: 'w1', toWarehouseId: null, lineNo: 0 }], // lines
      [{ id: 'i1' }], // item existence
      [{ id: 'w1' }], // warehouse existence
      [{ qty: '2', valuationRate: '1' }], // bin: only 2 in stock → negative_stock
    ]);
    const r = await realizeAccruals(ctx(db), { source: 'booking', sourceId: 'b1', actor });
    expect(r.stockWarning).toMatchObject({ code: 'negative_stock', draftEntryId: 'e1' });
    expect(r.realized).toBe(0);
    expect(db.update).not.toHaveBeenCalled(); // accruals untouched — still open
  });
});

describe('accrualSummaryForSources', () => {
  it('folds per-source status counts and values', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[
      { sourceId: 'b1', status: 'open', estValue: '10', realizedValue: null, realizedEntryId: null },
      { sourceId: 'b1', status: 'open', estValue: '5', realizedValue: null, realizedEntryId: null },
      { sourceId: 'b2', status: 'realized', estValue: '7', realizedValue: '8', realizedEntryId: 'e1' },
    ]]);
    const out = await accrualSummaryForSources(ctx(db), 'booking', ['b1', 'b2']);
    const b1 = out.find((s) => s.sourceId === 'b1')!;
    const b2 = out.find((s) => s.sourceId === 'b2')!;
    expect(b1).toMatchObject({ open: 2, realized: 0, estValue: 15 });
    expect(b2).toMatchObject({ open: 0, realized: 1, realizedValue: 8, realizedEntryId: 'e1' });
  });
  it('returns [] for an empty id list without querying', async () => {
    const { db } = createMockDb();
    expect(await accrualSummaryForSources(ctx(db), 'booking', [])).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('availableToPromise', () => {
  it('bin qty minus open committed qty', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ qty: '10' }], // bin
      [{ total: '3' }], // open accruals sum
    ]);
    expect(await availableToPromise(ctx(db), 'i1', 'w1')).toBe(7);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/services/stock-accruals.service.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement** (append to `stock-accruals.service.ts`; extend the top import from `./stock.service`)

```ts
import {
  buildServiceIssuePreview,
  createServiceIssue,
  findEntryBySource,
  submitEntry,
  StockError,
  type Actor,
  type CreateIssueFromInvoiceLine,
  type InvoicePreviewLine,
} from './stock.service';
```

```ts
export interface AccrualPreviewLine extends InvoicePreviewLine {
  /** Σ open-accrual stock-uom qty for (item, warehouse), excluding excludeSource. */
  committedOther: number;
  /** available − committedOther. Warn (not block) when a line's qty exceeds it. */
  atp: number;
}

export interface AccrualPreview {
  productName: string;
  productCode: string | null;
  warehouseId: string;
  hasMapping: boolean;
  lines: AccrualPreviewLine[];
}

/**
 * Gauge-ready preview of what booking `quantity` units of a service will
 * commit: the service-issue preview plus committed-elsewhere and ATP per line.
 * Warehouse defaults server-side. Throws StockError('no_warehouse') only here
 * (a preview with nowhere to look is a real error; accrue itself no-ops).
 */
export async function buildAccrualPreview(
  ctx: CoreCtx,
  input: { finProductId: string; quantity: number; warehouseId?: string | null; excludeSource?: { source: string; sourceId: string } | null },
): Promise<AccrualPreview> {
  const warehouseId = input.warehouseId ?? (await resolveDefaultWarehouse(ctx));
  if (!warehouseId) throw new StockError('no warehouse configured', 'no_warehouse');
  const preview = await buildServiceIssuePreview(ctx, { finProductId: input.finProductId, quantity: input.quantity, warehouseId });
  const itemIds = preview.lines.map((l) => l.itemId);
  const committed = itemIds.length
    ? await withOrgCore(ctx, (tx) =>
        tx
          .select({ itemId: stkAccruals.itemId, total: sql<string>`coalesce(sum(${stkAccruals.qty}), 0)` })
          .from(stkAccruals)
          .where(
            and(
              eq(stkAccruals.orgId, ctx.tenantId),
              eq(stkAccruals.warehouseId, warehouseId),
              inArray(stkAccruals.itemId, itemIds),
              eq(stkAccruals.status, 'open'),
              ...(input.excludeSource
                ? [sql`not (${stkAccruals.source} = ${input.excludeSource.source} and ${stkAccruals.sourceId} = ${input.excludeSource.sourceId})`]
                : []),
            ),
          )
          .groupBy(stkAccruals.itemId),
      )
    : [];
  const committedByItem = new Map(committed.map((c) => [c.itemId, Number(c.total)]));
  return {
    productName: preview.productName,
    productCode: preview.productCode,
    warehouseId,
    hasMapping: preview.hasMapping,
    lines: preview.lines.map((l) => {
      const committedOther = committedByItem.get(l.itemId) ?? 0;
      return { ...l, committedOther, atp: round4(l.available - committedOther) };
    }),
  };
}

export interface RealizeResult {
  entry: StkEntry | null;
  realized: number;
  /** Set when the issue could not POST (negative_stock etc). The draft entry
   *  stands; accruals stay open; re-calling realizeAccruals retries it. */
  stockWarning: { code: string; message: string; draftEntryId?: string } | null;
}

export interface RealizeInput {
  source: string;
  sourceId: string;
  /** Completion-dialog adjustments; absent → the open accruals as-is. */
  lines?: CreateIssueFromInvoiceLine[] | null;
  warehouseId?: string | null;
  /** Fallback when no accruals exist (e.g. accrue was lost) — booking.productId. */
  finProductId?: string | null;
  partyId?: string | null;
  note?: string | null;
  actor: Actor;
}

/**
 * Completion path — a small idempotent state machine:
 *   no entry yet   → create draft issue (source-stamped) from lines/accruals
 *   entry is draft → (re)try submitEntry; negative_stock → return stockWarning
 *   entry submitted→ stamp actuals from its ledger rows onto the open accruals
 * Accrued items missing from the final issue are released (superseded); items
 * issued but never accrued simply have no accrual row (ledger is the truth).
 */
export async function realizeAccruals(ctx: CoreCtx, input: RealizeInput): Promise<RealizeResult> {
  const open = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(stkAccruals)
      .where(and(eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.source, input.source), eq(stkAccruals.sourceId, input.sourceId), eq(stkAccruals.status, 'open'))),
  );

  let entry = await findEntryBySource(ctx, input.source, input.sourceId);
  if (!entry) {
    const lines: CreateIssueFromInvoiceLine[] = input.lines?.length
      ? input.lines
      : open.map((a) => ({ itemId: a.itemId, qty: Number(a.qty), qtyConsumption: Number(a.qtyConsumption) }));
    if (!lines.length) return { entry: null, realized: 0, stockWarning: null };
    const finProductId = input.finProductId ?? open[0]?.finProductId ?? null;
    if (!finProductId) return { entry: null, realized: 0, stockWarning: null };
    const warehouseId = input.warehouseId ?? open[0]?.warehouseId ?? (await resolveDefaultWarehouse(ctx));
    if (!warehouseId) throw new StockError('no warehouse configured', 'no_warehouse');
    entry = await createServiceIssue(ctx, {
      finProductId,
      quantity: 1,
      warehouseId,
      partyId: input.partyId ?? null,
      note: input.note ?? null,
      lines,
      submit: false,
      actor: input.actor,
      source: input.source,
      sourceId: input.sourceId,
    });
  }

  if (entry.status === 'draft') {
    // ponytail: a draft left by an earlier failed attempt posts as-is; retry
    // lines don't rewrite it (adjust the draft in Stock → Entries if needed).
    try {
      entry = await submitEntry(ctx, entry.id, input.actor);
    } catch (e) {
      if (e instanceof StockError) {
        return { entry, realized: 0, stockWarning: { code: e.code, message: e.message, draftEntryId: entry.id } };
      }
      throw e;
    }
  }

  const entryId = entry.id;
  const realized = await withOrgCore(ctx, async (tx) => {
    const ledger = await tx
      .select({ itemId: stkLedger.itemId, qtyDelta: stkLedger.qtyDelta, valueDelta: stkLedger.valueDelta })
      .from(stkLedger)
      .where(and(eq(stkLedger.orgId, ctx.tenantId), eq(stkLedger.entryId, entryId)));
    const qtyByItem = new Map<string, number>();
    const valByItem = new Map<string, number>();
    for (const r of ledger) {
      qtyByItem.set(r.itemId, (qtyByItem.get(r.itemId) ?? 0) - Number(r.qtyDelta));
      valByItem.set(r.itemId, (valByItem.get(r.itemId) ?? 0) - Number(r.valueDelta));
    }
    let n = 0;
    for (const a of open) {
      if (qtyByItem.has(a.itemId)) {
        await tx
          .update(stkAccruals)
          .set({
            status: 'realized',
            realizedEntryId: entryId,
            realizedQty: String(round4(qtyByItem.get(a.itemId)!)),
            realizedValue: String(round4(valByItem.get(a.itemId)!)),
            realizedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(stkAccruals.id, a.id), eq(stkAccruals.status, 'open')));
        n++;
      } else {
        // Accrued but not consumed in the final issue → superseded.
        await tx
          .update(stkAccruals)
          .set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(stkAccruals.id, a.id), eq(stkAccruals.status, 'open')));
      }
    }
    return n;
  });
  return { entry, realized, stockWarning: null };
}

export interface AccrualListRow extends StkAccrual {
  itemName: string;
  itemCode: string;
  itemUom: string;
  consumptionUom: string | null;
  unitsPerStockUom: string | null;
  subunitsPerStockUom: string | null;
  diagramEnabled: boolean;
}

/** Accruals joined with item/UOM fields — enough for the ConsumptionGauge. */
export function listAccruals(
  ctx: CoreCtx,
  filters: { status?: string; itemId?: string; source?: string; sourceId?: string } = {},
): Promise<AccrualListRow[]> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkAccruals.orgId, ctx.tenantId)];
    if (filters.status) conds.push(eq(stkAccruals.status, filters.status));
    if (filters.itemId) conds.push(eq(stkAccruals.itemId, filters.itemId));
    if (filters.source) conds.push(eq(stkAccruals.source, filters.source));
    if (filters.sourceId) conds.push(eq(stkAccruals.sourceId, filters.sourceId));
    const rows = await tx
      .select({
        accrual: stkAccruals,
        itemName: stkItems.name,
        itemCode: stkItems.code,
        itemUom: stkItems.uom,
        consumptionUom: stkItems.consumptionUom,
        unitsPerStockUom: stkItems.unitsPerStockUom,
        subunitsPerStockUom: stkItems.subunitsPerStockUom,
        diagramEnabled: stkItems.diagramEnabled,
      })
      .from(stkAccruals)
      .innerJoin(stkItems, eq(stkAccruals.itemId, stkItems.id))
      .where(and(...conds))
      .orderBy(desc(stkAccruals.createdAt))
      .limit(1000);
    return rows.map((r) => ({
      ...r.accrual,
      itemName: r.itemName,
      itemCode: r.itemCode,
      itemUom: r.itemUom,
      consumptionUom: r.consumptionUom,
      unitsPerStockUom: r.unitsPerStockUom,
      subunitsPerStockUom: r.subunitsPerStockUom,
      diagramEnabled: r.diagramEnabled,
    }));
  });
}

/** bin.qty − Σ open-accrual qty for (item, warehouse). */
export async function availableToPromise(ctx: CoreCtx, itemId: string, warehouseId: string): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const [bin] = await tx
      .select({ qty: stkBins.qty })
      .from(stkBins)
      .where(and(eq(stkBins.orgId, ctx.tenantId), eq(stkBins.itemId, itemId), eq(stkBins.warehouseId, warehouseId)));
    const [committed] = await tx
      .select({ total: sql<string>`coalesce(sum(${stkAccruals.qty}), 0)` })
      .from(stkAccruals)
      .where(and(eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.itemId, itemId), eq(stkAccruals.warehouseId, warehouseId), eq(stkAccruals.status, 'open')));
    return round4(Number(bin?.qty ?? 0) - Number(committed?.total ?? 0));
  });
}

/** Σ est_value of open accruals — the "potential spend" headline. */
export async function committedSpend(ctx: CoreCtx, filters: { warehouseId?: string } = {}): Promise<number> {
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.status, 'open')];
    if (filters.warehouseId) conds.push(eq(stkAccruals.warehouseId, filters.warehouseId));
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${stkAccruals.estValue}), 0)` })
      .from(stkAccruals)
      .where(and(...conds));
    return Number(row?.total ?? 0);
  });
}

export interface AccrualSourceSummary {
  sourceId: string;
  open: number;
  realized: number;
  released: number;
  estValue: number;
  realizedValue: number;
  realizedEntryId: string | null;
}

/** Batch rollup for list pages (one query, no N+1). */
export async function accrualSummaryForSources(ctx: CoreCtx, source: string, sourceIds: string[]): Promise<AccrualSourceSummary[]> {
  if (!sourceIds.length) return [];
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        sourceId: stkAccruals.sourceId,
        status: stkAccruals.status,
        estValue: stkAccruals.estValue,
        realizedValue: stkAccruals.realizedValue,
        realizedEntryId: stkAccruals.realizedEntryId,
      })
      .from(stkAccruals)
      .where(and(eq(stkAccruals.orgId, ctx.tenantId), eq(stkAccruals.source, source), inArray(stkAccruals.sourceId, sourceIds))),
  );
  const bySource = new Map<string, AccrualSourceSummary>();
  for (const r of rows) {
    const s = bySource.get(r.sourceId) ?? { sourceId: r.sourceId, open: 0, realized: 0, released: 0, estValue: 0, realizedValue: 0, realizedEntryId: null };
    if (r.status === 'open') s.open++;
    else if (r.status === 'realized') s.realized++;
    else s.released++;
    s.estValue = round4(s.estValue + Number(r.estValue));
    s.realizedValue = round4(s.realizedValue + Number(r.realizedValue ?? 0));
    if (r.realizedEntryId) s.realizedEntryId = r.realizedEntryId;
    bySource.set(r.sourceId, s);
  }
  return [...bySource.values()];
}
```

- [ ] **Step 4: Run tests**

Run: `bun run vitest run src/server/services/stock-accruals.service.test.ts`
Expected: ALL pass. Also run `bun run vitest run src/server/services/stock.service.test.ts` — still green.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/stock-accruals.service.ts src/server/services/stock-accruals.service.test.ts
git -c commit.gpgsign=false commit -m "feat(stock): accrual preview, realize state machine, ATP + summary queries"
```

---

### Task 5: Booking lifecycle hooks (accrue on create, release on cancel)

**Files:**
- Modify: `src/server/services/scheduling-bookings.service.ts`
- Test: Create `src/server/services/scheduling-bookings-accrual.test.ts`

**Interfaces:**
- Consumes: `accrueConsumption`, `releaseAccruals`, `AccrualLineInput` (Task 3); `isModuleEnabled` from `./modules.service`.
- Produces: `CreateBookingInput` gains `consumption?: AccrualLineInput[] | null`. `createBooking`/`setBookingStatus` signatures otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

const accrueMock = vi.fn<(ctx: unknown, input: unknown) => Promise<number>>(async () => 1);
const releaseMock = vi.fn<(ctx: unknown, s: string, id: string) => Promise<number>>(async () => 1);
vi.mock('./stock-accruals.service', () => ({
  accrueConsumption: (ctx: unknown, input: unknown) => accrueMock(ctx, input),
  releaseAccruals: (ctx: unknown, s: string, id: string) => releaseMock(ctx, s, id),
}));
vi.mock('./modules.service', () => ({ isModuleEnabled: async () => true }));

import { setBookingStatus } from './scheduling-bookings.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('setBookingStatus — accrual release hook', () => {
  it.each(['cancelled', 'rejected', 'no_show'])('releases open accruals on %s', async (status) => {
    const { db } = createMockDb();
    await setBookingStatus(ctx(db), 'b1', status);
    expect(releaseMock).toHaveBeenCalledWith(expect.anything(), 'booking', 'b1');
  });

  it('does NOT release on accepted/completed', async () => {
    const { db } = createMockDb();
    await setBookingStatus(ctx(db), 'b1', 'accepted');
    await setBookingStatus(ctx(db), 'b1', 'completed');
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('a release failure never fails the status change', async () => {
    releaseMock.mockRejectedValueOnce(new Error('db down'));
    const { db } = createMockDb();
    await expect(setBookingStatus(ctx(db), 'b1', 'cancelled')).resolves.toBeUndefined();
  });
});
```

(`createBooking` is not mock-tested — its slot-engine path needs ~10 sequenced results and exists tests already cover it; the accrue hook is post-commit + try/catch, verified by `bun run check` + the release tests proving the same wiring pattern.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/services/scheduling-bookings-accrual.test.ts`
Expected: FAIL — `releaseMock` not called.

- [ ] **Step 3: Implement**

In `scheduling-bookings.service.ts` add imports:

```ts
import { accrueConsumption, releaseAccruals, type AccrualLineInput } from './stock-accruals.service';
import { isModuleEnabled } from './modules.service';
```

Extend `CreateBookingInput` (after `bypassRules`):

```ts
  /** Adjusted stock-consumption lines from the booking modal (consumption uom).
   *  Absent → defaults accrue from the product's stk_consumption mapping. */
  consumption?: AccrualLineInput[] | null;
```

Restructure `createBooking`'s tail. The `withOrgCore` callback currently ends with two return paths (`return existing;` on uid conflict, `return row;` on fresh insert). Change it to return `{ row, created }` and accrue after the tx:

```ts
    if (!row) {
      // uid already used — return the existing booking (idempotent retry).
      const [existing] = await tx
        .select()
        .from(schedBookings)
        .where(and(eq(schedBookings.orgId, ctx.tenantId), eq(schedBookings.uid, uid)))
        .limit(1);
      return { row: existing, created: false };
    }
    await emitHubEvent(tx, { type: 'booking.created', orgId: ctx.tenantId, bookingId: row.id });
    return { row, created: true };
  });
```

…and rename the outer function body accordingly:

```ts
export async function createBooking(ctx: CoreCtx, input: CreateBookingInput): Promise<SchedBooking> {
  const { row, created } = await withOrgCore(ctx, async (tx) => {
    /* existing body, with the two return statements changed as above */
  });
  // Post-commit accrual: expected stock consumption for the booked service.
  // Deliberately OUTSIDE the booking tx (a failed statement would poison it)
  // and fail-soft — a booking must never fail because of accrual bookkeeping.
  // Idempotent uid retries have created=false and never re-accrue.
  if (created && row.productId) {
    try {
      if (await isModuleEnabled(ctx, 'stock')) {
        await accrueConsumption(ctx, {
          source: 'booking',
          sourceId: row.id,
          finProductId: row.productId,
          lines: input.consumption ?? null,
        });
      }
    } catch (e) {
      console.error('[scheduling] accrueConsumption failed (booking stands)', e);
    }
  }
  return row;
}
```

In `setBookingStatus`, after the `withOrgCore` update:

```ts
const RELEASING = new Set(['cancelled', 'rejected', 'no_show']);

export async function setBookingStatus(ctx: CoreCtx, id: string, status: string): Promise<void> {
  if (!SETTABLE.has(status)) throw new Error(`invalid status: ${status}`);
  await withOrgCore(ctx, (tx) =>
    tx
      .update(schedBookings)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId))),
  );
  if (RELEASING.has(status)) {
    // Post-commit + fail-soft; idempotent, so a lost release is re-triggerable.
    try {
      await releaseAccruals(ctx, 'booking', id);
    } catch (e) {
      console.error('[scheduling] releaseAccruals failed (status change stands)', e);
    }
  }
}
```

Also add a tiny getter (the `/complete` route needs the booking row):

```ts
export async function getBooking(ctx: CoreCtx, id: string): Promise<SchedBooking | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(schedBookings)
      .where(and(eq(schedBookings.id, id), eq(schedBookings.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}
```

- [ ] **Step 4: Run tests**

Run: `bun run vitest run src/server/services/scheduling-bookings-accrual.test.ts` → PASS.
Run: `bun run check` → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/scheduling-bookings.service.ts src/server/services/scheduling-bookings-accrual.test.ts
git -c commit.gpgsign=false commit -m "feat(scheduling): accrue stock consumption on booking create, release on cancel/no-show"
```

---

### Task 6: Stock API routes — accruals list + preview

**Files:**
- Create: `src/routes/api/stock/accruals/+server.ts`
- Create: `src/routes/api/stock/accruals/preview/+server.ts`

**Interfaces:**
- Consumes: `listAccruals`, `buildAccrualPreview` (Task 4); `handleStockError` from `src/routes/api/stock/_errors` (existing — import path from `accruals/` is `../_errors`, from `accruals/preview/` is `../../_errors`).
- Produces: `GET /api/stock/accruals?status=&itemId=&source=&sourceId=` → `{ accruals: AccrualListRow[] }`; `POST /api/stock/accruals/preview {finProductId, quantity?, warehouseId?, excludeSource?}` → `{ preview: AccrualPreview }`.
- RBAC: `/api/stock` writes are already centrally gated (`API_WRITE_PREFIXES` → `stock:edit`); both routes require auth + stock module, matching `entries/from-service/+server.ts`.

- [ ] **Step 1: `src/routes/api/stock/accruals/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listAccruals } from '$server/services/stock-accruals.service';

/** GET /api/stock/accruals?status=&itemId=&source=&sourceId= — commitments list. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const accruals = await listAccruals(ctx, {
    status: url.searchParams.get('status') ?? undefined,
    itemId: url.searchParams.get('itemId') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    sourceId: url.searchParams.get('sourceId') ?? undefined,
  });
  return json({ accruals });
};
```

- [ ] **Step 2: `src/routes/api/stock/accruals/preview/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { buildAccrualPreview } from '$server/services/stock-accruals.service';
import { handleStockError } from '../../_errors';

const postSchema = z.object({
  finProductId: z.string().min(1),
  quantity: z.number().positive().default(1),
  warehouseId: z.string().max(200).nullable().optional(),
  excludeSource: z.object({ source: z.string().min(1), sourceId: z.string().min(1) }).nullable().optional(),
});

/**
 * POST /api/stock/accruals/preview — gauge-ready expected-consumption lines for
 * a service, with per-line est cost + committed-elsewhere + ATP. Read-only
 * (POST for the body); used by the booking modal and the complete dialog.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404);
  const b = await parseBody(request, postSchema);
  try {
    const preview = await buildAccrualPreview(ctx, {
      finProductId: b.finProductId,
      quantity: b.quantity,
      warehouseId: b.warehouseId ?? null,
      excludeSource: b.excludeSource ?? null,
    });
    return json({ preview });
  } catch (e) {
    throw handleStockError(e);
  }
};
```

(Check `src/routes/api/stock/_errors.ts` for `handleStockError`'s actual signature — `entries/from-service/+server.ts` shows the call pattern; mirror it exactly.)

- [ ] **Step 3: Verify**

Run: `bun run check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/stock/accruals
git -c commit.gpgsign=false commit -m "feat(stock): accruals list + preview API routes"
```

---

### Task 7: Scheduling API — `/complete`, `/accrual`, auth fix

**Files:**
- Create: `src/routes/api/scheduling/bookings/[id]/complete/+server.ts`
- Create: `src/routes/api/scheduling/bookings/[id]/accrual/+server.ts`
- Modify: `src/routes/api/scheduling/bookings/+server.ts` (auth fix + `consumption` in POST schema)
- Modify: `src/routes/api/scheduling/bookings/[id]/+server.ts` (auth fix + realize on completed)

**Interfaces:**
- Consumes: `realizeAccruals`, `accrueConsumption` (Tasks 3-4); `getBooking`, `setBookingStatus`, `createBooking` (Task 5); `requireAuth` from `$server/auth/authorize`.
- Produces: `POST /api/scheduling/bookings/[id]/complete {lines?, warehouseId?}` → `{ ok: true, entryId: string|null, stockWarning: {...}|null }` (idempotent retry: re-POST realizes only). `POST /api/scheduling/bookings/[id]/accrual {lines}` → `{ accrued: number }`. `PATCH …/[id] {status}` now returns `{ ok: true, stockWarning }`.

- [ ] **Step 1: Auth fix + consumption on `bookings/+server.ts`**

Replace `requireAdmin` with `requireAuth` in the import and in POST (GET has no `requireAdmin` today — leave it). The central `apiWriteCapability` gate (`/api/scheduling` → `scheduling:edit`) is the real capability guard; `requireAdmin` was platform-admin-only and 403'd the staff persona this feature serves.

```ts
import { requireAuth } from '$server/auth/authorize';
```

In `postSchema` add:

```ts
  consumption: z
    .array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() }))
    .nullable()
    .optional(),
```

In POST: change `requireAdmin(locals);` → `requireAuth(locals);` and pass `consumption: b.consumption ?? null,` into the `createBooking` input object.

- [ ] **Step 2: Auth fix + realize-on-completed in `bookings/[id]/+server.ts`**

Full new file body:

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { setBookingStatus, getBooking } from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';

// Mirrors SETTABLE in scheduling-bookings.service.ts.
const patchSchema = z.object({
  status: z.enum(['accepted', 'pending', 'cancelled', 'rejected', 'completed', 'no_show']),
});

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  try {
    await setBookingStatus(ctx, params.id!, b.status);
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid');
  }
  // Plain one-click complete: best-effort realize from the open accruals.
  // Never blocks the status change — a short bin surfaces as stockWarning.
  let stockWarning: { code: string; message: string; draftEntryId?: string } | null = null;
  if (b.status === 'completed') {
    try {
      const booking = await getBooking(ctx, params.id!);
      const r = await realizeAccruals(ctx, {
        source: 'booking',
        sourceId: params.id!,
        finProductId: booking?.productId ?? null,
        partyId: booking?.partyId ?? null,
        note: booking ? `Booking: ${booking.title}` : null,
        actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
      });
      stockWarning = r.stockWarning;
    } catch (e) {
      stockWarning = { code: 'realize_failed', message: e instanceof Error ? e.message : 'stock realize failed' };
    }
  }
  return json({ ok: true, stockWarning });
};
```

- [ ] **Step 3: `bookings/[id]/complete/+server.ts`**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getBooking, setBookingStatus } from '$server/services/scheduling-bookings.service';
import { realizeAccruals } from '$server/services/stock-accruals.service';

const postSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().positive(),
        qtyConsumption: z.number().positive().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  warehouseId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/scheduling/bookings/[id]/complete { lines?, warehouseId? }
 * Two deliberate steps, not one tx (submitEntry owns its own tx): (1) status →
 * completed — the business fact commits first; (2) realize the accrued stock.
 * A short bin never blocks completion: the response carries stockWarning and a
 * re-POST retries the realize alone (idempotent — the draft entry is reused).
 */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals); // capability gate is central: /api/scheduling → scheduling:edit
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, postSchema);

  const booking = await getBooking(ctx, params.id!);
  if (!booking) throw error(404, 'booking not found');
  if (['cancelled', 'rejected'].includes(booking.status)) throw error(400, `booking is ${booking.status}`);

  if (booking.status !== 'completed') await setBookingStatus(ctx, params.id!, 'completed');

  try {
    const r = await realizeAccruals(ctx, {
      source: 'booking',
      sourceId: params.id!,
      lines: b.lines ?? null,
      warehouseId: b.warehouseId ?? null,
      finProductId: booking.productId ?? null,
      partyId: booking.partyId ?? null,
      note: `Booking: ${booking.title}`,
      actor: { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null },
    });
    return json({ ok: true, entryId: r.entry?.id ?? null, stockWarning: r.stockWarning });
  } catch (e) {
    return json({
      ok: true,
      entryId: null,
      stockWarning: { code: 'realize_failed', message: e instanceof Error ? e.message : 'stock realize failed' },
    });
  }
};
```

- [ ] **Step 4: `bookings/[id]/accrual/+server.ts`**

```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAuth } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { getBooking } from '$server/services/scheduling-bookings.service';
import { accrueConsumption } from '$server/services/stock-accruals.service';

const postSchema = z.object({
  lines: z.array(z.object({ itemId: z.string().min(1), qtyConsumption: z.number().positive() })).min(1),
});

/** POST /api/scheduling/bookings/[id]/accrual { lines } — replace the booking's
 *  open expected-consumption set before completion (settled sources no-op). */
export const POST: RequestHandler = async ({ locals, request, params }) => {
  requireAuth(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling')) || !(await isModuleEnabled(ctx, 'stock'))) throw error(403, 'module disabled');
  const b = await parseBody(request, postSchema);
  const booking = await getBooking(ctx, params.id!);
  if (!booking) throw error(404, 'booking not found');
  const accrued = await accrueConsumption(ctx, {
    source: 'booking',
    sourceId: params.id!,
    finProductId: booking.productId ?? null,
    lines: b.lines,
  });
  return json({ accrued });
};
```

- [ ] **Step 5: Verify + commit**

Run: `bun run check` → 0 errors. Run `bun run vitest run src/server/services` → green.

```bash
git add src/routes/api/scheduling/bookings
git -c commit.gpgsign=false commit -m "feat(scheduling): booking complete+accrual endpoints; relax requireAdmin to staff-capable auth"
```

---

### Task 8: Gateway surface — `query/stock?mode=accruals` + `booking-complete` action

**Files:**
- Modify: `src/routes/api/gateway/query/stock/+server.ts`
- Create: `src/routes/api/gateway/actions/booking-complete/+server.ts`

**Interfaces:**
- Consumes: `listAccruals`, `realizeAccruals` (Task 4); `getBooking`, `setBookingStatus` (Task 5); `requireAssistantCapability`, `agentActor` from `../../_shared/action-auth` (see `actions/stock-issue-from-service/+server.ts` for the exact call pattern).
- Produces: `GET …/query/stock?mode=accruals[&status=][&source=]` → `{ mode: 'accruals', accruals }`. `POST …/actions/booking-complete {confirm, bookingId, lines?, warehouseId?}` — confirm:false previews, confirm:true completes+realizes.

- [ ] **Step 1: Add the accruals mode to `query/stock/+server.ts`**

Follow the existing mode blocks (read the file first — modes `movements`/`consumption`/`valuation` show the shape). Add before the final `levels` return, and extend the doc-comment's mode list:

```ts
	if (mode === 'accruals') {
		const accruals = await listAccruals(ctx, {
			status: url.searchParams.get('status') ?? undefined,
			source: url.searchParams.get('source') ?? undefined,
			itemId: itemId ?? undefined,
		});
		return json({ mode, accruals });
	}
```

with `import { listAccruals } from '$server/services/stock-accruals.service';` added to the imports. (This file uses tabs — match it.)

- [ ] **Step 2: Create `actions/booking-complete/+server.ts`**

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseBody } from '$server/api/validate';
import { requireAssistantCapability, agentActor } from '../../_shared/action-auth';
import { getBooking, setBookingStatus } from '$server/services/scheduling-bookings.service';
import { listAccruals, realizeAccruals } from '$server/services/stock-accruals.service';

const bodySchema = z.object({
	confirm: z.boolean(),
	bookingId: z.string().min(1),
	lines: z
		.array(
			z.object({
				itemId: z.string().min(1),
				qty: z.number().positive(),
				qtyConsumption: z.number().positive().nullable().optional(),
			}),
		)
		.nullable()
		.optional(),
	warehouseId: z.string().max(200).nullable().optional(),
});

/**
 * POST /api/gateway/actions/booking-complete?agentId=personal-<uuid>[&orgId=]
 * body: { confirm, bookingId, lines?, warehouseId? }
 *
 * confirm:false — returns the booking's open accrued consumption for the agent
 * to relay (adjust via `lines` on confirm).
 * confirm:true — marks the booking completed and realizes the accrued stock
 * into a posted issue entry. A short bin never blocks completion — the
 * response carries stockWarning and the same call can be retried.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
	const { ctx, principalId } = await requireAssistantCapability(locals, url, 'scheduling', 'edit');
	const b = await parseBody(request, bodySchema);

	const booking = await getBooking(ctx, b.bookingId);
	if (!booking) throw error(404, 'booking not found');

	if (!b.confirm) {
		const accruals = await listAccruals(ctx, { source: 'booking', sourceId: b.bookingId, status: 'open' });
		return json({
			preview: {
				action: 'booking-complete',
				bookingId: b.bookingId,
				bookingTitle: booking.title,
				status: booking.status,
				accruals,
			},
		});
	}

	if (['cancelled', 'rejected'].includes(booking.status)) throw error(400, `booking is ${booking.status}`);
	if (booking.status !== 'completed') await setBookingStatus(ctx, b.bookingId, 'completed');
	const actor = await agentActor(principalId);
	const r = await realizeAccruals(ctx, {
		source: 'booking',
		sourceId: b.bookingId,
		lines: b.lines ?? null,
		warehouseId: b.warehouseId ?? null,
		finProductId: booking.productId ?? null,
		partyId: booking.partyId ?? null,
		note: `Booking: ${booking.title}`,
		actor,
	});
	return json({ ok: true, entryId: r.entry?.id ?? null, realized: r.realized, stockWarning: r.stockWarning });
};
```

- [ ] **Step 3: Verify + commit**

Run: `bun run check` → 0 errors. Run: `bun run vitest run src/routes/api/gateway/actions/actions.server.test.ts` — if it enumerates action dirs, it may need a fixture entry; follow whatever pattern the failing assertion points at.

```bash
git add src/routes/api/gateway/query/stock/+server.ts src/routes/api/gateway/actions/booking-complete
git -c commit.gpgsign=false commit -m "feat(gateway): booking-complete action + stock accruals query mode"
```

---

### Task 9: Booking modal — inline consumption gauges + ATP warning

**Files:**
- Modify: `src/routes/(app)/scheduling/bookings/+page.server.ts` (eventTypes `productId`, `stockEnabled`)
- Modify: `src/routes/(app)/scheduling/bookings/+page.svelte` (consumption block in the New-appointment modal)
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `POST /api/stock/accruals/preview` (Task 6); `AccrualPreviewLine` field names (`itemId, itemName, qty, qtyConsumption, consumptionUom, uom, unitsPerStockUom, subunitsPerStockUom, diagramEnabled, available, committedOther, atp, estValue`); `POST /api/scheduling/bookings` now accepts `consumption` (Task 7).
- Produces: booking POST body includes `consumption: [{itemId, qtyConsumption}]` whenever the block is shown.
- Reference implementation for the gauge block: `src/routes/(app)/stock/consume/+page.svelte` (lines ~180-230) — read it first and mirror its `PreviewLine` type, `setLineConsumption`, `gaugeMax` usage.

- [ ] **Step 1: Loader** — in `+page.server.ts`, change the eventTypes mapping and return:

```ts
    eventTypes: eventTypes.map((e) => ({ id: e.id, title: e.title, productId: e.productId ?? null })),
    stockEnabled: await isModuleEnabled(ctx, 'stock'),
```

(`isModuleEnabled` is already imported in this file.)

- [ ] **Step 2: Modal block** — in `+page.svelte`:

Script additions (after the existing `nb*` state):

```ts
	import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
	import { gaugeMax } from '$lib/components/stock/stock-ui';

	type ConsumptionLine = {
		itemId: string;
		itemName: string;
		uom: string;
		qty: number;
		qtyConsumption: number;
		consumptionUom: string | null;
		unitsPerStockUom: number | null;
		subunitsPerStockUom: number | null;
		diagramEnabled: boolean;
		available: number;
		committedOther: number;
		atp: number;
	};
	let nbLines = $state<ConsumptionLine[]>([]);
	let nbHasMapping = $state(false);

	function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
		l.qtyConsumption = qtyConsumption;
		l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
	}

	async function loadConsumption() {
		nbLines = [];
		nbHasMapping = false;
		const et = data.eventTypes.find((e) => e.id === nbEventType);
		if (!et?.productId || !data.stockEnabled || !canAct('stock', 'view')) return;
		try {
			const res = await fetch('/api/stock/accruals/preview', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ finProductId: et.productId, quantity: 1 }),
			});
			if (!res.ok) return; // no warehouse / stock off — block simply stays hidden
			const j = await res.json();
			nbHasMapping = j.preview.hasMapping;
			nbLines = j.preview.lines;
		} catch {
			/* preview is best-effort */
		}
	}
```

Change the service `<select>`'s handler to load both: `onchange={() => { loadSlots(); loadConsumption(); }}`.

In `book()`, extend the POST body with:

```ts
					consumption: nbHasMapping && nbLines.length ? nbLines.map((l) => ({ itemId: l.itemId, qtyConsumption: l.qtyConsumption })) : null,
```

and reset `nbLines = []; nbHasMapping = false;` alongside the other post-success resets.

Markup — insert after the slot grid, before the client-search field:

```svelte
			{#if nbHasMapping && nbLines.length}
				<div class="field">
					<span class="t-caption">{m.sched_stock_consumption()}</span>
					<div class="flex flex-col gap-2">
						{#each nbLines as l (l.itemId)}
							{@const gMax = l.diagramEnabled ? gaugeMax({ uom: l.uom, unitsPerStockUom: l.unitsPerStockUom, subunitsPerStockUom: l.subunitsPerStockUom }) : 0}
							<div class="flex items-center gap-3 flex-wrap">
								<span class="text-sm min-w-[120px]">{l.itemName}</span>
								{#if gMax > 0}
									<ConsumptionGauge
										max={gMax}
										unit={l.consumptionUom ?? l.uom}
										bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
									/>
								{:else}
									<input
										class="txt"
										style="max-width: 90px"
										type="number"
										min="0"
										step="any"
										value={l.qtyConsumption}
										oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
									/>
									<span class="t-caption">{l.consumptionUom ?? l.uom}</span>
								{/if}
								{#if l.qty > l.atp}
									<span class="t-caption" style="color:var(--color-destructive)">{m.sched_stock_atp_warn({ atp: String(l.atp), uom: l.uom })}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
```

(`gaugeMax(item: UomConvertible)` takes ONE object — `{ uom, unitsPerStockUom, subunitsPerStockUom }` — exactly as used in `src/routes/(app)/stock/consume/+page.svelte:48`.)

- [ ] **Step 3: i18n** — add to `messages/en.json`:

```json
	"sched_stock_consumption": "Stock consumption",
	"sched_stock_atp_warn": "exceeds available ({atp} {uom} after commitments)",
```

and to `messages/es.json`:

```json
	"sched_stock_consumption": "Consumo de stock",
	"sched_stock_atp_warn": "supera lo disponible ({atp} {uom} tras compromisos)",
```

Then run: `bun run i18n:compile`.

- [ ] **Step 4: Verify + commit**

Run: `bun run check` → 0 errors, 0 warnings.

```bash
git add "src/routes/(app)/scheduling/bookings" messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(scheduling): inline stock-consumption gauges + ATP warning in the new-appointment modal"
```

---

### Task 10: Complete dialog + per-row accrual chip

**Files:**
- Modify: `src/routes/(app)/scheduling/bookings/+page.server.ts` (batch accrual summaries)
- Modify: `src/routes/(app)/scheduling/bookings/+page.svelte` (chip + complete dialog + stockWarning banner)
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `accrualSummaryForSources` (Task 4) — `{ sourceId, open, realized, released, estValue, realizedValue, realizedEntryId }`; `GET /api/stock/accruals?source=booking&sourceId=` (Task 6) returning `AccrualListRow[]` (string numerics — `Number()` them); `POST /api/scheduling/bookings/[id]/complete` (Task 7) returning `{ ok, entryId, stockWarning }`.
- Produces: page-level UX only.

- [ ] **Step 1: Loader** — add to `+page.server.ts`:

```ts
import { accrualSummaryForSources } from '$server/services/stock-accruals.service';
```

In the load function, after `bookings` resolves:

```ts
  let accrualSummaries: Awaited<ReturnType<typeof accrualSummaryForSources>> = [];
  try {
    accrualSummaries = await accrualSummaryForSources(ctx, 'booking', bookings.map((b) => b.id));
  } catch {
    // stock module absent/off — bookings render without chips
  }
```

and return `accrualSummaries`.

- [ ] **Step 2: Page** — in `+page.svelte`:

```ts
	const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

	// ── Complete dialog ──
	let completeFor = $state<string | null>(null); // booking id
	let cdLines = $state<ConsumptionLine[]>([]);
	let cdBusy = $state(false);
	let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

	async function openComplete(id: string) {
		const summary = accrualBySource.get(id);
		if (!summary || summary.open === 0) {
			await completeBooking(id, null); // no accruals → one-click complete
			return;
		}
		const res = await fetch(`/api/stock/accruals?source=booking&sourceId=${id}&status=open`);
		const j = res.ok ? await res.json() : { accruals: [] };
		cdLines = (j.accruals ?? []).map((a: Record<string, unknown>) => ({
			itemId: a.itemId as string,
			itemName: a.itemName as string,
			uom: a.itemUom as string,
			qty: Number(a.qty),
			qtyConsumption: Number(a.qtyConsumption),
			consumptionUom: (a.consumptionUom as string | null) ?? null,
			unitsPerStockUom: a.unitsPerStockUom == null ? null : Number(a.unitsPerStockUom),
			subunitsPerStockUom: a.subunitsPerStockUom == null ? null : Number(a.subunitsPerStockUom),
			diagramEnabled: Boolean(a.diagramEnabled),
			available: 0,
			committedOther: 0,
			atp: 0,
		}));
		completeFor = id;
	}

	async function completeBooking(id: string, lines: ConsumptionLine[] | null) {
		cdBusy = true;
		try {
			const res = await fetch(`/api/scheduling/bookings/${id}/complete`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					lines: lines?.length ? lines.map((l) => ({ itemId: l.itemId, qty: l.qty, qtyConsumption: l.qtyConsumption })) : null,
				}),
			});
			const j = res.ok ? await res.json() : null;
			if (j?.stockWarning) stockWarnings = { ...stockWarnings, [id]: j.stockWarning.message as string };
			else delete stockWarnings[id];
			completeFor = null;
			await invalidate('scheduling:data');
		} finally {
			cdBusy = false;
		}
	}
```

Wire the existing ✓ button: `onclick={() => openComplete(b.id)}` (replacing `setStatus(b.id, 'completed')`).

Add per-row chip next to the status `<Badge>`:

```svelte
								{#if accrualBySource.get(b.id)}
									{@const acc = accrualBySource.get(b.id)!}
									{#if acc.open > 0}
										<Badge variant="outline">{m.sched_stock_committed({ value: acc.estValue.toFixed(2) })}</Badge>
									{:else if acc.realized > 0}
										<a href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'} class="no-underline">
											<Badge variant="outline">{m.sched_stock_realized({ value: acc.realizedValue.toFixed(2) })}</Badge>
										</a>
									{:else}
										<Badge variant="outline">{m.sched_stock_released()}</Badge>
									{/if}
								{/if}
								{#if stockWarnings[b.id]}
									<span class="t-caption" style="color:var(--color-destructive)">
										{stockWarnings[b.id]}
										<button class="underline" onclick={() => completeBooking(b.id, null)}>{m.sched_stock_retry_post()}</button>
									</span>
								{/if}
```

(Check the `Badge` component's actual prop set — if `variant="outline"` doesn't exist, use the closest existing style. Check whether `/stock/entries/[id]` is a real route — `ls src/routes/\(app\)/stock/entries` — and link to `/stock` if not.)

Complete dialog after the existing New modal:

```svelte
<Modal open={completeFor !== null} title={m.sched_complete_title()} onclose={() => (completeFor = null)}>
	<div class="flex flex-col gap-3">
		<p class="t-caption">{m.sched_complete_hint()}</p>
		{#each cdLines as l (l.itemId)}
			{@const gMax = l.diagramEnabled ? gaugeMax({ uom: l.uom, unitsPerStockUom: l.unitsPerStockUom, subunitsPerStockUom: l.subunitsPerStockUom }) : 0}
			<div class="flex items-center gap-3 flex-wrap">
				<span class="text-sm min-w-[120px]">{l.itemName}</span>
				{#if gMax > 0}
					<ConsumptionGauge
						max={gMax}
						unit={l.consumptionUom ?? l.uom}
						bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
					/>
				{:else}
					<input class="txt" style="max-width: 90px" type="number" min="0" step="any" value={l.qtyConsumption}
						oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)} />
					<span class="t-caption">{l.consumptionUom ?? l.uom}</span>
				{/if}
			</div>
		{/each}
		<div class="flex gap-2">
			<Button disabled={cdBusy} onclick={() => completeFor && completeBooking(completeFor, cdLines)}>{m.sched_complete_confirm()}</Button>
			<Button variant="ghost" onclick={() => (completeFor = null)}>{m.sched_cancel()}</Button>
		</div>
	</div>
</Modal>
```

(`gaugeMax` call shape identical to Task 9.)

- [ ] **Step 3: i18n** — en:

```json
	"sched_stock_committed": "committed S/ {value}",
	"sched_stock_realized": "stock posted S/ {value}",
	"sched_stock_released": "stock released",
	"sched_stock_retry_post": "post stock now",
	"sched_complete_title": "Complete appointment",
	"sched_complete_hint": "Confirm the actual material used — adjust before posting to stock.",
	"sched_complete_confirm": "Complete & post stock"
```

es:

```json
	"sched_stock_committed": "comprometido S/ {value}",
	"sched_stock_realized": "stock registrado S/ {value}",
	"sched_stock_released": "stock liberado",
	"sched_stock_retry_post": "registrar stock ahora",
	"sched_complete_title": "Completar cita",
	"sched_complete_hint": "Confirma el material realmente usado — ajusta antes de registrar en stock.",
	"sched_complete_confirm": "Completar y registrar stock"
```

Run: `bun run i18n:compile`.

- [ ] **Step 4: Verify + commit**

Run: `bun run check` → 0 errors, 0 warnings.

```bash
git add "src/routes/(app)/scheduling/bookings" messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(scheduling): complete dialog with actual-consumption gauges + per-row accrual chip"
```

---

### Task 11 (P2): Stock → Commitments view

**Files:**
- Create: `src/routes/(app)/stock/commitments/+page.server.ts`
- Create: `src/routes/(app)/stock/commitments/+page.svelte`
- Modify: `src/lib/components/stock/StockNav.svelte` (new tab AFTER `consume` — same `startsWith` ordering rule as the consume/consumption comment there)
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `listAccruals`, `committedSpend` (Task 4).
- Produces: page only. Route-view RBAC: `/stock/*` is already covered by the central guard — no new registration needed.

- [ ] **Step 1: Loader**

```ts
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listAccruals, committedSpend } from '$server/services/stock-accruals.service';

export const load: PageServerLoad = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'stock'))) throw error(404, 'Stock module disabled');
  const [open, realized, committed] = await Promise.all([
    listAccruals(ctx, { status: 'open' }),
    listAccruals(ctx, { status: 'realized' }),
    committedSpend(ctx),
  ]);
  return { open, realized, committed };
};
```

- [ ] **Step 2: Page** — headline cards (committed spend = `data.committed`; realized spend = Σ `Number(realizedValue)`; variance = Σ (`realizedValue − estValue`) over realized rows), an open-commitments table (item, source, qtyConsumption + consumptionUom, est value, created), and a realized expected-vs-actual table (item, est qty/value, realized qty/value, per-row variance). Follow the structure of `src/routes/(app)/stock/consume/+page.svelte` for `PageHeader`/`Card`/table markup and i18n usage — plain `<table>` markup consistent with sibling stock pages, `Number()` every numeric. No new component files.

- [ ] **Step 3: Nav** — in `StockNav.svelte` add after the `consume` item:

```ts
	{ id: 'commitments', label: m.stock_nav_commitments(), icon: CalendarClock, href: '/stock/commitments' },
```

with `CalendarClock` added to the lucide import.

- [ ] **Step 4: i18n** — en: `"stock_nav_commitments": "Commitments"`, `"stock_commitments_title": "Commitments"`, `"stock_commitments_hint": "Potential spend committed by bookings vs what actually posted."`, `"stock_commitments_committed": "Committed (potential)"`, `"stock_commitments_realized": "Realized (actual)"`, `"stock_commitments_variance": "Variance"`, `"stock_commitments_empty": "No open commitments."` — es: `"Compromisos"`, `"Compromisos"`, `"Gasto potencial comprometido por citas vs lo realmente registrado."`, `"Comprometido (potencial)"`, `"Realizado (real)"`, `"Variación"`, `"Sin compromisos abiertos."`. Run `bun run i18n:compile`.

- [ ] **Step 5: Verify + commit**

Run: `bun run check` → 0 errors.

```bash
git add "src/routes/(app)/stock/commitments" src/lib/components/stock/StockNav.svelte messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(stock): commitments view — potential vs real spend, variance"
```

---

### Task 12 (P2): Default-warehouse toggle

**Files:**
- Modify: `src/server/services/stock.service.ts` (`NewWarehouseInput` + `updateWarehouse`)
- Modify: `src/routes/(app)/stock/warehouses/+page.svelte` + its API route (read them first: `src/routes/api/stock/warehouses/**`)
- Test: `src/server/services/stock.service.test.ts` (append)
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `stkWarehouses.isDefault` (Task 1).
- Produces: `updateWarehouse(ctx, id, { isDefault: true })` clears any other default in the same tx (partial unique index would otherwise reject the second default).

- [ ] **Step 1: Failing test**

```ts
describe('updateWarehouse — default flag', () => {
  it('setting a default clears the previous one first (partial uniq would reject otherwise)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // clear-others update
      [{ id: 'w2', orgId: 'org-1', name: 'B', isDefault: true }], // update(...).returning()
    ]);
    const w = await updateWarehouse(ctx(db), 'w2', { isDefault: true });
    expect(w?.isDefault).toBe(true);
    expect(db.update).toHaveBeenCalledTimes(2);
  });
});
```

(add `updateWarehouse` to the test file's imports).

- [ ] **Step 2: Implement** — read `updateWarehouse` (stock.service.ts ≈ line 160) and `NewWarehouseInput` first. Add `isDefault?: boolean` to `NewWarehouseInput`. In `updateWarehouse`, when `patch.isDefault === true`, run inside the same `withOrgCore` tx BEFORE the main update:

```ts
      await tx
        .update(stkWarehouses)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(and(eq(stkWarehouses.orgId, ctx.tenantId), eq(stkWarehouses.isDefault, true)));
```

and include `isDefault` in the update's `set`.

- [ ] **Step 3: UI** — on the warehouses page, add a "default" star/toggle per row that PATCHes the existing warehouse API with `{ isDefault: true }` and shows which one is default. Extend the warehouse PATCH route's zod schema with `isDefault: z.boolean().optional()`. i18n keys en `"stock_wh_default": "Default"`, `"stock_wh_set_default": "Set as default"`; es `"Predeterminado"`, `"Definir como predeterminado"`. Run `bun run i18n:compile`.

- [ ] **Step 4: Verify + commit**

Run: `bun run vitest run src/server/services/stock.service.test.ts` → PASS; `bun run check` → 0 errors.

```bash
git add src/server/services/stock.service.ts src/server/services/stock.service.test.ts "src/routes/(app)/stock/warehouses" src/routes/api/stock/warehouses messages/en.json messages/es.json
git -c commit.gpgsign=false commit -m "feat(stock): default-warehouse flag + toggle UI"
```

---

### Task 13: Green sweep

**Files:** none new.

- [ ] **Step 1:** `bun run i18n:compile` (idempotent — catches any missed key).
- [ ] **Step 2:** `bun run check` → MUST be 0 errors, 0 warnings.
- [ ] **Step 3:** `bun run test` → ALL pass (note: `aci-backend` has a known full-suite timeout flake — re-run that file in isolation before treating it as a failure).
- [ ] **Step 4:** `bun run build` → succeeds (this is the ONLY local gate that catches invalid `+server.ts` exports; the known "optional native peers" notices are fine).
- [ ] **Step 5:** Fix anything found, amend or commit fixes scoped to this feature's files only.

---

## Post-plan (orchestrator, NOT subagents)

1. Apply `supabase/migrations/20260705230000_stock_accruals.sql` to prod Supabase (surgical SQL, per hub-db-schema-management memory).
2. Browser QA of the three flows (book with gauges / complete with adjustment / cancel releases) on dev.
3. Push `dev`, then FF `dev:master` to deploy — pre-push scans the WORKING TREE, so deploy from a clean detached worktree if other sessions' WIP is present.
