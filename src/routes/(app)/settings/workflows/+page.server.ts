import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listDefs, WF_DOC_TYPES } from '$server/services/workflow.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  depends('settings:workflows');
  return { defs: await listDefs(ctx), docTypes: WF_DOC_TYPES };
};
