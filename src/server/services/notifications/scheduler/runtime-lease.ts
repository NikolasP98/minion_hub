import { retryCoordinatorContention } from './contention';
import { UUID_PATTERN } from '$lib/notifications/fields';
import { withCoordinator } from './transaction';
import {
  ADMISSION_FAILURES,
  assertRuntimeIdentity,
  assertGenerationCanAdvance,
  NotificationSchedulerUnavailable,
  assertRuntimeLease,
  type AdmissionObservation,
  type RuntimeIdentity,
  type RuntimeLease,
} from './contracts';

type LeaseRow = { generation: string; expires_at: string };
export type RuntimeAdmission =
  | Readonly<{ state: 'acquired'; lease: RuntimeLease }>
  | Readonly<{ state: 'standby'; retryAfterMs: number }>;

export async function acquireRuntimeLease(identity: RuntimeIdentity): Promise<RuntimeAdmission> {
  assertRuntimeIdentity(identity);
  return withCoordinator(identity.ownerId, null, async (tx) => {
    const [row] = await tx<{ generation: string; remaining_ms: number }[]>`
      select generation::text,greatest(0,coalesce(extract(epoch from(lease_expires_at-clock_timestamp()))*1000,0))::float8 as remaining_ms
      from public.notification_worker_runtime where singleton and schema_version=1 for update skip locked`;
    if (!row) {
      const [present] = await tx<{ present: boolean }[]>`
        select exists(select 1 from public.notification_worker_runtime where singleton and schema_version=1) as present`;
      if (!present?.present) throw new NotificationSchedulerUnavailable('state_missing');
      return Object.freeze({ state: 'standby', retryAfterMs: 1000 });
    }
    if (row.remaining_ms > 0)
      return Object.freeze({
        state: 'standby',
        retryAfterMs: Math.min(5000, Math.max(1000, row.remaining_ms)),
      });
    assertGenerationCanAdvance(row.generation);
    const [claimed] = await tx<LeaseRow[]>`
      with stamp as materialized(select clock_timestamp() as value)
      update public.notification_worker_runtime set generation=generation+1,owner_id=${identity.ownerId}::uuid,
        started_at=stamp.value,last_heartbeat_at=stamp.value,lease_expires_at=stamp.value+interval '30 seconds',stopped_at=null,
        build_sha=${identity.buildSha},catalog_revision=${identity.catalogRevision},catalog_sha256=${identity.catalogSha256},
        projector_revision=${identity.projectorRevision},projector_sha256=${identity.projectorSha256}
      from stamp where singleton and schema_version=1 and generation=${row.generation}::bigint
        and (lease_expires_at is null or lease_expires_at<=stamp.value)
      returning generation::text,lease_expires_at::text as expires_at`;
    if (!claimed) throw new NotificationSchedulerUnavailable('state_invalid');
    return Object.freeze({
      state: 'acquired',
      lease: Object.freeze({
        ...identity,
        generation: claimed.generation,
        expiresAt: claimed.expires_at,
      }),
    });
  });
}

export async function heartbeatRuntimeLease(lease: RuntimeLease): Promise<RuntimeLease | null> {
  assertRuntimeLease(lease);
  return retryCoordinatorContention(() =>
    withCoordinator(lease.ownerId, lease.generation, async (tx) => {
      const [row] = await tx<LeaseRow[]>`
      with stamp as materialized(select clock_timestamp() as value)
      update public.notification_worker_runtime set last_heartbeat_at=stamp.value,lease_expires_at=stamp.value+interval '30 seconds'
      from stamp where singleton and schema_version=1 and owner_id=${lease.ownerId}::uuid and generation=${lease.generation}::bigint
        and lease_expires_at>clock_timestamp() and build_sha=${lease.buildSha} and catalog_revision=${lease.catalogRevision}
        and catalog_sha256=${lease.catalogSha256} and projector_revision=${lease.projectorRevision} and projector_sha256=${lease.projectorSha256}
      returning generation::text,lease_expires_at::text as expires_at`;
      return row ? Object.freeze({ ...lease, expiresAt: row.expires_at }) : null;
    }),
  );
}

export async function releaseRuntimeLease(lease: RuntimeLease): Promise<boolean> {
  assertRuntimeLease(lease);
  return retryCoordinatorContention(() =>
    withCoordinator(lease.ownerId, lease.generation, async (tx) => {
      const rows = await tx`
      update public.notification_worker_runtime set owner_id=null,lease_expires_at=null,stopped_at=clock_timestamp()
      where singleton and schema_version=1 and owner_id=${lease.ownerId}::uuid and generation=${lease.generation}::bigint
        and lease_expires_at>clock_timestamp() and build_sha=${lease.buildSha} and catalog_revision=${lease.catalogRevision}
        and catalog_sha256=${lease.catalogSha256} and projector_revision=${lease.projectorRevision} and projector_sha256=${lease.projectorSha256}
      returning generation`;
      return rows.length === 1;
    }),
  );
}

export async function publishAdmissionObservation(value: AdmissionObservation): Promise<boolean> {
  if (
    !UUID_PATTERN.test(value.ownerId) ||
    !ADMISSION_FAILURES.includes(value.code) ||
    [value.catalogRevision, value.projectorRevision].some(
      (v) => v !== null && !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(v),
    ) ||
    (value.buildSha !== null && !/^[a-f0-9]{40}$/.test(value.buildSha)) ||
    [value.artifactSha256, value.catalogSha256, value.projectorSha256].some(
      (v) => v !== null && !/^[a-f0-9]{64}$/.test(v),
    )
  )
    throw new Error('Invalid notification admission observation');
  return withCoordinator(value.ownerId, null, async (tx) => {
    const [state] = await tx<
      { admission_generation: string }[]
    >`select admission_generation::text from public.notification_worker_runtime where singleton and schema_version=1 for update skip locked`;
    if (!state) {
      const [present] = await tx<
        { present: boolean }[]
      >`select exists(select 1 from public.notification_worker_runtime where singleton and schema_version=1) as present`;
      if (!present?.present) throw new NotificationSchedulerUnavailable('state_missing');
      return false;
    }
    assertGenerationCanAdvance(state.admission_generation);
    const rows = await tx`
      with candidate as materialized(select singleton from public.notification_worker_runtime
        where singleton and schema_version=1 and (lease_expires_at is null or lease_expires_at<=clock_timestamp())
          and (admission_checked_at is null or admission_checked_at<=clock_timestamp()-interval '30 seconds')
        for update skip locked), stamp as materialized(select clock_timestamp() as value)
      update public.notification_worker_runtime r set admission_generation=r.admission_generation+1,
        admission_owner_id=${value.ownerId}::uuid,admission_checked_at=stamp.value,admission_code=${value.code},
        admission_build_sha=${value.buildSha},admission_artifact_sha256=${value.artifactSha256},
        admission_catalog_revision=${value.catalogRevision},admission_catalog_sha256=${value.catalogSha256},
        admission_projector_revision=${value.projectorRevision},admission_projector_sha256=${value.projectorSha256}
      from candidate,stamp where r.singleton=candidate.singleton returning r.admission_generation`;
    return rows.length === 1;
  });
}
