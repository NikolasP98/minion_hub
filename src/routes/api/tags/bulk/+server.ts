import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import type { Module } from '$server/services/rbac.service';
import { isModuleEnabled } from '$server/services/modules.service';
import { bulkAddRemoveTagLinks } from '$server/services/tag-links.service';
import type { TagEntityKind } from '$server/services/tag-links.service';

/**
 * `POST /api/tags/bulk` — the floating bulk bar's "Tags" action for the two
 * scopes that share the polymorphic `tag_links` table (`item`/`product`; CRM
 * contacts keep their own join and go through `/api/crm/contacts/[id]/tags`
 * instead — see `$lib/components/tags/tag-bulk.ts`). Same per-kind module gate
 * as the single-link route `/api/tags/[kind]/[id]`.
 */
const KIND_MODULE: Record<TagEntityKind, Module> = {
  booking: 'scheduling',
  event_type: 'scheduling',
  product: 'pos',
  item: 'stock',
};

function moduleForKind(kind: string): Module | null {
  return Object.prototype.hasOwnProperty.call(KIND_MODULE, kind)
    ? KIND_MODULE[kind as TagEntityKind]
    : null;
}

const bodySchema = z.object({
  scope: z.string().max(50),
  add: z.array(z.string().max(200)).max(200),
  remove: z.array(z.string().max(200)).max(200),
  targets: z
    .array(z.object({ type: z.string().max(50), id: z.string().max(200) }))
    .min(1)
    .max(500),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const b = await parseBody(request, bodySchema);
  const kinds = new Set(b.targets.map((t) => t.type));
  if (kinds.size !== 1) throw error(400, 'bulk tag targets must share one entity kind');
  const module = moduleForKind([...kinds][0]!);
  if (!module) throw error(404, 'unknown tag entity kind');
  const kind = [...kinds][0] as TagEntityKind;

  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  if (!(await isModuleEnabled(ctx, module))) throw error(404);
  await requireOrgCapability(locals, module, 'edit');

  try {
    await bulkAddRemoveTagLinks(
      ctx,
      kind,
      b.targets.map((t) => t.id),
      b.add,
      b.remove,
      locals.user?.supabaseId ?? null,
    );
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'invalid tag ids');
  }
  return json({ ok: true });
};
