# Finances — Analytics + Catalog + Sync Perf + List Perf + Caching + CRM Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Finances module fast and analytical — a batched idempotent sync, a product catalog, a period-filtered ECharts dashboard with industry-standard KPIs, windowed lists, Valkey caching, and an additive CRM↔Finance bridge.

**Architecture:** Hub-native Finances (Postgres core DB, org-GUC RLS via `withOrgCore`). New `fin_products` catalog + relational FKs (`fin_invoice_items.product_id`, `fin_invoices.client_id`) keep data DRY while retaining as-billed snapshots. The sync switches from per-invoice transactions to one set-based transaction per page. The dashboard reads URL-driven period params, aggregates are Valkey-cached and busted on sync. The CRM bridge is a read-only phone-match join, `bothEnabled`-guarded, with neither module importing the other.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Bun, Drizzle ORM over Supabase Postgres, ECharts 6 (`Chart.svelte`), `@minion-stack/cache` (Valkey), Vitest, Paraglide i18n.

## Global Constraints

- Branch `dev`. Keep green baseline: `bun run check` 0 errors/0 warnings; `bun run test` all pass.
- Core-DB schema = hand-written idempotent SQL at meta-repo root `supabase/migrations/<stamp>_*.sql`, applied to gxv via Supabase MCP (**orchestrator-only** — implementers do NOT write/commit `.sql` or touch `../supabase/`; they do the Drizzle schema + leave a `MIGRATION PENDING` note). Never `drizzle-kit push`. Drizzle schema mirrors the SQL in `src/server/db/pg-finance-schema.ts`.
- Every org-scoped query goes through `withOrgCore(ctx, (tx)=>…)` — never bare `getCoreDb()` — EXCEPT deliberate cross-org reads (none in this plan; the bridge is org-scoped).
- Money columns are `numeric` (string in JS) — coerce aggregates with `Number(...)`.
- Admin-gate writes with `requireAdmin(locals)` (`$server/auth/authorize`); reads are member-level. Finance routes gate on `isModuleEnabled(ctx,'finances')`.
- DRY: canonical product attrs live ONLY in `fin_products`; client identity ONLY in `fin_clients`. As-billed snapshot columns (`fin_invoice_items.code/description`, `fin_invoices.client_name/client_doc_number/client_email`) are kept. The CRM bridge copies NO finance data into CRM tables. Reuse the existing `normPhone` from `crm-contacts.service.ts` (export it) — no second phone-normalizer.
- Cache: `import { cached, invalidateTags, keys, tags } from '@minion-stack/cache'`. Finance tag = `tags.tenantDomain(orgId, 'finances')`. Bust on sync finish + catalog/source writes.
- Svelte 5 runes only; validate `.svelte` edits with the Svelte autofixer. Never stage `package-lock.json` (stale npm churn).
- ECharts via `src/lib/components/charts/Chart.svelte` (`<Chart options={…} height="…" />`, `options: EChartsOption`).
- i18n keys added to BOTH `messages/en.json` and `messages/es.json`.

---

### Task 1: Schema — `fin_products` + relational FKs

**Files:**
- Modify: `src/server/db/pg-finance-schema.ts` (add `finProducts` table + `FinProduct` type; add `productId` to `finInvoiceItems`; add `clientId` to `finInvoices`)
- Test: `src/server/db/pg-finance-schema.test.ts` (extend)

**Interfaces:**
- Produces: `finProducts` table (`id, orgId, code, name, category, unitPrice, active, metadata, createdAt, updatedAt`), `FinProduct` type; `finInvoiceItems.productId` (uuid null); `finInvoices.clientId` (uuid null).

- [ ] **Step 1: Write the failing test** — extend `pg-finance-schema.test.ts`:

```ts
import { finProducts, finInvoiceItems, finInvoices } from './pg-finance-schema';
// ...existing imports/tests stay...
describe('catalog + relational FKs', () => {
  it('finProducts has canonical columns', () => {
    const cols = Object.keys(getTableColumns(finProducts));
    for (const c of ['id','orgId','code','name','category','unitPrice','active','metadata','createdAt','updatedAt']) expect(cols).toContain(c);
  });
  it('invoice items carry a product_id FK column', () => {
    expect(Object.keys(getTableColumns(finInvoiceItems))).toContain('productId');
  });
  it('invoices carry a client_id FK column', () => {
    expect(Object.keys(getTableColumns(finInvoices))).toContain('clientId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts`
Expected: FAIL (`finProducts` undefined; `productId`/`clientId` missing).

- [ ] **Step 3: Add the table + columns**

In `pg-finance-schema.ts`, add `integer` is already imported (from Task in bg-sync); ensure `boolean` imported. Add the table:

```ts
export const finProducts = pgTable(
  'fin_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    unitPrice: numeric('unit_price'),
    active: boolean('active').notNull().default(true),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('fin_products_org_code_uniq').on(t.orgId, t.code) }),
);
```

Add `productId` to `finInvoiceItems` columns: `productId: uuid('product_id').references(() => finProducts.id, { onDelete: 'set null' }),` and an index `productIdx: index('fin_invoice_items_product_idx').on(t.productId)`.

Add `clientId` to `finInvoices` columns: `clientId: uuid('client_id').references(() => finClients.id, { onDelete: 'set null' }),` and index `clientIdx: index('fin_invoices_client_idx').on(t.clientId)`.

Add `export type FinProduct = typeof finProducts.$inferSelect;`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts` → PASS. Then `bun run check` → 0/0.

- [ ] **Step 5: Commit** (hub files only — NO `.sql`)

```bash
git add src/server/db/pg-finance-schema.ts src/server/db/pg-finance-schema.test.ts
git commit -m "feat(finance): fin_products catalog + product_id/client_id relational FKs (Drizzle)

MIGRATION PENDING (orchestrator): create fin_products + add product_id/client_id FKs on gxv + backfill."
```

> **Orchestrator (after Task 1):** write & apply three idempotent migrations to gxv via Supabase MCP and commit them in the meta-repo:
> - `fin_products` (table + `unique(org_id,code)` + RLS enable/force + `fin_products_org_guc` policy + grant to `app_ledger`).
> - `alter table fin_invoice_items add column if not exists product_id uuid references fin_products(id) on delete set null` + index.
> - `alter table fin_invoices add column if not exists client_id uuid references fin_clients(id) on delete set null` + index, then backfill: `update fin_invoices i set client_id=c.id from fin_clients c where i.client_id is null and c.org_id=i.org_id and c.provider=i.provider and c.doc_number=i.client_doc_number and c.doc_number is not null`.

---

### Task 2: Batched idempotent upsert (`upsertInvoicesBatch`)

**Files:**
- Modify: `src/server/services/finance.service.ts` (add `upsertInvoicesBatch`; make `upsertInvoice` a thin wrapper)
- Test: `src/server/services/finance.service.test.ts` (new)

**Interfaces:**
- Consumes: `finClients/finInvoices/finInvoiceItems/finPayments` (+ new `clientId`/`productId`), `CanonicalInvoice`, `withOrgCore`.
- Produces:
  - `upsertInvoicesBatch(ctx: CoreCtx, invoices: CanonicalInvoice[], productMap?: Map<string,string>): Promise<void>` — one tx for the whole array; set-based multi-row upserts; resolves `client_id` from the client upsert and `product_id` from `productMap` (code→id).
  - `upsertInvoice(ctx: CoreCtx, inv: CanonicalInvoice): Promise<void>` — `= upsertInvoicesBatch(ctx, [inv])`.

- [ ] **Step 1: Write the failing test** — `finance.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { upsertInvoicesBatch, upsertInvoice } from './finance.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const inv = (over = {}) => ({
  provider: 'susii', providerRef: 'r1', number: 'N1', documentId: 'D1', issuedAt: '2026-01-01T00:00:00Z',
  clientName: 'A', clientDocType: 'DNI', clientDocNumber: '111', clientEmail: null, currency: 'PEN',
  subtotal: 100, tax: 18, discount: 0, total: 118, status: 'paid', seller: 's', note: null, metadata: {},
  items: [{ code: 'AF1', description: 'x', category: null, quantity: 1, unitPrice: 100, discount: 0, tax: 18, total: 118, metadata: {} }],
  payments: [{ providerRef: 'p1', method: null, paidAt: '2026-01-01T00:00:00Z', amount: 118, status: 'paid', metadata: {} }],
  client: { provider: 'susii', providerRef: 'c1', name: 'A', docType: 'DNI', docNumber: '111', email: null, phone: '999', metadata: {} },
  ...over,
});

describe('upsertInvoicesBatch', () => {
  it('runs one transaction and issues set-based writes for a multi-invoice page', async () => {
    const { db, resolveSequence } = createMockDb();
    // client upsert returning, invoice upsert returning, then deletes/inserts resolve to []
    resolveSequence([
      [{ providerRef: 'c1', id: 'cid1' }],            // clients upsert returning
      [{ providerRef: 'r1', id: 'iid1' }, { providerRef: 'r2', id: 'iid2' }], // invoices upsert returning
      [], [], [], [],                                  // delete items, insert items, delete payments, insert payments
    ]);
    await upsertInvoicesBatch(ctx(db), [inv(), inv({ providerRef: 'r2', client: { ...inv().client, providerRef: 'c2', docNumber: '222' } })]);
    expect(db.transaction).toHaveBeenCalledTimes(1); // ONE tx for the whole page
  });

  it('upsertInvoice delegates to the batch path', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ providerRef: 'c1', id: 'cid1' }], [{ providerRef: 'r1', id: 'iid1' }], [], [], [], []]);
    await upsertInvoice(ctx(db), inv());
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it('no-ops cleanly on an empty page', async () => {
    const { db } = createMockDb();
    await upsertInvoicesBatch(ctx(db), []);
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/services/finance.service.test.ts` → FAIL (`upsertInvoicesBatch` not exported).

- [ ] **Step 3: Implement the batch upsert**

Replace the current `upsertInvoice` in `finance.service.ts` with:

```ts
const numStr = (n: number | null) => (n == null ? null : String(n));

/** Upsert a whole page of canonical invoices in ONE org-scoped transaction using
 *  set-based multi-row statements. ~100× fewer round-trips than per-invoice. */
export async function upsertInvoicesBatch(
  ctx: CoreCtx, invoices: CanonicalInvoice[], productMap: Map<string, string> = new Map(),
): Promise<void> {
  if (invoices.length === 0) return;
  await withOrgCore(ctx, async (tx) => {
    // 1. Clients (dedupe by providerRef within the page).
    const clients = new Map<string, CanonicalInvoice['client']>();
    for (const inv of invoices) if (inv.client) clients.set(inv.client.providerRef, inv.client);
    const clientIdByRef = new Map<string, string>();
    if (clients.size) {
      const rows = await tx.insert(finClients).values([...clients.values()].map((c) => ({
        orgId: ctx.tenantId, provider: c!.provider, providerRef: c!.providerRef, name: c!.name,
        docType: c!.docType, docNumber: c!.docNumber, email: c!.email, phone: c!.phone, metadata: c!.metadata,
      }))).onConflictDoUpdate({
        target: [finClients.orgId, finClients.provider, finClients.providerRef],
        set: { name: sql`excluded.name`, docType: sql`excluded.doc_type`, docNumber: sql`excluded.doc_number`,
               email: sql`excluded.email`, phone: sql`excluded.phone`, metadata: sql`excluded.metadata` },
      }).returning({ providerRef: finClients.providerRef, id: finClients.id });
      for (const r of rows) clientIdByRef.set(r.providerRef, r.id);
    }

    // 2. Invoices (resolve client_id from step 1).
    const invRows = await tx.insert(finInvoices).values(invoices.map((inv) => ({
      orgId: ctx.tenantId, provider: inv.provider, providerRef: inv.providerRef, number: inv.number,
      documentId: inv.documentId, issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
      clientId: inv.client ? clientIdByRef.get(inv.client.providerRef) ?? null : null,
      clientName: inv.clientName, clientDocType: inv.clientDocType, clientDocNumber: inv.clientDocNumber,
      clientEmail: inv.clientEmail, currency: inv.currency, subtotal: numStr(inv.subtotal), tax: numStr(inv.tax),
      discount: numStr(inv.discount), total: numStr(inv.total), status: inv.status, seller: inv.seller,
      note: inv.note, metadata: inv.metadata, syncedAt: new Date(),
    }))).onConflictDoUpdate({
      target: [finInvoices.orgId, finInvoices.provider, finInvoices.providerRef],
      set: { number: sql`excluded.number`, documentId: sql`excluded.document_id`, issuedAt: sql`excluded.issued_at`,
             clientId: sql`excluded.client_id`, clientName: sql`excluded.client_name`,
             clientDocType: sql`excluded.client_doc_type`, clientDocNumber: sql`excluded.client_doc_number`,
             clientEmail: sql`excluded.client_email`, currency: sql`excluded.currency`, subtotal: sql`excluded.subtotal`,
             tax: sql`excluded.tax`, discount: sql`excluded.discount`, total: sql`excluded.total`,
             status: sql`excluded.status`, seller: sql`excluded.seller`, note: sql`excluded.note`,
             metadata: sql`excluded.metadata`, syncedAt: sql`excluded.synced_at` },
    }).returning({ providerRef: finInvoices.providerRef, id: finInvoices.id });
    const invIdByRef = new Map(invRows.map((r) => [r.providerRef, r.id]));
    const invoiceIds = [...invIdByRef.values()];

    // 3. Replace children for these invoices (set-based delete + multi-row insert).
    await tx.delete(finInvoiceItems).where(inArray(finInvoiceItems.invoiceId, invoiceIds));
    const itemRows = invoices.flatMap((inv) => {
      const invoiceId = invIdByRef.get(inv.providerRef); if (!invoiceId) return [];
      return inv.items.map((it) => ({
        orgId: ctx.tenantId, invoiceId, productId: it.code ? productMap.get(it.code) ?? null : null,
        code: it.code, description: it.description, category: it.category, quantity: numStr(it.quantity),
        unitPrice: numStr(it.unitPrice), discount: numStr(it.discount), tax: numStr(it.tax), total: numStr(it.total), metadata: it.metadata,
      }));
    });
    if (itemRows.length) await tx.insert(finInvoiceItems).values(itemRows);

    await tx.delete(finPayments).where(inArray(finPayments.invoiceId, invoiceIds));
    const payRows = invoices.flatMap((inv) => {
      const invoiceId = invIdByRef.get(inv.providerRef); if (!invoiceId) return [];
      return inv.payments.map((p) => ({
        orgId: ctx.tenantId, invoiceId, providerRef: p.providerRef, method: p.method,
        paidAt: p.paidAt ? new Date(p.paidAt) : null, amount: numStr(p.amount), status: p.status, metadata: p.metadata,
      }));
    });
    if (payRows.length) await tx.insert(finPayments).values(payRows);
  });
}

/** Single-invoice convenience (tests / any non-batch caller). */
export async function upsertInvoice(ctx: CoreCtx, inv: CanonicalInvoice): Promise<void> {
  await upsertInvoicesBatch(ctx, [inv]);
}
```

Add `inArray` to the `drizzle-orm` import. Keep all other functions in the file.

- [ ] **Step 4: Run tests + check**

Run: `bun run vitest run src/server/services/finance.service.test.ts && bun run check` → PASS, 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/finance.service.ts src/server/services/finance.service.test.ts
git commit -m "perf(finance): set-based upsertInvoicesBatch (one tx per page) + upsertInvoice wrapper"
```

---

### Task 3: Wire batch into `advanceJob` + cache-bust on finish

**Files:**
- Modify: `src/server/services/finance-sync.service.ts` (use `upsertInvoicesBatch` per page; build `productMap`; bust finance cache on success)
- Modify: `src/server/services/finance.service.ts` (add `loadProductMap` + `financeCacheTags`/`bustFinanceCache`)
- Test: `src/server/services/finance-sync.service.test.ts` (update existing)

**Interfaces:**
- Consumes: `upsertInvoicesBatch` (Task 2).
- Produces: `loadProductMap(ctx): Promise<Map<string,string>>` (code→productId); `financeCacheTags(orgId): readonly string[]`; `bustFinanceCache(ctx): Promise<void>`.

- [ ] **Step 1: Add cache + product-map helpers to `finance.service.ts`**

```ts
import { invalidateTags, tags } from '@minion-stack/cache';
import { finProducts } from '$server/db/pg-finance-schema';

export function financeCacheTags(orgId: string) { return tags.tenantDomain(orgId, 'finances'); }
export function bustFinanceCache(ctx: CoreCtx) { return invalidateTags([...financeCacheTags(ctx.tenantId)]); }

export function loadProductMap(ctx: CoreCtx): Promise<Map<string, string>> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.select({ code: finProducts.code, id: finProducts.id })
      .from(finProducts).where(eq(finProducts.orgId, ctx.tenantId));
    return new Map(rows.map((r) => [r.code, r.id]));
  });
}
```

- [ ] **Step 2: Update `advanceJob` to batch per page + bust cache** in `finance-sync.service.ts`

Replace the per-invoice loop. After resolving creds, before the pull loop:

```ts
  const productMap = await loadProductMap(ctx);
```

Replace the inner page loop body (the `for (const inv of page.invoices)` upsert loop) with a batch call:

```ts
    for await (const page of connector.pullPages({ config, secrets, since, cursor })) {
      if (await isCancelRequested(ctx, jobId)) { await finishJob(ctx, jobId, 'cancelled'); return; }
      try {
        await upsertInvoicesBatch(ctx, page.invoices, productMap); // one tx for the whole page (atomic)
        processed += page.invoices.length;
      } catch (e) {
        throw e instanceof Error ? e : new Error('batch upsert failed'); // page tx rolled back; cursor preserved
      }
      cursor = page.cursor;
      await heartbeat(ctx, jobId, { processed, total, pageCursor: cursor });
      if (cursor == null) {
        await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
        await finishJob(ctx, jobId, 'succeeded');
        await bustFinanceCache(ctx);
        return;
      }
      if (Date.now() > deadline) return;
    }
    await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
    await finishJob(ctx, jobId, 'succeeded');
    await bustFinanceCache(ctx);
```

Update imports: add `upsertInvoicesBatch, loadProductMap, bustFinanceCache` to the `./finance.service` import; remove the now-unused single-invoice loop bits (the `consecutiveFailures` counter is gone — page-atomic). Keep the outer `try/catch` that marks `failed` + preserves cursor.

- [ ] **Step 3: Update the existing `finance-sync.service.test.ts`**

The mock for `./finance.service` must export `upsertInvoicesBatch` (replaces `upsertInvoice`), `loadProductMap` (returns `new Map()`), `bustFinanceCache` (no-op), `getSource`, `setSourceSync`. Update the drain test to assert `upsertInvoicesBatch` was called once per page (not per invoice); keep the claim/no-creds/cancel/budget/abort tests (the abort test now asserts that a throwing `upsertInvoicesBatch` → `finishJob('failed')`). Example mock:

```ts
const upsertInvoicesBatch = vi.fn<() => Promise<void>>(async () => {});
const loadProductMap = vi.fn(async () => new Map());
const bustFinanceCache = vi.fn(async () => {});
vi.mock('./finance.service', () => ({
  getSource: (...a: unknown[]) => getSource(),
  setSourceSync: (...a: unknown[]) => setSourceSync(),
  upsertInvoicesBatch: (...a: unknown[]) => upsertInvoicesBatch(),
  loadProductMap: (...a: unknown[]) => loadProductMap(),
  bustFinanceCache: (...a: unknown[]) => bustFinanceCache(),
}));
```
Update the drain test: `expect(upsertInvoicesBatch).toHaveBeenCalledTimes(2)` (two pages); the abort test: make `upsertInvoicesBatch.mockRejectedValueOnce(new Error('boom'))` and assert `finishJob(...,'failed',...)`.

- [ ] **Step 4: Run tests + check**

Run: `bun run vitest run src/server/services/finance-sync.service.test.ts src/server/services/finance.service.test.ts && bun run check` → PASS, 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/finance-sync.service.ts src/server/services/finance.service.ts src/server/services/finance-sync.service.test.ts
git commit -m "perf(finance): advanceJob batches per page + busts Valkey cache on sync finish"
```

---

### Task 4: Product catalog service

**Files:**
- Create: `src/server/services/finance-products.service.ts`
- Test: `src/server/services/finance-products.service.test.ts`

**Interfaces:**
- Produces: `listProducts(ctx)`, `upsertProduct(ctx, {code,name,category,unitPrice,active})`, `deactivateProduct(ctx,id)`, `importFromBilling(ctx): Promise<{created:number,linked:number}>`, `catalogCoverage(ctx): Promise<{cataloged:number,billedNotInCatalog:number,catalogNeverBilled:number}>`. All bust finance cache on write.

- [ ] **Step 1: Write the failing test** — `finance-products.service.test.ts` (mock-db; mock `@minion-stack/cache` `invalidateTags`/`tags`):

```ts
import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
vi.mock('@minion-stack/cache', () => ({ invalidateTags: vi.fn(async () => {}), tags: { tenantDomain: () => ['t'] } }));
import { listProducts, upsertProduct } from './finance-products.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('finance-products.service', () => {
  it('listProducts selects catalog rows', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'p1', code: 'AF1', name: 'Afinamiento', billed: 380, revenue: 488038 }]);
    const rows = await listProducts(ctx(db));
    expect(rows[0].code).toBe('AF1');
  });
  it('upsertProduct inserts with onConflict and busts cache', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await upsertProduct(ctx(db), { code: 'AF1', name: 'Afinamiento', category: null, unitPrice: 100, active: true });
    expect(db.insert).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/services/finance-products.service.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `finance-products.service.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProducts } from '$server/db/pg-finance-schema';
import { bustFinanceCache } from './finance.service';

export async function listProducts(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      select p.id, p.code, p.name, p.category, p.unit_price, p.active,
             count(i.id)::int as billed, coalesce(sum(i.total),0)::float8 as revenue
      from fin_products p
      left join fin_invoice_items i on i.product_id = p.id and i.org_id = p.org_id
      where p.org_id = ${ctx.tenantId}
      group by p.id order by revenue desc, p.name
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id), code: String(r.code), name: String(r.name),
      category: r.category != null ? String(r.category) : null,
      unitPrice: r.unit_price != null ? Number(r.unit_price) : null, active: r.active === true,
      billed: Number(r.billed), revenue: Number(r.revenue),
    }));
  });
}

export async function upsertProduct(
  ctx: CoreCtx, p: { code: string; name: string; category: string | null; unitPrice: number | null; active: boolean },
) {
  await withOrgCore(ctx, (tx) =>
    tx.insert(finProducts).values({
      orgId: ctx.tenantId, code: p.code, name: p.name, category: p.category,
      unitPrice: p.unitPrice == null ? null : String(p.unitPrice), active: p.active, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [finProducts.orgId, finProducts.code],
      set: { name: p.name, category: p.category, unitPrice: p.unitPrice == null ? null : String(p.unitPrice), active: p.active, updatedAt: new Date() },
    }),
  );
  await bustFinanceCache(ctx);
}

export async function deactivateProduct(ctx: CoreCtx, id: string) {
  await withOrgCore(ctx, (tx) =>
    tx.update(finProducts).set({ active: false, updatedAt: new Date() })
      .where(and(eq(finProducts.id, id), eq(finProducts.orgId, ctx.tenantId))),
  );
  await bustFinanceCache(ctx);
}

/** Seed the catalog from distinct billed codes (latest description as name); link items. */
export async function importFromBilling(ctx: CoreCtx): Promise<{ created: number; linked: number }> {
  return withOrgCore(ctx, async (tx) => {
    const created = (await tx.execute(sql`
      insert into fin_products (org_id, code, name)
      select org_id, code, (array_agg(description order by id desc))[1]
      from fin_invoice_items where org_id = ${ctx.tenantId} and code is not null and code <> ''
      group by org_id, code
      on conflict (org_id, code) do nothing
      returning id
    `)) as unknown as unknown[];
    const linked = (await tx.execute(sql`
      update fin_invoice_items i set product_id = p.id from fin_products p
      where i.org_id = ${ctx.tenantId} and p.org_id = i.org_id and p.code = i.code and i.product_id is null
      returning i.id
    `)) as unknown as unknown[];
    await bustFinanceCache(ctx);
    return { created: created.length, linked: linked.length };
  });
}

export async function catalogCoverage(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const [row] = (await tx.execute(sql`
      select
        (select count(*) from fin_products where org_id = ${ctx.tenantId})::int as cataloged,
        (select count(distinct i.code) from fin_invoice_items i
           where i.org_id = ${ctx.tenantId} and i.code is not null and i.code <> ''
           and not exists (select 1 from fin_products p where p.org_id = i.org_id and p.code = i.code))::int as billed_not_in_catalog,
        (select count(*) from fin_products p where p.org_id = ${ctx.tenantId}
           and not exists (select 1 from fin_invoice_items i where i.org_id = p.org_id and i.code = p.code))::int as catalog_never_billed
    `)) as unknown as Array<{ cataloged: number; billed_not_in_catalog: number; catalog_never_billed: number }>;
    return { cataloged: Number(row.cataloged), billedNotInCatalog: Number(row.billed_not_in_catalog), catalogNeverBilled: Number(row.catalog_never_billed) };
  });
}
```

- [ ] **Step 4: Run tests + check** → PASS, 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/finance-products.service.ts src/server/services/finance-products.service.test.ts
git commit -m "feat(finance): product catalog service (list/upsert/deactivate/import/coverage)"
```

---

### Task 5: Products page + nav + endpoints

**Files:**
- Create: `src/routes/api/finances/products/+server.ts` (GET member, PUT admin), `src/routes/api/finances/products/import/+server.ts` (POST admin), `src/routes/api/finances/products/[id]/deactivate/+server.ts` (POST admin)
- Create: `src/routes/(app)/finances/products/+page.server.ts`, `src/routes/(app)/finances/products/+page.svelte`
- Modify: `src/lib/components/finance/FinanceNav.svelte` (add Products tab), `messages/en.json`, `messages/es.json`

**Interfaces:** Consumes Task 4 service.

- [ ] **Step 1: Endpoints**

`products/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProducts, upsertProduct } from '$server/services/finance-products.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403);
  return json({ products: await listProducts(ctx) });
};
export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401);
  const b = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof b.code !== 'string' || !b.code.trim() || typeof b.name !== 'string' || !b.name.trim()) throw error(400, 'code and name required');
  await upsertProduct(ctx, { code: String(b.code).trim(), name: String(b.name).trim(),
    category: b.category ? String(b.category) : null, unitPrice: b.unitPrice == null || b.unitPrice === '' ? null : Number(b.unitPrice),
    active: b.active !== false });
  return json({ ok: true });
};
```
`products/import/+server.ts` (POST, requireAdmin + module gate → `importFromBilling`, return result). `products/[id]/deactivate/+server.ts` (POST, requireAdmin → `deactivateProduct(ctx, params.id)`).

- [ ] **Step 2: Page load** `products/+page.server.ts`:
```ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { listProducts, catalogCoverage } from '$server/services/finance-products.service';
export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const [products, coverage] = await Promise.all([listProducts(ctx), catalogCoverage(ctx)]);
  return { products, coverage };
};
```

- [ ] **Step 3: Page UI** `products/+page.svelte` — mirror the `clients/+page.svelte` table structure (Package icon, PageHeader). Columns: code · name (editable) · category · ref price · active · #billed · revenue. A coverage banner from `data.coverage` ("`billedNotInCatalog` billed products not in catalog · Import from billing"). An "Import from billing" button → `POST /api/finances/products/import`, then `invalidate('finances:data')`. Inline edit row → `PUT /api/finances/products`. Use the same table CSS classes as the clients page. Validate with the Svelte autofixer.

- [ ] **Step 4: Nav** — in `FinanceNav.svelte` add to `TABS` between clients and settings:
```ts
{ id: 'products', label: () => m.fin_nav_products(), icon: Package, href: '/finances/products' },
```
Import `Package` from `lucide-svelte`. Add `isActive` handles it via the generic `startsWith` branch (already does).

- [ ] **Step 5: i18n** — add `fin_nav_products`, `fin_products_title`, `fin_products_subtitle`, `fin_products_import`, `fin_products_coverage` (`"{n} billed products not in catalog"`), column labels, `fin_products_empty` to en + es.

- [ ] **Step 6: check + commit**

Run: `bun run check` → 0/0.
```bash
git add src/routes/api/finances/products src/routes/\(app\)/finances/products src/lib/components/finance/FinanceNav.svelte messages/en.json messages/es.json
git commit -m "feat(finance): product catalog page, nav tab, and admin endpoints"
```

---

### Task 6: Period-scoped, cached dashboard aggregates

**Files:**
- Create: `src/lib/finance/period.ts` (pure `parsePeriod` + types) + `src/lib/finance/period.test.ts`
- Modify: `src/server/services/finance.service.ts` (period-scoped `financeSummary`, `revenueSeries`, `topProducts`, `topClients`; cache wrappers)
- Test: extend `finance.service.test.ts`

**Interfaces:**
- Produces: `type Period = { from: string | null; to: string | null; bucket: 'day'|'week'|'month' }`; `parsePeriod(url: URL): Period`; `financeSummary(ctx, period)`, `revenueSeries(ctx, period)`, `topProducts(ctx, period, opts?)`, `topClients(ctx, period, opts?)` — each Valkey-cached by `(org,from,to,bucket)`.

- [ ] **Step 1: `parsePeriod` test + impl** (`src/lib/finance/period.ts` + test):

```ts
// period.ts
export type Bucket = 'day' | 'week' | 'month';
export type Period = { from: string | null; to: string | null; bucket: Bucket };
const BUCKETS: Bucket[] = ['day', 'week', 'month'];
function iso(v: string | null): string | null {
  if (!v) return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
export function parsePeriod(url: URL): Period {
  const bucketRaw = url.searchParams.get('bucket');
  const bucket: Bucket = BUCKETS.includes(bucketRaw as Bucket) ? (bucketRaw as Bucket) : 'month';
  let from = iso(url.searchParams.get('from'));
  let to = iso(url.searchParams.get('to'));
  if (from && to && Date.parse(from) > Date.parse(to)) [from, to] = [to, from];
  return { from, to, bucket };
}
```
Test: default bucket month; invalid bucket→month; bad ISO→null; from>to swaps.

- [ ] **Step 2: Aggregates** — in `finance.service.ts`, add a period `where` builder and the four cached functions. Key code:

```ts
import { cached, keys } from '@minion-stack/cache';
import type { Period } from '$lib/finance/period';

function periodWhere(p: Period) {
  const conds = [sql`org_id = current_setting('app.current_org_id', true)`];
  if (p.from) conds.push(sql`issued_at >= ${p.from}`);
  if (p.to) conds.push(sql`issued_at < ${p.to}`);
  return sql.join(conds, sql` and `);
}
const ck = (org: string, name: string, p: Period) => keys.hub(`fin-${name}`, { t: org, f: p.from ?? '', e: p.to ?? '', b: p.bucket });
const ctags = (org: string) => [...financeCacheTags(org)];

export function financeSummary(ctx: CoreCtx, p: Period) {
  return cached(ck(ctx.tenantId, 'summary', p), { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) }, () =>
    withOrgCore(ctx, async (tx) => {
      const [r] = (await tx.execute(sql`
        select coalesce(sum(total),0)::float8 net, coalesce(sum(subtotal),0)::float8 gross,
               coalesce(sum(discount),0)::float8 discount, count(*)::int invoices,
               count(distinct coalesce(client_id::text, client_doc_number))::int clients,
               count(*) filter (where status='void')::int voids,
               mode() within group (order by currency) currency
        from fin_invoices where ${periodWhere(p)}
      `)) as unknown as Array<Record<string, unknown>>;
      const net = Number(r.net), gross = Number(r.gross), discount = Number(r.discount), invoices = Number(r.invoices), voids = Number(r.voids);
      // new clients = first-ever invoice within the period
      const [nc] = (await tx.execute(sql`
        select count(*)::int n from (
          select client_doc_number, min(issued_at) first from fin_invoices
          where org_id = current_setting('app.current_org_id', true) and client_doc_number is not null group by client_doc_number
        ) f where ${p.from ? sql`f.first >= ${p.from}` : sql`true`} and ${p.to ? sql`f.first < ${p.to}` : sql`true`}
      `)) as unknown as Array<{ n: number }>;
      return { totalNet: net, totalGross: gross, totalDiscount: discount, discountRate: gross > 0 ? discount / gross : 0,
        invoiceCount: invoices, avgTicket: invoices > 0 ? net / invoices : 0, uniqueClients: Number(r.clients),
        newClients: Number(nc.n), voidCount: voids, voidRate: invoices > 0 ? voids / invoices : 0,
        currency: r.currency != null ? String(r.currency) : 'PEN' };
    }),
  );
}

export function revenueSeries(ctx: CoreCtx, p: Period) {
  return cached(ck(ctx.tenantId, 'series', p), { ttl: '2m', swr: '30s', tags: ctags(ctx.tenantId) }, () =>
    withOrgCore(ctx, async (tx) => {
      const rows = (await tx.execute(sql`
        select to_char(date_trunc(${p.bucket}, issued_at), 'YYYY-MM-DD') bucket,
               count(*)::int invoices, coalesce(sum(total),0)::float8 revenue,
               coalesce(sum(discount),0)::float8 discount, coalesce(sum(subtotal),0)::float8 gross
        from fin_invoices where ${periodWhere(p)} and issued_at is not null
        group by 1 order by 1
      `)) as unknown as Array<Record<string, unknown>>;
      return rows.map((r) => ({ bucket: String(r.bucket), invoices: Number(r.invoices), revenue: Number(r.revenue), discount: Number(r.discount), gross: Number(r.gross) }));
    }),
  );
}
// topProducts(ctx,p,{limit=15}) → group fin_invoice_items joined to fin_invoices (period filter) by product_id,
//   left join fin_products for name (coalesce max(description)); return {productId,code,name,revenue,qty,lines}. Cached ck 'products'.
// topClients(ctx,p,{limit=10}) → group fin_invoices by client_id (period) join fin_clients name; {docNumber,name,invoices,revenue,last}. Cached ck 'clients'.
```
(Write `topProducts`/`topClients` following the same `cached`+`withOrgCore`+`sql.execute`+Number-coercion shape — full SQL in the brief; keep period filter + Number coercion.)

- [ ] **Step 3: Tests** — extend `finance.service.test.ts`: `financeSummary`/`revenueSeries` coerce to Number (mock the cache so it calls through: `vi.mock('@minion-stack/cache', () => ({ cached: (_k,_o,fn)=>fn(), keys:{hub:()=>'k'}, invalidateTags: async()=>{}, tags:{tenantDomain:()=>['t']} }))`), and respect period (no error with from/to). Assert avgTicket = net/invoices.

- [ ] **Step 4: check + commit** → 0/0.
```bash
git add src/lib/finance/period.ts src/lib/finance/period.test.ts src/server/services/finance.service.ts src/server/services/finance.service.test.ts
git commit -m "feat(finance): period-scoped, Valkey-cached dashboard aggregates + parsePeriod"
```

---

### Task 7: Dashboard UI (period controls, KPIs, charts)

**Files:**
- Modify: `src/routes/(app)/finances/+page.server.ts`, `src/routes/(app)/finances/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json`

- [ ] **Step 1: Load** — `+page.server.ts`:
```ts
import { parsePeriod } from '$lib/finance/period';
import { financeSummary, revenueSeries, topProducts, topClients } from '$server/services/finance.service';
export const load = async ({ locals, url, depends }) => {
  const ctx = await getCoreCtx(locals); if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const period = parsePeriod(url);
  const [summary, series, products, clients] = await Promise.all([
    financeSummary(ctx, period), revenueSeries(ctx, period), topProducts(ctx, period, { limit: 15 }), topClients(ctx, period, { limit: 10 }),
  ]);
  return { period, summary, series, products, clients, hasData: summary.invoiceCount > 0 };
};
```

- [ ] **Step 2: UI** — `+page.svelte`: replace the CSS bars. Add:
  - **Period controls**: two `<input type="date">` (from/to) + a `[Day|Week|Month]` button group + presets (30d/12m/YTD/All). On change build a URL and `goto(\`/finances?from=${from}&to=${to}&bucket=${bucket}\`, { keepFocus: true, noScroll: true })`.
  - **KPI row** from `data.summary` (net revenue, avg ticket, invoices, unique clients, new clients, discount rate %, period growth % [last vs prev `series` net], void rate %).
  - **Revenue area chart** `<Chart options={revenueOpts} />` where `revenueOpts` is `$derived` from `data.series` + a local `mode` (`'period'|'cumulative'`): an area series for net (cumulative = running sum) + a second area/line for discount. Toggle button flips `mode`.
  - **Avg-ticket chart** `<Chart>` line: per-bucket `revenue/invoices`.
  - **Top Products** `<Chart>` bar with a local `prodMode` (`'revenue'|'qty'`) toggle, labels = `name`.
  - **Top Clients** `<Chart>` horizontal bar (top 10).
  Build `EChartsOption` objects in `$derived`. Use `data.summary.currency` in labels. Validate with the Svelte autofixer.
- [ ] **Step 3: i18n** for all KPI labels, toggles, presets (en + es).
- [ ] **Step 4: check + commit** → 0/0.
```bash
git add src/routes/\(app\)/finances/+page.server.ts src/routes/\(app\)/finances/+page.svelte messages/en.json messages/es.json
git commit -m "feat(finance): ECharts dashboard — period filters, KPIs, revenue area + avg-ticket + top products/clients"
```

---

### Task 8: Windowed list rendering (invoices / payments / clients)

**Files:**
- Modify: `src/routes/(app)/finances/invoices/+page.svelte`, `.../payments/+page.svelte`, `.../clients/+page.svelte`
- Modify (raise limits): `src/routes/(app)/finances/invoices/+page.server.ts`, `.../payments/+page.server.ts` (pass `{ limit: 5000 }`)

- [ ] **Step 1:** Add windowing to each list page, mirroring `crm/+page.svelte`'s pattern (per `crm-slowness-rootcause-windowing`): a `const PAGE = 60`, `let renderLimit = $state(PAGE)`, `const windowed = $derived(rows.slice(0, renderLimit))`, render `windowed` instead of the full list. Attach an `onscroll` listener to the scroll container that, when `scrollTop + clientHeight >= scrollHeight - 400`, does `renderLimit += PAGE`. Reset `renderLimit = PAGE` in an `$effect` that reads the filtered/sorted source length (so it resets on data change). Do NOT use IntersectionObserver.
- [ ] **Step 2:** Raise the server `limit` to 5000 in the invoices/payments loads so the windowed client list is complete.
- [ ] **Step 3:** `bun run check` → 0/0; validate each `.svelte` with the autofixer.
- [ ] **Step 4: Commit**
```bash
git add src/routes/\(app\)/finances/invoices src/routes/\(app\)/finances/payments src/routes/\(app\)/finances/clients/+page.svelte
git commit -m "perf(finance): windowed render on invoices/payments/clients lists"
```

---

### Task 9: CRM↔Finance bridge service

**Files:**
- Modify: `src/server/services/crm-contacts.service.ts` (export the existing `normPhone`)
- Create: `src/server/services/crm-finance.service.ts`
- Test: `src/server/services/crm-finance.service.test.ts`

**Interfaces:**
- Consumes: `bothEnabled` (`modules.service`), `normPhone` (exported from `crm-contacts.service`).
- Produces: `contactFinanceMap(ctx): Promise<Record<string,{revenue:number;invoices:number;lastPurchaseAt:string|null}>>` (keyed by contact_id); `contactFinanceSummary(ctx, contactId): Promise<{revenue:number;invoices:number;lastPurchaseAt:string|null;recentInvoices:Array<{id:string;documentId:string|null;issuedAt:string|null;total:number;status:string|null}>}|null>`.

- [ ] **Step 1:** In `crm-contacts.service.ts`, change `const normPhone = …` to `export const normPhone = …` (line ~807). (No behavior change.)

- [ ] **Step 2: Write the failing test** — `crm-finance.service.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
const bothEnabled = vi.fn(async () => true);
vi.mock('./modules.service', () => ({ bothEnabled: (...a: unknown[]) => bothEnabled() }));
import { contactFinanceMap } from './crm-finance.service';
const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('contactFinanceMap', () => {
  it('returns {} when bothEnabled is false', async () => {
    bothEnabled.mockResolvedValueOnce(false);
    const { db } = createMockDb();
    expect(await contactFinanceMap(ctx(db))).toEqual({});
  });
  it('keys aggregates by contact_id when enabled', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ contact_id: 'c1', revenue: 500, invoices: 3, last: '2026-01-01T00:00:00Z' }]);
    const map = await contactFinanceMap(ctx(db));
    expect(map['c1']).toEqual({ revenue: 500, invoices: 3, lastPurchaseAt: '2026-01-01T00:00:00Z' });
  });
});
```

- [ ] **Step 3: Implement** `crm-finance.service.ts`:
```ts
import { sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { bothEnabled } from './modules.service';

// last-9-digit phone match (Peru), normalized in SQL on both sides.
const PHONE9 = (col: string) => sql.raw(`right(regexp_replace(coalesce(${col},''),'\\D','','g'), 9)`);

export async function contactFinanceMap(ctx: CoreCtx): Promise<Record<string, { revenue: number; invoices: number; lastPurchaseAt: string | null }>> {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return {};
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(sql`
      with phones as (
        select ci.contact_id, ${PHONE9('ci.external_id')} as p9
        from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.channel = 'whatsapp'
          and length(${PHONE9('ci.external_id')}) >= 8
      )
      select ph.contact_id,
             coalesce(sum(fi.total),0)::float8 revenue, count(fi.id)::int invoices, max(fi.issued_at) last
      from phones ph
      join fin_clients fc on fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} = ph.p9
      join fin_invoices fi on fi.client_id = fc.id
      group by ph.contact_id
    `)) as unknown as Array<{ contact_id: string; revenue: number; invoices: number; last: string | null }>;
    const out: Record<string, { revenue: number; invoices: number; lastPurchaseAt: string | null }> = {};
    for (const r of rows) out[String(r.contact_id)] = { revenue: Number(r.revenue), invoices: Number(r.invoices), lastPurchaseAt: r.last != null ? String(r.last) : null };
    return out;
  });
}

export async function contactFinanceSummary(ctx: CoreCtx, contactId: string) {
  if (!(await bothEnabled(ctx, 'crm', 'finances'))) return null;
  return withOrgCore(ctx, async (tx) => {
    const invoices = (await tx.execute(sql`
      with phones as (
        select ${PHONE9('ci.external_id')} p9 from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId} and ci.channel='whatsapp'
      )
      select fi.id, fi.document_id, fi.issued_at, coalesce(fi.total,0)::float8 total, fi.status
      from fin_invoices fi
      join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} in (select p9 from phones)
      order by fi.issued_at desc nulls last limit 10
    `)) as unknown as Array<Record<string, unknown>>;
    if (invoices.length === 0) return null;
    const all = invoices.map((r) => ({ id: String(r.id), documentId: r.document_id != null ? String(r.document_id) : null,
      issuedAt: r.issued_at != null ? String(r.issued_at) : null, total: Number(r.total), status: r.status != null ? String(r.status) : null }));
    const [agg] = (await tx.execute(sql`
      with phones as (select ${PHONE9('ci.external_id')} p9 from crm_contact_identities ci
        where ci.org_id = current_setting('app.current_org_id', true) and ci.contact_id = ${contactId} and ci.channel='whatsapp')
      select coalesce(sum(fi.total),0)::float8 revenue, count(fi.id)::int invoices, max(fi.issued_at) last
      from fin_invoices fi join fin_clients fc on fc.id = fi.client_id
      where fc.org_id = current_setting('app.current_org_id', true) and ${PHONE9('fc.phone')} in (select p9 from phones)
    `)) as unknown as Array<{ revenue: number; invoices: number; last: string | null }>;
    return { revenue: Number(agg.revenue), invoices: Number(agg.invoices), lastPurchaseAt: agg.last != null ? String(agg.last) : null, recentInvoices: all };
  });
}
```

- [ ] **Step 4: Run tests + check** → PASS, 0/0.
- [ ] **Step 5: Commit**
```bash
git add src/server/services/crm-finance.service.ts src/server/services/crm-finance.service.test.ts src/server/services/crm-contacts.service.ts
git commit -m "feat(crm): CRM↔Finance bridge service (phone-match, bothEnabled-guarded, no coupling)"
```

---

### Task 10: CRM UI — customers columns + contact Financials card

**Files:**
- Modify: `src/routes/(app)/crm/customers/+page.server.ts`, `src/routes/(app)/crm/customers/+page.svelte`
- Modify: `src/routes/(app)/crm/[contactId]/+page.server.ts`, `src/routes/(app)/crm/[contactId]/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json`

- [ ] **Step 1: customers load** — after the existing `Promise.all`, add:
```ts
import { contactFinanceMap } from '$server/services/crm-finance.service';
// ...
const financeMap = await contactFinanceMap(ctx); // {} when bothEnabled false
const financeEnabled = Object.keys(financeMap).length > 0;
const withFinance = financeEnabled ? contacts.map((c) => ({ ...c, finance: financeMap[c.contact_id] ?? null })) : contacts;
return { contacts: withFinance, tags, orgId: ctx.tenantId, financeEnabled };
```
- [ ] **Step 2: customers table** — when `data.financeEnabled`, render 3 extra `<th>`/`<td>`: Revenue (`c.finance?.revenue`), Invoices (`c.finance?.invoices`), Last purchase (`c.finance?.lastPurchaseAt`). Add a `revenue` sort key to the existing `cmp` map (`(c)=> c.finance?.revenue ?? -Infinity`). Blank cells when `c.finance` null. Validate with autofixer.
- [ ] **Step 3: contact detail load** — add:
```ts
import { contactFinanceSummary } from '$server/services/crm-finance.service';
// in the Promise.all or after:
const finance = await contactFinanceSummary(ctx, id);
// add `finance` to the returned object
```
- [ ] **Step 4: contact detail UI** — add a **Financials card** rendered only `{#if data.finance}`: revenue, # invoices, last purchase, and a short list of `data.finance.recentInvoices` each linking to `/finances/invoices/{inv.id}`. Match the existing detail-card styling. Validate with autofixer.
- [ ] **Step 5: i18n** — `crm_col_revenue`, `crm_col_invoices`, `crm_col_last_purchase`, `crm_financials_title`, `crm_financials_recent` (en + es).
- [ ] **Step 6: check + commit** → 0/0.
```bash
git add src/routes/\(app\)/crm/customers src/routes/\(app\)/crm/\[contactId\] messages/en.json messages/es.json
git commit -m "feat(crm): finance columns on customers list + Financials card on contact detail"
```

---

## Self-Review

**Spec coverage:** C-schema→Task 1 (+orchestrator migrations); S→Tasks 2–3; C-rest→Tasks 4–5; A→Tasks 6–7 (period filters, KPIs incl. avg-ticket, revenue area, top products/clients, caching); P→Task 8; B→Tasks 9–10; Caching→Tasks 3 (bust) + 6 (cached aggregates); Cloudflare-N/A noted in spec (no task, correct). ✓

**Placeholder scan:** Tasks 6/7/8 reference "follow the same shape" for `topProducts`/`topClients` SQL and the chart-option builders — these are concrete patterns with the surrounding code given, not TODOs; the implementer has full examples (`financeSummary`/`revenueSeries`, `Chart.svelte`, the clients/crm pages). Acceptable for UI/SQL-by-analogy; all logic tasks (1–4, 9) have complete code.

**Type consistency:** `upsertInvoicesBatch(ctx,invoices,productMap?)`, `loadProductMap→Map<code,id>`, `financeCacheTags/bustFinanceCache`, `Period`/`parsePeriod`, `contactFinanceMap`→Record<contactId,…>, `contactFinanceSummary`→{…,recentInvoices} are used identically across tasks. `revenueSeries` replaces `dashboardRows` (old name retired; bg-sync code doesn't call it). ✓

**Risk note:** the mock-db call-shape assertions (Tasks 2,3) verify orchestration, not real SQL; the batch upsert's set-based correctness + the bridge's phone join are validated by the orchestrator's live re-sync + a spot check on gxv after Tasks 3 and 9.
