import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getBackupConfig } from '$server/services/backup.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('settings:backups');
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const config = await getBackupConfig(ctx);
  return { config };
};
