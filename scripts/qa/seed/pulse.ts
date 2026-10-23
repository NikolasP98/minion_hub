import { pulseFixtureId } from './ids';
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
}
