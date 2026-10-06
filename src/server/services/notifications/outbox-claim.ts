import { NOTIFICATION_CATALOG_REVISION } from '$lib/notifications/catalog';
import {
  canonicalNotificationProjectionSupport,
  type NotificationProjectionSupport,
} from '$lib/notifications/projection-manifest';
import { NotificationWorkerUnavailable } from './worker-failure';
import {
  withNotificationWorkerTransaction,
  type NotificationWorkerScope,
  type NotificationWorkerTx,
} from './worker-transaction';
import { notificationIntegrityFailure } from './event-integrity';
import {
  quarantineNotificationEventsInTransaction,
  type NotificationQuarantineReason,
} from './outbox-settlement';

export const NOTIFICATION_CLAIM_LIMIT = 250;
export type NotificationLeaseReceipt = Readonly<{
  eventId: string;
  ownerId: string;
  generation: string;
  expiresAt: string;
  hardDeadline: string;
}>;
export type ClaimedNotificationEvent = Readonly<{
  id: string;
  organization_id: string;
  kind: string;
  schema_version: number;
  catalog_revision: string;
  producer_id: string;
  subject_type: string;
  subject_id: string;
  subject_revision: string;
  source_identity: string;
  occurred_at: string;
  dedupe_key: string;
  payload_canonical: string;
  payload_sha256: string;
  semantic_sha256: string;
  lease: NotificationLeaseReceipt;
}>;
type ClaimedRow = Omit<ClaimedNotificationEvent, 'lease'> & {
  generation: string;
  lease_expires_at: string;
  hard_deadline: string;
};

function revisions(input: readonly string[]): readonly string[] {
  if (
    input.length < 1 ||
    input.length > 8 ||
    new Set(input).size !== input.length ||
    input.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/.test(value))
  )
    throw new Error('Invalid notification catalog support');
  return Object.freeze([...input].sort());
}

/** Slice3 compatibility path for a future worker that explicitly supports a whole catalog. */
export async function unsupportedCatalogPending(
  tx: NotificationWorkerTx,
  organizationId: string,
  supported: readonly string[],
): Promise<boolean> {
  const started = performance.now();
  const checkDeadline = () => {
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
  };
  const versions = revisions(supported);
  const [before] = await tx<
    { found: boolean }[]
  >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
    and catalog_revision < ${versions[0]} collate "C" limit 1) as found`;
  checkDeadline();
  if (before.found) return true;
  for (let index = 0; index < versions.length; index++) {
    const lower = versions[index]!;
    const upper = versions[index + 1];
    const [range] =
      upper === undefined
        ? await tx<
            { found: boolean }[]
          >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
            and catalog_revision > ${lower} collate "C" limit 1) as found`
        : await tx<
            { found: boolean }[]
          >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
            and catalog_revision > ${lower} collate "C" and catalog_revision < ${upper} collate "C" limit 1) as found`;
    checkDeadline();
    if (range.found) return true;
  }
  return false;
}

/** Slice3 raw/version-skew path. Slice5 production uses the exact-tuple function below. */
export async function claimNotificationEventsInTransaction(
  tx: NotificationWorkerTx,
  scope: NotificationWorkerScope,
  supported: readonly string[],
  maximumEvents = NOTIFICATION_CLAIM_LIMIT,
) {
  const started = performance.now();
  const checkDeadline = () => {
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
  };
  if (
    !Number.isInteger(maximumEvents) ||
    maximumEvents < 1 ||
    maximumEvents > NOTIFICATION_CLAIM_LIMIT
  )
    throw new Error('Invalid notification claim limit');
  const versions = revisions(supported);
  const [lock] = await tx<
    { acquired: boolean }[]
  >`select pg_try_advisory_xact_lock(hashtextextended(${scope.organizationId},0)) as acquired`;
  if (!lock.acquired)
    return Object.freeze({
      busy: true,
      events: [] as readonly ClaimedNotificationEvent[],
      unsupportedCatalogPending: null,
      candidateStatements: 0,
    });
  const selected = new Set<string>();
  let candidateStatements = 0;
  async function selectState(state: 'pending' | 'processing', budget: number) {
    for (const revision of versions) {
      checkDeadline();
      const remaining = Math.min(budget, maximumEvents - selected.size);
      if (remaining <= 0) break;
      candidateStatements++;
      const rows =
        state === 'pending'
          ? await tx<
              { event_id: string }[]
            >`select event_id from public.notification_outbox where organization_id=${scope.organizationId}::uuid
              and state='pending' and catalog_revision=${revision} collate "C"
              order by event_id
              for update skip locked limit ${remaining}`
          : await tx<
              { event_id: string }[]
            >`select event_id from public.notification_outbox where organization_id=${scope.organizationId}::uuid
              and state='processing' and catalog_revision=${revision} collate "C"
              and lease_expires_at<=statement_timestamp()
              order by lease_expires_at,event_id
              for update skip locked limit ${remaining}`;
      if (rows.length) {
        checkDeadline();
        const ids = rows.map((row) => row.event_id);
        const updated = await tx<
          { event_id: string }[]
        >`with stamp as materialized (select clock_timestamp() as claimed)
          update public.notification_outbox o set state='processing',lease_owner=${scope.ownerId}::uuid,
          generation=o.generation+1,claim_count=o.claim_count+1,claimed_at=stamp.claimed,
          hard_deadline=stamp.claimed+interval '60 seconds',lease_expires_at=stamp.claimed+interval '30 seconds',renewal_count=0
          from stamp where o.organization_id=${scope.organizationId}::uuid and o.event_id=any(${ids}::uuid[])
          returning o.event_id`;
        if (updated.length !== ids.length)
          throw new Error('Notification claim page changed while locked');
        for (const row of updated) {
          if (selected.has(row.event_id))
            throw new Error('Notification claim selected a row twice');
          selected.add(row.event_id);
        }
        budget -= updated.length;
      }
    }
  }
  const firstPass = Math.ceil(maximumEvents / 2);
  await selectState('pending', firstPass);
  await selectState('processing', maximumEvents - firstPass);
  if (selected.size < maximumEvents) await selectState('pending', maximumEvents - selected.size);
  if (selected.size < maximumEvents) await selectState('processing', maximumEvents - selected.size);
  checkDeadline();
  const unsupported = await unsupportedCatalogPending(tx, scope.organizationId, versions);
  checkDeadline();
  const rows = selected.size
    ? await tx<
        ClaimedRow[]
      >`select e.id,e.organization_id,e.kind,e.schema_version,e.catalog_revision,e.producer_id,e.subject_type,e.subject_id,e.subject_revision,e.source_identity,
      to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,e.dedupe_key,e.payload_canonical,e.payload_sha256,e.semantic_sha256,
      o.generation::text,to_char(o.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as lease_expires_at,
      to_char(o.hard_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as hard_deadline
      from public.notification_events e join public.notification_outbox o on o.event_id=e.id and o.organization_id=e.organization_id
        and o.catalog_revision=e.catalog_revision
      where e.organization_id=${scope.organizationId}::uuid and e.id=any(${[...selected]}::uuid[]) order by e.id`
    : [];
  if (rows.length !== selected.size)
    throw new Error('Notification claim event evidence is unavailable');
  checkDeadline();
  const events = rows.map(({ generation, lease_expires_at, hard_deadline, ...event }) =>
    Object.freeze({
      ...event,
      lease: Object.freeze({
        eventId: event.id,
        ownerId: scope.ownerId,
        generation,
        expiresAt: lease_expires_at,
        hardDeadline: hard_deadline,
      }),
    }),
  );
  return Object.freeze({
    busy: false,
    events: Object.freeze(events),
    unsupportedCatalogPending: unsupported,
    candidateStatements,
  });
}

/** Exact complement ranges let the partial index answer false without scanning supported rows. */
export async function unsupportedProjectionPending(
  tx: NotificationWorkerTx,
  organizationId: string,
  supported: readonly NotificationProjectionSupport[],
): Promise<boolean> {
  const started = performance.now();
  function checkDeadline() {
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
  }
  const tuples = canonicalNotificationProjectionSupport(supported);
  const first = tuples[0]!;
  const [before] = await tx<
    { found: boolean }[]
  >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
    and row(catalog_revision collate "C",kind collate "C",schema_version)
      < row(${first.catalogRevision} collate "C",${first.kind} collate "C",${first.schemaVersion}) limit 1) as found`;
  checkDeadline();
  if (before.found) return true;
  for (let i = 0; i < tuples.length; i++) {
    checkDeadline();
    const lower = tuples[i]!;
    const upper = tuples[i + 1];
    const [range] =
      upper === undefined
        ? await tx<
            { found: boolean }[]
          >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
            and row(catalog_revision collate "C",kind collate "C",schema_version)
              > row(${lower.catalogRevision} collate "C",${lower.kind} collate "C",${lower.schemaVersion}) limit 1) as found`
        : await tx<
            { found: boolean }[]
          >`select exists(select 1 from public.notification_outbox where organization_id=${organizationId}::uuid and state='pending'
            and row(catalog_revision collate "C",kind collate "C",schema_version)
              > row(${lower.catalogRevision} collate "C",${lower.kind} collate "C",${lower.schemaVersion})
            and row(catalog_revision collate "C",kind collate "C",schema_version)
              < row(${upper.catalogRevision} collate "C",${upper.kind} collate "C",${upper.schemaVersion}) limit 1) as found`;
    checkDeadline();
    if (range.found) return true;
  }
  return false;
}

/** No source watermark: every committed pending row remains independently eligible. */
export async function claimNotificationProjectionEventsInTransaction(
  tx: NotificationWorkerTx,
  scope: NotificationWorkerScope,
  supported: readonly NotificationProjectionSupport[],
  maximumEvents = NOTIFICATION_CLAIM_LIMIT,
) {
  const started = performance.now();
  function checkDeadline() {
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
  }
  if (
    !Number.isInteger(maximumEvents) ||
    maximumEvents < 1 ||
    maximumEvents > NOTIFICATION_CLAIM_LIMIT
  )
    throw new Error('Invalid notification claim limit');
  const tuples = canonicalNotificationProjectionSupport(supported);
  const [lock] = await tx<
    { acquired: boolean }[]
  >`select pg_try_advisory_xact_lock(hashtextextended(${scope.organizationId},0)) as acquired`;
  if (!lock.acquired)
    return Object.freeze({
      busy: true,
      events: [] as readonly ClaimedNotificationEvent[],
      unsupportedCatalogPending: null,
      candidateStatements: 0,
    });
  const selected = new Set<string>();
  let candidateStatements = 0;
  async function selectState(state: 'pending' | 'processing', budget: number) {
    for (const support of tuples) {
      checkDeadline();
      const remaining = Math.min(budget, maximumEvents - selected.size);
      if (remaining <= 0) break;
      candidateStatements++;
      const rows =
        state === 'pending'
          ? await tx<
              { event_id: string }[]
            >`select event_id from public.notification_outbox where organization_id=${scope.organizationId}::uuid and state='pending'
              and catalog_revision=${support.catalogRevision} collate "C" and kind=${support.kind} collate "C"
              and schema_version=${support.schemaVersion}
              order by catalog_revision collate "C",kind collate "C",schema_version,event_id
              for update skip locked limit ${remaining}`
          : await tx<
              { event_id: string }[]
            >`select event_id from public.notification_outbox where organization_id=${scope.organizationId}::uuid and state='processing'
              and catalog_revision=${support.catalogRevision} collate "C" and kind=${support.kind} collate "C"
              and schema_version=${support.schemaVersion} and lease_expires_at<=statement_timestamp()
              order by catalog_revision collate "C",kind collate "C",schema_version,lease_expires_at,event_id
              for update skip locked limit ${remaining}`;
      // Claim each selected bounded page immediately so the second capacity pass cannot select it
      // again (a transaction does not SKIP its own locks). No external work occurs before commit.
      if (rows.length) {
        checkDeadline();
        const ids = rows.map((row) => row.event_id);
        const updated = await tx<
          { event_id: string }[]
        >`with stamp as materialized (select clock_timestamp() as claimed)
          update public.notification_outbox o set state='processing',lease_owner=${scope.ownerId}::uuid,
          generation=o.generation+1,claim_count=o.claim_count+1,claimed_at=stamp.claimed,
          hard_deadline=stamp.claimed+interval '60 seconds',lease_expires_at=stamp.claimed+interval '30 seconds',renewal_count=0
          from stamp where o.organization_id=${scope.organizationId}::uuid and o.event_id=any(${ids}::uuid[]) returning o.event_id`;
        if (updated.length !== ids.length)
          throw new Error('Notification claim page changed while locked');
        for (const row of updated) {
          if (selected.has(row.event_id))
            throw new Error('Notification claim selected a row twice');
          selected.add(row.event_id);
        }
        budget -= updated.length;
      }
    }
  }
  const firstPass = Math.ceil(maximumEvents / 2);
  await selectState('pending', firstPass);
  await selectState('processing', maximumEvents - firstPass);
  if (selected.size < maximumEvents) await selectState('pending', maximumEvents - selected.size);
  if (selected.size < maximumEvents) await selectState('processing', maximumEvents - selected.size);
  checkDeadline();
  const unsupported = await unsupportedProjectionPending(tx, scope.organizationId, tuples);
  checkDeadline();
  const rows = selected.size
    ? await tx<
        ClaimedRow[]
      >`select e.id,e.organization_id,e.kind,e.schema_version,e.catalog_revision,e.producer_id,e.subject_type,e.subject_id,e.subject_revision,e.source_identity,
    to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,e.dedupe_key,e.payload_canonical,e.payload_sha256,e.semantic_sha256,
    o.generation::text,to_char(o.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as lease_expires_at,
    to_char(o.hard_deadline at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as hard_deadline
    from public.notification_events e join public.notification_outbox o on o.event_id=e.id and o.organization_id=e.organization_id
      and o.catalog_revision=e.catalog_revision and o.kind=e.kind and o.schema_version=e.schema_version
    where e.organization_id=${scope.organizationId}::uuid and e.id=any(${[...selected]}::uuid[]) order by e.id`
    : [];
  if (rows.length !== selected.size)
    throw new Error('Notification claim event evidence is unavailable');
  checkDeadline();
  const events = rows.map(({ generation, lease_expires_at, hard_deadline, ...event }) =>
    Object.freeze({
      ...event,
      lease: Object.freeze({
        eventId: event.id,
        ownerId: scope.ownerId,
        generation,
        expiresAt: lease_expires_at,
        hardDeadline: hard_deadline,
      }),
    }),
  );
  return Object.freeze({
    busy: false,
    events: Object.freeze(events),
    unsupportedCatalogPending: unsupported,
    candidateStatements,
  });
}

export function claimNotificationEventsForOrg(scope: NotificationWorkerScope) {
  return withNotificationWorkerTransaction(scope, async (tx) => {
    const started = performance.now();
    const batch = await claimNotificationEventsInTransaction(tx, scope, [
      NOTIFICATION_CATALOG_REVISION,
    ]);
    const events: ClaimedNotificationEvent[] = [];
    const rejected: { lease: NotificationLeaseReceipt; reason: NotificationQuarantineReason }[] =
      [];
    for (const event of batch.events) {
      if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
      const reason = notificationIntegrityFailure(event);
      if (reason) rejected.push({ lease: event.lease, reason });
      else events.push(event);
    }
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
    const quarantined = await quarantineNotificationEventsInTransaction(tx, scope, rejected);
    if (quarantined !== rejected.length) throw new Error('Notification quarantine lease expired');
    if (performance.now() - started > 3000) throw new NotificationWorkerUnavailable('deadline');
    return Object.freeze({ ...batch, events: Object.freeze(events), quarantined });
  });
}
