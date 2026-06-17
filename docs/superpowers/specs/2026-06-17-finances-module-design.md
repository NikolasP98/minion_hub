# Finances Module — Design

**Date:** 2026-06-17
**Status:** Approved (brainstormed interactively)
**Area:** `minion_hub` — new hub-native Finances module + optional CRM integration

## Goal

A hub-native **Finances** module that ingests an org's sales/billing data and
surfaces it (dashboard, invoices, payments, client revenue). It must be:

- **Provider-agnostic** — SUSII is FACES Sculptors' billing system, but future
  orgs use other systems. The schema is canonical (CORE columns + `jsonb` for
  provider extras); billing systems plug in via **connectors**.
- **Separate from CRM, additive when both present** — Finances and CRM are
  independent hub-native modules with no cross-imports or FKs. They communicate
  only through the shared **org + client document number (RUC/DNI)** natural key,
  and only when both are enabled for the org. Either works standalone.

Non-goals (this milestone): the xlsx exports are **ignored** (the SUSII REST
API/ETL is the feed; xlsx only covered 2022→ which we are not backfilling).
Multi-currency reporting beyond storing `currency` is out of scope.

## Why hub-native (not a gateway plugin)

Reconnaissance (2026-06-17): CRM is hub-native — its own Postgres tables
(`pg-crm-schema.ts`), routes under `/crm`, nav via `BUILTIN_PLUGIN_ITEMS` in
`src/lib/components/layout/sections.ts`. Gateway plugins are manifest + iframe +
config/SQLite-in-state-dir and **no gateway plugin owns Postgres or joins across
modules**. Finances owns relational data joined to CRM by DNI, so it follows the
CRM pattern: hub-native, hub Postgres (project `gxvsaskbohavnurfvshr`).

The existing paperclip plugin `susii-etl` syncs SUSII into a `susii` schema in a
**different** Supabase project (`fsdaqawhzvlphcbxzzji`) for paperclip's CFO
agents. That stays as-is. The hub keeps its **own canonical projection** so it is
self-contained and can join CRM in-DB.

## Architecture

```
api.susii.com (or other provider)
        │  SusiiConnector.pull(since)  → CanonicalInvoice[]
        ▼
  finance sync job (hub cron, per fin_source)
        │  upsert (header→children, delete-then-insert, watermark)
        ▼
  hub Postgres: fin_invoices / fin_invoice_items / fin_payments / fin_clients
        │
   ┌────┴─────────────────────────────┐
   ▼                                   ▼
 /finances UI (dashboard, lists)   finance-crm bridge (guarded by bothEnabled)
                                       → distinctVisitDates, LTV, revenue RFM-M,
                                         CRM context on finance views
```

## Canonical schema (`pg-finance-schema.ts`, own migration, `withOrgCore` + RLS)

All tables `org_id text` (matches CRM/messages) and route through `withOrgCore`
(role `app_ledger` + `app.current_org_id` GUC), policies in a hand-written
companion migration `supabase/migrations/<ts>_finance.sql` (Drizzle does not
manage roles/policies — same convention as CRM).

- **`fin_invoices`** — CORE: `id uuid pk`, `org_id`, `provider text` (e.g.
  `'susii'`), `provider_ref text` (external sale id), `number text` (human sale
  number), `document_id text` (e.g. `BE01-2164`), `issued_at timestamptz`,
  `client_name text`, `client_doc_type text`, `client_doc_number text` (RUC/DNI —
  the CRM link), `client_email text`, `currency text`, `subtotal numeric`,
  `tax numeric`, `discount numeric`, `total numeric`, `status text` (normalized:
  `paid|partial|pending|void`), `seller text`, `note text`, `metadata jsonb`
  (provider extras: exchange_rate, uuid, service_charge, …), `synced_at`,
  `created_at`. Unique `(org_id, provider, provider_ref)`.
- **`fin_invoice_items`** — `id uuid pk`, `org_id`, `invoice_id uuid FK ON DELETE
  CASCADE`, `code`, `description`, `category`, `quantity numeric`, `unit_price
  numeric`, `discount numeric`, `tax numeric`, `total numeric`, `metadata jsonb`.
- **`fin_payments`** — `id uuid pk`, `org_id`, `invoice_id uuid FK ON DELETE
  CASCADE`, `provider_ref text`, `method text` (normalized) + raw in metadata,
  `paid_at timestamptz`, `amount numeric`, `status text`, `metadata jsonb`
  (monto_deuda, proxima_deuda, …).
- **`fin_clients`** — `id uuid pk`, `org_id`, `provider`, `provider_ref`,
  `name`, `doc_type`, `doc_number text` (DNI), `email`, `phone`, `metadata
  jsonb`. Unique `(org_id, provider, provider_ref)`.
- Indexes: `(org_id, client_doc_number)` and `(org_id, issued_at)` on invoices;
  `(org_id, paid_at)` on payments; `(org_id, doc_number)` on clients.

CASCADE on items/payments enables the delete-then-insert sync pattern. Money is
`numeric` (exact), never float.

## Connector abstraction

- **`FinanceConnector`** (hub server interface):
  `{ provider: string; pull(opts: { businessId; since?: string }): AsyncIterable<CanonicalInvoice> }`
  where `CanonicalInvoice = { invoice; items[]; payments[]; client }` in canonical
  shape. Each connector owns provider auth + pagination + mapping (+ stashing
  non-core fields into `metadata`).
- **`fin_sources`** table — per-org connector config: `org_id`, `provider`,
  `config jsonb` (e.g. `{ businessId: 5922 }`), `secret_refs jsonb` (names of
  hub-resolved secrets, not values), `enabled bool`, `watermark text`
  (last `modified_after`), `last_sync_at`, `last_status`. A `(org_id, provider)`
  is unique.
- **`SusiiConnector`** (first impl) — reuses the documented SUSII REST path:
  DRF token login `POST api.susii.com/auth/login/` → `Token <key>`; paginate
  `GET /v1/sales/sales/?business=<id>&modified_after=<iso>&page_size=` following
  `.next`; map each rich sale JSON → canonical (top-level→invoice, `client`→
  fin_clients, `items[]`→fin_invoice_items, `payments[]`→fin_payments;
  `document_set`/uuid/exchange_rate → metadata). 401 → re-auth. Credentials from
  hub secret resolution (env/Infisical), referenced by `fin_sources.secret_refs`.

## Sync job

A hub cron (mirrors how other hub periodic work runs) iterates enabled
`fin_sources`, resolves the connector, walks `pull(since=watermark - small
overlap)`, and per invoice runs `applyInvoiceInTx` (upsert client; upsert invoice
ON CONFLICT(org,provider,provider_ref); delete-then-insert items + payments).
Records counts + new watermark + status on `fin_sources`. Per-invoice tx
isolation; abort after N consecutive failures (proven in the paperclip ETL).
Also exposes a manual "Sync now" endpoint for the Finances UI. A backfill is the
same path with `since` pointed at the start date.

## Per-org module toggle

New hub registry **`app_modules(org_id, module_id text, enabled bool, updated_at)`**;
absent row = enabled (so CRM keeps working as today). Modules `crm` and
`finances` register here. A small service `isModuleEnabled(ctx, moduleId)` +
`bothEnabled(ctx, a, b)`. The sidebar's `BUILTIN_PLUGIN_ITEMS` rendering filters
hub-native entries by module-enabled; cross-module reads guard on `bothEnabled`.
Managed in a **Settings → Modules** panel.

## Nav

Add a `finance` value to `PluginNavCategory`, a `PLUGIN_NAV_GROUPS` entry with an
i18n `nav_finance` label, and a `BUILTIN_PLUGIN_ITEMS` entry
`{ category: 'finance', href: '/finances', icon: <money>, matcher: /^\/finances/ }`
in `src/lib/components/layout/sections.ts`.

## CRM ↔ Finances bridge (additive, guarded, fail-soft)

A hub service `finance-crm-bridge.ts`, every method first checks
`bothEnabled(ctx, 'crm', 'finances')` and returns a neutral value otherwise.
Link strictly on **org + client_doc_number == CRM contact DNI** (in-DB SQL since
both schemas are in the hub project):

- **`distinctVisitDates(ctx, dni)`** → `count(distinct date(paid_at))` from
  `fin_payments`⨝`fin_invoices` by DNI. This replaces the stubbed seam in
  `crm-contacts.service.ts` → auto-advances the **Customer/Loyal** funnel stage
  (≥2 distinct paid dates = Loyal).
- **Contact revenue card** on `/crm/[contactId]`: lifetime value (sum payments),
  #invoices/treatments, last purchase — only when bothEnabled and DNI present.
- **Revenue-based RFM "M"**: when finances enabled+present, the CRM score's
  Monetary term uses real revenue (DNI-summed); falls back to message-volume
  otherwise. Implemented behind a flag in `crm-scoring` so CRM stays standalone.
- **CRM context on finance views**: on a finance client/invoice, show the linked
  CRM contact's name, funnel stage, tags + deep link to `/crm/<id>`.

No CRM file imports a finance module at the type level beyond the bridge service;
the bridge is the single, optional seam. If finances is disabled/absent, CRM
behaves exactly as it does today.

## UI (`/finances`)

- **Dashboard** — revenue trend (monthly), AR aging buckets, top procedures
  (line-grain), client LTV leaders. (Same shapes as the existing CFO views
  `v_monthly_sales` / `v_ar_aging` / `v_top_procedures` / `v_customer_ltv`,
  computed on-read over `fin_*`.)
- **Invoices** — list (filter by date/status/seller) + detail (line items +
  payments + linked CRM contact when bridged).
- **Payments** — list by method/date.
- **Clients** — revenue per client, with CRM deep link when bridged.
- **Settings** — connector config (provider, business id, credentials refs) +
  "Sync now" + last-sync status; module enable toggle.

## Phasing

- **P1 — Finances standalone:** canonical schema + migration; connector
  abstraction + `SusiiConnector`; `fin_sources` + sync job + manual sync;
  `app_modules` toggle; nav "Finances" group; dashboard + invoices + payments +
  clients + settings UI. Verifiable end-to-end with FACES SUSII data, no CRM
  dependency.
- **P2 — CRM ↔ Finances bridge:** `finance-crm-bridge.ts`; wire real
  `distinctVisitDates` → Loyal; contact revenue card; revenue RFM-M; CRM context
  on finance views. All guarded by `bothEnabled`.

## Security / multi-tenancy

- All `fin_*` queries route through `withOrgCore` (RLS backstop); never
  `getCoreDb()` directly.
- Connector credentials are never stored in `fin_sources` directly — only secret
  *references*; values resolve via the hub's secret mechanism at sync time.
- The bridge is read-only across modules and org-scoped on both sides.

## Verification

`bun run check` 0/0; unit tests for the SUSII→canonical mapper (fixture from a
real sale JSON) and for `distinctVisitDates`/LTV aggregation; a guarded-bridge
test proving CRM is unaffected when finances is disabled. Manual: configure FACES
SUSII source → Sync now → invoices/payments populate → dashboard renders →
(P2) a contact with ≥2 paid dates shows Loyal + LTV.

## Open items / follow-ups

- Confirm hub secret mechanism for connector creds (env vs Infisical project) at
  P1 start; FACES SUSII creds already exist in Infisical `minion-paperclip`.
- Future connectors (other orgs' billing systems) implement `FinanceConnector`.
- Optional later: reconcile/import pre-2024 history if ever needed (xlsx parker).
- Optional later: a `fin_products` mirror for procedure-name lookups.
