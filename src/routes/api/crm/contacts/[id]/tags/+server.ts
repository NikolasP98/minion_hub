import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { applyTag, removeTag } from '$server/services/crm-contacts.service';

const postSchema = z.object({ tagId: z.string().min(1).max(200) });

/** POST /api/crm/contacts/[id]/tags { tagId } — apply a manual tag. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const { tagId } = await parseBody(request, postSchema);
  await applyTag(ctx, params.id!, tagId, locals.user?.supabaseId ?? null);
  return json({ ok: true }, { status: 201 });
};

/** DELETE /api/crm/contacts/[id]/tags?tagId=… — remove a manual tag. */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const tagId = url.searchParams.get('tagId');
  if (!tagId) throw error(400, 'tagId is required');
  await removeTag(ctx, params.id!, tagId);
  return json({ ok: true });
};
