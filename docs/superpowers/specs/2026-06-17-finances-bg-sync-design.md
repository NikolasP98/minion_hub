# Finances — Background SUSII Sync (durable jobs + smart progress)

**Date:** 2026-06-17
**Repo:** `minion_hub` · branch `dev`
**Status:** Design approved (A+B hybrid). Follows `2026-06-17-finances-module-design.md` (Phase 1 built).

## Problem

The SUSII finance sync currently runs synchronously inside `POST /api/finances/sync` and reports
an indefinite spinner. This has four problems the user wants fixed:

1. Navigating away from `/finances/settings` (or any tab) risks interrupting the sync.
2. There is no smart progress — just a spinner with no sense of how far along the sync is.
3. There is no hard-cancel.
4. There is no failsafe if the worker dies mid-sync (process restart, redeploy, function freeze).

The user also asked to confirm that **connector credentials survive gateway restarts and hub refreshes**.

## Non-goals

- Moving the finance worker to the netcup gateway (keeps finance hub-native).
- CRM↔Finance bridge work (Phase 2, separate spec).
- Changing the credential storage model (already AES-256-GCM encrypted in `fin_sources.secret_refs`).

## Constraints / facts

- **Hub deploys to Vercel serverless** (`adapter-vercel`, `nodejs22.x` — see `svelte.config.js`). A detached
  promise does not outlive a serverless function, and a multi-year SUSII backfill exceeds any function time
  limit. **Local dev connects to prod gxv**, so the heavy initial backfill realistically runs from a persistent
  localhost process; deployed prod only ever performs small incremental syncs.
- **Credentials already persist**: stored encrypted in `fin_sources.secret_refs` (gxv). They survive gw
  restarts and hub redeploys by construction. The settings form does not prefill them (by design), which is
  why it can *look* unsaved. No change required beyond making the "credentials set" state unambiguous.
  The `reconfigure` `last_status` seen in a screenshot is stale data — no code path writes that value.
- The sync is **idempotent** (`upsertInvoice` onConflictDoUpdate + delete/insert children) and
  **watermark-resumable** (`syncSource` advances `watermark` only on full success; `overlapSince` rewinds 5min).
- **SUSII DRF API** returns `count` (total matching rows, respects `modified_after`) → perfect % baseline, and
  a `next` absolute URL → perfect page cursor for chunked resume. No secret is embedded in `next`.

## Architecture (A+B hybrid)

Durable job state lives in a new DB table. A resumable chunk worker advances a job by pulling SUSII pages and
upserting invoices, persisting a page cursor after every page. Two drivers invoke the worker:

- **A — immediate detached kick** from `POST /api/finances/sync` (responsive on persistent runtimes: localhost,
  adapter-node desktop).
- **B — Vercel Cron tick** (`GET /api/finances/sync/tick`, every minute) that resumes any `queued` job or any
  `running` job whose heartbeat is stale, with a bounded time budget. This is the presence-independent failsafe
  that guarantees convergence even on Vercel and recovers from a dead worker.

Both call the same `advanceJob(ctx, jobId, { budgetMs })`. Progress, cursor, and cancel intent all live in the
DB row, so no driver holds state in memory.

### 1. Data model — `fin_sync_jobs`

Drizzle schema in `src/server/db/pg-finance-schema.ts`; hand-written idempotent migration at meta-repo root
`supabase/migrations/<stamp>_fin_sync_jobs.sql`, applied to gxv via Supabase MCP (same pattern as Phase 1).

| column            | type          | notes                                                        |
| ----------------- | ------------- | ------------------------------------------------------------ |
| `id`              | uuid pk       | `gen_random_uuid()`                                          |
| `org_id`          | uuid          | RLS GUC scope                                                |
| `provider`        | text          | e.g. `susii`                                                 |
| `status`          | text          | `queued` \| `running` \| `succeeded` \| `failed` \| `cancelled` |
| `total`           | integer       | nullable; DRF `count` baseline, null until known             |
| `processed`       | integer       | default 0                                                    |
| `page_cursor`     | text          | nullable; DRF `next` URL to resume from                      |
| `error`           | text          | nullable                                                     |
| `cancel_requested`| boolean       | default false                                                |
| `started_at`      | timestamptz   | nullable                                                     |
| `finished_at`     | timestamptz   | nullable                                                     |
| `heartbeat_at`    | timestamptz   | nullable; bumped every page                                  |
| `created_at`      | timestamptz   | default now()                                                |
| `updated_at`      | timestamptz   | default now()                                                |

- RLS: enable + force; one policy `fin_sync_jobs_org_guc for all using (org_id = current_setting('app.current_org_id', true)::uuid) with check (...)` — matching the existing `fin_*` tables.
- Partial unique index: `create unique index if not exists fin_sync_jobs_active_uq on fin_sync_jobs (org_id, provider) where status in ('queued','running')` → at most one live job per connector.
- Index `(org_id, provider, created_at desc)` for "latest job" lookups and `(status, heartbeat_at)` for the tick scan.

`STALE_MS = 90_000` — a `running` job with `heartbeat_at` older than this is considered dead and resumable.

### 2. Connector interface — make it page-aware + countable

`src/server/finance/connector.ts`:

```ts
export interface PullPage { invoices: CanonicalInvoice[]; cursor: string | null; }
export interface PullPagesOpts extends PullOpts { cursor?: string | null; }
export interface FinanceConnector {
  provider: string;
  pull(opts: PullOpts): AsyncIterable<CanonicalInvoice>;          // kept (convenience)
  pullPages(opts: PullPagesOpts): AsyncIterable<PullPage>;        // NEW — batch + resumable cursor
  count?(opts: PullOpts): Promise<number | null>;                // NEW — optional % baseline
}
```

`pull` becomes a thin wrapper over `pullPages` (yield each invoice from each page) so existing callers/tests
keep working.

`SusiiClient` (`susii-client.ts`):
- `async count(opts): Promise<number | null>` — GET first page `page_size=1`, return DRF `count` (null on failure).
- `salesPages` already yields pages; add the ability to **start from a given `next` URL** (cursor) and surface
  the next cursor. Either change `salesPages` to yield `{ results, next }` or add a `salesPageFrom(cursor)` —
  whichever keeps the file small. The susii connector's `pullPages` maps each page's sales → canonical invoices
  and passes through the page's `next` as `cursor`.

`susii-connector.ts` implements `pullPages` and `count` delegating to `SusiiClient`; `pull` wraps `pullPages`.

### 3. Job service — `src/server/services/finance-sync-jobs.service.ts`

All functions take `CoreCtx` and use `withOrgCore`.

- `getActiveJob(ctx, provider)` → the `queued`/`running` row or null.
- `getLatestJob(ctx, provider)` → most recent row (for status display when nothing active).
- `enqueueJob(ctx, provider)` → if an active job exists, return it (dedupe); else insert `queued`. Returns the job.
- `claimJob(ctx, jobId)` → atomically flip `queued`→`running` (or re-claim a stale `running`), set
  `started_at`/`heartbeat_at`. Returns false if already actively claimed (fresh heartbeat) so two drivers don't
  double-run.
- `heartbeat(ctx, jobId, { processed, total?, pageCursor })`.
- `requestCancel(ctx, provider)` → set `cancel_requested=true` on the active job.
- `finishJob(ctx, jobId, status, { error? })` → set terminal status + `finished_at`; on `succeeded` advance the
  source watermark (call `setSourceSync`).
- `findResumableJobs(limit)` — **org-agnostic** query for the cron tick: `queued` jobs + `running` jobs with
  stale heartbeat, across all orgs. Returns `{ jobId, orgId, provider }`. The tick is not request-scoped to one
  tenant, so this cannot run under `withOrgCore` (app_ledger + a single-org GUC, RLS forced). It must use a DB
  connection/role that can read across orgs — verify whether the hub's base core connection runs as a role that
  bypasses/owns RLS; if not, add a narrowly-scoped system read (a `SECURITY DEFINER` function or a BYPASSRLS
  service role) for **only** this cross-org job-discovery query. Once `(orgId, jobId)` is known, the tick builds
  a per-org `CoreCtx` and does all actual work (claim, upsert, finish) through the normal org-GUC path.

### 4. Worker — `advanceJob(ctx, jobId, { budgetMs })` in `finance-sync.service.ts`

Replaces the body of the old `syncSource` (kept as a thin `advanceJob`-to-completion wrapper for any callers/tests).

```
load job; if terminal → return
claim job (running, heartbeat); if not claimable → return
load source; decrypt creds (early-fail 'no credentials configured' → finishJob failed)
if job.total is null and connector.count exists → set total
deadline = now + budgetMs
for await page of connector.pullPages({ config, secrets, since: overlapSince(watermark), cursor: job.page_cursor }):
    if (await isCancelRequested) → finishJob('cancelled'); return
    upsert each invoice (existing 5-consecutive-failure abort)
    processed += page.invoices.length
    heartbeat({ processed, total, pageCursor: page.cursor })
    if page.cursor == null → finishJob('succeeded'); return     // drained
    if now > deadline → return (leave 'running' with cursor persisted; next tick resumes)
```

- `budgetMs`: detached kick on a persistent runtime → large/Infinity (run to completion). Cron tick → ~50_000.
- Cancel is checked once per page (cheap, bounded latency).
- Errors: connector/network throw → `finishJob('failed', { error })`, cursor preserved so a retry can resume.

### 5. Endpoints

- `POST /api/finances/sync` `{ provider }` → 401 if no ctx, 403 if module disabled. `enqueueJob`, then kick
  `advanceJob(ctx, jobId, { budgetMs: Infinity })` **without awaiting** (`.catch` logs). Return `{ jobId, status }`.
  (On Vercel this won't finish big backfills in-process — that's what the tick is for. On localhost it runs to
  completion.)
- `GET /api/finances/sync/status?provider=` → `{ active, status, total, processed, error, startedAt, finishedAt }`
  from `getActiveJob ?? getLatestJob`. Member-level (read).
- `POST /api/finances/sync/cancel` `{ provider }` → `requireAdmin`; `requestCancel`. Return `{ ok }`.
- `GET /api/finances/sync/tick` → **not org-scoped**. Guard with `CRON_SECRET`: accept Vercel Cron's
  `Authorization: Bearer $CRON_SECRET` header (Vercel sends it automatically for configured crons) — reject 401
  otherwise. `findResumableJobs(limit=3)`; for each build a system CoreCtx for that `orgId` and call
  `advanceJob(ctx, jobId, { budgetMs: 50_000 })`. Process sequentially within one invocation to stay under the
  function limit. Return `{ advanced: n }`.

`vercel.json` (new or extended): `{ "crons": [{ "path": "/api/finances/sync/tick", "schedule": "* * * * *" }] }`.
`CRON_SECRET` added to hub Vercel env (and `.env.local` for parity / manual trigger).

### 6. UI

**Shared poller** — `src/lib/state/features/finance-sync.svelte.ts`: a small `$state` store
`{ active, status, total, processed }` plus `start(provider)` / `stop()` that poll
`GET /api/finances/sync/status` every ~1500ms while a job is active, backing off to idle when terminal. One
instance shared by the settings card and the nav badge (org-scoped; reset on org switch). Polling chosen over
WS to stay within the existing finance HTTP surface and avoid gateway coupling.

**finances/settings Sync card** — replace the spinner button with a Zag **progress** machine rendered linearly
(`@zag-js/progress` + `@zag-js/svelte`, `value = processed`, `max = total ?? processed`, indeterminate when
`total == null`). Show `processed / total` and %, the status, and a **Cancel** button (calls cancel endpoint,
admin-only) while active. "Sync now" enqueues and starts the poller.

**Main nav sidebar** — mini Zag **progress** rendered as a **circular** ring on the Finances nav item, shown
only when `active`. Indeterminate ring until `total` known, then determinate. Click → `/finances/settings`.
Lives in the sidebar component that renders `BUILTIN_PLUGIN_ITEMS` (see `sections.ts`); reads the shared poller.

New `@zag-js/progress@^1.41.0` dependency (matches the pinned Zag version range).

i18n: add keys to `messages/en.json` + `messages/es.json` for progress label, %, cancel, cancelled/failed status,
"credentials set". Compile via the build step.

## Error handling

- No credentials → job `failed`, error `no credentials configured`; settings surfaces it.
- 5 consecutive invoice upsert failures → abort (existing rule) → job `failed`, cursor preserved.
- Connector/network error → job `failed`, cursor preserved; re-trigger or next tick resumes.
- Dead worker (stale heartbeat) → tick re-claims and resumes from `page_cursor`.
- Double-drive race → `claimJob` refuses a freshly-heartbeating job.
- Cancel → job `cancelled` within one page of latency; watermark NOT advanced.

## Testing

- `finance-sync-jobs.service` unit tests: enqueue dedupe, claim/stale-reclaim, cancel, finish advances watermark.
- `advanceJob` tests with a fake connector: budget stop persists cursor + leaves `running`; resume continues from
  cursor; drain → `succeeded`; cancel mid-stream → `cancelled`; count seeds total; failure preserves cursor.
- `susii-client.count` + cursor-resume page mapping (fetch mocked).
- `pull` wrapper still yields the same invoices as before (regression).
- Tick endpoint: rejects without `CRON_SECRET`; advances a stale job. Status endpoint shape.
- `bun run check` 0/0; keep the green baseline.

## Rollout

1. Schema + migration → apply to gxv via MCP (additive).
2. Connector interface + SusiiClient count/cursor.
3. Job service + advanceJob.
4. Endpoints + vercel.json + CRON_SECRET.
5. Shared poller + settings linear progress + nav circular badge + i18n.
6. `bun run check`, tests, commit to `dev`. (Vercel cron activates on deploy.)
```
