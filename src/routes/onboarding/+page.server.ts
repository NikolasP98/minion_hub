import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { listChannelIdentitiesFromSupabase } from '$server/services/supabase-credential';

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
  };
};
