import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { listPlans, listMemberships } from '$server/services/membership.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'memberships');
  if (isDenied(ctx)) return { memberships: ctx }; // rendered by DataSource (spec 039)
  depends('memberships:list');
  const [plans, members] = await Promise.all([listPlans(ctx), listMemberships(ctx)]);
  return { memberships: { plans, members, isAdmin: locals.user?.role === 'admin' } };
};
