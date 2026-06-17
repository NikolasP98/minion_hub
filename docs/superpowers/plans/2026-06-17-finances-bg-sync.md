# Finances Background Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SUSII finance sync into a durable, resumable background job with smart % progress, a hard-cancel, and presence-independent failsafe completion — surfaced as a Zag linear progress bar in finances/settings and a mini circular ring on the Finances nav item.

**Architecture:** Job state lives in a new `fin_sync_jobs` DB row (status/processed/total/page_cursor/cancel_requested/heartbeat). A single resumable worker `advanceJob(ctx, jobId, {budgetMs})` pulls SUSII pages, upserts invoices, persists the cursor every page, and honors cancel. Two drivers invoke it: an immediate detached kick from `POST /api/finances/sync` (runs to completion on persistent runtimes) and a per-minute Vercel Cron tick that resumes any queued/stalled job in bounded chunks (the Vercel-safe, presence-independent failsafe). The UI polls a status endpoint via one shared `$state` store.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, Bun, Drizzle ORM over Supabase Postgres (org-GUC RLS via `withOrgCore`), `@zag-js/progress` + `@zag-js/svelte`, Vitest, Paraglide i18n.

## Global Constraints

- Branch `dev`. Never commit to `master`. Keep the green baseline: `bun run check` → **0 errors, 0 warnings**; `bun run test` → all pass.
- Core-DB schema = hand-written idempotent SQL at meta-repo root `supabase/migrations/<stamp>_*.sql`, applied to prod gxv via Supabase MCP. **Never** `drizzle-kit push` the core DB. Drizzle schema mirrors the SQL in `src/server/db/pg-finance-schema.ts`.
- Every org-scoped core query goes through `withOrgCore(ctx, (tx) => …)` — never bare `getCoreDb()` — **except** the one deliberate cross-org cron-discovery read (Task 3 `findResumableJobs`), which must run as the bypass-RLS `postgres` connection precisely because it spans orgs.
- Money columns are `numeric` (string in JS). Coerce aggregates with `Number(...)`.
- Credentials are AES-256-GCM encrypted in `fin_sources.secret_refs` (`{ciphertext, iv}`), decrypted via `decryptCreds` from `$server/services/finance-secrets`. Never return the raw blob to the client; never log it.
- Admin-gate writes with `requireAdmin(locals)` from `$server/auth/authorize`. Read endpoints are member-level.
- Svelte 5 runes only. Zag usage pattern: `const service = useMachine(x.machine, () => ({...})); const api = $derived(x.connect(service, normalizeProps));`.
- i18n: add keys to BOTH `messages/en.json` and `messages/es.json`; they compile during `bun run check`/build.

---

### Task 1: `fin_sync_jobs` schema + migration

**Files:**
- Modify: `src/server/db/pg-finance-schema.ts` (add `finSyncJobs` table + `FinSyncJob` type)
- Create: `../supabase/migrations/20260617130000_fin_sync_jobs.sql` (meta-repo root; path relative to `minion_hub/` is `../supabase/migrations/...`)
- Test: `src/server/db/pg-finance-schema.test.ts` (new — asserts table shape)

**Interfaces:**
- Produces: `finSyncJobs` Drizzle table and `FinSyncJob = typeof finSyncJobs.$inferSelect` with columns `id, orgId, provider, status, total, processed, pageCursor, error, cancelRequested, startedAt, finishedAt, heartbeatAt, createdAt, updatedAt`.

- [ ] **Step 1: Write the failing test**

Create `src/server/db/pg-finance-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { finSyncJobs } from './pg-finance-schema';

describe('finSyncJobs schema', () => {
  it('has the durable job columns', () => {
    const cols = Object.keys(getTableColumns(finSyncJobs));
    for (const c of ['id','orgId','provider','status','total','processed','pageCursor','error','cancelRequested','startedAt','finishedAt','heartbeatAt','createdAt','updatedAt']) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts`
Expected: FAIL — `finSyncJobs` is not exported.

- [ ] **Step 3: Add the Drizzle table**

In `src/server/db/pg-finance-schema.ts`, extend the import line to add `integer` and `sql`:

```ts
import { pgTable, uuid, text, jsonb, numeric, timestamp, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
```

Append before the `export type` block:

```ts
/** Durable, resumable background sync job — one row per sync run. */
export const finSyncJobs = pgTable(
  'fin_sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('queued'), // queued|running|succeeded|failed|cancelled
    total: integer('total'),                              // DRF count baseline (null until known)
    processed: integer('processed').notNull().default(0),
    pageCursor: text('page_cursor'),                      // DRF `next` URL to resume from
    error: text('error'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUq: uniqueIndex('fin_sync_jobs_active_uq')
      .on(t.orgId, t.provider)
      .where(sql`status in ('queued','running')`),
    latestIdx: index('fin_sync_jobs_org_provider_created_idx').on(t.orgId, t.provider, t.createdAt),
    resumeIdx: index('fin_sync_jobs_status_heartbeat_idx').on(t.status, t.heartbeatAt),
  }),
);
```

Add to the type exports block:

```ts
export type FinSyncJob = typeof finSyncJobs.$inferSelect;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/server/db/pg-finance-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the migration SQL**

Create `../supabase/migrations/20260617130000_fin_sync_jobs.sql`:

```sql
-- Durable background sync jobs for hub-native Finances (spec: finances bg-sync).
-- One row per sync run; progress/cursor/cancel all persisted so a sync survives
-- navigation, hub redeploys, and a worker dying mid-run (resumed by the cron tick).
--
-- Tenancy: org_id text, enforced by app_ledger role + app.current_org_id GUC.
-- Idempotent: CREATE ... IF NOT EXISTS throughout (never drizzle-kit push core DB).

create table if not exists public.fin_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  provider         text not null,
  status           text not null default 'queued',
  total            integer,
  processed        integer not null default 0,
  page_cursor      text,
  error            text,
  cancel_requested boolean not null default false,
  started_at       timestamptz,
  finished_at      timestamptz,
  heartbeat_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists fin_sync_jobs_active_uq
  on public.fin_sync_jobs (org_id, provider) where status in ('queued','running');
--> statement-breakpoint
create index if not exists fin_sync_jobs_org_provider_created_idx
  on public.fin_sync_jobs (org_id, provider, created_at);
--> statement-breakpoint
create index if not exists fin_sync_jobs_status_heartbeat_idx
  on public.fin_sync_jobs (status, heartbeat_at);
--> statement-breakpoint
grant select, insert, update, delete on public.fin_sync_jobs to app_ledger;
--> statement-breakpoint
alter table public.fin_sync_jobs enable row level security;
--> statement-breakpoint
alter table public.fin_sync_jobs force  row level security;
--> statement-breakpoint
create policy fin_sync_jobs_org_guc on public.fin_sync_jobs
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
```

- [ ] **Step 6: Apply the migration to prod gxv** (orchestrator-only — needs Supabase MCP)

The executing subagent cannot run MCP. Leave a note in the commit body: `MIGRATION PENDING: apply 20260617130000_fin_sync_jobs.sql to gxv via Supabase MCP before sync is used.` The orchestrator applies it via `mcp__supabase__apply_migration` and verifies RLS enabled+forced + 1 policy. (Cross-org cron discovery in Task 3 runs as `postgres`/bypassrls, so it works regardless; org-scoped writes need the policy.)

- [ ] **Step 7: Run check + commit**

Run: `bun run check` → 0/0. Then:

```bash
git add src/server/db/pg-finance-schema.ts src/server/db/pg-finance-schema.test.ts ../supabase/migrations/20260617130000_fin_sync_jobs.sql
git commit -m "feat(finance): fin_sync_jobs durable sync-job table + migration

MIGRATION PENDING: apply 20260617130000_fin_sync_jobs.sql to gxv via Supabase MCP."
```

---

### Task 2: Page-aware + countable connector interface (SUSII)

**Files:**
- Modify: `src/server/finance/connector.ts` (add `PullPage`, `PullPagesOpts`, extend `FinanceConnector`)
- Modify: `src/server/finance/connectors/susii-client.ts` (`count()`, cursor-aware `salesPages` yielding `{results,next}`)
- Modify: `src/server/finance/connectors/susii-connector.ts` (`pullPages`, `count`, `pull` wrapper)
- Modify: `src/server/finance/connectors/susii-client.test.ts` (page shape now `{results,next}`)
- Test: `src/server/finance/connectors/susii-connector.test.ts` (extend — pullPages cursor + count)

**Interfaces:**
- Consumes: `mapSusiiSale` (unchanged), `CanonicalInvoice`.
- Produces:
  - `interface PullPage { invoices: CanonicalInvoice[]; cursor: string | null; }`
  - `interface PullPagesOpts extends PullOpts { cursor?: string | null; }`
  - `FinanceConnector.pullPages(opts: PullPagesOpts): AsyncIterable<PullPage>` and optional `count?(opts: PullOpts): Promise<number | null>`.
  - `SusiiClient.count(opts: { businessId: number; since?: string }): Promise<number | null>` and `SusiiClient.salesPages(opts: { businessId: number; since?: string; pageSize?: number; cursor?: string | null }): AsyncIterable<{ results: unknown[]; next: string | null }>`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/server/finance/connectors/susii-client.test.ts` with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SusiiClient } from './susii-client';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

describe('SusiiClient', () => {
  it('logs in (DRF Token) and paginates sales following .next, yielding {results,next}', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: 'https://api.susii.com/v1/sales/sales/?page=2', results: [{ id: 1 }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, next: null, results: [{ id: 2 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const pages: Array<{ results: unknown[]; next: string | null }> = [];
    for await (const page of c.salesPages({ businessId: 5922 })) pages.push(page);
    expect(pages.map((p) => p.results).flat()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(pages[0].next).toBe('https://api.susii.com/v1/sales/sales/?page=2');
    expect(pages[1].next).toBeNull();
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: 'Token TOK' });
  });

  it('resumes from a cursor URL instead of building the first page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 9, next: null, results: [{ id: 7 }] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    const pages = [];
    for await (const p of c.salesPages({ businessId: 5922, cursor: 'https://api.susii.com/v1/sales/sales/?page=3' })) pages.push(p);
    expect(pages[0].results).toEqual([{ id: 7 }]);
    // first authed GET hit the cursor URL verbatim
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.susii.com/v1/sales/sales/?page=3');
  });

  it('count() reads DRF count from a page_size=1 probe', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1234, next: null, results: [] }));
    const c = new SusiiClient({ username: 'u', password: 'p' });
    expect(await c.count({ businessId: 5922 })).toBe(1234);
  });
});
```

Create `src/server/finance/connectors/susii-connector.test.ts` (or extend if present) with:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { susiiConnector } from './susii-connector';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
afterEach(() => vi.restoreAllMocks());

const opts = { config: { businessId: 5922 }, secrets: { username: 'u', password: 'p' } };

describe('susiiConnector.pullPages', () => {
  it('maps each page of sales to canonical invoices and passes through the cursor', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: 'https://api.susii.com/n', results: [{ id: 1, is_paid: true, client: null }] }))
      .mockResolvedValueOnce(jsonResponse({ count: 1, next: null, results: [{ id: 2, is_paid: false, client: null }] }));
    const pages = [];
    for await (const p of susiiConnector.pullPages(opts)) pages.push(p);
    expect(pages[0].invoices[0].providerRef).toBe('1');
    expect(pages[0].cursor).toBe('https://api.susii.com/n');
    expect(pages[1].cursor).toBeNull();
  });
});

describe('susiiConnector.count', () => {
  it('delegates to SusiiClient.count', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ key: 'TOK' }))
      .mockResolvedValueOnce(jsonResponse({ count: 42, next: null, results: [] }));
    expect(await susiiConnector.count!(opts)).toBe(42);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/finance/connectors/susii-client.test.ts src/server/finance/connectors/susii-connector.test.ts`
Expected: FAIL — `salesPages` yields arrays not `{results,next}`; `count`/`pullPages` missing.

- [ ] **Step 3: Extend the connector interface**

In `src/server/finance/connector.ts`, after `PullOpts` add:

```ts
export interface PullPage {
  invoices: CanonicalInvoice[];
  cursor: string | null; // resume token for the *next* page; null = drained
}
export interface PullPagesOpts extends PullOpts {
  cursor?: string | null; // resume from here instead of building the first page
}
```

Extend `FinanceConnector`:

```ts
export interface FinanceConnector {
  provider: string;
  pull(opts: PullOpts): AsyncIterable<CanonicalInvoice>;        // convenience wrapper over pullPages
  pullPages(opts: PullPagesOpts): AsyncIterable<PullPage>;      // resumable, batch + cursor
  count?(opts: PullOpts): Promise<number | null>;              // optional % baseline
}
```

- [ ] **Step 4: Update `SusiiClient`**

Replace `salesPages` and add `count` in `src/server/finance/connectors/susii-client.ts`:

```ts
  private buildSalesUrl(opts: { businessId: number; since?: string; pageSize?: number }): string {
    const u = new URL(`${this.base}/v1/sales/sales/`);
    u.searchParams.set('business', String(opts.businessId));
    u.searchParams.set('page_size', String(opts.pageSize ?? 100));
    if (opts.since) u.searchParams.set('modified_after', opts.since);
    return u.toString();
  }

  async *salesPages(
    opts: { businessId: number; since?: string; pageSize?: number; cursor?: string | null },
  ): AsyncIterable<{ results: unknown[]; next: string | null }> {
    let next: string | null = opts.cursor ?? this.buildSalesUrl(opts);
    while (next) {
      const res = await this.authedGet(next);
      if (!res.ok) throw new Error(`susii sales fetch failed: ${res.status}`);
      const body = (await res.json()) as { results?: unknown[]; next?: string | null };
      yield { results: body.results ?? [], next: body.next ?? null };
      next = body.next ?? null;
    }
  }

  async count(opts: { businessId: number; since?: string }): Promise<number | null> {
    const url = this.buildSalesUrl({ ...opts, pageSize: 1 });
    const res = await this.authedGet(url);
    if (!res.ok) return null;
    const body = (await res.json()) as { count?: number };
    return typeof body.count === 'number' ? body.count : null;
  }
```

- [ ] **Step 5: Update `susii-connector.ts`**

Replace the file body:

```ts
import { registerConnector, type FinanceConnector, type CanonicalInvoice, type PullPage } from '../connector';
import { SusiiClient } from './susii-client';
import { mapSusiiSale } from './susii-mapper';

function makeClient(config: Record<string, unknown>, secrets: Record<string, string>) {
  const username = secrets.username;
  const password = secrets.password;
  const businessId = Number(config.businessId);
  if (!username || !password || !Number.isFinite(businessId)) {
    throw new Error('susii connector requires secrets.username, secrets.password, config.businessId');
  }
  return { client: new SusiiClient({ username, password }), businessId };
}

export const susiiConnector: FinanceConnector = {
  provider: 'susii',
  async *pullPages({ config, secrets, since, cursor }): AsyncIterable<PullPage> {
    const { client, businessId } = makeClient(config, secrets);
    for await (const page of client.salesPages({ businessId, since, cursor })) {
      yield {
        invoices: page.results.map((s) => mapSusiiSale(s as Record<string, unknown>)),
        cursor: page.next,
      };
    }
  },
  async *pull(opts): AsyncIterable<CanonicalInvoice> {
    for await (const page of susiiConnector.pullPages(opts)) yield* page.invoices;
  },
  async count({ config, secrets, since }): Promise<number | null> {
    const { client, businessId } = makeClient(config, secrets);
    return client.count({ businessId, since });
  },
};

registerConnector(susiiConnector);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run vitest run src/server/finance/connectors/ && bun run check`
Expected: PASS, check 0/0. (If `src/server/finance/connector.test.ts` asserts the connector shape, confirm it still passes — `pullPages`/`count` are additive.)

- [ ] **Step 7: Commit**

```bash
git add src/server/finance/
git commit -m "feat(finance): page-aware + countable connector interface (SUSII cursor + count)"
```

---

### Task 3: Sync-job service

**Files:**
- Create: `src/server/services/finance-sync-jobs.service.ts`
- Test: `src/server/services/finance-sync-jobs.service.test.ts`

**Interfaces:**
- Consumes: `withOrgCore`, `getCoreDb`, `CoreCtx`, `finSyncJobs`/`FinSyncJob` (Task 1).
- Produces:
  - `STALE_MS = 90_000`
  - `getActiveJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null>`
  - `getLatestJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null>`
  - `getJobById(ctx: CoreCtx, jobId: string): Promise<FinSyncJob | null>`
  - `enqueueJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob>`
  - `claimJob(ctx: CoreCtx, jobId: string): Promise<boolean>`
  - `heartbeat(ctx: CoreCtx, jobId: string, patch: { processed: number; total?: number | null; pageCursor: string | null }): Promise<void>`
  - `isCancelRequested(ctx: CoreCtx, jobId: string): Promise<boolean>`
  - `requestCancel(ctx: CoreCtx, provider: string): Promise<void>`
  - `finishJob(ctx: CoreCtx, jobId: string, status: 'succeeded'|'failed'|'cancelled', opts?: { error?: string }): Promise<void>`
  - `findResumableJobs(limit?: number): Promise<Array<{ jobId: string; orgId: string; provider: string }>>`

- [ ] **Step 1: Write the failing tests**

Create `src/server/services/finance-sync-jobs.service.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { enqueueJob, getActiveJob, claimJob, requestCancel, isCancelRequested } from './finance-sync-jobs.service';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('enqueueJob', () => {
  it('returns the existing active job (dedupe) without inserting', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[{ id: 'job-active', orgId: 'org-1', provider: 'susii', status: 'running' }]]); // getActiveJob select
    const job = await enqueueJob(ctx(db), 'susii');
    expect(job.id).toBe('job-active');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts a queued job when none is active', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [],                                                            // getActiveJob → none
      [{ id: 'job-new', orgId: 'org-1', provider: 'susii', status: 'queued' }], // insert().returning()
    ]);
    const job = await enqueueJob(ctx(db), 'susii');
    expect(db.insert).toHaveBeenCalled();
    expect(job.status).toBe('queued');
  });
});

describe('claimJob', () => {
  it('returns true when the update claims a row', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'job-1' }]); // update().returning() → one row
    expect(await claimJob(ctx(db), 'job-1')).toBe(true);
  });
  it('returns false when no row was claimable', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // update().returning() → none
    expect(await claimJob(ctx(db), 'job-1')).toBe(false);
  });
});

describe('cancel', () => {
  it('requestCancel issues an update', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await requestCancel(ctx(db), 'susii');
    expect(db.update).toHaveBeenCalled();
  });
  it('isCancelRequested reads the flag', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ cancelRequested: true }]);
    expect(await isCancelRequested(ctx(db), 'job-1')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/server/services/finance-sync-jobs.service.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the service**

Create `src/server/services/finance-sync-jobs.service.ts`:

```ts
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finSyncJobs, type FinSyncJob } from '$server/db/pg-finance-schema';

export const STALE_MS = 90_000;
const ACTIVE = ['queued', 'running'];
const staleClause = sql`now() - interval '90 seconds'`;

export function getActiveJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider), inArray(finSyncJobs.status, ACTIVE)))
      .orderBy(desc(finSyncJobs.createdAt)).limit(1);
    return row ?? null;
  });
}

export function getLatestJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider)))
      .orderBy(desc(finSyncJobs.createdAt)).limit(1);
    return row ?? null;
  });
}

export function getJobById(ctx: CoreCtx, jobId: string): Promise<FinSyncJob | null> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select().from(finSyncJobs)
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))).limit(1);
    return row ?? null;
  });
}

export async function enqueueJob(ctx: CoreCtx, provider: string): Promise<FinSyncJob> {
  const active = await getActiveJob(ctx, provider);
  if (active) return active;
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.insert(finSyncJobs)
      .values({ orgId: ctx.tenantId, provider, status: 'queued', processed: 0 })
      .returning();
    return row;
  });
}

/** Flip queued→running, or re-claim a running job whose heartbeat is stale. */
export async function claimJob(ctx: CoreCtx, jobId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.update(finSyncJobs)
      .set({ status: 'running', startedAt: sql`coalesce(${finSyncJobs.startedAt}, now())`, heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(
        eq(finSyncJobs.id, jobId),
        eq(finSyncJobs.orgId, ctx.tenantId),
        or(eq(finSyncJobs.status, 'queued'), and(eq(finSyncJobs.status, 'running'), lt(finSyncJobs.heartbeatAt, staleClause))),
      ))
      .returning({ id: finSyncJobs.id });
    return rows.length > 0;
  });
}

export async function heartbeat(
  ctx: CoreCtx, jobId: string, patch: { processed: number; total?: number | null; pageCursor: string | null },
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs)
      .set({
        processed: patch.processed,
        ...(patch.total != null ? { total: patch.total } : {}),
        pageCursor: patch.pageCursor,
        heartbeatAt: sql`now()`, updatedAt: sql`now()`,
      })
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))),
  );
}

export async function isCancelRequested(ctx: CoreCtx, jobId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const [row] = await tx.select({ cancelRequested: finSyncJobs.cancelRequested }).from(finSyncJobs)
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))).limit(1);
    return row?.cancelRequested === true;
  });
}

export async function requestCancel(ctx: CoreCtx, provider: string): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs).set({ cancelRequested: true, updatedAt: sql`now()` })
      .where(and(eq(finSyncJobs.orgId, ctx.tenantId), eq(finSyncJobs.provider, provider), inArray(finSyncJobs.status, ACTIVE))),
  );
}

export async function finishJob(
  ctx: CoreCtx, jobId: string, status: 'succeeded' | 'failed' | 'cancelled', opts: { error?: string } = {},
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx.update(finSyncJobs)
      .set({ status, error: opts.error ?? null, finishedAt: sql`now()`, heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(finSyncJobs.id, jobId), eq(finSyncJobs.orgId, ctx.tenantId))),
  );
}

/**
 * Cross-org discovery for the cron tick: queued jobs + running jobs with a
 * stale heartbeat, across ALL orgs. Runs on the bare `postgres` (bypass-RLS)
 * connection BY DESIGN — it is not request-scoped to one tenant. The caller
 * then builds a per-org CoreCtx and does all real work through withOrgCore.
 */
export async function findResumableJobs(limit = 3): Promise<Array<{ jobId: string; orgId: string; provider: string }>> {
  const db = getCoreDb();
  const rows = await db.select({ jobId: finSyncJobs.id, orgId: finSyncJobs.orgId, provider: finSyncJobs.provider })
    .from(finSyncJobs)
    .where(or(eq(finSyncJobs.status, 'queued'), and(eq(finSyncJobs.status, 'running'), lt(finSyncJobs.heartbeatAt, staleClause))))
    .orderBy(finSyncJobs.createdAt).limit(limit);
  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run vitest run src/server/services/finance-sync-jobs.service.test.ts && bun run check`
Expected: PASS, check 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/finance-sync-jobs.service.ts src/server/services/finance-sync-jobs.service.test.ts
git commit -m "feat(finance): sync-job service (enqueue/claim/heartbeat/cancel/finish + cross-org discovery)"
```

---

### Task 4: Resumable worker `advanceJob`

**Files:**
- Modify: `src/server/services/finance-sync.service.ts` (replace `syncSource` body with `advanceJob` + thin `syncSource` wrapper)
- Test: `src/server/services/finance-sync.service.test.ts` (new)

**Interfaces:**
- Consumes: job service (Task 3), `getConnector` + `PullPage` (Task 2), `getSource`/`setSourceSync`/`upsertInvoice` (`finance.service`), `decryptCreds`, `overlapSince`/`nowIso`.
- Produces:
  - `advanceJob(ctx: CoreCtx, jobId: string, opts: { budgetMs: number }): Promise<void>`
  - `syncSource(ctx: CoreCtx, provider: string): Promise<{ provider: string; count: number; status: string }>` (enqueue → advance to completion → summarize; kept for convenience/tests)

- [ ] **Step 1: Write the failing test**

Create `src/server/services/finance-sync.service.test.ts`. It registers a fake connector and drives `advanceJob` with a `createMockDb` whose `resolveSequence` feeds each awaited query in order. Because the worker makes many small queries, the test focuses on the *observable* DB calls (claim, upsert via `withOrgCore`, finish) and connector consumption rather than exact row payloads.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the collaborating services so advanceJob's control flow is isolated.
const claimJob = vi.fn<() => Promise<boolean>>();
const getJobById = vi.fn();
const heartbeat = vi.fn<() => Promise<void>>(async () => {});
const isCancelRequested = vi.fn<() => Promise<boolean>>(async () => false);
const finishJob = vi.fn<() => Promise<void>>(async () => {});
vi.mock('./finance-sync-jobs.service', () => ({
  STALE_MS: 90_000,
  claimJob: (...a: unknown[]) => claimJob(),
  getJobById: (...a: unknown[]) => getJobById(),
  heartbeat: (...a: unknown[]) => heartbeat(),
  isCancelRequested: (...a: unknown[]) => isCancelRequested(),
  finishJob: (c: unknown, id: string, status: string, o?: unknown) => finishJob(c, id, status, o),
  enqueueJob: vi.fn(),
}));

const getSource = vi.fn();
const setSourceSync = vi.fn<() => Promise<void>>(async () => {});
const upsertInvoice = vi.fn<() => Promise<void>>(async () => {});
vi.mock('./finance.service', () => ({
  getSource: (...a: unknown[]) => getSource(),
  setSourceSync: (...a: unknown[]) => setSourceSync(),
  upsertInvoice: (...a: unknown[]) => upsertInvoice(),
}));

vi.mock('./finance-secrets', () => ({ decryptCreds: () => ({ username: 'u', password: 'p' }) }));

// A fake connector registered for provider 'fake'.
const pages: Array<{ invoices: unknown[]; cursor: string | null }> = [];
vi.mock('$server/finance/connector', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    getConnector: () => ({
      provider: 'fake',
      async *pullPages() { for (const p of pages) yield p; },
      async *pull() {},
      async count() { return 5; },
    }),
  };
});

import { advanceJob } from './finance-sync.service';

const ctx = { db: {} as never, tenantId: 'org-1' };
beforeEach(() => {
  vi.clearAllMocks();
  pages.length = 0;
  claimJob.mockResolvedValue(true);
  getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: null, config: {}, secretRefs: { ciphertext: 'c', iv: 'i' } });
});

describe('advanceJob', () => {
  it('drains all pages then marks succeeded and advances the watermark', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    pages.push({ invoices: [{}, {}], cursor: 'c1' }, { invoices: [{}], cursor: null });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoice).toHaveBeenCalledTimes(3);
    expect(setSourceSync).toHaveBeenCalled();
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'succeeded', undefined);
  });

  it('does nothing when the job cannot be claimed', async () => {
    claimJob.mockResolvedValue(false);
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(upsertInvoice).not.toHaveBeenCalled();
    expect(finishJob).not.toHaveBeenCalled();
  });

  it('marks failed with "no credentials configured" when secretRefs is empty', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    getSource.mockResolvedValue({ provider: 'fake', enabled: true, watermark: null, config: {}, secretRefs: {} });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'failed', { error: 'no credentials configured' });
  });

  it('cancels mid-stream when cancel is requested', async () => {
    getJobById.mockResolvedValue({ id: 'j1', provider: 'fake', processed: 0, total: null, pageCursor: null, startedAt: new Date() });
    isCancelRequested.mockResolvedValue(true);
    pages.push({ invoices: [{}], cursor: 'c1' });
    await advanceJob(ctx, 'j1', { budgetMs: Infinity });
    expect(finishJob).toHaveBeenCalledWith(ctx, 'j1', 'cancelled', undefined);
    expect(upsertInvoice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/server/services/finance-sync.service.test.ts`
Expected: FAIL — `advanceJob` not exported.

- [ ] **Step 3: Rewrite `finance-sync.service.ts`**

```ts
import type { CoreCtx } from '$server/auth/core-ctx';
import { getConnector } from '$server/finance/connector';
import '$server/finance/connectors/susii-connector'; // self-registers the 'susii' connector
import { getSource, upsertInvoice, setSourceSync } from './finance.service';
import { decryptCreds } from './finance-secrets';
import { overlapSince, nowIso } from './finance-sync.helpers';
import { claimJob, getJobById, heartbeat, isCancelRequested, finishJob, enqueueJob } from './finance-sync-jobs.service';

/**
 * Advance one sync job by pulling pages until the source is drained, the time
 * budget is spent, or cancel is requested. Resumable: persists the page cursor
 * after every page, so a later call (manual re-trigger or cron tick) continues
 * from where this one stopped. budgetMs = Infinity runs to completion.
 */
export async function advanceJob(ctx: CoreCtx, jobId: string, opts: { budgetMs: number }): Promise<void> {
  if (!(await claimJob(ctx, jobId))) return; // already actively running elsewhere, or terminal
  const job = await getJobById(ctx, jobId);
  if (!job) return;
  const provider = job.provider;

  const source = await getSource(ctx, provider);
  if (!source || !source.enabled) {
    await finishJob(ctx, jobId, 'failed', { error: 'source disabled or missing' });
    return;
  }
  const connector = getConnector(provider);
  if (!connector) {
    await finishJob(ctx, jobId, 'failed', { error: `no connector registered for provider ${provider}` });
    return;
  }
  const refs = (source.secretRefs ?? {}) as Record<string, unknown>;
  if (!refs.ciphertext || !refs.iv) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    await finishJob(ctx, jobId, 'failed', { error: 'no credentials configured' });
    return;
  }
  const { username, password } = decryptCreds(String(refs.ciphertext), String(refs.iv));
  const secrets: Record<string, string> = { username, password };
  const config = (source.config ?? {}) as Record<string, unknown>;
  const since = overlapSince(source.watermark);
  // Watermark target = when THIS backfill began (advance-only; overlapSince covers the edge).
  const watermarkTarget = job.startedAt ? new Date(job.startedAt).toISOString() : nowIso();

  let processed = job.processed;
  let total = job.total;
  let cursor: string | null = job.pageCursor ?? null;
  let consecutiveFailures = 0;
  const deadline = Date.now() + opts.budgetMs;

  // Seed the % baseline once.
  if (total == null && connector.count) {
    total = await connector.count({ config, secrets, since }).catch(() => null);
    if (total != null) await heartbeat(ctx, jobId, { processed, total, pageCursor: cursor });
  }

  try {
    for await (const page of connector.pullPages({ config, secrets, since, cursor })) {
      if (await isCancelRequested(ctx, jobId)) {
        await finishJob(ctx, jobId, 'cancelled');
        return;
      }
      for (const inv of page.invoices) {
        try {
          await upsertInvoice(ctx, inv);
          processed++;
          consecutiveFailures = 0;
        } catch {
          if (++consecutiveFailures >= 5) throw new Error('aborted: 5 consecutive invoice failures');
        }
      }
      cursor = page.cursor;
      await heartbeat(ctx, jobId, { processed, total, pageCursor: cursor });
      if (cursor == null) {
        await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
        await finishJob(ctx, jobId, 'succeeded');
        return;
      }
      if (Date.now() > deadline) return; // leave 'running' with cursor persisted; next tick resumes
    }
    // Generator ended without a final null-cursor page (e.g. zero pages) → success.
    await setSourceSync(ctx, provider, { watermark: watermarkTarget, status: 'success' });
    await finishJob(ctx, jobId, 'succeeded');
  } catch (e) {
    await setSourceSync(ctx, provider, { watermark: source.watermark ?? '', status: 'failed' });
    await finishJob(ctx, jobId, 'failed', { error: e instanceof Error ? e.message : 'sync failed' });
  }
}

/** Convenience: enqueue + run to completion in-process, returning a summary. */
export async function syncSource(ctx: CoreCtx, provider: string) {
  const job = await enqueueJob(ctx, provider);
  await advanceJob(ctx, job.id, { budgetMs: Number.POSITIVE_INFINITY });
  const final = await getJobById(ctx, job.id);
  const status = final?.status === 'succeeded' ? 'success' : (final?.status ?? 'failed');
  return { provider, count: final?.processed ?? 0, status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run vitest run src/server/services/finance-sync.service.test.ts && bun run check`
Expected: PASS, check 0/0.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/finance-sync.service.ts src/server/services/finance-sync.service.test.ts
git commit -m "feat(finance): resumable advanceJob worker (cursor persist, budget, cancel, % baseline)"
```

---

### Task 5: Endpoints + Vercel Cron

**Files:**
- Modify: `src/routes/api/finances/sync/+server.ts` (POST → enqueue + detached kick)
- Create: `src/routes/api/finances/sync/status/+server.ts` (GET)
- Create: `src/routes/api/finances/sync/cancel/+server.ts` (POST, admin)
- Create: `src/routes/api/finances/sync/tick/+server.ts` (GET, CRON_SECRET)
- Create: `vercel.json` (hub root)
- Modify: `.env.local` (add `CRON_SECRET=...` for local parity) — note in commit body, do not commit the secret value
- Test: `src/routes/api/finances/sync/tick/server.test.ts`

**Interfaces:**
- Consumes: `enqueueJob`/`getActiveJob`/`getLatestJob`/`requestCancel`/`findResumableJobs` (Task 3), `advanceJob` (Task 4), `getCoreCtx`, `isModuleEnabled`, `requireAdmin`, `getCoreDb`.
- Produces HTTP contracts:
  - `POST /api/finances/sync` `{provider?}` → `{ jobId, status }`
  - `GET /api/finances/sync/status?provider=` → `{ active, status, total, processed, error, startedAt, finishedAt }`
  - `POST /api/finances/sync/cancel` `{provider?}` → `{ ok }`
  - `GET /api/finances/sync/tick` → `{ advanced }` (401 without `Bearer $CRON_SECRET`)

- [ ] **Step 1: Write the failing test (tick auth + advance)**

Create `src/routes/api/finances/sync/tick/server.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const findResumableJobs = vi.fn();
const advanceJob = vi.fn<() => Promise<void>>(async () => {});
vi.mock('$server/services/finance-sync-jobs.service', () => ({ findResumableJobs: (...a: unknown[]) => findResumableJobs() }));
vi.mock('$server/services/finance-sync.service', () => ({ advanceJob: (...a: unknown[]) => advanceJob() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'sekret' } }));

import { GET } from './+server';

function req(auth?: string) {
  return { request: new Request('http://x/api/finances/sync/tick', auth ? { headers: { authorization: auth } } : undefined) } as never;
}
beforeEach(() => { vi.clearAllMocks(); findResumableJobs.mockResolvedValue([{ jobId: 'j1', orgId: 'o1', provider: 'susii' }]); });

describe('GET /api/finances/sync/tick', () => {
  it('rejects without the cron secret', async () => {
    await expect(GET(req())).rejects.toMatchObject({ status: 401 });
    expect(advanceJob).not.toHaveBeenCalled();
  });
  it('advances resumable jobs when authorized', async () => {
    const res = await GET(req('Bearer sekret'));
    expect(await res.json()).toEqual({ advanced: 1 });
    expect(advanceJob).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run vitest run src/routes/api/finances/sync/tick/server.test.ts`
Expected: FAIL — `./+server` does not exist.

- [ ] **Step 3: Rewrite `POST /api/finances/sync`**

Replace `src/routes/api/finances/sync/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { enqueueJob } from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';

/** POST /api/finances/sync { provider } — enqueue a background sync and kick it. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'finances'))) throw error(403, 'finances module disabled');
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  const job = await enqueueJob(ctx, provider);
  // Detached: runs to completion on a persistent runtime (localhost / adapter-node);
  // on Vercel serverless it may be frozen after the response — the cron tick resumes it.
  void advanceJob(ctx, job.id, { budgetMs: Number.POSITIVE_INFINITY })
    .catch((e) => console.error('[finance-sync] advanceJob failed', e));
  return json({ jobId: job.id, status: job.status });
};
```

- [ ] **Step 4: Create the status endpoint**

Create `src/routes/api/finances/sync/status/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getActiveJob, getLatestJob } from '$server/services/finance-sync-jobs.service';

/** GET /api/finances/sync/status?provider= — current/last job for the UI poller. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const provider = url.searchParams.get('provider') ?? 'susii';
  const job = (await getActiveJob(ctx, provider)) ?? (await getLatestJob(ctx, provider));
  return json({
    active: job ? job.status === 'queued' || job.status === 'running' : false,
    status: job?.status ?? null,
    total: job?.total ?? null,
    processed: job?.processed ?? 0,
    error: job?.error ?? null,
    startedAt: job?.startedAt ?? null,
    finishedAt: job?.finishedAt ?? null,
  });
};
```

- [ ] **Step 5: Create the cancel endpoint**

Create `src/routes/api/finances/sync/cancel/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { requestCancel } from '$server/services/finance-sync-jobs.service';

/** POST /api/finances/sync/cancel { provider } — request a hard cancel (admin). */
export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  const provider = typeof body.provider === 'string' ? body.provider : 'susii';
  await requestCancel(ctx, provider);
  return json({ ok: true });
};
```

- [ ] **Step 6: Create the cron tick endpoint**

Create `src/routes/api/finances/sync/tick/+server.ts`:

```ts
import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCoreDb } from '$server/db/pg-client';
import { findResumableJobs } from '$server/services/finance-sync-jobs.service';
import { advanceJob } from '$server/services/finance-sync.service';

/**
 * GET /api/finances/sync/tick — Vercel Cron entrypoint (every minute). Resumes
 * any queued/stalled job in a bounded chunk so syncs converge regardless of user
 * presence and recover from a dead worker. Vercel sends `Authorization: Bearer
 * $CRON_SECRET` automatically for configured crons; reject anything else.
 */
export const GET: RequestHandler = async ({ request }) => {
  const secret = env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw error(401);
  const jobs = await findResumableJobs(3);
  let advanced = 0;
  for (const j of jobs) {
    const ctx = { db: getCoreDb(), tenantId: j.orgId };
    try {
      await advanceJob(ctx, j.jobId, { budgetMs: 50_000 });
      advanced++;
    } catch (e) {
      console.error('[finance-sync] tick advanceJob failed', j.jobId, e);
    }
  }
  return json({ advanced });
};
```

- [ ] **Step 7: Add `vercel.json` + CRON_SECRET note**

Create `vercel.json` at hub root:

```json
{
  "crons": [{ "path": "/api/finances/sync/tick", "schedule": "* * * * *" }]
}
```

Add `CRON_SECRET=<random>` to `.env.local`. (Orchestrator: also set `CRON_SECRET` in the hub Vercel project env so Vercel signs cron requests. NOTE: per-minute crons require a Vercel paid plan; on Hobby the schedule is throttled — if so, fall back to a less frequent schedule or trigger the tick another way. Document the chosen cadence.)

- [ ] **Step 8: Run tests + check**

Run: `bun run vitest run src/routes/api/finances/sync/ && bun run check`
Expected: PASS, check 0/0.

- [ ] **Step 9: Commit**

```bash
git add src/routes/api/finances/sync vercel.json
git commit -m "feat(finance): bg-sync endpoints (enqueue/status/cancel) + Vercel cron tick failsafe

NOTE: set CRON_SECRET in hub Vercel env; per-minute cron needs a paid plan."
```

---

### Task 6: Shared poller + Zag linear progress in settings

**Files:**
- Modify: `package.json` (add `@zag-js/progress`), then `bun install`
- Create: `src/lib/state/features/finance-sync.svelte.ts` (shared poller)
- Modify: `src/routes/(app)/finances/settings/+page.svelte` (replace sync card with linear progress + cancel)
- Modify: `messages/en.json` + `messages/es.json` (new keys)
- Test: `src/lib/state/features/finance-sync.test.ts` (poller transitions)

**Interfaces:**
- Consumes: `GET /api/finances/sync/status`, `POST /api/finances/sync`, `POST /api/finances/sync/cancel`.
- Produces:
  - `financeSync` — object with getters `active/status/total/processed/percent` and methods `refresh(provider?: string): Promise<void>`, `start(provider?: string): Promise<void>`, `cancel(provider?: string): Promise<void>`, `stop(): void`.

- [ ] **Step 1: Add the Zag progress dependency**

Edit `package.json` dependencies, add (matching the pinned Zag range): `"@zag-js/progress": "^1.41.0",`. Run:

```bash
bun install
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/state/features/finance-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { financeSync } from './finance-sync.svelte';

beforeEach(() => { vi.restoreAllMocks(); financeSync.stop(); });
afterEach(() => financeSync.stop());

function statusResponse(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('financeSync.refresh', () => {
  it('reads an active job into state', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(statusResponse({ active: true, status: 'running', total: 200, processed: 50 }) as never);
    await financeSync.refresh('susii');
    expect(financeSync.active).toBe(true);
    expect(financeSync.processed).toBe(50);
    expect(financeSync.percent).toBe(25);
  });

  it('percent is 0 when total is unknown', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(statusResponse({ active: true, status: 'running', total: null, processed: 7 }) as never);
    await financeSync.refresh('susii');
    expect(financeSync.percent).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run vitest run src/lib/state/features/finance-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the poller**

Create `src/lib/state/features/finance-sync.svelte.ts`:

```ts
type SyncState = {
  active: boolean;
  status: string | null;
  total: number | null;
  processed: number;
  error: string | null;
};

let s = $state<SyncState>({ active: false, status: null, total: null, processed: 0, error: null });
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

const POLL_MS = 1500;

async function fetchStatus(provider: string): Promise<void> {
  try {
    const res = await fetch(`/api/finances/sync/status?provider=${encodeURIComponent(provider)}`);
    if (!res.ok) return;
    const d = (await res.json()) as Partial<SyncState>;
    s.active = d.active ?? false;
    s.status = d.status ?? null;
    s.total = d.total ?? null;
    s.processed = d.processed ?? 0;
    s.error = d.error ?? null;
  } catch {
    /* transient; keep last state */
  }
}

function schedule(provider: string): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await fetchStatus(provider);
    if (s.active && polling) schedule(provider);
    else stop();
  }, POLL_MS);
}

function stop(): void {
  polling = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export const financeSync = {
  get active() { return s.active; },
  get status() { return s.status; },
  get total() { return s.total; },
  get processed() { return s.processed; },
  get error() { return s.error; },
  get percent() { return s.total && s.total > 0 ? Math.round((s.processed / s.total) * 100) : 0; },

  /** One-shot status read (e.g. on app load to detect an in-flight sync). Starts polling if active. */
  async refresh(provider = 'susii') {
    await fetchStatus(provider);
    if (s.active && !polling) { polling = true; schedule(provider); }
  },

  /** Trigger a sync and begin polling. */
  async start(provider = 'susii') {
    await fetch('/api/finances/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    s.active = true; s.status = 'running';
    if (!polling) { polling = true; schedule(provider); }
    await fetchStatus(provider);
  },

  async cancel(provider = 'susii') {
    await fetch('/api/finances/sync/cancel', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    await fetchStatus(provider);
  },

  stop,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run vitest run src/lib/state/features/finance-sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Add i18n keys**

Add to `messages/en.json`:

```json
"fin_sync_progress": "{processed} / {total}",
"fin_sync_cancel": "Cancel sync",
"fin_sync_status_running": "Syncing…",
"fin_sync_status_succeeded": "Sync complete",
"fin_sync_status_failed": "Sync failed",
"fin_sync_status_cancelled": "Sync cancelled"
```

Add to `messages/es.json`:

```json
"fin_sync_progress": "{processed} / {total}",
"fin_sync_cancel": "Cancelar sincronización",
"fin_sync_status_running": "Sincronizando…",
"fin_sync_status_succeeded": "Sincronización completa",
"fin_sync_status_failed": "Error de sincronización",
"fin_sync_status_cancelled": "Sincronización cancelada"
```

- [ ] **Step 7: Replace the Sync card in `finances/settings/+page.svelte`**

Replace the script's sync section (the `syncBusy`/`syncMsg`/`syncNow` block, lines ~54-81) with:

```ts
	// ── Sync card ─────────────────────────────────────────────────────────────
	import { financeSync } from '$lib/state/features/finance-sync.svelte';
	import * as progress from '@zag-js/progress';
	import { useMachine, normalizeProps } from '@zag-js/svelte';
	import { onMount } from 'svelte';

	const progressSvc = useMachine(progress.machine, () => ({
		id: 'fin-sync-progress',
		value: financeSync.total == null ? null : financeSync.processed,
		max: financeSync.total ?? 100,
	}));
	const prog = $derived(progress.connect(progressSvc, normalizeProps));

	onMount(() => {
		financeSync.refresh('susii');
		return () => financeSync.stop();
	});

	function syncStatusLabel(): string {
		switch (financeSync.status) {
			case 'running':
			case 'queued': return m.fin_sync_status_running();
			case 'succeeded': return m.fin_sync_status_succeeded();
			case 'failed': return m.fin_sync_status_failed();
			case 'cancelled': return m.fin_sync_status_cancelled();
			default: return '';
		}
	}
```

Replace the Sync `<section class="card">` markup (the `RefreshCw` card) with:

```svelte
			<!-- ── Sync card ──────────────────────────────────────────────────── -->
			<section class="card">
				<header class="card-h">
					<RefreshCw size={14} />
					<span>{m.fin_sync_card()}</span>
				</header>

				<p class="t-caption mb-3">{m.fin_sync_description()}</p>

				{#if financeSync.active || financeSync.status}
					<div {...prog.getRootProps()} class="prog">
						<div class="prog-meta">
							<span class="t-caption">{syncStatusLabel()}</span>
							{#if financeSync.total != null}
								<span class="mono-val">{m.fin_sync_progress({ processed: financeSync.processed, total: financeSync.total })} · {financeSync.percent}%</span>
							{:else}
								<span class="mono-val">{financeSync.processed}</span>
							{/if}
						</div>
						<div {...prog.getTrackProps()} class="prog-track">
							<div {...prog.getRangeProps()} class="prog-range" style={financeSync.total != null ? `width:${financeSync.percent}%` : 'width:40%'}></div>
						</div>
					</div>
				{/if}

				{#if financeSync.status === 'failed' && financeSync.error}
					<p class="err-msg">{financeSync.error}</p>
				{/if}

				<div class="actions sync-actions">
					<Button variant="outline" size="sm" onclick={() => financeSync.start('susii')} disabled={financeSync.active}>
						<RefreshCw size={14} class={financeSync.active ? 'animate-spin' : ''} />
						{financeSync.active ? m.fin_sync_running() : m.fin_sync_now()}
					</Button>
					{#if financeSync.active}
						<Button variant="ghost" size="sm" onclick={() => financeSync.cancel('susii')}>{m.fin_sync_cancel()}</Button>
					{/if}
				</div>
			</section>
```

Add to the `<style>` block:

```css
	.prog { margin-bottom: 0.75rem; }
	.prog-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.35rem; }
	.prog-track { height: 6px; border-radius: 999px; background: var(--color-bg3); overflow: hidden; }
	.prog-range { height: 100%; background: var(--color-accent); border-radius: 999px; transition: width 0.4s ease; }
	.sync-actions { display: flex; gap: 0.5rem; align-items: center; }
```

Remove the now-unused `Plug`? No — `Plug` is still used by the connector card. Remove only the deleted `syncBusy`/`syncMsg`/`syncNow` symbols. Keep `RefreshCw`.

- [ ] **Step 8: Validate the Svelte file**

Use the Svelte MCP autofixer on `finances/settings/+page.svelte` (per project rules for `.svelte` edits), then run:

Run: `bun run check`
Expected: 0/0 (no `state_referenced_locally`, no unused imports).

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock src/lib/state/features/finance-sync.svelte.ts src/lib/state/features/finance-sync.test.ts src/routes/(app)/finances/settings/+page.svelte messages/en.json messages/es.json
git commit -m "feat(finance): shared sync poller + Zag linear progress + cancel in finances/settings"
```

---

### Task 7: Mini circular progress badge on the Finances nav item

**Files:**
- Create: `src/lib/components/finance/FinanceSyncBadge.svelte` (Zag circular progress, ~16px)
- Modify: `src/lib/components/layout/Sidebar.svelte` (render the badge on the `/finances` item; refresh poller on mount)

**Interfaces:**
- Consumes: `financeSync` (Task 6), `@zag-js/progress`.
- Produces: `<FinanceSyncBadge />` — renders nothing unless `financeSync.active`.

- [ ] **Step 1: Create the badge component**

Create `src/lib/components/finance/FinanceSyncBadge.svelte`:

```svelte
<script lang="ts">
	import { financeSync } from '$lib/state/features/finance-sync.svelte';
	import * as progress from '@zag-js/progress';
	import { useMachine, normalizeProps } from '@zag-js/svelte';

	const service = useMachine(progress.machine, () => ({
		id: 'fin-nav-progress',
		value: financeSync.total == null ? null : financeSync.processed,
		max: financeSync.total ?? 100,
	}));
	const api = $derived(progress.connect(service, normalizeProps));
</script>

{#if financeSync.active}
	<span {...api.getRootProps()} class="badge" title={`${financeSync.percent}%`}>
		<svg viewBox="0 0 24 24" width="14" height="14" class={financeSync.total == null ? 'spin' : ''}>
			<circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-bg3)" stroke-width="3" />
			<circle
				cx="12" cy="12" r="9" fill="none" stroke="var(--color-accent)" stroke-width="3"
				stroke-linecap="round" transform="rotate(-90 12 12)"
				stroke-dasharray={2 * Math.PI * 9}
				stroke-dashoffset={financeSync.total == null
					? 2 * Math.PI * 9 * 0.7
					: 2 * Math.PI * 9 * (1 - financeSync.percent / 100)}
			/>
		</svg>
	</span>
{/if}

<style>
	.badge { display: inline-flex; align-items: center; justify-content: center; margin-left: auto; }
	.spin { animation: spin 1s linear infinite; transform-origin: center; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 2: Wire it into the Sidebar**

In `src/lib/components/layout/Sidebar.svelte`:

Add to the `<script>` imports:

```ts
	import FinanceSyncBadge from '$lib/components/finance/FinanceSyncBadge.svelte';
	import { financeSync } from '$lib/state/features/finance-sync.svelte';
	import { onMount } from 'svelte';
```

Add an onMount to detect an in-flight sync after any navigation/refresh (only if not already present in the file — if `onMount` is already imported/used, just add the call):

```ts
	onMount(() => {
		financeSync.refresh('susii');
	});
```

In the nav-item `{#snippet children(trigger)}` block (around line 205-209), after the `<span class="nav-label">` and before the `currentHome` Star, add:

```svelte
				{#if item.href === '/finances'}
					<FinanceSyncBadge />
				{/if}
```

- [ ] **Step 3: Validate Svelte files**

Run the Svelte MCP autofixer on both `FinanceSyncBadge.svelte` and `Sidebar.svelte`, then:

Run: `bun run check`
Expected: 0/0.

- [ ] **Step 4: Manual smoke (orchestrator, optional)**

With creds configured and the migration applied, hit "Sync now" → the settings bar fills and the nav ring appears; navigate to another page → ring persists (poller restarted by Sidebar onMount via `refresh`); click Cancel → job ends.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/finance/FinanceSyncBadge.svelte src/lib/components/layout/Sidebar.svelte
git commit -m "feat(finance): mini circular sync-progress ring on the Finances nav item"
```

---

## Self-Review

**Spec coverage:**
- `fin_sync_jobs` table + RLS + active-uniqueness → Task 1. ✓
- DRF count baseline + cursor resume in connector → Task 2. ✓
- Job lifecycle (enqueue/claim/heartbeat/cancel/finish) + cross-org discovery → Task 3. ✓
- Resumable `advanceJob` (budget, cancel, idempotent upsert, watermark) → Task 4. ✓
- POST/status/cancel/tick endpoints + vercel.json + CRON_SECRET → Task 5. ✓
- Shared poller + Zag linear-progress + cancel in settings + i18n → Task 6. ✓
- Mini Zag circular-progress on the nav item + presence-independent re-detect on mount → Task 7. ✓
- Credential persistence: confirmed already-satisfied (no task needed); the settings "credentials set" hint already exists (`fin_connector_credentials_hint`), so no UI change required. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. The two orchestrator-only manual steps (apply migration via MCP; set Vercel `CRON_SECRET` env) are explicit, with verification, not placeholders.

**Type consistency:** `advanceJob(ctx, jobId, {budgetMs})`, `finishJob(ctx, jobId, status, {error?})`, `heartbeat(ctx, jobId, {processed, total?, pageCursor})`, `PullPage {invoices, cursor}`, `financeSync.{active,status,total,processed,percent,refresh,start,cancel,stop}` are used identically across Tasks 3–7. SUSII `salesPages` now yields `{results,next}` everywhere (Task 2 updates its own test). ✓

**Risk note (carry into execution):** the `advanceJob` unit test mocks collaborators heavily; the real integration (withOrgCore transactions, Zag reactive context updating the bar) is validated by the orchestrator's manual smoke in Task 7 Step 4 + a live SUSII sync. If Zag's `value` context does not update reactively via the `() => ({...})` props function, the rendered width still works (it's driven directly by `financeSync.percent` inline style); the Zag machine is used for a11y props + state, so a non-reactive machine value won't break the visible bar.
