import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listResources, createResource } from '$server/services/scheduling.service';

// '' / null / undefined -> null (matches the old `b.x ? String(b.x) : null` guards).
const strOrNull = (max: number) =>
  z.preprocess((v) => (v ? v : null), z.string().max(max).nullable().optional());
const postSchema = z.object({
  name: z.string().trim().min(1).max(500),
  kind: z.enum(['staff', 'room', 'equipment']).optional(),
  email: strOrNull(320),
  timezone: z.string().max(100).optional(),
  color: strOrNull(50),
  profileId: strOrNull(200),
});

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ resources: await listResources(ctx) });
};

// Writes are gated by the central hook (scheduling:edit), same as /api/scheduling/hr/*.
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, postSchema);
  const resource = await createResource(ctx, {
    name: b.name.trim(),
    kind: b.kind,
    email: b.email ?? null,
    timezone: b.timezone,
    color: b.color ?? null,
    profileId: b.profileId ?? null,
  });
  return json({ resource });
};
