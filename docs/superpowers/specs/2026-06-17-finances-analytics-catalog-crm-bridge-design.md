# Finances — Analytics + Catalog + Sync Perf + List Perf + Caching + CRM↔Finance Bridge

**Date:** 2026-06-17
**Repo:** `minion_hub` · branch `dev`
**Status:** Design approved (incl. DRY/relational steer + a 2nd round of additions: sync perf, dashboard period
filters/avg-ticket/KPIs, list windowing, Valkey caching). Follows the Phase-1 module + bg-sync work.

## Problem / goals

Build order **C-schema → S → C-rest → A → P → B** (see Rollout):

- **C. Product catalog** — a canonical product table so billed line items reconcile against one standardized
  product list (all 2,962 items carry a `code`; 58 distinct codes, but **5 codes have drifted to multiple name
  variants** — the catalog pins one canonical name + reference price per code).
- **S. Sync performance** — the current per-invoice-transaction sync takes ~30–60 min and barely updates the
  UI; replace it with a batched, set-based idempotent upsert (~100× fewer DB round-trips) + smooth heartbeats.
- **A. Dashboard analytics** — replace the CSS bar with ECharts: **date/period filters** (range + day/week/month
  granularity), an industry-standard **KPI** row, a revenue **area chart** (toggle cumulative ↔ per-period, with
  discounts surfaced), an **avg-ticket** chart, **Top Products** (toggle revenue ↔ quantity, catalog names), and
  **Top Clients** — all period-scoped and Valkey-cached.
- **P. List performance** — windowed/infinite-scroll render on the invoices/payments/clients lists (the pattern
  `/crm` uses).
- **Caching** — Valkey-cache the finance aggregates (busted on sync); Cloudflare is N/A for per-org authed data.
- **B. CRM↔Finance bridge** — surface a contact's finance summary in `/crm/customers` and on the contact detail
  page, additively and without coupling the two modules.

## Constraints / DRY-relational principles (user steer: "keep the database tables DRY, avoid duplicate data,

promote relational connections")

- **Canonical/mutable attributes live in exactly one table**, referenced by FK. Product name/category/price
  live only in `fin_products`; client identity lives in `fin_clients`.
- **As-billed snapshots are kept, deliberately.** The line item's `code`/`description` and the invoice's
  `client_name`/`client_doc_number`/`client_email` are historical facts (what was actually billed — the 5
  drifted codes prove names change over time). These are NOT redundant duplication; they stay. We _add_
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

| column                    | type        | notes                                   |
| ------------------------- | ----------- | --------------------------------------- |
| `id`                      | uuid pk     | `gen_random_uuid()`                     |
| `org_id`                  | text        | RLS GUC scope                           |
| `code`                    | text        | billing code (e.g. `AF1`); the join key |
| `name`                    | text        | canonical display name                  |
| `category`                | text        | nullable                                |
| `unit_price`              | numeric     | nullable reference price                |
| `active`                  | boolean     | default true                            |
| `metadata`                | jsonb       | default `{}`                            |
| `created_at`/`updated_at` | timestamptz | defaultNow                              |

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

### Period filter (drives every aggregate)

The dashboard takes a **period**: `{ from?: ISO, to?: ISO, bucket: 'day'|'week'|'month' }`, parsed from the
page URL query (`?from=&to=&bucket=`). Default = last 12 months, `bucket=month`. Every aggregate below is
parameterized by this period and filters `fin_invoices.issued_at` to `[from, to)`. The dashboard load
resolves picked days to absolute instants in the organization's finance timezone with
`resolvePeriodWindow`; parsing and fallback rules belong to
[`parsePeriod`](../../../src/lib/finance/period.ts). Series bucketing, including the optional timezone
argument and its compatibility default, follows the
[`revenueSeries` API comment](../../../src/server/services/finance.service.ts).

The assistant endpoint has its own strict business-calendar contract, documented in
[`query/finance/+server.ts`](../../../src/routes/api/gateway/query/finance/+server.ts).

### Service aggregates (`finance.service.ts`) — all take `(ctx, period)`

- `financeSummary(ctx, period)` → `{ totalNet, totalGross, totalDiscount, discountRate (discount/gross),
invoiceCount, avgTicket (net/invoiceCount), uniqueClients, newClients (clients whose FIRST-EVER invoice
falls in the period), voidCount, voidRate, currency }`. These are the industry-standard sales KPIs the data
  supports (revenue, AOV/avg-ticket, discount rate, unique/new customers, void rate). MoM/period growth is
  derived in the UI from the series (last bucket vs previous).
- `revenueSeries(ctx, period)` → rows `{ bucket, invoices, revenue (net), discount, gross }` over the bucketed
  range (replaces the old fixed `dashboardRows`; keep `dashboardRows` only if another caller needs it — it has
  none, so rename to `revenueSeries`). Coerce all aggregates to Number.
- `topProducts(ctx, period, { limit = 15 })` → group `fin_invoice_items` by `product_id` (joined to invoices
  for the date filter), left join `fin_products` for canonical `name` (coalesce `max(description)` when
  `product_id` null), returning `{ productId, code, name, revenue, qty, lines }`. One query serves both
  Revenue/Quantity toggle modes (UI sorts/relabels).
- `topClients(ctx, period, { limit = 10 })` → per-client net revenue within the period (group by `client_id`,
  join `fin_clients` for name), top 10.
- Aggregate caching and invalidation follow the [Caching section](#caching-valkey-not-cloudflare).

### UI (`/finances/+page.{server.ts,svelte}`)

- Load reads the period from `url`, calls the four cached aggregates in parallel (gated by
  `isModuleEnabled('finances')`), and `depends('finances:data')`.
- **Period controls** (top of page): a date-range picker (from/to) + a `[Day | Week | Month]` granularity
  segmented control. Changing them updates the URL query (`goto(\`?from=…&to=…&bucket=…\`, { keepFocus,
  noScroll })`) → reruns the load. Presets (Last 30d / 12m / YTD / All) set the range.
- **KPI row:** Net revenue · Avg ticket · Invoices · Unique clients · New clients · Discount rate · Period
  growth % · Void rate.
- **Revenue area chart** (ECharts via `src/lib/components/charts/Chart.svelte`): x = bucket; **toggle**
  ([Per period ↔ Cumulative]) switches the net series between bucket value and running total; a **discount**
  series overlaid (matching mode) so discounts are visible. _"Includes discounts"_ = net area + visible
  discount series + Discount KPI.
- **Avg-ticket chart** (ECharts line): avg ticket (net/invoices) per bucket over the range.
- **Top Products** bar with a **toggle** ([Revenue ↔ Quantity]); labels use catalog names.
- **Top Clients** horizontal bar (top 10).
- Toggles + presets are local Svelte `$state`; period lives in the URL (shareable/back-button friendly).
- **Explicitly NOT built** (data empty): payment-method donut, seller chart, status pie — noted in the page.
- i18n keys for all labels/toggles/presets in `messages/{en,es}.json`.

---

## Part B — CRM↔Finance bridge (additive, `bothEnabled`-guarded, no coupling)

### Service — `src/server/services/crm-finance.service.ts`

- Reuse the EXISTING `normPhone` (digits-only) already in `crm-contacts.service.ts` (export it) — do NOT add a
  second phone-normalizer (DRY). The cross-org-safe matching is done IN SQL via
  `right(regexp_replace(coalesce(x,''),'\D','','g'), 9)` (last-9 digits, Peru) on both sides.
- `contactFinanceMap(ctx)` → `Record<contactId, { revenue, invoices, lastPurchaseAt }>`. ONE org-scoped SQL
  query: `crm_contact_identities` (channel='whatsapp') → `right(digits,9)` → join `fin_clients` on matching
  `right(digits(phone),9)` → join `fin_invoices` on `client_id` → group by `contact_id`. Returns `{}` unless
  `bothEnabled(ctx,'crm','finances')`. Keyed by `contact_id` (the roster already has it — no need to expose
  phones to the client). This service is the ONLY place the two domains meet; neither imports the other.
- `contactFinanceSummary(ctx, contactId)` → `{ revenue, invoices, lastPurchaseAt, recentInvoices: [{ id,
documentId, issuedAt, total, status }] }` (recent limit 10) via the same join scoped to one contact; `null`
  unless `bothEnabled` and a match exists.

### `/crm/customers`

- After the existing `listContactsCached(ctx)` read (the roster cache stays finance-free), if `bothEnabled`
  fetch `contactFinanceMap(ctx)` and merge `{ revenue, invoices, lastPurchase }` onto each roster row by
  `contact_id`. Pass a `financeEnabled` flag to the page.
- Table: three new optional columns (Revenue · Invoices · Last purchase), shown only when `financeEnabled`;
  the existing client-side sort gains a `revenue` key. ~332 rows populate; the rest render blank (additive).

### `/crm/[contactId]` detail

- Load: if `bothEnabled`, call `contactFinanceSummary(ctx, id)`; add `finance` to the returned object (null
  when no match).
- UI: a **Financials card** (revenue, # invoices, last purchase, recent invoices each linking to
  `/finances/invoices/[id]`). Rendered only when `data.finance` is non-null. No card when finances is disabled
  or no match.

---

## Part S — Sync performance (idempotent batch upsert)

**Problem (root-caused on the live data):** `upsertInvoice` opens ONE `withOrgCore` transaction PER invoice
(`SET LOCAL ROLE` + `set_config` = 2 statements) and runs 6 per-row statements inside (client upsert, invoice
upsert, delete+insert items, delete+insert payments) — ~8 sequential round-trips **per invoice**. From Peru to
the us-east-2 pooler (~80–150ms RTT) that is ~0.6–1.2s/invoice → **~30–60 min for 2,391 invoices**, and the
progress bar only advances once per 100-item page. This is the "takes forever / doesn't reflect in the UI"
report.

**Fix — `upsertInvoicesBatch(ctx, invoices: CanonicalInvoice[], productMap: Map<code,id>)`:** one `withOrgCore`
transaction per **page** (not per invoice), with **set-based** statements:

1. Multi-row upsert all clients in the page → `insert … values (…N rows) on conflict (org,provider,
provider_ref) do update …` returning `(provider_ref → id)`.
2. Multi-row upsert all invoices (resolving `client_id` from step 1's map, `product_id` not here) → returning
   `(provider_ref → invoice id)`.
3. `delete from fin_invoice_items where invoice_id = any($invoiceIds)` (one statement for the whole page).
4. Multi-row insert all items (resolving `product_id` from `productMap` by `code`).
5. `delete from fin_payments where invoice_id = any($invoiceIds)` + multi-row insert all payments.
   → ~6 statements + 2 tx-overhead **per page** instead of per invoice: **~100× fewer round-trips**. A 100-row
   page goes from ~100s to ~1s; full backfill from ~30–60 min to ~½–1 min.

- `advanceJob` calls `upsertInvoicesBatch(page.invoices, productMap)` once per page (replacing the per-invoice
  loop), builds `productMap` once per run (`select code,id from fin_products`), and `heartbeat`s after each page
  — now fast, so `processed/total` advances smoothly (also fixes the "doesn't reflect in UI").
- **Idempotency preserved:** all writes are `on conflict do update` / delete-then-insert keyed on the same
  natural keys; re-running a page is a no-op-equivalent. A page is one transaction → atomic: a bad row rolls
  back the page, `advanceJob` marks the job `failed` with the cursor preserved, and the resume re-pulls that
  page. The old per-invoice "5 consecutive failures" rule is replaced by page-level atomic failure.
- Keep a thin `upsertInvoice(ctx, inv)` = `upsertInvoicesBatch(ctx, [inv], map)` for any single-item caller/test.
- Chunk guard: if SUSII `page_size` is ever raised far above 100, cap the batch (e.g. 200/tx) so parameter
  counts stay sane; at `page_size=100` one page = one batch.

## Part P — List performance (windowed render)

The `/finances/invoices`, `/finances/payments`, and `/finances/clients` pages currently render EVERY row
(`listInvoices` returns up to 500; invoices alone are 2,391+). Apply the **same windowing pattern `/crm` uses**
(`crm/+page.svelte` / `customers`): keep the full filtered/sorted list in memory but render only a window
(`PAGE = 60`), growing on scroll. Use a **scroll listener** on the scroll container (NOT IntersectionObserver —
the CRM work found IO unreliable under programmatic scroll), incrementing `renderLimit` by `PAGE`; reset
`renderLimit` to `PAGE` whenever the filtered/sorted set changes. Raise the server `limit` to cover the full
set (e.g. 5000) so client-side search/sort is complete. This mirrors `crm-slowness-rootcause-windowing`.

## Caching (Valkey; not Cloudflare)

- **Valkey-cache the finance aggregates** (`financeSummary`, `revenueSeries`, `topProducts`, `topClients`, and
  `clientRevenueRows`) with the existing `cached(key, {ttl,swr,tags}, fn)` + `keys.hub(name,{t,…})` helper
  (same pattern as `listContactsCached`). Key includes the org AND the period `(from,to,bucket)` so each range
  is cached independently. Series keys also distinguish stock-module availability and explicit bucket
  timezones from callers using the database session default. TTL ~2m + short SWR.
  Define `financeCacheTags(orgId)`; **bust them on sync
  completion** (in `advanceJob` on success/finish) and on catalog/source writes, so a finished sync
  immediately reflects fresh numbers.
- **Cloudflare is NOT applicable here:** these are per-org, authenticated, dynamic API/page responses — CF edge
  caching is for public/static assets (it can't safely cache per-tenant authed data, and would risk
  cross-tenant leakage). The only CF-cacheable finance surface is none; the static plugin-UI asset caching is
  already handled separately. So the caching layer is Valkey only.

---

## Error handling

- Catalog import is idempotent (`onConflictDoNothing` + null-guarded backfill); safe to re-run.
- `product_id`/`client_id` are nullable — uncatalogued codes / unmatched clients simply don't resolve; UI
  falls back (description / blank). No hard failures.
- Batch sync: a page is atomic; on any row error the page tx rolls back, the job ends `failed` with the cursor
  preserved, and the resume re-pulls the page idempotently.
- Bridge degrades to empty when either module is disabled or no phone match — never errors.
- Dashboard period parsing follows [Period filter](#period-filter-drives-every-aggregate); charts render
  only available data (empty series omitted).
- Cache miss/failure falls back to a live query (the `cached` helper degrades, per the cache-backend hardening).

## Testing

- `parsePeriod(url)` unit tests (defaults, clamping, bad ISO, bucket enum).
- `finance-products.service`: import creates+links, re-import is a no-op, coverage counts; `topProducts`
  groups by product and resolves catalog name with description fallback (mock-db).
- `financeSummary` / `revenueSeries` coerce aggregates to Number (no string concatenation) and respect the
  period.
- `upsertInvoicesBatch`: a multi-invoice page issues set-based statements (assert via mock-db call shape) and
  is idempotent; the single-item `upsertInvoice` wrapper still works.
- `contactFinanceMap` / `contactFinanceSummary` return empty/null when `bothEnabled` is false; group by
  contact when true.
- `bun run check` 0/0; Svelte files validated via the autofixer.

## Rollout (plan sequence)

1. **C-schema** — `fin_products` + `product_id` FK + `client_id` FK migrations → apply to gxv + backfills.
2. **S — batch sync** (highest user pain): `upsertInvoicesBatch` + `advanceJob` rewrite + cache-bust on finish.
   Unblocks fast, visible re-syncs.
3. **C-rest** — catalog service (`importFromBilling`/`catalogCoverage`), `/finances/products` page + nav +
   endpoints; product_id resolution in the batch.
4. **A** — `parsePeriod`, parameterized cached aggregates, ECharts dashboard (period controls, KPIs, revenue
   area + avg-ticket charts, top products/clients).
5. **P** — windowed render on invoices/payments/clients lists.
6. **B** — `crm-finance.service` (reuse `normPhone`); `/crm/customers` columns; detail Financials card.

Subagent-driven execution (fresh implementer per task + task review + final whole-branch review), same as the
bg-sync build. Migrations and gxv applies are orchestrator-handled (Supabase MCP).
