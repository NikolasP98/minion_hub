# POS Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/pos` front-desk module unifying finances, stock, and scheduling into four RBAC-gateable user flows (Sell, Appointments, Catalog, Refills) plus cash-shift open/close — per spec `docs/superpowers/specs/2026-07-07-pos-module-design.md` (READ IT FIRST; it is the contract).

**Architecture:** New `pos_*` tables (settings, shifts, tickets, lines, payments) org-scoped like stock; a `pos.service.ts` whose ticket submit commits money first and posts stock POST-COMMIT fail-soft (`stockWarning` contract identical to booking completion); UI = one `(app)/pos` layout with sub-tab pages reusing DataTable/Modal/Combobox/toast; RBAC rides `MODULE_SUBRESOURCES` for per-flow gating.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Drizzle on Supabase PG (`withOrgCore`), Paraglide i18n (en+es), vitest with `createMockDb`, Zag-based UI kit.

## Global Constraints

- Commit with `git -c commit.gpgsign=false commit …` (1Password GPG hangs otherwise).
- NEVER `git add -A` / `git add .` — the working tree carries other sessions' WIP (`scripts/repair-stock-valuation.ts`, `src/server/services/stock.logic.ts`, `src/server/services/finance.service.ts`, `src/lib/components/charts/Chart.svelte`, finances pages, `messages/en.json`+`es.json` hunks you didn't write). Stage ONLY files you created/edited, by exact path.
- `+server.ts` files may export ONLY HTTP handlers (GET/POST/PATCH/PUT/DELETE) — helper exports break the prod build.
- Drizzle `numeric` columns are strings in JS: wrap reads `Number(x)` and writes `String(x)`; money compares use `Math.abs(a-b) < 0.01`.
- Never apply migrations to any database; never run `drizzle-kit push`. The migration FILE is the deliverable — the orchestrator applies it.
- Svelte 5 runes only; user-facing strings via Paraglide `m.key()` — add keys to BOTH `messages/en.json` and `messages/es.json`, then run `bun run i18n:compile` before `bun run check`.
- Every new page/route/API surface must satisfy the RBAC checklist in `CLAUDE.md` §"RBAC gating" (Task 6 does the central wiring; per-page `canAct` gating is each UI task's job).
- Money math client-side in integer cents; server re-validates.
- After any merge/rebase: `bun run i18n:compile` (stale-paraglide phantom errors).

---

### Task 1: Migration + Drizzle schema (`pos_*` tables)

**Files:**
- Create: `supabase/migrations/20260707120000_pos.sql`
- Create: `src/server/db/pg-pos-schema.ts`
- Modify: `src/server/db/pg-schema/index.ts` (or wherever sibling schemas like `pg-sales-schema.ts` are re-exported — grep `pg-sales-schema` to find the barrel and mirror it)

**Interfaces:**
- Produces: drizzle tables `posSettings`, `posShifts`, `posTickets`, `posTicketLines`, `posPayments`; types `PosShift`, `PosTicket`, `PosTicketLine`, `PosPayment`, `PosSettingsRow`.

- [ ] **Step 1: Write the migration** — copy the RLS/grants prologue style from `supabase/migrations/20260705230000_stock_accruals.sql` (read it first):

```sql
-- POS module: settings, cash shifts, tickets, lines, payments.
-- Spec: docs/superpowers/specs/2026-07-07-pos-module-design.md
create table if not exists pos_settings (
  org_id text primary key,
  methods jsonb not null default '["cash","card","yape","plin","transfer"]',
  currency text not null default 'PEN',
  require_customer boolean not null default false,
  allow_price_override boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pos_shifts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  status text not null default 'open',
  opened_by uuid,
  opened_at timestamptz not null default now(),
  opening_float jsonb not null default '{}',
  closed_by uuid,
  closed_at timestamptz,
  expected jsonb,
  counted jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pos_shifts_one_open_per_org
  on pos_shifts (org_id) where status = 'open';

create table if not exists pos_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  human_id text,
  shift_id uuid not null references pos_shifts(id) on delete restrict,
  party_id uuid,
  crm_contact_id uuid,
  customer_name text,
  status text not null default 'submitted',
  subtotal numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  currency text not null default 'PEN',
  note text,
  stock_entry_id uuid,
  stock_warning jsonb,
  invoice_provider_ref text,
  created_by uuid,
  submitted_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  metadata jsonb not null default '{}'
);
create index if not exists pos_tickets_org_submitted_idx on pos_tickets (org_id, submitted_at);
create index if not exists pos_tickets_org_shift_idx on pos_tickets (org_id, shift_id);
create index if not exists pos_tickets_org_party_idx on pos_tickets (org_id, party_id);

create table if not exists pos_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ticket_id uuid not null references pos_tickets(id) on delete cascade,
  kind text not null,
  fin_product_id uuid,
  booking_id uuid,
  description text not null,
  qty numeric not null,
  unit_price numeric not null,
  discount numeric not null default 0,
  total numeric not null,
  line_no integer not null default 0
);
create index if not exists pos_ticket_lines_org_ticket_idx on pos_ticket_lines (org_id, ticket_id);
create index if not exists pos_ticket_lines_org_product_idx on pos_ticket_lines (org_id, fin_product_id);

create table if not exists pos_payments (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  ticket_id uuid not null references pos_tickets(id) on delete cascade,
  shift_id uuid not null,
  method text not null,
  amount numeric not null,
  tendered numeric,
  paid_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create index if not exists pos_payments_org_shift_idx on pos_payments (org_id, shift_id);
create index if not exists pos_payments_ticket_idx on pos_payments (ticket_id);
```

Then, for EACH of the five tables, append the same three statements the accruals migration uses (adapt table name): `alter table <t> enable row level security; alter table <t> force row level security;` + the `<t>_org_guc` policy on `current_setting('app.current_org_id', true)` + `grant select, insert, update, delete on <t> to app_ledger;`. Copy the exact policy SQL from `20260705230000_stock_accruals.sql` — do not improvise.

- [ ] **Step 2: Write `src/server/db/pg-pos-schema.ts`** — mirror `pg-sales-schema.ts` conventions. File header jsdoc:

```ts
import { pgTable, uuid, text, numeric, jsonb, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * POS front-desk module — cash shifts, tickets (the terminal sale document),
 * lines, split-tender payments, and per-org settings.
 *
 * IMPORTANT — why a ticket, not an invoice: SUSII is the fiscal invoice source
 * of truth (fin_invoices, provider='susii') and revenue analytics sum
 * fin_invoices. A POS ticket is the ERPNext "POS Invoice" analog: it records
 * the sale + tender + drives stock, and reconciles AGAINST the SUSII invoice
 * later (invoice_provider_ref) without inflating revenue.
 *
 * Tenancy: org_id text + withOrgCore (app_ledger + GUC, forced RLS). Companion
 * migration supabase/migrations/20260707120000_pos.sql.
 */
export const posSettings = pgTable('pos_settings', {
  orgId: text('org_id').primaryKey(),
  methods: jsonb('methods').notNull().default(['cash', 'card', 'yape', 'plin', 'transfer']),
  currency: text('currency').notNull().default('PEN'),
  requireCustomer: boolean('require_customer').notNull().default(false),
  allowPriceOverride: boolean('allow_price_override').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PosSettingsRow = typeof posSettings.$inferSelect;
```

Write the remaining four tables matching the SQL in Step 1 column-for-column (`integer` for `line_no`, `numeric` for all money/qty columns, the same `index(...)` names), e.g. the partial unique index on shifts:

```ts
export const posShifts = pgTable(
  'pos_shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    status: text('status').notNull().default('open'),
    openedBy: uuid('opened_by'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    openingFloat: jsonb('opening_float').notNull().default({}),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    expected: jsonb('expected'),
    counted: jsonb('counted'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    oneOpen: uniqueIndex('pos_shifts_one_open_per_org').on(t.orgId).where(sql.raw(`status = 'open'`)),
  }),
);
export type PosShift = typeof posShifts.$inferSelect;
```

…and equivalently `posTickets` (`PosTicket`), `posTicketLines` (`PosTicketLine`), `posPayments` (`PosPayment`), `posSettings` (`PosSettingsRow`) with every column from Step 1. Export all types.

- [ ] **Step 3: Wire the schema barrel** — find how `pg-sales-schema.ts` reaches the drizzle client schema map (grep `pg-sales-schema` across `src/server/db/`); add `pg-pos-schema` the same way.

- [ ] **Step 4: Verify** — `bun run check` → 0 errors (schema file compiles; nothing consumes it yet).

- [ ] **Step 5: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(pos): pos_* schema + migration (settings, shifts, tickets, lines, payments)" -- supabase/migrations/20260707120000_pos.sql src/server/db/pg-pos-schema.ts <barrel file>
```

---

### Task 2: `createSourcedIssue` in stock.service.ts

**Files:**
- Modify: `src/server/services/stock.service.ts` (add near `createServiceIssue`, ~line 962)
- Test: `src/server/services/stock.sourced-issue.test.ts` (new)

**Interfaces:**
- Consumes: existing `StockError`, `Actor`, `CreateIssueFromInvoiceLine`, internal line-insert helpers used by `createServiceIssue` (READ `createServiceIssue` lines ~962-1020 first and reuse its internals — this function is that one minus the single-`finProductId` coupling).
- Produces: `createSourcedIssue(ctx: CoreCtx, input: CreateSourcedIssueInput): Promise<StkEntry>` where

```ts
export interface CreateSourcedIssueInput {
  /** Provenance, e.g. 'pos' | 'pos_refill' consumers. Dup-guarded with sourceId. */
  source: string;
  sourceId: string;
  warehouseId: string;
  lines: CreateIssueFromInvoiceLine[];
  partyId?: string | null;
  note?: string | null;
  submit?: boolean;
  actor: Actor;
  /** Extra metadata merged into the entry's provenance blob. */
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 1: Write failing tests** in `stock.sourced-issue.test.ts` using the `createMockDb` harness — copy the setup style from the existing `stock-accruals.service` tests (grep `createMockDb` in `src/server/services/*.test.ts` and mirror the newest one). Cases:
  1. creates a draft `issue` entry with `metadata = {source:'pos', sourceId:'t-1', ...extra}` and the given lines (fromWarehouse set, toWarehouse null);
  2. `submit: true` path calls through to submit (entry status `submitted`);
  3. second call with same `(source, sourceId)` and an existing non-cancelled entry throws `StockError('duplicate_source')`;
  4. empty `lines` throws `StockError('no_lines')`.

- [ ] **Step 2: Run** `bun run vitest run src/server/services/stock.sourced-issue.test.ts` → FAIL (function missing).

- [ ] **Step 3: Implement** — inside `stock.service.ts`, extract/reuse exactly what `createServiceIssue` does after its product-validation preamble: the dup-guard query on `metadata->>'source'`/`'sourceId'` (throw `duplicate_source`), entry insert (`type:'issue'`, `status:'draft'`, `partyId`, `note`, `metadata: {source: input.source, sourceId: input.sourceId, ...input.metadata}`), line inserts (server-side `qtyConsumption` conversion identical to `createServiceIssue`), optional `submitEntry` call. If `createServiceIssue` has a private helper doing this, call it from both; otherwise refactor the shared body into one private function and have `createServiceIssue` + `createSourcedIssue` both call it (DRY — do NOT paste a second copy).

- [ ] **Step 4: Run tests + full stock suite** — `bun run vitest run src/server/services/stock.sourced-issue.test.ts src/server/services/stock.logic.test.ts` → PASS. NOTE: `stock.logic.ts`/`stock.logic.test.ts` carry another session's uncommitted edits — do not touch or stage them; only verify they still pass.

- [ ] **Step 5: Commit** (only your two files):

```bash
git -c commit.gpgsign=false commit -m "feat(stock): createSourcedIssue — generic multi-line sourced issue (POS)" -- src/server/services/stock.service.ts src/server/services/stock.sourced-issue.test.ts
```

---

### Task 3: pos.service — settings + shifts

**Files:**
- Create: `src/server/services/pos.service.ts`
- Test: `src/server/services/pos.shifts.test.ts`

**Interfaces:**
- Consumes: `withOrgCore`, `CoreCtx` (grep `getCoreCtx`/`CoreCtx` import paths in `sales.service.ts` and mirror), drizzle tables from Task 1, `Actor` shape `{id: string|null, name: string|null}`.
- Produces (Tasks 4/5 extend THIS file; Tasks 7/9-13 call these):

```ts
export class PosError extends Error { constructor(message: string, public code: string) { super(message); } }
export interface PosSettings { methods: string[]; currency: string; requireCustomer: boolean; allowPriceOverride: boolean; }
export const DEFAULT_POS_SETTINGS: PosSettings; // the migration defaults
export async function getPosSettings(ctx: CoreCtx): Promise<PosSettings>;
export async function updatePosSettings(ctx: CoreCtx, patch: Partial<PosSettings>): Promise<PosSettings>;
export interface ShiftSummary { ticketCount: number; voidCount: number; gross: number; byMethod: Record<string, number>; }
export async function getOpenShift(ctx: CoreCtx): Promise<{ shift: PosShift; summary: ShiftSummary } | null>;
export async function openShift(ctx: CoreCtx, input: { openingFloat: Record<string, number>; actor: Actor }): Promise<PosShift>;
export async function closeShift(ctx: CoreCtx, input: { counted: Record<string, number>; note?: string | null; actor: Actor }): Promise<PosShift>;
export async function listShifts(ctx: CoreCtx, opts?: { limit?: number }): Promise<PosShift[]>;
export async function shiftSummary(ctx: CoreCtx, shiftId: string): Promise<ShiftSummary>;
```

- [ ] **Step 1: Failing tests** (`pos.shifts.test.ts`, createMockDb): openShift happy path; openShift with an existing open shift throws `PosError('shift_already_open')`; closeShift with no open shift throws `PosError('no_open_shift')`; closeShift computes `expected` = `{cash: float.cash + Σ cash payment amounts (non-void tickets only), card: Σ card}` and persists `counted` verbatim; shiftSummary aggregates byMethod/gross/ticketCount/voidCount excluding void tickets from money but counting them in voidCount. Money: payments rows come back with string numerics — tests must feed strings (e.g. `amount: '25.50'`).

- [ ] **Step 2: Run → FAIL.** `bun run vitest run src/server/services/pos.shifts.test.ts`

- [ ] **Step 3: Implement.** Notes that matter:
  - `getPosSettings`: select by pk; absent row → `DEFAULT_POS_SETTINGS` (do NOT insert on read). `updatePosSettings`: upsert (`onConflictDoUpdate` on `orgId`), coerce/validate `methods` is a non-empty array of non-empty lowercase strings (`invalid_methods`).
  - `openShift`: rely on the partial unique index for the race, but pre-check with a select for a clean `shift_already_open` error; insert `{openedBy: actor.id, openingFloat}`.
  - `closeShift`: one `withOrgCore` tx — load open shift (`no_open_shift`), aggregate payments joined to non-void tickets for this shift (`select method, sum(amount) … where ticket.status != 'void'` group by method), build `expected` = per-method sums, `expected.cash += Number(openingFloat.cash ?? 0)`, update shift `{status:'closed', closedBy, closedAt: new Date(), expected, counted, note}`.
  - `shiftSummary`: same aggregate + ticket counts; `gross` = Σ non-void ticket totals.
  - All numeric reads `Number(...)`; round to 2dp with a local `round2 = (n) => Math.round(n * 100) / 100`.

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(pos): settings + cash shift lifecycle (open/close/expected-vs-counted)` — stage only the two files.

---

### Task 4: pos.service — tickets (submit / post-stock / void / read)

**Files:**
- Modify: `src/server/services/pos.service.ts`
- Test: `src/server/services/pos.tickets.test.ts`

**Interfaces:**
- Consumes: Task 2 `createSourcedIssue`, `findEntryBySource`, `submitEntry`, `cancelEntry`, `resolveDefaultWarehouse` (from `stock-accruals.service.ts`), `isModuleEnabled` (from `modules.service`), `nextSerialId(tx, orgId, 'POS-.YYYY.-', new Date())`, `stkItems`/`stkConsumption` tables, `emitHubEvent` (mirror the call in `stock.service.ts:410`).
- Produces:

```ts
export interface TicketLineInput { kind: 'service' | 'product'; finProductId?: string | null; bookingId?: string | null; description: string; qty: number; unitPrice: number; discount?: number; }
export interface TicketPaymentInput { method: string; amount: number; tendered?: number | null; }
export interface SubmitTicketInput { lines: TicketLineInput[]; payments: TicketPaymentInput[]; partyId?: string | null; crmContactId?: string | null; customerName?: string | null; discount?: number; note?: string | null; actor: Actor; }
export interface StockWarning { code: string; message: string; draftEntryId?: string; }
export async function submitTicket(ctx: CoreCtx, input: SubmitTicketInput): Promise<{ ticket: PosTicket; stockWarning: StockWarning | null }>;
export async function postTicketStock(ctx: CoreCtx, ticketId: string, actor: Actor): Promise<{ entryId: string | null; stockWarning: StockWarning | null }>;
export async function voidTicket(ctx: CoreCtx, id: string, actor: Actor): Promise<PosTicket>;
export async function listTickets(ctx: CoreCtx, opts?: { shiftId?: string; from?: Date; to?: Date; limit?: number }): Promise<PosTicket[]>;
export async function getTicket(ctx: CoreCtx, id: string): Promise<{ ticket: PosTicket; lines: PosTicketLine[]; payments: PosPayment[] } | null>;
```

- [ ] **Step 1: Failing tests** (`pos.tickets.test.ts`). `vi.mock` the stock service + accruals service + modules service imports (mirror how `scheduling-bookings-accrual.test.ts` mocks `stock-accruals.service` — read that file first). Cases:
  1. happy path: valid lines+payments → ticket inserted with humanId, lines with computed totals, payments stamped with shiftId; stock mock called once with resolved issue lines; returns `stockWarning: null`;
  2. `no_open_shift` when no open shift;
  3. `payment_mismatch` when Σ payments ≠ total (off by ≥ 0.01);
  4. `invalid_method` for a method not in settings;
  5. `zero_price` when a line has `unitPrice <= 0` — UNLESS the line's product genuinely has no catalog price and the input still says 0 (server rule: `unitPrice > 0` always required; the UI forces typing a price — test asserts the error);
  6. `invalid_tender` when a non-cash payment carries `tendered`, or cash `tendered < amount`;
  7. booking-linked service line (`bookingId` set) is EXCLUDED from stock resolution (stock mock receives no line for it);
  8. product line whose `finProductId` matches a `stk_items.finProductId` resolves 1:1 (qty = line qty); service line resolves via `stk_consumption` (qty = line qty × qtyPerUnit); unmapped lines resolve to nothing;
  9. stock mock throws `StockError('negative_stock')` → submitTicket still returns the ticket, with `stockWarning.code === 'negative_stock'` and the ticket row updated with `stock_warning`;
  10. voidTicket: happy path cancels the stock entry (mock `cancelEntry` called) and sets status void; throws `reconciled` when `invoiceProviderRef` set; throws `shift_closed` when its shift is closed; throws `already_void` on repeat.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Shape:

```ts
export async function submitTicket(ctx, input) {
  const settings = await getPosSettings(ctx);
  // ---- pure validation (throw PosError before any write) ----
  if (!input.lines.length) throw new PosError('ticket needs lines', 'no_lines');
  for (const l of input.lines) {
    if (!(l.qty > 0)) throw new PosError('invalid qty', 'invalid_qty');
    if (!(l.unitPrice > 0)) throw new PosError('line needs a price', 'zero_price');
  }
  for (const p of input.payments) {
    if (!settings.methods.includes(p.method)) throw new PosError(`unknown method ${p.method}`, 'invalid_method');
    if (p.method !== 'cash' && p.tendered != null) throw new PosError('tendered is cash-only', 'invalid_tender');
    if (p.method === 'cash' && p.tendered != null && p.tendered < p.amount) throw new PosError('tendered below amount', 'invalid_tender');
  }
  const lineTotals = input.lines.map((l) => round2(l.qty * l.unitPrice - (l.discount ?? 0)));
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const discount = round2(input.discount ?? 0);
  const total = round2(subtotal - discount);
  const paid = round2(input.payments.reduce((a, p) => a + p.amount, 0));
  if (Math.abs(paid - total) >= 0.01) throw new PosError(`paid ${paid} != total ${total}`, 'payment_mismatch');
  if (settings.requireCustomer && !input.partyId && !input.customerName)
    throw new PosError('customer required', 'customer_required');

  // ---- money tx ----
  const ticket = await withOrgCore(ctx, async (tx) => {
    const open = /* select open shift */; if (!open) throw new PosError('open a shift first', 'no_open_shift');
    const humanId = await nextSerialId(tx, ctx.tenantId, 'POS-.YYYY.-', new Date());
    /* insert ticket, lines (line_no = index, total = lineTotals[i]), payments (shiftId: open.id) — String() every numeric */
    await emitHubEvent(tx, { type: 'pos.ticket_submitted', orgId: ctx.tenantId, ticketId: row.id, total: String(total) });
    return row;
  });

  // ---- POST-COMMIT stock, fail-soft (mirrors scheduling-bookings.service.ts:299) ----
  let stockWarning: StockWarning | null = null;
  try {
    if (await isModuleEnabled(ctx, 'stock')) {
      const posted = await postTicketStock(ctx, ticket.id, input.actor);
      stockWarning = posted.stockWarning;
    }
  } catch (e) {
    console.error('[pos] post-commit stock failed', ticket.id, e);
    stockWarning = { code: 'stock_post_failed', message: e instanceof Error ? e.message : String(e) };
  }
  return { ticket, stockWarning };
}
```

  `postTicketStock` — the idempotent state machine (model on `realizeAccruals` in `stock-accruals.service.ts`, READ it):
  1. load ticket + lines (`not_found`; void → `already_void`); if `stockEntryId` already set → return it, clear warning;
  2. `findEntryBySource(ctx, 'pos', ticketId)`: submitted → stamp `stock_entry_id`, clear `stock_warning`, return; draft → try `submitEntry` (StockError → save+return warning with `draftEntryId`);
  3. none → resolve issue lines: batch-load `stk_items` where `finProductId in (product-line ids)` for 1:1, `stk_consumption` where `finProductId in (service-line ids WITHOUT bookingId)`; build `CreateIssueFromInvoiceLine[]` (1:1 → `{itemId, qty: lineQty}`; mapping → `{itemId, qty: lineQty * qtyPerUnit}`); empty → update ticket (`stock_entry_id: null`, `stock_warning: null`) and return `{entryId: null, stockWarning: null}`;
  4. `resolveDefaultWarehouse(ctx)` → null → warning `{code:'no_warehouse', message:'no default warehouse'}` (save + return);
  5. `createSourcedIssue(ctx, {source:'pos', sourceId: ticketId, warehouseId, lines, partyId: ticket.partyId, note: ticket.humanId, submit: true, actor, metadata:{ticketId}})` — StockError → warning (code = e.code, include `draftEntryId` if a draft was created); success → stamp `stock_entry_id` + clear warning.
  All ticket stamping via small `withOrgCore` updates. Every catch narrows: `e instanceof StockError` → warning; else rethrow to the caller's fail-soft catch.
  `voidTicket`: guards in order `not_found` → `already_void` → `reconciled` → load shift, closed → `shift_closed`; if `stockEntryId` → try `cancelEntry` (StockError → store `stock_warning {code:'void_stock_failed',...}` but PROCEED); update `{status:'void', voidedAt, voidedBy}`.

- [ ] **Step 4: Run → PASS**, then the whole pos+stock test set.

- [ ] **Step 5: Commit** `feat(pos): ticket submit/void + post-commit fail-soft stock issue` — stage the two files only.

---

### Task 5: pos.service — sellables (catalog point of entry)

**Files:**
- Modify: `src/server/services/pos.service.ts`
- Test: `src/server/services/pos.sellables.test.ts`

**Interfaces:**
- Consumes: `finProducts` table (`pg-finance-schema.ts`), `stkItems`, `stkConsumption`, `stkBins`; `upsertProduct` from `finance-products.service.ts` (read its signature at line 26 — reuse, don't reimplement); `createItem`, `updateItem`, `setConsumption` from `stock.service.ts`.
- Produces:

```ts
export interface SellableRow { productId: string; code: string; name: string; category: string | null; unitPrice: number | null; active: boolean; kind: 'product' | 'service'; itemId: string | null; stockQty: number | null; hasMapping: boolean; }
export async function listSellables(ctx: CoreCtx): Promise<SellableRow[]>;
export interface SellableInput { name: string; code?: string; category?: string | null; unitPrice: number | null; kind: 'product' | 'service'; trackStock?: boolean; uom?: string; consumption?: Array<{ itemId: string; qtyPerUnit: number }>; active?: boolean; }
export async function createSellable(ctx: CoreCtx, input: SellableInput, actor: Actor): Promise<SellableRow>;
export async function updateSellable(ctx: CoreCtx, productId: string, patch: Partial<SellableInput>, actor: Actor): Promise<SellableRow>;
```

- [ ] **Step 1: Failing tests**: list merges product+item+bins+mapping flags correctly (kind = 'product' iff a linked `stk_items` row exists); createSellable service-kind writes product only; product-kind with `trackStock` writes product + item with `finProductId` link (code reused, uom passed); consumption array → `setConsumption` per row; code collision → surfaces the underlying unique-violation as `PosError('code_taken')`; auto-code when absent (slugified name uppercased, e.g. `BOTOX 50U` → `BOTOX-50U`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** `listSellables`: one query — products left join items on `finProductId`, left join lateral Σ `stk_bins.qty` by itemId, `exists` subquery on `stk_consumption`. `createSellable`: sequential ctx-level calls (product first via `upsertProduct`, then item `createItem` + `updateItem` to set `finProductId` if createItem's input doesn't accept it — check `NewItemInput`), then `setConsumption` rows; NOT one giant tx (withOrgCore no-nest — same reason as accruals; a failed item create after product create is acceptable, the wizard is re-runnable because `upsertProduct` upserts on code). `updateSellable`: patch product fields; `consumption` array when present = replace-set (delete mappings for product not in array via `deleteConsumption`, upsert the rest).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `feat(pos): sellables merged catalog + cross-module create wizard`.

---

### Task 6: RBAC + nav + module wiring (the required-build-step checklist)

**Files:**
- Modify: `src/server/services/rbac.service.ts` (MODULES ~line 38, MODULE_LABELS ~79, BUSINESS_MODULES ~91, defaultCaps ~142, API_WRITE_PREFIXES ~917)
- Modify: `src/lib/permissions.ts` (ROUTE_VIEW_PERMS ~165, MODULE_SUBRESOURCES ~82)
- Modify: `src/server/services/permissions.service.ts` (capsToLegacyPermissions, ~lines 32-86)
- Modify: `src/lib/access/policy.ts` (BASE_ACCESS map)
- Modify: `src/lib/components/layout/sections.ts` (BUILTIN_PLUGIN_ITEMS ~line 146)
- Modify: `src/lib/components/layout/GNav.svelte` (CHORD_DEFS ~line 18)
- Test: extend `src/server/services/rbac.service.test.ts` ONLY IF it is not in the do-not-stage list — it IS in the historical do-not-stage list but that RBAC work has landed (commit 9232a357); verify with `git log --oneline -1 -- src/server/services/rbac.service.test.ts` that it's committed and the working copy is clean before touching. If dirty, put the new assertions in a NEW file `src/server/services/pos.rbac.test.ts` instead.

**Interfaces:**
- Produces: capability domain `pos` with actions view/create/edit/delete/export/manage; sub-resource view keys `pos.sell` / `pos.appointments` / `pos.items` / `pos.refills`; central write gate on `/api/pos`; nav item + `G,P` chord.

- [ ] **Step 1: Read each target site first** (the exact shape matters — these are lookup tables other code iterates):
  - Add `'pos'` to `MODULES` and `BUSINESS_MODULES`; `MODULE_LABELS['pos'] = 'Point of Sale'`.
  - `defaultCaps`: mirror how an existing business module (e.g. `stock`) branches per role, with: owner/admin → all six true; manager → view/create/edit/export/manage true, delete false; staff → view/create/edit true, rest false; viewer → view only.
  - `API_WRITE_PREFIXES`: add `['/api/pos', 'pos']`.
  - `permissions.ts`: `ROUTE_VIEW_PERMS['/pos'] = 'pos:view'`; `MODULE_SUBRESOURCES` add:

```ts
pos: [
  { key: 'pos.sell', route: '/pos/sell' },
  { key: 'pos.appointments', route: '/pos/appointments' },
  { key: 'pos.items', route: '/pos/catalog' },
  { key: 'pos.refills', route: '/pos/refills' },
],
```

  (match the EXACT entry shape of the existing `crm` sub-resources — read them; if entries carry labels, add labels `Sell / Appointments / Catalog / Refills`.)
  - `permissions.service.ts` `capsToLegacyPermissions`: ensure `pos:*` action perms and `pos.<sub>:view` perms are emitted — read how `crm.insights` flows through and mirror. If module→perm emission is generic (iterates MODULES), verify `pos` rides for free and only sub-resources need adding.
  - `policy.ts`: `'pos.view': { permission: 'pos:view' }` in the same block as other business modules.
  - `sections.ts` `BUILTIN_PLUGIN_ITEMS`: add (import `Store` from `@lucide/svelte`):

```ts
{ href: '/pos', label: m.nav_pos(), icon: Store, matcher: (p) => p.startsWith('/pos'), requires: 'pos.view' },
```

  (match the real `SectionItem` fields — read two neighbors; the label goes through Paraglide: add `nav_pos` = "Point of Sale" / es "Punto de venta".)
  - `GNav.svelte` `CHORD_DEFS`: add `{ key: 'P', path: '/pos' }` following the existing entry shape (P is unclaimed; verify by reading the list).

- [ ] **Step 2: Tests** — in the chosen test file, assert: `apiWriteCapability('/api/pos/tickets', 'POST')` → `{module:'pos', action:'edit'}`; `apiWriteCapability('/api/pos/tickets/x/void', 'DELETE')` → delete; `defaultCaps('staff','pos')` has create+edit but not manage; `defaultCaps('viewer','pos')` view-only.

- [ ] **Step 3:** `bun run i18n:compile && bun run check` → 0/0; run the rbac tests.

- [ ] **Step 4: Commit** `feat(pos): RBAC domain + per-flow sub-resources + nav wiring` — stage exactly the six modified files + test file.

---

### Task 7: REST routes `/api/pos/*`

**Files:**
- Create: `src/routes/api/pos/_errors.ts` — `handlePosError(e): never`
- Create: `src/routes/api/pos/settings/+server.ts` (GET, PUT)
- Create: `src/routes/api/pos/shifts/+server.ts` (GET) · `shifts/current/+server.ts` (GET) · `shifts/open/+server.ts` (POST) · `shifts/close/+server.ts` (POST)
- Create: `src/routes/api/pos/tickets/+server.ts` (GET, POST) · `tickets/[id]/+server.ts` (GET) · `tickets/[id]/void/+server.ts` (POST) · `tickets/[id]/post-stock/+server.ts` (POST)
- Create: `src/routes/api/pos/sellables/+server.ts` (GET, POST) · `sellables/[id]/+server.ts` (PATCH)

**Interfaces:**
- Consumes: every pos.service export from Tasks 3-5; `getCoreCtx(locals)`; `requireAuth`; `requireOrgCapability(locals,'pos','manage')` for settings PUT / shifts close / ticket void; `isModuleEnabled(ctx,'pos')` on every GET (404 when disabled — writes are 404'd too, check first).
- Produces (UI tasks depend on these wire shapes):
  - `POST /api/pos/tickets` body `{lines, payments, partyId?, crmContactId?, customerName?, discount?, note?}` → `{ok:true, ticket, stockWarning}` (201); PosError → 400/409 json `{error, code}`.
  - `POST /api/pos/shifts/open` `{openingFloat}` → `{ok:true, shift}`; `POST /api/pos/shifts/close` `{counted, note?}` → `{ok:true, shift}`.
  - `GET /api/pos/shifts/current` → `{shift, summary} | {shift:null}`.
  - `GET /api/pos/sellables` → `{sellables: SellableRow[]}`; `POST` `{...SellableInput}` → `{ok:true, sellable}`; `PATCH /api/pos/sellables/[id]` → `{ok:true, sellable}`.
  - `POST /api/pos/tickets/[id]/post-stock` → `{ok:true, entryId, stockWarning}`.

- [ ] **Step 1:** Read `src/routes/api/stock/_errors.ts` and one stock route (`entries/from-service/+server.ts`) — mirror their zod parsing, `getCoreCtx`, error handling exactly. `handlePosError` mapping: `not_found` → 404; `no_open_shift`/`shift_already_open`/`shift_closed`/`already_void`/`reconciled`/`duplicate_source` → 409; everything else (`payment_mismatch`, `zero_price`, `invalid_*`, `no_lines`, `code_taken`, `customer_required`, `invalid_methods`) → 400. Re-throw non-PosError.

- [ ] **Step 2:** Implement all routes. Zod schemas inline per route (numbers `z.number().finite()`, methods `z.string().min(1).max(40)`, lines array `.min(1)`, ids `z.string().uuid()` where applicable). Every handler: `requireAuth(locals)` → `getCoreCtx` → module check → service call in try/catch `handlePosError`. Central hooks gate covers write capability; the three manage-level routes ALSO call `requireOrgCapability(locals,'pos','manage')`.

- [ ] **Step 3:** `bun run check` → 0/0. Manual smoke: `bun run dev` + curl the GETs (expect 401/302 unauthenticated — confirms routing resolves).

- [ ] **Step 4: Commit** `feat(pos): /api/pos REST surface (settings, shifts, tickets, sellables)`.

---

### Task 8: Scheduling walk-in overrides (`forceResourceId` + `overrideConflicts`)

**Files:**
- Modify: `src/server/services/scheduling-bookings.service.ts` (`CreateBookingInput` + `createBooking` ~line 184)
- Modify: `src/routes/api/scheduling/bookings/+server.ts` (POST body schema passthrough)
- Test: extend `src/server/services/scheduling-bookings-accrual.test.ts`'s SIBLING — create `src/server/services/scheduling-bookings-override.test.ts`

**Interfaces:**
- Consumes: existing `createBooking` internals (candidate gathering, `computeSlots`, resource pick).
- Produces: `CreateBookingInput` gains `forceResourceId?: string` and `overrideConflicts?: boolean`. Semantics (spec D-decision 6): `forceResourceId` narrows candidates to exactly that resource — if it has no matching free slot → `SlotUnavailableError` (no silent reassign). `overrideConflicts` requires `forceResourceId` (else `PosError`-equivalent: plain `Error('overrideConflicts requires forceResourceId')` mapped to 400 by the route) and skips slot computation entirely: validate event type + resource exists/active, book at `input.start` verbatim. NEVER exposed on the public route.

- [ ] **Step 1: Failing tests:** (a) `forceResourceId` with that resource busy at the slot → rejects even though another assignee is free; (b) `overrideConflicts` books at an off-hours time (no slots at all) with the forced resource; (c) `overrideConflicts` without `forceResourceId` → throws; (d) existing default path unchanged (no new inputs → same behavior; reuse an existing green test as the guard).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** inside `createBooking`'s tx: when `forceResourceId` set, filter `candidates` to it BEFORE slot computation and skip the least-loaded fallback (picked = forced or throw `SlotUnavailableError`). When `overrideConflicts && forceResourceId`: skip `computeSlots`/exact-start match entirely; still compute `end`, still run CRM-contact + accrual logic untouched. Route: add both fields to the zod schema (`forceResourceId: z.string().uuid().optional()`, `overrideConflicts: z.boolean().optional()`) and pass through. Public `publicBook` gets NOTHING.

- [ ] **Step 4: Run → PASS** (`scheduling-bookings-override.test.ts` + existing scheduling tests).

- [ ] **Step 5: Commit** `feat(scheduling): forceResourceId + overrideConflicts for front-desk walk-ins`.

---

### Task 9: UI shell — `/pos` layout, PosNav, shift banner

**Files:**
- Create: `src/routes/(app)/pos/+layout.server.ts`, `+layout.svelte`
- Create: `src/routes/(app)/pos/+page.server.ts` (redirect to first visible tab)
- Create: `src/lib/components/pos/PosNav.svelte`, `src/lib/components/pos/ShiftBanner.svelte`
- Modify: `messages/en.json`, `messages/es.json` (all shell keys)

**Interfaces:**
- Consumes: `isModuleEnabled`, `getOpenShift`, `canViewPath`/`canAct` from `$lib/access/can.svelte`, `Modal`, `toastAsync`, routes from Task 7.
- Produces: layout `data` = `{ stockEnabled, schedulingEnabled, openShift: {shift, summary} | null, posSettings }` (children read via `page.data`); `ShiftBanner` emits nothing — it self-manages open/close dialogs against `/api/pos/shifts/*` then `invalidate('pos:shift')` (register the dependency with `depends('pos:shift')` in the layout load).

- [ ] **Step 1:** `+layout.server.ts` — read `(app)/scheduling/+layout.server.ts` first, mirror: `isModuleEnabled(ctx,'pos')` → `error(404, 'POS module disabled')`; load `stockEnabled`, `schedulingEnabled` (via `isModuleEnabled`), `getPosSettings`, `getOpenShift` (wrap in try/catch → null); `depends('pos:shift')`.
- [ ] **Step 2:** `+layout.svelte` — mirror `(app)/crm/+layout.svelte`: `<PosNav />` + shift banner + `{@render children()}`.
- [ ] **Step 3:** `PosNav.svelte` — mirror `CrmNav.svelte` verbatim including the `.filter((i) => canViewPath(i.href))` gate. Items: `/pos/sell` (m.pos_nav_sell), `/pos/appointments` (hidden when `!page.data.schedulingEnabled`), `/pos/catalog`, `/pos/refills` (hidden when `!page.data.stockEnabled`).
- [ ] **Step 4:** `ShiftBanner.svelte` — states: (a) no open shift → amber strip + "Open shift" button (gated `canAct('pos','create')`) → Modal with one number input per `posSettings.methods` (float, default 0, only cash usually non-zero) → POST open; (b) open → subtle strip: opener name/time, live per-method totals from `summary.byMethod`, ticket count, and (gated `canAct('pos','manage')`) "Close shift" → Modal listing per method `expected` (from a fresh GET of `shifts/current`) vs `counted` inputs vs live difference, note field → POST close; (c) shift open > 16h → additional warning chip (m.pos_shift_stale). All fetches via `toastAsync`; success → `invalidate('pos:shift')`.
- [ ] **Step 5:** `+page.server.ts` at `/pos`: `redirect(302, '/pos/sell')` — but if the user lacks `pos.sell:view` the layout guard on the target will 403; instead compute the first sub-route the user can view server-side (read how `requiredViewPermForPath` + the permissions list are exposed to loads in `(app)/+layout.server.ts`) and redirect there; no viewable sub-tab → `error(403)`.
- [ ] **Step 6:** i18n keys (both langs): `nav_pos`, `pos_nav_sell` (es "Vender"), `pos_nav_appointments` ("Citas"), `pos_nav_catalog` ("Catálogo"), `pos_nav_refills` ("Reposición"), `pos_shift_open_cta` ("Abrir caja"), `pos_shift_close_cta` ("Cerrar caja"), `pos_shift_float` ("Fondo inicial"), `pos_shift_expected` ("Esperado"), `pos_shift_counted` ("Contado"), `pos_shift_difference` ("Diferencia"), `pos_shift_stale` ("Caja abierta hace más de 16 h"), `pos_shift_open_since` ("Caja abierta desde {time} por {name}"). Run `bun run i18n:compile`.
- [ ] **Step 7:** `bun run check` → 0/0; `bun run dev` visual smoke of `/pos` (redirect + banner render).
- [ ] **Step 8: Commit** `feat(pos): module shell — layout gate, PosNav, shift banner + open/close dialogs`.

---

### Task 10: UI — Sell tab

**Files:**
- Create: `src/routes/(app)/pos/sell/+page.server.ts`, `+page.svelte`
- Create: `src/lib/components/pos/SellCart.svelte`, `src/lib/components/pos/PaymentPanel.svelte`, `src/lib/components/pos/CustomerPicker.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `listSellables` (server load), `searchParties` (grep its existing API route or expose via load), `POST /api/pos/tickets` wire shape from Task 7, `page.data.openShift`/`posSettings` from Task 9, `toastAsync`, `Badge`, `Combobox`, `createHotkey`.
- Produces: nothing downstream — leaf UI.

- [ ] **Step 1:** `+page.server.ts`: guard `requiredViewPermForPath` handles view centrally (Task 6) — load `{ sellables: listSellables(ctx) }` and pass through `stockEnabled`. Also load the last 10 tickets (`listTickets(ctx,{limit:10})`) for a "recent sales" footer with void buttons (gated manage). Also load `listShifts(ctx,{limit:10})` for a collapsible "Shifts" history section under the recent-sales footer (per-shift: opened/closed times, expected vs counted per method with difference Badges — success when |diff|<0.01, warning otherwise).
- [ ] **Step 2:** `+page.svelte` layout: two-column grid (catalog left, cart right; single column stacked under `lg`). Catalog: search input auto-focused (hotkey `/` via `createHotkey('/', focusSearch, () => ({enabled: !modalOpen}))`), category chips derived from `new Set(sellables.map(s => s.category ?? 'uncategorized'))`, card grid filtered by search (name/code `includes`, lowercase) + active chip. Card: name, price (or "—" for null price), stock pill when `kind==='product' && stockQty != null` (Badge semantic: success >10, warning 1-10, error ≤0). Click → `addLine(sellable)`.
- [ ] **Step 3:** `SellCart.svelte` — props `{ lines: $bindable, settings, onchange }`. Cart state lives in the page as `let lines = $state<CartLine[]>([])` where `CartLine = { sellable: SellableRow; qty: number; unitPrice: number | null; discount: number }`; persists to `localStorage['pos-cart-<orgId>']` via `$effect` and restores on mount. Row: description, qty stepper (min 1), price input — read-only unless (`unitPrice == null` originally) or (`settings.allowPriceOverride && canAct('pos','manage')`), line discount, remove. Totals: all math integer-cents (`Math.round(x*100)`), display via `(cents/100).toFixed(2)`. Zero/null price rows highlighted with m.pos_price_required; Charge disabled while any line priceless.
- [ ] **Step 4:** `CustomerPicker.svelte` — Combobox searching `/api/crm/contacts?` OR the party search endpoint (READ how `(app)/scheduling/bookings/+page.svelte` does contact search ~its Modal section and reuse that exact endpoint + shape); selected → chip with name+phone + clear ✗; "quick create" inline expansion: name + phone inputs (no server call — the ticket carries `customerName`; party linkage is a follow-up). Required-gate: when `settings.requireCustomer` and nothing set → Charge disabled with tooltip.
- [ ] **Step 5:** `PaymentPanel.svelte` — props `{ total: number, methods: string[], payments: $bindable }`. Method buttons; tapping adds `{method, amount: remaining}` row (editable amount); cash row extra `tendered` input showing `change = tendered − amount` when positive; remaining/`change` strip; over-allocation clamps. Emits validity (`Σ == total`).
- [ ] **Step 6:** Submit flow: build body (lines: kind/finProductId/description/qty/unitPrice/discount; payments), `toastAsync` POST; on `ok`: toast success with `ticket.humanId`; if `stockWarning` → persistent warning toast + banner row above cart with m.pos_stock_warning + "Post stock now" button → POST `tickets/[id]/post-stock`, update banner on result. Clear cart + localStorage. On 409 `no_open_shift` → open the ShiftBanner's open-dialog (simplest: toastError m.pos_no_open_shift telling them to open from the banner). Recent-sales footer rows: humanId, time, total, customer, stock chip (✓ entry link `/stock/entries/[id]` / ⚠ warning), void button (manage) → POST void + confirm dialog.
- [ ] **Step 7:** i18n (both langs): `pos_sell_search_placeholder` ("Buscar producto o servicio…"), `pos_sell_charge` ("Cobrar"), `pos_sell_change` ("Vuelto"), `pos_sell_tendered` ("Recibido"), `pos_sell_remaining` ("Falta"), `pos_price_required` ("Falta precio"), `pos_stock_warning` ("Venta registrada; stock pendiente: {message}"), `pos_post_stock_retry` ("Registrar stock ahora"), `pos_no_open_shift` ("Abre la caja para vender"), `pos_customer_required` ("Selecciona un cliente"), `pos_recent_sales` ("Ventas recientes"), `pos_void` ("Anular"), `pos_void_confirm` ("¿Anular esta venta? Revierte el stock."). Compile.
- [ ] **Step 8:** `bun run check` 0/0 + browser smoke (add items, split payment math, submit against dev DB).
- [ ] **Step 9: Commit** `feat(pos): Sell tab — catalog grid, cart, split tender, fail-soft stock`.

---

### Task 11: UI — Appointments tab

**Files:**
- Create: `src/routes/(app)/pos/appointments/+page.server.ts`, `+page.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: EVERYTHING from `(app)/scheduling/bookings/` — READ `+page.server.ts` + `+page.svelte` there top to bottom first. This task is a focused re-composition, not new machinery: same endpoints (`/api/scheduling/slots`, `POST /api/scheduling/bookings`, `PATCH /api/scheduling/bookings/[id]`, `POST .../complete`, `/api/stock/accruals/preview`), same `accrualSummaryForSources` chips, same complete-dialog-with-gauges pattern, plus Task 8's `forceResourceId`/`overrideConflicts`.

- [ ] **Step 1:** `+page.server.ts`: 404 if `!schedulingEnabled`; load bookings windowed TODAY 00:00 → +7d (`listBookings`), event types (with productId), resources (active staff), `accrualSummaryForSources` for the ids, `stockEnabled`.
- [ ] **Step 2:** `+page.svelte`: header with Today/+7d toggle (client filter). List grouped by day: time, event-type title, resource name, attendee (name+phone), status Badge, accrual chip (copy the exact chip logic from scheduling bookings page), actions for accepted/pending gated `canAct('pos','edit')`: ✓ complete (reuse the complete-dialog: if summary has open accruals → dialog with `ConsumptionGauge` lines from `/api/stock/accruals/preview` with `excludeSource`, POST `/complete` with lines; else one-click POST `/complete`), no-show, cancel (PATCH). stockWarning from complete → inline banner + retry re-POST `/complete` (idempotent).
- [ ] **Step 3:** "New appointment" Modal — copy the scheduling bookings create-modal wholesale then add the walk-in extras: staff `Select` (resources; optional "anyone") mapping to `forceResourceId` when chosen; when a date+service is picked and NO slots return (or the desired time is off-grid), show an "override availability" section (visible only when a staff member is forced): time input + checkbox m.pos_walkin_override → sends `overrideConflicts: true` + exact `start`. Keep the consumption gauges section as-is.
- [ ] **Step 4:** i18n: `pos_appt_today` ("Hoy"), `pos_appt_week` ("7 días"), `pos_appt_new` ("Nueva cita"), `pos_walkin_override` ("Forzar fuera de horario (walk-in)"), `pos_appt_staff_any` ("Cualquier profesional"). Compile.
- [ ] **Step 5:** check 0/0 + browser smoke (create walk-in with override on dev).
- [ ] **Step 6: Commit** `feat(pos): Appointments tab — front-desk booking with walk-in overrides`.

---

### Task 12: UI — Catalog tab

**Files:**
- Create: `src/routes/(app)/pos/catalog/+page.server.ts`, `+page.svelte`
- Create: `src/lib/components/pos/SellableWizard.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `listSellables` (load), `POST/PATCH /api/pos/sellables`, DataTable (`$lib/components/data-table/DataTable.svelte` — read `(app)/stock/items/+page.svelte` for the canonical usage incl. `canEdit`/`onSaveRow`/`onAdd`), `listItems` from stock (for the consumption mapping editor), `canAct`.
- Produces: none.

- [ ] **Step 1:** `+page.server.ts`: `{ sellables: listSellables(ctx), stockItems: stockEnabled ? listItems(ctx) : [] }`.
- [ ] **Step 2:** `+page.svelte`: DataTable columns — name, code, category (editable), unitPrice (editable, numeric), kind Badge, stockQty (only when stockEnabled; product rows), hasMapping dot, active Toggle-in-cell (via the `cell` snippet switch pattern — see `shared-datatable-component` conventions: ONE `cell` snippet with a `col.key` switch). `canEdit={canAct('pos','edit')}`, `onSaveRow` PATCHes `sellables/[id]` with the edited fields, `onAdd` opens the wizard, `addDisabled={!canAct('pos','create')}`.
- [ ] **Step 3:** `SellableWizard.svelte` (Modal): fields name, code (auto-suggest slug of name, editable), category (Combobox over existing categories, free entry), price, kind toggle service/product; product+stockEnabled → uom input + "track stock" Toggle; service+stockEnabled → consumption rows editor (Select stock item + qtyPerUnit, add/remove). Submit POST → toast, `invalidate` the page load. Also opens pre-filled in edit mode (PATCH).
- [ ] **Step 4:** i18n: `pos_catalog_new` ("Nuevo producto/servicio"), `pos_catalog_kind_service` ("Servicio"), `pos_catalog_kind_product` ("Producto"), `pos_catalog_track_stock` ("Controlar stock"), `pos_catalog_consumption` ("Consumo de insumos"), `pos_catalog_qty_per_unit` ("Cant. por unidad"), `pos_catalog_code_taken` ("Ese código ya existe"). Compile.
- [ ] **Step 5:** check 0/0 + smoke (create a service with mapping; verify it appears in `/stock/consumption` too — proves the cross-module write).
- [ ] **Step 6: Commit** `feat(pos): Catalog tab — merged sellables table + cross-module wizard`.

---

### Task 13: UI — Refills tab

**Files:**
- Create: `src/routes/(app)/pos/refills/+page.server.ts`, `+page.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `listItems`, `listWarehouses`, `resolveDefaultWarehouse`, `getRecentLedger`/`listEntries` (recent receipts), EXISTING stock endpoints — `POST /api/stock/entries` (create draft, type `receipt`, line `{itemId, qty, uom, rate, toWarehouseId}`) then `POST /api/stock/entries/[id]/submit`; read `(app)/stock/entries/new/+page.svelte` for exact body shapes. `PartyPicker` (grep its path from `(app)/stock/consume/+page.svelte`).

- [ ] **Step 1:** `+page.server.ts`: 404 if `!stockEnabled` (page-level `bothEnabled(ctx,'pos','stock')`); load items, warehouses, default warehouse id, recent receipt entries (`listEntries(ctx,{type:'receipt'})` first 10 + their totals).
- [ ] **Step 2:** `+page.svelte`: single Card form — item Combobox, qty number, unit-cost number (required, hint m.pos_refill_cost_hint), supplier PartyPicker (optional), warehouse Select (preselected default), note. Submit (gated `canAct('pos','create')`): create entry → submit entry → success toast with humanId → prepend to recent list + reset form. Errors via the stock error json (`negative_stock` impossible for receipts; surface `warehouse_not_found` etc. verbatim). Recent receipts list: humanId link → `/stock/entries/[id]`, item summary, qty, value (qty×rate), date.
- [ ] **Step 3:** i18n: `pos_refill_title` ("Registrar reposición"), `pos_refill_cost_hint` ("Costo unitario de compra — alimenta el costo promedio"), `pos_refill_supplier` ("Proveedor"), `pos_refill_submit` ("Registrar ingreso"), `pos_refill_recent` ("Ingresos recientes"). Compile.
- [ ] **Step 4:** check 0/0 + smoke (post a receipt on dev; verify bin qty rises on `/stock/items/[id]`).
- [ ] **Step 5: Commit** `feat(pos): Refills tab — front-desk receipt entry`.

---

### Task 14: Gateway agent surface

**Files:**
- Create: `src/routes/api/gateway/query/pos/+server.ts` (GET)
- Create: `src/routes/api/gateway/actions/pos-sale/+server.ts` (POST)

**Interfaces:**
- Consumes: `requireAssistantCapability(locals, url, 'pos', 'view'|'edit')` from `src/routes/api/gateway/_shared/action-auth.ts` (read `actions/booking-complete/+server.ts` — Task 8 of the accruals plan built it; mirror its confirm/preview pattern and fail-soft parity EXACTLY), pos.service exports.
- Produces: `query/pos?mode=sellables|shift|tickets` → respective service reads; `actions/pos-sale` body `{lines, payments, customerName?, confirm?}` — `confirm !== true` → preview response `{preview: {total, lines, openShift: bool}}`; confirmed → `submitTicket` with `actor` from `agentActor(principalId)`, response `{ok:true, ticketId, humanId, stockWarning}` with PosError degraded to `{ok:false, error, code}` (agents must never get a raw 500 for business rules).

- [ ] **Step 1:** Read the two booking gateway routes; implement both files mirroring structure, zod, and error style. Cap checks: query → `'view'`; action → `'edit'`.
- [ ] **Step 2:** `bun run check` 0/0.
- [ ] **Step 3: Commit** `feat(pos): gateway agent surface — query/pos + actions/pos-sale`.

---

### Task 15: Green sweep + docs

**Files:**
- Modify: `.superpowers/sdd/progress.md` (ledger — create if the SDD run didn't)
- No source changes expected beyond fixes.

- [ ] **Step 1:** `bun run i18n:compile && bun run check` → MUST be 0 errors 0 warnings.
- [ ] **Step 2:** `bun run test` — full suite. Known isolation-passing timeout flakes (aci-backend, syntax-validator, audit-coverage) may fail under the full run; re-run each failing file in isolation and treat isolated-pass as green. ANY other failure is yours — fix it.
- [ ] **Step 3:** `bun run build` — must succeed (watch for the `+server.ts` non-handler-export trap).
- [ ] **Step 4:** Update the ledger with per-task commit SHAs; note deliberate v1 exclusions (returns, partial payment, SUSII auto-reconcile, party quick-create linkage in CustomerPicker).
- [ ] **Step 5: Commit** `chore(pos): green sweep + SDD ledger`.

---

## Execution notes for the orchestrator (not the subagents)

- Task order: 1 → 2 → {3,6,8 parallelizable} → 4 → 5 → 7 → 9 → {10,11,12,13 sequential to avoid messages/*.json collisions} → 14 → 15. Tasks touching `messages/en.json`/`es.json` must NOT run concurrently.
- The migration `20260707120000_pos.sql` is applied by the ORCHESTRATOR (psql via SUPABASE_DB_URL from `.env.local`, strip `--> statement-breakpoint` if present) — also rides the `hub_migrations` Vercel build ledger once committed. Apply to prod before promoting master, exactly like the accruals rollout.
- Review loop per task: sonnet implementer → review package (BASE = previous task's commit or interleaved foreign commit) → sonnet reviewer → fix agent → SendMessage re-review. Opus whole-branch final review before merge.
- Never stage the other-session WIP files listed in Global Constraints.
