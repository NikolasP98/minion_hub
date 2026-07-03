import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { requireAdmin } from '$server/auth/authorize';
import { parseBody } from '$server/api/validate';
import { isModuleEnabled } from '$server/services/modules.service';
import { upsertLink, deleteLink } from '$server/services/scheduling.service';

const linkSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable().optional(),
  eventTypeIds: z.array(z.string().max(200)).optional(),
  resourceId: z.string().max(200).nullable().optional(),
  active: z.boolean().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const PATCH: RequestHandler = async ({ locals, request, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  const b = await parseBody(request, linkSchema);
  await upsertLink(
    ctx,
    {
      slug: b.slug.trim(),
      title: b.title.trim(),
      description: b.description ?? null,
      eventTypeIds: b.eventTypeIds ?? [],
      resourceId: b.resourceId ?? null,
      active: b.active !== false,
      expiresAt: b.expiresAt ?? null,
    },
    params.id!,
  );
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireAdmin(locals);
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(403, 'scheduling module disabled');
  await deleteLink(ctx, params.id!);
  return json({ ok: true });
};
