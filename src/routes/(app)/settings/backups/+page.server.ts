import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireDataset } from '$server/auth/dataset-ctx';
import { getBackupConfig } from '$server/services/backup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:backups');
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireDataset(locals, 'settings');
  const config = await getBackupConfig(ctx);
  return { config };
};
