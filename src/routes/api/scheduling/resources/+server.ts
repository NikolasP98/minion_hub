import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { listResources, createResource } from '$server/services/scheduling.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ resources: await listResources(ctx) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.name !== 'string' || !b.name.trim()) throw error(400, 'name required');
  const resource = await createResource(ctx, {
    name: String(b.name).trim(),
    email: b.email ? String(b.email) : null,
    timezone: b.timezone ? String(b.timezone) : undefined,
    color: b.color ? String(b.color) : null,
    profileId: b.profileId ? String(b.profileId) : null,
  });
  return json({ resource });
};
