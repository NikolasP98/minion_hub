import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { listChannelIdentitiesFromSupabase } from '$server/services/supabase-credential';
import { ensureDefaultGatewayForUser } from '$server/services/gateway.pg.service';
import { loadHostsForUser } from '$server/services/hosts.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw redirect(303, '/login');
  // personal_agents + identities both on Supabase (pg). coreCtx for the agent.
  const coreCtx = { db: getCoreDb(), tenantId: ctx.tenantId };

  const existing = await getPersonalAgent(coreCtx, user.id);
  if (existing && existing.provisioningStatus === 'active') {
    throw redirect(303, '/');
  }

  // Default-server policy: link the shared netcup gateway so the CONNECT step
  // has a live connection (channel setup + agent creation run over the gateway
  // WS). Best-effort — onboarding still renders if linking fails. The root
  // +layout.svelte's loadHosts()/wsConnect() then auto-connects from the
  // `hosts` returned below.
  if (user.supabaseId) {
    try {
      await ensureDefaultGatewayForUser(user.supabaseId);
    } catch (err) {
      console.error('[onboarding] ensureDefaultGatewayForUser failed:', err);
    }
  }
  const hostsResult = await loadHostsForUser(locals as App.Locals, user.id, user.role);
  // Onboarding connects everyone to netcup: surface it first so loadHosts()
  // (which defaults to hosts[0] absent a saved selection) picks it. New
  // non-admin users only have netcup linked anyway; admins see all but still
  // default to netcup here rather than a possibly-offline local gateway.
  const hosts = {
    ...hostsResult,
    servers: [...hostsResult.servers].sort(
      (a, b) =>
        (a.name.toLowerCase() === 'netcup' ? 0 : 1) - (b.name.toLowerCase() === 'netcup' ? 0 : 1),
    ),
  };

  const identities = (
    await listChannelIdentitiesFromSupabase(user.supabaseId ?? user.id)
  ).map((i) => ({
    id: i.id,
    source: 'supabase' as const,
    provider: i.channel,
    kind: 'channel' as const,
    externalId: i.channelUserId,
    displayName: i.displayName,
    verifiedAt: i.verifiedAt,
  }));

  return {
    user: {
      id: user.id,
      email: user.email ?? '',
      displayName: user.displayName ?? user.email ?? '',
    },
    identities,
    // Consumed by hosts state's pageHosts() (root +layout.svelte loadHosts()),
    // so onboarding auto-connects to the linked gateway like (app)/* does.
    hosts,
  };
};
