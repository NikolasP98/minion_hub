# POS Module — unified front desk (finances × stock × scheduling)

**Repo:** minion_hub (`dev`). New top-level business module `/pos`, inspired by ERPNext's Point of Sale (docs + `erpnext/selling/page/point_of_sale/` + `pos_profile`/`pos_invoice`/`pos_opening_entry`/`pos_closing_entry` doctypes, reviewed at source on branch `develop`). Builds directly on: the SUSII-synced finances module, the stock module (P5 + accruals, LIVE prod), the scheduling module (bookings + accrual lifecycle, LIVE prod), and the ERPNext-grade RBAC engine.

## Goal

One screen the front desk lives in. Four user flows, each individually RBAC-gateable per role:

1. **Sell** (`pos.sell`) — ring up a customer purchase: mixed cart of services + retail products, customer attach/quick-create, split-tender payment (cash/card/Yape/Plin/transfer), change calculation, automatic stock deduction, cash-shift tracking.
2. **Appointments** (`pos.appointments`) — create/confirm/complete/cancel appointments without leaving the front desk, including true walk-ins (force a staff member, override availability).
3. **Catalog** (`pos.items`) — THE point of entry for managing sellables: one wizard creates the `fin_products` row + optional `stk_items` row + the product↔item link + consumption mappings that today require touching two modules.
4. **Refills** (`pos.refills`) — record incoming stock (purchases/refills) as a simple form that posts a `receipt` entry.

Plus the **shift** lifecycle (ERPNext opening/closing entry, simplified): open the drawer with a float, close it counting per-method cash, expected-vs-counted difference recorded. This is the fraud/error control that makes payment-method data trustworthy.

## Grounding: prod data realities (queried 2026-07-07)

- **3,697 invoices, 100% `provider='susii'`**, PEN, ~5/day, 3,618 paid. Revenue analytics (`effTotal` in `finance.service.ts:387`) sum `fin_invoices`. **SUSII is the fiscal source of truth (SUNAT electronic billing) — POS must NOT mint `fin_invoices` or revenue double-counts** when the same physical sale is (legally, necessarily) also entered in SUSII.
- **`fin_payments.method` is NULL on all 3,723 rows** — payment methods are a blank slate. POS is where real tender data enters the system for the first time.
- **77 `fin_products`, all `category` NULL**; 34 have `stk_consumption` mappings; 24 `stk_items`; 2 warehouses, `is_default` unused (0 set).
- **Scheduling nascent**: 1 event type, 2 bookings ever. The POS front desk is what will drive scheduling adoption.
- 3,590 `parties` (customer spine), `phone9`/docNumber bridges to CRM.

## Current-state facts that constrain the design

- **No UI→invoice write path exists.** Only writer of `fin_invoices`/`fin_invoice_items`/`fin_payments` is `upsertInvoicesBatch` (SUSII sync ingest, delete-replace semantics keyed by `(org, provider, providerRef)`).
- **`sales_orders` is the existing answer to "commit revenue without double-counting"** (see the doc comment in `pg-sales-schema.ts`) — but it is single-line, booking-owned (`sourceBookingId` unique), and has no payment capture. It is not a cart.
- **Stock:** a sale is an `issue` entry, a refill is a `receipt` entry (requires `rate` — the moving-average input). No new entry type needed. `createServiceIssue` already accepts generic `source`/`sourceId` provenance with a same-tx dup guard; `findEntryBySource(ctx, source, sourceId)` is the idempotency anchor; `buildInvoiceIssuePreview` resolves product→stock via two paths: `stk_consumption` mapping (services) and 1:1 `stk_items.finProductId` fallback (retail). `resolveDefaultWarehouse` = flagged → earliest → null.
- **Scheduling:** internal bookings already support free-text walk-in attendees + `bypassRules` (skips min-notice/rolling-period but NOT conflicts). Gaps: `preferredResourceId` silently reassigns when busy; off-hours/fully-booked walk-ins 409. Booking completion realizes stock via `realizeAccruals` with the `stockWarning` never-block contract; cancel/no-show releases.
- **RBAC:** `MODULE_SUBRESOURCES` (in `src/lib/permissions.ts`) is the exact mechanism for per-flow gating — declaring `pos.sell`/`pos.appointments`/`pos.items`/`pos.refills` auto-wires the route guard + role-manager rows + `<key>:view` perms. Central write gate = `API_WRITE_PREFIXES` in `rbac.service.ts` + `apiWriteCapability` in `hooks.server.ts`. Module on/off = `app_modules` row + `isModuleEnabled` 404 gate in the module `+layout.server.ts` + nav auto-hide via `moduleId`.
- **Org-scoping:** every new table rides `withOrgCore` + `app.current_org_id` GUC + `app_ledger` grants + forced RLS, exactly like `20260702130000_stock.sql`. `withOrgCore` does NOT nest; PG statement errors poison the enclosing tx → cross-module side-effects (stock issues) happen POST-COMMIT, fail-soft, exactly like the accrual hooks in `scheduling-bookings.service.ts:299`.
- Working tree carries other-session WIP (stock valuation repair) — implementers must never `git add -A`.

## ERPNext lessons — adopted / skipped

**Adopted** (verified against ERPNext source):
- *POS Profile → `pos_settings`* (one per org, not per terminal — one front desk today; YAGNI on multi-register): payment methods list, require-customer flag, price-override flag.
- *Opening/Closing Entry → `pos_shifts`*: per-method `opening_float`, close with per-method `expected` vs `counted` vs difference. Key subtlety ERPNext handles that naive builds botch: **expected cash must net out change given**. We sidestep it structurally: `pos_payments.amount` is the *allocated* amount (what stays in the drawer); `tendered` is informational for the change display. Expected cash = float + Σ cash `amount` of non-void tickets. No GL, no change account.
- *One open shift per org; selling requires an open shift* (`no_open_shift` error; the Sell tab offers one-click open). ERPNext's stale-shift warning: shifts open >16h show a warning banner.
- *Customer quick-attach with inline create* (ERPNext `set_customer_info` pattern) via `ensureParty`/`searchParties`.
- *`is_stock_item` branching*: services skip stock checks; retail products check availability. One cart mixes a facial and a serum.
- *Zero-price guard*: lines with null/0 `unit_price` require an explicit price entry before submit (77 products may carry null prices).
- *Rounding*: totals computed in integer cents client-side, stored 2dp; server revalidates Σ.
- *Held-cart policy*: the cart persists in `localStorage` (survives reload); no server drafts v1 (ERPNext's `action_on_new_invoice` complexity skipped).
- *Stock race awareness*: availability shown = bin qty − open accruals (`availableToPromise`), warn-don't-block — consistent with the accrual philosophy (ERPNext hard-blocks; we deliberately do not, matching the booking ATP decision).

**Skipped** (explicitly, with reasons):
- POS Invoice + Merge Log consolidation — exists for retail GL volume; a clinic at ~5 tickets/day posts directly. Our ticket IS the terminal doc.
- Offline mode (ERPNext deleted theirs), loyalty, coupons, serial/batch, product bundles, phone-payment gateway, write-off accounts (no GL here), item-group hierarchies (77 products → flat search + category chips), barcode scanning (search-first; can ride the search box later), multi-register profiles.

## Design decisions (settled)

1. **POS ticket = new `pos_tickets` document set**, NOT `fin_invoices` (fiscal double-count) and NOT `sales_orders` (single-line, booking-owned). This mirrors ERPNext's POS-Invoice-as-separate-doctype. A ticket carries `invoice_provider_ref` for later reconciliation against the SUSII invoice (same pattern as `sales_orders`); reconciliation automation is deferred — the column + manual link ship now.
2. **Payments live on the ticket** (`pos_payments`: method, amount, tendered), stamped with `shift_id` for O(1) shift reconciliation. Methods are org-configurable (`pos_settings.methods`, default `["cash","card","yape","plin","transfer"]`). v1 requires full payment (Σ payments = total, `payment_mismatch` otherwise); partial payment is a later flag.
3. **Stock deduction is post-commit + fail-soft**, identical to the accrual hooks: ticket submit commits first; the issue entry (source `'pos'`, sourceId = ticket id, dup-guarded) is attempted after; `negative_stock`/`no_warehouse` → `stockWarning` stored on the ticket + surfaced in UI with a "post stock now" retry (`findEntryBySource` state machine reused). A sale is never blocked by stock.
4. **Line→stock resolution** mirrors `buildInvoiceIssuePreview`: product-kind lines resolve 1:1 via `stk_items.finProductId`; service-kind lines resolve via `stk_consumption` (qty × qtyPerUnit); unresolvable lines silently don't issue (they're still sold). **Booking-linked service lines never issue stock from the ticket** — completing the booking realizes its accruals; the ticket line just records the money side.
5. **Void, not edit.** Submitted tickets are immutable; `voidTicket` reverses (cancels the stock entry via `cancelEntry`'s reversing rows, excludes payments from shift expected) and is blocked once `invoice_provider_ref` is set or the shift is closed. Full return-against-ticket documents are deferred.
6. **Appointments tab reuses scheduling wholesale** (services + `/complete` stockWarning contract + accrual chips). Two scheduling additions for walk-ins: `forceResourceId` (hard-assign this staff or 409) and `overrideConflicts` (skip availability/conflict checks entirely; requires `forceResourceId`). Both internal-only (never on the public route).
7. **Catalog wizard is the cross-module point of entry**: one tx creates/updates `fin_products` + optional `stk_items` (+ `finProductId` link) + `stk_consumption` rows. Initial stock qty is NOT part of the wizard — that's a Refill (keeps valuation input honest).
8. **RBAC:** new module `pos` (BUSINESS_MODULES) + 4 sub-resources. Action mapping: sub-flow tabs gate on `pos.<sub>:view`; selling/refilling/appointment actions on `pos:create`/`pos:edit`; **`pos:manage` = close shift, void ticket, edit settings, override a line price** (ERPNext's `allow_rate_change` becomes capability-based instead of profile-flag-based; `pos_settings.allow_price_override` is the org-level master switch).
9. **Currency PEN-fixed** per org via `pos_settings.currency` default `'PEN'` (all 3,697 prod invoices are PEN). No FX.
10. **Module dependencies degrade gracefully**: Appointments tab hidden when scheduling module disabled; Refills + stock columns hidden when stock disabled; Sell works with finances alone (no stock issue attempted).

## User flows (UX walkthroughs)

### F1 — Sell (the default tab)
Shift banner on top (open → who/when + live per-method totals; closed → "Open shift" button → float dialog). Left: sellable grid — search box (auto-focused, `/` hotkey), category chips (from `fin_products.category`, "uncategorized" bucket), cards show name + price + stock pill for tracked products (green/amber/red by qty vs zero). Click → +1 in cart. Right rail: customer section (search parties by name/phone/doc via `searchParties`; quick-create name+phone; optional unless `pos_settings.require_customer`), cart lines (qty stepper, price editable only when null-priced or `pos:manage`+org switch, line discount, remove), totals (subtotal − discount = total), payment section (method cards from settings; tap to add a row with remaining amount pre-filled; cash row shows tendered input + change), **Charge** button (disabled until Σ = total). Submit → toast with `POS-2026-#####` + stock chip (posted ✓ / warning ⚠ with retry). Cart clears; `localStorage` draft dropped.

### F2 — Appointments
Header: date scope (Today / +7d). List reuses the bookings-page row anatomy: time, service, staff, attendee, status badge, accrual chip (`accrualSummaryForSources`), actions ✓ complete (dialog with consumption gauges when open accruals exist — same component as `/scheduling/bookings`), ✗ cancel, no-show. "New appointment" opens the booking modal (service → date → slots → attendee → optional consumption gauges) **plus the walk-in extras**: staff picker (forces `forceResourceId`) and an "override availability" toggle (visible with `pos:edit`, sends `overrideConflicts`) for the customer standing at the desk.

### F3 — Catalog
DataTable of sellables (merged view): name, code, category (inline-editable), price (inline-editable), kind (service/product), stock qty + warehouse coverage for tracked ones, mapped-consumption indicator, active toggle. "New sellable" wizard: name, code (auto-suggested), category (combobox over existing), price, kind toggle — *product*: adds uom + "track stock" (creates the linked `stk_items` row); *service*: optional consumption mapping editor (pick stock items + qty per unit, mirrors `/stock/consumption`). Edits PATCH through the same wizard.

### F4 — Refills
One form: item combobox (stock items), qty, unit cost (required — feeds moving average), supplier (optional `PartyPicker`), warehouse (default from `resolveDefaultWarehouse`, changeable), note. Submit posts a `receipt` entry (create+submit in one call, `source:'pos_refill'`). Below: recent receipts list (human id, items, value, when, by whom) linking to `/stock/entries/[id]`.

### F5 — Shift close
From the banner (requires `pos:manage`): dialog lists per method — expected (computed), counted (input), difference (live). Note field. Confirm closes the shift; summary card shows totals + difference badges; history under a "Shifts" sub-view of Sell.

## Data model (D1 — migration `supabase/migrations/<ts>_pos.sql` + `src/server/db/pg-pos-schema.ts`)

```
pos_settings (
  org_id      text pk,
  methods     jsonb not null default '["cash","card","yape","plin","transfer"]',
  currency    text not null default 'PEN',
  require_customer      boolean not null default false,
  allow_price_override  boolean not null default true,
  created_at/updated_at timestamptz
)

pos_shifts (
  id uuid pk, org_id text not null,
  status text not null default 'open',            -- 'open' | 'closed'
  opened_by uuid, opened_at timestamptz default now(),
  opening_float jsonb not null default '{}',      -- {method: amount}
  closed_by uuid, closed_at timestamptz,
  expected jsonb, counted jsonb,                  -- {method: amount} each; difference derived
  note text, created_at/updated_at,
  partial unique (org_id) where status = 'open'   -- one open shift per org
)

pos_tickets (
  id uuid pk, org_id text not null,
  human_id text,                                  -- POS-YYYY-##### (naming series, stamped at submit)
  shift_id uuid not null references pos_shifts on delete restrict,
  party_id uuid, crm_contact_id uuid, customer_name text,
  status text not null default 'submitted',       -- 'submitted' | 'void'
  subtotal numeric not null, discount numeric not null default 0, total numeric not null,
  currency text not null default 'PEN', note text,
  stock_entry_id uuid,                            -- posted stk_entries.id when stock issued
  stock_warning jsonb,                            -- {code, message, draftEntryId?} | null
  invoice_provider_ref text,                      -- SUSII reconciliation link (manual v1)
  created_by uuid, submitted_at timestamptz default now(),
  voided_at timestamptz, voided_by uuid, metadata jsonb default '{}',
  indexes (org_id, submitted_at), (org_id, shift_id), (org_id, party_id)
)

pos_ticket_lines (
  id uuid pk, org_id text not null,
  ticket_id uuid not null references pos_tickets on delete cascade,
  kind text not null,                             -- 'service' | 'product'
  fin_product_id uuid, booking_id uuid,           -- soft refs
  description text not null,
  qty numeric not null, unit_price numeric not null,
  discount numeric not null default 0, total numeric not null,
  line_no integer not null default 0,
  indexes (org_id, ticket_id), (org_id, fin_product_id)
)

pos_payments (
  id uuid pk, org_id text not null,
  ticket_id uuid not null references pos_tickets on delete cascade,
  shift_id uuid not null,                         -- denormalized for O(1) shift math
  method text not null, amount numeric not null,  -- amount = allocated (stays in drawer)
  tendered numeric,                               -- cash handed over (change = tendered − amount)
  paid_at timestamptz default now(), metadata jsonb default '{}',
  indexes (org_id, shift_id), (ticket_id)
)
```

All five: org_guc forced-RLS policy + `app_ledger` grants, exactly like `20260705230000_stock_accruals.sql`. Orchestrator applies to prod (surgical SQL, never `drizzle-kit push`); note the hub now also has the `hub_migrations` Vercel build ledger — the migration file must be committed so the build pipeline picks it up.

## Service layer (D2)

**`src/server/services/pos.service.ts`** (new; `PosError extends Error {code}` like `StockError`):
- `getPosSettings(ctx)` → row or in-code defaults; `updatePosSettings(ctx, patch)`
- `getOpenShift(ctx)` → `{shift, summary} | null`; `openShift(ctx, {openingFloat, actor})` (`shift_already_open`); `closeShift(ctx, {counted, note, actor})` — computes `expected` per method (cash: float + Σ cash amounts of non-void tickets; others: Σ amounts), stores both, returns shift + differences (`no_open_shift`); `listShifts(ctx, {limit})`; `shiftSummary(ctx, shiftId)` (per-method totals, ticket count, gross, void count)
- `submitTicket(ctx, input)` → `{ticket, stockWarning}` — validates (open shift, ≥1 line, qty>0, price≥0 with zero-price rule, method ∈ settings, Σ line totals − discount = total, Σ payments = total), one `withOrgCore` tx inserts ticket (+humanId `POS-.YYYY.-` via `nextSerialId`) + lines + payments, emits `pos.ticket_submitted`; POST-COMMIT fail-soft stock issue (D3) with result stamped onto the ticket (`stock_entry_id` / `stock_warning`)
- `postTicketStock(ctx, ticketId, actor)` → retry state machine (mirrors `realizeAccruals`: `findEntryBySource('pos', ticketId)` → submitted? stamp / draft? resubmit / none? create) — also the post-commit worker `submitTicket` calls
- `voidTicket(ctx, id, actor)` — guards `not_found` / `already_void` / `reconciled` (invoice_provider_ref set) / `shift_closed`; cancels the stock entry when submitted (fail-soft warning), marks void
- `listTickets(ctx, {shiftId?, from?, to?, limit?})`, `getTicket(ctx, id)` (ticket + lines + payments)
- `listSellables(ctx)` — merged catalog: active `fin_products` left-joined to `stk_items` (via `finProductId`) + Σ bin qty + has-consumption-mapping flag + kind derivation (linked item → product, else service)
- `createSellable(ctx, input)` / `updateSellable(ctx, productId, patch)` — the wizard tx (product upsert + item create/link + consumption `setConsumption` rows)

**`src/server/services/stock.service.ts`** (small addition):
- `createSourcedIssue(ctx, {source, sourceId, warehouseId, lines, partyId?, note?, submit?, actor})` — generalization of `createServiceIssue` without the single-finProductId assumption (dup guard on source+sourceId, same metadata stamping). Used by POS tickets (`source:'pos'`) and Refills use `createEntry`+`submitEntry` with type `receipt` (no new function needed there; the route composes).

**`src/server/services/scheduling-bookings.service.ts`** (additive):
- `CreateBookingInput` += `forceResourceId?: string` (candidate set = exactly this resource; busy → `SlotUnavailableError`) and `overrideConflicts?: boolean` (with `forceResourceId` only: skip `computeSlots` entirely, validate resource active, book at the requested time verbatim). Public route never passes either.

## Routes (D3 — `/api/pos/*`, auto-write-gated once the prefix lands)

- `settings/+server.ts` — GET (module-gated read), PUT (`requireOrgCapability(locals,'pos','manage')`)
- `shifts/+server.ts` GET (history) · `shifts/current/+server.ts` GET · `shifts/open/+server.ts` POST · `shifts/close/+server.ts` POST (`pos:manage` in-handler on top of central gate)
- `tickets/+server.ts` GET/POST (POST = submit; response `{ok, ticket, stockWarning}`) · `tickets/[id]/+server.ts` GET · `tickets/[id]/void/+server.ts` POST (`pos:manage`) · `tickets/[id]/post-stock/+server.ts` POST (retry)
- `sellables/+server.ts` GET/POST · `sellables/[id]/+server.ts` PATCH
- `_errors.ts` — `handlePosError` (`no_open_shift`/`payment_mismatch`/`zero_price`/… → 400/409 mapping, mirroring `api/stock/_errors.ts`)
- Gateway agent surface: `api/gateway/query/pos` (modes: `sellables`, `shift`, `tickets`) + `api/gateway/actions/pos-sale` (confirm/preview + fail-soft stockWarning parity), both via `requireAssistantCapability(locals, url, 'pos', …)`

## RBAC + module wiring (D4 — the required-build-step checklist, exact)

1. `rbac.service.ts`: `MODULES` += `'pos'`; `MODULE_LABELS['pos']='Point of Sale'`; `BUSINESS_MODULES` += ; `defaultCaps`: owner/admin full; manager view/create/edit/export/manage; staff view/create/edit; viewer view.
2. `API_WRITE_PREFIXES` += `['/api/pos', 'pos']`.
3. `src/lib/permissions.ts`: `ROUTE_VIEW_PERMS['/pos']='pos:view'`; `MODULE_SUBRESOURCES.pos = [{key:'pos.sell',route:'/pos/sell'},{key:'pos.appointments',route:'/pos/appointments'},{key:'pos.items',route:'/pos/catalog'},{key:'pos.refills',route:'/pos/refills'}]`.
4. `permissions.service.ts` `capsToLegacyPermissions`: emit `pos:view|create|edit|delete|export|manage` + sub-resource `:view`s (follow the existing crm.insights pattern).
5. `src/lib/access/policy.ts`: `'pos.view': {permission:'pos:view'}`.
6. `sections.ts` `BUILTIN_PLUGIN_ITEMS`: `/pos` item (icon `Store` from lucide), `requires:'pos.view'`.
7. `GNav.svelte` `CHORD_DEFS`: `{key:'P', path:'/pos'}` (P is free).
8. `(app)/pos/+layout.server.ts`: `isModuleEnabled(ctx,'pos')` → 404; also loads `stockEnabled`/`schedulingEnabled` for tab degradation; `PosNav` filters sub-tabs via `canViewPath`.
9. PII: customer fields in ticket lists respect `shouldMaskSensitive(locals,'pos')`? — **No**: reuse the `finance` field-level domain for money masking is NOT wired v1; attendee PII on the appointments tab keeps the existing `scheduling` masking. (Deliberate v1 simplification, noted for follow-up.)

## Edge cases (encode in tests)

- Zero/null-priced product added to cart → submit blocked until a price is typed (`zero_price` server-side guard too).
- Σ payments ≠ total → `payment_mismatch` 400 (no partial payment v1).
- Unknown method (not in settings) → `invalid_method` 400.
- Submit with no open shift → `no_open_shift` 409; UI offers open-shift dialog inline.
- Two registers / stale tab racing the last unit → stock issue fails `negative_stock` post-commit → ticket stands with `stock_warning`, retry button; never a lost sale.
- Void: after shift close → 409 `shift_closed`; after reconcile → 409 `reconciled`; voiding also cancel-reverses the stock entry (fail-soft if that fails — warning stored).
- Booking-linked line + same service also mapped in `stk_consumption` → ticket must NOT double-issue (booking realization owns it).
- Ticket with only unmapped/service-unmapped lines → no stock entry at all, `stock_entry_id` null, no warning (clean no-op, mirrors accrual fail-soft zeros).
- Shift close with a `stock_warning` ticket still pending → allowed (money and stock are independent ledgers).
- Cash `tendered < amount` → 400 `invalid_tender`; non-cash rows must not carry `tendered`.
- Shift open >16h → warning banner (`stale_shift` computed client-side).
- Rounding: all money client-computed in integer cents, server re-validates with `Math.abs(diff) < 0.01`.
- Walk-in booking with `overrideConflicts` but no `forceResourceId` → 400.
- i18n: every string via Paraglide en+es (es is the front-desk language — write es copy with care, not machine-gloss).

## Out of scope (v1, explicitly)

Returns/credit-notes against past tickets (void covers same-shift errors), partial payment, SUSII auto-reconciliation job (column ships, matching deferred), loyalty, barcode scanning, multi-register/POS-profiles, receipt printing (browser print of ticket detail is acceptable), offline mode, GL/accounting entries, ticket editing after submit.

## Rollout

Migration applies via the `hub_migrations` Vercel build ledger (committed file) — orchestrator may also pre-apply via psql. Module ships enabled (absent `app_modules` row = enabled) but nav-invisible to roles without `pos:view`; owner flips role caps in the role manager. Browser QA of the four flows on dev before promoting to master.
