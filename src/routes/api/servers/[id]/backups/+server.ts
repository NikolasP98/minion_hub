import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { listSnapshots } from '$server/services/backup.service';

export const GET: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const snapshots = await listSnapshots(ctx, params.id!);
  return json({ ok: true, snapshots });
};
