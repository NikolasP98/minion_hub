import type { PageServerLoad } from './$types';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { getChannelIdentitiesForUser } from '$server/services/channel-identity.service';
import { getDb } from '$server/db/client';
import { getCoreDb } from '$server/db/pg-client';
import { redirect } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(302, '/login');

  const tenantId = locals.orgId ?? 'default';
  // personal_agents lives on Supabase (pg); channel identities still on Turso.
  const coreCtx = { db: getCoreDb(), tenantId };
  const tenantCtx = { db: getDb(), tenantId };

  const agent = await getPersonalAgent(coreCtx, locals.user.id);
  const channelIdentities = await getChannelIdentitiesForUser(tenantCtx, locals.user.id);

  return {
    agent,
    channelIdentities,
    userName: locals.user.displayName ?? locals.user.email.split('@')[0],
  };
};
