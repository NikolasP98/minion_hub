import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { removeDocument, resolvePrincipal } from '$server/services/brains.service';

/** DELETE /api/brains/:id/documents/:docId */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const principal = await resolvePrincipal(ctx);
  const actor = { id: ctx.profileId ?? null, name: locals.user?.displayName ?? locals.user?.email ?? null };
  await removeDocument(ctx, params.id!, params.docId!, principal, actor);
  return json({ ok: true });
};
