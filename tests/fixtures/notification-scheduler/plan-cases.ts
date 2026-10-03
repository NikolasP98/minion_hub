import { expect } from "vitest";
import { readNotificationWorkerHealth } from "$server/services/notifications/worker-health";
import { discoverNotificationOrganizations } from "$server/services/notifications/scheduler/discovery";
import type { RuntimeLease } from "$server/services/notifications/scheduler/contracts";
import type { PgClient } from "../notification-outbox/postgres-harness";
import {
  CURRENT_CATALOG_REVISION,
  FUTURE_CATALOG_REVISION,
  asApplicationRole,
  assertBoundedIndexPlan,
  bulkInsertRawEvents,
  fixtureUuid,
  insertRawEvent,
  withOutboxFixtureMaintenance,
} from "../notification-outbox/runtime-harness";
import {
  explainCapturedQuery,
  summarizeCapturedPlan,
  type CapturedTaggedQuery,
} from "../notification-outbox/query-capture";
import { OUTBOX_ORG_A } from "../notification-outbox/postgres-harness";
import { captureSchedulerPool, findCapturedQuery } from "./query-capture";
import type { NotificationSchedulerHarness } from "./postgres-harness";
import { acquireSchedulerRuntime } from "./runtime-cases";

type PoolSetter = (client: PgClient) => void;

async function seedPlanPopulation(harness: NotificationSchedulerHarness) {
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 100_000,
    dedupePrefix: "scheduler-plan-pending",
  });
  await bulkInsertRawEvents(harness, {
    organizationId: OUTBOX_ORG_A,
    count: 1_000,
    dedupePrefix: "scheduler-plan-processing",
  });
  await withOutboxFixtureMaintenance(harness, async (tx) => {
    await tx`with stamp as materialized(select clock_timestamp() as value), targets as materialized(
        select o.event_id,row_number() over(order by o.event_id) as ordinal
        from public.notification_outbox o join public.notification_events e on e.id=o.event_id
        where e.dedupe_key like 'scheduler-plan-processing-%'
      )
      update public.notification_outbox o set state='processing',lease_owner=${fixtureUuid(990, 9)}::uuid,
        generation=1,claim_count=1,claimed_at=stamp.value-interval '40 seconds',
        hard_deadline=stamp.value+interval '20 seconds',renewal_count=0,
        lease_expires_at=case when targets.ordinal%2=0 then stamp.value-interval '5 seconds'
          else stamp.value+interval '15 seconds' end
      from stamp,targets where o.event_id=targets.event_id`;
  });
  for (let index = 0; index < 20; index++) {
    const organizationId = fixtureUuid(2_000 + index, 8);
    await harness.owner`insert into public.organizations(id) values(${organizationId}::uuid)`;
    await asApplicationRole(harness.source, organizationId, (tx) =>
      insertRawEvent(tx, {
        organizationId,
        dedupeKey: `scheduler-sparse-${index}`,
        sourceIdentity: `scheduler-sparse-source-${index}`,
        subjectRevision: `scheduler-sparse-revision-${index}`,
      }),
    );
  }
  await harness.owner.unsafe(
    "ANALYZE public.notification_outbox; ANALYZE public.notification_events;",
  );
}

async function explainAsHealth(
  harness: NotificationSchedulerHarness,
  capture: CapturedTaggedQuery,
) {
  return harness.worker.begin("isolation level repeatable read read only", async (tx) => {
    await tx`select set_config('role','notification_health_reader',true),
      set_config('app.current_org_id',${OUTBOX_ORG_A},true),
      set_config('statement_timeout','30s',true)`;
    return explainCapturedQuery(tx, capture);
  });
}

async function explainAsCoordinator(
  harness: NotificationSchedulerHarness,
  runtime: RuntimeLease,
  capture: CapturedTaggedQuery,
) {
  return harness.worker.begin(async (tx) => {
    await tx`select set_config('role','notification_coordinator',true),
      set_config('app.current_org_id','',true),
      set_config('app.notification_runtime_owner',${runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${runtime.generation},true),
      set_config('statement_timeout','30s',true)`;
    return explainCapturedQuery(tx, capture);
  });
}

async function proveRemovedIndexFails(
  harness: NotificationSchedulerHarness,
  options: {
    indexName: string;
    createSql: string;
    expectedIndex: string;
    explain: () => Promise<unknown>;
  },
) {
  await harness.owner.unsafe(`DROP INDEX public.${options.indexName}`);
  try {
    const withoutIndex = await options.explain();
    expect(() => assertBoundedIndexPlan(withoutIndex, options.expectedIndex, 5_100)).toThrow();
  } finally {
    await harness.owner.unsafe(options.createSql);
    await harness.owner`analyze public.notification_outbox`;
  }
}

export async function verifyProductionPlans(
  harness: NotificationSchedulerHarness,
  setPool: PoolSetter,
) {
  await seedPlanPopulation(harness);

  const falseHealthCaptures: CapturedTaggedQuery[] = [];
  setPool(captureSchedulerPool(harness.worker, falseHealthCaptures));
  const bounded = await readNotificationWorkerHealth(OUTBOX_ORG_A);
  expect(bounded.queue.pending).toMatchObject({ count: 5000, lowerBound: true });
  expect(bounded.queue.processing).toMatchObject({ count: 1000, lowerBound: false });
  expect(bounded.queue.unsupportedCatalogPending).toBe(false);

  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, {
      organizationId: OUTBOX_ORG_A,
      dedupeKey: "scheduler-plan-future",
      catalogRevision: FUTURE_CATALOG_REVISION,
      sourceIdentity: "scheduler-plan-future-source",
      subjectRevision: "scheduler-plan-future-revision",
    }),
  );
  const trueHealthCaptures: CapturedTaggedQuery[] = [];
  setPool(captureSchedulerPool(harness.worker, trueHealthCaptures));
  expect((await readNotificationWorkerHealth(OUTBOX_ORG_A)).queue.unsupportedCatalogPending).toBe(
    true,
  );

  const pendingCount = findCapturedQuery(
    falseHealthCaptures,
    "state='pending'",
    "order by enqueued_at,event_id limit 5001",
  );
  const pendingOldest = findCapturedQuery(
    falseHealthCaptures,
    "select enqueued_at::text",
    "state='pending'",
  );
  const processingCount = findCapturedQuery(
    falseHealthCaptures,
    "state='processing'",
    "order by enqueued_at,event_id limit 5001",
  );
  const catalogAfter = findCapturedQuery(
    trueHealthCaptures,
    "select exists",
    "state='pending'",
    "catalog_revision>",
  );
  const healthPlans = await Promise.all(
    [pendingCount, pendingOldest, processingCount, catalogAfter].map(async (capture) => ({
      capture,
      explain: await explainAsHealth(harness, capture),
    })),
  );
  const runtime = await acquireSchedulerRuntime();
  await harness.owner.unsafe(
    "ALTER TABLE public.notification_scheduler_cursor DISABLE TRIGGER notification_cursor_transition",
  );
  try {
    await harness.owner`update public.notification_scheduler_cursor set next_state='processing',
      pending_after_org=${OUTBOX_ORG_A}::uuid,processing_after_org=null where singleton`;
  } finally {
    await harness.owner.unsafe(
      "ALTER TABLE public.notification_scheduler_cursor ENABLE TRIGGER notification_cursor_transition",
    );
  }
  const discoveryCaptures: CapturedTaggedQuery[] = [];
  setPool(captureSchedulerPool(harness.worker, discoveryCaptures));
  const discovered = await discoverNotificationOrganizations(runtime, [CURRENT_CATALOG_REVISION]);
  expect(discovered.leases.length).toBeGreaterThan(0);
  expect(discovered.leases.length).toBeLessThanOrEqual(4);
  const pendingSeek = findCapturedQuery(
    discoveryCaptures,
    "select organization_id",
    "state='pending'",
    "order by organization_id limit 1",
  );
  const processingSeek = findCapturedQuery(
    discoveryCaptures,
    "select organization_id",
    "state='processing'",
    "order by organization_id limit 1",
  );
  const pendingEligibility = findCapturedQuery(
    discoveryCaptures,
    "select exists",
    "state='pending'",
    "catalog_revision=",
  );
  const expiredEligibility = findCapturedQuery(
    discoveryCaptures,
    "select exists",
    "state='processing'",
    "lease_expires_at<=",
  );
  const discoveryPlans = await Promise.all(
    [pendingSeek, processingSeek, pendingEligibility, expiredEligibility].map(async (capture) => ({
      capture,
      explain: await explainAsCoordinator(harness, runtime, capture),
    })),
  );
  console.info(
    "NOTIFICATION_SCHEDULER_PLAN_DIAGNOSTIC",
    JSON.stringify(
      [...healthPlans, ...discoveryPlans].map(({ capture, explain }) =>
        summarizeCapturedPlan(explain, capture),
      ),
    ),
  );
  assertBoundedIndexPlan(healthPlans[0].explain, "notification_pending_health_idx", 5_100);
  assertBoundedIndexPlan(healthPlans[1].explain, "notification_pending_health_idx", 2);
  assertBoundedIndexPlan(healthPlans[2].explain, "notification_processing_health_idx", 1_100);
  assertBoundedIndexPlan(healthPlans[3].explain, "notification_pending_claim_idx", 2);
  assertBoundedIndexPlan(discoveryPlans[0].explain, "notification_pending_health_idx", 2);
  assertBoundedIndexPlan(discoveryPlans[1].explain, "notification_processing_health_idx", 2);
  assertBoundedIndexPlan(discoveryPlans[2].explain, "notification_pending_health_idx", 2);
  assertBoundedIndexPlan(discoveryPlans[3].explain, "notification_expired_claim_idx", 2);

  await proveRemovedIndexFails(harness, {
    indexName: "notification_pending_health_idx",
    expectedIndex: "notification_pending_health_idx",
    createSql:
      "CREATE INDEX notification_pending_health_idx ON public.notification_outbox(organization_id,enqueued_at,event_id) WHERE state='pending'",
    explain: () => explainAsHealth(harness, pendingOldest),
  });
  await proveRemovedIndexFails(harness, {
    indexName: "notification_processing_health_idx",
    expectedIndex: "notification_processing_health_idx",
    createSql:
      "CREATE INDEX notification_processing_health_idx ON public.notification_outbox(organization_id,enqueued_at,event_id) WHERE state='processing'",
    explain: () => explainAsHealth(harness, processingCount),
  });
  await proveRemovedIndexFails(harness, {
    indexName: "notification_pending_claim_idx",
    expectedIndex: "notification_pending_claim_idx",
    createSql:
      "CREATE INDEX notification_pending_claim_idx ON public.notification_outbox(organization_id,catalog_revision collate \"C\",event_id) WHERE state='pending'",
    explain: () => explainAsHealth(harness, catalogAfter),
  });
  await proveRemovedIndexFails(harness, {
    indexName: "notification_expired_claim_idx",
    expectedIndex: "notification_expired_claim_idx",
    createSql:
      "CREATE INDEX notification_expired_claim_idx ON public.notification_outbox(organization_id,catalog_revision collate \"C\",lease_expires_at,event_id) WHERE state='processing'",
    explain: () => explainAsCoordinator(harness, runtime, expiredEligibility),
  });

  const receipts = [...healthPlans, ...discoveryPlans].map(({ capture, explain }) =>
    summarizeCapturedPlan(explain, capture),
  );
  console.info(
    "NOTIFICATION_SCHEDULER_PLAN_RECEIPT",
    JSON.stringify({
      rows: { pending: 100_001, processing: 1_000, sparseOrganizations: 20 },
      plans: receipts,
      discovery: {
        candidateStatements: discoveryCaptures.filter(
          (capture) => !capture.normalized.includes("set_config('statement_timeout'"),
        ).length,
        candidates: discovered.candidates,
        claims: discovered.leases.length,
      },
      catalogProbe: { false: false, true: true },
      removedIndexNegatives: [
        "notification_pending_health_idx",
        "notification_processing_health_idx",
        "notification_pending_claim_idx",
        "notification_expired_claim_idx",
      ],
    }),
  );
  setPool(harness.worker);
}
