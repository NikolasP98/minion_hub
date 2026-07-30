# MINION Hub connection capacity and realtime messaging audit

**Date:** 2026-07-25

**Scope:** `minion_hub`, the deployed Minion gateways, Supabase/Supavisor, Vercel functions, Netcup cron, and Meta Graph ingestion

**Status:** Evidence-backed architecture report; no production settings or application code were changed

## Executive verdict

The proximate login failure is **database connection checkout unavailability**, not evidence of an authentication-logic defect. The strongest supported architectural explanation is a checkout-exhaustion cascade amplified by the request topology. A current per-role connection census and a before/after containment test are still required to prove how much each amplifier contributes.

Three mechanisms are the leading, evidence-backed amplifiers:

1. Five database-backed cron routes start together every minute. The Meta route can continue inside Vercel for 300 seconds even though Netcup stops waiting after 50 seconds, so later minutes can overlap earlier invocations.
2. Every Vercel isolate that loads `hooks.server.ts` unconditionally creates a second 60-second database scheduler. An isolate must remain runnable for at least 60 seconds for its first tick to execute; Vercel may freeze or terminate shorter-lived isolates. Live logs prove interval creation across unrelated routes and show scheduler tick failures in long-lived functions, but do not prove that every created interval executed repeatedly.
3. Each production isolate exposes up to **4 Hub-owned, on-demand physical pooler connection slots**: 3 general plus 1 RLS transaction slot. These are neither browser users nor guaranteed-open sockets. Vercel can create isolates much faster than the database can create backend sessions.

The current one-minute Meta Graph poll does not create a realtime chat experience. It is a six-hour-staleness reconciliation job invoked every minute. Its cross-org discovery work grows linearly with organization count, while its long Graph API work extends invocation lifetime and causes overlap.

MINION already has most of the right event-driven ingress:

- the Meta Graph gateway extension accepts signed webhooks and acknowledges immediately;
- every inbound gateway message can be written to a durable local SQLite outbox;
- the outbox flushes idempotently to Hub `/api/messages/ingest`;
- the Hub persists messages under organization RLS.

The missing pieces are operational wiring and UI fanout:

- both production gateways have the message ledger and Hub flush enabled, but neither has an Instagram or Messenger channel account configured;
- the Hub UI still polls message APIs every 12, 15, or 60 seconds;
- there is no post-commit Broadcast event for browsers.

**Recommended target:** Meta webhook → gateway SQLite outbox → Hub message transaction → private Supabase Realtime Broadcast → subscribed Hub clients. Keep Graph polling only as a cursor-based reconciliation/backfill path on a persistent, globally capped worker.

## Protocol fit: what Realtime replaces—and what it does not

| Existing path | Current responsibility | Decision | Why |
|---|---|---|---|
| Browser ↔ gateway custom WebSocket (`req` / `res` / `event`) | Gateway RPC, agents, sessions, presence, pairing, tool streams, restart/update progress | **Keep** | It is the live control plane for state owned by the gateway, not Supabase. |
| Hub server → gateway request-scoped WebSockets | Server-side gateway RPC and long-running update orchestration | **Keep** | Private server/gateway transport; browser Realtime does not provide RPC. |
| PTY / remote terminal WebSockets | Interactive binary terminal streams | **Keep** | Stream semantics cannot be replaced by database change signals. |
| Hub cache HTTP broadcaster | Hub write → gateway cache invalidation | **Keep** | Server-to-gateway coherence, not browser freshness. |
| NATS JetStream worker plane | Durable queued work, leases, retries, global/per-org concurrency | **Orthogonal** | JetStream isolates background work; it does not directly refresh authenticated browsers. |
| Omnichat 15/60-second polling | Detect newly committed ledger messages | **Replace when subscribed** | Database Broadcast becomes the fast invalidation signal; the existing API remains canonical. |
| CRM contact 12-second polling | Detect new messages for the open contact | **Replace when subscribed** | Exact channel/chat filtering avoids org-wide refetch fanout. |
| Five-minute visibility-aware poll | Missed-event and outage recovery | **Keep** | Realtime is an optimization, never the only consistency path. |

The implementation uses one singleton Supabase client and one shared private
`org:<orgId>:events` channel per browser tab. Event names (`message.committed`,
future `notification.changed`, `job.updated`, and so on) multiplex over that
channel, avoiding a new WebSocket and private-channel authorization query for
every component or domain.

Until Supabase reports the private channel as `SUBSCRIBED`, Omnichat and CRM keep
their old polling cadences. After subscription, they switch to the five-minute
self-heal interval plus event-driven refetches. This makes migration/deploy order
fail-safe.

## What is exact, and what remains unknown

| Item | Current evidence | Confidence |
|---|---:|---|
| Production Hub general app pool | `SUPABASE_DB_POOL_SIZE=3` | Exact, pulled from current Vercel production env |
| Production Hub RLS pool | `SUPABASE_DB_RLS_POOL_SIZE=1` | Exact, pulled from current Vercel production env |
| Production Hub on-demand pooler slot cap per isolate | `3 + 1 = 4` | Exact |
| Local Hub general / critical / RLS caps | `8 + 4 + 5 = 17` | Exact, current local env and pool code |
| Hub connection mode | Shared Supavisor transaction mode, port `6543` | Exact |
| Current failure | `ECHECKOUTTIMEOUT` after 15 seconds in transaction mode | Exact, local and production logs |
| Session-mode availability | Also returns `ECHECKOUTTIMEOUT` after 15 seconds on port `5432` | Exact, read-only live probe |
| Last directly measured Postgres use | `21 / 60` sessions; 1 active | Exact as of 2026-07-12, not current |
| Current Postgres `max_connections` | Unknown; live SQL cannot check out a connection | Explicitly unverified |
| Current Supabase compute tier | Unknown | Explicitly unverified |
| Current Supavisor backend pool size | Unknown; dashboard setting not available through the checked interfaces | Explicitly unverified |
| Nano/Micro documented limits | 60 Postgres connections, 200 pooler clients | Current official Supabase defaults; tier match unverified |
| Managed Supabase baseline by role | Exists, but current exact role counts are unavailable during saturation | Partially verified |

The distinction between **pooler client slots** and **Postgres backend connections** matters:

- the Hub’s `4 × isolates` number is a client-side ceiling;
- the compute tier’s pooler-client limit is how many clients Supavisor accepts;
- the configured Supavisor pool size is how many backend Postgres sessions those clients compete for;
- Auth, PostgREST, Storage, Realtime, health checks, direct tools, and other role/database/mode combinations also consume Postgres capacity.

Increasing the 200-client ceiling would not solve the observed error. The error says accepted clients could not obtain a backend connection.

## Current application-side connection budget

### Production

`src/server/db/pg-pool.ts` creates:

- one general postgres-js pool with `max=3`;
- no separate critical pool in production—the critical path reuses general;
- one RLS transaction pool with `max=1`.

Therefore:

```text
Hub Supavisor client ceiling = warm Vercel isolates × 4
```

Illustrative ceilings if the requests land on distinct isolates:

| Concurrent warm isolates | Potential Hub clients |
|---:|---:|
| 1 | 4 |
| 5 distinct isolates serving synchronized minute routes | 20 |
| 5 distinct overlapping Meta isolates + 4 other route isolates | 36 |
| Previous scenario + 2 top-of-hour route isolates | 44 |
| 20 isolates under user/cron load | 80 |
| 50 isolates | 200 |

These are scenario ceilings, not an observed isolate count or proof that every pool slot is open simultaneously. Vercel can reuse an isolate, and postgres-js opens physical pooler connections on demand and closes idle clients after 20 seconds. However, the minute herd, initialization reads, long request lifetimes, and per-isolate scheduler create enough demand that the multiplier must be bounded and measured.

### Local development

Local development uses:

- general pool: 8;
- separate critical pool: `min(4, 8) = 4`;
- RLS pool: 5.

The local process can therefore open up to **17 on-demand physical pooler connections**. Local and production currently target the same Supabase project, so a busy local session competes with production.

## What is taking connections

### 1. Synchronized Vercel cron functions

The live Netcup crontab starts these routes every minute:

- `/api/scheduling/reminders/tick`
- `/api/finances/sync/tick`
- `/api/notifications/tick`
- `/api/jobs/tick`
- `/api/meta/sync/tick`

At the top of the hour, memberships and org-config add two more database-backed routes.

The routes are separate HTTP requests and may be served by separate Vercel isolates. They begin within the same second, creating a thundering herd against the same Supavisor role/database/mode combination.

### 2. A backup scheduler in every serverless isolate

`src/hooks.server.ts:508` calls `startBackupScheduler()` at module import. The scheduler creates a 60-second `setInterval` and logs `[backup-scheduler] Started` immediately.

This is valid lifecycle behavior for a persistent Node server, but not for an autoscaled request runtime. Each isolate that loads the module creates its own interval. If the isolate remains runnable until the interval fires, it performs a cross-tenant `backup_configs` read. The live production logs show scheduler starts under unrelated routes including reminders, finance, jobs, notifications, Meta sync, memberships, org-config, and ordinary page requests.

During saturation, the scheduler’s own `backup_configs` read fails with the same checkout timeout in long-lived functions. It is a plausible amplifier and a diagnostic marker—not proof that every created interval ticked or that scheduled backups created the original load.

### 3. Meta sync invocation overlap

The live Meta cron uses:

```text
* * * * * flock -n ... curl -m 50 https://hub.minion-ai.org/api/meta/sync/tick
```

`flock` protects only the local curl process. When curl exits at 50 seconds, the lock is released even if the Vercel function continues. Vercel logs show the Meta route reaching its 300-second runtime timeout.

At a one-minute cadence:

```text
maximum overlap from one five-minute runtime ≈ ceil(300 / 60) = 5 invocations
```

The source manifest says Meta sync is hourly, but the live crontab invokes it every minute. That drift hides the actual capacity model.

### 4. Cross-org Meta discovery

Every invocation:

1. reads all organizations with non-revoked Meta connections;
2. performs three `getLatestSucceededJob` RLS transactions per organization;
3. may perform three more enqueue transactions per organization;
4. finds up to three due jobs;
5. advances those jobs sequentially.

For `N` connected organizations, one tick invocation attempts:

```text
3N RLS discovery transactions before enqueue
up to at least 6N RLS discovery/enqueue transactions when all three kinds are stale
```

These partial counts exclude the global org/job queries, unique-conflict recovery reads, initialization work, claimed job work, and any multiplication from overlapping tick invocations.

| Connected orgs | Discovery tx per invocation | All-stale discovery/enqueue tx per invocation |
|---:|---:|---:|
| 10 | 30 | 60 |
| 100 | 300 | 600 |
| 1,000 | 3,000 | 6,000 |

The jobs are only considered stale after six hours. Invoking this discovery scan every minute performs 360 checks per six-hour window for each org/kind before it is eligible again.

### 5. Hub request initialization

Every serverless route also starts cache initialization, which reads gateway credentials from Postgres. Production logs show that read failing during unrelated tick routes. A request can therefore consume pool capacity before its route handler begins useful work.

### 6. Browser polling

Current UI refresh loops include:

- CRM contact timeline: every 12 seconds while visible;
- open Omnichat thread: every 15 seconds;
- Omnichat conversation list: every 60 seconds.

These do not hold persistent Postgres sessions, but each refresh can create a serverless request and a new database transaction. The demand scales with open users and tabs.

### 7. Managed Supabase services

Supabase documents long-lived baseline connections from PostgREST, Auth, Storage, Realtime, and health checks. They are not counted inside the Hub’s `3 + 1` pool.

The last direct measurement on 2026-07-12 found 21 of 60 Postgres sessions present, with one active. That historical baseline is useful, but current per-role occupancy could not be refreshed because both Supavisor modes were unable to check out a backend.

### 8. Persistent event listeners

The Hub emits some domain events through `pg_notify('hub_events', ...)`, and comments point to a long-lived flows-runner `LISTEN` connection. Such a listener consumes a persistent database session if deployed. Its live process and count were not confirmed in this audit, so it is not included in the exact totals.

## Live production evidence window

A deduplicated Vercel sample covered approximately 13 minutes and contained 57 unique log records after eliminating CLI pagination duplicates. It showed:

- one `/api/meta/sync/tick` 300-second runtime timeout;
- checkout errors on jobs, notifications, and DNI-validation routes;
- repeated `[backup-scheduler] Started` records under five different minute routes and ordinary traffic;
- one `/api/auth/password-login` request with no completed HTTP status in the sampled window.

This is a bounded incident sample, not a traffic census. It proves cross-route failure propagation and per-isolate scheduler creation; it does not provide a complete connection time series.

## Why per-minute polling is the wrong realtime primitive

Polling answers “what changed since the last read?” by repeatedly paying the full discovery and query cost, even when nothing changed. At one-minute resolution it also cannot deliver a true chat feel; the Hub’s current UI independently polls at 12–60 seconds.

For incoming Meta messages, the event already exists at the source. Meta sends the gateway a webhook. The gateway should persist and forward that event once, and the Hub should push a compact post-commit notification to connected clients.

Polling still has an important job:

- repair missed webhooks;
- hydrate old history;
- reconcile edits/deletes/delivery state not captured in the primary event;
- backfill after a token reconnect;
- verify cursors and freshness.

It should be a **reconciliation plane**, not the realtime ingress plane.

## Existing event-driven capability

### Available in code

The Meta Graph extension:

- handles the subscription handshake;
- validates `X-Hub-Signature-256` over the raw body;
- acknowledges with HTTP 200 before asynchronous routing;
- supports Instagram, Messenger, and WhatsApp Cloud processors.

The generic inbound gateway path:

- records every inbound message to the local SQLite message ledger;
- creates a deterministic client ID;
- retains unsynced rows through Hub/database outages;
- flushes batches to `/api/messages/ingest`;
- requires acknowledgements keyed by the exact client IDs in the attempted batch;
- retries unacknowledged rows with backoff.

The Hub ingest route:

- authenticates the physical gateway;
- derives the organization and gateway ID;
- idempotently upserts messages under RLS;
- queues conversation-brain work;
- returns explicit acknowledgements.

### Verified live

Both production gateway containers currently have:

- `gateway.messageLedger.enabled=true`;
- valid, enabled Hub metrics configuration targeting `hub.minion-ai.org`;
- a configured gateway identity and API key;
- the `meta-graph` plugin installed and enabled.

Their aggregate outbox states were:

| Gateway | Channel | Total rows | Pending | Acknowledged |
|---|---|---:|---:|---:|
| faces | WhatsApp | 59,205 | 0 | 59,205 |
| default | WhatsApp | 14,719 | 0 | 14,719 |
| default | Telegram | 19 | 0 | 19 |

No Instagram or Messenger rows were present.

The active gateway configs contain no Instagram or Messenger channel account keys. The Meta plugin has shared app credentials, but without a started channel account it has no owning processor for those webhooks. Therefore, the code path is deployed but not operationally wired for Meta messaging.

## Target architecture

```text
Meta webhook
  ↓ signed, fast ACK
Persistent Minion gateway
  ↓ durable local append
SQLite message outbox
  ↓ idempotent batch every ~10s
Hub /api/messages/ingest
  ↓ one org-scoped transaction
Supabase messages + durable jobs
  ↓ AFTER INSERT trigger calls realtime.send() in the same transaction
Private Realtime Broadcast: org:<orgId>:events
  ↓
Open Hub clients update/refetch affected conversation

Separate reconciliation worker:
Graph cursors → bounded repair jobs → same idempotent messages upsert
```

### Ingress plane

Configure the Instagram and Messenger channel accounts on the appropriate gateway and register the gateway’s `/meta` callback in the Meta app. Keep signature verification and immediate acknowledgement in the gateway.

Do not make the webhook wait for:

- the LLM reply;
- the Hub database;
- embeddings/brain work;
- contact analysis;
- attribution resolution.

The local outbox is the durability boundary.

### Persistence plane

Keep `messages` as the source of truth. Ingest by deterministic `(org_id, client_id)` identity, preserve `gateway_id`, and write any durable follow-up job in the same transaction where practical.

The existing outbox makes at-least-once delivery safe because Hub writes are idempotent.

### Browser fanout plane

Use **Supabase Realtime Broadcast**, not Postgres Changes, for Hub clients. The recommended first implementation is database-originated Broadcast so the event is created in the same transaction as the durable message:

- private, tab-shared topic: `org:<orgId>:events` (event names separate message, notification, and future domain signals without multiplying channels);
- event: `message.committed`;
- payload: message ID/client ID, channel, account ID, chat ID, direction, occurred-at, and version;
- do not send full sensitive conversation content unless the authorization model explicitly requires it;
- on event, patch the active thread or refetch the affected conversation;
- on reconnect or version gap, perform a normal API refresh.

Implement an `AFTER INSERT` trigger on `messages` whose `SECURITY DEFINER` function calls `realtime.send()` with the compact payload and private topic. Database-originated Broadcast inserts into `realtime.messages` inside the message transaction; commit makes both the message and Broadcast record durable together, then Realtime fans it out from WAL. The trigger must avoid broadcasting idempotent conflict updates or backfill rewrites as new messages.

Authorize private topics with RLS on `realtime.messages`, requiring the authenticated profile to be an active member of the organization encoded in the topic. Do not rely on the topic string alone as authorization.

Broadcast replay is available only for database-originated Broadcast messages. Treat its short retention and bounded replay count as a reconnect optimization, never as message history; the canonical catch-up path remains the Hub read API. An application-side HTTP Broadcast after commit would be simpler, but it introduces a commit/publish failure gap and does not provide database-originated replay, so it is not the recommended first implementation.

Supabase recommends Broadcast over Postgres Changes for scalability and security. Postgres Changes performs authorization work per subscriber and processes changes on a single thread; Broadcast fans out an event once.

### Reconciliation plane

Move Graph history synchronization to a persistent worker with:

- cursor-based jobs;
- one global concurrency limit;
- a per-org concurrency limit of one per sync kind;
- leases with owner, expiry, and heartbeat;
- bounded item and wall-clock budgets;
- exponential retry and dead-letter state;
- targeted high-priority reconciliation after webhook gaps or reconnects;
- a lower baseline cadence, initially 15–60 minutes for messages and six-hour/daily windows for analytics, adjusted from measured webhook loss.

The route that schedules work should return quickly. It should not execute up to three long Graph slices in the same Vercel request.

### Work queue choice

The lowest-change first step is the existing Postgres job table with a persistent worker and `FOR UPDATE SKIP LOCKED`/lease semantics.

The production host already runs Valkey, so a later BullMQ/Valkey work queue is viable when:

- job volume exceeds comfortable Postgres queue throughput;
- rate-limit scheduling needs delayed jobs;
- per-org fairness needs explicit queue partitions;
- independent worker autoscaling is required.

Valkey should carry job coordination, not become the message source of truth.

## Option comparison

| Option | Latency | Durability | Database effect | Multi-org scaling | Verdict |
|---|---|---|---|---|---|
| One-minute Graph polling | 0–60s, often worse | DB job rows | Repeated cross-org scans and long functions | Poor without sharding | Reconciliation only |
| Direct gateway WebSocket event to browser | Very low | Requires replay design | Low | Complex across gateways/reconnects | Useful supplemental path |
| Supabase Postgres Changes | Low | DB is source | Per-subscriber authorization and single-thread ordering | Moderate | Avoid as primary |
| Supabase private database Broadcast | Low | Message + Broadcast record commit together; short replay optimization | One broadcast event, managed fanout | Strong | Recommended browser plane |
| External NATS/Valkey broker end-to-end | Very low | Depends on stream config | Low direct DB fanout | Strongest | Later-stage complexity |

## Pool and connection strategy

### Immediate containment

1. Remove `startBackupScheduler()` from serverless module initialization. Schedule backup/retention work externally or run it in one persistent worker.
2. Replace per-route minute crons with one dispatcher or stagger them across the minute. Avoid synchronized `* * * * *` requests.
3. Add a durable server-side lease around each dispatcher. `flock` on the curl client is not sufficient because it cannot observe remote completion.
4. Make `/api/meta/sync/tick` enqueue/claim only; do not run Graph slices inside the HTTP request.
5. Keep local development off the production Supabase project or reduce its pool budget when shared production access is unavoidable.

### Pool sizing

Do not raise the Supavisor client cap as the first response.

Once current occupancy is visible:

1. identify the compute tier and `max_connections`;
2. read the configured Supavisor pool size;
3. measure baseline by role and peak by application name;
4. reserve capacity for Auth, PostgREST, Storage, Realtime, maintenance, and operator access;
5. size the Hub backend share from measured concurrency and query latency.

Supabase’s current guidance says that when PostgREST is in use, the pooler allocation should generally stay at or below approximately 40% of Postgres connections. If the project still has `max_connections=60`, that is an **upper guard of 24**, not a recommended target. The correct target may be lower after managed-service baseline and failure reserve are included.

Keep the current application-side `3 + 1` production cap until the isolate fanout is removed and load-tested. Lowering the pool to one previously serialized critical app-shell reads and caused timeouts; simply shrinking without changing query topology moves the queue into the application.

### Observability required for an exact census

Add stable `application_name` values:

- `minion-hub-vercel-general`;
- `minion-hub-vercel-rls`;
- `minion-hub-worker`;
- `minion-hub-local`;
- `minion-flows-listener`;
- migration/admin identities.

Record:

- route and workload class;
- organization hash, not raw tenant data;
- pool class;
- wait time before first query;
- query/transaction duration;
- pool-reset reason;
- worker lease age;
- active and queued job counts;
- webhook received → outbox → Hub commit → Broadcast → client-render latency.

The final exact census should combine:

- Supabase **Database Connections** by role;
- **Shared Pooler Client Connections**;
- current database compute tier and Supavisor pool size;
- `pg_stat_activity` sampled during a normal window and an incident;
- Vercel function concurrency by route;
- worker and gateway application names.

## Multi-org scaling rules

The desired invariants are:

1. **Organizations add work, not schedulers.** One global scheduler discovers/dispatches jobs.
2. **A noisy org cannot consume the fleet.** Per-org concurrency and rate-limit buckets are mandatory.
3. **A message event is processed once logically.** At-least-once transport plus idempotent storage.
4. **Realtime delivery does not require a database reread per idle second.**
5. **Reconciliation is cursor-based and shardable.**
6. **No request-lifecycle process owns an infinite timer.**
7. **Connection demand is bounded independently of Vercel concurrency.**

Recommended initial worker limits:

- one running messages reconciliation job per org;
- one running analytics job per org;
- 2–4 global Graph jobs until rate/latency data supports more;
- 1–2 database write transactions at a time per worker;
- separate interactive-request and background-work budgets.

These are safe starting limits, not measured maxima.

## Delivery plan

### Phase 0 — stop the connection cascade

- remove the backup interval from `hooks.server.ts`;
- create one externally scheduled backup/retention entrypoint;
- prevent remote overlap with a renewable database/Valkey lease;
- stagger or consolidate minute cron;
- make Meta tick enqueue-only;
- tag connections with `application_name`;
- capture Supabase observability screenshots/exports before and after.

### Phase 1 — activate event-driven Meta ingest

- configure Instagram/Messenger channel accounts on the correct production gateway;
- verify callback handshake and signed webhook delivery;
- prove one inbound message creates one gateway outbox row;
- prove Hub acknowledges it with the expected `gateway_id`;
- prove a Hub outage leaves the row pending and recovery drains it exactly once;
- retain Graph polling as reconciliation.

### Phase 2 — realtime Hub fanout

- add private Realtime topic authorization by org;
- create `message.committed` transactionally through an `AFTER INSERT` trigger and `realtime.send()`;
- subscribe Omnichat and CRM surfaces;
- replace 12/15-second foreground polling with event-driven refresh;
- retain a slow reconnect/visibility fallback poll.

### Phase 3 — worker isolation and fairness

- run sync workers persistently on Netcup or a dedicated worker platform;
- claim jobs with durable leases;
- add global and per-org concurrency limits;
- split message reconciliation from posts/ads analytics;
- use Valkey only if measured queue pressure justifies it.

### Phase 4 — capacity validation

- load-test 10, 100, and projected 1,000-org schedules;
- simulate webhook bursts and database unavailability;
- verify login and interactive APIs keep reserved capacity;
- define alerts on checkout wait, connection utilization, worker lag, and event-delivery latency;
- only then reconsider compute tier or Supavisor pool size.

## Acceptance criteria

The architecture is ready to scale when:

- login succeeds while all scheduled workloads are active;
- no serverless request starts a background interval;
- only one scheduler exists per workload class;
- duplicate minute invocations cannot overlap work;
- an inbound Instagram/Messenger webhook appears in Hub in under 10 seconds at p95 under normal conditions;
- a disconnected browser catches up on reconnect;
- a Hub outage does not lose gateway messages;
- a missed webhook is repaired by reconciliation;
- 100 connected orgs do not produce 300–600 discovery transactions every minute;
- pool checkout wait and consumer identity are visible in dashboards;
- interactive traffic has a documented connection reserve.

## Source evidence

### Code

- `minion_hub/src/server/db/pg-pool.ts:22-132`
- `minion_hub/src/hooks.server.ts:508-511`
- `minion_hub/src/server/services/backup-scheduler.ts:164-173`
- `minion_hub/src/routes/api/meta/sync/tick/+server.ts:8-62`
- `minion_hub/src/lib/automations/system-automations.ts:46-51`
- `minion/extensions/meta-graph/src/webhook.ts:1-120`
- `minion/src/channels/fire-message-inbound.ts:1-48`
- `minion/src/infra/message-ledger.ts`
- `minion/src/infra/message-ledger-flusher.ts:60-155`
- `minion_hub/src/routes/api/messages/ingest/+server.ts:12-44`
- `minion_hub/src/lib/components/my-agent/OmnichatDock.svelte:203-215`
- `minion_hub/src/routes/(app)/crm/[contactId]/+page.svelte:360-367`
- `minion_hub/src/server/events/emit.ts:4-20`

### Current official platform documentation

- [Supabase compute and connection limits](https://supabase.com/docs/guides/platform/compute-and-disk)
- [Supabase database connection modes and pooler model](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Monitoring Postgres and Supavisor connections](https://supabase.com/docs/guides/troubleshooting/monitor-supavisor-postgres-connections)
- [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)
- [Supavisor terminology](https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO)
- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Supabase database-change options](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes)
- [Postgres Changes scaling limits](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)

## Measurement limitation

An exact current per-role connection census was attempted through both Supavisor transaction and session modes. Both failed with `ECHECKOUTTIMEOUT` before SQL could run. No destructive connection termination was attempted.

The current compute tier, Supavisor backend pool size, and live `pg_stat_activity` breakdown must therefore be captured from Supabase Dashboard Observability/Database Settings or from SQL Editor after capacity recovers. Until that is collected, any statement that “the database has exactly X free connections” would be false precision.
