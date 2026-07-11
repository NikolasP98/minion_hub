import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { hasPasswordIdentity } from '$server/auth/password';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:security');
  if (!locals.tenantCtx || !locals.user) throw error(401, 'authentication required');

  const supabaseId = locals.user.supabaseId ?? locals.user.id;

  return {
    username: locals.user.username ?? null,
    email: locals.user.email,
    hasPassword: await hasPasswordIdentity(supabaseId),
  };
};
