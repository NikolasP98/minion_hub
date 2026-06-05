import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { getBackupConfig, upsertBackupConfig } from '$server/services/backup.service';

export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const config = await getBackupConfig(ctx);
  return json({ ok: true, config });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await requireCoreCtx(locals);
  const body = await request.json();
  const id = await upsertBackupConfig(ctx, body);
  return json({ ok: true, id });
};
