import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import type { Module } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { getTagLinks, setTagLinks } from '$server/services/tag-links.service';
import type { TagEntityKind } from '$server/services/tag-links.service';

/**
 * `/api/tags/[kind]/[id]` isn't under an `API_WRITE_PREFIXES` prefix (the
 * gated module depends on `kind`, which the central hook can't see), so both
 * GET and PUT gate explicitly here via `requireOrgCapability` — spec
 * 2026-09-08-hub-scheduling-calendar-views-tags-spec §2.2.
 */
const KIND_MODULE: Record<TagEntityKind, Module> = {
  booking: 'scheduling',
  event_type: 'scheduling',
  product: 'pos',
};

function moduleForKind(kind: string): Module | null {
  return Object.prototype.hasOwnProperty.call(KIND_MODULE, kind)
    ? KIND_MODULE[kind as TagEntityKind]
    : null;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const module = moduleForKind(params.kind ?? '');
  if (!module) throw error(404, 'unknown tag entity kind');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, module))) throw error(404);
  await requireOrgCapability(locals, module, 'view');
  const map = await getTagLinks(ctx, params.kind as TagEntityKind, [params.id!]);
  return json({ tags: map.get(params.id!) ?? [] });
};

const putSchema = z.object({ tagIds: z.array(z.string().max(200)) });

export const PUT: RequestHandler = async ({ locals, request, params }) => {
  const module = moduleForKind(params.kind ?? '');
  if (!module) throw error(404, 'unknown tag entity kind');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, module))) throw error(404);
  await requireOrgCapability(locals, module, 'edit');
  const b = await parseBody(request, putSchema);
  try {
    const tags = await setTagLinks(
      ctx,
      params.kind as TagEntityKind,
      params.id!,
      b.tagIds,
      locals.user?.supabaseId ?? null,
    );
    return json({ tags });
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid tag ids');
  }
};
