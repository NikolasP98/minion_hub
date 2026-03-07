import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { serverBackups } from '$server/db/schema';
import {
  getBackupConfig,
  deleteRemoteSnapshot,
  deleteSnapshotRecord,
} from '$server/services/backup.service';

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);

  const [snapshot] = await ctx.db
    .select()
    .from(serverBackups)
    .where(eq(serverBackups.id, params.snapshotId!));

  if (!snapshot) {
    return json({ ok: false, error: 'Snapshot not found' }, { status: 404 });
  }

  const backupConfig = await getBackupConfig(ctx);
  if (backupConfig?.backupHost) {
    await deleteRemoteSnapshot(backupConfig, snapshot.snapshotPath);
  }

  await deleteSnapshotRecord(ctx, snapshot.id);
  return json({ ok: true });
};
