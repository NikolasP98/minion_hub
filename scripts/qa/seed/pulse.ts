import { pulseFixtureId, digestFixtureId } from './ids';
import { ORG_PERSONAL, userId } from './tenancy';
import type { SeedContext } from './db';
export async function seed({
  sql,
  register,
}: Pick<SeedContext, 'sql' | 'register'>): Promise<void> {
  const owner = userId('tenancy.user.owner');
  const other = userId('tenancy.user.staff');
  for (const scenario of ['legacy', 'owner', 'other-owner', 'conflict', 'indeterminate'] as const) {
    const id = pulseFixtureId(scenario);
    const boundOwner = scenario === 'legacy' ? null : scenario === 'other-owner' ? other : owner;
    const decided = scenario === 'indeterminate';
    await sql`insert into pulse_proposals(id,org_id,source,kind,title,dedup_key,owner_profile_id,revision,status,decided_by,decided_at,payload)
      values(${id},${ORG_PERSONAL},'qa',${decided ? 'reminder' : 'fyi'},${`QA Pulse ${scenario}`},${`qa:pulse:${scenario}`},${boundOwner},${scenario === 'conflict' ? 2 : 1},${decided ? 'approved' : 'pending'},${decided ? owner : null},${decided ? '2026-10-23T00:00:00Z' : null}::timestamptz,'{}'::jsonb)
      on conflict(org_id,dedup_key) do nothing`;
    if (decided) {
      const dispatch = pulseFixtureId(scenario, 'dispatch');
      const job = pulseFixtureId(scenario, 'job');
      await sql`insert into bg_jobs(id,tenant_id,user_id,type,ref_id,status,created_at,updated_at,lease_generation) values(${job},${ORG_PERSONAL},${owner},'pulse_dispatch',${dispatch},'done',1,1,1) on conflict(id) do nothing`;
      await sql`insert into pulse_dispatches(id,org_id,proposal_id,proposal_revision,actor_profile_id,gateway_id,channel,agent_id,origin_session_key,action_kind,payload,payload_hash,tool_schema_revision,authority_snapshot_hash,gateway_qualification_revision,bg_job_id,state,admitted_at,admitted_generation,safe_reason)
        values(${dispatch},${ORG_PERSONAL},${id},1,${owner},${pulseFixtureId('gateway')},'prd','qa-personal','agent:qa-personal:main','reminder','{}','qa-fixture','qa-schema','qa-authority','qa-disabled',${job},'indeterminate','2026-10-23T00:00:00Z',1,'remote_acceptance_unknown') on conflict(id) do nothing`;
    }
    register(`pulse.${scenario}`, { table: 'pulse_proposals', where: { id } });
  }
  for (const scenario of [
    'zero-budget',
    'unknown',
    'duplicate',
    'revoked',
    'stale-cursor',
  ] as const) {
    const actor = scenario === 'revoked' ? other : owner;
    const namespace = 'qa-digest-disabled';
    await sql`insert into pulse_digest_admission(org_id,owner_profile_id,budget_namespace,policy_revision,policy_hash,approval_revision,approval_expires_at,max_calls,upper_micro_usd,daily_micro_usd,unknown_exposure_fence)
      values(${ORG_PERSONAL},${actor},${namespace},'qa-digest-v1','qa-disabled','unapproved','2026-01-01',0,0,0,${scenario === 'unknown'}) on conflict do nothing`;
    const id = digestFixtureId(scenario),
      job = digestFixtureId(scenario, 'job');
    await sql`insert into bg_jobs(id,tenant_id,user_id,type,ref_id,status,created_at,updated_at,lease_generation) values(${job},${ORG_PERSONAL},${actor},'pulse_digest',${id},'done',1,1,1) on conflict do nothing`;
    const unknown = scenario === 'unknown';
    await sql`insert into pulse_digest_runs(id,org_id,owner_profile_id,budget_namespace,policy_revision,policy_hash,source_snapshot_hash,request_hash,snapshot,evidence,requested_model,bg_job_id,state,attempt_id,admitted_generation,admitted_day,admitted_at,upper_micro_usd,safe_reason)
      values(${id},${ORG_PERSONAL},${actor},${namespace},'qa-digest-v1','qa-disabled',${`qa-${scenario}`},'qa-request','{}'::jsonb,'[]','unapproved/model',${job},${unknown ? 'indeterminate' : 'canceled'},${unknown ? digestFixtureId(scenario, 'attempt') : null}::uuid,${unknown ? 1 : null},${unknown ? '2026-10-23' : null}::date,${unknown ? '2026-10-23' : null}::timestamptz,${unknown ? 0 : null},'qa-disabled') on conflict do nothing`;
    if (unknown)
      await sql`update pulse_digest_admission set unknown_exposure_fence=true,active_run_id=${id},active_attempt_id=${digestFixtureId(scenario, 'attempt')} where org_id=${ORG_PERSONAL} and owner_profile_id=${actor} and budget_namespace=${namespace}`;
    if (scenario === 'stale-cursor')
      await sql`insert into pulse_digest_sources(org_id,owner_profile_id,policy_revision,source_id,revision,content_hash)values(${ORG_PERSONAL},${actor},'qa-digest-v1','ai',2,'qa-newer') on conflict do nothing`;
    register(`pulse.digest.${scenario}`, { table: 'pulse_digest_runs', where: { id } });
  }
}
