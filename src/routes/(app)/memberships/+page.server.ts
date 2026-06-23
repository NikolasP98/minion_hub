import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listPlans, listMemberships } from '$server/services/membership.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('memberships:list');
  const [plans, members] = await Promise.all([listPlans(ctx), listMemberships(ctx)]);
  return { plans, members, isAdmin: locals.user?.role === 'admin' };
};
