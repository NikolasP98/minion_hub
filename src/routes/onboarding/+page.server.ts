import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getCoreDb } from '$server/db/pg-client';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { listIdentities } from '$server/services/identity.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw redirect(303, '/login');
  // personal_agents is on Supabase (pg); identities still on Turso (ctx).
  const coreCtx = { db: getCoreDb(), tenantId: ctx.tenantId };

  const existing = await getPersonalAgent(coreCtx, user.id);
  if (existing && existing.provisioningStatus === 'active') {
    throw redirect(303, '/');
  }

  const identities = (await listIdentities(ctx, user.id))
    .filter((i) => i.kind === 'channel')
    .map((i) => ({
      id: i.id,
      source: 'turso' as const,
      provider: i.provider,
      kind: 'channel' as const,
      externalId: i.externalId,
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
