import { getRlsPgClient } from '$server/db/pg-pool';
import type { AuthorityMemberRow, AuthorityRuleRow } from './authority';
import { resolveManagerRecipients } from './authority';
import {
  NotificationProjectionUnavailable,
  PROJECTION_LIMITS,
  type ProjectionCandidate,
} from './contracts';
import { assertRevalidationScope, type RevalidationScope } from './fence';
import {
  projectJoinAudience,
  type JoinProjectionEvent,
  type JoinRequestEvidence,
} from './join-adapter';

export type RevalidatedNotificationCandidate = Readonly<{
  candidateId: string;
  recipientProfileId: string;
  templateKey: string;
  templateRevision: string;
  templateSha256: string;
  parametersCanonical: string;
  navigationId: string;
  bodySha256: string;
  bodyByteCount: number;
}>;

type LockedCandidate = RevalidatedNotificationCandidate &
  Readonly<{
    organizationId: string;
    eventId: string;
    projectionKind: string;
    audienceMode: 'users_manage' | 'join_applicant';
    adapterRevision: string;
    authoritySha256: string;
    candidateSha256: string;
  }>;

type RevalidationBundle = Readonly<{
  event: JoinProjectionEvent | null;
  organization_active: boolean;
  request_evidence: JoinRequestEvidence | null;
  membership_found: boolean;
  assignment_count: number;
  role_key_count: number;
  rule_count: number;
  members: AuthorityMemberRow[];
  rules: AuthorityRuleRow[];
}>;

type CancellationReason =
  | 'membership_revoked'
  | 'capability_revoked'
  | 'subject_changed'
  | 'organization_inactive'
  | 'authority_changed';

class RevalidationBudget {
  private statements = 0;
  private readonly started = performance.now();

  before(): void {
    this.statements += 1;
    if (
      this.statements > PROJECTION_LIMITS.revalidationStatements ||
      performance.now() - this.started >= PROJECTION_LIMITS.revalidationWallMs
    ) {
      throw new NotificationProjectionUnavailable('revalidation_unavailable');
    }
  }
}

async function setupScope(
  tx: import('postgres').TransactionSql,
  scope: RevalidationScope,
  budget: RevalidationBudget,
): Promise<void> {
  budget.before();
  const [setup] = await tx<{ identity_cleared: boolean }[]>`
    select
      set_config('role','app_notification_worker',true),
      set_config('app.current_org_id',${scope.organizationId},true),
      set_config('app.current_profile_id','',true),
      set_config('app.notification_scope_mode','revalidation',true),
      set_config('app.notification_candidate_id',${scope.candidateId},true),
      set_config('app.notification_recipient_profile_id',${scope.recipientProfileId},true),
      set_config('app.notification_authority_sha256',${scope.authoritySha256},true),
      set_config('app.notification_runtime_owner','',true),
      set_config('app.notification_runtime_generation','',true),
      set_config('app.notification_org_generation','',true),
      set_config('app.notification_owner','',true),
      set_config('app.notification_generation','',true),
      set_config('app.notification_event_id','',true),
      set_config('app.notification_event_catalog_revision','',true),
      set_config('app.notification_event_kind','',true),
      set_config('app.notification_event_schema_version','',true),
      set_config('app.notification_projection_kind','',true),
      set_config('app.notification_build_sha','',true),
      set_config('app.notification_catalog_revision','',true),
      set_config('app.notification_catalog_sha256','',true),
      set_config('app.notification_projector_revision','',true),
      set_config('app.notification_projector_sha256','',true),
      set_config('request.jwt.claim.sub','',true),
      set_config('request.jwt.claims','{}',true),
      set_config('statement_timeout','3s',true),
      set_config('lock_timeout','250ms',true),
      set_config('idle_in_transaction_session_timeout','5s',true),
      auth.uid() is null as identity_cleared`;
  if (!setup?.identity_cleared)
    throw new NotificationProjectionUnavailable('revalidation_unavailable');
}

async function lockCandidate(
  tx: import('postgres').TransactionSql,
  scope: RevalidationScope,
  budget: RevalidationBudget,
): Promise<LockedCandidate | null> {
  budget.before();
  const [row] = await tx<
    {
      candidate_id: string;
      organization_id: string;
      event_id: string;
      projection_kind: string;
      recipient_profile_id: string;
      audience_mode: LockedCandidate['audienceMode'];
      adapter_revision: string;
      authority_sha256: string;
      template_key: string;
      template_revision: string;
      template_sha256: string;
      parameters_canonical: string;
      navigation_id: string;
      body_sha256: string;
      body_byte_count: number;
      candidate_sha256: string;
    }[]
  >`select c.id as candidate_id,c.organization_id,c.event_id,c.projection_kind,
      c.recipient_profile_id,c.audience_mode,c.adapter_revision,c.authority_sha256,c.template_key,
      c.template_revision,c.template_sha256,c.parameters_canonical,c.navigation_id,c.body_sha256,
      c.body_byte_count,c.candidate_sha256
    from public.notification_audience_candidates c
    where c.organization_id=${scope.organizationId}::uuid and c.id=${scope.candidateId}::uuid
      and c.recipient_profile_id=${scope.recipientProfileId}::uuid
      and c.authority_sha256=${scope.authoritySha256} and c.state='ready'
    for update of c`;
  if (!row) return null;
  return Object.freeze({
    candidateId: row.candidate_id,
    organizationId: row.organization_id,
    eventId: row.event_id,
    projectionKind: row.projection_kind,
    recipientProfileId: row.recipient_profile_id,
    audienceMode: row.audience_mode,
    adapterRevision: row.adapter_revision,
    authoritySha256: row.authority_sha256,
    templateKey: row.template_key,
    templateRevision: row.template_revision,
    templateSha256: row.template_sha256,
    parametersCanonical: row.parameters_canonical,
    navigationId: row.navigation_id,
    bodySha256: row.body_sha256,
    bodyByteCount: row.body_byte_count,
    candidateSha256: row.candidate_sha256,
  });
}

async function readAuthorityBundle(
  tx: import('postgres').TransactionSql,
  candidate: LockedCandidate,
  budget: RevalidationBudget,
): Promise<RevalidationBundle> {
  budget.before();
  const [row] = await tx<RevalidationBundle[]>`
    with candidate_scope as materialized (
      select c.organization_id,c.event_id,c.projection_kind,c.recipient_profile_id,c.audience_mode
      from public.notification_audience_candidates c
      join public.notification_projection_receipts r using(organization_id,event_id,projection_kind)
      where c.organization_id=${candidate.organizationId}::uuid and c.id=${candidate.candidateId}::uuid
        and c.recipient_profile_id=${candidate.recipientProfileId}::uuid and c.state='ready'
        and c.authority_sha256=${candidate.authoritySha256} and r.finalized_at is not null
    ), event_scope as materialized (
      select e.id,e.organization_id,e.kind,e.schema_version,e.catalog_revision,e.subject_type,
        e.subject_id,e.subject_revision,e.payload_canonical
      from public.notification_events e join candidate_scope c
        on c.organization_id=e.organization_id and c.event_id=e.id
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
    ), member_scope as materialized (
      select member.profile_id,member.role as legacy_role,profile.role as profile_role
      from candidate_scope candidate
      join public.organization_members member on member.organization_id=candidate.organization_id
        and member.profile_id=candidate.recipient_profile_id
      join public.profiles profile on profile.id=member.profile_id
    ), assignments as materialized (
      select member.profile_id,member.legacy_role,member.profile_role,role.role_key
      from member_scope member left join public.member_roles role
        on role.org_id=${candidate.organizationId}::uuid and role.profile_id=member.profile_id
      order by role.role_key collate "C" limit ${PROJECTION_LIMITS.rolesPerRecipient + 1}
    ), rule_scope as materialized (
      select rule.role_key,rule.module,rule.can_manage,rule.if_owner,rule.field_level::integer
      from public.permission_rules rule
      where rule.org_id=${candidate.organizationId}::uuid and rule.module='users'
        and (rule.role_key in (select role_key from assignments where role_key is not null)
          or rule.role_key=(select case legacy_role when 'owner' then 'owner' when 'admin' then 'admin'
            when 'member' then 'manager' else 'viewer' end from member_scope))
      order by rule.role_key collate "C" limit ${PROJECTION_LIMITS.rules + 1}
    )
    select (select to_jsonb(event) from event_scope event) as event,
      coalesce((select status='active' from organization_scope),false) as organization_active,
      (select jsonb_build_object(
        'id',request.id::text,'organizationId',request.organization_id,'supabaseId',request.supabase_id::text,
        'userId',request.user_id,'status',request.status,'createdAt',request.created_at,
        'reviewedAt',request.reviewed_at,'profileExists',request.profile_exists,
        'organizationActive',coalesce((select status='active' from organization_scope),false))
        from request_scope request) as request_evidence,
      exists(select 1 from member_scope) as membership_found,
      (select count(*)::integer from assignments) as assignment_count,
      (select count(distinct role_key)::integer from assignments where role_key is not null) as role_key_count,
      (select count(*)::integer from rule_scope) as rule_count,
      coalesce((select jsonb_agg(jsonb_build_object(
        'profileId',assignment.profile_id::text,'legacyRole',assignment.legacy_role,
        'profileRole',assignment.profile_role,'roleKey',assignment.role_key)
        order by assignment.role_key collate "C") from assignments assignment),'[]'::jsonb) as members,
      coalesce((select jsonb_agg(jsonb_build_object(
        'role_key',rule.role_key,'module',rule.module,'can_manage',rule.can_manage,
        'if_owner',rule.if_owner,'field_level',rule.field_level)
        order by rule.role_key collate "C") from rule_scope rule),'[]'::jsonb) as rules`;
  if (
    !row ||
    !Array.isArray(row.members) ||
    !Array.isArray(row.rules) ||
    !Number.isInteger(row.assignment_count) ||
    !Number.isInteger(row.role_key_count) ||
    !Number.isInteger(row.rule_count) ||
    row.assignment_count > PROJECTION_LIMITS.rolesPerRecipient ||
    row.role_key_count > PROJECTION_LIMITS.roleKeys ||
    row.rule_count > PROJECTION_LIMITS.rules
  ) {
    throw new NotificationProjectionUnavailable('revalidation_unavailable');
  }
  return row;
}

function currentCandidate(
  candidate: LockedCandidate,
  bundle: RevalidationBundle,
): { candidate: ProjectionCandidate | null; cancel: CancellationReason | null } {
  if (!bundle.organization_active) return { candidate: null, cancel: 'organization_inactive' };
  if (!bundle.event) return { candidate: null, cancel: 'subject_changed' };
  let managers: ReturnType<typeof resolveManagerRecipients> = Object.freeze([]);
  if (candidate.audienceMode === 'users_manage') {
    if (!bundle.membership_found) return { candidate: null, cancel: 'membership_revoked' };
    managers = [...resolveManagerRecipients(bundle.members, bundle.rules)];
    if (!managers.some((manager) => manager.profileId === candidate.recipientProfileId))
      return { candidate: null, cancel: 'capability_revoked' };
  }
  const projected = projectJoinAudience({
    event: bundle.event,
    request: bundle.request_evidence,
    managers,
  });
  if (projected.state !== 'ready') return { candidate: null, cancel: 'subject_changed' };
  const current = projected.candidates.find(
    (value) =>
      value.recipientProfileId === candidate.recipientProfileId &&
      value.audienceMode === candidate.audienceMode,
  );
  if (!current)
    return {
      candidate: null,
      cancel: candidate.audienceMode === 'users_manage' ? 'capability_revoked' : 'subject_changed',
    };
  return { candidate: current, cancel: null };
}

function unchanged(candidate: LockedCandidate, current: ProjectionCandidate): boolean {
  return (
    candidate.adapterRevision === current.adapterRevision &&
    candidate.authoritySha256 === current.authoritySha256 &&
    candidate.templateKey === current.templateKey &&
    candidate.templateRevision === current.templateRevision &&
    candidate.templateSha256 === current.templateSha256 &&
    candidate.parametersCanonical === current.parametersCanonical &&
    candidate.navigationId === current.navigationId &&
    candidate.bodySha256 === current.bodySha256 &&
    candidate.bodyByteCount === current.bodyByteCount &&
    candidate.candidateSha256 === current.candidateSha256
  );
}

async function finish(
  tx: import('postgres').TransactionSql,
  candidate: LockedCandidate,
  reason: CancellationReason | null,
  budget: RevalidationBudget,
): Promise<RevalidatedNotificationCandidate | null> {
  budget.before();
  if (reason) {
    const rows = await tx`
      update public.notification_audience_candidates set state='cancelled',cancelled_at=clock_timestamp(),
        cancellation_reason=${reason},template_key=null,parameters_canonical=null,navigation_id=null
      where organization_id=${candidate.organizationId}::uuid and id=${candidate.candidateId}::uuid
        and recipient_profile_id=${candidate.recipientProfileId}::uuid and state='ready'
        and authority_sha256=${candidate.authoritySha256} and body_sha256=${candidate.bodySha256}
        and event_id=${candidate.eventId}::uuid and projection_kind=${candidate.projectionKind}
    `;
    // A cancelled descriptor is deliberately no longer visible through the ready-row SELECT
    // policy. Use the UPDATE command tag rather than granting post-cancellation read authority.
    if (rows.count !== 1) throw new NotificationProjectionUnavailable('revalidation_unavailable');
    return null;
  }
  const [row] = await tx<{ id: string }[]>`
    select id from public.notification_audience_candidates
    where organization_id=${candidate.organizationId}::uuid and id=${candidate.candidateId}::uuid
      and recipient_profile_id=${candidate.recipientProfileId}::uuid and state='ready'
      and authority_sha256=${candidate.authoritySha256} and body_sha256=${candidate.bodySha256}
      and event_id=${candidate.eventId}::uuid and projection_kind=${candidate.projectionKind}
      and candidate_sha256=${candidate.candidateSha256}`;
  if (row?.id !== candidate.candidateId)
    throw new NotificationProjectionUnavailable('revalidation_unavailable');
  return Object.freeze({
    candidateId: candidate.candidateId,
    recipientProfileId: candidate.recipientProfileId,
    templateKey: candidate.templateKey,
    templateRevision: candidate.templateRevision,
    templateSha256: candidate.templateSha256,
    parametersCanonical: candidate.parametersCanonical,
    navigationId: candidate.navigationId,
    bodySha256: candidate.bodySha256,
    bodyByteCount: candidate.bodyByteCount,
  });
}

/** Revalidates exactly one recipient candidate. It never activates or recreates a row. */
export async function revalidateNotificationCandidate(
  scope: RevalidationScope,
): Promise<RevalidatedNotificationCandidate | null> {
  assertRevalidationScope(scope);
  const budget = new RevalidationBudget();
  try {
    return (await getRlsPgClient().begin(async (tx) => {
      await setupScope(tx, scope, budget);
      const locked = await lockCandidate(tx, scope, budget);
      if (!locked) return null;
      const bundle = await readAuthorityBundle(tx, locked, budget);
      const resolved = currentCandidate(locked, bundle);
      const reason =
        resolved.cancel ??
        (resolved.candidate && unchanged(locked, resolved.candidate) ? null : 'authority_changed');
      return finish(tx, locked, reason, budget);
    })) as RevalidatedNotificationCandidate | null;
  } catch (error) {
    if (error instanceof NotificationProjectionUnavailable) throw error;
    throw new NotificationProjectionUnavailable('revalidation_unavailable');
  }
}
