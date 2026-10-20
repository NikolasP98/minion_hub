import { sql } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import type { CoreCtx } from '$server/auth/core-ctx';
import { decryptToken } from '$server/auth/crypto';
import { currentBuildChannel } from '$server/gateway-channel';
import { resolveOrgChannelTarget } from './gateway-lease.service';

type Target = NonNullable<Awaited<ReturnType<typeof resolveOrgChannelTarget>>>;
type Transaction = Parameters<Parameters<CoreCtx['db']['transaction']>[0]>[0];
type AgentSnapshot = {
  id: string;
  agent_id: string;
  gateway_id: string | null;
  provisioning_status: string;
  updated_at: string;
};
export interface PersonalAgentBinding {
  target: Target;
  profileId: string;
  orgId: string;
  agent: AgentSnapshot;
}

export class PersonalAgentBindingError extends Error {
  readonly code = 'PERSONAL_AGENT_BINDING_CONFLICT';
}
const conflict = () =>
  new PersonalAgentBindingError(
    'The personal agent gateway assignment could not be verified. No assignment was changed.',
  );

/** Membership and target credentials are re-read under locks before each commit. */
async function readAuthority(
  tx: Transaction,
  profileId: string,
  orgId: string,
  target: Target,
): Promise<AgentSnapshot> {
  const members = await tx.execute(sql`
    select profile_id from organization_members
    where profile_id = ${profileId}::uuid and organization_id = ${orgId}::uuid for share
  `);
  if (members.length !== 1) throw conflict();
  const gateways = await tx.execute<{
    url: string;
    token_ciphertext: string;
    token_iv: string;
    auth_mode: string;
  }>(sql`
    select url, token_ciphertext, token_iv, auth_mode from gateway
    where id = ${target.gatewayId}::uuid and org_id = ${orgId}::uuid
      and coalesce(channel, 'prd') = ${target.channel} for share
  `);
  const row = gateways[0];
  if (!row || row.url !== target.url || row.auth_mode !== 'token') throw conflict();
  const stored = row.token_iv
    ? decryptToken(row.token_ciphertext, row.token_iv)
    : row.token_ciphertext;
  const a = Buffer.from(stored),
    b = Buffer.from(target.token);
  if (!a.length || a.length !== b.length || !timingSafeEqual(a, b)) throw conflict();
  const leases = await tx.execute<{ gateway_id: string }>(sql`
    select gateway_id from gateway_lease
    where org_id = ${orgId}::uuid and channel = ${target.channel} for share
  `);
  if (leases.length !== 1 || leases[0].gateway_id !== target.gatewayId) throw conflict();
  const agents = await tx.execute<AgentSnapshot>(sql`
    select id, agent_id, gateway_id, provisioning_status, updated_at::text as updated_at from personal_agents
    where profile_id = ${profileId}::uuid for update
  `);
  if (agents.length !== 1) throw conflict();
  const agent = agents[0];
  // TODO(handoff): A profile has one immutable gateway binding; concurrent multi-org
  // delegation needs a separate authority model. See meta proposals/2026-10-18-assistant-capability-failure-recovery.md.
  if (agent.gateway_id && agent.gateway_id !== target.gatewayId) throw conflict();
  return agent;
}

export async function preparePersonalAgentBinding(
  ctx: CoreCtx,
  userId: string,
): Promise<PersonalAgentBinding> {
  if (!ctx.profileId || ctx.profileId !== userId) throw conflict();
  const members = await ctx.db.execute(sql`
    select profile_id from organization_members
    where profile_id = ${userId}::uuid and organization_id = ${ctx.tenantId}::uuid
  `);
  if (members.length !== 1) throw conflict();
  const target = await resolveOrgChannelTarget(ctx.tenantId, currentBuildChannel());
  if (!target) throw conflict();
  const agent = await ctx.db.transaction((tx) => readAuthority(tx, userId, ctx.tenantId, target));
  return { target, profileId: userId, orgId: ctx.tenantId, agent };
}

export async function commitPersonalAgentBinding(ctx: CoreCtx, binding: PersonalAgentBinding) {
  if (ctx.profileId !== binding.profileId || ctx.tenantId !== binding.orgId) throw conflict();
  await ctx.db.transaction(async (tx) => {
    const agent = await readAuthority(tx, binding.profileId, binding.orgId, binding.target);
    const before = binding.agent;
    if (agent.id !== before.id || agent.agent_id !== before.agent_id) throw conflict();
    if (agent.gateway_id === binding.target.gatewayId && agent.provisioning_status === 'active')
      return;
    if (
      agent.gateway_id !== before.gateway_id ||
      agent.provisioning_status !== before.provisioning_status ||
      agent.updated_at !== before.updated_at
    )
      throw conflict();
    await tx.execute(sql`
      update personal_agents set gateway_id = ${binding.target.gatewayId}::uuid,
        provisioning_status = 'active', provisioning_error = null, updated_at = now()
      where id = ${before.id} and profile_id = ${binding.profileId}::uuid
    `);
    await tx.execute(sql`
      update profiles set personal_agent_id = ${before.agent_id} where id = ${binding.profileId}::uuid
    `);
  });
}

/** A failed concurrent attempt must not overwrite a completed binding. */
export async function recordPersonalAgentBindingFailure(
  ctx: CoreCtx,
  binding: PersonalAgentBinding,
) {
  await ctx.db.execute(sql`
    update personal_agents set provisioning_error = 'Gateway verification failed; retry provisioning.',
      last_retry_at = now(), retry_count = retry_count + 1, updated_at = now(),
      provisioning_status = ${binding.agent.provisioning_status === 'active' ? 'active' : 'error'}
    where id = ${binding.agent.id} and profile_id = ${binding.profileId}::uuid
      and agent_id = ${binding.agent.agent_id}
      and gateway_id is not distinct from ${binding.agent.gateway_id}::uuid
      and provisioning_status = ${binding.agent.provisioning_status}
      and updated_at = ${binding.agent.updated_at}::timestamptz
  `);
}

/** Legacy clients may report failure late; they cannot demote a verified assignment. */
export async function recordPersonalAgentClientFailure(ctx: CoreCtx, userId: string) {
  if (!ctx.profileId || ctx.profileId !== userId) throw conflict();
  await ctx.db.execute(sql`
    update personal_agents set provisioning_status = 'error',
      provisioning_error = 'Client provisioning failed; retry server verification.',
      last_retry_at = now(), retry_count = retry_count + 1, updated_at = now()
    where profile_id = ${userId}::uuid and gateway_id is null
      and provisioning_status in ('pending', 'provisioning', 'error')
      and exists (select 1 from organization_members
        where profile_id = ${userId}::uuid and organization_id = ${ctx.tenantId}::uuid)
  `);
}
