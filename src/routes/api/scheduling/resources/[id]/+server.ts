import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { updateResource, deleteResource } from '$server/services/scheduling.service';

const patchSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  email: z.string().max(320).nullable().optional(),
  timezone: z.string().max(100).optional(),
  color: z.string().max(50).nullable().optional(),
  active: z.boolean().optional(),
});

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, patchSchema);
  await updateResource(ctx, params.id!, {
    ...(b.name !== undefined ? { name: b.name } : {}),
    ...(b.email !== undefined ? { email: b.email ? b.email : null } : {}),
    ...(b.timezone !== undefined ? { timezone: b.timezone } : {}),
    ...(b.color !== undefined ? { color: b.color ? b.color : null } : {}),
    ...(b.active !== undefined ? { active: b.active === true } : {}),
  });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  await deleteResource(ctx, params.id!);
  return json({ ok: true });
};
