import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { getCoreDb } from '$server/db/pg-client';
import { checkRateLimit } from '$server/auth/rate-limit';
import { normalizeChannelUserId } from '$server/identity/channel-claim.service';
import { activatePersonalAgent } from '$server/services/personal-agent-provisioner';

/**
 * Gateway → hub: is this WhatsApp sender a verified member of the account's org,
 * and which personal agent answers them? (spec 032 S1, contract fixed with S2.)
 *
 * Auth = the gateway server token + x-minion-server-id (resolve-identity sets
 * locals.serverId only for that bearer). No browser surface: a session caller
 * never has serverId and gets 401.
 */
type Reason = 'account_not_found' | 'not_verified' | 'not_member' | 'no_agent' | 'agent_not_ready';
const no = (reason: Reason) => json({ member: false, reason });
const fingerprint = (phone: string) => createHash('sha256').update(phone).digest('hex').slice(0, 8);

export const POST: RequestHandler = async ({ locals, request }) => {
  const serverId = locals.serverId;
  const orgId = locals.tenantCtx?.tenantId;
  if (!serverId || !orgId) throw error(401, 'Unauthorized');

  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    phone?: unknown;
  } | null;
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const digits = normalizeChannelUserId('whatsapp', phone);
  if (!accountId || !digits) throw error(400, 'accountId and phone are required');

  if (!checkRateLimit(`wa-member:${serverId}:${digits}`, 30, 60_000)) {
    throw error(429, 'Too many requests');
  }

  const db = getCoreDb();
  // legacy_server_id is not unique: an ambiguous alias proves no gateway (as in
  // resolveAssistantPrincipal), and the token's org must be this gateway's org.
  const gateways = await db.execute<{ id: string; org_id: string | null }>(sql`
    select id, org_id from gateway
    where legacy_server_id = ${serverId} or id::text = ${serverId} limit 2
  `);
  if (gateways.length !== 1 || gateways[0].org_id !== orgId) throw error(401, 'Unauthorized');
  const gatewayId = gateways[0].id;

  const channel = await db.execute(sql`
    select 1 from channels
    where type = 'whatsapp' and gateway_id = ${gatewayId}::uuid
      and account_id = ${accountId} and tenant_id = ${orgId}::uuid limit 1
  `);
  if (channel.length !== 1) return no('account_not_found');

  const identities = await db.execute<{ user_id: string }>(sql`
    select user_id from user_identities
    where provider = 'whatsapp' and external_id = ${digits} and verified_at is not null limit 1
  `);
  const profileId = identities[0]?.user_id;
  if (!profileId) return no('not_verified');

  const members = await db.execute(sql`
    select 1 from organization_members
    where organization_id = ${orgId}::uuid and profile_id = ${profileId}::uuid limit 1
  `);
  if (members.length !== 1) return no('not_member');

  const agents = await db.execute<{
    agent_id: string;
    gateway_id: string | null;
    provisioning_status: string;
  }>(sql`
    select agent_id, gateway_id, provisioning_status from personal_agents
    where profile_id = ${profileId}::uuid limit 1
  `);
  const agent = agents[0];
  if (!agent) return no('no_agent');

  const log = (decision: string) =>
    console.info(
      `[wa-member] gateway=${gatewayId} phone=${fingerprint(digits)} decision=${decision}`,
    );
  if (agent.gateway_id === gatewayId && agent.provisioning_status === 'active') {
    return json({ member: true, profileId, agentId: agent.agent_id });
  }
  if (agent.gateway_id) {
    log('agent_on_other_gateway');
    return no('agent_not_ready');
  }

  // shortcut: unbound agents auto-bind only when the org runs exactly one gateway
  // (the token's own); multi-gateway orgs answer agent_not_ready until the member
  // opens the web assistant. Upgrade when an org runs >1 gateway.
  const orgGateways = await db.execute<{ id: string }>(sql`
    select id from gateway where org_id = ${orgId}::uuid limit 2
  `);
  if (orgGateways.length !== 1 || orgGateways[0].id !== gatewayId) {
    log('unbound_multi_gateway');
    return no('agent_not_ready');
  }
  try {
    const agentId = await activatePersonalAgent({ db, tenantId: orgId, profileId }, profileId);
    log('activated');
    return json({ member: true, profileId, agentId });
  } catch {
    log('activation_failed');
    return no('agent_not_ready');
  }
};
