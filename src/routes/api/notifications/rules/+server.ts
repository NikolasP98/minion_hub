import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin } from '$server/auth/authorize';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listRules, createRule } from '$server/services/notif.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  return json(await listRules(ctx));
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const b = await request.json();
  if (!b?.name || !b?.triggerTable || !b?.triggerEvent || !b?.channel || !b?.template) {
    throw error(400, 'name, triggerTable, triggerEvent, channel, template required');
  }
  try {
    const rule = await createRule(ctx, b);
    return json(rule, { status: 201 });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid rule');
  }
};
