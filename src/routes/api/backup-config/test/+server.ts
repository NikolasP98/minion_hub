import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { testBackupConnection } from '$server/services/backup.service';

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const { backupHost, backupUser, backupPort, backupBasePath } = await request.json();
  if (!backupHost) return json({ ok: false, message: 'Backup host is required' }, { status: 400 });
  const result = await testBackupConnection(
    backupHost,
    backupUser ?? 'root',
    backupPort ?? 22,
    backupBasePath ?? '/mnt/agent-data/backups',
  );
  return json(result);
};
