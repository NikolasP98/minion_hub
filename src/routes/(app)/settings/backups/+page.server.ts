import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getBackupConfig } from '$server/services/backup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:backups');
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const config = await getBackupConfig(ctx);
  return { config };
};
