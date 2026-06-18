import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { isModuleEnabled } from '$server/services/modules.service';
import { listLinks, upsertLink } from '$server/services/scheduling.service';

export const GET: RequestHandler = async ({ locals }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  return json({ links: await listLinks(ctx) });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof b.slug !== 'string' || !b.slug.trim()) throw error(400, 'slug required');
  if (typeof b.title !== 'string' || !b.title.trim()) throw error(400, 'title required');
  const id = await upsertLink(ctx, {
    slug: String(b.slug).trim(),
    title: String(b.title).trim(),
    description: b.description ? String(b.description) : null,
    eventTypeIds: Array.isArray(b.eventTypeIds) ? b.eventTypeIds.map(String) : [],
    resourceId: b.resourceId ? String(b.resourceId) : null,
    active: b.active !== false,
    expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : null,
  });
  return json({ id });
};
