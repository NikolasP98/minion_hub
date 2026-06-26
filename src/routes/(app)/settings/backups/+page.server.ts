import type { PageServerLoad } from './$types';
import { requireOrgCapability } from '$server/services/rbac.service';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getBackupConfig } from '$server/services/backup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:backups');
  await requireOrgCapability(locals, 'settings', 'manage');
  const ctx = await requireCoreCtx(locals);
  const config = await getBackupConfig(ctx);
  return { config };
};
