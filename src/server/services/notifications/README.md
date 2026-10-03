# Notification event storage

This directory contains fresh notification authority, the typed event/outbox foundation, and the bounded scheduler with organization-scoped health. The scheduler has no registered production audience projector yet, so an enabled production worker reports `projection_unavailable` and acquires no runtime lease. The event APIs have no production producer yet. The catalog reports `integrated: false` until each domain adapter and its audience projection are qualified. Existing legacy notification and reminder services remain separate; a legacy `sent` row is not a provider receipt.

## Module responsibilities

| Module                                           | Responsibility                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`authority.ts`](authority.ts)                   | Fresh active organization membership and `comms:create` / `comms:manage` admission for existing routes |
| [`event-envelope.ts`](event-envelope.ts)         | Canonical source identity, catalog admission, payload and semantic hashes                              |
| [`event-store.ts`](event-store.ts)               | Atomic source-transaction append and exact duplicate receipts                                          |
| [`worker-transaction.ts`](worker-transaction.ts) | Dedicated RLS pool, transaction-local worker role, organization, owner and SQL timeouts                |
| [`outbox-claim.ts`](outbox-claim.ts)             | Bounded pending/expired claims and unsupported-catalog probes                                          |
| [`event-integrity.ts`](event-integrity.ts)       | Revalidation of stored supported-catalog evidence before projection                                    |
| [`outbox-settlement.ts`](outbox-settlement.ts)   | Live-owner/generation settlement and one bounded lease renewal                                         |
| [`worker-failure.ts`](worker-failure.ts)         | Typed availability failures and rate-limited, data-free Sentry reports                                 |

The shared [catalog](../../../lib/notifications/catalog.ts) owns event kinds and schemas. [Policy contracts](../../../lib/notifications/policy-contracts.ts) name the recipient and source checks that later projectors must implement. A semantic policy ID is not an RBAC permission string. The public catalog exposes availability metadata; it does not authorize a producer or recipient.

## Append contract

Call `appendNotificationEvent(tx, { organizationId }, input)` inside the actual business mutation's `withOrgCore` transaction. Await it before that transaction finishes. Never open a second transaction for the event or expose the generic envelope as a browser/agent write API.

The transaction must use `app_ledger`, the exact canonical organization GUC and READ COMMITTED isolation. The producer supplies source identity, subject revision and occurred-at from its durable source change. It must not substitute a fresh wall-clock timestamp on retry. Payloads contain reviewed references, with a 32 KiB UTF-8 ceiling and smaller schema-specific bounds.

An exact retry returns the original immutable event receipt with `inserted: false`. A same-key semantic change throws `NotificationEventConflict`. Validation and conflict failures also raise a database exception inside the source transaction so a caller cannot catch a JavaScript error and accidentally commit the business mutation without its event. Callers must let that transaction roll back; creating savepoint-based workarounds is outside this API's contract.

The database trigger creates the pending outbox row in the same transaction and stamps database write provenance. App code cannot insert an outbox row directly, change event evidence or delete either table's rows. Source transaction ID and the newly allocated event UUID are excluded from duplicate semantics.

## Claim and settlement contract

Use `claimNotificationEventsForOrg({ organizationId, ownerId })` for the current catalog. It opens the dedicated worker transaction, acquires a nonblocking organization advisory lock, and claims at most 250 rows. A busy result is explicit. Eligibility depends on committed row state; event IDs and timestamps never form a consumption checkpoint.

Each receipt contains event ID, owner, generation and expiry. The initial lease lasts 30 seconds. One renewal may extend it to the original 60-second hard deadline. A reclaim increments generation. `settleNotificationEvent` and `renewNotificationEvent` require the exact live receipt; an expired or stale receipt changes no rows. Terminal state cannot be rewritten.

`projected` means the audience projection has committed. It does not mean sent, delivered or read. No production caller may settle `projected` until its real projection transaction is implemented. The native fixture uses explicit harmless claim/settle calls without a provider.

Malformed supported-catalog evidence enters a finite quarantine state. A page uses one bounded invoker-function call for at most 250 malformed claims, avoiding a pair of network round trips for every row; the function retains each row's live owner/generation check and the transaction timeout. Future catalog rows remain pending and set `unsupportedCatalogPending`; an old worker cannot quarantine them merely because it lacks their schema. The raw transaction claim function accepts an explicit compatible revision list for future worker integration. Calling it does not replace the future worker's parser and authority checks.

`NotificationWorkerUnavailable` carries only a finite failure reason. It never includes the original SQL, body, destination or database error. PostgreSQL restores transaction-local role/GUC/timeouts after success or rollback. Monitoring errors cannot replace an operational failure or release a connection while its query still runs.

## Storage and qualification

[The outbox migration](../../../../supabase/migrations/20261003150000_notification_event_outbox.sql) defines forced RLS, immutable evidence, bounded envelope checks, least-privilege producer/worker roles, legal lease transitions and partial claim indexes. The event trigger has a narrowly owned SECURITY DEFINER function because ordinary producer INSERT must atomically enqueue without granting the producer direct outbox authority. Its owner is non-login, non-bypass and does not own the tables.

[Native qualification](event-outbox.sql.integration.test.ts) uses a marked disposable PostgreSQL child database, the actual migration runner and production APIs. Its pool mock supplies a real restricted database connection; SQL behavior is not mocked. It covers atomic source writes, concurrent duplicates, commit inversion, pagination, lease races, privilege boundaries, pool restoration, future catalogs and query plans. Fixture roles and databases must be removed after the suite.

The catalog manifest script requires an exact `NOTIFICATION_CATALOG_BASE_REF`. A changed schema or policy must produce a reviewed new catalog revision; regenerating the manifest alone must fail the revision gate. Unit tests compare booking status and permission inventories with their actual domain sources.

The owning meta proposal is `proposals/2026-10-03-notification-recon.md`; the approved storage contract is `specs/2026-10-03-notification-slice3-catalog-outbox-spec.md`. Audience projection, preferences, inbox, civil time, destinations, report snapshots, Gateway receipts and retention remain separate implementation slices. Do not infer release readiness from the presence of this foundation.

## Scheduler ownership and health

[`scheduler/loop.ts`](scheduler/loop.ts) owns one discovery tick, one heartbeat and at most four organization projections. [`worker-bootstrap.ts`](worker-bootstrap.ts) registers this lifecycle only in an explicitly enabled adapter-node process (`DESKTOP=1`, `NOTIFICATION_WORKER=1`). Vercel and build imports start no worker. The qualification projector is removed from the normal compiled artifact; runtime flags cannot enable it.

[`scheduler/runtime-lease.ts`](scheduler/runtime-lease.ts) fences global leadership by owner, generation and the exact build/catalog/projector identity. [`scheduler/discovery.ts`](scheduler/discovery.ts) uses bounded index seeks and atomically advances fair organization scan positions with claims. These positions are not event-consumption checkpoints. [`scheduler/organization-lease.ts`](scheduler/organization-lease.ts) renews or completes only exact live receipts. Missing singleton state, incompatible schema or exhausted generations are explicit unavailable conditions; the worker never resets them.

Coordinator lock contention retries only after the database transaction and rollback settle. Retry admission is bounded by sixteen attempts and a four-second monotonic window. An already admitted query still owns its actual settlement. Busy coordination does not imply lost leadership; expired or replaced authority is checked again in SQL.

Shutdown first stops admission and aborts discovery between actual awaited queries. If COMMIT already won, unstarted claims are abandoned using their exact live receipts without writing completion or success history. Active projection and renewal promises remain owned until settlement, including a projector that ignores its AbortSignal. A hard-deadline result cannot become a clean completion; an expired SQL receipt cannot change durable history. Ambiguous abandonment retains an uncancellable cleanup loop until a read of the exact receipt proves it no longer live or abandonment succeeds. A database outage can therefore keep graceful drain pending; it never manufactures a cleanup receipt. Global leadership is released only after owned work settles.

[`worker-health.ts`](worker-health.ts) reads operational columns through a dedicated read-only RLS role. The HTTP boundary requires fresh `comms:manage` authority for the current organization. Queue counts stop at a 5,001-row sentinel and return `5000+`; independent indexed oldest-row seeks retain exact age. Missing worker state and database failures do not become healthy zeros. Admission revisions and hashes remain explicitly nullable when unavailable. The qualification-only artifact value identifies its frozen projector source; the compiled bundle has a separate manifest receipt. No production bundle identity is inferred from that fixture value. Health proves worker readiness, not delivery.

[`scheduler/telemetry.ts`](scheduler/telemetry.ts) emits finite Sentry diagnoses and at most one PostHog sample per operational phase per minute. Samples contain duration, bounded counts and finite states, never organization identity, event data, SQL or raw errors. Monitoring cannot affect ownership or cleanup.

The scheduler contract is `specs/2026-10-03-notification-slice4-worker-health-spec.md`. Native qualification uses the actual migration and restricted SQL APIs; compiled-process qualification separately exercises startup, standby takeover, disabled production behavior and shutdown. A source or fixture pass must not be represented as deployed audience delivery.
