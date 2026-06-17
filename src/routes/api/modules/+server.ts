import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { listModuleStates, setModuleEnabled } from '$server/services/modules.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json({ modules: await listModuleStates(ctx) });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await request.json().catch(() => ({}));
  if (typeof body.moduleId !== 'string' || typeof body.enabled !== 'boolean') throw error(400, 'moduleId + enabled required');
  await setModuleEnabled(ctx, body.moduleId, body.enabled);
  return json({ ok: true });
};
