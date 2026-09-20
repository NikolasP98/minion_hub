import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { requireOrgCapability } from '$server/services/rbac.service';
import { listTags, updateTag, deleteTag } from '$server/services/crm-contacts.service';
import { TAG_SCOPE_MODULE, isTagScope } from '$lib/tags/scope';

/**
 * One tag definition. Gated on the module of the tag's OWN scope, resolved
 * from the row (a catalog tag is a POS concern, an event tag a scheduling one).
 */
async function gateTag(locals: App.Locals, id: string | undefined) {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const tag = (await listTags(ctx)).find((t) => t.id === id);
  if (!tag) throw error(404, 'tag not found');
  const scope = isTagScope(tag.scope) ? tag.scope : 'crm';
  await requireOrgCapability(locals, TAG_SCOPE_MODULE[scope], 'edit');
  return { ctx, tag };
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  color: z.string().max(50).nullable().optional(),
});

/** PATCH /api/tags/[id] { name?, color? } → `{ tag: CalTag }` (rename / recolour). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const { ctx, tag } = await gateTag(locals, params.id);
  const b = await parseBody(request, patchSchema);
  try {
    const row = await updateTag(ctx, tag.id, b);
    if (!row) throw error(404, 'tag not found');
    return json({ tag: { id: row.id, name: row.name, color: row.color } });
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    throw error(400, e instanceof Error ? e.message : 'Invalid tag');
  }
};

/** DELETE /api/tags/[id] — remove a tag definition (cascades every application). */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const { ctx, tag } = await gateTag(locals, params.id);
  await deleteTag(ctx, tag.id);
  return json({ ok: true });
};
