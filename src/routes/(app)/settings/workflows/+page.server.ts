import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listDefs, WF_DOC_TYPES } from '$server/services/workflow.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  depends('settings:workflows');
  return { defs: await listDefs(ctx), docTypes: WF_DOC_TYPES };
};
