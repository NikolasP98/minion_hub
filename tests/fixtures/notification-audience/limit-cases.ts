import { expect } from 'vitest';
import { projectNotificationAudience } from '$server/services/notifications/projection/transaction';
import { acquireScope } from './runtime-cases';
import {
  audienceRuntimeIdentity,
  resetNotificationAudienceOperationalState,
  type CapturedQuery,
  type NotificationAudienceHarness,
} from './postgres-harness';
import type { ActiveProjection } from './runtime-cases';

type PlanNode = Readonly<{
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Join Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Filter?: string;
  'Join Filter'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  'One-Time Filter'?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  Plans?: readonly PlanNode[];
}>;

type ExplainPlan = Readonly<{
  Plan: PlanNode;
  JIT?: unknown;
  'Planning Time'?: number;
  'Execution Time'?: number;
}>;

const AUTHORITY_SOURCE_RELATIONS = new Set([
  'join_request',
  'member_roles',
  'organization_members',
  'organizations',
  'permission_rules',
  'profiles',
]);

// Indexes the authority plan must route through on the relations that grow with the audience.
// member_roles, organizations and permission_rules stay governed by AUTHORITY_SEQ_SCAN_ROW_BUDGET:
// with current statistics the planner rightly seq-scans their handful of rows (NOTIF-019).
const AUTHORITY_REQUIRED_INDEXES = [
  'idx_org_members_org',
  'idx_org_members_profile',
  'join_request_pkey',
  'profiles_pkey',
] as const;

async function addManagers(
  harness: NotificationAudienceHarness,
  organizationId: string,
  namespace: string,
  count: number,
): Promise<void> {
  await harness.owner.unsafe(
    `with generated as materialized (
       select value,
         substr(digest,1,8)||'-'||substr(digest,9,4)||'-4'||substr(digest,14,3)||
           '-8'||substr(digest,18,3)||'-'||substr(digest,21,12) as id,
         'bulk-'||$2||'-'||value::text||'@example.invalid' as email
       from (
         select value,md5($1||':'||value::text) as digest from generate_series(1,$3::integer) value
       ) source
     ), inserted_users as (
       insert into auth.users(id,email)
       select id::uuid,email from generated returning id
     ), inserted_profiles as (
       insert into public.profiles(id,email,display_name,role)
       select id::uuid,email,'Bounded audience manager','user' from generated returning id
     )
     insert into public.organization_members(organization_id,profile_id,role)
       select $4::uuid,id::uuid,'owner' from generated`,
    [namespace, namespace, count, organizationId],
  );
}

// Carries the index-negative plan out of a transaction that is always rolled back:
// PostgreSQL restores the dropped index itself, so there is no cleanup statement
// whose own failure could leave the index missing for every later case.
class AuthorityPlanRollback extends Error {
  constructor(readonly plan: unknown) {
    super('Notification authority plan probe rolled back');
  }
}

async function explainAuthorityAsProjectionRole(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  authority: CapturedQuery,
  options: { withoutMemberIndex?: boolean } = {},
) {
  const identity = audienceRuntimeIdentity();
  const probe = harness.owner.begin(async (tx) => {
    if (options.withoutMemberIndex) await tx`drop index public.idx_org_members_org`;
    await tx`select
      set_config('role','app_notification_worker',true),
      set_config('app.current_org_id',${active.event.organization_id},true),
      set_config('app.current_profile_id','',true),
      set_config('app.notification_scope_mode','projection',true),
      set_config('app.notification_runtime_owner',${active.runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${active.runtime.generation},true),
      set_config('app.notification_org_generation',${active.organization.generation},true),
      set_config('app.notification_owner',${active.event.lease.ownerId},true),
      set_config('app.notification_generation',${active.event.lease.generation},true),
      set_config('app.notification_event_id',${active.event.id},true),
      set_config('app.notification_event_catalog_revision',${active.event.catalog_revision},true),
      set_config('app.notification_event_kind',${active.event.kind},true),
      set_config('app.notification_event_schema_version',${active.event.schema_version.toString()},true),
      set_config('app.notification_projection_kind','inbox.v1',true),
      set_config('app.notification_build_sha',${identity.buildSha},true),
      set_config('app.notification_catalog_revision',${identity.catalogRevision},true),
      set_config('app.notification_catalog_sha256',${identity.catalogSha256},true),
      set_config('app.notification_projector_revision',${identity.projectorRevision},true),
      set_config('app.notification_projector_sha256',${identity.projectorSha256},true),
      set_config('app.notification_candidate_id','',true),
      set_config('app.notification_recipient_profile_id','',true),
      set_config('app.notification_authority_sha256','',true),
      set_config('request.jwt.claim.sub','',true),
      set_config('request.jwt.claims','{}',true),
      set_config('statement_timeout','10s',true),
      set_config('lock_timeout','250ms',true),
      set_config('idle_in_transaction_session_timeout','15s',true),
      set_config('jit','off',true)`;
    const rows = await tx.unsafe<{ 'QUERY PLAN': unknown }[]>(
      options.withoutMemberIndex
        ? `explain (format json) ${authority.sql}`
        : `explain (analyze,buffers,format json) ${authority.sql}`,
      [...authority.parameters],
    );
    const plan = rows[0]?.['QUERY PLAN'];
    if (options.withoutMemberIndex) throw new AuthorityPlanRollback(plan);
    return plan;
  });
  if (!options.withoutMemberIndex) return probe;
  try {
    await probe;
  } catch (error) {
    if (error instanceof AuthorityPlanRollback) return error.plan;
    throw error;
  }
  throw new Error('Notification authority plan probe did not roll back');
}

async function setOutboxPlanState(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  state: 'processing' | 'quarantined',
): Promise<void> {
  await harness.owner.unsafe(
    'alter table public.notification_outbox disable trigger notification_outbox_transition',
  );
  try {
    if (state === 'processing') {
      await harness.owner.unsafe(
        `update public.notification_outbox set state='processing',lease_owner=$1::uuid,
          claimed_at=now(),hard_deadline=now()+interval '60 seconds',
          lease_expires_at=now()+interval '30 seconds',renewal_count=0,
          completed_at=null,quarantine_reason=null,terminal_owner_id=null,terminal_generation=null
        where event_id=$2::uuid`,
        [active.event.lease.ownerId, active.event.id],
      );
    } else {
      await harness.owner.unsafe(
        `update public.notification_outbox set state='quarantined',lease_owner=null,
          claimed_at=null,hard_deadline=null,lease_expires_at=null,renewal_count=null,
          completed_at=clock_timestamp(),quarantine_reason='audience_overflow',
          terminal_owner_id=$1::uuid,terminal_generation=$2::bigint
        where event_id=$3::uuid`,
        [active.event.lease.ownerId, active.event.lease.generation, active.event.id],
      );
    }
  } finally {
    await harness.owner.unsafe(
      'alter table public.notification_outbox enable trigger notification_outbox_transition',
    );
  }
}

// Rows-times-loops a sequential scan over a source relation may examine before it is a defect.
const AUTHORITY_SEQ_SCAN_ROW_BUDGET = 1_000;

function planNodes(root: PlanNode): readonly PlanNode[] {
  return [root, ...(root.Plans ?? []).flatMap(planNodes)];
}

function authorityPlanReceipt(explain: unknown) {
  const envelope = (explain as readonly ExplainPlan[])[0];
  if (!envelope?.Plan) throw new Error('Notification audience authority EXPLAIN is missing');
  // NOTIF-019: with jit=on the ~330 policy subplans push the estimate past jit_optimize_above_cost
  // and LLVM optimization alone exceeds the 10s budget; the transaction pins jit=off.
  if (envelope.JIT !== undefined) {
    throw new Error('Notification authority query was JIT-compiled inside the projection budget');
  }
  const nodes = planNodes(envelope.Plan);
  // A sequential scan over a source relation is only a defect when it examines a non-trivial
  // number of rows: with current statistics (the harness ANALYZEs before every case, NOTIF-019)
  // the planner correctly prefers a seq scan over the handful of organizations, member_roles and
  // permission_rules rows a child database holds, and forbidding that merely pinned the lane to
  // the index plans a statistics-less planner guessed. Growth-sensitive relations stay guarded by
  // the required indexes and the 10,001 rows-times-loops bound below.
  const sourceSequentialScans = nodes.filter(
    (node) =>
      node['Node Type'] === 'Seq Scan' &&
      node['Relation Name'] !== undefined &&
      AUTHORITY_SOURCE_RELATIONS.has(node['Relation Name']) &&
      ((node['Actual Rows'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) *
        (node['Actual Loops'] ?? 1) >
        AUTHORITY_SEQ_SCAN_ROW_BUDGET,
  );
  if (sourceSequentialScans.length > 0) {
    throw new Error(
      `Notification authority query sequentially scanned ${sourceSequentialScans
        .map((node) => node['Relation Name'])
        .join(',')} beyond ${AUTHORITY_SEQ_SCAN_ROW_BUDGET} rows`,
    );
  }

  // NOTIF-019: migration 20261007120000 moved the VOLATILE source fence out of every per-row
  // policy qual into an uncorrelated subquery (one InitPlan per scan, evaluated once). A fence
  // call back inside a row filter would multiply by the 10,001 rows this plan visits.
  const fenceRowFilters = nodes.filter((node) =>
    [
      node.Filter,
      node['Join Filter'],
      node['Index Cond'],
      node['Recheck Cond'],
      node['One-Time Filter'],
    ].some((qual) => qual?.includes('notification_projection_source_fence(')),
  );
  if (fenceRowFilters.length > 0) {
    throw new Error(
      `Notification authority query evaluates the source fence per row in ${fenceRowFilters.length} plan nodes`,
    );
  }

  const chosenIndexes = [...new Set(nodes.flatMap((node) => node['Index Name'] ?? []))].sort();
  for (const required of AUTHORITY_REQUIRED_INDEXES) {
    if (!chosenIndexes.includes(required)) {
      throw new Error(`Notification authority query did not use ${required}`);
    }
  }
  const boundedEventRoute = nodes.some(
    (node) =>
      node['Relation Name'] === 'notification_events' &&
      node['Node Type'].includes('Index') &&
      (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 1) <= 1,
  );
  if (!boundedEventRoute) {
    throw new Error('Notification authority query did not use a bounded event route index');
  }
  const boundedOutboxRoute = nodes.some(
    (node) =>
      node['Relation Name'] === 'notification_outbox' &&
      node['Node Type'].includes('Index') &&
      (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 1) <= 1,
  );
  if (!boundedOutboxRoute) {
    throw new Error('Notification authority query did not use a bounded outbox route index');
  }

  const sourceScans = nodes.filter(
    (node) =>
      node['Relation Name'] !== undefined && AUTHORITY_SOURCE_RELATIONS.has(node['Relation Name']),
  );
  const sourceRowsTimesLoops = sourceScans.map(
    (node) =>
      ((node['Actual Rows'] ?? 0) +
        (node['Rows Removed by Filter'] ?? 0) +
        (node['Rows Removed by Join Filter'] ?? 0) +
        (node['Rows Removed by Index Recheck'] ?? 0)) *
      (node['Actual Loops'] ?? 1),
  );
  const maximumSourceRowsTimesLoops = Math.max(0, ...sourceRowsTimesLoops);
  if (maximumSourceRowsTimesLoops > 10_001) {
    throw new Error(
      `Notification authority query examined ${maximumSourceRowsTimesLoops} source rows in one scan`,
    );
  }

  return Object.freeze({
    queryClass: 'authority_bundle',
    chosenIndexes,
    fenceRowFilters: 0,
    maximumSourceRowsTimesLoops,
    sourceRemovedRows: sourceScans.reduce(
      (total, node) =>
        total +
        ((node['Rows Removed by Filter'] ?? 0) +
          (node['Rows Removed by Join Filter'] ?? 0) +
          (node['Rows Removed by Index Recheck'] ?? 0)) *
          (node['Actual Loops'] ?? 1),
      0,
    ),
    buffers: Object.freeze({
      hit: envelope.Plan['Shared Hit Blocks'] ?? 0,
      read: envelope.Plan['Shared Read Blocks'] ?? 0,
    }),
    planningMs: envelope['Planning Time'] ?? null,
    executionMs: envelope['Execution Time'] ?? null,
  });
}

async function verifyAuthorityPlan(
  harness: NotificationAudienceHarness,
  active: ActiveProjection,
  authority: CapturedQuery,
  productionStatementCount: number,
): Promise<void> {
  expect(productionStatementCount).toBeGreaterThan(0);
  expect(productionStatementCount).toBeLessThanOrEqual(16);
  for (const predicate of [
    'e.organization_id=$1::uuid',
    'e.id=$2::uuid',
    'e.catalog_revision=$3',
    'e.kind=$4',
    'e.schema_version=$5',
    "o.state='processing'",
    'o.lease_owner=$6::uuid',
    'o.generation=$7::bigint',
  ]) {
    expect(authority.sql).toContain(predicate);
  }
  await setOutboxPlanState(harness, active, 'processing');
  try {
    const plan = await explainAuthorityAsProjectionRole(harness, active, authority);
    const receipt = authorityPlanReceipt(plan);
    const withoutIndex = await explainAuthorityAsProjectionRole(harness, active, authority, {
      withoutMemberIndex: true,
    });
    expect(() => authorityPlanReceipt(withoutIndex)).toThrow(
      'Notification authority query did not use idx_org_members_org',
    );
    expect(
      await harness.owner`select count(*)::integer as present from pg_class
        where relname='idx_org_members_org' and relkind='i'`,
    ).toEqual([{ present: 1 }]);
    console.info(
      `NOTIFICATION_AUDIENCE_PLAN_RECEIPT ${JSON.stringify({
        members: 10_001,
        productionStatementCount,
        plan: receipt,
        removedIndexNegatives: ['idx_org_members_org'],
      })}`,
    );
  } finally {
    await setOutboxPlanState(harness, active, 'quarantined');
  }
}

export async function verifyTenThousandRecipientBoundary(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 101, 'join.requested');
  await addManagers(harness, active.fixture.organizationId, 'admitted', 9_999);

  const result = await projectNotificationAudience(active, new AbortController().signal);
  expect(result.outcome).toBe('projected');
  expect(result.receipt).toMatchObject({ candidateCount: 10_000 });
  expect(
    await harness.owner`select count(*)::integer as count,
      sum(body_byte_count)::integer as body_bytes
      from public.notification_audience_candidates
      where organization_id=${active.fixture.organizationId}::uuid and event_id=${active.event.id}::uuid`,
  ).toEqual([
    {
      count: 10_000,
      body_bytes: result.receipt?.bodyByteTotal,
    },
  ]);
  expect(
    await harness.owner`select state,terminal_owner_id::text as owner,
      terminal_generation::text as generation
      from public.notification_outbox where event_id=${active.event.id}::uuid`,
  ).toEqual([
    {
      state: 'projected',
      owner: active.event.lease.ownerId,
      generation: active.event.lease.generation,
    },
  ]);
}

export async function verifyTenThousandAndOneRecipientOverflow(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const active = await acquireScope(harness, 102, 'join.requested');
  await addManagers(harness, active.fixture.organizationId, 'overflow', 10_000);

  const projectionQueryStart = harness.workerQueries.length;
  const result = await projectNotificationAudience(active, new AbortController().signal);
  const projectionQueries = harness.workerQueries.slice(projectionQueryStart);
  expect(result).toEqual({ outcome: 'audience_overflow', receipt: null });
  expect(
    await harness.owner`select state,quarantine_reason,terminal_owner_id::text as owner,
      terminal_generation::text as generation
      from public.notification_outbox where event_id=${active.event.id}::uuid`,
  ).toEqual([
    {
      state: 'quarantined',
      quarantine_reason: 'audience_overflow',
      owner: active.event.lease.ownerId,
      generation: active.event.lease.generation,
    },
  ]);
  expect(
    await harness.owner`select
      (select count(*)::integer from public.notification_projection_receipts
        where event_id=${active.event.id}::uuid) as receipts,
      (select count(*)::integer from public.notification_audience_candidates
        where event_id=${active.event.id}::uuid) as candidates`,
  ).toEqual([{ receipts: 0, candidates: 0 }]);
  const authority = projectionQueries.find((query) =>
    query.sql.includes('candidate_profiles as materialized'),
  );
  if (!authority) throw new Error('Captured authority query is missing');
  await verifyAuthorityPlan(harness, active, authority, projectionQueries.length);
}

export async function verifyAuthorityCardinalityBounds(
  harness: NotificationAudienceHarness,
): Promise<void> {
  const ruleOverflow = await acquireScope(harness, 103, 'join.requested');
  await harness.owner.unsafe(
    `insert into public.permission_rules(org_id,role_key,module,can_manage)
     select $1::uuid,'bounded-role-'||value::text,'users',false
     from generate_series(1,257) value`,
    [ruleOverflow.fixture.organizationId],
  );
  expect(await projectNotificationAudience(ruleOverflow, new AbortController().signal)).toEqual({
    outcome: 'audience_authority_overflow',
    receipt: null,
  });
  expect(
    await harness.owner`select state,quarantine_reason from public.notification_outbox
      where event_id=${ruleOverflow.event.id}::uuid`,
  ).toEqual([{ state: 'quarantined', quarantine_reason: 'audience_authority_overflow' }]);

  await resetNotificationAudienceOperationalState(harness);

  const assignmentOverflow = await acquireScope(harness, 104, 'join.requested');
  await harness.owner.unsafe(
    `insert into public.member_roles(org_id,profile_id,role_key)
     select $1::uuid,$2::uuid,'assigned-role-'||value::text
     from generate_series(1,33) value`,
    [assignmentOverflow.fixture.organizationId, assignmentOverflow.fixture.managerId],
  );
  await harness.owner.unsafe(
    `insert into public.permission_rules(org_id,role_key,module,can_manage)
     select $1::uuid,'assigned-role-'||value::text,'users',true
     from generate_series(1,33) value`,
    [assignmentOverflow.fixture.organizationId],
  );
  expect(
    await projectNotificationAudience(assignmentOverflow, new AbortController().signal),
  ).toEqual({ outcome: 'audience_authority_overflow', receipt: null });
  expect(
    await harness.owner`select state,quarantine_reason from public.notification_outbox
      where event_id=${assignmentOverflow.event.id}::uuid`,
  ).toEqual([{ state: 'quarantined', quarantine_reason: 'audience_authority_overflow' }]);
}
