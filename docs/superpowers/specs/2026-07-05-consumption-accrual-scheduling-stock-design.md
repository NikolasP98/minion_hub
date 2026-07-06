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
org_guc RLS + `app_ledger` grants exactly like `20260702130000_stock.sql`. Drizzle table in `pg-schema/stock.ts` (`stkAccruals`). Orchestrator applies to prod.

## D2 — Service layer (`stock.service.ts`)

All reuse existing pure fns (`consumptionToStockQty`, `round4`) and the P5.1b preview.

- **`buildAccrualPreview(ctx, {finProductId, quantity, warehouseId})`** — thin wrapper over `buildServiceIssuePreview` that also stamps `est_unit_cost`/`est_value` per line from the current bin moving-avg rate. Returns gauge-ready lines + `hasMapping`. Used by both the booking modal (creation) and the completion dialog.
- **`accrueConsumption(ctx, {source, sourceId, finProductId, warehouseId, lines, actor})`** — upsert `open` accrual rows for `(source, sourceId, item_id)` from the (possibly adjusted) lines; delete open rows no longer present. Idempotent: re-adjusting a booking replaces its open accrual set. Never touches the real ledger. No-op when the product has no mapping.
- **`realizeAccruals(ctx, {source, sourceId, lines?, warehouseId, actor, submit=true})`** — the completion path. `lines` defaults to the booking's current open accruals (converted to issue lines); when the completion dialog adjusted amounts, its lines win (server-authoritative conversion via the existing `resolveConsumptionLines`). Calls `createServiceIssue(...)` with `metadata {source, sourceId}` and `submit`, then flips the accrual rows to `realized`, sets `realized_entry_id`, and stamps `realized_qty`/`realized_value` from the posted entry's lines/valuation. Idempotent: refuses a second realize for a `(source, sourceId)` that already has realized rows (mirrors the invoice duplicate guard).
- **`releaseAccruals(ctx, {source, sourceId})`** — flip open rows → `released`, stamp `released_at`. Cancel/no-show path. Idempotent.
- **Queries:** `listAccruals(ctx, {status?, itemId?, source?})` (joined item + product names); `availableToPromise(ctx, itemId, warehouseId)` = `bin.qty − sum(open accrual qty)`; `committedSpend(ctx, {warehouseId?})` = `sum(open est_value)`; `accrualsForSource(ctx, source, sourceId)` (booking-detail card, includes realized entry link + variance).

`createServiceIssue` is generalized: its metadata `source`/`sourceId` become parameters (default keeps `'service'`), so the booking realize path stamps `{source:'booking', sourceId:bookingId}` without a second code path.

## D3 — Booking integration

- **`createBooking`** gains optional `consumption?: {itemId, qtyConsumption}[]`. After the booking row is written, if the event type's product maps to stock, call `accrueConsumption(source:'booking', sourceId:booking.id, finProductId, warehouseId, lines)` — `lines` = the passed overrides, else the computed defaults. Warehouse: the org's default/`MAIN` (P3: per-resource warehouse).
- **Completion.** New endpoint `POST /api/scheduling/bookings/[id]/complete` `{lines?, warehouseId?}` → sets status `completed` **and** `realizeAccruals`. (Keeps the multi-step post atomic and lets the completion dialog send actual amounts.) The plain `PATCH …/status` to `completed` still works and realizes from the open accruals with no adjustment.
- **Release.** In `setBookingStatus`, a transition to `cancelled | rejected | no_show` calls `releaseAccruals(source:'booking', sourceId:id)`.

## D4 — API surface

- `GET /api/stock/accruals?status=&itemId=&source=` — list/report.
- `POST /api/scheduling/bookings/[id]/accrual` `{finProductId, warehouseId, lines}` — (re)accrue for a booking (used when adjusting from the booking detail before completion). Preview via `?preview=1` returns `buildAccrualPreview` only.
- `POST /api/scheduling/bookings/[id]/complete` `{lines?, warehouseId?}` — complete + realize.
- Gateway (agent-native day-one): `query/stock` gains mode `accruals`; action `stock-accrue` (preview/confirm, capability `stock:create`) and completion is reachable via the existing booking actions plus a new `booking-complete` action that carries consumption lines. RBAC: reads `stock:view`, writes `stock:edit` (central prefix already covers `/api/stock`; booking writes are `scheduling:edit`), agent `stock:create`.

## D5 — UI

- **New-appointment modal** (`/scheduling/bookings`): on service select, fetch `buildAccrualPreview`; render a "Stock consumption" block with per-line `ConsumptionGauge` (adjustable) + an ATP warning line when `qty > availableToPromise`. Book sends the adjusted `consumption` lines. Gated `canAct('scheduling','edit')`; the block is hidden when stock module off or the service has no mapping.
- **Booking detail / row action:** "Complete" opens a dialog pre-filled from the open accruals — adjust actual amounts on the gauges → confirm → `/complete`. A "Stock" card shows accrual status (`committed S/X` / `realized → entry link` / `released`) and per-line expected-vs-actual once realized.
- **Stock → Commitments** (new `StockNav` tab, after `consume`): committed spend vs real spend headline, open-accruals table, available-to-promise per item (against reorder level), and an expected-vs-actual variance report. P2.
- i18n en+es for every string; Svelte 5 runes only; reuse `ConsumptionGauge`, `stock-ui.ts`, `PartyPicker`.

## Valuation & reporting semantics

- **Potential spend** = Σ `est_value` of `open` accruals. **Real spend** = the actual stock ledger issues (existing). **Variance** (per booking / service / item) = `realized_value − est_value` and `realized_qty − qty`.
- **Available-to-promise** (item, warehouse) = `bin.qty − Σ open-accrual qty`. Surfaced in the item view and the booking modal (warn only).
- Estimate cost is snapshotted at accrual time (moving-avg then); realize cost is whatever `submitEntry` values the issue at (moving-avg then). The two differing is the point — it's the variance.

## RBAC (required build step)

- View: `/stock/*` → `stock:view` (already registered). Booking surfaces → `scheduling:view`.
- Writes: `/api/stock/*` → central `stock:edit`; booking accrual/complete under `/api/scheduling/*` → `scheduling:edit`. Gateway actions → `requireAssistantCapability`.
- No new nav key needed beyond the Commitments tab (filtered by `canViewPath('/stock/commitments')` → `stock:view`).

## Edge cases

- Service with no `stk_consumption` mapping → no accrual (booking proceeds normally).
- Re-adjust before completion → `accrueConsumption` upserts (replaces open set). After completion → accrual is `realized`; further correction is a normal stock adjustment on the posted entry (existing mechanism), not an accrual concern.
- Reschedule (`rescheduledFromId`) → accrual stays attached to the same booking id; no re-accrual.
- Cancel after completion → the realized issue stands (stock was used); releasing only applies to `open` rows.
- Delete/rebuild bins → accruals are independent of `stk_bins`; ATP recomputes from current bins + open accruals.
- Double-complete → realize guard refuses the second (idempotent).

## Phasing

- **P1 (core):** migration + Drizzle; `accrue/realize/release` + `buildAccrualPreview` + generalized `createServiceIssue`; `createBooking`/`setBookingStatus`/`/complete` wiring; New-appointment inline gauges; booking-detail Stock card; `stock-accrue` gateway action + `query/stock?mode=accruals`. Tests: accrual upsert idempotency, realize→variance, release, ATP math, duplicate-realize guard.
- **P2 (visibility):** Stock → Commitments view (committed vs real, ATP per item, variance report); ATP warning in the booking modal.
- **P3 (optional):** per-resource warehouse on accrual; extend `source` to sales orders; ATP-aware slot blocking (hard mode).

## Out of scope

Payment/invoice on completion (Booking→Order stays separate); reservation *holds* that block other bookings (P3); FIFO/lot valuation; multi-warehouse split per line.
