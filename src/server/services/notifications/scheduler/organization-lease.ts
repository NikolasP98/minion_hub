import { retryCoordinatorContention } from './contention';
import {
  ORG_FAILURES,
  assertOrganizationLease,
  type OrganizationLease,
  type OrganizationResult,
  type RuntimeLease,
} from './contracts';
import { withCoordinator } from './transaction';
import type { NotificationWorkerTx } from '../worker-transaction';

/** Serialize operational transitions with worker replacement; no domain payload is read. */
export async function lockRuntimeFence(
  tx: NotificationWorkerTx,
  runtime: RuntimeLease,
  skipLocked = false,
): Promise<boolean> {
  const rows = await tx`
    select generation from public.notification_worker_runtime
    where singleton and schema_version=1 and owner_id=${runtime.ownerId}::uuid and generation=${runtime.generation}::bigint
      and lease_expires_at>clock_timestamp() and build_sha=${runtime.buildSha} and catalog_revision=${runtime.catalogRevision}
      and catalog_sha256=${runtime.catalogSha256} and projector_revision=${runtime.projectorRevision} and projector_sha256=${runtime.projectorSha256}
    ${skipLocked ? tx`for update skip locked` : tx`for update`}`;
  return rows.length === 1;
}

export async function renewOrganizationLease(
  runtime: RuntimeLease,
  lease: OrganizationLease,
): Promise<OrganizationLease | null> {
  assertOrganizationLease(lease, runtime);
  return retryCoordinatorContention(() =>
    withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
      if (!(await lockRuntimeFence(tx, runtime))) return null;
      await tx`select set_config('app.notification_org_generation',${lease.generation},true)`;
      const [row] = await tx<{ expires_at: string }[]>`
      update public.notification_org_control set renewal_count=1,lease_expires_at=hard_deadline
      where organization_id=${lease.organizationId}::uuid and state='running' and owner_id=${runtime.ownerId}::uuid
        and generation=${lease.generation}::bigint and renewal_count=0 and lease_expires_at>clock_timestamp()
      returning lease_expires_at::text as expires_at`;
      return row ? Object.freeze({ ...lease, expiresAt: row.expires_at }) : null;
    }),
  );
}

export async function completeOrganizationLease(
  runtime: RuntimeLease,
  lease: OrganizationLease,
  result: OrganizationResult,
): Promise<boolean> {
  assertOrganizationLease(lease, runtime);
  if (
    !['completed', 'empty', 'unsupported', 'failed'].includes(result.result) ||
    (result.result === 'failed' && !ORG_FAILURES.includes(result.reason))
  )
    throw new Error('Invalid notification organization result');
  const failure = result.result === 'failed' ? result.reason : null;
  return retryCoordinatorContention(() =>
    withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
      if (!(await lockRuntimeFence(tx, runtime))) return false;
      await tx`select set_config('app.notification_org_generation',${lease.generation},true)`;
      const rows = await tx`
      with stamp as materialized(select clock_timestamp() as value)
      update public.notification_org_control set state='idle',owner_id=null,claimed_at=null,
        lease_expires_at=null,hard_deadline=null,renewal_count=null,last_result=${result.result},last_completed_at=stamp.value,
        failure_streak=case when ${result.result}='failed' then least(failure_streak+1,4)
          when ${result.result}='completed' then 0 else failure_streak end,
        last_failure_code=case when ${result.result}='failed' then ${failure}
          when ${result.result}='completed' then null else last_failure_code end,
        last_success_at=case when ${result.result}='completed' then stamp.value else last_success_at end,
        next_due_at=case when ${result.result}='failed' then stamp.value+make_interval(secs=>(array[5,30,120,300])[least(failure_streak+1,4)])
          when ${result.result}='completed' then stamp.value else stamp.value+interval '5 seconds' end
      from stamp where organization_id=${lease.organizationId}::uuid and state='running' and owner_id=${runtime.ownerId}::uuid
        and generation=${lease.generation}::bigint and lease_expires_at>clock_timestamp()
      returning organization_id`;
      return rows.length === 1;
    }),
  );
}

/** Release a discovered claim that never entered the projector after shutdown.
 * This changes neither completion history nor the immutable event/outbox rows. */
export async function abandonUnstartedOrganizationLease(
  runtime: RuntimeLease,
  lease: OrganizationLease,
): Promise<boolean> {
  assertOrganizationLease(lease, runtime);
  return retryCoordinatorContention(() =>
    withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
      if (!(await lockRuntimeFence(tx, runtime))) return false;
      await tx`select set_config('app.notification_org_generation',${lease.generation},true),set_config('app.notification_abandon_unstarted','1',true)`;
      const rows =
        await tx`update public.notification_org_control set state='idle',owner_id=null,claimed_at=null,
      lease_expires_at=null,hard_deadline=null,renewal_count=null,next_due_at=clock_timestamp()
      where organization_id=${lease.organizationId}::uuid and state='running' and owner_id=${runtime.ownerId}::uuid
        and generation=${lease.generation}::bigint and lease_expires_at>clock_timestamp() returning organization_id`;
      return rows.length === 1;
    }),
  );
}

/** Read-only cleanup reconciliation survives loss of the global runtime lease.
 * False means this exact organization receipt is definitively no longer live. */
export async function isOrganizationLeaseLive(
  runtime: RuntimeLease,
  lease: OrganizationLease,
): Promise<boolean> {
  assertOrganizationLease(lease, runtime);
  return withCoordinator(runtime.ownerId, runtime.generation, async (tx) => {
    const [row] = await tx<
      { live: boolean }[]
    >`select exists(select 1 from public.notification_org_control
      where organization_id=${lease.organizationId}::uuid and state='running' and owner_id=${runtime.ownerId}::uuid
        and generation=${lease.generation}::bigint and lease_expires_at>clock_timestamp()) as live`;
    return row.live;
  });
}
