import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATION_CATALOG, NOTIFICATION_KINDS } from '$lib/notifications/catalog';

const boundary = vi.hoisted(() => ({
  rlsPool: vi.fn(),
  ordinaryPool: vi.fn(),
  criticalPool: vi.fn(),
}));
vi.mock('$server/db/pg-pool', () => ({
  getRlsPgClient: boundary.rlsPool,
  getPgClient: boundary.ordinaryPool,
  getCriticalPgClient: boundary.criticalPool,
  resetAllPgPools: vi.fn(),
}));

import { appendNotificationEvent, NotificationEventConflict } from './event-store';
import {
  claimNotificationEventsForOrg,
  claimNotificationEventsInTransaction,
  type ClaimedNotificationEvent,
  type NotificationLeaseReceipt,
} from './outbox-claim';
import {
  renewNotificationEvent,
  settleNotificationEvent,
  settleNotificationEventInTransaction,
} from './outbox-settlement';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
} from './worker-transaction';
import {
  OUTBOX_ORG_A,
  OUTBOX_ORG_B,
  OUTBOX_OWNER_A,
  OUTBOX_OWNER_B,
  resetNotificationOutbox,
  setupNotificationOutboxHarness,
  teardownNotificationOutboxHarness,
  type NotificationOutboxHarness,
} from '../../../../tests/fixtures/notification-outbox/postgres-harness';
import {
  CURRENT_CATALOG_REVISION,
  FIXED_OCCURRED_AT,
  FUTURE_CATALOG_REVISION,
  asApplicationRole,
  bulkInsertRawEvents,
  deferred,
  expireProcessingEvent,
  fixtureUuid,
  inSourceTransaction,
  insertRawEvent,
  insertSourceMutation,
  joinRequestedInput,
  withOutboxFixtureMaintenance,
} from '../../../../tests/fixtures/notification-outbox/runtime-harness';
import { CATALOG_EVENT_INPUTS } from '../../../../tests/fixtures/notification-outbox/catalog-vectors';
import {
  verifyNotificationAuthority,
  verifyNotificationWorkerPool,
} from '../../../../tests/fixtures/notification-outbox/authority-cases';
import { verifyNotificationQueryPlans } from '../../../../tests/fixtures/notification-outbox/plan-case';
import {
  verifyBoundedQuarantineBatch,
  verifyFiniteMalformedRows,
} from '../../../../tests/fixtures/notification-outbox/quarantine-cases';
import { verifyEnvelopeSqlLimits } from '../../../../tests/fixtures/notification-outbox/envelope-cases';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const MIGRATION = join(
  ROOT,
  'supabase',
  'migrations',
  '20261003150000_notification_event_outbox.sql',
);
let harness: NotificationOutboxHarness;

async function counts() {
  const [row] = await harness.owner<{ sources: number; events: number; outbox: number }[]>`select
    (select count(*)::int from public.notification_source_fixture) as sources,
    (select count(*)::int from public.notification_events) as events,
    (select count(*)::int from public.notification_outbox) as outbox`;
  return row;
}

function scope(ownerId = OUTBOX_OWNER_A, organizationId = OUTBOX_ORG_A) {
  return Object.freeze({ ownerId, organizationId });
}

function rawClaim(
  workerScope: NotificationWorkerScope,
  revisions: readonly string[] = [CURRENT_CATALOG_REVISION],
) {
  return withNotificationWorkerTransaction(workerScope, (tx) =>
    claimNotificationEventsInTransaction(tx, workerScope, revisions),
  );
}

async function settleBatch(
  workerScope: NotificationWorkerScope,
  events: readonly ClaimedNotificationEvent[],
) {
  return withNotificationWorkerTransaction(workerScope, async (tx) => {
    const settled: boolean[] = [];
    for (const event of events) {
      settled.push(
        await settleNotificationEventInTransaction(tx, workerScope, event.lease, 'projected'),
      );
    }
    return settled;
  });
}

describe('native notification event outbox ownership', () => {
  beforeAll(async () => {
    harness = await setupNotificationOutboxHarness();
    boundary.rlsPool.mockImplementation(() => harness.worker);
    boundary.ordinaryPool.mockImplementation(() => {
      throw new Error('Ordinary PostgreSQL pool must not serve notification worker operations');
    });
    boundary.criticalPool.mockImplementation(() => {
      throw new Error('Critical PostgreSQL pool must not serve notification worker operations');
    });
  }, 90_000);

  beforeEach(async () => {
    boundary.rlsPool.mockImplementation(() => harness.worker);
    boundary.ordinaryPool.mockClear();
    boundary.criticalPool.mockClear();
    await resetNotificationOutbox(harness);
  });

  afterEach(async () => {
    boundary.rlsPool.mockImplementation(() => harness.worker);
    const [shape] = await harness.owner<
      { forceRls: boolean; transitionEnabled: boolean }[]
    >`select c.relforcerowsecurity as "forceRls",
      exists(select 1 from pg_trigger t where t.tgrelid=c.oid
        and t.tgname='notification_outbox_transition' and t.tgenabled<>'D') as "transitionEnabled"
      from pg_class c where c.oid='public.notification_outbox'::regclass`;
    expect(shape).toEqual({ forceRls: true, transitionEnabled: true });
  });

  afterAll(async () => {
    if (harness) await teardownNotificationOutboxHarness(harness);
  }, 30_000);

  it('applies Slice2 and the event outbox through the production runner with exact roles, catalog and no-op replay', async () => {
    expect(harness.migration.error).toBeUndefined();
    expect(harness.migration.signal).toBeNull();
    expect(harness.migration.code).toBe(0);
    expect(harness.migration.stdout).toContain('db:migrate — applying 20261003140000');
    expect(harness.migration.stdout).toContain('db:migrate — applying 20261003150000');
    expect(harness.migration.stdout.indexOf('20261003140000')).toBeLessThan(
      harness.migration.stdout.indexOf('20261003150000'),
    );
    expect(harness.status.code, harness.status.stderr).toBe(0);
    expect(harness.status.stdout).toContain('0 pending');
    expect(harness.rerun.code, harness.rerun.stderr).toBe(0);
    expect(harness.rerun.stdout).toContain('db:migrate — done (0 applied).');

    expect(
      await harness.owner`select version from public.hub_migrations
        where version in ('20261003140000','20261003150000') order by version`,
    ).toEqual([{ version: '20261003140000' }, { version: '20261003150000' }]);
    expect(
      await harness.owner<{ table: string }[]>`
        select c.relname as table from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=any(${[
          'sched_reminder_config',
          'sched_reminders',
          'notif_rules',
          'notif_log',
          'notification_events',
          'notification_outbox',
        ]}) order by c.relname`,
    ).toEqual(
      [
        'notif_log',
        'notif_rules',
        'notification_events',
        'notification_outbox',
        'sched_reminder_config',
        'sched_reminders',
      ].map((table) => ({ table })),
    );
    const roles = await harness.owner<
      { role: string; login: boolean; super: boolean; bypass: boolean; inherit: boolean }[]
    >`select rolname as role,rolcanlogin as login,rolsuper as super,rolbypassrls as bypass,
      rolinherit as inherit from pg_roles where rolname in
      ('notification_event_trigger','notification_worker') order by rolname`;
    expect(roles).toEqual([
      {
        role: 'notification_event_trigger',
        login: false,
        super: false,
        bypass: false,
        inherit: false,
      },
      { role: 'notification_worker', login: false, super: false, bypass: false, inherit: false },
    ]);
    expect(readFileSync(MIGRATION, 'utf8')).toContain(
      'grant execute on function public.notification_event_abort_source_transaction() to app_ledger',
    );
  });

  it('admits every reviewed catalog producer pair through the append API and rejects a mismatched SQL tuple', async () => {
    const sourceId = fixtureUuid(16, 7);
    const receipts = await inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
      await insertSourceMutation(tx, OUTBOX_ORG_A, sourceId, 'catalog-contract');
      const appended = [];
      for (const input of CATALOG_EVENT_INPUTS) {
        appended.push(await appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, input));
      }
      return appended;
    });
    expect(receipts).toHaveLength(NOTIFICATION_KINDS.length);
    expect(receipts.every((receipt) => receipt.inserted)).toBe(true);

    const actual = await harness.owner<{ kind: string; producerId: string }[]>`
      select kind,producer_id as "producerId" from public.notification_events
      order by kind,producer_id`;
    const expected = NOTIFICATION_KINDS.map((kind) => ({
      kind,
      producerId: NOTIFICATION_CATALOG[kind].producer,
    })).sort((left, right) =>
      `${left.kind}\0${left.producerId}`.localeCompare(`${right.kind}\0${right.producerId}`),
    );
    expect(actual).toEqual(expected);
    expect(await counts()).toEqual({ sources: 1, events: 16, outbox: 16 });

    await expect(
      asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
        insertRawEvent(tx, {
          organizationId: OUTBOX_ORG_A,
          dedupeKey: 'catalog-mismatched-producer',
          kind: 'join.requested',
          producerId: 'agent.notice',
          subjectType: 'join_request',
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await counts()).toEqual({ sources: 1, events: 16, outbox: 16 });
  });

  it('commits source evidence atomically and rolls back explicit, oversize and caught append failures', async () => {
    const committed = joinRequestedInput(1);
    const committedSource = fixtureUuid(1, 7);
    const result = await inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
      await insertSourceMutation(tx, OUTBOX_ORG_A, committedSource, 'committed');
      return appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, committed);
    });
    expect(result.inserted).toBe(true);
    expect(await counts()).toEqual({ sources: 1, events: 1, outbox: 1 });

    await expect(
      inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
        await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(2, 7), 'rollback');
        await appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, joinRequestedInput(2));
        throw new Error('fixture source rollback');
      }),
    ).rejects.toThrow('fixture source rollback');

    const oversize = {
      ...joinRequestedInput(3),
      payload: {
        ...(joinRequestedInput(3).payload as object),
        extra: 'é'.repeat(17_000),
      },
    } as never;
    await expect(
      inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
        await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(3, 7), 'caught-oversize');
        try {
          await appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, oversize);
        } catch {
          // The append API intentionally poisons the SQL transaction even when a caller catches.
        }
      }),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ sources: 1, events: 1, outbox: 1 });
  });

  it('converges eight concurrent exact retries, isolates organizations and rejects source or payload digest conflicts', async () => {
    const input = joinRequestedInput(10);
    const retries = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
          await insertSourceMutation(
            tx,
            OUTBOX_ORG_A,
            fixtureUuid(100 + index, 7),
            `retry-${index}`,
          );
          return appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, input);
        }),
      ),
    );
    expect(retries.filter((retry) => retry.inserted)).toHaveLength(1);
    expect(new Set(retries.map((retry) => retry.event.id)).size).toBe(1);
    expect(await counts()).toEqual({ sources: 8, events: 1, outbox: 1 });

    const otherOrg = await inSourceTransaction(harness, OUTBOX_ORG_B, async (tx) => {
      await insertSourceMutation(tx, OUTBOX_ORG_B, fixtureUuid(200, 7), 'other-org');
      return appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_B }, input);
    });
    expect(otherOrg.inserted).toBe(true);
    expect(otherOrg.event.id).not.toBe(retries[0].event.id);

    await expect(
      inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
        await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(201, 7), 'conflict');
        await appendNotificationEvent(
          tx,
          { organizationId: OUTBOX_ORG_A },
          {
            ...input,
            sourceIdentity: 'different-source-receipt',
          },
        );
      }),
    ).rejects.toBeInstanceOf(NotificationEventConflict);
    expect(
      await harness.owner`select value from public.notification_source_fixture where id=${fixtureUuid(201, 7)}::uuid`,
    ).toEqual([]);

    await expect(
      inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
        await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(202, 7), 'payload-conflict');
        await appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, {
          ...input,
          payload: {
            ...(input.payload as { requestId: string; applicantProfileId: string }),
            applicantProfileId: fixtureUuid(202, 4),
          },
        } as never);
      }),
    ).rejects.toBeInstanceOf(NotificationEventConflict);
    expect(
      await harness.owner`select value from public.notification_source_fixture where id=${fixtureUuid(202, 7)}::uuid`,
    ).toEqual([]);
    expect(await counts()).toEqual({ sources: 9, events: 2, outbox: 2 });
  }, 30_000);

  it('claims a later-occurring commit first and still observes the earlier-timestamped uncommitted event after it commits', async () => {
    const earlierOccurredAt = '2026-10-03T12:00:00.000Z';
    const laterOccurredAt = '2026-10-03T12:01:00.000Z';
    const insertedA = deferred();
    const releaseA = deferred();
    const taskA = inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
      await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(300, 7), 'earlier-uncommitted');
      const receipt = await appendNotificationEvent(
        tx,
        { organizationId: OUTBOX_ORG_A },
        joinRequestedInput(300, { occurredAt: earlierOccurredAt }),
      );
      insertedA.resolve();
      await releaseA.promise;
      return receipt;
    });
    await insertedA.promise;

    const receiptB = await inSourceTransaction(harness, OUTBOX_ORG_A, async (tx) => {
      await insertSourceMutation(tx, OUTBOX_ORG_A, fixtureUuid(301, 7), 'later-committed');
      return appendNotificationEvent(
        tx,
        { organizationId: OUTBOX_ORG_A },
        joinRequestedInput(301, { occurredAt: laterOccurredAt }),
      );
    });
    const first = await claimNotificationEventsForOrg(scope());
    expect(first.events.map((event) => event.id)).toEqual([receiptB.event.id]);
    expect(first.events[0].occurred_at).toBe(laterOccurredAt);
    expect(
      await harness.owner`select id,to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt"
        from public.notification_events order by occurred_at,id`,
    ).toEqual([{ id: receiptB.event.id, occurredAt: laterOccurredAt }]);
    expect(await settleNotificationEvent(scope(), first.events[0].lease, 'projected')).toBe(true);

    releaseA.resolve();
    const receiptA = await taskA;
    const secondScope = scope(OUTBOX_OWNER_B);
    const second = await claimNotificationEventsForOrg(secondScope);
    expect(second.events.map((event) => event.id)).toEqual([receiptA.event.id]);
    expect(second.events[0].occurred_at).toBe(earlierOccurredAt);
    expect(
      await harness.owner`select id,to_char(occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "occurredAt"
        from public.notification_events order by occurred_at,id`,
    ).toEqual([
      { id: receiptA.event.id, occurredAt: earlierOccurredAt },
      { id: receiptB.event.id, occurredAt: laterOccurredAt },
    ]);
    expect(await settleNotificationEvent(secondScope, second.events[0].lease, 'projected')).toBe(
      true,
    );
    expect((await claimNotificationEventsForOrg(scope())).events).toEqual([]);
  }, 30_000);

  it('pages 501 equal-time rows as 250, 250 and 1, reports contention, and reclaims only the crashed generation', async () => {
    await bulkInsertRawEvents(harness, {
      organizationId: OUTBOX_ORG_A,
      count: 501,
      dedupePrefix: 'page',
      occurredAt: FIXED_OCCURRED_AT,
    });
    const first = await rawClaim(scope());
    expect(first.busy).toBe(false);
    expect(first.events).toHaveLength(250);
    expect(first.candidateStatements).toBeLessThanOrEqual(32);

    const secondScope = scope(OUTBOX_OWNER_B);
    const second = await rawClaim(secondScope);
    expect(second.events).toHaveLength(250);
    const third = await rawClaim(secondScope);
    expect(third.events).toHaveLength(1);
    const observed = [...first.events, ...second.events, ...third.events];
    expect(new Set(observed.map((event) => event.id)).size).toBe(501);
    expect(new Set(observed.map((event) => event.occurred_at))).toEqual(
      new Set([FIXED_OCCURRED_AT]),
    );
    expect(
      (await settleBatch(secondScope, [...second.events, ...third.events])).every(Boolean),
    ).toBe(true);

    await withOutboxFixtureMaintenance(harness, async (tx) => {
      await tx`with stamp as materialized (select clock_timestamp() as value)
        update public.notification_outbox set
          claimed_at=stamp.value-interval '40 seconds',
          hard_deadline=stamp.value+interval '20 seconds',
          lease_expires_at=stamp.value-interval '10 seconds'
        from stamp where event_id=any(${first.events.map((event) => event.id)}::uuid[])`;
    });
    const reclaimed = await rawClaim(secondScope);
    expect(reclaimed.events).toHaveLength(250);
    expect(new Set(reclaimed.events.map((event) => event.id))).toEqual(
      new Set(first.events.map((event) => event.id)),
    );
    expect(new Set(reclaimed.events.map((event) => event.lease.generation))).toEqual(
      new Set(['2']),
    );
    expect((await settleBatch(secondScope, reclaimed.events)).every(Boolean)).toBe(true);
    expect((await rawClaim(scope())).events).toEqual([]);

    const locked = deferred();
    const release = deferred();
    const holder = harness.competitor.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${OUTBOX_ORG_A},0))`;
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const busy = await rawClaim(scope());
    expect(busy).toMatchObject({ busy: true, events: [], unsupportedCatalogPending: null });
    release.resolve();
    await holder;
  }, 120_000);

  it('fences expiry and generation independently, stale owners, renewal, deadline drift and terminal replay', async () => {
    await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
      insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: 'lease-one' }),
    );
    const first = (await rawClaim(scope())).events[0];
    expect(first.lease.generation).toBe('1');
    await expireProcessingEvent(harness, first.id);
    expect(await settleNotificationEvent(scope(), first.lease, 'projected')).toBe(false);
    const secondScope = scope(OUTBOX_OWNER_B);
    const second = (await rawClaim(secondScope)).events[0];
    expect(second.lease.generation).toBe('2');

    const staleGeneration = Object.freeze({
      ...second.lease,
      generation: first.lease.generation,
    });
    expect(await settleNotificationEvent(secondScope, staleGeneration, 'projected')).toBe(false);

    expect(await settleNotificationEvent(scope(), first.lease, 'projected')).toBe(false);
    expect(await settleNotificationEvent(scope(), first.lease, 'payload_invalid')).toBe(false);
    expect(await renewNotificationEvent(scope(), first.lease)).toBeNull();

    await expect(
      withNotificationWorkerTransaction(secondScope, async (tx) => {
        await tx`select set_config('app.notification_generation',${second.lease.generation},true)`;
        await tx`update public.notification_outbox set claim_count=0
          where event_id=${second.id}::uuid`;
      }),
    ).rejects.toThrow();

    const renewed = await Promise.all([
      renewNotificationEvent(secondScope, second.lease),
      renewNotificationEvent(secondScope, second.lease),
    ]);
    expect(renewed.filter(Boolean)).toHaveLength(1);
    expect(renewed.filter((value) => value === null)).toHaveLength(1);
    const live = renewed.find(Boolean) as NotificationLeaseReceipt;
    expect(await renewNotificationEvent(secondScope, live)).toBeNull();

    await expect(
      withNotificationWorkerTransaction(secondScope, async (tx) => {
        await tx`select set_config('app.notification_generation',${live.generation},true)`;
        await tx`update public.notification_outbox set hard_deadline=hard_deadline+interval '1 second'
          where event_id=${live.eventId}::uuid`;
      }),
    ).rejects.toThrow();
    expect(await settleNotificationEvent(secondScope, live, 'projected')).toBe(true);
    expect(await settleNotificationEvent(secondScope, live, 'projected')).toBe(false);
    expect((await rawClaim(scope())).events).toEqual([]);
  }, 30_000);

  it('enforces real producer and worker RLS, ACL, trigger origin and role-graph boundaries', async () => {
    await verifyNotificationAuthority(harness);
  }, 30_000);

  it('restores the dedicated worker pool after success, application error and typed SQL timeout without using ordinary pools', async () => {
    await verifyNotificationWorkerPool(harness, boundary, scope());
  }, 15_000);

  it('leaves future catalogs pending for the old worker and lets an explicitly compatible raw worker claim them', async () => {
    const current = await inSourceTransaction(harness, OUTBOX_ORG_A, (tx) =>
      appendNotificationEvent(tx, { organizationId: OUTBOX_ORG_A }, joinRequestedInput(700)),
    );
    const futureId = await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
      insertRawEvent(tx, {
        organizationId: OUTBOX_ORG_A,
        dedupeKey: 'catalog-future',
        catalogRevision: FUTURE_CATALOG_REVISION,
      }),
    );
    const oldWorker = await claimNotificationEventsForOrg(scope());
    expect(oldWorker.events.map((event) => event.id)).toEqual([current.event.id]);
    expect(oldWorker.unsupportedCatalogPending).toBe(true);
    expect(await settleNotificationEvent(scope(), oldWorker.events[0].lease, 'projected')).toBe(
      true,
    );

    const futureScope = scope(OUTBOX_OWNER_B);
    const futureWorker = await rawClaim(futureScope, [FUTURE_CATALOG_REVISION]);
    expect(futureWorker.events.map((event) => event.id)).toEqual([futureId]);
    expect(futureWorker.unsupportedCatalogPending).toBe(false);
    expect(
      await settleNotificationEvent(futureScope, futureWorker.events[0].lease, 'projected'),
    ).toBe(true);
  });

  it('quarantines malformed supported rows with finite reasons and never returns them as empty successes', async () => {
    await verifyFiniteMalformedRows(harness);
    const claimed = await claimNotificationEventsForOrg(scope());
    expect(claimed.events).toEqual([]);
    expect(claimed.quarantined).toBe(3);
    expect(
      await harness.owner`select state,quarantine_reason from public.notification_outbox
        order by quarantine_reason`,
    ).toEqual([
      { state: 'quarantined', quarantine_reason: 'digest_mismatch' },
      { state: 'quarantined', quarantine_reason: 'envelope_invalid' },
      { state: 'quarantined', quarantine_reason: 'payload_invalid' },
    ]);
    expect((await claimNotificationEventsForOrg(scope())).events).toEqual([]);
  });

  it('quarantines 250 malformed rows in one bounded batch and atomically rejects invalid, foreign, stale or application tuples', async () => {
    await verifyBoundedQuarantineBatch(harness);
  }, 30_000);

  it('rejects every over-limit SQL envelope field and multibyte boundary without leaving event or outbox rows', async () => {
    await verifyEnvelopeSqlLimits(harness);
  });

  it('uses bounded partial-index claim and complement plans over 100000 mixed rows and fails the same gates without each index', async () => {
    await verifyNotificationQueryPlans(harness);
  }, 120_000);
});
