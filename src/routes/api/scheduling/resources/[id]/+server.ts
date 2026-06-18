import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { updateResource, deleteResource } from '$server/services/scheduling.service';

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  await updateResource(ctx, params.id!, {
    ...(b.name !== undefined ? { name: String(b.name) } : {}),
    ...(b.email !== undefined ? { email: b.email ? String(b.email) : null } : {}),
    ...(b.timezone !== undefined ? { timezone: String(b.timezone) } : {}),
    ...(b.color !== undefined ? { color: b.color ? String(b.color) : null } : {}),
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
