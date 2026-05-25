import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { listIdentities } from '$server/services/identity.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:identities');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');

  const rows = await listIdentities(locals.tenantCtx, locals.user.id);
  const identities = rows.map((i) => ({
    id: i.id,
    provider: i.provider,
    kind: i.kind as 'oauth' | 'channel',
    externalId: i.externalId,
    displayName: i.displayName,
    verifiedAt: i.verifiedAt,
  }));

  return { userId: locals.user.id, identities };
};
