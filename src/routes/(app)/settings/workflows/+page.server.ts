import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listDefs, WF_DOC_TYPES } from '$server/services/workflow.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  if (locals.user?.role !== 'admin') throw error(403, 'Admin access required');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  depends('settings:workflows');
  return { defs: await listDefs(ctx), docTypes: WF_DOC_TYPES };
};
