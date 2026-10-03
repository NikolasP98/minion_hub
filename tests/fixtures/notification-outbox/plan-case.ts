import { expect } from 'vitest';
import {
  claimNotificationEventsInTransaction,
  unsupportedCatalogPending,
} from '$server/services/notifications/outbox-claim';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
} from '$server/services/notifications/worker-transaction';
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  assertBoundedIndexPlan,
  bulkInsertRawEvents,
  insertRawEvent,
  withOutboxFixtureMaintenance,
} from './runtime-harness';
import {
  OUTBOX_ORG_A,
  OUTBOX_ORG_B,
  OUTBOX_OWNER_A,
  OUTBOX_OWNER_B,
  resetNotificationOutbox,
  type NotificationOutboxHarness,
} from './postgres-harness';
import {
  captureTransactionSql,
  explainCapturedQuery,
  notificationQueryClass,
  summarizeCapturedPlan,
  type CapturedTaggedQuery,
} from './query-capture';

const SUPPORTED_REVISIONS = [
  CURRENT_CATALOG_REVISION,
  '2026-10-03.2',
  '2026-10-03.3',
  '2026-10-03.4',
  '2026-10-03.5',
  '2026-10-03.6',
  '2026-10-03.7',
  '2026-10-03.8',
] as const;
const PLAN_QUERY_CLASSES = new Set([
  'pending_candidate',
  'expired_candidate',
  'catalog_before',
  'catalog_between',
  'catalog_after',
]);

function scope(ownerId = OUTBOX_OWNER_A, organizationId = OUTBOX_ORG_A) {
  return Object.freeze({ ownerId, organizationId });
}

async function captureClaimPlans(workerScope: NotificationWorkerScope) {
  return withNotificationWorkerTransaction(workerScope, async (tx) => {
    const captures: CapturedTaggedQuery[] = [];
    const captured = captureTransactionSql(tx, captures);
    const batch = await claimNotificationEventsInTransaction(
      captured,
      workerScope,
      SUPPORTED_REVISIONS,
    );
    const planQueries = captures.filter((query) =>
      PLAN_QUERY_CLASSES.has(notificationQueryClass(query)),
    );
    const plans = [];
    for (const query of planQueries) {
      const explain = await explainCapturedQuery(tx, query);
      const queryClass = notificationQueryClass(query);
      assertBoundedIndexPlan(
        explain,
        queryClass === 'expired_candidate'
          ? 'notification_expired_claim_idx'
          : 'notification_pending_claim_idx',
      );
      plans.push(summarizeCapturedPlan(explain, query));
    }
    return Object.freeze({ batch, captures: Object.freeze([...captures]), plans });
  });
}

async function captureUnsupportedPlans(workerScope: NotificationWorkerScope) {
  return withNotificationWorkerTransaction(workerScope, async (tx) => {
    const captures: CapturedTaggedQuery[] = [];
    const captured = captureTransactionSql(tx, captures);
    const unsupported = await unsupportedCatalogPending(
      captured,
      workerScope.organizationId,
      SUPPORTED_REVISIONS,
    );
    const planQueries = captures.filter((query) =>
      notificationQueryClass(query).startsWith('catalog_'),
    );
    const plans = [];
    for (const query of planQueries) {
      const explain = await explainCapturedQuery(tx, query);
      assertBoundedIndexPlan(explain, 'notification_pending_claim_idx');
      plans.push(summarizeCapturedPlan(explain, query));
    }
    return Object.freeze({ unsupported, captures: Object.freeze([...captures]), plans });
  });
}

export async function verifyNotificationQueryPlans(harness: NotificationOutboxHarness) {
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 50_000,
    dedupePrefix: 'plan-a',
    catalogRevisions: SUPPORTED_REVISIONS,
  });
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_B,
    count: 50_000,
    dedupePrefix: 'plan-b',
    catalogRevisions: SUPPORTED_REVISIONS,
  });
  await withOutboxFixtureMaintenance(harness, async (tx) => {
    await tx.unsafe(`with stamp as materialized (select clock_timestamp() as value)
      update public.notification_outbox set state='processing',
      lease_owner='${OUTBOX_OWNER_A}',generation=1,claim_count=1,
      claimed_at=stamp.value-interval '40 seconds',
      hard_deadline=stamp.value+interval '20 seconds',
      lease_expires_at=case when mod(hashtextextended(event_id::text,0),4)=0
        then stamp.value-interval '10 seconds' else stamp.value+interval '10 seconds' end,
      renewal_count=0
      from stamp where mod(hashtextextended(event_id::text,0),2)=0`);
  });
  expect(
    await harness.owner`select count(*)::int as count,
      count(distinct organization_id)::int as organizations,
      count(distinct state)::int as states,
      count(distinct catalog_revision)::int as catalogs,
      count(*) filter(where state='processing' and lease_expires_at<=statement_timestamp())::int as expired,
      count(*) filter(where state='processing' and lease_expires_at>statement_timestamp())::int as live
      from public.notification_outbox`,
  ).toEqual([
    expect.objectContaining({ count: 100_000, organizations: 2, states: 2, catalogs: 8 }),
  ]);
  const [leasePopulation] = await harness.owner<
    { expired: number; live: number }[]
  >`select count(*) filter(where state='processing' and lease_expires_at<=statement_timestamp())::int as expired,
    count(*) filter(where state='processing' and lease_expires_at>statement_timestamp())::int as live
    from public.notification_outbox`;
  expect(leasePopulation.expired).toBeGreaterThan(0);
  expect(leasePopulation.live).toBeGreaterThan(0);

  const falseEvidence = await captureClaimPlans(scope());
  const candidateQueries = falseEvidence.captures.filter((query) =>
    ['pending_candidate', 'expired_candidate'].includes(notificationQueryClass(query)),
  );
  const falseCatalogQueries = falseEvidence.captures.filter((query) =>
    notificationQueryClass(query).startsWith('catalog_'),
  );
  expect(falseEvidence.batch.events).toHaveLength(250);
  expect(falseEvidence.batch.unsupportedCatalogPending).toBe(false);
  expect(candidateQueries).toHaveLength(falseEvidence.batch.candidateStatements);
  expect(candidateQueries.length).toBeLessThanOrEqual(32);
  expect(falseCatalogQueries).toHaveLength(9);
  expect(falseEvidence.plans).toHaveLength(candidateQueries.length + falseCatalogQueries.length);

  const pendingQuery = candidateQueries.find(
    (query) => notificationQueryClass(query) === 'pending_candidate',
  );
  const expiredQuery = candidateQueries.find(
    (query) => notificationQueryClass(query) === 'expired_candidate',
  );
  const complementQuery = falseCatalogQueries[0];
  expect(pendingQuery).toBeDefined();
  expect(expiredQuery).toBeDefined();
  expect(complementQuery).toBeDefined();

  const negativeControls: string[] = [];
  async function requirePlanGateFailure(
    query: CapturedTaggedQuery,
    expectedIndex: string,
    name: string,
  ) {
    const failure = await withNotificationWorkerTransaction(scope(OUTBOX_OWNER_B), async (tx) => {
      const explain = await explainCapturedQuery(tx, query);
      assertBoundedIndexPlan(explain, expectedIndex);
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure, name).toBeInstanceOf(Error);
    negativeControls.push(name);
  }

  await harness.owner`drop index public.notification_pending_claim_idx`;
  try {
    await requirePlanGateFailure(
      pendingQuery!,
      'notification_pending_claim_idx',
      'pending_candidate_without_partial_index',
    );
    await requirePlanGateFailure(
      complementQuery!,
      'notification_pending_claim_idx',
      'catalog_complement_without_partial_index',
    );
  } finally {
    await harness.owner.unsafe(`create index notification_pending_claim_idx
      on public.notification_outbox(organization_id,catalog_revision collate "C",event_id)
      where state='pending'`);
  }
  await harness.owner`drop index public.notification_expired_claim_idx`;
  try {
    await requirePlanGateFailure(
      expiredQuery!,
      'notification_expired_claim_idx',
      'expired_candidate_without_partial_index',
    );
  } finally {
    await harness.owner.unsafe(`create index notification_expired_claim_idx
      on public.notification_outbox(organization_id,catalog_revision collate "C",lease_expires_at,event_id)
      where state='processing'`);
  }

  await resetNotificationOutbox(harness);
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 100_000,
    dedupePrefix: 'complement-supported',
    catalogRevisions: SUPPORTED_REVISIONS,
  });
  expect(
    await harness.owner`select count(*)::int as count,
      count(distinct organization_id)::int as organizations,
      count(distinct state)::int as states,
      count(distinct catalog_revision)::int as catalogs
      from public.notification_outbox`,
  ).toEqual([{ count: 100_000, organizations: 1, states: 1, catalogs: 8 }]);
  const restoredEvidence = await captureUnsupportedPlans(scope(OUTBOX_OWNER_B));
  expect(restoredEvidence.unsupported).toBe(false);
  expect(restoredEvidence.captures).toHaveLength(9);

  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: 'plan-unsupported',
      catalogRevision: 'zz-future',
    }),
  );
  const trueEvidence = await captureUnsupportedPlans(scope(OUTBOX_OWNER_B));
  expect(trueEvidence.unsupported).toBe(true);
  expect(trueEvidence.captures.length).toBeLessThanOrEqual(9);

  console.info(
    `NOTIFICATION_OUTBOX_PLAN_RECEIPT ${JSON.stringify({
      rows: 100_000,
      mixedLeasePopulation: leasePopulation,
      candidateQueries: candidateQueries.length,
      claimCatalogProbes: falseCatalogQueries.length,
      falseCatalogProbes: restoredEvidence.captures.length,
      trueCatalogProbes: trueEvidence.captures.length,
      plans: [
        ...falseEvidence.plans.filter((plan) =>
          ['pending_candidate', 'expired_candidate'].includes(plan.queryClass),
        ),
        ...restoredEvidence.plans,
        ...trueEvidence.plans,
      ],
      negativeControls,
      restoredIndexes: ['notification_pending_claim_idx', 'notification_expired_claim_idx'],
    })}`,
  );
}
