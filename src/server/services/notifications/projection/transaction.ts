import type postgres from 'postgres';
import { getRlsPgClient } from '$server/db/pg-pool';
import {
  NOTIFICATION_PROJECTION_KIND,
  NOTIFICATION_PROJECTION_SUPPORT,
} from '$lib/notifications/projection-manifest';
import type { AuthorityMemberRow, AuthorityRuleRow } from './authority';
import { resolveManagerRecipients } from './authority';
import {
  NotificationProjectionUnavailable,
  PROJECTION_LIMITS,
  type ProjectionCandidate,
  type ProjectionQuarantineReason,
  type ProjectionReceipt,
} from './contracts';
import { assertProjectionScope, type ProjectionScope } from './fence';
import { projectJoinAudience, projectionSetDigest, type JoinRequestEvidence } from './join-adapter';

export type ProjectionTx = postgres.TransactionSql;
export type ProjectionTerminal = Readonly<{
  outcome: 'projected' | ProjectionQuarantineReason;
  receipt: ProjectionReceipt | null;
}>;

type AuthorityBundleRow = Readonly<{
  event_found: boolean;
  organization_active: boolean;
  request_evidence: JoinRequestEvidence | null;
  member_count: number;
  assignment_count: number;
  role_key_count: number;
  rule_count: number;
  members: AuthorityMemberRow[];
  rules: AuthorityRuleRow[];
}>;

class ProjectionBudget {
  private statements = 0;
  constructor(
    private readonly started: number,
    private readonly signal: AbortSignal,
  ) {}

  before(finalizer = false): void {
    if (this.signal.aborted) throw new NotificationProjectionUnavailable('deadline');
    const elapsed = performance.now() - this.started;
    if (elapsed >= (finalizer ? PROJECTION_LIMITS.wallMs : PROJECTION_LIMITS.preFinalizerMs))
      throw new NotificationProjectionUnavailable('deadline');
    this.statements += 1;
    if (this.statements > PROJECTION_LIMITS.statements)
      throw new NotificationProjectionUnavailable('integrity_failed');
  }

  finalizerTimeout(): string {
    const remaining = Math.floor(PROJECTION_LIMITS.wallMs - (performance.now() - this.started));
    if (remaining < 1 || remaining > PROJECTION_LIMITS.finalizerMs)
      return `${Math.min(PROJECTION_LIMITS.finalizerMs, Math.max(1, remaining))}ms`;
    return `${remaining}ms`;
  }
}

function adapterRevision(scope: ProjectionScope): string {
  const support = NOTIFICATION_PROJECTION_SUPPORT.find(
    (entry) =>
      entry.catalogRevision === scope.event.catalog_revision &&
      entry.kind === scope.event.kind &&
      entry.schemaVersion === scope.event.schema_version,
  );
  if (!support) throw new NotificationProjectionUnavailable('integrity_failed');
  return support.adapterRevision;
}

function boundedBundle(row: AuthorityBundleRow | undefined): AuthorityBundleRow {
  if (
    !row ||
    typeof row.event_found !== 'boolean' ||
    typeof row.organization_active !== 'boolean' ||
    !Number.isInteger(row.member_count) ||
    !Number.isInteger(row.assignment_count) ||
    !Number.isInteger(row.role_key_count) ||
    !Number.isInteger(row.rule_count) ||
    !Array.isArray(row.members) ||
    !Array.isArray(row.rules)
  ) {
    throw new NotificationProjectionUnavailable('integrity_failed');
  }
  if (!row.event_found) throw new NotificationProjectionUnavailable('scope_lost');
  if (
    row.assignment_count > PROJECTION_LIMITS.assignments ||
    row.role_key_count > PROJECTION_LIMITS.roleKeys ||
    row.rule_count > PROJECTION_LIMITS.rules
  ) {
    throw new RangeError('notification_authority_overflow');
  }
  if (row.member_count > PROJECTION_LIMITS.recipientSentinel)
    throw new RangeError('notification_audience_overflow');
  for (const member of row.members) {
    if (
      !member ||
      typeof member.profileId !== 'string' ||
      (member.legacyRole !== null && typeof member.legacyRole !== 'string') ||
      (member.profileRole !== null && typeof member.profileRole !== 'string') ||
      (member.roleKey !== null && typeof member.roleKey !== 'string')
    ) {
      throw new NotificationProjectionUnavailable('integrity_failed');
    }
  }
  for (const rule of row.rules) {
    if (
      !rule ||
      typeof rule.role_key !== 'string' ||
      rule.module !== 'users' ||
      typeof rule.can_manage !== 'boolean' ||
      typeof rule.if_owner !== 'boolean' ||
      !Number.isInteger(rule.field_level)
    ) {
      throw new NotificationProjectionUnavailable('integrity_failed');
    }
  }
  return row;
}

async function setupProjectionScope(
  tx: ProjectionTx,
  scope: ProjectionScope,
  budget: ProjectionBudget,
) {
  budget.before();
  const [setup] = await tx<{ identity_cleared: boolean }[]>`
    select
      set_config('role','app_notification_worker',true),
      set_config('app.current_org_id',${scope.organization.organizationId},true),
      set_config('app.current_profile_id','',true),
      set_config('app.notification_scope_mode','projection',true),
      set_config('app.notification_runtime_owner',${scope.runtime.ownerId},true),
      set_config('app.notification_runtime_generation',${scope.runtime.generation},true),
      set_config('app.notification_org_generation',${scope.organization.generation},true),
      set_config('app.notification_owner',${scope.event.lease.ownerId},true),
      set_config('app.notification_generation',${scope.event.lease.generation},true),
      set_config('app.notification_event_id',${scope.event.id},true),
      set_config('app.notification_event_catalog_revision',${scope.event.catalog_revision},true),
      set_config('app.notification_event_kind',${scope.event.kind},true),
      set_config('app.notification_event_schema_version',${scope.event.schema_version.toString()},true),
      set_config('app.notification_projection_kind',${NOTIFICATION_PROJECTION_KIND},true),
      set_config('app.notification_build_sha',${scope.runtime.buildSha},true),
      set_config('app.notification_catalog_revision',${scope.runtime.catalogRevision},true),
      set_config('app.notification_catalog_sha256',${scope.runtime.catalogSha256},true),
      set_config('app.notification_projector_revision',${scope.runtime.projectorRevision},true),
      set_config('app.notification_projector_sha256',${scope.runtime.projectorSha256},true),
      set_config('app.notification_candidate_id','',true),
      set_config('app.notification_recipient_profile_id','',true),
      set_config('app.notification_authority_sha256','',true),
      set_config('request.jwt.claim.sub','',true),
      set_config('request.jwt.claims','{}',true),
      set_config('statement_timeout','10s',true),
      set_config('lock_timeout','250ms',true),
      set_config('idle_in_transaction_session_timeout','15s',true),
      auth.uid() is null as identity_cleared`;
  if (!setup?.identity_cleared) throw new NotificationProjectionUnavailable('integrity_failed');

  budget.before();
  const [fence] = await tx<{ valid: boolean }[]>`
    select public.notification_projection_source_fence(${scope.organization.organizationId}::uuid) as valid`;
  if (!fence?.valid) throw new NotificationProjectionUnavailable('scope_lost');
}

async function readAuthorityBundle(
  tx: ProjectionTx,
  scope: ProjectionScope,
  budget: ProjectionBudget,
): Promise<AuthorityBundleRow> {
  budget.before();
  const [row] = await tx<AuthorityBundleRow[]>`
    with event_scope as materialized (
      select e.id,e.organization_id,e.subject_type,e.subject_id,e.subject_revision,e.kind,
        e.catalog_revision,e.schema_version
      from public.notification_events e
      join public.notification_outbox o on o.organization_id=e.organization_id and o.event_id=e.id
        and o.catalog_revision=e.catalog_revision and o.kind=e.kind and o.schema_version=e.schema_version
      where e.organization_id=${scope.event.organization_id}::uuid and e.id=${scope.event.id}::uuid
        and e.catalog_revision=${scope.event.catalog_revision} collate "C"
        and e.kind=${scope.event.kind} collate "C" and e.schema_version=${scope.event.schema_version}
        and o.state='processing' and o.lease_owner=${scope.event.lease.ownerId}::uuid
        and o.generation=${scope.event.lease.generation}::bigint
    ), organization_scope as materialized (
      select organization.id,organization.status
      from public.organizations organization join event_scope event on event.organization_id=organization.id
    ), request_scope as materialized (
      select request.id,request.organization_id,request.supabase_id,request.user_id,request.status,
        to_char(request.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
        case when request.reviewed_at is null then null else
          to_char(request.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as reviewed_at,
        exists(select 1 from public.profiles applicant where applicant.id=request.supabase_id) as profile_exists
      from public.join_request request join event_scope event
        on event.subject_type='join_request' and event.subject_id=request.id
        and event.organization_id::text=request.organization_id
    ), rule_scope as materialized (
      select rule.role_key,rule.module,rule.can_manage,rule.if_owner,rule.field_level::integer
      from public.permission_rules rule join event_scope event on event.organization_id=rule.org_id
      where rule.module='users' order by rule.role_key collate "C" limit ${PROJECTION_LIMITS.rules + 1}
    ), role_universe as materialized (
      select role_key from (
        select 'owner'::text as role_key union all select 'admin' union all
        select role.role_key from public.member_roles role join event_scope event on event.organization_id=role.org_id
        union all select rule.role_key from rule_scope rule
        union all select case member.role when 'owner' then 'owner' when 'admin' then 'admin'
          when 'member' then 'manager' else 'viewer' end
          from public.organization_members member join event_scope event on event.organization_id=member.organization_id
      ) roles group by role_key order by role_key collate "C" limit ${PROJECTION_LIMITS.roleKeys + 1}
    ), manageable_roles as materialized (
      select role.role_key from role_universe role left join rule_scope rule on rule.role_key=role.role_key
      where coalesce(rule.can_manage,role.role_key in ('owner','admin'))
    ), candidate_profiles as materialized (
      select member.profile_id,member.role as legacy_role,profile.role as profile_role
      from public.organization_members member
      join event_scope event on event.organization_id=member.organization_id
      join public.profiles profile on profile.id=member.profile_id
      where profile.role='admin'
        or exists(select 1 from public.member_roles assigned join manageable_roles allowed using(role_key)
          where assigned.org_id=member.organization_id and assigned.profile_id=member.profile_id)
        or (not exists(select 1 from public.member_roles assigned
              where assigned.org_id=member.organization_id and assigned.profile_id=member.profile_id)
          and (case member.role when 'owner' then 'owner' when 'admin' then 'admin'
            when 'member' then 'manager' else 'viewer' end) in (select role_key from manageable_roles))
      order by member.profile_id limit ${PROJECTION_LIMITS.recipientSentinel}
    ), assignments as materialized (
      select candidate.profile_id,candidate.legacy_role,candidate.profile_role,assigned.role_key
      from candidate_profiles candidate left join public.member_roles assigned
        on assigned.org_id=${scope.event.organization_id}::uuid and assigned.profile_id=candidate.profile_id
      order by candidate.profile_id,assigned.role_key collate "C" limit ${PROJECTION_LIMITS.assignments + 1}
    )
    select exists(select 1 from event_scope) as event_found,
      coalesce((select status='active' from organization_scope),false) as organization_active,
      (select jsonb_build_object(
        'id',request.id::text,'organizationId',request.organization_id,'supabaseId',request.supabase_id::text,
        'userId',request.user_id,'status',request.status,'createdAt',request.created_at,
        'reviewedAt',request.reviewed_at,'profileExists',request.profile_exists,
        'organizationActive',coalesce((select status='active' from organization_scope),false))
        from request_scope request) as request_evidence,
      (select count(*)::integer from candidate_profiles) as member_count,
      (select count(*)::integer from assignments) as assignment_count,
      (select count(*)::integer from role_universe) as role_key_count,
      (select count(*)::integer from rule_scope) as rule_count,
      coalesce((select jsonb_agg(jsonb_build_object(
        'profileId',assignment.profile_id::text,'legacyRole',assignment.legacy_role,
        'profileRole',assignment.profile_role,'roleKey',assignment.role_key)
        order by assignment.profile_id,assignment.role_key collate "C") from assignments assignment),'[]'::jsonb) as members,
      coalesce((select jsonb_agg(jsonb_build_object(
        'role_key',rule.role_key,'module',rule.module,'can_manage',rule.can_manage,
        'if_owner',rule.if_owner,'field_level',rule.field_level)
        order by rule.role_key collate "C") from rule_scope rule),'[]'::jsonb) as rules`;
  return boundedBundle(row);
}

function resolveCandidates(
  scope: ProjectionScope,
  bundle: AuthorityBundleRow,
):
  | Readonly<{ outcome: ProjectionQuarantineReason; candidates: readonly ProjectionCandidate[] }>
  | Readonly<{ outcome: 'projected'; candidates: readonly ProjectionCandidate[] }> {
  if (!bundle.organization_active)
    return { outcome: 'subject_invalid', candidates: Object.freeze([]) };
  let managers;
  try {
    managers = resolveManagerRecipients(bundle.members, bundle.rules);
  } catch (error) {
    if (error instanceof RangeError)
      return { outcome: 'audience_authority_overflow', candidates: Object.freeze([]) };
    throw error;
  }
  let projected;
  try {
    projected = projectJoinAudience({
      event: scope.event,
      request: bundle.request_evidence,
      managers,
    });
  } catch (error) {
    if (error instanceof RangeError)
      return { outcome: 'body_overflow', candidates: Object.freeze([]) };
    throw error;
  }
  if (projected.state === 'invalid')
    return { outcome: 'subject_invalid', candidates: Object.freeze([]) };
  if (projected.state === 'overflow')
    return { outcome: 'audience_overflow', candidates: Object.freeze([]) };
  return { outcome: 'projected', candidates: projected.candidates };
}

function receiptFor(candidates: readonly ProjectionCandidate[]): ProjectionReceipt {
  const bodyByteTotal = candidates.reduce((total, candidate) => total + candidate.bodyByteCount, 0);
  if (bodyByteTotal > PROJECTION_LIMITS.bodyByteTotal)
    throw new RangeError('notification_body_overflow');
  return Object.freeze({
    candidateCount: candidates.length,
    bodyByteTotal,
    candidateSetSha256: projectionSetDigest(candidates),
  });
}

async function insertProjection(
  tx: ProjectionTx,
  scope: ProjectionScope,
  candidates: readonly ProjectionCandidate[],
  receipt: ProjectionReceipt,
  budget: ProjectionBudget,
) {
  budget.before();
  const insertedReceipt = await tx`
    insert into public.notification_projection_receipts(
      organization_id,event_id,catalog_revision,kind,schema_version,projection_kind,adapter_revision,
      claim_owner_id,claim_generation,candidate_count,body_byte_total,candidate_set_sha256)
    values(${scope.event.organization_id}::uuid,${scope.event.id}::uuid,${scope.event.catalog_revision},
      ${scope.event.kind},${scope.event.schema_version},${NOTIFICATION_PROJECTION_KIND},${adapterRevision(scope)},
      ${scope.event.lease.ownerId}::uuid,${scope.event.lease.generation}::bigint,
      ${receipt.candidateCount},${receipt.bodyByteTotal}::bigint,${receipt.candidateSetSha256})
    returning event_id`;
  if (insertedReceipt.length !== 1) throw new NotificationProjectionUnavailable('integrity_failed');

  if (candidates.length === 0) return;
  budget.before();
  const rows = candidates.map((candidate) => ({
    recipient_profile_id: candidate.recipientProfileId,
    audience_mode: candidate.audienceMode,
    adapter_revision: candidate.adapterRevision,
    authority_sha256: candidate.authoritySha256,
    template_key: candidate.templateKey,
    template_revision: candidate.templateRevision,
    template_sha256: candidate.templateSha256,
    parameters_canonical: candidate.parametersCanonical,
    navigation_id: candidate.navigationId,
    body_sha256: candidate.bodySha256,
    body_byte_count: candidate.bodyByteCount,
    candidate_sha256: candidate.candidateSha256,
  }));
  const inserted = await tx`
    insert into public.notification_audience_candidates(
      organization_id,event_id,projection_kind,recipient_profile_id,audience_mode,adapter_revision,
      authority_sha256,template_key,template_revision,template_sha256,parameters_canonical,navigation_id,
      body_sha256,body_byte_count,candidate_sha256)
    select ${scope.event.organization_id}::uuid,${scope.event.id}::uuid,${NOTIFICATION_PROJECTION_KIND},
      candidate.recipient_profile_id::uuid,candidate.audience_mode,candidate.adapter_revision,
      candidate.authority_sha256,candidate.template_key,candidate.template_revision,candidate.template_sha256,
      candidate.parameters_canonical,candidate.navigation_id,candidate.body_sha256,
      candidate.body_byte_count,candidate.candidate_sha256
    from jsonb_to_recordset(${tx.json(rows)}::jsonb) as candidate(
      recipient_profile_id text,audience_mode text,adapter_revision text,authority_sha256 text,
      template_key text,template_revision text,template_sha256 text,parameters_canonical text,
      navigation_id text,body_sha256 text,body_byte_count integer,candidate_sha256 text)`;
  // RETURNING would invoke candidate SELECT RLS before the row is finalized. The command tag
  // proves the exact inserted cardinality without widening projection-time read authority.
  if (inserted.count !== candidates.length)
    throw new NotificationProjectionUnavailable('integrity_failed');
}

/** One READ COMMITTED transaction owns authority, receipt, candidates, finalization and COMMIT. */
export async function projectNotificationAudience(
  scope: ProjectionScope,
  signal: AbortSignal,
  started = performance.now(),
): Promise<ProjectionTerminal> {
  assertProjectionScope(scope);
  const budget = new ProjectionBudget(started, signal);
  return (await getRlsPgClient().begin(async (tx) => {
    await setupProjectionScope(tx, scope, budget);
    let resolved;
    let receipt: ProjectionReceipt | null = null;
    try {
      resolved = resolveCandidates(scope, await readAuthorityBundle(tx, scope, budget));
      if (resolved.outcome === 'projected') receipt = receiptFor(resolved.candidates);
    } catch (error) {
      if (error instanceof RangeError) {
        resolved = {
          outcome: error.message.includes('body')
            ? ('body_overflow' as const)
            : error.message.includes('audience')
              ? ('audience_overflow' as const)
              : ('audience_authority_overflow' as const),
          candidates: Object.freeze([]),
        };
      } else throw error;
    }

    if (resolved.outcome === 'projected' && receipt !== null) {
      await insertProjection(tx, scope, resolved.candidates, receipt, budget);
    }

    budget.before(true);
    await tx`select set_config('statement_timeout',${budget.finalizerTimeout()},true),
      set_config('lock_timeout','250ms',true)`;
    budget.before(true);
    const [finalized] = await tx<{ finalized: boolean }[]>`
      select public.notification_finalize_audience(${resolved.outcome}) as finalized`;
    if (!finalized?.finalized) throw new NotificationProjectionUnavailable('scope_lost');
    return Object.freeze({ outcome: resolved.outcome, receipt });
  })) as ProjectionTerminal;
}
