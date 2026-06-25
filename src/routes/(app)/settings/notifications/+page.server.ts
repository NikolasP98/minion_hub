import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listRules, NOTIF_TABLES } from '$server/services/notif.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  if (locals.user?.role !== 'admin') throw error(403, 'Admin access required');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  depends('settings:notifications');
  return { rules: await listRules(ctx), tables: NOTIF_TABLES };
};
