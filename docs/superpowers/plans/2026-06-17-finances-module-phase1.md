# Finances Module — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone, provider-agnostic hub-native **Finances** module that ingests an org's sales/billing data (SUSII first) into canonical hub Postgres tables and surfaces it (dashboard, invoices, payments, clients), with a per-org module toggle and a new "Finances" sidebar group. No CRM dependency (that bridge is Phase 2).

**Architecture:** Hub-native, mirroring CRM: canonical `fin_*` Drizzle tables in `minion_hub` (project `gxvsaskbohavnurfvshr`) with CORE columns + `metadata jsonb`; a hand-written RLS companion migration at the **meta-repo root** `supabase/migrations/`. Billing systems plug in via a `FinanceConnector` interface; `SusiiConnector` pulls `api.susii.com` (DRF token) and maps its rich sale JSON to canonical rows. A sync service upserts (header→children, delete-then-insert, watermark). All DB access routes through `withOrgCore` (role `app_ledger` + `app.current_org_id` GUC; RLS is the backstop).

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Bun, Drizzle ORM (Postgres/Supabase), Paraglide i18n, Vitest. `ai` + `@ai-sdk/openai` are NOT used here.

## Global Constraints

- TypeScript strict; no `any`, no `@ts-nocheck`. `bun run check` must stay **0 errors / 0 warnings**.
- Svelte 5 only: runes (`$props`/`$state`/`$derived`), `onclick={}`, `Snippet` for children. No Svelte 4 patterns.
- Every org-scoped DB read/write goes through `withOrgCore(ctx, (tx) => …)` — NEVER `getCoreDb()` directly. `ctx` comes from `getCoreCtx(locals)`; 401 if null.
- Money columns are Postgres `numeric` (Drizzle `numeric(...)` → string in JS); never float. Parse with `Number()` only at the presentation/aggregation edge.
- Core DB migrations are **hand-written, idempotent (`IF NOT EXISTS`), surgical-apply** — NEVER `drizzle-kit push` against the core DB. New RLS migrations go in the meta-repo root `supabase/migrations/<UTCstamp>_<name>.sql` and are applied via Supabase MCP `apply_migration` (dev branch first).
- New user-facing strings are Paraglide keys in `messages/{en,es}.json` (both locales), then `npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`.
- `org_id` is `organizations.id` as text, identical to `messages.org_id` / `crm_*` `org_id`.
- Connector credentials are referenced by NAME in `fin_sources.secret_refs`; values resolve from `$env/dynamic/private` at sync time. Never store secret values in the DB.
- Commit after each task with a `feat(finances): …` / `test(finances): …` message.

---

## File Structure

**Create:**
- `src/server/db/pg-finance-schema.ts` — canonical Drizzle tables + types.
- `supabase/migrations/<stamp>_finance.sql` (meta-repo root) — tables + RLS + grants.
- `supabase/migrations/<stamp>_app_modules.sql` (meta-repo root) — module toggle table + RLS.
- `src/server/db/pg-modules-schema.ts` — `app_modules` Drizzle table.
- `src/server/finance/connector.ts` — `CanonicalInvoice`, `FinanceConnector`, registry.
- `src/server/finance/connectors/susii-client.ts` — DRF login + paginated sales walker.
- `src/server/finance/connectors/susii-mapper.ts` — SUSII sale JSON → `CanonicalInvoice` (pure).
- `src/server/finance/connectors/susii-mapper.test.ts` — mapper unit tests.
- `src/server/finance/connectors/susii-connector.ts` — `FinanceConnector` impl.
- `src/server/finance/connectors/susii-client.test.ts` — client unit tests (mocked fetch).
- `src/server/services/finance.service.ts` — canonical upsert + list/aggregate reads.
- `src/server/services/finance-sync.service.ts` — sync orchestration + watermark.
- `src/server/services/finance-sync.helpers.ts` + `.test.ts` — pure watermark/status helpers.
- `src/server/services/modules.service.ts` — `isModuleEnabled` / `bothEnabled` / `setModuleEnabled`.
- `src/server/services/finance-aggregate.ts` + `.test.ts` — pure dashboard aggregations.
- `src/routes/api/finances/sync/+server.ts` — `POST` manual sync.
- `src/routes/api/finances/sources/+server.ts` — `GET`/`PUT` connector config.
- `src/routes/api/modules/+server.ts` — `GET`/`PUT` module enabled state.
- `src/routes/(app)/finances/+layout.svelte` — finance sub-nav (mirrors CRM nav pattern).
- `src/routes/(app)/finances/+page.{server.ts,svelte}` — dashboard.
- `src/routes/(app)/finances/invoices/+page.{server.ts,svelte}` — invoices list.
- `src/routes/(app)/finances/invoices/[id]/+page.{server.ts,svelte}` — invoice detail.
- `src/routes/(app)/finances/payments/+page.{server.ts,svelte}` — payments list.
- `src/routes/(app)/finances/clients/+page.{server.ts,svelte}` — client revenue list.
- `src/routes/(app)/finances/settings/+page.{server.ts,svelte}` — connector config + sync + module toggle.
- `src/lib/components/finance/FinanceNav.svelte` — finance secondary sidebar.

**Modify:**
- `src/lib/components/layout/sections.ts` — add `finance` category, nav group, builtin item, module-enabled filter.
- `messages/en.json`, `messages/es.json` — `nav_finance` + `fin_*` keys.

---

## Task 1: Canonical finance Drizzle schema

**Files:**
- Create: `src/server/db/pg-finance-schema.ts`
- Create: `src/server/db/pg-modules-schema.ts`
- Test: `src/server/db/pg-finance-schema.test.ts`

**Interfaces:**
- Produces: tables `finInvoices`, `finInvoiceItems`, `finPayments`, `finClients`, `finSources` (from pg-finance-schema.ts); table `appModules` (from pg-modules-schema.ts). Inferred types `FinInvoice`, `FinInvoiceItem`, `FinPayment`, `FinClient`, `FinSource`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/db/pg-finance-schema.test.ts
import { describe, it, expect } from 'vitest';
import { finInvoices, finInvoiceItems, finPayments, finClients, finSources } from './pg-finance-schema';

describe('pg-finance-schema', () => {
  it('fin_invoices has the CORE columns + metadata', () => {
    const cols = Object.keys(finInvoices);
    for (const c of ['orgId', 'provider', 'providerRef', 'number', 'documentId', 'issuedAt',
      'clientName', 'clientDocType', 'clientDocNumber', 'clientEmail', 'currency',
      'subtotal', 'tax', 'discount', 'total', 'status', 'seller', 'note', 'metadata', 'syncedAt']) {
      expect(cols).toContain(c);
    }
  });
  it('child tables cascade-key on invoiceId', () => {
    expect(Object.keys(finInvoiceItems)).toContain('invoiceId');
    expect(Object.keys(finPayments)).toContain('invoiceId');
  });
  it('finSources tracks per-org provider config + watermark', () => {
    for (const c of ['orgId', 'provider', 'config', 'secretRefs', 'enabled', 'watermark', 'lastSyncAt'])
      expect(Object.keys(finSources)).toContain(c);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts`
Expected: FAIL — `Cannot find module './pg-finance-schema'`.

- [ ] **Step 3: Write the schema**

```ts
// src/server/db/pg-finance-schema.ts
import { pgTable, uuid, text, jsonb, numeric, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Hub-native Finances — canonical, provider-agnostic schema. CORE columns are
 * common to any billing system; provider-specific extras live in `metadata`.
 * Tenancy: `org_id text` (== messages.org_id / crm_*), enforced by withOrgCore
 * (role app_ledger + app.current_org_id GUC). Policies/grants in the companion
 * migration <stamp>_finance.sql (meta-repo root). Money is `numeric` (string in JS).
 */
export const finInvoices = pgTable(
  'fin_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),           // e.g. 'susii'
    providerRef: text('provider_ref').notNull(),    // external sale id
    number: text('number'),                         // human sale number
    documentId: text('document_id'),                // e.g. 'BE01-2164'
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    clientName: text('client_name'),
    clientDocType: text('client_doc_type'),
    clientDocNumber: text('client_doc_number'),     // RUC/DNI — the CRM link key
    clientEmail: text('client_email'),
    currency: text('currency'),
    subtotal: numeric('subtotal'),
    tax: numeric('tax'),
    discount: numeric('discount'),
    total: numeric('total'),
    status: text('status'),                         // 'paid'|'partial'|'pending'|'void'
    seller: text('seller'),
    note: text('note'),
    metadata: jsonb('metadata').notNull().default({}),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('fin_invoices_provider_ref_uniq').on(t.orgId, t.provider, t.providerRef),
    dniIdx: index('fin_invoices_org_dni_idx').on(t.orgId, t.clientDocNumber),
    issuedIdx: index('fin_invoices_org_issued_idx').on(t.orgId, t.issuedAt),
  }),
);

export const finInvoiceItems = pgTable(
  'fin_invoice_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().references(() => finInvoices.id, { onDelete: 'cascade' }),
    code: text('code'),
    description: text('description'),
    category: text('category'),
    quantity: numeric('quantity'),
    unitPrice: numeric('unit_price'),
    discount: numeric('discount'),
    tax: numeric('tax'),
    total: numeric('total'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({ invoiceIdx: index('fin_invoice_items_invoice_idx').on(t.invoiceId) }),
);

export const finPayments = pgTable(
  'fin_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    invoiceId: uuid('invoice_id').notNull().references(() => finInvoices.id, { onDelete: 'cascade' }),
    providerRef: text('provider_ref'),
    method: text('method'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    amount: numeric('amount'),
    status: text('status'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    invoiceIdx: index('fin_payments_invoice_idx').on(t.invoiceId),
    paidIdx: index('fin_payments_org_paid_idx').on(t.orgId, t.paidAt),
  }),
);

export const finClients = pgTable(
  'fin_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref').notNull(),
    name: text('name'),
    docType: text('doc_type'),
    docNumber: text('doc_number'),
    email: text('email'),
    phone: text('phone'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    uniq: uniqueIndex('fin_clients_provider_ref_uniq').on(t.orgId, t.provider, t.providerRef),
    dniIdx: index('fin_clients_org_dni_idx').on(t.orgId, t.docNumber),
  }),
);

/** Per-org billing connector config + sync watermark. */
export const finSources = pgTable(
  'fin_sources',
  {
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    config: jsonb('config').notNull().default({}),       // e.g. { businessId: 5922 }
    secretRefs: jsonb('secret_refs').notNull().default({}), // { username: 'SUSII_USERNAME', ... }
    enabled: boolean('enabled').notNull().default(true),
    watermark: text('watermark'),                        // last modified_after ISO
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastStatus: text('last_status'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('fin_sources_org_provider_uniq').on(t.orgId, t.provider) }),
);

export type FinInvoice = typeof finInvoices.$inferSelect;
export type FinInvoiceItem = typeof finInvoiceItems.$inferSelect;
export type FinPayment = typeof finPayments.$inferSelect;
export type FinClient = typeof finClients.$inferSelect;
export type FinSource = typeof finSources.$inferSelect;
```

```ts
// src/server/db/pg-modules-schema.ts
import { pgTable, text, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/** Per-org enable state for hub-native modules ('crm', 'finances'). Absent row = enabled. */
export const appModules = pgTable(
  'app_modules',
  {
    orgId: text('org_id').notNull(),
    moduleId: text('module_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.moduleId] }) }),
);

export type AppModule = typeof appModules.$inferSelect;
```

- [ ] **Step 4: Run test + typecheck**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts && bun run check`
Expected: test PASS; check 0 errors / 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/pg-finance-schema.ts src/server/db/pg-modules-schema.ts src/server/db/pg-finance-schema.test.ts
git commit -m "feat(finances): canonical fin_* + app_modules drizzle schema"
```

---

## Task 2: RLS companion migrations (meta-repo root)

**Files:**
- Create: `supabase/migrations/20260617120000_finance.sql` (meta-repo root — `/home/nikolas/Documents/CODE/MINION/supabase/migrations/`)
- Create: `supabase/migrations/20260617120500_app_modules.sql` (meta-repo root)

**Interfaces:**
- Produces: live `fin_*` + `app_modules` tables in the hub Supabase project with RLS policies, readable/writable by role `app_ledger` under the `app.current_org_id` GUC.

- [ ] **Step 1: Write the finance migration**

Mirror `supabase/migrations/20260614031500_crm.sql` exactly (idempotent, `--> statement-breakpoint` between statements). Create `public.fin_invoices`, `fin_invoice_items`, `fin_payments`, `fin_clients`, `fin_sources` with the same columns as the Drizzle schema (Task 1), then for EACH table:

```sql
grant select, insert, update, delete on public.fin_invoices to app_ledger;
--> statement-breakpoint
alter table public.fin_invoices enable row level security;
--> statement-breakpoint
alter table public.fin_invoices force  row level security;
--> statement-breakpoint
create policy fin_invoices_org_guc on public.fin_invoices
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
```

Repeat the grant/enable/force/policy block for `fin_invoice_items`, `fin_payments`, `fin_clients`, `fin_sources` (policy name `<table>_org_guc`). Include the table DDL with `create table if not exists` + the indexes/unique-indexes from Task 1 (`create [unique] index if not exists …`).

- [ ] **Step 2: Write the app_modules migration**

```sql
create table if not exists public.app_modules (
  org_id     text not null,
  module_id  text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, module_id)
);
--> statement-breakpoint
grant select, insert, update, delete on public.app_modules to app_ledger;
--> statement-breakpoint
alter table public.app_modules enable row level security;
--> statement-breakpoint
alter table public.app_modules force row level security;
--> statement-breakpoint
create policy app_modules_org_guc on public.app_modules
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
```

- [ ] **Step 3: Apply to a Supabase dev branch and verify**

Apply via Supabase MCP `apply_migration` (project `gxvsaskbohavnurfvshr`, dev branch). Then verify with `list_tables` (or `execute_sql`):

Run (MCP `execute_sql`): `select table_name from information_schema.tables where table_name like 'fin_%' or table_name = 'app_modules' order by 1;`
Expected: `app_modules, fin_clients, fin_invoice_items, fin_invoices, fin_payments, fin_sources`.

Run: `select tablename, policyname from pg_policies where tablename like 'fin_%' or tablename='app_modules';`
Expected: one `*_org_guc` policy per table.

- [ ] **Step 4: Commit (in the meta-repo)**

```bash
cd /home/nikolas/Documents/CODE/MINION
git add supabase/migrations/20260617120000_finance.sql supabase/migrations/20260617120500_app_modules.sql
git commit -m "feat(db): finance + app_modules tables with org-GUC RLS"
```

---

## Task 3: Canonical types + connector interface

**Files:**
- Create: `src/server/finance/connector.ts`

**Interfaces:**
- Produces: types `CanonicalInvoice`, `CanonicalLineItem`, `CanonicalPayment`, `CanonicalClient`; interface `FinanceConnector { provider: string; pull(opts: PullOpts): AsyncIterable<CanonicalInvoice> }`; type `PullOpts = { config: Record<string, unknown>; secrets: Record<string, string>; since?: string }`; `getConnector(provider: string): FinanceConnector | null` + `registerConnector(c: FinanceConnector): void`.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/finance/connector.test.ts
import { describe, it, expect } from 'vitest';
import { registerConnector, getConnector, type FinanceConnector } from './connector';

describe('connector registry', () => {
  it('registers and resolves a connector by provider', () => {
    const fake: FinanceConnector = { provider: 'fake', async *pull() {} };
    registerConnector(fake);
    expect(getConnector('fake')).toBe(fake);
    expect(getConnector('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/finance/connector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the interface + registry**

```ts
// src/server/finance/connector.ts
export interface CanonicalLineItem {
  code: string | null;
  description: string | null;
  category: string | null;
  quantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  tax: number | null;
  total: number | null;
  metadata: Record<string, unknown>;
}
export interface CanonicalPayment {
  providerRef: string | null;
  method: string | null;
  paidAt: string | null;     // ISO
  amount: number | null;
  status: string | null;
  metadata: Record<string, unknown>;
}
export interface CanonicalClient {
  provider: string;
  providerRef: string;
  name: string | null;
  docType: string | null;
  docNumber: string | null;  // RUC/DNI
  email: string | null;
  phone: string | null;
  metadata: Record<string, unknown>;
}
export interface CanonicalInvoice {
  provider: string;
  providerRef: string;
  number: string | null;
  documentId: string | null;
  issuedAt: string | null;   // ISO
  clientName: string | null;
  clientDocType: string | null;
  clientDocNumber: string | null;
  clientEmail: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  total: number | null;
  status: string | null;     // 'paid'|'partial'|'pending'|'void'
  seller: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  items: CanonicalLineItem[];
  payments: CanonicalPayment[];
  client: CanonicalClient | null;
}

export interface PullOpts {
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  since?: string;
}
export interface FinanceConnector {
  provider: string;
  pull(opts: PullOpts): AsyncIterable<CanonicalInvoice>;
}

const REGISTRY = new Map<string, FinanceConnector>();
export function registerConnector(c: FinanceConnector): void {
  REGISTRY.set(c.provider, c);
}
export function getConnector(provider: string): FinanceConnector | null {
  return REGISTRY.get(provider) ?? null;
}
```

- [ ] **Step 4: Run test + check**

Run: `bun run vitest run src/server/finance/connector.test.ts && bun run check`
Expected: PASS; 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/finance/connector.ts src/server/finance/connector.test.ts
git commit -m "feat(finances): connector interface + registry"
```

---

## Task 4: SUSII REST client

**Files:**
- Create: `src/server/finance/connectors/susii-client.ts`
- Test: `src/server/finance/connectors/susii-client.test.ts`

**Interfaces:**
- Consumes: nothing (uses global `fetch`).
- Produces: `class SusiiClient { constructor(creds: { username: string; password: string; baseUrl?: string }); login(): Promise<void>; salesPages(opts: { businessId: number; since?: string; pageSize?: number }): AsyncIterable<unknown[]> }`. `salesPages` yields arrays of raw sale JSON objects, following `.next`, re-authing once on 401.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/finance/connectors/susii-client.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SusiiClient } from './susii-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

describe('SusiiClient', () => {
  it('logs in (DRF Token) and paginates sales following .next', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))                                   // login
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: 'https://api.susii.com/v1/sales/sales/?page=2', results: [{ id: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: null, results: [{ id: 2 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const got: unknown[] = [];
    for await (const page of c.salesPages({ businessId: 5922 })) got.push(...page);
    expect(got).toEqual([{ id: 1 }, { id: 2 }]);
    // login used Token header on subsequent calls
    const secondCall = fetchMock.mock.calls[1];
    expect((secondCall[1] as RequestInit).headers).toMatchObject({ Authorization: 'Token TOK' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/finance/connectors/susii-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

```ts
// src/server/finance/connectors/susii-client.ts
const DEFAULT_BASE = 'https://api.susii.com';

export class SusiiClient {
  private token: string | null = null;
  private readonly base: string;
  constructor(private creds: { username: string; password: string; baseUrl?: string }) {
    this.base = creds.baseUrl ?? DEFAULT_BASE;
  }

  async login(): Promise<void> {
    const res = await fetch(`${this.base}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.creds.username, password: this.creds.password }),
    });
    if (!res.ok) throw new Error(`susii login failed: ${res.status}`);
    const { key } = (await res.json()) as { key: string };
    this.token = key;
  }

  private async authedGet(url: string): Promise<Response> {
    if (!this.token) await this.login();
    let res = await fetch(url, { headers: { Authorization: `Token ${this.token}` } });
    if (res.status === 401) {
      await this.login();
      res = await fetch(url, { headers: { Authorization: `Token ${this.token}` } });
    }
    return res;
  }

  async *salesPages(opts: { businessId: number; since?: string; pageSize?: number }): AsyncIterable<unknown[]> {
    const u = new URL(`${this.base}/v1/sales/sales/`);
    u.searchParams.set('business', String(opts.businessId));
    u.searchParams.set('page_size', String(opts.pageSize ?? 100));
    if (opts.since) u.searchParams.set('modified_after', opts.since);
    let next: string | null = u.toString();
    while (next) {
      const res = await this.authedGet(next);
      if (!res.ok) throw new Error(`susii sales fetch failed: ${res.status}`);
      const body = (await res.json()) as { results?: unknown[]; next?: string | null };
      yield body.results ?? [];
      next = body.next ?? null;
    }
  }
}
```

- [ ] **Step 4: Run test + check**

Run: `bun run vitest run src/server/finance/connectors/susii-client.test.ts && bun run check`
Expected: PASS; 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/finance/connectors/susii-client.ts src/server/finance/connectors/susii-client.test.ts
git commit -m "feat(finances): SUSII DRF-token REST client with pagination"
```

---

## Task 5: SUSII → canonical mapper (the crux)

**Files:**
- Create: `src/server/finance/connectors/susii-mapper.ts`
- Test: `src/server/finance/connectors/susii-mapper.test.ts`

**Interfaces:**
- Consumes: `CanonicalInvoice` from `../connector`.
- Produces: `mapSusiiSale(sale: Record<string, unknown>): CanonicalInvoice`.

- [ ] **Step 1: Write the failing test** (fixture mirrors the documented SUSII sale shape)

```ts
// src/server/finance/connectors/susii-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { mapSusiiSale } from './susii-mapper';

const SALE = {
  id: 36949872, number: 'BE01-2164', date: '2026-06-16T17:54:00Z', currency_code: 'PEN',
  exchange_rate: '3.73', tax: '68.64', discount: '50', is_paid: true, is_active: true,
  observations: 'x', user: 'facesperu',
  client: { id: 11, name: 'MORALES BERMUDEZ', document_type: 'DNI', document_number: '40853705', email: null, phone: null },
  items: [{ id: 1, code: 'AF2', name: 'Afinamiento Facial', quantity: '1', price: '500', tax: '76.27', discount: '0', selectors: [] }],
  payments: [{ id: 9, date: '2026-06-16T17:54:00Z', method: 'Tarjeta de Crédito', amount: '450', is_paid: true }],
  document_set: [{ id: 5, serial: 'BE01', total: '450' }],
};

describe('mapSusiiSale', () => {
  it('maps CORE fields + DNI + items + payments, stashing extras in metadata', () => {
    const inv = mapSusiiSale(SALE);
    expect(inv.provider).toBe('susii');
    expect(inv.providerRef).toBe('36949872');
    expect(inv.number).toBe('BE01-2164');
    expect(inv.clientDocNumber).toBe('40853705');
    expect(inv.currency).toBe('PEN');
    expect(inv.status).toBe('paid');
    expect(inv.items[0]).toMatchObject({ code: 'AF2', description: 'Afinamiento Facial', quantity: 1, unitPrice: 500 });
    expect(inv.payments[0]).toMatchObject({ method: 'Tarjeta de Crédito', amount: 450, status: 'paid' });
    expect(inv.client?.docNumber).toBe('40853705');
    expect(inv.metadata.exchange_rate).toBe('3.73');     // non-core extra preserved
  });
  it('maps an unpaid sale to status pending and tolerates missing nested arrays', () => {
    const inv = mapSusiiSale({ id: 7, is_paid: false, client: null });
    expect(inv.status).toBe('pending');
    expect(inv.items).toEqual([]);
    expect(inv.payments).toEqual([]);
    expect(inv.client).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/finance/connectors/susii-mapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the mapper**

```ts
// src/server/finance/connectors/susii-mapper.ts
import type { CanonicalInvoice, CanonicalLineItem, CanonicalPayment, CanonicalClient } from '../connector';

const PROVIDER = 'susii';
const str = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

function mapClient(raw: unknown): CanonicalClient | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  return {
    provider: PROVIDER,
    providerRef: String(c.id ?? ''),
    name: str(c.name),
    docType: str(c.document_type),
    docNumber: str(c.document_number),
    email: str(c.email),
    phone: str(c.phone),
    metadata: c,
  };
}
function mapItem(raw: Record<string, unknown>): CanonicalLineItem {
  return {
    code: str(raw.code),
    description: str(raw.name),
    category: str(raw.category),
    quantity: num(raw.quantity),
    unitPrice: num(raw.price),
    discount: num(raw.discount),
    tax: num(raw.tax),
    total: num(raw.total) ?? (num(raw.price) != null && num(raw.quantity) != null ? Number(raw.price) * Number(raw.quantity) : null),
    metadata: raw,
  };
}
function mapPayment(raw: Record<string, unknown>): CanonicalPayment {
  return {
    providerRef: str(raw.id),
    method: str(raw.method),
    paidAt: str(raw.date),
    amount: num(raw.amount),
    status: raw.is_paid === true ? 'paid' : raw.is_paid === false ? 'pending' : null,
    metadata: raw,
  };
}

/** Map a SUSII `/v1/sales/sales/` result into the canonical invoice shape. */
export function mapSusiiSale(sale: Record<string, unknown>): CanonicalInvoice {
  const client = mapClient(sale.client);
  const status = sale.is_active === false ? 'void' : sale.is_paid === true ? 'paid' : 'pending';
  // CORE fields are lifted out; the WHOLE raw sale is kept in metadata minus the
  // big nested arrays (those become first-class items/payments).
  const { items: _i, payments: _p, document_set: _d, client: _c, ...rest } = sale;
  return {
    provider: PROVIDER,
    providerRef: String(sale.id ?? ''),
    number: str(sale.number),
    documentId: str((arr(sale.document_set)[0] ?? {}).serial) ?? str(sale.number),
    issuedAt: str(sale.date),
    clientName: client?.name ?? str(sale.client_name),
    clientDocType: client?.docType ?? null,
    clientDocNumber: client?.docNumber ?? null,
    clientEmail: client?.email ?? null,
    currency: str(sale.currency_code),
    subtotal: num(sale.subtotal),
    tax: num(sale.tax),
    discount: num(sale.discount),
    total: num(sale.total) ?? num((arr(sale.document_set)[0] ?? {}).total),
    status,
    seller: str(sale.user),
    note: str(sale.observations),
    metadata: { ...rest, document_set: arr(sale.document_set) },
    items: arr(sale.items).map(mapItem),
    payments: arr(sale.payments).map(mapPayment),
    client,
  };
}
```

- [ ] **Step 4: Run test + check**

Run: `bun run vitest run src/server/finance/connectors/susii-mapper.test.ts && bun run check`
Expected: PASS (both tests); 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/finance/connectors/susii-mapper.ts src/server/finance/connectors/susii-mapper.test.ts
git commit -m "feat(finances): SUSII sale → canonical invoice mapper"
```

---

## Task 6: SusiiConnector (wire client + mapper, self-register)

**Files:**
- Create: `src/server/finance/connectors/susii-connector.ts`
- Test: `src/server/finance/connectors/susii-connector.test.ts`

**Interfaces:**
- Consumes: `FinanceConnector`/`registerConnector` from `../connector`, `SusiiClient` (Task 4), `mapSusiiSale` (Task 5).
- Produces: `susiiConnector: FinanceConnector` (provider `'susii'`), self-registered on import. `pull` reads `secrets.username/password`, `config.businessId`, yields mapped invoices.

- [ ] **Step 1: Write the failing test**

```ts
// src/server/finance/connectors/susii-connector.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { susiiConnector } from './susii-connector';

function jsonResponse(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } }); }
afterEach(() => vi.restoreAllMocks());

describe('susiiConnector', () => {
  it('pulls + maps sales into canonical invoices', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'T' }))
      .mockResolvedValueOnce(jsonResponse({ next: null, results: [{ id: 1, number: 'BE01-1', is_paid: true, client: { id: 2, document_number: '123' } }] }));
    const out = [];
    for await (const inv of susiiConnector.pull({ config: { businessId: 5922 }, secrets: { username: 'u', password: 'p' } })) out.push(inv);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ provider: 'susii', providerRef: '1', clientDocNumber: '123', status: 'paid' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/server/finance/connectors/susii-connector.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement + self-register**

```ts
// src/server/finance/connectors/susii-connector.ts
import { registerConnector, type FinanceConnector, type CanonicalInvoice } from '../connector';
import { SusiiClient } from './susii-client';
import { mapSusiiSale } from './susii-mapper';

export const susiiConnector: FinanceConnector = {
  provider: 'susii',
  async *pull({ config, secrets, since }): AsyncIterable<CanonicalInvoice> {
    const username = secrets.username;
    const password = secrets.password;
    const businessId = Number(config.businessId);
    if (!username || !password || !Number.isFinite(businessId)) {
      throw new Error('susii connector requires secrets.username, secrets.password, config.businessId');
    }
    const client = new SusiiClient({ username, password });
    for await (const page of client.salesPages({ businessId, since })) {
      for (const sale of page) yield mapSusiiSale(sale as Record<string, unknown>);
    }
  },
};

registerConnector(susiiConnector);
```

- [ ] **Step 4: Run test + check**

Run: `bun run vitest run src/server/finance/connectors/susii-connector.test.ts && bun run check`
Expected: PASS; 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/finance/connectors/susii-connector.ts src/server/finance/connectors/susii-connector.test.ts
git commit -m "feat(finances): SusiiConnector (client+mapper, self-registered)"
```

---

## Task 7: Module-enable service

**Files:**
- Create: `src/server/services/modules.service.ts`
- Test: `src/server/services/modules.service.test.ts`

**Interfaces:**
- Consumes: `appModules` (Task 1), `withOrgCore`, `CoreCtx`.
- Produces: `isModuleEnabled(ctx, moduleId): Promise<boolean>` (absent row ⇒ true), `bothEnabled(ctx, a, b): Promise<boolean>`, `setModuleEnabled(ctx, moduleId, enabled): Promise<void>`, `listModuleStates(ctx): Promise<Record<string, boolean>>`, and the pure helper `resolveEnabled(rows, moduleId): boolean`.

- [ ] **Step 1: Write the failing test** (pure helper only — DB methods verified manually)

```ts
// src/server/services/modules.service.test.ts
import { describe, it, expect } from 'vitest';
import { resolveEnabled } from './modules.service';

describe('resolveEnabled', () => {
  it('defaults to enabled when no row exists', () => {
    expect(resolveEnabled([], 'finances')).toBe(true);
  });
  it('honors an explicit disabled row', () => {
    expect(resolveEnabled([{ moduleId: 'finances', enabled: false }], 'finances')).toBe(false);
    expect(resolveEnabled([{ moduleId: 'crm', enabled: false }], 'finances')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/server/services/modules.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/services/modules.service.ts
import { and, eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { appModules } from '$server/db/pg-modules-schema';

export function resolveEnabled(rows: { moduleId: string; enabled: boolean }[], moduleId: string): boolean {
  const row = rows.find((r) => r.moduleId === moduleId);
  return row ? row.enabled : true; // absent = enabled
}

export async function listModuleStates(ctx: CoreCtx): Promise<Record<string, boolean>> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select({ moduleId: appModules.moduleId, enabled: appModules.enabled })
      .from(appModules).where(eq(appModules.orgId, ctx.tenantId)),
  );
  return Object.fromEntries(rows.map((r) => [r.moduleId, r.enabled]));
}

export async function isModuleEnabled(ctx: CoreCtx, moduleId: string): Promise<boolean> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select({ moduleId: appModules.moduleId, enabled: appModules.enabled })
      .from(appModules).where(and(eq(appModules.orgId, ctx.tenantId), eq(appModules.moduleId, moduleId))),
  );
  return resolveEnabled(rows, moduleId);
}

export async function bothEnabled(ctx: CoreCtx, a: string, b: string): Promise<boolean> {
  const states = await listModuleStates(ctx);
  return resolveEnabled(Object.entries(states).map(([moduleId, enabled]) => ({ moduleId, enabled })), a)
    && resolveEnabled(Object.entries(states).map(([moduleId, enabled]) => ({ moduleId, enabled })), b);
}

export async function setModuleEnabled(ctx: CoreCtx, moduleId: string, enabled: boolean): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.insert(appModules).values({ orgId: ctx.tenantId, moduleId, enabled, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [appModules.orgId, appModules.moduleId], set: { enabled, updatedAt: new Date() } }),
  );
}
```

- [ ] **Step 4: Run test + check**

Run: `bun run vitest run src/server/services/modules.service.test.ts && bun run check`
Expected: PASS; 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/modules.service.ts src/server/services/modules.service.test.ts
git commit -m "feat(modules): per-org hub-module enable registry"
```

---

## Task 8: Finance service — canonical upsert + reads

**Files:**
- Create: `src/server/services/finance.service.ts`

**Interfaces:**
- Consumes: `fin_*` tables (Task 1), `withOrgCore`, `CoreCtx`, `CanonicalInvoice` (Task 3).
- Produces: `upsertInvoice(ctx, inv: CanonicalInvoice): Promise<void>` (header→children, delete-then-insert); `listInvoices(ctx, opts?): Promise<FinInvoice[]>`; `getInvoice(ctx, id): Promise<{ invoice; items; payments } | null>`; `listPayments(ctx, opts?): Promise<FinPayment[]>`; `getSource(ctx, provider): Promise<FinSource | null>`; `upsertSource(ctx, provider, data): Promise<void>`; `setSourceSync(ctx, provider, { watermark, status }): Promise<void>`.

- [ ] **Step 1: Implement the service** (DB-bound; no unit test — verified by Task 12 manual sync. Follows the CRM service shape: every method via `withOrgCore`.)

```ts
// src/server/services/finance.service.ts
import { and, eq, desc, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finInvoices, finInvoiceItems, finPayments, finClients, finSources } from '$server/db/pg-finance-schema';
import type { CanonicalInvoice } from '$server/finance/connector';

const numStr = (n: number | null) => (n == null ? null : String(n));

/** Upsert one canonical invoice + replace its children. Single org-scoped tx. */
export async function upsertInvoice(ctx: CoreCtx, inv: CanonicalInvoice): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    if (inv.client) {
      await tx.insert(finClients).values({
        orgId: ctx.tenantId, provider: inv.client.provider, providerRef: inv.client.providerRef,
        name: inv.client.name, docType: inv.client.docType, docNumber: inv.client.docNumber,
        email: inv.client.email, phone: inv.client.phone, metadata: inv.client.metadata,
      }).onConflictDoUpdate({
        target: [finClients.orgId, finClients.provider, finClients.providerRef],
        set: { name: inv.client.name, docType: inv.client.docType, docNumber: inv.client.docNumber,
               email: inv.client.email, phone: inv.client.phone, metadata: inv.client.metadata },
      });
    }
    const [row] = await tx.insert(finInvoices).values({
      orgId: ctx.tenantId, provider: inv.provider, providerRef: inv.providerRef, number: inv.number,
      documentId: inv.documentId, issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
      clientName: inv.clientName, clientDocType: inv.clientDocType, clientDocNumber: inv.clientDocNumber,
      clientEmail: inv.clientEmail, currency: inv.currency, subtotal: numStr(inv.subtotal), tax: numStr(inv.tax),
      discount: numStr(inv.discount), total: numStr(inv.total), status: inv.status, seller: inv.seller,
      note: inv.note, metadata: inv.metadata, syncedAt: new Date(),
    }).onConflictDoUpdate({
      target: [finInvoices.orgId, finInvoices.provider, finInvoices.providerRef],
      set: { number: inv.number, documentId: inv.documentId, issuedAt: inv.issuedAt ? new Date(inv.issuedAt) : null,
             clientName: inv.clientName, clientDocType: inv.clientDocType, clientDocNumber: inv.clientDocNumber,
             clientEmail: inv.clientEmail, currency: inv.currency, subtotal: numStr(inv.subtotal), tax: numStr(inv.tax),
             discount: numStr(inv.discount), total: numStr(inv.total), status: inv.status, seller: inv.seller,
             note: inv.note, metadata: inv.metadata, syncedAt: new Date() },
    }).returning({ id: finInvoices.id });
    const invoiceId = row.id;
    await tx.delete(finInvoiceItems).where(eq(finInvoiceItems.invoiceId, invoiceId));
    if (inv.items.length) {
      await tx.insert(finInvoiceItems).values(inv.items.map((it) => ({
        orgId: ctx.tenantId, invoiceId, code: it.code, description: it.description, category: it.category,
        quantity: numStr(it.quantity), unitPrice: numStr(it.unitPrice), discount: numStr(it.discount),
        tax: numStr(it.tax), total: numStr(it.total), metadata: it.metadata,
      })));
    }
    await tx.delete(finPayments).where(eq(finPayments.invoiceId, invoiceId));
    if (inv.payments.length) {
      await tx.insert(finPayments).values(inv.payments.map((p) => ({
        orgId: ctx.tenantId, invoiceId, providerRef: p.providerRef, method: p.method,
        paidAt: p.paidAt ? new Date(p.paidAt) : null, amount: numStr(p.amount), status: p.status, metadata: p.metadata,
      })));
    }
  });
}

export function listInvoices(ctx: CoreCtx, opts: { limit?: number } = {}) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(finInvoices).where(eq(finInvoices.orgId, ctx.tenantId))
      .orderBy(desc(finInvoices.issuedAt)).limit(Math.min(opts.limit ?? 500, 5000)),
  );
}

export async function getInvoice(ctx: CoreCtx, id: string) {
  return withOrgCore(ctx, async (tx) => {
    const [invoice] = await tx.select().from(finInvoices)
      .where(and(eq(finInvoices.id, id), eq(finInvoices.orgId, ctx.tenantId))).limit(1);
    if (!invoice) return null;
    const items = await tx.select().from(finInvoiceItems).where(eq(finInvoiceItems.invoiceId, id));
    const payments = await tx.select().from(finPayments).where(eq(finPayments.invoiceId, id));
    return { invoice, items, payments };
  });
}

export function listPayments(ctx: CoreCtx, opts: { limit?: number } = {}) {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(finPayments).where(eq(finPayments.orgId, ctx.tenantId))
      .orderBy(desc(finPayments.paidAt)).limit(Math.min(opts.limit ?? 500, 5000)),
  );
}

export async function getSource(ctx: CoreCtx, provider: string) {
  return withOrgCore(ctx, async (tx) => {
    const [s] = await tx.select().from(finSources)
      .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.provider, provider))).limit(1);
    return s ?? null;
  });
}

export async function upsertSource(
  ctx: CoreCtx, provider: string,
  data: { config: Record<string, unknown>; secretRefs: Record<string, string>; enabled: boolean },
) {
  await withOrgCore(ctx, (tx) =>
    tx.insert(finSources).values({ orgId: ctx.tenantId, provider, ...data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [finSources.orgId, finSources.provider],
        set: { ...data, updatedAt: new Date() } }),
  );
}

export async function setSourceSync(ctx: CoreCtx, provider: string, s: { watermark: string; status: string }) {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSources).set({ watermark: s.watermark, lastStatus: s.status, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(and(eq(finSources.orgId, ctx.tenantId), eq(finSources.provider, provider))),
  );
}

/** Raw aggregate rows for the dashboard (revenue per month, etc.). */
export function dashboardRows(ctx: CoreCtx) {
  return withOrgCore(ctx, async (tx) => {
    const monthly = (await tx.execute(sql`
      select to_char(date_trunc('month', issued_at), 'YYYY-MM') as month,
             count(*)::int as invoices, coalesce(sum(total), 0)::float8 as revenue
      from fin_invoices where org_id = ${ctx.tenantId} and issued_at is not null
      group by 1 order by 1 desc limit 24
    `)) as unknown as Array<{ month: string; invoices: number; revenue: number }>;
    return { monthly };
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run check`
Expected: 0 errors / 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/server/services/finance.service.ts
git commit -m "feat(finances): canonical upsert + invoice/payment/source reads"
```

---

## Task 9: Sync orchestrator + pure helpers

**Files:**
- Create: `src/server/services/finance-sync.helpers.ts`
- Test: `src/server/services/finance-sync.helpers.test.ts`
- Create: `src/server/services/finance-sync.service.ts`

**Interfaces:**
- Consumes: `getConnector` (Task 3), `getSource`/`upsertInvoice`/`setSourceSync` (Task 8), the SUSII connector module (imported for its self-registration side-effect), `$env/dynamic/private`.
- Produces: pure `overlapSince(watermark: string | null, overlapMs?: number): string | undefined` and `nowIso(): string`; `syncSource(ctx, provider): Promise<{ provider: string; count: number; status: 'success' | 'failed'; error?: string }>`.

- [ ] **Step 1: Write the failing test for the helper**

```ts
// src/server/services/finance-sync.helpers.test.ts
import { describe, it, expect } from 'vitest';
import { overlapSince } from './finance-sync.helpers';

describe('overlapSince', () => {
  it('returns undefined for a null watermark (full backfill)', () => {
    expect(overlapSince(null)).toBeUndefined();
  });
  it('rewinds the watermark by the overlap window', () => {
    const out = overlapSince('2026-06-01T00:05:00.000Z', 5 * 60 * 1000);
    expect(out).toBe('2026-06-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun run vitest run src/server/services/finance-sync.helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/server/services/finance-sync.helpers.ts
/** Rewind a watermark by `overlapMs` so edge-of-window modifications aren't missed. */
export function overlapSince(watermark: string | null, overlapMs = 5 * 60 * 1000): string | undefined {
  if (!watermark) return undefined;
  const t = Date.parse(watermark);
  if (!Number.isFinite(t)) return undefined;
  return new Date(t - overlapMs).toISOString();
}
export function nowIso(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 4: Run helper test**

Run: `bun run vitest run src/server/services/finance-sync.helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the orchestrator**

```ts
// src/server/services/finance-sync.service.ts
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector'; // self-registers the 'susii' connector
import { getSource, upsertInvoice, setSourceSync } from './finance.service';
import { overlapSince, nowIso } from './finance-sync.helpers';

/** Resolve a source's secret-name map to actual values from server env. */
function resolveSecrets(refs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, name] of Object.entries(refs)) {
    const v = (env as Record<string, string | undefined>)[name];
    if (v) out[k] = v;
  }
  return out;
}

export async function syncSource(ctx: CoreCtx, provider: string) {
  const source = await getSource(ctx, provider);
  if (!source) throw new Error(`no source configured for provider ${provider}`);
  if (!source.enabled) return { provider, count: 0, status: 'success' as const };
  const connector = getConnector(provider);
  if (!connector) throw new Error(`no connector registered for provider ${provider}`);

  const startedAt = nowIso();
  const secrets = resolveSecrets((source.secretRefs ?? {}) as Record<string, string>);
  let count = 0;
  let consecutiveFailures = 0;
  try {
    for await (const inv of connector.pull({
      config: (source.config ?? {}) as Record<string, unknown>,
      secrets,
      since: overlapSince(source.watermark),
    })) {
      try {
        await upsertInvoice(ctx, inv);
        count++;
        consecutiveFailures = 0;
      } catch {
        if (++consecutiveFailures >= 5) throw new Error('aborted: 5 consecutive invoice failures');
      }
    }
    await setSourceSync(ctx, provider, { watermark: startedAt, status: 'success' });
    return { provider, count, status: 'success' as const };
  } catch (e) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    return { provider, count, status: 'failed' as const, error: e instanceof Error ? e.message : 'sync failed' };
  }
}
```

- [ ] **Step 6: Run helper test + check**

Run: `bun run vitest run src/server/services/finance-sync.helpers.test.ts && bun run check`
Expected: PASS; 0/0.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/finance-sync.helpers.ts src/server/services/finance-sync.helpers.test.ts src/server/services/finance-sync.service.ts
git commit -m "feat(finances): sync orchestrator + watermark overlap helper"
```

---

## Task 10: API endpoints (sync, sources, modules)

**Files:**
- Create: `src/routes/api/finances/sync/+server.ts`
- Create: `src/routes/api/finances/sources/+server.ts`
- Create: `src/routes/api/modules/+server.ts`

**Interfaces:**
- Consumes: `getCoreCtx`, `syncSource` (Task 9), `getSource`/`upsertSource` (Task 8), `listModuleStates`/`setModuleEnabled`/`isModuleEnabled` (Task 7).
- Produces: `POST /api/finances/sync {provider}`; `GET/PUT /api/finances/sources`; `GET/PUT /api/modules`.

- [ ] **Step 1: Write the sync endpoint** (pattern mirrors `src/routes/api/crm/contacts/[id]/notes/+server.ts`)

```ts
// src/routes/api/finances/sync/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { syncSource } from '$server/services/finance-sync.service';

/** POST /api/finances/sync { provider } — run a manual sync for one connector. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const result = await syncSource(ctx, provider);
  return json(result);
};
```

- [ ] **Step 2: Write the sources endpoint**

```ts
// src/routes/api/finances/sources/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getSource, upsertSource } from '$server/services/finance.service';

export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const source = await getSource(ctx, provider);
  // Never leak secret values — secretRefs holds NAMES only, safe to return.
  return json({ source });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  await upsertSource(ctx, provider, {
    config: (body.config ?? {}) as Record<string, unknown>,
    secretRefs: (body.secretRefs ?? {}) as Record<string, string>,
    enabled: body.enabled !== false,
  });
  return json({ ok: true });
};
```

- [ ] **Step 3: Write the modules endpoint**

```ts
// src/routes/api/modules/+server.ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listModuleStates, setModuleEnabled } from '$server/services/modules.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ modules: await listModuleStates(ctx) });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (typeof body.moduleId !== 'string' || typeof body.enabled !== 'boolean') throw error(400, 'moduleId + enabled required');
  await setModuleEnabled(ctx, body.moduleId, body.enabled);
  return json({ ok: true });
};
```

- [ ] **Step 4: Typecheck**

Run: `bun run check`
Expected: 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/finances src/routes/api/modules
git commit -m "feat(finances): sync, sources, and module-toggle API endpoints"
```

---

## Task 11: Nav — Finances group + module-enabled filter

**Files:**
- Modify: `src/lib/components/layout/sections.ts`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: existing `PluginNavCategory`, `PLUGIN_NAV_GROUPS`, `BUILTIN_PLUGIN_ITEMS`, `getDynamicPluginsSections` in `sections.ts`.
- Produces: a `finance` category + a `/finances` builtin nav item, filtered out when the org has `finances` disabled (passed via the existing `enabledByPluginId` map, keyed `'finances'`).

- [ ] **Step 1: Add the i18n key**

Add `"nav_finance": "Finances"` to `messages/en.json` and `"nav_finance": "Finanzas"` to `messages/es.json`. Then:

Run: `npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide`
Expected: "Successfully compiled".

- [ ] **Step 2: Extend the category union + group list + builtin item**

In `sections.ts`: add `| "finance"` to the `PluginNavCategory` union; add `{ category: "finance", label: () => m.nav_finance() }` to `PLUGIN_NAV_GROUPS` (after `operations`); import a money icon (`import { … , Wallet } from "lucide-svelte"`) and add to `BUILTIN_PLUGIN_ITEMS`:

```ts
{
  category: "finance",
  item: { href: "/finances", label: "Finances", icon: Wallet, matcher: (p: string) => p.startsWith("/finances") },
},
```

- [ ] **Step 3: Gate builtin items by module-enabled**

In `getDynamicPluginsSections`, where `BUILTIN_PLUGIN_ITEMS` are placed, skip a builtin whose module is disabled. Builtin items are keyed by a `moduleId` derived from the href (`/crm`→`crm`, `/finances`→`finances`). Change the placement loop to:

```ts
for (const { category, item } of BUILTIN_PLUGIN_ITEMS) {
  const moduleId = item.href.replace(/^\//, '').split('/')[0]; // 'crm' | 'finances' | 'workforce'
  if (enabledByPluginId[moduleId] === false) continue;          // per-org module gate
  place(category, item);
}
```

(`enabledByPluginId` already exists for gateway plugins; Task 14 hydrates `'crm'`/`'finances'` keys into it from `/api/modules`.)

- [ ] **Step 4: Typecheck + verify nav compiles**

Run: `bun run check`
Expected: 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/layout/sections.ts messages/en.json messages/es.json
git commit -m "feat(finances): Finances nav group + per-module nav gating"
```

---

## Task 12: Finance sub-nav + Dashboard route

**Files:**
- Create: `src/lib/components/finance/FinanceNav.svelte`
- Create: `src/routes/(app)/finances/+layout.svelte`
- Create: `src/routes/(app)/finances/+page.server.ts`
- Create: `src/routes/(app)/finances/+page.svelte`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `getCoreCtx`, `isModuleEnabled` (Task 7), `dashboardRows`/`listInvoices`/`listPayments` (Task 8), `PageHeader` from `$lib/components/ui`.
- Produces: the `/finances` dashboard. `FinanceNav` mirrors `src/lib/components/crm/CrmNav.svelte` (copy its structure/styles) with tabs Dashboard `/finances`, Invoices `/finances/invoices`, Payments `/finances/payments`, Clients `/finances/clients`, Settings `/finances/settings`.

- [ ] **Step 1: Create `FinanceNav.svelte`** by copying `src/lib/components/crm/CrmNav.svelte` verbatim, then replacing the `TABS` array with the 5 finance tabs (icons `LayoutDashboard, FileText, CreditCard, Users, Settings`), the `aria-label="Finances"`, the header label `m.nav_finance()`, and `isActive` so Dashboard = `pathname === '/finances'`, Settings = `startsWith('/finances/settings')`, else the tab whose href prefixes the path.

- [ ] **Step 2: Create the layout** (mirrors `src/routes/(app)/crm/+layout.svelte`)

```svelte
<!-- src/routes/(app)/finances/+layout.svelte -->
<script lang="ts">
    import type { Snippet } from 'svelte';
    import FinanceNav from '$lib/components/finance/FinanceNav.svelte';
    let { children }: { children: Snippet } = $props();
</script>
<div class="h-full flex">
    <FinanceNav />
    <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{@render children()}</div>
</div>
```

- [ ] **Step 3: Dashboard server load** (404 if module disabled)

```ts
// src/routes/(app)/finances/+page.server.ts
import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { dashboardRows, listInvoices } from '$server/services/finance.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(404, 'Finances module disabled');
  depends('finances:data');
  const [{ monthly }, invoices] = await Promise.all([dashboardRows(ctx), listInvoices(ctx, { limit: 1 })]);
  const totalRevenue = monthly.reduce((a, m) => a + m.revenue, 0);
  return { monthly, totalRevenue, hasData: invoices.length > 0 };
};
```

- [ ] **Step 4: Dashboard page** (use the CRM dashboard `src/routes/(app)/crm/+page.svelte` as the visual reference for the card/KPI styles; reuse `PageHeader`)

```svelte
<!-- src/routes/(app)/finances/+page.svelte -->
<script lang="ts">
	import type { PageData } from './$types';
	import * as m from '$lib/paraglide/messages';
	import { Wallet } from 'lucide-svelte';
	import { PageHeader } from '$lib/components/ui';
	let { data }: { data: PageData } = $props();
	const max = $derived(Math.max(1, ...data.monthly.map((x) => x.revenue)));
</script>
<svelte:head><title>{m.nav_finance()}</title></svelte:head>
<div class="flex flex-col h-full min-h-0">
	<PageHeader title={m.nav_finance()} subtitle={m.fin_dashboard_subtitle()}>
		{#snippet leading()}<Wallet size={16} class="text-accent shrink-0" />{/snippet}
	</PageHeader>
	<div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4 max-w-6xl">
		{#if !data.hasData}
			<p class="t-caption">{m.fin_empty()}</p>
		{:else}
			<div class="kpi"><div class="kpi-val">S/ {data.totalRevenue.toLocaleString()}</div><div class="kpi-label">{m.fin_total_revenue()}</div></div>
			<section class="card">
				<header class="card-h">{m.fin_revenue_by_month()}</header>
				<div class="bars">
					{#each data.monthly.slice().reverse() as row (row.month)}
						<div class="bar-row" title={`${row.month}: S/ ${row.revenue.toLocaleString()} · ${row.invoices}`}>
							<span class="bar-label">{row.month}</span>
							<span class="bar-wrap"><span class="bar" style:width={`${(row.revenue / max) * 100}%`}></span></span>
							<span class="bar-n">S/ {Math.round(row.revenue).toLocaleString()}</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	</div>
</div>
<style>
	.kpi { padding: 0.85rem 1rem; border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); width: fit-content; }
	.kpi-val { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; }
	.kpi-label { font-size: 0.78rem; color: var(--color-muted-foreground); }
	.card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: 0.85rem 1rem; }
	.card-h { font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: 0.8rem; }
	.bars { display: flex; flex-direction: column; gap: 0.4rem; }
	.bar-row { display: grid; grid-template-columns: 4rem 1fr auto; align-items: center; gap: 0.6rem; }
	.bar-label { font-size: 0.74rem; color: var(--color-muted-foreground); }
	.bar-wrap { height: 0.7rem; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.bar { display: block; height: 100%; border-radius: 999px; background: var(--color-accent); }
	.bar-n { font-size: 0.78rem; font-variant-numeric: tabular-nums; min-width: 5rem; text-align: right; }
</style>
```

- [ ] **Step 5: Add i18n keys** `fin_dashboard_subtitle`, `fin_empty`, `fin_total_revenue`, `fin_revenue_by_month` to both locales; recompile paraglide.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run check` → 0/0.
```bash
git add src/lib/components/finance/FinanceNav.svelte "src/routes/(app)/finances/+layout.svelte" "src/routes/(app)/finances/+page.server.ts" "src/routes/(app)/finances/+page.svelte" messages/en.json messages/es.json
git commit -m "feat(finances): finance sub-nav + revenue dashboard"
```

---

## Task 13: Invoices, Payments, Clients routes

**Files:**
- Create: `src/routes/(app)/finances/invoices/+page.{server.ts,svelte}`
- Create: `src/routes/(app)/finances/invoices/[id]/+page.{server.ts,svelte}`
- Create: `src/routes/(app)/finances/payments/+page.{server.ts,svelte}`
- Create: `src/routes/(app)/finances/clients/+page.{server.ts,svelte}`
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `listInvoices`/`getInvoice`/`listPayments` (Task 8), `isModuleEnabled` (Task 7).
- Produces: standard list/detail SvelteKit pages.

- [ ] **Step 1: Invoices list** — server load guards module + returns `listInvoices(ctx, { limit: 500 })`; the page renders a table (mirror the column/`overflow-auto`/`t-caption` styling of `src/routes/(app)/crm/customers/+page.svelte`) with columns Number, Date, Client, DNI, Total, Status; each row links to `/finances/invoices/{id}`. Numbers via `Number(total).toLocaleString()` (money is a `numeric` string).

- [ ] **Step 2: Invoice detail** — server load calls `getInvoice(ctx, params.id)`; 404 if null. Page shows header fields + an items table + a payments table.

- [ ] **Step 3: Payments list** — server load returns `listPayments(ctx, { limit: 500 })`; table of Date, Method, Amount, Status.

- [ ] **Step 4: Clients list** — server load runs an aggregate (add `clientRevenueRows(ctx)` to `finance.service.ts`: `select client_doc_number, max(client_name) name, count(*) invoices, sum(total) revenue, max(issued_at) last from fin_invoices where org_id=… group by client_doc_number order by revenue desc limit 500`). Page renders the ranked client table.

- [ ] **Step 5: Add i18n keys** for all new column/labels in both locales; recompile paraglide.

- [ ] **Step 6: Typecheck + commit**

Run: `bun run check` → 0/0.
```bash
git add "src/routes/(app)/finances/invoices" "src/routes/(app)/finances/payments" "src/routes/(app)/finances/clients" src/server/services/finance.service.ts messages/en.json messages/es.json
git commit -m "feat(finances): invoices, payments, and clients views"
```

---

## Task 14: Settings — connector config, Sync now, module toggle

**Files:**
- Create: `src/routes/(app)/finances/settings/+page.{server.ts,svelte}`
- Modify: `src/lib/state/plugin-nav.svelte.ts` — fold module states into `enabledByPluginId`.
- Modify: `messages/en.json`, `messages/es.json`

**Interfaces:**
- Consumes: `/api/finances/sources` (GET/PUT), `/api/finances/sync` (POST), `/api/modules` (GET/PUT).
- Produces: the Finances settings page; `hydratePluginNav` additionally merges `/api/modules` states into `enabledByPluginId` (keys `'crm'`,`'finances'`) so the nav gate (Task 11) sees them.

- [ ] **Step 1: Merge module states into nav hydration** — in `src/lib/state/plugin-nav.svelte.ts` `hydratePluginNav`, after building `enabled` from `/api/plugins/ui-list`, also `fetch('/api/modules')` and merge: `for (const [id, on] of Object.entries(modules)) enabled[id] = on;`. (Absent ⇒ the endpoint omits it ⇒ stays enabled because the gate only skips on explicit `false`.)

- [ ] **Step 2: Settings server load** — guard `isModuleEnabled(ctx,'finances')`; return `getSource(ctx,'susii')` + `listModuleStates(ctx)`.

- [ ] **Step 3: Settings page** — three cards:
  1. **Connector** — provider (fixed `susii` for now), `businessId` input, secret-name inputs (`username`→`SUSII_USERNAME`, `password`→`SUSII_PASSWORD` defaults), enabled toggle → `PUT /api/finances/sources`. Show `lastSyncAt`/`lastStatus`/`watermark`.
  2. **Sync** — "Sync now" button → `POST /api/finances/sync {provider:'susii'}`; show returned `{count,status}`.
  3. **Module** — a toggle for `finances` (and `crm`) → `PUT /api/modules`; on success call the existing `setPluginEnabled(moduleId, enabled)` from `plugin-nav.svelte.ts` for optimistic nav update.

- [ ] **Step 4: i18n keys** for all settings labels in both locales; recompile paraglide.

- [ ] **Step 5: Typecheck + commit**

Run: `bun run check` → 0/0.
```bash
git add "src/routes/(app)/finances/settings" src/lib/state/plugin-nav.svelte.ts messages/en.json messages/es.json
git commit -m "feat(finances): settings — connector config, sync now, module toggle"
```

---

## Task 15: End-to-end verification (FACES SUSII)

**Files:** none (operational).

- [ ] **Step 1: Configure secrets** — ensure the hub env has `SUSII_USERNAME` / `SUSII_PASSWORD` (FACES creds already exist in Infisical `minion-paperclip`; mirror into the hub's env/Infisical project). Confirm `minion doctor` / the hub boots.
- [ ] **Step 2: Configure the source** — on `/finances/settings`, set provider `susii`, `businessId=5922`, secret names, enabled; Save.
- [ ] **Step 3: Sync now** — click Sync; expect `{ status: 'success', count > 0 }`. (First run with a null watermark backfills.)
- [ ] **Step 4: Verify data** — `/finances/invoices` lists invoices; a detail page shows items + payments; `/finances` dashboard shows monthly revenue; `/finances/clients` ranks clients.
- [ ] **Step 5: Verify the toggle** — disable `finances` in settings → the Finances nav group disappears and `/finances` returns 404; re-enable restores it.
- [ ] **Step 6: Full check** — `bun run check` (0/0) and `bun run vitest run src/server/finance src/server/services/finance-sync.helpers.test.ts src/server/services/modules.service.test.ts` (all pass).
- [ ] **Step 7: Commit** any fixups; Phase 1 done.

---

## Self-review notes (coverage)

- Canonical CORE+jsonb schema → Tasks 1–2. Connector abstraction + SUSII → Tasks 3–6. Sync + watermark → Task 9. Per-org module toggle → Tasks 7, 11, 14. Nav "Finances" group → Task 11. UI (dashboard/invoices/payments/clients/settings) → Tasks 12–14. RLS/tenancy via `withOrgCore` + companion migration → Tasks 1,2,8. Secrets-by-reference → Tasks 8,9,14. CRM↔Finances bridge is intentionally **deferred to a Phase 2 plan** (this plan ships Finances standalone). xlsx ignored per spec.
- All money is `numeric` (string) → parsed only at aggregation/render edges.
- Type names are consistent across tasks: `CanonicalInvoice`, `FinanceConnector`, `syncSource`, `isModuleEnabled`, `upsertInvoice`.
