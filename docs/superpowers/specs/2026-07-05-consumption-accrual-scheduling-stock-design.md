# Consumption Accrual System — scheduling ↔ stock (potential vs real spend)

**Repo:** minion_hub (`dev`). Extends the P5 stock line (`specs/hub-erp-roadmap/P5-stock-module.md`, `P5.1-stock-interconnect-seed.md`) and the P5.1b UOM/gauge work. Builds directly on the invoice-free service-consumption flow shipped in `3cda82ea` (`/stock/consume`, `buildServiceIssuePreview`/`createServiceIssue`, `ConsumptionGauge`).

## Goal

Let a sales / point-of-sale operator run the appointment → service → stock flow **without leaving the scheduling module**, and give the business a first-class view of **committed (potential) material spend vs realized (real) spend**.

Today the pieces exist but are disconnected: an appointment snapshots its `product_id`, the product maps to stock via `stk_consumption`, and `/stock/consume` can issue that stock — but only as a separate trip through the Stock module, re-entering the same service and customer. Nothing records that a booked-but-not-yet-performed service *will* consume stock.

The fix is an **accrual (commitment) ledger** parallel to the real stock ledger. Expected consumption is accrued when a service is booked; it is realized (posted to the real ledger) when the booking completes, or released when it is cancelled.

## Current-state facts that constrain the design

- `sched_event_types.product_id` → `fin_products` (soft bridge). `sched_bookings` snapshots `product_id`, `party_id`, `crm_contact_id`, and has status `accepted | pending | cancelled | rejected | completed | no_show`.
- `stk_consumption` maps `fin_product_id → stk_items × qty_per_unit` (consumption uom). `stk_items` carry `uom`, `consumption_uom`, `units_per_stock_uom`, `subunits_per_stock_uom`, `diagram_enabled` (P5.1b).
- The real stock ledger is append-only; `submitEntry` is the only writer (FOR UPDATE locking + moving-average valuation); `stk_bins` is a rebuildable cache. `createServiceIssue(submit:false)` makes a draft; `submitEntry` posts it.
- Booking lifecycle writer is `setBookingStatus(ctx, id, status)`; creator is `createBooking(ctx, input)`. Booking → Sales Order already exists (`createOrderFromBooking`, idempotent) and stays a **separate** action — payment/invoicing is out of scope here.
- Invoices are SUSII-sync-only; never write `fin_*` from stock. The invoice↔stock link lives in `stk_entries.metadata`. The booking↔stock link follows the same pattern (`metadata.source='booking'`).
- Org-scoping: every new table rides `withOrgCore` + `app.current_org_id` GUC + `app_ledger` grants + forced RLS, exactly like `20260702130000_stock.sql`.

## Design decisions (settled)

1. **Deduct on completion.** Booking only accrues; the real ledger moves when status → `completed`. Cancel/no-show never deducts.
2. **Adjust inline at creation.** After the service is picked, the New-appointment modal shows the consumption gauges pre-filled from defaults, adjustable in place; the adjusted amounts become the open accrual.
3. **Accrual ledger reconciles the two earlier approaches:** expected consumption is a first-class record (a draft-entry's paper trail) *without* polluting the real stock ledger (which stays actual-movements-only).
4. **Track qty AND value.** Estimate value at accrual-time moving-average cost; realize at completion-time cost; variance captures both quantity change and cost drift.
5. **Available-to-promise: warn, don't block.** Booking past committed+available stock warns but proceeds. Hard-blocking is a later opt-in.
6. **Generic source.** `source`/`source_id` so a future sales order can also accrue; only the `booking` source is wired now (YAGNI on the rest).

## D1 — Migration `supabase/migrations/<ts>_stock_accruals.sql`

```
stk_accruals (
  id                uuid pk default gen_random_uuid(),
  org_id            text not null,
  source            text not null,              -- 'booking' (future: 'order')
  source_id         uuid not null,              -- e.g. sched_bookings.id
  fin_product_id    uuid,                       -- the service that drove it (reporting)
  item_id           uuid not null references stk_items(id) on delete cascade,
  warehouse_id      uuid not null references stk_warehouses(id) on delete restrict,
  qty_consumption   numeric not null,           -- expected, consumption uom
  qty               numeric not null,           -- expected, stock uom (converted)
  est_unit_cost     numeric not null default 0, -- moving-avg cost at accrual time
  est_value         numeric not null default 0, -- qty * est_unit_cost = potential spend
  status            text not null default 'open', -- 'open' | 'realized' | 'released'
  realized_entry_id uuid,                        -- the posted stk_entries.id
  realized_qty      numeric,                     -- actual stock-uom qty posted
  realized_value    numeric,                     -- actual valuation posted
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  realized_at       timestamptz,
  released_at       timestamptz,
  unique (org_id, source, source_id, item_id)   -- one accrual per source-item (upsert on adjust)
)
indexes: (org_id, status), (org_id, item_id, warehouse_id, status), (source, source_id)
```
org_guc RLS + `app_ledger` grants exactly like `20260702130000_stock.sql`. Drizzle table in `pg-schema/stock.ts` (`stkAccruals`). Same migration: `alter table stk_warehouses add column is_default boolean not null default false` + partial unique index `stk_warehouses_default_one_per_org on (org_id) where is_default`. Orchestrator applies to prod (surgical SQL — never `drizzle-kit push`).

## D2 — Service layer (new file `stock-accruals.service.ts` + small `stock.service.ts` changes)

All reuse existing pure fns (`consumptionToStockQty`, `round4`) and the P5.1b preview.

**Transaction shape (load-bearing).** `withOrgCore` does NOT nest — every call opens a fresh `db.transaction` (`with-org-core.ts`), and `scheduling-bookings.service.ts` explicitly avoids nesting it. Therefore:

- `accrue` and `release` ship as **tx-level cores** — `accrueConsumptionTx(tx, orgId, …)`, `releaseAccrualsTx(tx, orgId, source, sourceId)` — callable from inside `createBooking`/`setBookingStatus`'s existing tx (atomic with the booking write). Thin `ctx` wrappers (`accrueConsumption(ctx, …)` = `withOrgCore` + core) serve the standalone API routes.
- `realizeAccruals` **must NOT run inside another tx**: it calls `createServiceIssue` → `submitEntry`, each of which opens its own `withOrgCore`. Completion is a two-step sequence (status tx, then realize), not one tx — see D3 for the failure semantics that makes this safe.

Functions:

- **`buildAccrualPreview(ctx, {finProductId, quantity, warehouseId, excludeSource?})`** — thin wrapper over `buildServiceIssuePreview` that stamps per line: `estUnitCost`/`estValue` from the current bin moving-avg rate (extend `previewLinesForItemQtys` to also select `stk_bins.valuation_rate`), and `committedOther` = Σ open-accrual qty for (item, warehouse) excluding `excludeSource` — so the booking modal renders the ATP warning (`qty > available − committedOther`) with zero extra round-trips. Returns gauge-ready lines + `hasMapping`. Used by the booking modal (creation) and the completion dialog.
- **`accrueConsumptionTx(tx, orgId, {source, sourceId, finProductId, warehouseId, lines?})`** — when `lines` absent, computes defaults from `stk_consumption` (quantity=1 for bookings); upserts `open` accrual rows on `(org, source, sourceId, item)`, deletes open rows no longer present. Idempotent: re-adjusting replaces the open set; rows already `realized`/`released` are never touched. Never touches the real ledger. **Fail-soft:** no mapping, no warehouse, stock module off, or any thrown error → silent no-op (log only). A booking must never fail because of accrual bookkeeping.
- **`realizeAccruals(ctx, {source, sourceId, lines?, warehouseId?, actor, submit=true})`** — the completion path. `lines` defaults to the source's current open accruals (as `{itemId, qtyConsumption}` — server-authoritative conversion via the existing `resolveConsumptionLines`); when the completion dialog adjusted amounts, its lines win. Calls `createServiceIssue(...)` with `source`/`sourceId` and `submit`, then flips the open rows → `realized`, sets `realized_entry_id`, and stamps per item from the posted entry's **ledger rows**: `realized_qty = −Σ qtyDelta`, `realized_value = −Σ valueDelta` (issues are negative deltas). Returns `{entry, realized: n}`; no open rows and no lines → no-op `{entry: null, realized: 0}`.
- **Duplicate-realize guard lives in `createServiceIssue`'s tx** (not only on accrual status — the accrual flip is a separate tx from the entry insert): same-tx dup check on non-cancelled `stk_entries` where `metadata->>'source' = source and metadata->>'sourceId' = sourceId`, mirroring the invoice guard. Skipped for the legacy `'service'` source (no sourceId — `/stock/consume` legitimately repeats).
- **`releaseAccrualsTx(tx, orgId, source, sourceId)`** — flip open rows → `released`, stamp `released_at`. Cancel/reject/no-show path. Idempotent (touches only `open`).
- **Queries:** `listAccruals(ctx, {status?, itemId?, source?})` (joined item + product names); `availableToPromise(ctx, itemId, warehouseId)` = `bin.qty − Σ open-accrual qty`; `committedSpend(ctx, {warehouseId?})` = Σ open `est_value`; `accrualSummaryForSources(ctx, source, sourceIds[])` — **batch** rollup for the bookings list (per source: status mix, Σ est_value, Σ realized_value, realized_entry_id) so the per-row chip renders without N+1.

`createServiceIssue` is generalized: `source`/`sourceId` become parameters (default keeps `'service'`/absent), so the booking realize path stamps `{source:'booking', sourceId:bookingId}` without a second code path.

**Default warehouse.** `stk_warehouses` has no default concept today and `createBooking` (incl. public/gateway callers) has no warehouse input. The migration adds `is_default boolean not null default false` + partial unique index `(org_id) where is_default`; `resolveDefaultWarehouse(tx, orgId)` = the default, else earliest-created, else null (→ accrue no-ops). Warehouses UI gets a "set default" action.

## D3 — Booking integration

- **`createBooking`** gains optional `consumption?: {itemId, qtyConsumption}[]`. Inside the same tx, after the booking row is written, call `accrueConsumptionTx(tx, orgId, {source:'booking', sourceId:row.id, finProductId: et.productId, warehouseId: resolveDefaultWarehouse(...), lines: input.consumption})` — lines absent → defaults computed from `stk_consumption` (fail-soft no-op when unmapped). **Every caller accrues automatically**: the internal modal, both gateway actions, and the public `/book/[slug]` flow all route through `createBooking` (verified — `publicBook` delegates to it). **The idempotent uid-conflict retry path must NOT re-accrue** (accrue only when a fresh row was inserted).
- **Completion.** New endpoint `POST /api/scheduling/bookings/[id]/complete` `{lines?, warehouseId?}`. Sequence (two steps, deliberately not one tx — see D2): (1) `setBookingStatus(completed)` — the business fact commits first; (2) `realizeAccruals(...)`. If realize throws (`negative_stock` is the expected case — POS must never be blocked by a short bin), the endpoint still returns `{ok:true, stockWarning:{code, message, draftEntryId?}}`; accruals stay open. **Retry:** re-POST `/complete` on an already-completed booking skips step 1 and just realizes — that's the "post stock now" affordance. The plain `PATCH …/status` to `completed` also triggers a best-effort realize (defaults, no adjustment) after its status write, surfacing the same `stockWarning` shape.
- **Release.** In `setBookingStatus`, a transition to `cancelled | rejected | no_show` calls `releaseAccrualsTx` in the same tx as the status update.
- **Route auth fix (in scope — it blocks the exact persona this feature serves).** `POST /api/scheduling/bookings` and `PATCH …/[id]` currently `requireAdmin(locals)` — platform-admin only, so a staff user with `scheduling:edit` 403s today. Relax to `requireAuth` + `getCoreCtx`; the central `apiWriteCapability` gate (`/api/scheduling` → `scheduling:edit`) is the real guard. The new `/complete` and `/accrual` routes follow the same pattern from day one.

## D4 — API surface

- `GET /api/stock/accruals?status=&itemId=&source=` — list/report.
- `POST /api/stock/accruals/preview` `{finProductId, quantity, warehouseId?, excludeSource?}` — `buildAccrualPreview` (warehouse defaults server-side). Used by the modal pre-booking (no booking id exists yet) and the complete dialog.
- `POST /api/scheduling/bookings/[id]/accrual` `{lines}` — re-accrue (replace the open set) for an existing booking before completion.
- `POST /api/scheduling/bookings/[id]/complete` `{lines?, warehouseId?}` — complete + realize.
- Gateway (agent-native day-one): `query/stock` gains mode `accruals`; action `stock-accrue` (preview/confirm, capability `stock:create`) and completion is reachable via the existing booking actions plus a new `booking-complete` action that carries consumption lines. RBAC: reads `stock:view`, writes `stock:edit` (central prefix already covers `/api/stock`; booking writes are `scheduling:edit`), agent `stock:create`.

## D5 — UI

There is **no booking-detail page** — `/scheduling/bookings` is a card list with row actions. Everything lands there:

- **New-appointment modal** (`/scheduling/bookings/+page.svelte`): on service (event type) select, if it carries a `productId`, fetch preview via `POST …/accrual?preview=1`-style endpoint (see D4); render a "Stock consumption" block with per-line `ConsumptionGauge` (adjustable) + an ATP warning line when `qty > available − committedOther` (data already stamped on the preview lines). Book sends the adjusted `consumption` lines in the existing POST. The loader must add `productId` to its `eventTypes` mapping (today it strips to `{id, title}`). Block hidden when stock module off / no mapping / no `canAct('stock','view')`.
- **Complete dialog (row action):** the ✓ button, when the booking has open accruals, opens a dialog pre-filled from them — adjust actual amounts on the gauges → confirm → `POST /complete`. `stockWarning` in the response renders as a non-blocking toast/banner with a "post stock now" retry. No accruals → ✓ keeps its current one-click behavior.
- **Per-row accrual chip:** the list loader batch-fetches `accrualSummaryForSources` for the visible bookings and each row shows `committed S/X` / `realized` (links the entry) / `released`. This replaces the spec'd "Stock card" until a detail page exists.
- **Stock → Commitments** (new `StockNav` tab, after `consume` — mind the `startsWith` prefix-sibling ordering trap): committed spend vs real spend headline, open-accruals table, ATP per item (against reorder level), expected-vs-actual variance report. P2.
- i18n en+es for every string (`bun run i18n:compile`); Svelte 5 runes only; reuse `ConsumptionGauge`, `stock-ui.ts`.

## Valuation & reporting semantics

- **Potential spend** = Σ `est_value` of `open` accruals. **Real spend** = the actual stock ledger issues (existing). **Variance** (per booking / service / item) = `realized_value − est_value` and `realized_qty − qty`.
- **Available-to-promise** (item, warehouse) = `bin.qty − Σ open-accrual qty`. Surfaced in the item view and the booking modal (warn only).
- Estimate cost is snapshotted at accrual time (moving-avg then); realize cost is whatever `submitEntry` values the issue at (moving-avg then). The two differing is the point — it's the variance.

## RBAC (required build step)

- View: `/stock/*` → `stock:view` (already registered). Booking surfaces → `scheduling:view`.
- Writes: `/api/stock/*` → central `stock:edit`; booking accrual/complete under `/api/scheduling/*` → `scheduling:edit`. Gateway actions → `requireAssistantCapability`.
- No new nav key needed beyond the Commitments tab (filtered by `canViewPath('/stock/commitments')` → `stock:view`).

## Edge cases

- Service with no `stk_consumption` mapping → no accrual (booking proceeds normally). Same for: stock module disabled, no warehouse exists, event type has no product — accrue is fail-soft everywhere.
- Insufficient stock at completion (`negative_stock`) → booking completes, accruals stay open, endpoint returns `stockWarning`; staff fixes stock and re-POSTs `/complete` to realize.
- `createBooking` idempotent retry (uid conflict) → returns the existing row without re-accruing.
- Re-adjust before completion → `accrueConsumption` upserts (replaces open set). After completion → accrual is `realized`; further correction is a normal stock adjustment on the posted entry (existing mechanism), not an accrual concern.
- Reschedule (`rescheduledFromId`) → accrual stays attached to the same booking id; no re-accrual.
- Cancel after completion → the realized issue stands (stock was used); releasing only applies to `open` rows.
- Delete/rebuild bins → accruals are independent of `stk_bins`; ATP recomputes from current bins + open accruals.
- Double-complete → realize guard refuses the second (idempotent).

## Phasing

- **P1 (core):** migration (accruals + warehouse `is_default`) + Drizzle; `stock-accruals.service.ts` (tx cores + wrappers + queries) + generalized `createServiceIssue` + `buildAccrualPreview`; `createBooking`/`setBookingStatus`/`/complete`/`/accrual`/`accruals/preview` wiring + booking-route auth fix; New-appointment inline gauges + ATP warn; complete dialog + per-row accrual chip; `stock-accrue`/`booking-complete` gateway actions + `query/stock?mode=accruals`. Tests: accrual upsert idempotency, defaults-from-mapping, fail-soft no-op, realize→variance stamps, negative-stock completion path, release, ATP math, duplicate-realize guard, uid-retry no re-accrue.
- **P2 (visibility):** Stock → Commitments view (committed vs real, ATP per item, variance report); warehouses "set default" UI.
- **P3 (optional):** per-resource warehouse on accrual; extend `source` to sales orders; ATP-aware slot blocking (hard mode).

## Out of scope

Payment/invoice on completion (Booking→Order stays separate); reservation *holds* that block other bookings (P3); FIFO/lot valuation; multi-warehouse split per line.
