import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { listLinks, upsertLink } from '$server/services/scheduling.service';

const linkSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  eventTypeIds: z.array(z.string().max(200)).optional(),
  resourceId: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

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
  const b = await parseBody(request, linkSchema);
  const id = await upsertLink(ctx, {
    slug: b.slug.trim(),
    title: b.title.trim(),
    description: b.description ?? null,
    eventTypeIds: b.eventTypeIds ?? [],
    resourceId: b.resourceId ?? null,
    active: b.active !== false,
    expiresAt: b.expiresAt ?? null,
  });
  return json({ id });
};
