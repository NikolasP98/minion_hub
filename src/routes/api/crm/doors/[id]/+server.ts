import type { RequestHandler } from '@sveltejs/kit';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireOrgCapability } from '$server/services/rbac.service';
import { parseBody } from '$server/api/validate';
import { uuidParamOr404 } from '$server/utils/uuid-param';
import { DOOR_SLUG_RE, getDoor, updateDoor } from '$server/services/doors.service';
import { doorErrorResponse } from '$server/doors/http';

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    slug: z.string().trim().regex(DOOR_SLUG_RE).optional(),
    active: z.boolean().optional(),
    config: z.unknown().optional(),
  })
  .strict();

/** GET /api/crm/doors/[id] → the full door incl. config (crm:view). */
export const GET: RequestHandler = async ({ locals, params }) => {
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'view');
  const door = await getDoor(ctx, id);
  if (!door) throw error(404, 'Not found');
  return json({ door });
};

/** PATCH /api/crm/doors/[id] (crm:manage). No DELETE: a door is switched off, never deleted. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const id = uuidParamOr404(params.id!);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  await requireOrgCapability(locals, 'crm', 'manage');
  const patch = await parseBody(request, patchSchema);
  try {
    const door = await updateDoor(ctx, id, {
      ...patch,
      description: patch.description === '' ? null : patch.description,
    });
    if (!door) throw error(404, 'Not found');
    return json({ door });
  } catch (e) {
    return doorErrorResponse(e);
  }
};
