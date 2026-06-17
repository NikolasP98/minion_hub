# Finances — Analytics + Product Catalog + CRM↔Finance Bridge

**Date:** 2026-06-17
**Repo:** `minion_hub` · branch `dev`
**Status:** Design approved (incl. DRY/relational schema steer). Follows the Phase-1 module + bg-sync work.

## Problem / goals

Four additions to the hub-native Finances module, in build order C → A → B:

- **C. Product catalog** — a canonical product table so billed line items reconcile against one standardized
  product list (all 2,962 items carry a `code`; 58 distinct codes, but **5 codes have drifted to multiple name
  variants** — the catalog pins one canonical name + reference price per code).
- **A. Dashboard analytics** — replace the CSS bar chart with ECharts: a KPI row, a revenue **area chart**
  (toggle cumulative ↔ per-month, with discounts surfaced), a **Top Products** chart (toggle revenue ↔ quantity,
  using catalog names), and **Top Clients**.
- **B. CRM↔Finance bridge** — surface a contact's finance summary in `/crm/customers` and on the contact detail
  page, additively and without coupling the two modules.

## Constraints / DRY-relational principles (user steer: "keep the database tables DRY, avoid duplicate data,
promote relational connections")

- **Canonical/mutable attributes live in exactly one table**, referenced by FK. Product name/category/price
  live only in `fin_products`; client identity lives in `fin_clients`.
- **As-billed snapshots are kept, deliberately.** The line item's `code`/`description` and the invoice's
  `client_name`/`client_doc_number`/`client_email` are historical facts (what was actually billed — the 5
  drifted codes prove names change over time). These are NOT redundant duplication; they stay. We *add*
  relations alongside them.
- **No finance data is copied into CRM tables.** The bridge computes revenue/invoice aggregates via a
  relational join at read time, so nothing goes stale.
- All migrations are **additive** (new table; `ADD COLUMN IF NOT EXISTS` nullable FKs; backfill `UPDATE`s) —
  safe on live gxv data. Hand-written idempotent SQL at meta-repo root `supabase/migrations/`, applied to gxv
  via Supabase MCP. Drizzle schema mirrors the SQL. Every org-scoped query routes through `withOrgCore`.
- Money columns are `numeric` (string in JS) — coerce with `Number(...)`. Keep `bun run check` 0/0.
- Admin-gate catalog writes + import with `requireAdmin`. Read endpoints are member-level.

## Data facts (probed live on gxv — design only includes what renders)

- `fin_invoice_items`: 2962 rows, **100% have `code`**, 58 distinct codes ≈ 58 names, **5 codes carry >1 name
  variant**, **0 categories**. → catalog keyed on `code`; category is a (mostly empty) optional field.
- `fin_invoices`: 2391 rows, all `paid` except 31 `void`, 0 `pending`; total net S/1,389,970; discount S/52,140.
- `fin_payments`: method 100% NULL; `fin_invoices.seller` 1 distinct. → **no** payment-method / seller / status
  charts (they would be empty); paid/void shown as a stat only.
- `fin_clients`: 1190 rows, **email 0%**, phone 544, doc(RUC/DNI) 100%. CRM: `crm_contact_identities` 1593,
  99.9% WhatsApp phone; `crm_contacts` has **no RUC field**. → **CRM↔Finance link = phone** (normalized
  last-9-digits); email/RUC are non-viable. ~332 contacts link.

---

## Part C — Product catalog

### Schema

`fin_products` (Drizzle in `src/server/db/pg-finance-schema.ts`; migration
`supabase/migrations/20260617140000_fin_products.sql`):

| column      | type        | notes                                   |
| ----------- | ----------- | --------------------------------------- |
| `id`        | uuid pk     | `gen_random_uuid()`                     |
| `org_id`    | text        | RLS GUC scope                           |
| `code`      | text        | billing code (e.g. `AF1`); the join key |
| `name`      | text        | canonical display name                  |
| `category`  | text        | nullable                                |
| `unit_price`| numeric     | nullable reference price                |
| `active`    | boolean     | default true                            |
| `metadata`  | jsonb       | default `{}`                            |
| `created_at`/`updated_at` | timestamptz | defaultNow                |

- Unique `(org_id, code)`. RLS enable+force + `fin_products_org_guc` policy. Grant to `app_ledger`.

`fin_invoice_items.product_id` — new nullable FK (migration
`20260617140500_fin_invoice_item_product_fk.sql`): `add column if not exists product_id uuid references
public.fin_products(id) on delete set null`; index `(product_id)`. The item keeps `code` + `description`.

### Service — `src/server/services/finance-products.service.ts`

- `listProducts(ctx)` → catalog rows + per-product billed aggregates (count, revenue) via join to
  `fin_invoice_items` on `product_id`.
- `upsertProduct(ctx, { code, name, category, unitPrice, active })` — onConflict `(org_id, code)`.
- `deactivateProduct(ctx, id)` — set `active=false` (no hard delete; preserves the FK from items).
- `importFromBilling(ctx)` — insert a catalog row for every distinct billed `code` using the most-recent
  `description` as the seed name, `onConflictDoNothing` on `(org_id, code)` (never clobbers a curated name).
  Then backfill: `update fin_invoice_items set product_id = p.id from fin_products p where items.org_id =
  p.org_id and items.code = p.code and items.product_id is null`. Returns `{ created, linked }`.
- `catalogCoverage(ctx)` — `{ cataloged, billedCodesNotInCatalog, catalogEntriesNeverBilled }` for the
  match-coverage banner.

### Sync integration (`finance.service.ts upsertInvoice`)

After upserting items, resolve `product_id` by `code` against the catalog. Use a per-sync cached
`Map<code, productId>` (one `select code, id from fin_products` per `advanceJob` run, passed into
`upsertInvoice`, or memoized) to avoid a lookup per item. `product_id` is null for uncatalogued codes; a later
`importFromBilling` backfills them. This keeps sync idempotent and the relation populated going forward.

### Page — `/finances/products`

- Table: code · canonical name · category · ref price · active · #billed · revenue. Inline add/edit
  (`PUT /api/finances/products`). **"Import from billing"** button (`POST /api/finances/products/import`,
  admin). A coverage banner from `catalogCoverage`.
- Add to `FinanceNav` (`src/lib/components/finance/FinanceNav.svelte`) between Clients and Settings.
- Endpoints: `GET/PUT /api/finances/products`, `POST /api/finances/products/import` (admin),
  `POST /api/finances/products/[id]/deactivate` (admin). All gated by `isModuleEnabled('finances')`.

---

## Part A — `/finances` dashboard analytics

### Schema

`fin_invoices.client_id` — new nullable FK (migration `20260617141000_fin_invoice_client_fk.sql`):
`add column if not exists client_id uuid references public.fin_clients(id) on delete set null`; index
`(client_id)`. Backfill: `update fin_invoices i set client_id = c.id from fin_clients c where i.client_id is
null and c.org_id = i.org_id and c.provider = i.provider and c.doc_number = i.client_doc_number and
c.doc_number is not null`. `upsertInvoice` sets `client_id` from the client upsert's returned id going forward.
The denormalized `client_name`/`client_doc_number`/`client_email` stay (as-billed snapshot).

### Service aggregates (`finance.service.ts`)

- Extend `dashboardRows` → monthly `{ month, invoices, revenue (net total), discount, gross (subtotal) }`
  (add `sum(discount)`, `sum(subtotal)` per month; coerce to Number).
- `financeSummary(ctx)` → `{ totalNet, totalDiscount, totalGross, invoiceCount, avgInvoice, uniqueClients,
  paidCount, voidCount, currency }` (currency = mode of `fin_invoices.currency`, default `PEN`).
- `topProducts(ctx, { limit = 15 })` → group `fin_invoice_items` by `product_id`, left join `fin_products`
  for the canonical `name` (coalesce to `max(description)` when `product_id` null), returning
  `{ productId, code, name, revenue, qty, lines }`. One query serves both toggle modes (client sorts/relabels).
- `topClients(ctx, limit = 10)` — reuse `clientRevenueRows`, slice top 10.

### UI (`/finances/+page.{server.ts,svelte}`)

- Load: `financeSummary`, `dashboardRows`, `topProducts`, `topClients` in parallel (all gated by
  `isModuleEnabled('finances')`).
- **KPI row:** Net revenue · Discounts given · Invoices · Avg invoice (AOV) · Unique clients · Paid/void.
- **Revenue area chart** (ECharts via `src/lib/components/charts/Chart.svelte`): x = month; a **toggle**
  ([Per month ↔ Cumulative]) switches the net-revenue series between monthly value and running total. A second
  **discount** series (per-month, or cumulative to match) is overlaid so discounts are visible. *"Includes
  discounts"* = net area (already discount-adjusted) + a visible discount series + the Discounts KPI.
- **Top Products** bar (ECharts) with a **toggle** ([Revenue ↔ Quantity]); labels use catalog names.
- **Top Clients** horizontal bar (top 10).
- Toggles are local Svelte `$state` (no Zag needed for a 2-option segmented control; a simple button pair).
- **Explicitly NOT built** (data empty): payment-method donut, seller chart, status pie. Noted in the page as
  out of scope until that data exists.
- i18n keys for all labels/toggles in `messages/{en,es}.json`.

---

## Part B — CRM↔Finance bridge (additive, `bothEnabled`-guarded, no coupling)

### Service — `src/server/services/crm-finance.service.ts`

- Pure helper `normPhone(raw): string | null` — strip non-digits; return last 9 digits (Peru mobile length),
  or null if < 8 digits. Unit-tested.
- `contactFinanceByPhone(ctx)` → `Map<normPhone, { revenue, invoices, lastPurchaseAt, currency }>`. Built by
  joining `fin_invoices` → `fin_clients` (on `client_id`, the new FK), grouping by `normPhone(fin_clients.phone)`
  where phone is present. **Returns empty unless `bothEnabled(ctx, 'crm', 'finances')`.** This service is the
  ONLY place the two domains meet; neither `crm-*` nor `finance.service` imports the other.

### `/crm/customers`

- After the existing `listContactsCached(ctx)` read (cache stays finance-free), if `bothEnabled`, fetch
  `contactFinanceByPhone(ctx)` and merge `{ revenue, invoices, lastPurchase }` onto each roster row by
  `normPhone` of the contact's WhatsApp identity (the roster row's phone identity). Pass a `financeEnabled`
  flag to the page.
- Table: three new optional columns (Revenue · Invoices · Last purchase), shown only when `financeEnabled`;
  sortable (revenue desc is a natural new sort). ~332 rows populate; the rest render blank (additive).

### `/crm/[contactId]` detail

- Load: if `bothEnabled` and the contact has a phone identity, fetch that contact's finance summary
  (revenue, invoice count, last purchase) + recent invoices (limit ~10) via the phone → `fin_clients` →
  `fin_invoices` join.
- UI: a **Financials card** (revenue, # invoices, last purchase, recent invoices each linking to
  `/finances/invoices/[id]`). Rendered only when a match exists. No card when finances is disabled or no match.

---

## Error handling

- Catalog import is idempotent (`onConflictDoNothing` + null-guarded backfill); safe to re-run.
- `product_id`/`client_id` are nullable — uncatalogued codes / unmatched clients simply don't resolve; UI
  falls back (description / blank). No hard failures.
- Bridge degrades to empty when either module is disabled or no phone match — never errors.
- Charts render only their available data; empty series are omitted, not shown as zero noise.

## Testing

- `normPhone` unit tests (country code, spaces, short numbers → null, last-9 extraction).
- `finance-products.service`: import creates+links, re-import is a no-op, coverage counts; `topProducts`
  groups by product and resolves catalog name with description fallback (mock-db).
- `financeSummary`/extended `dashboardRows` coerce aggregates to Number (no string concatenation).
- `contactFinanceByPhone` returns empty when `bothEnabled` is false; groups by normalized phone when true.
- `bun run check` 0/0; Svelte files validated via the autofixer.

## Rollout (plan sequence)

1. **C** — `fin_products` + `product_id` FK migrations → apply to gxv; service; sync integration; page + nav +
   endpoints; tests.
2. **A** — `client_id` FK migration → apply to gxv + backfill; aggregates; ECharts dashboard; tests.
3. **B** — `crm-finance.service` + `normPhone`; customers columns; detail Financials card; tests.

Subagent-driven execution (fresh implementer per task + task review + final whole-branch review), same as the
bg-sync build. Migrations and gxv applies are orchestrator-handled (Supabase MCP).
