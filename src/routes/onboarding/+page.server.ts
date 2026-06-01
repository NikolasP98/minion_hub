import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireAuth } from '$server/auth/authorize';
import { getTenantCtx } from '$server/auth/tenant-ctx';
import { getPersonalAgent } from '$server/services/personal-agent.service';
import { listIdentities } from '$server/services/identity.service';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireAuth(locals);
  const ctx = await getTenantCtx(locals as App.Locals);
  if (!ctx) throw redirect(303, '/login');

  const existing = await getPersonalAgent(ctx, user.id);
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
