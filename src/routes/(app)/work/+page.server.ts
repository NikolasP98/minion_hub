import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listMyWork, listRules, DOC_TYPES } from '$server/services/assignment.service';
import { listUsers } from '$server/services/user.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx?.profileId) throw error(401, 'Authentication required');
  depends('work:queue');

  const isAdmin = locals.user?.role === 'admin';
  const [items, users, rules] = await Promise.all([
    listMyWork(ctx, ctx.profileId),
    listUsers(ctx).catch(() => []),
    isAdmin ? listRules(ctx) : Promise.resolve([]),
  ]);
  const members = users.map((u) => ({ id: u.id, name: u.displayName ?? u.email ?? u.id }));
  return { items, members, rules, isAdmin, docTypes: DOC_TYPES };
};
