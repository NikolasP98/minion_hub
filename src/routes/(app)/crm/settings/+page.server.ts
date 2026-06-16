import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listTags } from '$server/services/crm-contacts.service';
import { getAccountScopeLive } from '$server/services/crm-channels.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:tags');
  depends('crm:accounts');
  const [tags, scope] = await Promise.all([listTags(ctx), getAccountScopeLive(ctx)]);
  return { tags, scope };
};
