import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { getTemplate } from '$server/services/brain-agents.service';

/**
 * /brains/template — org-level Brain Agent Template editor. Server-gated
 * behind `brains:manage` (route + the write API both enforce it — see
 * /api/brains/template).
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireDataset(locals, 'brains');
  depends('brains:template');
  return { template: await getTemplate(ctx) };
};
