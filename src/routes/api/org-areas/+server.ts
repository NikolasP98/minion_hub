import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { requireAdmin, requireTenantCtx } from '$server/auth/authorize';
import {
  listAreas,
  createArea,
  seedDefaultAreas,
  type OrgAreaInput,
} from '$server/services/org-areas.service';

/**
 * GET  /api/org-areas              → { areas: OrgArea[] }   (any org member)
 * POST /api/org-areas              → { area: OrgArea }      (admin) create
 * POST /api/org-areas { seed:true} → { areas: OrgArea[] }   (admin) seed defaults
 */
export const GET: RequestHandler = async ({ locals }) => {
  const ctx = requireTenantCtx(locals);
  const areas = await listAreas(ctx);
  return json({ areas });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = requireTenantCtx(locals);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    throw error(400, 'invalid JSON body');
  }

  if (body.seed === true) {
    const areas = await seedDefaultAreas(ctx);
    return json({ areas });
  }

  if (!body.name || typeof body.name !== 'string') throw error(400, 'name is required');

  const input: OrgAreaInput = {
    name: body.name,
    slug: typeof body.slug === 'string' ? body.slug : undefined,
    icon: typeof body.icon === 'string' ? body.icon : undefined,
    color: typeof body.color === 'string' ? body.color : undefined,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : undefined,
    agentIds: Array.isArray(body.agentIds) ? (body.agentIds as string[]) : undefined,
    userIds: Array.isArray(body.userIds) ? (body.userIds as string[]) : undefined,
    skillKeys: Array.isArray(body.skillKeys) ? (body.skillKeys as string[]) : undefined,
  };

  try {
    const area = await createArea(ctx, input);
    return json({ area });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to create area';
    throw error(400, msg);
  }
};
