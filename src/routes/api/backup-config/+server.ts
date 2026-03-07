import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getOrCreateTenantCtx } from '$server/auth/tenant-ctx';
import { getBackupConfig, upsertBackupConfig } from '$server/services/backup.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const config = await getBackupConfig(ctx);
  return json({ ok: true, config });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getOrCreateTenantCtx(locals);
  const body = await request.json();
  const id = await upsertBackupConfig(ctx, body);
  return json({ ok: true, id });
};
