import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { requireCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { provisionBrainAgent, deprovisionBrainAgent } from '$server/services/brain-agents.service';

/** POST /api/brains/:id/agent — enable this brain's managing agent (idempotent). */
export const POST: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  const result = await provisionBrainAgent(ctx, params.id!, actor);
  return json(result);
};

/** DELETE /api/brains/:id/agent — disable this brain's managing agent. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  await requireOrgCapability(locals, 'brains', 'manage');
  const ctx = await requireCoreCtx(locals);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  await deprovisionBrainAgent(ctx, params.id!, actor);
  return json({ ok: true });
};
