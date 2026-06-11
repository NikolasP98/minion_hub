import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, requireTenantCtx } from '$server/auth/authorize';
import { updateArea, deleteArea, type OrgAreaPatch } from '$server/services/org-areas.service';

/**
 * PATCH  /api/org-areas/[id]  → { area: OrgArea }   (admin) partial update
 * DELETE /api/org-areas/[id]  → { ok: true }        (admin)
 *
 * Both are org-scoped in the service (the update/delete also filter on the
 * active org id), so an admin can only mutate their own org's areas.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  requireAdmin(locals);
  const ctx = requireTenantCtx(locals);
  const id = params.id;
  if (!id) throw error(400, 'id is required');

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'invalid JSON body');
  }

  const patch: OrgAreaPatch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.slug === 'string') patch.slug = body.slug;
  if (typeof body.icon === 'string') patch.icon = body.icon;
  if (typeof body.color === 'string') patch.color = body.color;
  if (typeof body.sortOrder === 'number') patch.sortOrder = body.sortOrder;
  if (Array.isArray(body.agentIds)) patch.agentIds = body.agentIds as string[];
  if (Array.isArray(body.userIds)) patch.userIds = body.userIds as string[];
  if (Array.isArray(body.skillKeys)) patch.skillKeys = body.skillKeys as string[];
  if (Array.isArray(body.integrationKeys))
    patch.integrationKeys = body.integrationKeys as string[];
  if (Array.isArray(body.virtualAgents))
    patch.virtualAgents = body.virtualAgents as OrgAreaPatch['virtualAgents'];

  try {
    const area = await updateArea(ctx, id, patch);
    return json({ area });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to update area';
    throw error(400, msg);
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = requireTenantCtx(locals);
  const id = params.id;
  if (!id) throw error(400, 'id is required');
  await deleteArea(ctx, id);
  return json({ ok: true });
};
