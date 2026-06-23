import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { getSlaConfig, setSlaConfig, type SlaConfig } from '$server/services/support.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await getSlaConfig(ctx));
};

/** PUT /api/support/settings — admin: update the per-org default SLA. */
export const PUT: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = (await request.json()) as SlaConfig;
  if (!body?.priorities) throw error(400, 'priorities required');
  await setSlaConfig(ctx, body);
  return json({ ok: true });
};
