import type { PageServerLoad } from './$types';
import { requireDataset } from '$server/auth/dataset-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listKeys } from '$server/services/org-api-keys.service';

/** Settings → Developers (spec 121): the organization's API keys. */
export const load: PageServerLoad = async ({ locals, depends }) => {
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  depends('settings:developers');
  return { keys: await listKeys(ctx) };
};
