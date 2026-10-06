import { expect } from 'vitest';
import { discoverNotificationOrganizations } from '$server/services/notifications/scheduler/discovery';
import {
  acquireRuntimeLease,
  publishAdmissionObservation,
} from '$server/services/notifications/scheduler/runtime-lease';
import { OUTBOX_ORG_A } from '../notification-outbox/postgres-harness';
import {
  CURRENT_CATALOG_REVISION,
  asApplicationRole,
  insertRawEvent,
} from '../notification-outbox/runtime-harness';
import {
  resetNotificationSchedulerHarness,
  type NotificationSchedulerHarness,
  withSchedulerFixtureMaintenance,
} from './postgres-harness';
import {
  SCHEDULER_OWNER_A,
  SCHEDULER_SUPPORT,
  acquireSchedulerRuntime,
  schedulerIdentity,
} from './runtime-cases';

const BIGINT_MAX = '9223372036854775807';

async function schedulerFailure(operation: PromiseLike<unknown>) {
  return operation.then(
    () => null,
    (error: unknown) => error,
  );
}

export async function verifyMissingAndUnknownSingletons(harness: NotificationSchedulerHarness) {
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`delete from public.notification_worker_runtime where singleton`;
  });
  expect(await schedulerFailure(acquireRuntimeLease(schedulerIdentity()))).toMatchObject({
    code: 'notification_scheduler_unavailable',
    reason: 'state_missing',
  });
  expect(await harness.owner`select singleton from public.notification_worker_runtime`).toEqual([]);
  await resetNotificationSchedulerHarness(harness);

  await harness.owner.unsafe(
    'ALTER TABLE public.notification_worker_runtime DROP CONSTRAINT notification_worker_runtime_schema_version_check',
  );
  try {
    await withSchedulerFixtureMaintenance(harness, async (owner) => {
      await owner`update public.notification_worker_runtime set schema_version=2 where singleton`;
    });
    expect(await schedulerFailure(acquireRuntimeLease(schedulerIdentity()))).toMatchObject({
      code: 'notification_scheduler_unavailable',
      reason: 'state_missing',
    });
    expect(
      await harness.owner`select schema_version,generation::text from public.notification_worker_runtime`,
    ).toEqual([{ schema_version: 2, generation: '0' }]);
  } finally {
    await withSchedulerFixtureMaintenance(harness, async (owner) => {
      await owner`update public.notification_worker_runtime set schema_version=1 where singleton`;
    });
    await harness.owner.unsafe(
      'ALTER TABLE public.notification_worker_runtime ADD CONSTRAINT notification_worker_runtime_schema_version_check CHECK(schema_version=1)',
    );
  }

  const runtime = await acquireSchedulerRuntime();
  await harness.owner.unsafe(
    'ALTER TABLE public.notification_scheduler_cursor DROP CONSTRAINT notification_scheduler_cursor_schema_version_check',
  );
  try {
    await withSchedulerFixtureMaintenance(harness, async (owner) => {
      await owner`update public.notification_scheduler_cursor set schema_version=2 where singleton`;
    });
    expect(
      await schedulerFailure(discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT)),
    ).toMatchObject({ code: 'notification_scheduler_unavailable', reason: 'state_missing' });
    expect(
      await harness.owner`select schema_version,tick_generation::text from public.notification_scheduler_cursor`,
    ).toEqual([{ schema_version: 2, tick_generation: '0' }]);
  } finally {
    await withSchedulerFixtureMaintenance(harness, async (owner) => {
      await owner`update public.notification_scheduler_cursor set schema_version=1 where singleton`;
    });
    await harness.owner.unsafe(
      'ALTER TABLE public.notification_scheduler_cursor ADD CONSTRAINT notification_scheduler_cursor_schema_version_check CHECK(schema_version=1)',
    );
  }
}

export async function verifyGenerationOverflowFailsClosed(harness: NotificationSchedulerHarness) {
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_worker_runtime set generation=${BIGINT_MAX}::bigint
      where singleton`;
  });
  expect(await schedulerFailure(acquireRuntimeLease(schedulerIdentity()))).toMatchObject({
    code: 'notification_scheduler_unavailable',
    reason: 'generation_exhausted',
  });
  expect(
    await harness.owner`select generation::text,owner_id from public.notification_worker_runtime`,
  ).toEqual([{ generation: BIGINT_MAX, owner_id: null }]);

  await resetNotificationSchedulerHarness(harness);
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_worker_runtime set admission_generation=${BIGINT_MAX}::bigint,
      admission_owner_id=${SCHEDULER_OWNER_A}::uuid,
      admission_checked_at=clock_timestamp()-interval '31 seconds',
      admission_code='projection_unavailable',admission_build_sha=${'a'.repeat(40)},
      admission_catalog_sha256=${'b'.repeat(64)} where singleton`;
  });
  expect(
    await schedulerFailure(
      publishAdmissionObservation({
        ownerId: SCHEDULER_OWNER_A,
        code: 'catalog_mismatch',
        buildSha: 'a'.repeat(40),
        artifactSha256: 'd'.repeat(64),
        catalogRevision: CURRENT_CATALOG_REVISION,
        catalogSha256: 'b'.repeat(64),
        projectorRevision: null,
        projectorSha256: null,
      }),
    ),
  ).toMatchObject({
    code: 'notification_scheduler_unavailable',
    reason: 'generation_exhausted',
  });
  expect(
    await harness.owner`select admission_generation::text,admission_code
      from public.notification_worker_runtime`,
  ).toEqual([{ admission_generation: BIGINT_MAX, admission_code: 'projection_unavailable' }]);

  await resetNotificationSchedulerHarness(harness);
  await asApplicationRole(harness.source, OUTBOX_ORG_A, (tx) =>
    insertRawEvent(tx, { organizationId: OUTBOX_ORG_A, dedupeKey: 'scheduler-org-overflow' }),
  );
  const runtime = await acquireSchedulerRuntime();
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`insert into public.notification_org_control(organization_id,generation)
      values(${OUTBOX_ORG_A}::uuid,${BIGINT_MAX}::bigint)`;
  });
  expect(
    await schedulerFailure(discoverNotificationOrganizations(runtime, SCHEDULER_SUPPORT)),
  ).toMatchObject({
    code: 'notification_scheduler_unavailable',
    reason: 'generation_exhausted',
  });
  expect(
    await harness.owner`select generation::text,state from public.notification_org_control
      where organization_id=${OUTBOX_ORG_A}::uuid`,
  ).toEqual([{ generation: BIGINT_MAX, state: 'idle' }]);

  await resetNotificationSchedulerHarness(harness);
  const cursorRuntime = await acquireSchedulerRuntime();
  await withSchedulerFixtureMaintenance(harness, async (owner) => {
    await owner`update public.notification_scheduler_cursor
      set tick_generation=${BIGINT_MAX}::bigint where singleton`;
  });
  expect(
    await schedulerFailure(discoverNotificationOrganizations(cursorRuntime, SCHEDULER_SUPPORT)),
  ).toMatchObject({
    code: 'notification_scheduler_unavailable',
    reason: 'generation_exhausted',
  });
  expect(
    await harness.owner`select tick_generation::text from public.notification_scheduler_cursor`,
  ).toEqual([{ tick_generation: BIGINT_MAX }]);
}
